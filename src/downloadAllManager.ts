import { Surah, Ayah, getSurah } from "./api";
import { getDownloadManager } from "./downloadManager";
import { getSurahTafsir } from "./tafsirService";

/**
 * Whole-Quran download orchestrator. Walks the surahs one by one; for each
 * one it downloads the recitation + meaning audio (reusing DownloadManager's
 * per-surah batch, which skips files already on disk and caps concurrency)
 * and then the Urdu + English tafsir text (which self-caches via
 * tafsirService). Everything reports back through a single subscription, so
 * the UI can draw one live, always-current picture of the whole run.
 *
 * Runs are resumable by design: re-starting simply re-walks the surahs and
 * every already-downloaded piece resolves instantly.
 */

export type SurahLiveAudio = {
  arabicProgress: number;
  englishProgress: number;
  arabicCount: number;
  englishCount: number;
  downloadedCount: number;
  totalProgress: number;
};

export type DownloadAllStage = "audio" | "tafsir-urdu" | "tafsir-english" | null;

export type DownloadAllStatus = {
  running: boolean;
  cancelled: boolean;
  /** Surah currently being processed, or null when idle/finished. */
  currentSurah: Surah | null;
  /** Live on-device audio state for the current surah. */
  currentAudio: SurahLiveAudio | null;
  currentStage: DownloadAllStage;
  totalSurahs: number;
  completedSurahs: number;
  /** Surahs whose data failed to load (rare — bundled data). */
  failedSurahs: number;
  /** Audio files finished this run (existing files count too). */
  audioDone: number;
  audioTotal: number;
  audioFailed: number;
  tafsirFetched: { urdu: number; english: number };
  tafsirTotal: number;
  tafsirFailed: number;
};

const initialStatus: DownloadAllStatus = {
  running: false,
  cancelled: false,
  currentSurah: null,
  currentAudio: null,
  currentStage: null,
  totalSurahs: 0,
  completedSurahs: 0,
  failedSurahs: 0,
  audioDone: 0,
  audioTotal: 0,
  audioFailed: 0,
  tafsirFetched: { urdu: 0, english: 0 },
  tafsirTotal: 0,
  tafsirFailed: 0,
};

/** Coalesce the current-surah audio bars — one update per ~400ms is plenty. */
const AUDIO_REFRESH_THROTTLE_MS = 400;

class DownloadAllManager {
  private status: DownloadAllStatus = initialStatus;
  private listeners = new Set<(status: DownloadAllStatus) => void>();
  private promise: Promise<void> | null = null;
  private cancelledFlag = false;
  private lastAudioRefreshAt = 0;

  getStatus(): DownloadAllStatus {
    return this.status;
  }

  isRunning(): boolean {
    return this.status.running;
  }

  subscribe(listener: (status: DownloadAllStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    const status = this.status;
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        console.warn("DownloadAll: listener error", error);
      }
    }
  }

  private update(patch: Partial<DownloadAllStatus>) {
    this.status = { ...this.status, ...patch };
    this.emit();
  }

  /** Starts (or resumes) a full download of audio + tafsir for every surah. */
  start(surahs: Surah[]): Promise<void> {
    if (this.promise) return this.promise;
    if (surahs.length === 0) return Promise.resolve();

    this.cancelledFlag = false;
    let audioTotal = 0;
    for (const surah of surahs) audioTotal += surah.numberOfAyahs * 2;

    this.status = {
      ...initialStatus,
      running: true,
      totalSurahs: surahs.length,
      audioTotal,
      tafsirTotal: surahs.length * 2,
    };
    this.emit();

    const downloadManager = getDownloadManager();

    this.promise = (async () => {
      for (const surah of surahs) {
        if (this.cancelledFlag) break;

        this.update({ currentSurah: surah, currentStage: "audio", currentAudio: null });

        let ayahs: Ayah[] = [];
        try {
          const data = await getSurah(surah.number);
          ayahs = data.ayahs;
        } catch (error) {
          console.error(`DownloadAll: failed to load Surah ${surah.number}`, error);
          this.update({ failedSurahs: this.status.failedSurahs + 1 });
          continue;
        }
        if (this.cancelledFlag) break;

        // Recitation + meaning audio (skips files already on device; shares an
        // in-flight batch if one is already running for this surah).
        try {
          const result = await downloadManager.downloadSurahAudio(surah.number, ayahs, () => {
            const now = Date.now();
            if (now - this.lastAudioRefreshAt < AUDIO_REFRESH_THROTTLE_MS) return;
            this.lastAudioRefreshAt = now;
            this.update({
              currentAudio: downloadManager.getSurahLiveStatus(
                surah.number,
                ayahs.length,
                ayahs[0]?.number
              ),
            });
          });
          this.update({
            audioDone: this.status.audioDone + result.succeeded,
            audioFailed: this.status.audioFailed + result.failed,
            currentAudio: downloadManager.getSurahLiveStatus(
              surah.number,
              ayahs.length,
              ayahs[0]?.number
            ),
          });
          if (result.failed > 0) {
            console.warn(`DownloadAll: ${result.failed} audio files failed for Surah ${surah.number}`);
          }
        } catch (error) {
          console.error(`DownloadAll: audio batch failed for Surah ${surah.number}`, error);
        }
        if (this.cancelledFlag) break;

        // Tafsir text — both languages, one whole-surah fetch each, self-cached.
        for (const lang of ["urdu", "english"] as const) {
          if (this.cancelledFlag) break;
          this.update({ currentStage: lang === "urdu" ? "tafsir-urdu" : "tafsir-english" });
          try {
            await getSurahTafsir(surah.number, lang);
            this.update({
              tafsirFetched: { ...this.status.tafsirFetched, [lang]: this.status.tafsirFetched[lang] + 1 },
            });
          } catch (error) {
            console.warn(`DownloadAll: tafsir (${lang}) failed for Surah ${surah.number}`, error);
            this.update({ tafsirFailed: this.status.tafsirFailed + 1 });
          }
        }
        if (this.cancelledFlag) break;

        this.update({ completedSurahs: this.status.completedSurahs + 1 });
      }

      this.promise = null;
      this.update({
        running: false,
        cancelled: this.cancelledFlag,
        currentSurah: null,
        currentStage: null,
        currentAudio: null,
      });
    })();

    return this.promise;
  }

  /** Stops after the current surah: in-flight files finish, queued ones skip. */
  cancel() {
    this.cancelledFlag = true;
    const current = this.status.currentSurah;
    if (current) {
      getDownloadManager().cancelSurahDownload(current.number);
    }
  }
}

export const downloadAllManager = new DownloadAllManager();
