import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  AudioModule,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
} from "expo-audio";
import * as Speech from "expo-speech";
import * as FileSystem from "expo-file-system/legacy";
import { getSurah, getSurahs, Ayah, Surah } from "./src/api";
import {
  getAudioPrefs,
  getBookmarks,
  getLastPosition,
  getSurahProgress,
  saveAudioPrefs,
  saveLastPosition,
  saveSurahProgress,
  toggleBookmark,
  AudioPrefs,
} from "./src/storage";
import HomeScreen from "./src/components/HomeScreen";
import FlowScreen from "./src/components/FlowScreen";
import DownloadManager from "./src/components/DownloadManager";
import SettingsScreen from "./src/components/SettingsScreen";
import BookmarksScreen from "./src/components/BookmarksScreen";
import { getDownloadManager, cleanupDownloadManager } from "./src/downloadManager";
import { ThemeProvider, useTheme } from "./src/theme";
import { saveLastPositionForWidget, initializeWidget } from "./src/widget/widgetManager";

type Screen = "home" | "flow" | "settings" | "bookmarks";

const GLOW_QUIET = 0.12;

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

function AppInner() {
  const { isDark, palette } = useTheme();
  const colors = palette;

  const [screen, setScreen] = useState<Screen>("home");
  const [surahs, setSurahs] = useState<Surah[]>([]);
  const [loading, setLoading] = useState(true);
  const [flowData, setFlowData] = useState<{ surah: Surah; ayahs: Ayah[] } | null>(null);
  const [index, setIndex] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [stage, setStage] = useState<"idle" | "arabic" | "english">("idle");
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [last, setLast] = useState<{ surah: number; ayahIndex: number } | null>(null);
  const [progress, setProgress] = useState<Record<number, number>>({});
  const [audioPrefs, setAudioPrefs] = useState<AudioPrefs>({ arabic: true, english: true });
  const [downloadManagerVisible, setDownloadManagerVisible] = useState(false);
  const [downloadManagerSurah, setDownloadManagerSurah] = useState<Surah | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingSurahs, setDownloadingSurahs] = useState<Set<number>>(new Set());
  const englishTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advancingRef = useRef(false);
  const playingRef = useRef(false);
  const stageRef = useRef<"idle" | "arabic" | "english">("idle");
  const permissionAsked = useRef(false);
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);
  const flowRef = useRef<{ surah: Surah; ayahs: Ayah[] } | null>(null);
  const indexRef = useRef(0);
  const speedRef = useRef(1);
  const audioPrefsRef = useRef(audioPrefs);
  const screenRef = useRef<Screen>("home");
  const sessionRef = useRef(0);
  const lastDidJustFinish = useRef(false);
  const arabicStartedRef = useRef(false);
  const englishStartedRef = useRef(false);
  const [samplingRetry, setSamplingRetry] = useState(0);

  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    flowRef.current = flowData;
  }, [flowData]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    audioPrefsRef.current = audioPrefs;
  }, [audioPrefs]);

  const player = useAudioPlayer(null, {
    updateInterval: 250,
    downloadFirst: false,
  });

  useEffect(() => {
    (async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: "doNotMix",
        });
        const [loadedSurahs, savedBookmarks, savedLast, savedProgress, savedAudioPrefs] =
          await Promise.all([
            getSurahs(),
            getBookmarks(),
            getLastPosition(),
            getSurahProgress(),
            getAudioPrefs(),
          ]);
        setSurahs(loadedSurahs);
        setBookmarks(savedBookmarks);
        setLast(savedLast);
        setProgress(savedProgress);
        setAudioPrefs(savedAudioPrefs);
        
        // Initialize Android widget with current data
        initializeWidget();
      } catch (error) {
        Alert.alert("Ayat Flow", "Could not load Quran data. Please check your connection.");
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      if (englishTimer.current) {
        clearInterval(englishTimer.current);
        englishTimer.current = null;
      }
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
      clearReadingTimer();
      stopPulse();
      Speech.stop();
      arabicStartedRef.current = false;
      englishStartedRef.current = false;
      lastDidJustFinish.current = false;
      sessionRef.current++;
      cleanupDownloadManager();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Completion detection via player events. This replaces the per-250ms status
  // subscription, so the app no longer re-renders on every audio status tick.
  useEffect(() => {
    const subscription = player.addListener("playbackStatusUpdate", (status) => {
      const justFinished = status.didJustFinish;
      if (justFinished && !lastDidJustFinish.current) {
        lastDidJustFinish.current = true;
        if (!playingRef.current || screenRef.current !== "flow") return;
        const s = stageRef.current;
        if (s === "arabic" && arabicStartedRef.current) {
          startEnglish();
        } else if (s === "english" && englishStartedRef.current) {
          advance();
        }
      } else if (!justFinished) {
        lastDidJustFinish.current = false;
      }
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  const handleSample = React.useCallback((sample: { channels: { frames: number[] }[] }) => {
    if (stageRef.current === "idle") return;
    const frames = sample.channels[0]?.frames;
    if (!frames || frames.length === 0) return;
    let sum = 0;
    for (let i = 0; i < frames.length; i++) sum += frames[i] * frames[i];
    const rms = Math.sqrt(sum / frames.length);
    if (pulseRef.current) stopPulse();
    animateGlow(GLOW_QUIET + Math.min(1, rms * 2.4) * (1 - GLOW_QUIET), 90);
  }, []);

  useEffect(() => {
    if (!player.isAudioSamplingSupported) return;
    player.setAudioSamplingEnabled(true);
    const subscription = player.addListener("audioSampleUpdate", handleSample);
    return () => subscription.remove();
  }, [player.id, samplingRetry, player, handleSample]);

  const currentAyah = flowData?.ayahs[index];

  function stopPulse() {
    if (pulseRef.current) {
      pulseRef.current.stop();
      pulseRef.current = null;
    }
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForCondition(condition: () => boolean, timeoutMs: number) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (condition()) return true;
      await sleep(100);
    }
    return condition();
  }

  function clearStageState() {
    arabicStartedRef.current = false;
    englishStartedRef.current = false;
    if (englishTimer.current) {
      clearInterval(englishTimer.current);
      englishTimer.current = null;
    }
  }

  function clearReadingTimer() {
    if (readingTimer.current) {
      clearTimeout(readingTimer.current);
      readingTimer.current = null;
    }
  }

  function saveFlowPosition(surah: number, ayahIndex: number) {
    saveLastPosition({ surah, ayahIndex });
    setLast({ surah, ayahIndex });
    saveSurahProgress(surah, ayahIndex);
    setProgress((prev) => ({ ...prev, [surah]: ayahIndex }));
    saveLastPositionForWidget(surah, ayahIndex); // Update Android home screen widget
  }

  function animateGlow(target: number, duration: number) {
    glow.stopAnimation();
    Animated.timing(glow, { toValue: target, duration, useNativeDriver: false }).start();
  }

  function startPulseGlow() {
    stopPulse();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 620, useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0.32, duration: 620, useNativeDriver: false }),
      ])
    );
    pulseRef.current = loop;
    loop.start();
  }

  async function ensureSampling() {
    if (Platform.OS !== "android" || permissionAsked.current) return;
    permissionAsked.current = true;
    try {
      const { granted } = await AudioModule.getRecordingPermissionsAsync();
      if (!granted) {
        const res = await requestRecordingPermissionsAsync();
        if (res.granted) setSamplingRetry((n) => n + 1);
      }
    } catch (error) {}
  }

  async function startBackgroundDownload(surahNumber: number, ayahs: Ayah[]) {
    const downloadManager = getDownloadManager();

    // Check if surah is already downloaded
    const progress = await downloadManager.getSurahDownloadProgress(surahNumber, ayahs.length);
    if (progress >= 1) {
      return; // Already fully downloaded
    }

    // Start background download without blocking UI
    setDownloading(true);
    setDownloadingSurahs((prev) => new Set(prev).add(surahNumber));

    try {
      await downloadManager.downloadSurahAudio(surahNumber, ayahs);
    } catch (error) {
      // Don't show error to user since this is background
    } finally {
      setDownloading(false);
      setDownloadingSurahs((prev) => {
        const next = new Set(prev);
        next.delete(surahNumber);
        return next;
      });
    }
  }

  function stopAll() {
    sessionRef.current++;
    player.pause();
    Speech.stop();
    advancingRef.current = false;
    playingRef.current = false;
    setPlaying(false);
    setStage("idle");
    stopPulse();
    glow.setValue(0);
    clearReadingTimer();
    clearStageState();
    if (transitionTimer.current) {
      clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
    }
  }

  async function startArabic() {
    const session = ++sessionRef.current;
    const data = flowRef.current;
    const ayah = data?.ayahs[indexRef.current];
    if (!data || !ayah || screenRef.current !== "flow") return;

    // Clean up any existing audio playback
    player.pause();
    Speech.stop();
    advancingRef.current = false;
    clearReadingTimer();
    stopPulse();
    glow.setValue(0);
    clearStageState();
    if (transitionTimer.current) {
      clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
    }

    // Set stage and playing state
    setStage("arabic");
    setPlaying(true);
    playingRef.current = true;

    // Check if both audio types are disabled
    if (!audioPrefsRef.current.arabic && !audioPrefsRef.current.english) {
      Alert.alert("Audio Disabled", "Please enable at least one audio option in settings.");
      stopAll();
      return;
    }

    // Check if Arabic audio is enabled
    if (!audioPrefsRef.current.arabic) {
      // Immediately start English without waiting
      startEnglish();
      return;
    }

    if (!ayah.audio) {
      Alert.alert("Audio unavailable", "This ayah does not have an audio URL.");
      setPlaying(false);
      playingRef.current = false;
      setStage("idle");
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
    if (session !== sessionRef.current) return;

    const audioSource = localAudioPath || ayah.audio;

    try {
      ensureSampling();
      startPulseGlow();
      player.replace(audioSource);
      player.setPlaybackRate(speedRef.current);
      player.play();

      // Wait until the player has actually loaded the Arabic source before
      // marking the stage as started. Without this, the stale didJustFinish
      // flag from the previous English segment could skip the Arabic.
      const loaded = await waitForCondition(() => player.isLoaded || player.playing, 10000);
      if (session !== sessionRef.current) return;
      if (!loaded) throw new Error("Arabic audio did not load");

      arabicStartedRef.current = true;
      startPositionMonitoring();
    } catch (error) {
      console.error("Failed to play Arabic audio:", error);
      if (session !== sessionRef.current) return;
      Alert.alert("Audio Error", "Could not play Arabic audio. Skipping to English.");
      startEnglish();
    }
  }

  async function startEnglish() {
    const session = ++sessionRef.current;
    const ayah = flowRef.current?.ayahs[indexRef.current];
    if (!ayah || screenRef.current !== "flow") return;

    // Clean up existing audio
    player.pause();
    Speech.stop();
    clearStageState();
    if (transitionTimer.current) {
      clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
    }

    setStage("english");
    startPulseGlow();

    // Check if English audio is enabled
    if (!audioPrefsRef.current.english) {
      // Immediately advance to next ayah without waiting
      advance();
      return;
    }

    // Check for local audio file first
    const downloadManager = getDownloadManager();
    let audioSource: string | null = null;
    try {
      const localAudioPath = await downloadManager.getLocalAudioPath(
        flowRef.current?.surah.number || 0,
        ayah.number,
        "english"
      );
      if (session !== sessionRef.current) return;

      if (localAudioPath) {
        const fileInfo = await FileSystem.getInfoAsync(localAudioPath);
        if (session !== sessionRef.current) return;
        if (fileInfo.exists && fileInfo.size > 0) {
          audioSource = localAudioPath;
        }
      }
    } catch {}

    if (!audioSource) {
      // Use englishAudio URL if available
      audioSource =
        ayah.englishAudio && ayah.englishAudio.trim() !== "" ? ayah.englishAudio : null;
    }
    if (session !== sessionRef.current) return;

    if (audioSource) {
      try {
        player.replace(audioSource);
        player.setPlaybackRate(speedRef.current);
        player.play();

        const loaded = await waitForCondition(() => player.isLoaded || player.playing, 10000);
        if (session !== sessionRef.current) return;
        if (!loaded) throw new Error("English audio did not load");

        englishStartedRef.current = true;
        startPositionMonitoring();
      } catch (error) {
        console.error("Failed to play English audio:", error);
        if (session !== sessionRef.current) return;
        // Fall back to text-to-speech if audio fails
        fallbackToTextToSpeech(ayah);
      }
    } else {
      // Fall back to text-to-speech if no audio file
      fallbackToTextToSpeech(ayah);
    }
  }

  function startPositionMonitoring() {
    // Clear any existing monitoring
    if (englishTimer.current) {
      clearInterval(englishTimer.current);
      englishTimer.current = null;
    }

    // Monitor position progress every 250ms as a backup to didJustFinish.
    // Uses currentTime (expo-audio property; "position" does not exist).
    englishTimer.current = setInterval(() => {
      if (!playingRef.current) return;

      const s = stageRef.current;
      const started =
        s === "arabic" ? arabicStartedRef.current : englishStartedRef.current;
      if (s === "idle" || !started) return;

      const duration = player.duration;
      const currentTime = player.currentTime;

      const nearEnd = Number.isFinite(duration) && duration > 0 && currentTime >= duration - 0.2;
      const stoppedEarly =
        player.isLoaded && !player.playing && !player.isBuffering && currentTime > 0.05;

      if (nearEnd || stoppedEarly) {
        if (englishTimer.current) {
          clearInterval(englishTimer.current);
          englishTimer.current = null;
        }
        if (s === "arabic") startEnglish();
        else advance();
      }
    }, 250);
  }

  function fallbackToTextToSpeech(ayah: Ayah) {
    Speech.speak(ayah.translation, {
      language: "en-US",
      rate: Math.min(1.0, 0.62 * speedRef.current),
      pitch: 1,
      onDone: () => {
        if (playingRef.current) {
          advance();
        }
      },
      onStopped: () => {
        // Text-to-speech stopped
      },
      onError: (error) => {
        console.error("Text-to-speech error:", error);
        if (playingRef.current) {
          advance();
        }
      },
    });
  }

  function startFlow() {
    if (!flowRef.current) return;
    setPlaying(true);
    startArabic();
  }

  function advance() {
    const data = flowRef.current;
    if (!data || advancingRef.current) return;

    advancingRef.current = true;
    sessionRef.current++;

    const current = indexRef.current;
    if (current >= data.ayahs.length - 1) {
      stopAll();
      saveFlowPosition(data.surah.number, current);
      return;
    }

    const next = current + 1;
    setIndex(next);
    saveFlowPosition(data.surah.number, next);

    // Clear any existing transition timer and stage state
    if (transitionTimer.current) {
      clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
    }
    clearStageState();

    // Small delay before starting next ayah to ensure clean transition
    transitionTimer.current = setTimeout(() => {
      advancingRef.current = false;
      if (playingRef.current && screenRef.current === "flow") {
        startArabic();
      }
    }, 300);
  }

  function skip() {
    if (!flowRef.current) return;
    Speech.stop();
    player.pause();
    advance();
  }

  function previous() {
    const data = flowRef.current;
    if (!data) return;
    stopAll();
    const next = Math.max(0, indexRef.current - 1);
    setIndex(next);
    saveFlowPosition(data.surah.number, next);
  }

  function repeat() {
    stopAll();
    setTimeout(() => {
      startArabic();
    }, 100);
  }

  async function bookmarkCurrent() {
    const data = flowRef.current;
    const ayah = data?.ayahs[indexRef.current];
    if (!data || !ayah) return;
    const key = `${data.surah.number}:${ayah.numberInSurah}`;
    const next = await toggleBookmark(key);
    setBookmarks(next);
  }

  function changeSpeed(next: number) {
    setSpeed(next);
    if (stageRef.current === "arabic" || stageRef.current === "english") {
      player.setPlaybackRate(next);
    }
  }

  async function openSurah(number: number, resumeIndex = 0) {
    if (loading) return;
    setLoading(true);
    try {
      const data = await getSurah(number);
      setFlowData(data);
      setIndex(Math.min(resumeIndex, data.ayahs.length - 1));
      setStage("idle");
      setPlaying(false);
      advancingRef.current = false;
      stopPulse();
      glow.setValue(0);
      clearReadingTimer();
      sessionRef.current++;
      clearStageState();
      setDownloadManagerSurah(data.surah);
      setScreen("flow");

      // Start background downloading for this surah
      startBackgroundDownload(data.surah.number, data.ayahs);
    } catch {
      Alert.alert("Ayat Flow", "Could not load this Surah. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  function openDownloadManager(surahNumber: number) {
    const surah = surahs.find((s) => s.number === surahNumber);
    if (surah) {
      setDownloadManagerSurah(surah);
      setDownloadManagerVisible(true);
    }
  }

  function openFlowDownloadManager() {
    const data = flowRef.current;
    if (data) {
      setDownloadManagerSurah(data.surah);
      setDownloadManagerVisible(true);
    }
  }

  function closeDownloadManager() {
    setDownloadManagerVisible(false);
  }

  function toggleAudio(stage: "arabic" | "english") {
    const prev = audioPrefsRef.current;
    const next: AudioPrefs =
      stage === "arabic" ? { ...prev, arabic: !prev.arabic } : { ...prev, english: !prev.english };
    audioPrefsRef.current = next;
    setAudioPrefs(next);
    saveAudioPrefs(next);

    if (playingRef.current && stageRef.current === stage) {
      if (stage === "arabic") startArabic();
      else startEnglish();
    }
  }

  // ---- Memoized handlers for child components ----

  const onBack = useCallback(() => {
    stopAll();
    setScreen("home");
  }, []);

  const onOpenSettings = useCallback(() => {
    stopAll();
    setScreen("settings");
  }, []);

  const onOpenBookmarks = useCallback(() => {
    stopAll();
    setScreen("bookmarks");
  }, []);

  const onCloseSubScreen = useCallback(() => {
    setScreen("home");
  }, []);

  const onTogglePlay = useCallback(() => {
    if (playingRef.current) stopAll();
    else startFlow();
  }, []);

  const onPrevious = useCallback(() => {
    previous();
  }, []);

  const onNext = useCallback(() => {
    skip();
  }, []);

  const onRepeat = useCallback(() => {
    repeat();
  }, []);

  const onSpeed = useCallback((next: number) => {
    changeSpeed(next);
  }, []);

  const onBookmark = useCallback(() => {
    bookmarkCurrent();
  }, []);

  const onToggleAudio = useCallback((s: "arabic" | "english") => {
    toggleAudio(s);
  }, []);

  const onOpenFlowDownloadManager = useCallback(() => {
    openFlowDownloadManager();
  }, []);

  const onCloseDownloadManager = useCallback(() => {
    closeDownloadManager();
  }, []);

  const onDownloadComplete = useCallback(() => {
    // Audio data is read from the download manager on demand; nothing to refresh.
  }, []);

  const openSurahHandler = useCallback(
    (number: number, resumeIndex?: number) => {
      openSurah(number, resumeIndex ?? 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading]
  );

  if (loading && surahs.length === 0) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
          <StatusBar style={isDark ? "light" : "dark"} />
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.muted, { color: colors.muted }]}>Loading the Qur'an…</Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (screen === "home") {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
          <StatusBar style={isDark ? "light" : "dark"} />
          <HomeScreen
            surahs={surahs}
            last={last}
            progress={progress}
            downloadingSurahs={downloadingSurahs}
            bookmarksCount={bookmarks.length}
            onOpenSurah={openSurahHandler}
            onOpenSettings={onOpenSettings}
            onOpenBookmarks={onOpenBookmarks}
            onWidgetPress={() => last && openSurahHandler(last.surah, last.ayahIndex)}
          />
          {loading && (
            <View style={styles.loadingOverlay}>
              <View style={[styles.loadingCard, { backgroundColor: colors.surface }]}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={[styles.loadingText, { color: colors.inkSoft }]}>
                  Opening Surah…
                </Text>
              </View>
            </View>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (screen === "settings") {
    return (
      <SafeAreaProvider>
        <SafeAreaView
          style={[styles.container, { backgroundColor: colors.bg }]}
          edges={["bottom"]}
        >
          <StatusBar style={isDark ? "light" : "dark"} />
          <SettingsScreen
            audioPrefs={audioPrefs}
            onToggleAudio={onToggleAudio}
            onClose={onCloseSubScreen}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (screen === "bookmarks") {
    return (
      <SafeAreaProvider>
        <SafeAreaView
          style={[styles.container, { backgroundColor: colors.bg }]}
          edges={["bottom"]}
        >
          <StatusBar style={isDark ? "light" : "dark"} />
          <BookmarksScreen
            bookmarks={bookmarks}
            surahs={surahs}
            onOpenSurah={openSurahHandler}
            onClose={onCloseSubScreen}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!flowData || !currentAyah) return null;

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.bg }]}
        edges={["bottom"]}
      >
        <StatusBar style={isDark ? "light" : "dark"} />
        <FlowScreen
          surah={flowData.surah}
          ayahs={flowData.ayahs}
          index={index}
          stage={stage}
          playing={playing}
          speed={speed}
          bookmarks={bookmarks}
          audioPrefs={audioPrefs}
          glow={glow}
          downloading={downloading}
          onBack={onBack}
          onTogglePlay={onTogglePlay}
          onPrevious={onPrevious}
          onNext={onNext}
          onRepeat={onRepeat}
          onSpeed={onSpeed}
          onBookmark={onBookmark}
          onToggleAudio={onToggleAudio}
          onOpenDownloadManager={onOpenFlowDownloadManager}
        />
        <DownloadManager
          visible={downloadManagerVisible}
          surah={downloadManagerSurah}
          ayahs={flowData?.ayahs || []}
          onClose={onCloseDownloadManager}
          onDownloadComplete={onDownloadComplete}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  muted: {
    fontSize: 13,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.28)",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingCard: {
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
