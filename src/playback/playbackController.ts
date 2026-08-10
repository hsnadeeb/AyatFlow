import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from "expo-audio";
import * as Speech from "expo-speech";
import * as FileSystem from "expo-file-system/legacy";
import { getSurah, Ayah, Surah } from "../api";
import { TafsirLanguage } from "../tafsirService";
import {
  getAudioPrefs,
  getLastPosition,
  getSurahProgress,
  saveAudioPrefs,
  saveLastPosition,
  saveSurahProgress,
  AudioPrefs,
  LastPosition,
} from "../storage";
import { getDownloadManager } from "../downloadManager";
import {
  saveAyahDataForWidget,
  saveLastPositionForWidget,
  setAudioPrefsForWidget,
  setWidgetPlayingState,
} from "../widget/widgetManager";

// NOTE: AudioPrefs (in ../storage) needs a `tafsir: boolean` field added
// alongside `arabic`/`english`, and its default/saved shape updated to
// include it. Everything below assumes that field exists.

export type PlaybackStage = "idle" | "arabic" | "english" | "tafsir";

export type PlaybackState = {
  flow: { surah: Surah; ayahs: Ayah[] } | null;
  index: number;
  stage: PlaybackStage;
  playing: boolean;
  speed: number;
  audioPrefs: AudioPrefs;
  last: LastPosition | null;
  progress: Record<number, number>;
};

export type PlaybackListener = (state: PlaybackState) => void;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Splits text into chunks of at most `maxChars` without cutting words in half.
 *  Android's TextToSpeech truncates any single utterance past ~4000 chars, so
 *  long commentaries must be read in pieces. */
function chunkText(text: string, maxChars: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let remaining = clean;
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf(" ", maxChars);
    if (cut < maxChars * 0.5) cut = maxChars; // one huge word — hard cut
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function waitForCondition(condition: () => boolean, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return true;
    await sleep(100);
  }
  return condition();
}

/**
 * Singleton playback engine shared by the app UI and the headless widget task.
 * Exactly one AudioPlayer exists for the whole process, so playback state is
 * consistent no matter whether the app is foregrounded, backgrounded, or dead.
 */
class PlaybackController {
  readonly player: AudioPlayer = createAudioPlayer(null, {
    updateInterval: 250,
    downloadFirst: false,
  });

  private state: PlaybackState = {
    flow: null,
    index: 0,
    stage: "idle",
    playing: false,
    speed: 1,
    audioPrefs: { arabic: true, english: true, tafsir: false },
    last: null,
    progress: {},
  };

  private listeners = new Set<PlaybackListener>();

  /** Optional UI hook; the headless task leaves this as a no-op. */
  alertHandler: (title: string, message: string) => void = () => {};

  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private sessionRef = 0;
  private advancingRef = false;
  private englishTimer: ReturnType<typeof setInterval> | null = null;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  private readingTimer: ReturnType<typeof setTimeout> | null = null;
  private arabicStartedRef = false;
  private englishStartedRef = false;
  private lastDidJustFinish = false;

  // Tafsir text for the *current* ayah, supplied by the UI (FlowScreen) as
  // the reader opens/closes the commentary drawer or switches language.
  // The controller doesn't fetch tafsir itself — it just reads whatever the
  // UI hands it, so the drawer's visible content and the spoken content
  // never drift apart.
  private currentTafsirText: string | null = null;
  private currentTafsirLanguage: TafsirLanguage = "urdu";

  constructor() {
    this.player.addListener("playbackStatusUpdate", (status) => {
      const justFinished = status.didJustFinish;
      if (justFinished && !this.lastDidJustFinish) {
        this.lastDidJustFinish = true;
        if (!this.state.playing) return;
        const s = this.state.stage;
        if (s === "arabic" && this.arabicStartedRef) {
          this.startEnglish();
        } else if (s === "english" && this.englishStartedRef) {
          this.startTafsir();
        }
      } else if (!justFinished) {
        this.lastDidJustFinish = false;
      }
    });
  }

  getState(): PlaybackState {
    return this.state;
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isPlaying(): boolean {
    return this.state.playing;
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: "doNotMix",
      });
      const [savedLast, savedProgress, savedAudioPrefs] = await Promise.all([
        getLastPosition(),
        getSurahProgress(),
        getAudioPrefs(),
      ]);
      this.state.last = savedLast;
      this.state.progress = savedProgress;
      this.state.audioPrefs = savedAudioPrefs;
      this.initialized = true;
      setAudioPrefsForWidget(savedAudioPrefs.arabic, savedAudioPrefs.english);
      this.emit();
    })();
    return this.initPromise;
  }

  /**
   * Replace the current flow with a freshly loaded surah. Stops any active
   * playback and resets the stage.
   */
  loadSurah(data: { surah: Surah; ayahs: Ayah[] }, resumeIndex = 0) {
    this.state.flow = data;
    this.state.index = Math.min(resumeIndex, data.ayahs.length - 1);
    this.state.stage = "idle";
    this.state.playing = false;
    this.advancingRef = false;
    this.sessionRef++;
    this.currentTafsirText = null;
    this.clearStageState();
    this.clearReadingTimer();
    this.player.pause();
    Speech.stop();
    this.updateLockScreen();
    this.emit();
  }

  async ensureFlowLoaded(): Promise<boolean> {
    await this.ensureInitialized();
    if (this.state.flow) return true;
    const pos = this.state.last ?? (await getLastPosition());
    if (!pos) return false;
    try {
      const data = await getSurah(pos.surah);
      this.loadSurah(data, pos.ayahIndex);
      return true;
    } catch (error) {
      console.error("Failed to load surah for playback:", error);
      this.alertHandler("Ayat Flow", "Could not load this Surah. Please check your connection.");
      return false;
    }
  }

  /** Start playback from the last saved position (resume). */
  async ensurePlayback(): Promise<boolean> {
    const loaded = await this.ensureFlowLoaded();
    if (!loaded) return false;
    this.startFlow();
    return this.state.playing;
  }

  /**
   * Handle a command delivered from the home screen widget.
   */
  async handleWidgetAction(action: string | undefined) {
    await this.ensureInitialized();
    if (action === "playPause") {
      if (this.state.playing) {
        this.stopAll();
      } else {
        if (await this.ensureFlowLoaded()) this.startFlow();
      }
    } else if (action === "next") {
      if (this.state.flow && this.state.playing) {
        this.skip();
      } else {
        if (await this.ensureFlowLoaded()) {
          this.startFlow();
          this.skip();
        }
      }
    } else if (action === "previous") {
      if (this.state.flow && this.state.playing) {
        this.previous();
      } else {
        if (await this.ensureFlowLoaded()) {
          this.startFlow();
          this.previous();
        }
      }
    } else if (action === "toggleArabic") {
      this.toggleAudio("arabic");
    } else if (action === "toggleEnglish") {
      this.toggleAudio("english");
    }
  }

  // ---- Playback engine (moved from App.tsx) ----

  private clearStageState() {
    this.arabicStartedRef = false;
    this.englishStartedRef = false;
    if (this.englishTimer) {
      clearInterval(this.englishTimer);
      this.englishTimer = null;
    }
  }

  private clearReadingTimer() {
    if (this.readingTimer) {
      clearTimeout(this.readingTimer);
      this.readingTimer = null;
    }
  }

  private savePosition() {
    const data = this.state.flow;
    if (!data) return;
    const ayahIndex = this.state.index;
    saveLastPosition({ surah: data.surah.number, ayahIndex });
    saveSurahProgress(data.surah.number, ayahIndex);
    this.state.last = { surah: data.surah.number, ayahIndex };
    this.state.progress = { ...this.state.progress, [data.surah.number]: ayahIndex };
    saveLastPositionForWidget(data.surah.number, ayahIndex);
    const ayah = data.ayahs[ayahIndex];
    if (ayah && ayah.text && ayah.translation) {
      saveAyahDataForWidget(
        data.surah.name || "",
        ayah.number.toString() || "",
        ayah.text || "",
        ayah.translation || "",
        data.surah.numberOfAyahs || 0,
        ayahIndex
      );
    }
    this.updateLockScreen();
    this.emit();
  }

  private updateLockScreen() {
    const data = this.state.flow;
    if (!data) return;
    const ayah = data.ayahs[this.state.index];
    const title = ayah
      ? `${data.surah.name} — Ayat ${ayah.number}`
      : data.surah.name;
    this.player.updateLockScreenMetadata({ title });
  }

  private setLockScreenActive(active: boolean) {
    try {
      if (active) {
        const data = this.state.flow;
        const ayah = data?.ayahs[this.state.index];
        this.player.setActiveForLockScreen(true, {
          title: ayah
            ? `${data?.surah.name} — Ayat ${ayah.number}`
            : data?.surah.name ?? "Ayat Flow",
          artist: "Ayat Flow",
        });
      } else {
        this.player.setActiveForLockScreen(false);
      }
    } catch (error) {
      console.error("Failed to update lock screen controls:", error);
    }
  }

  stopAll() {
    this.sessionRef++;
    this.player.pause();
    Speech.stop();
    this.advancingRef = false;
    this.state.playing = false;
    this.state.stage = "idle";
    this.clearReadingTimer();
    this.clearStageState();
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
    this.setLockScreenActive(false);
    setWidgetPlayingState(false);
    this.emit();
  }

  private async startArabic() {
    const session = ++this.sessionRef;
    const data = this.state.flow;
    const ayah = data?.ayahs[this.state.index];
    if (!data || !ayah) return;

    // Clean up any existing audio playback
    this.player.pause();
    Speech.stop();
    this.advancingRef = false;
    this.clearReadingTimer();
    this.clearStageState();
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }

    // Set stage and playing state
    this.state.stage = "arabic";
    this.state.playing = true;
    setWidgetPlayingState(true);
    this.emit();

    // Check if both audio types are disabled
    if (!this.state.audioPrefs.arabic && !this.state.audioPrefs.english) {
      this.alertHandler("Audio Disabled", "Please enable at least one audio option in settings.");
      this.stopAll();
      return;
    }

    // Check if Arabic audio is enabled
    if (!this.state.audioPrefs.arabic) {
      // Immediately start English without waiting
      this.startEnglish();
      return;
    }

    if (!ayah.audio) {
      this.alertHandler("Audio unavailable", "This ayah does not have an audio URL.");
      this.state.playing = false;
      this.state.stage = "idle";
      setWidgetPlayingState(false);
      this.emit();
      return;
    }

    // Check for local audio file first
    const downloadManager = getDownloadManager();
    let localAudioPath: string | null = null;
    try {
      localAudioPath = await downloadManager.getLocalAudioPath(
        data.surah.number,
        ayah.number,
        "arabic"
      );
    } catch {}
    if (session !== this.sessionRef) return;

    const audioSource = localAudioPath || ayah.audio;

    try {
      this.player.replace(audioSource);
      this.player.setPlaybackRate(this.state.speed);
      this.setLockScreenActive(true);
      this.player.play();

      // Wait until the player has actually loaded the Arabic source before
      // marking the stage as started. Without this, the stale didJustFinish
      // flag from the previous English segment could skip the Arabic.
      const loaded = await waitForCondition(
        () => this.player.isLoaded || this.player.playing,
        10000
      );
      if (session !== this.sessionRef) return;
      if (!loaded) throw new Error("Arabic audio did not load");

      this.arabicStartedRef = true;
      this.startPositionMonitoring();
    } catch (error) {
      console.error("Failed to play Arabic audio:", error);
      if (session !== this.sessionRef) return;
      this.alertHandler("Audio Error", "Could not play Arabic audio. Skipping to English.");
      this.startEnglish();
    }
  }

  private async startEnglish() {
    const session = ++this.sessionRef;
    const ayah = this.state.flow?.ayahs[this.state.index];
    if (!ayah) return;

    // Clean up existing audio
    this.player.pause();
    Speech.stop();
    this.clearStageState();
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }

    this.state.stage = "english";
    this.emit();

    // Check if English audio is enabled
    if (!this.state.audioPrefs.english) {
      // Immediately move on — tafsir (if applicable) or the next ayah
      this.startTafsir();
      return;
    }

    // Check for local audio file first
    const downloadManager = getDownloadManager();
    let audioSource: string | null = null;
    try {
      const localAudioPath = await downloadManager.getLocalAudioPath(
        this.state.flow?.surah.number || 0,
        ayah.number,
        "english"
      );
      if (session !== this.sessionRef) return;

      if (localAudioPath) {
        const fileInfo = await FileSystem.getInfoAsync(localAudioPath);
        if (session !== this.sessionRef) return;
        if (fileInfo.exists && fileInfo.size > 0) {
          audioSource = localAudioPath;
          console.log("[English Audio] Using local file:", localAudioPath);
        }
      }
    } catch (error) {
      console.warn("[English Audio] Failed to check local file:", error);
    }

    if (!audioSource) {
      // Use englishAudio URL if available
      audioSource =
        ayah.englishAudio && ayah.englishAudio.trim() !== "" ? ayah.englishAudio : null;
      if (audioSource) {
        console.log("[English Audio] Using remote URL:", audioSource);
      } else {
        console.log("[English Audio] No audio source available");
      }
    }
    if (session !== this.sessionRef) return;

    if (audioSource) {
      try {
        this.player.replace(audioSource);
        this.player.setPlaybackRate(this.state.speed);
        this.setLockScreenActive(true);
        this.player.play();

        const loaded = await waitForCondition(
          () => this.player.isLoaded || this.player.playing,
          10000
        );
        if (session !== this.sessionRef) return;
        if (!loaded) throw new Error("English audio did not load");

        this.englishStartedRef = true;
        this.startPositionMonitoring();
      } catch (error) {
        console.error("[English Audio] Failed to play:", error);
        if (session !== this.sessionRef) return;
        // Fall back to text-to-speech if audio fails
        console.log("[English Audio] Falling back to TTS");
        this.fallbackToTextToSpeech(ayah);
      }
    } else {
      // Fall back to text-to-speech if no audio file
      console.log("[English Audio] No audio source, using TTS");
      this.fallbackToTextToSpeech(ayah);
    }
  }

  /**
   * Speak the tafsir for the current ayah via the phone's native TTS voice,
   * using the same play/pause/speed controls as everything else. Only runs
   * when the tafsir read-aloud preference is on — otherwise it's a no-op and
   * we advance immediately, exactly like before this feature existed.
   */
  private async startTafsir() {
    const session = ++this.sessionRef;

    this.player.pause();
    Speech.stop();
    this.clearStageState();
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }

    this.state.stage = "tafsir";
    this.emit();

    if (!this.state.audioPrefs.tafsir) {
      console.log("[Tafsir TTS] Tafsir audio pref is disabled, skipping");
      this.advance();
      return;
    }

    // The UI feeds the current ayah's tafsir text asynchronously (it may still
    // be loading from the network/cache when we get here). Give it a moment
    // before giving up, so reading continues ayah after ayah even when the
    // commentary drawer is closed.
    console.log("[Tafsir TTS] Waiting for tafsir text...");
    const text = await this.waitForTafsirText(session);
    if (session !== this.sessionRef) return;
    if (!text) {
      console.log("[Tafsir TTS] No tafsir text available, advancing");
      this.advance();
      return;
    }

    console.log(`[Tafsir TTS] Got tafsir text (${text.length} chars), starting speech`);
    this.speakTafsirText(text, session);
  }

  /** Polls for the current ayah's tafsir text for up to a few seconds. */
  private async waitForTafsirText(session: number): Promise<string | null> {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      if (this.currentTafsirText) return this.currentTafsirText;
      await sleep(150);
      if (session !== this.sessionRef) return null;
    }
    return this.currentTafsirText;
  }

  /**
   * Reads the tafsir aloud. Android's TextToSpeech truncates any single
   * utterance past ~4000 chars, so long commentaries are split into chunks and
   * read one after another. A watchdog estimates how long speech should take so
   * the flow always advances even if the engine never fires its callbacks
   * (missing voice, engine bug, silent failure).
   */
  private speakTafsirText(text: string, session: number) {
    const language = this.currentTafsirLanguage === "urdu" ? "ur-PK" : "en-US";
    const chunks = chunkText(text, 3600);
    let chunkIndex = 0;

    console.log(`[Tafsir TTS] Starting speech for ${chunks.length} chunks in language ${language}`);

    const finish = () => {
      this.clearReadingTimer();
      if (session !== this.sessionRef) return;
      console.log("[Tafsir TTS] Finished all chunks");
      if (this.state.playing) this.advance();
    };

    const speakNextChunk = () => {
      if (session !== this.sessionRef) return;
      if (chunkIndex >= chunks.length) {
        finish();
        return;
      }
      const chunk = chunks[chunkIndex++];
      console.log(`[Tafsir TTS] Speaking chunk ${chunkIndex}/${chunks.length}, length: ${chunk.length}`);

      // Rough speech-time estimate (~110ms per char at 1×, slower in Urdu) plus
      // a generous floor for engine startup. advance() is idempotent, so a late
      // onDone can never double-advance.
      this.clearReadingTimer();
      this.readingTimer = setTimeout(() => {
        if (session !== this.sessionRef) return;
        console.warn("[Tafsir TTS] Watchdog timeout - advancing anyway");
        finish();
      }, Math.max(6000, chunk.length * 110));

      Speech.speak(chunk, {
        language,
        rate: Math.max(0.5, Math.min(1.0, 0.58 * this.state.speed)),
        pitch: 1,
        onDone: () => {
          if (session !== this.sessionRef) return;
          console.log(`[Tafsir TTS] Chunk ${chunkIndex} completed`);
          speakNextChunk();
        },
        onStopped: () => {
          // Tafsir speech stopped (skip/prev/pause/panel closed mid-read) — a
          // new start* call already bumped sessionRef, so nothing to do here.
          console.log("[Tafsir TTS] Speech stopped");
        },
        onError: (error) => {
          console.error("[Tafsir TTS] Speech error:", error);
          if (session !== this.sessionRef) return;
          // Skip the failed chunk rather than stalling the whole flow.
          speakNextChunk();
        },
      });
    };

    speakNextChunk();
  }

  private startPositionMonitoring() {
    // Clear any existing monitoring
    if (this.englishTimer) {
      clearInterval(this.englishTimer);
      this.englishTimer = null;
    }

    // Monitor position progress every 250ms as a backup to didJustFinish.
    this.englishTimer = setInterval(() => {
      if (!this.state.playing) return;

      const s = this.state.stage;
      const started =
        s === "arabic" ? this.arabicStartedRef : s === "english" ? this.englishStartedRef : false;
      if (s === "idle" || s === "tafsir" || !started) return;

      const duration = this.player.duration;
      const currentTime = this.player.currentTime;

      const nearEnd = Number.isFinite(duration) && duration > 0 && currentTime >= duration - 0.2;
      const stoppedEarly =
        this.player.isLoaded && !this.player.playing && !this.player.isBuffering && currentTime > 0.05;

      if (nearEnd || stoppedEarly) {
        if (this.englishTimer) {
          clearInterval(this.englishTimer);
          this.englishTimer = null;
        }
        if (s === "arabic") this.startEnglish();
        else this.startTafsir();
      }
    }, 250);
  }

  private fallbackToTextToSpeech(ayah: Ayah) {
    Speech.speak(ayah.translation, {
      language: "en-US",
      rate: Math.min(1.0, 0.62 * this.state.speed),
      pitch: 1,
      onDone: () => {
        if (this.state.playing) {
          this.startTafsir();
        }
      },
      onStopped: () => {
        // Text-to-speech stopped
      },
      onError: (error) => {
        console.error("Text-to-speech error:", error);
        if (this.state.playing) {
          this.startTafsir();
        }
      },
    });
  }

  startFlow() {
    if (!this.state.flow) return;
    this.state.playing = true;
    // Save current position when starting playback
    this.savePosition();
    this.startArabic();
  }

  advance() {
    const data = this.state.flow;
    if (!data || this.advancingRef) return;

    this.advancingRef = true;
    this.sessionRef++;

    const current = this.state.index;
    if (current >= data.ayahs.length - 1) {
      this.stopAll();
      this.savePosition();
      return;
    }

    const next = current + 1;
    this.state.index = next;
    this.savePosition();

    // Clear any existing transition timer and stage state
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
    this.clearStageState();

    // Small delay before starting next ayah to ensure clean transition
    this.transitionTimer = setTimeout(() => {
      this.advancingRef = false;
      if (this.state.playing) {
        this.startArabic();
      }
    }, 300);
  }

  skip() {
    if (!this.state.flow) return;
    Speech.stop();
    this.player.pause();
    this.advance();
  }

  previous() {
    const data = this.state.flow;
    if (!data) return;
    this.stopAll();
    const next = Math.max(0, this.state.index - 1);
    this.state.index = next;
    this.savePosition();
  }

  /**
   * Jump to a specific ayah (0-based index). Stops playback and saves
   * the position so it survives restarts and widget resumption.
   */
  jumpTo(index: number) {
    const data = this.state.flow;
    if (!data) return;
    const clamped = Math.max(0, Math.min(index, data.ayahs.length - 1));
    this.stopAll();
    this.state.index = clamped;
    this.savePosition();
  }

  repeat() {
    this.stopAll();
    setTimeout(() => {
      this.startArabic();
    }, 100);
  }

  changeSpeed(next: number) {
    this.state.speed = next;
    if (this.state.stage === "arabic" || this.state.stage === "english") {
      this.player.setPlaybackRate(next);
    }
    // Tafsir speech rate takes effect the next time it starts speaking —
    // expo-speech doesn't support changing rate mid-utterance.
    this.emit();
  }

  toggleAudio(stage: "arabic" | "english" | "tafsir") {
    const prev = this.state.audioPrefs;
    const next: AudioPrefs =
      stage === "arabic"
        ? { ...prev, arabic: !prev.arabic }
        : stage === "english"
          ? { ...prev, english: !prev.english }
          : { ...prev, tafsir: !prev.tafsir };
    this.state.audioPrefs = next;
    saveAudioPrefs(next);
    setAudioPrefsForWidget(next.arabic, next.english);
    if (this.state.playing && this.state.stage === stage) {
      if (stage === "arabic") this.startArabic();
      else if (stage === "english") this.startEnglish();
      else this.startTafsir();
    }
    this.emit();
  }

  /**
   * Called by the UI whenever the tafsir drawer's visible content changes —
   * opened, closed, finished loading, or the Urdu/English tab switched.
   * Pass `null` when there's nothing valid to read (drawer closed, still
   * loading, or fetch failed) so playback never speaks stale or absent text.
   */
  setTafsirContent(text: string | null, language: TafsirLanguage) {
    this.currentTafsirText = text;
    this.currentTafsirLanguage = language;
    if (this.state.stage === "tafsir" && !text) {
      // Drawer was closed (or content cleared) while it was being read aloud.
      Speech.stop();
      if (this.state.playing) this.advance();
    }
  }
}

export const playbackController = new PlaybackController();