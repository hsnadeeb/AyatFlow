import { sharedStorage, ensureSharedStoragePermission } from "./sharedStorage";
import {
  getAyahBookmarks,
  getAudioPrefs,
  getLastPosition,
  getSurahBookmarks,
  getSurahProgress,
  saveAudioPrefs,
  saveLastPosition,
  saveSurahProgressMap,
  setAyahBookmarks,
  setSurahBookmarks,
  clearLastPosition,
  AudioPrefs,
  LastPosition,
} from "./storage";

const BACKUP_VERSION = 1;
const SAVE_DEBOUNCE_MS = 1500;

type BackupData = {
  version: number;
  savedAt: number;
  ayahBookmarks: string[];
  surahBookmarks: number[];
  last: LastPosition | null;
  progress: Record<number, number>;
  audioPrefs: AudioPrefs;
};

const module = sharedStorage;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function collectBackupData(): Promise<BackupData> {
  const [ayahBookmarks, surahBookmarks, last, progress, audioPrefs] = await Promise.all([
    getAyahBookmarks(),
    getSurahBookmarks(),
    getLastPosition(),
    getSurahProgress(),
    getAudioPrefs(),
  ]);
  return {
    version: BACKUP_VERSION,
    savedAt: Date.now(),
    ayahBookmarks,
    surahBookmarks,
    last,
    progress,
    audioPrefs,
  };
}

/** Write the backup JSON to shared storage (Android only, silently ignored elsewhere). */
export async function saveBackup(): Promise<void> {
  if (!module) return;
  if (!(await ensureSharedStoragePermission())) return;
  try {
    const data = await collectBackupData();
    await module.saveBackup(JSON.stringify(data));
  } catch (error) {
    console.warn("Failed to save backup:", error);
  }
}

/** Debounced save so rapid state changes (e.g. playback progress) batch into one write. */
export function scheduleBackupSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveBackup();
  }, SAVE_DEBOUNCE_MS);
}

/**
 * "Reinstall sync": called once at startup.
 *
 * - If the app's local storage is empty (fresh install or cleared data) and a
 *   backup file exists in shared storage, restore it into AsyncStorage.
 * - Otherwise refresh the backup file with the current local data.
 *
 * Returns true when a restore happened.
 */
export async function syncBackup(): Promise<boolean> {
  if (!module) return false;
  if (!(await ensureSharedStoragePermission())) return false;

  let raw: string | null = null;
  try {
    raw = await module.loadBackup();
  } catch (error) {
    console.warn("Failed to read backup:", error);
    return false;
  }
  if (!raw) return false;

  let backup: BackupData;
  try {
    backup = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!backup || backup.version !== BACKUP_VERSION) return false;

  const [ayahBookmarks, surahBookmarks, last, progress] = await Promise.all([
    getAyahBookmarks(),
    getSurahBookmarks(),
    getLastPosition(),
    getSurahProgress(),
  ]);

  const isEmpty =
    ayahBookmarks.length === 0 &&
    surahBookmarks.length === 0 &&
    !last &&
    Object.keys(progress).length === 0;

  if (!isEmpty) {
    // Existing install: keep local data, just refresh the backup copy.
    scheduleBackupSave();
    return false;
  }

  await Promise.all([
    setAyahBookmarks(Array.isArray(backup.ayahBookmarks) ? backup.ayahBookmarks : []),
    setSurahBookmarks(Array.isArray(backup.surahBookmarks) ? backup.surahBookmarks : []),
    backup.last
      ? saveLastPosition(backup.last)
      : clearLastPosition(),
    saveSurahProgressMap(
      backup.progress && typeof backup.progress === "object" ? backup.progress : {}
    ),
    backup.audioPrefs
      ? saveAudioPrefs(backup.audioPrefs)
      : Promise.resolve(),
  ]);

  return true;
}
