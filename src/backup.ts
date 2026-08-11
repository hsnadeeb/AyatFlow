import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { sharedStorage, ensureSharedStoragePermission } from "./sharedStorage";
import {
  getAyahBookmarks,
  getAudioPrefs,
  getLastPosition,
  getSurahBookmarks,
  getSurahProgress,
  getTafsirLanguagePreference,
  saveAudioPrefs,
  saveLastPosition,
  saveSurahProgressMap,
  saveTafsirLanguagePreference,
  setAyahBookmarks,
  setSurahBookmarks,
  clearLastPosition,
  AudioPrefs,
  LastPosition,
} from "./storage";

/**
 * The app's whole data folder (<documentDirectory>/AyatFlow) is mirrored into
 * shared storage under Download/AyatFlow:
 *
 *   Download/AyatFlow/
 *     data/
 *       bookmarks.json
 *       surah-bookmarks.json
 *       progress.json
 *       audio-prefs.json
 *       last.json
 *       tafsir-language.json
 *     quran-audio/SurahN/{arabic,english}/N.mp3   (mirrored by downloadManager)
 *     tafsir/{urdu,english}/N.json                (mirrored by tafsirCache)
 *     backups/ayah-flow-backup.json               (combined snapshot)
 *
 * Copying the AyatFlow folder to a new phone and installing the app there is
 * all that's needed to move everything over: on first launch syncBackup()
 * restores the data files, syncTafsirCacheFromShared() restores the tafsir
 * cache, and the download manager restores the audio.
 */

const BACKUP_VERSION = 1;
const SAVE_DEBOUNCE_MS = 1500;
const BACKUP_FILE_NAME = "ayah-flow-backup.json";
const SAF_FOLDER_KEY = "ayah-flow:saf-backup-folder";
const RESTORE_PROMPTED_KEY = "ayah-flow:restore-prompted";

/**
 * Relative path of the data folder inside a user-granted SAF tree.
 */
const DATA_SUBDIR = "data";

/**
 * MediaStore relativeDir contract for saveDataFile/readDataFile:
 *
 * Empty string means files live directly in Download/AyatFlow/data/.
 * The native module prepends its own data root, so "data" (or any other
 * full path) must never be passed here.
 */
const SHARED_DATA_SUBDIR = "";

/** Relative path of the backup folder inside a user-granted SAF tree. */
const BACKUPS_SUBDIR = "backups";

/** Files mirrored into AyatFlow/data/ — the portable data files. */
export const DATA_FILE_NAMES = [
  "bookmarks.json",
  "surah-bookmarks.json",
  "progress.json",
  "audio-prefs.json",
  "last.json",
  "tafsir-language.json",
] as const;

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

// ---------------------------------------------------------------------
// SAF (Storage Access Framework) helpers — the folder the user granted via
// the system folder picker. All operations route through the native module
// because expo's JS SAF layer cannot list/create files inside subfolders of
// the granted tree. relativePath is relative to the granted folder, e.g.
// "data/bookmarks.json" or "quran-audio/Surah1/arabic/1.mp3".
// ---------------------------------------------------------------------

/**
 * The folder the user granted us via the system folder picker
 * (Storage Access Framework). Lives in AsyncStorage, so it survives app
 * restarts but is (intentionally) reset by an uninstall.
 */
export async function getBackupFolderUri(): Promise<string | null> {
  return AsyncStorage.getItem(SAF_FOLDER_KEY);
}

function safWriteTextFile(folderUri: string, relativePath: string, content: string): Promise<boolean> {
  return module
    .safWriteTextFile(folderUri, relativePath, content)
    .then(() => true)
    .catch((error: unknown) => {
      console.warn(`Failed to write ${relativePath} via SAF:`, error);
      return false;
    });
}

async function safReadTextFile(folderUri: string, relativePath: string): Promise<string | null> {
  try {
    return (await module.safReadTextFile(folderUri, relativePath)) as string | null;
  } catch (error) {
    console.warn(`Failed to read ${relativePath} via SAF:`, error);
    return null;
  }
}

/** All files under the granted folder (relative paths), deepest first. */
async function safListFiles(folderUri: string, relativePath: string): Promise<string[]> {
  try {
    return (await module.safListFiles(folderUri, relativePath)) as string[];
  } catch (error) {
    console.warn(`Failed to list ${relativePath} via SAF:`, error);
    return [];
  }
}

function safDeleteFile(folderUri: string, relativePath: string): Promise<void> {
  return module
    .safDeleteFile(folderUri, relativePath)
    .catch((error: unknown) => {
      console.warn(`Failed to delete ${relativePath} via SAF:`, error);
    });
}

// ---------------------------------------------------------------------
// Per-file mirroring of the data folder
// ---------------------------------------------------------------------

/**
 * Mirror every data file (bookmarks, progress, prefs, last position) into the
 * shared folder — MediaStore on Android 10+, SAF folder if granted, and the
 * legacy File API on Android 9-. This keeps AyatFlow a complete,
 * portable copy of the app's user data.
 *
 * Files whose content hasn't changed since the last mirror are skipped, so the
 * frequent debounced saves during playback don't hammer MediaStore.
 */
async function mirrorDataToShared(): Promise<void> {
  const [bookmarks, surahBookmarks, progress, audioPrefs, last, tafsirLanguage] = await Promise.all([
    getAyahBookmarks(),
    getSurahBookmarks(),
    getSurahProgress(),
    getAudioPrefs(),
    getLastPosition(),
    getTafsirLanguagePreference(),
  ]);
  const files: Array<[string, string]> = [
    ["bookmarks.json", JSON.stringify(bookmarks)],
    ["surah-bookmarks.json", JSON.stringify(surahBookmarks)],
    ["progress.json", JSON.stringify(progress)],
    ["audio-prefs.json", JSON.stringify(audioPrefs)],
    ["last.json", JSON.stringify(last)],
    ["tafsir-language.json", JSON.stringify(tafsirLanguage)],
  ];

  const changed = files.filter(([name, content]) => lastMirrored.get(name) !== content);

  if (changed.length === 0) return;

  const folder = await getBackupFolderUri();

  if (module && (await ensureSharedStoragePermission())) {
    for (const [name, content] of changed) {
      try {
        await module.saveDataFile(SHARED_DATA_SUBDIR, name, content);
        lastMirrored.set(name, content);
      } catch (error) {
        console.warn(`Failed to mirror ${name} via MediaStore:`, error);
      }
    }
  }

  if (folder) {
    for (const [name, content] of changed) {
      if (await safWriteTextFile(folder, `${DATA_SUBDIR}/${name}`, content)) {
        lastMirrored.set(name, content);
      }
    }
  }
}

/** Content of the last successfully mirrored data file, to skip no-op writes. */
const lastMirrored = new Map<string, string>();

function resetLastMirrored(): void {
  lastMirrored.clear();
}

/** Read one data file from shared storage (MediaStore first, then SAF). */
async function readSharedDataFile(dataFileName: string): Promise<string | null> {
  if (module && (await ensureSharedStoragePermission())) {
    try {
      const raw = await module.readDataFile(SHARED_DATA_SUBDIR, dataFileName);
      if (raw) return raw;
    } catch (error) {
      console.warn(`Failed to read ${dataFileName} via MediaStore:`, error);
    }
  }
  const folder = await getBackupFolderUri();
  if (folder) {
    const raw = await safReadTextFile(folder, `${DATA_SUBDIR}/${dataFileName}`);
    if (raw) return raw;
  }
  return null;
}

// ---------------------------------------------------------------------
// SAF audio mirroring — MediaStore files written by a previous install
// become unreadable after uninstall/reinstall on Android 10+, so audio
// is ALSO mirrored into the granted backup folder (and restored from it)
// to survive a reinstall.
// ---------------------------------------------------------------------

const AUDIO_SUBDIR = "quran-audio";

export type SafAudioFile = {
  surahNumber: number;
  type: "arabic" | "english";
  ayahNumber: number;
  relativePath: string;
};

/** Every audio file found in the granted folder's quran-audio/ subfolder. */
export async function listAudioViaSaf(folderUri: string): Promise<SafAudioFile[]> {
  const files = await safListFiles(folderUri, AUDIO_SUBDIR);
  const result: SafAudioFile[] = [];
  for (const rel of files) {
    const match = rel.match(/^quran-audio\/Surah(\d+)\/(arabic|english)\/(\d+)\.mp3$/);
    if (!match) continue;
    result.push({
      surahNumber: parseInt(match[1], 10),
      type: match[2] as SafAudioFile["type"],
      ayahNumber: parseInt(match[3], 10),
      relativePath: rel,
    });
  }
  return result;
}

/** Copy one audio file from the SAF folder back into app storage. */
export async function restoreAudioViaSaf(
  folderUri: string,
  file: SafAudioFile,
  destPath: string
): Promise<boolean> {
  try {
    return (await module.safCopyFileToApp(folderUri, file.relativePath, destPath)) === true;
  } catch (error) {
    console.warn(
      `Failed to restore audio via SAF: ${file.relativePath}`,
      error
    );
    return false;
  }
}

/** Mirror one freshly downloaded audio file into the granted folder. */
export async function saveAudioViaSaf(
  folderUri: string,
  surahNumber: number,
  type: "arabic" | "english",
  ayahNumber: number,
  sourcePath: string
): Promise<boolean> {
  try {
    return (
      (await module.safCopyFileFromApp(
        folderUri,
        `${AUDIO_SUBDIR}/Surah${surahNumber}/${type}/${ayahNumber}.mp3`,
        sourcePath
      )) === true
    );
  } catch (error) {
    console.warn(`Failed to mirror audio via SAF: Surah${surahNumber}/${type}/${ayahNumber}.mp3`, error);
    return false;
  }
}

/** Remove one audio file from the granted folder. */
export async function deleteAudioViaSaf(
  folderUri: string,
  surahNumber: number,
  type: "arabic" | "english",
  ayahNumber: number
): Promise<void> {
  await safDeleteFile(folderUri, `${AUDIO_SUBDIR}/Surah${surahNumber}/${type}/${ayahNumber}.mp3`);
}

/**
 * Restore the individual data files from the shared folder into app storage.
 * Returns true when at least the bookmark files were restored.
 */
async function restoreDataFromShared(): Promise<boolean> {
  const [bookmarks, surahBookmarks] = await Promise.all([
    readSharedDataFile("bookmarks.json"),
    readSharedDataFile("surah-bookmarks.json"),
  ]);
  if (!bookmarks && !surahBookmarks) return false;

  const [progress, audioPrefs, last, tafsirLanguage] = await Promise.all([
    readSharedDataFile("progress.json"),
    readSharedDataFile("audio-prefs.json"),
    readSharedDataFile("last.json"),
    readSharedDataFile("tafsir-language.json"),
  ]);

  const parse = (raw: string | null, fallback: unknown): unknown => {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };

  await Promise.all([
    bookmarks ? setAyahBookmarks(parse(bookmarks, []) as string[]) : Promise.resolve(),
    surahBookmarks ? setSurahBookmarks(parse(surahBookmarks, []) as number[]) : Promise.resolve(),
    progress ? saveSurahProgressMap(parse(progress, {}) as Record<number, number>) : Promise.resolve(),
    audioPrefs ? saveAudioPrefs(parse(audioPrefs, {}) as AudioPrefs) : Promise.resolve(),
    last ? saveLastPosition(parse(last, null) as LastPosition) : Promise.resolve(),
    tafsirLanguage
      ? saveTafsirLanguagePreference(
          parse(tafsirLanguage, "urdu") === "english" ? "english" : "urdu"
        )
      : Promise.resolve(),
  ]);

  return true;
}

// ---------------------------------------------------------------------
// Combined backup (legacy) + save
// ---------------------------------------------------------------------

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
  if (folder && (await safWriteTextFile(folder, `${BACKUPS_SUBDIR}/${BACKUP_FILE_NAME}`, data))) {
    wroteAny = true;
  }

  // Always keep the per-file copies in sync — that's what makes the folder portable.
  await mirrorDataToShared();

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
 * - If the app's local data is empty (fresh install or cleared data) and the
 *   shared folder has data files, restore them into app storage — unless
 *   `autoRestore` is false, in which case the caller decides (e.g. to ask the
 *   user first instead of restoring silently).
 * - Otherwise refresh the shared copies with the current local data.
 *
 * Returns true when a restore happened.
 */
export async function syncBackup(autoRestore = true): Promise<boolean> {
  if (await isLocalDataEmpty()) {
    if (!autoRestore) return false;
    if (await restoreDataFromShared()) return true;

    // Fall back to the legacy combined backup blob.
    if (module && (await ensureSharedStoragePermission())) {
      try {
        const raw = await module.loadBackup();
        if (raw && (await restoreFromRaw(raw))) return true;
      } catch (error) {
        console.warn("Failed to read backup via MediaStore:", error);
      }
    }
    return false;
  }

  // Existing install: keep local data, just refresh the shared copies.
  scheduleBackupSave();
  return false;
}

/** True when the app has no local user data (fresh install or cleared data). */
export async function isLocalDataEmpty(): Promise<boolean> {
  const [ayahBookmarks, surahBookmarks, last, progress] = await Promise.all([
    getAyahBookmarks(),
    getSurahBookmarks(),
    getLastPosition(),
    getSurahProgress(),
  ]);
  return (
    ayahBookmarks.length === 0 &&
    surahBookmarks.length === 0 &&
    !last &&
    Object.keys(progress).length === 0
  );
}

/**
 * True when a backup from a previous install exists in shared storage that a
 * fresh install could restore — checked automatically, with no folder picker.
 * MediaStore keeps ownership by package name, so files written by the previous
 * install are readable again after a reinstall.
 */
export async function detectSharedBackup(): Promise<boolean> {
  if (!module) return false;
  if (!(await ensureSharedStoragePermission())) return false;
  try {
    const bookmarks = await module.readDataFile(SHARED_DATA_SUBDIR, "bookmarks.json");
    if (bookmarks) return true;
  } catch (error) {
    console.warn("Failed to check bookmarks via MediaStore:", error);
  }
  try {
    const raw = await module.loadBackup();
    if (raw) return true;
  } catch (error) {
    console.warn("Failed to check backup via MediaStore:", error);
  }
  return false;
}

/**
 * Restore everything found in shared storage into app storage: the individual
 * data files (bookmarks, progress, prefs) and the legacy combined backup blob.
 * Fully automatic — no folder selection involved. Audio and tafsir restore
 * separately via their own shared-storage syncs.
 */
export async function restoreEverything(): Promise<boolean> {
  if (await restoreDataFromShared()) return true;

  if (module && (await ensureSharedStoragePermission())) {
    try {
      const raw = await module.loadBackup();
      if (raw && (await restoreFromRaw(raw))) return true;
    } catch (error) {
      console.warn("Failed to read backup via MediaStore:", error);
    }
  }
  return false;
}

/**
 * Whether the app should offer the user a one-time automatic restore. Only
 * true on a fresh install (empty local data) that hasn't been asked before
 * and that has a previous backup waiting in shared storage.
 */
export async function shouldOfferAutoRestore(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (!(await isLocalDataEmpty())) return false;
  const prompted = await AsyncStorage.getItem(RESTORE_PROMPTED_KEY);
  if (prompted === "true") return false;
  return detectSharedBackup();
}

export async function markRestorePrompted(): Promise<void> {
  await AsyncStorage.setItem(RESTORE_PROMPTED_KEY, "true");
}
