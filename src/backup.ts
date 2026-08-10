import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
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
const BACKUP_FILE_NAME = "ayah-flow-backup.json";
const SAF_FOLDER_KEY = "ayah-flow:saf-backup-folder";
const RESTORE_PROMPTED_KEY = "ayah-flow:restore-prompted";

type BackupData = {
  version: number;
  savedAt: number;
  ayahBookmarks: string[];
  surahBookmarks: number[];
  last: LastPosition | null;
  progress: Record<number, number>;
  audioPrefs: AudioPrefs;
};

const { StorageAccessFramework } = FileSystem;
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

/**
 * The folder the user granted us via the system folder picker
 * (Storage Access Framework). Lives in AsyncStorage, so it survives app
 * restarts but is (intentionally) reset by an uninstall.
 */
export async function getBackupFolderUri(): Promise<string | null> {
  return AsyncStorage.getItem(SAF_FOLDER_KEY);
}

export async function saveBackupFolderUri(uri: string): Promise<void> {
  await AsyncStorage.setItem(SAF_FOLDER_KEY, uri);
}

async function safFileName(uri: string): Promise<string> {
  const lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}

async function readBackupViaSaf(folderUri: string): Promise<string | null> {
  try {
    const entries = await StorageAccessFramework.readDirectoryAsync(folderUri);
    for (const entry of entries) {
      if ((await safFileName(entry)).endsWith(BACKUP_FILE_NAME)) {
        return await StorageAccessFramework.readAsStringAsync(entry);
      }
    }
  } catch (error) {
    console.warn("Failed to read backup via SAF:", error);
  }
  return null;
}

async function writeBackupViaSaf(folderUri: string, data: string): Promise<boolean> {
  try {
    const entries = await StorageAccessFramework.readDirectoryAsync(folderUri);
    for (const entry of entries) {
      if ((await safFileName(entry)).endsWith(BACKUP_FILE_NAME)) {
        await StorageAccessFramework.writeAsStringAsync(entry, data);
        return true;
      }
    }
    const fileUri = await StorageAccessFramework.createFileAsync(
      folderUri,
      "ayah-flow-backup",
      "application/json"
    );
    await StorageAccessFramework.writeAsStringAsync(fileUri, data);
    return true;
  } catch (error) {
    console.warn("Failed to write backup via SAF:", error);
    return false;
  }
}

/** Write the backup JSON to shared storage (Android only, silently ignored elsewhere). */
export async function saveBackup(): Promise<void> {
  const data = JSON.stringify(await collectBackupData());
  let wroteAny = false;

  if (module && (await ensureSharedStoragePermission())) {
    try {
      await module.saveBackup(data);
      wroteAny = true;
    } catch (error) {
      console.warn("Failed to save backup via MediaStore:", error);
    }
  }

  const folder = await getBackupFolderUri();
  if (folder && (await writeBackupViaSaf(folder, data))) {
    wroteAny = true;
  }

  if (!wroteAny && module) {
    console.warn("Backup was not written to any location");
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

/** Parse + validate + restore a backup blob. Returns true when a restore happened. */
async function restoreFromRaw(raw: string): Promise<boolean> {
  let backup: BackupData;
  try {
    backup = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!backup || backup.version !== BACKUP_VERSION) return false;
  if (!Array.isArray(backup.ayahBookmarks) || !Array.isArray(backup.surahBookmarks)) return false;

  await Promise.all([
    setAyahBookmarks(backup.ayahBookmarks),
    setSurahBookmarks(backup.surahBookmarks),
    backup.last ? saveLastPosition(backup.last) : clearLastPosition(),
    saveSurahProgressMap(
      backup.progress && typeof backup.progress === "object" ? backup.progress : {}
    ),
    backup.audioPrefs ? saveAudioPrefs(backup.audioPrefs) : Promise.resolve(),
  ]);

  return true;
}

/**
 * "Reinstall sync": called once at startup.
 *
 * - If the app's local storage is empty (fresh install or cleared data) and a
 *   backup exists in shared storage, restore it into AsyncStorage.
 * - Otherwise refresh the backup file with the current local data.
 *
 * Returns true when a restore happened.
 *
 * Note: on Android 10+ a MediaStore backup written by a previous install
 * becomes unreadable after uninstall/reinstall (the file is unbound from the
 * app). If the user has granted access to the backup folder via the system
 * folder picker (Storage Access Framework), that copy is tried as a fallback.
 */
export async function syncBackup(): Promise<boolean> {
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

  if (module && (await ensureSharedStoragePermission())) {
    try {
      const raw = await module.loadBackup();
      if (raw && (await restoreFromRaw(raw))) return true;
    } catch (error) {
      console.warn("Failed to read backup via MediaStore:", error);
    }
  }

  const folder = await getBackupFolderUri();
  if (folder) {
    const raw = await readBackupViaSaf(folder);
    if (raw && (await restoreFromRaw(raw))) return true;
  }

  return false;
}

/**
 * Restore from a folder the user picked in the system folder picker.
 * Persists the folder so future backups are written there (and are readable
 * after the next reinstall).
 */
export async function restoreBackupFromSafFolder(folderUri: string): Promise<boolean> {
  await saveBackupFolderUri(folderUri);
  const raw = await readBackupViaSaf(folderUri);
  if (!raw) return false;
  return restoreFromRaw(raw);
}

/**
 * Show the system folder picker, pre-navigated to Download/AyatFlow, and grant
 * the app persistent read/write access to the chosen folder.
 */
export async function promptForBackupFolder(): Promise<string | null> {
  try {
    const initialUri = StorageAccessFramework.getUriForDirectoryInRoot("Download/AyatFlow");
    const result = await StorageAccessFramework.requestDirectoryPermissionsAsync(initialUri);
    if (result.granted && result.directoryUri) {
      await saveBackupFolderUri(result.directoryUri);
      return result.directoryUri;
    }
  } catch (error) {
    console.warn("Failed to request backup folder:", error);
  }
  return null;
}

/**
 * Whether the app should offer the user a one-time restore prompt. Only true
 * on a fresh install (empty local data) with no backup folder granted yet and
 * no backup found anywhere.
 */
export async function shouldOfferRestorePick(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const [ayahBookmarks, surahBookmarks, last, progress, folder, prompted] = await Promise.all([
    getAyahBookmarks(),
    getSurahBookmarks(),
    getLastPosition(),
    getSurahProgress(),
    getBackupFolderUri(),
    AsyncStorage.getItem(RESTORE_PROMPTED_KEY),
  ]);
  if (ayahBookmarks.length > 0 || surahBookmarks.length > 0) return false;
  if (last) return false;
  if (Object.keys(progress).length > 0) return false;
  if (folder) return false;
  if (prompted === "true") return false;
  return true;
}

export async function markRestorePrompted(): Promise<void> {
  await AsyncStorage.setItem(RESTORE_PROMPTED_KEY, "true");
}
