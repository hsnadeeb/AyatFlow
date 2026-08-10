import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * All user data (bookmarks, progress, audio prefs, last position) lives in a
 * single portable folder:
 *
 *   <documentDirectory>/AyatFlow/
 *     quran-audio/            audio downloads (managed by downloadManager)
 *     data/
 *       bookmarks.json        ayah bookmarks
 *       surah-bookmarks.json  surah bookmarks
 *       progress.json         per-surah reading progress
 *       audio-prefs.json      arabic/english audio toggles
 *       last.json             last read position
 *
 * The whole AyatFlow folder is mirrored to AyatFlow on Android so the
 * user can copy it to a new phone and the app restores everything from it.
 * These helpers are the single source of truth — no more AsyncStorage for user
 * data (AsyncStorage is kept only for install metadata and legacy migration).
 */

const DATA_SUBDIR = "AyatFlow/data/";

const FILE_LAST = "last.json";
const FILE_AYAH_BOOKMARKS = "bookmarks.json";
const FILE_SURAH_BOOKMARKS = "surah-bookmarks.json";
const FILE_PROGRESS = "progress.json";
const FILE_AUDIO_PREFS = "audio-prefs.json";
const TMP_SUFFIX = ".tmp";

/** Legacy AsyncStorage keys used by builds before the folder layout. */
const LEGACY_LAST_KEY = "ayah-flow:last";
const LEGACY_AYAH_BOOKMARKS_KEY = "ayah-flow:ayah-bookmarks";
const LEGACY_SURAH_BOOKMARKS_KEY = "ayah-flow:surah-bookmarks";
const LEGACY_BOOKMARKS_KEY = "ayah-flow:bookmarks";
const LEGACY_PROGRESS_KEY = "ayah-flow:progress";
const LEGACY_AUDIO_PREFS_KEY = "ayah-flow:audio-prefs";

export type LastPosition = {
  surah: number;
  ayahIndex: number;
};

export type AudioPrefs = {
  arabic: boolean;
  english: boolean;
  tafsir: boolean;
};

export function getDataDirectory(): string {
  return `${FileSystem.documentDirectory}${DATA_SUBDIR}`;
}

function filePath(name: string): string {
  return `${getDataDirectory()}${name}`;
}

// ---------------------------------------------------------------------
// Migration from the AsyncStorage era (pre-folder builds). Runs once at
// startup; every read below awaits it so no call can miss the data.
// ---------------------------------------------------------------------

let migrationPromise: Promise<void> | null = null;

export function migrateStorageToFiles(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      try {
        const entries = await AsyncStorage.multiGet([
          LEGACY_LAST_KEY,
          LEGACY_AYAH_BOOKMARKS_KEY,
          LEGACY_SURAH_BOOKMARKS_KEY,
          LEGACY_BOOKMARKS_KEY,
          LEGACY_PROGRESS_KEY,
          LEGACY_AUDIO_PREFS_KEY,
        ]);
        const raw = Object.fromEntries(entries);

        if (raw[LEGACY_LAST_KEY]) {
          const info = await FileSystem.getInfoAsync(filePath(FILE_LAST));
          if (!info.exists) {
            await writeJson(FILE_LAST, JSON.parse(raw[LEGACY_LAST_KEY]!));
          }
        }
        if (raw[LEGACY_AYAH_BOOKMARKS_KEY]) {
          const info = await FileSystem.getInfoAsync(filePath(FILE_AYAH_BOOKMARKS));
          if (!info.exists) {
            const parsed = safeParseArray(raw[LEGACY_AYAH_BOOKMARKS_KEY]);
            await writeJson(FILE_AYAH_BOOKMARKS, parsed);
          }
        }
        if (raw[LEGACY_SURAH_BOOKMARKS_KEY]) {
          const info = await FileSystem.getInfoAsync(filePath(FILE_SURAH_BOOKMARKS));
          if (!info.exists) {
            const parsed = safeParseArray(raw[LEGACY_SURAH_BOOKMARKS_KEY]);
            await writeJson(FILE_SURAH_BOOKMARKS, parsed);
          }
        }
        if (raw[LEGACY_BOOKMARKS_KEY]) {
          // The old single bookmark list merges into the ayah bookmarks.
          const legacy = safeParseArray(raw[LEGACY_BOOKMARKS_KEY]);
          if (legacy.length > 0) {
            const current = await readJson<string[]>(FILE_AYAH_BOOKMARKS, []);
            await writeJson(FILE_AYAH_BOOKMARKS, [...new Set([...current, ...legacy])]);
          }
        }
        if (raw[LEGACY_PROGRESS_KEY]) {
          const info = await FileSystem.getInfoAsync(filePath(FILE_PROGRESS));
          if (!info.exists) {
            const parsed = safeParseObject(raw[LEGACY_PROGRESS_KEY]);
            await writeJson(FILE_PROGRESS, parsed);
          }
        }
        if (raw[LEGACY_AUDIO_PREFS_KEY]) {
          const info = await FileSystem.getInfoAsync(filePath(FILE_AUDIO_PREFS));
          if (!info.exists) {
            const parsed = safeParseObject(raw[LEGACY_AUDIO_PREFS_KEY]);
            await writeJson(FILE_AUDIO_PREFS, parsed);
          }
        }

        // The legacy keys are now either migrated or irrelevant.
        await AsyncStorage.multiRemove([
          LEGACY_LAST_KEY,
          LEGACY_AYAH_BOOKMARKS_KEY,
          LEGACY_SURAH_BOOKMARKS_KEY,
          LEGACY_BOOKMARKS_KEY,
          LEGACY_PROGRESS_KEY,
          LEGACY_AUDIO_PREFS_KEY,
        ]);
      } catch (error) {
        console.warn("storage: AsyncStorage migration failed", error);
      }
    })();
  }
  return migrationPromise;
}

function safeParseArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------
// File read/write primitives (atomic write: tmp file then rename)
// ---------------------------------------------------------------------

async function readJson<T>(name: string, fallback: T): Promise<T> {
  await migrateStorageToFiles();
  try {
    const info = await FileSystem.getInfoAsync(filePath(name));
    if (!info.exists) return fallback;
    const raw = await FileSystem.readAsStringAsync(filePath(name), { encoding: "utf8" });
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (error) {
    console.warn(`storage: failed to read ${name}`, error);
    return fallback;
  }
}

async function writeJson(name: string, value: unknown): Promise<void> {
  await migrateStorageToFiles();
  try {
    const finalPath = filePath(name);
    await FileSystem.makeDirectoryAsync(
      finalPath.substring(0, finalPath.lastIndexOf("/")),
      { intermediates: true }
    );
    const tmpPath = `${finalPath}${TMP_SUFFIX}`;
    await FileSystem.writeAsStringAsync(tmpPath, JSON.stringify(value), { encoding: "utf8" });
    await FileSystem.deleteAsync(finalPath, { idempotent: true });
    await FileSystem.moveAsync({ from: tmpPath, to: finalPath });
  } catch (error) {
    console.warn(`storage: failed to write ${name}`, error);
  }
}

// ---- Last position ----

export async function saveLastPosition(position: LastPosition) {
  await writeJson(FILE_LAST, position);
}

export async function getLastPosition(): Promise<LastPosition | null> {
  return readJson<LastPosition | null>(FILE_LAST, null);
}

export async function clearLastPosition() {
  await writeJson(FILE_LAST, null);
}

// ---- Ayah bookmarks (keys look like "1:7") ----

export async function toggleAyahBookmark(key: string): Promise<string[]> {
  const current = await getAyahBookmarks();
  const next = current.includes(key)
    ? current.filter((item) => item !== key)
    : [...current, key];

  await writeJson(FILE_AYAH_BOOKMARKS, next);
  return next;
}

export async function getAyahBookmarks(): Promise<string[]> {
  return readJson<string[]>(FILE_AYAH_BOOKMARKS, []);
}

export async function setAyahBookmarks(list: string[]) {
  await writeJson(FILE_AYAH_BOOKMARKS, list);
}

// ---- Surah bookmarks (surah numbers) ----

export async function toggleSurahBookmark(number: number): Promise<number[]> {
  const current = await getSurahBookmarks();
  const next = current.includes(number)
    ? current.filter((n) => n !== number)
    : [...current, number].sort((a, b) => a - b);

  await writeJson(FILE_SURAH_BOOKMARKS, next);
  return next;
}

export async function getSurahBookmarks(): Promise<number[]> {
  return readJson<number[]>(FILE_SURAH_BOOKMARKS, []);
}

export async function setSurahBookmarks(list: number[]) {
  await writeJson(FILE_SURAH_BOOKMARKS, list);
}

// ---- Migration from the old single bookmark list (AsyncStorage era) ----
// Kept as a no-op for callers from older versions; the real migration lives
// in migrateStorageToFiles above.

export async function migrateLegacyBookmarks(): Promise<void> {
  await migrateStorageToFiles();
}

// ---- Surah progress ----

export async function saveSurahProgress(surah: number, ayahIndex: number) {
  const map = await getSurahProgress();
  map[surah] = ayahIndex;
  await writeJson(FILE_PROGRESS, map);
}

export async function saveSurahProgressMap(map: Record<number, number>) {
  await writeJson(FILE_PROGRESS, map);
}

export async function getSurahProgress(): Promise<Record<number, number>> {
  return readJson<Record<number, number>>(FILE_PROGRESS, {});
}

// ---- Audio prefs ----

export async function saveAudioPrefs(prefs: AudioPrefs) {
  await writeJson(FILE_AUDIO_PREFS, prefs);
}

export async function getAudioPrefs(): Promise<AudioPrefs> {
  return readJson<AudioPrefs>(FILE_AUDIO_PREFS, { arabic: true, english: true, tafsir: false });
}

// ---- Tafsir language (urdu | english) ----

const FILE_TAFSIR_LANGUAGE = "tafsir-language.json";

export async function getTafsirLanguagePreference(): Promise<string> {
  return readJson<string>(FILE_TAFSIR_LANGUAGE, "urdu");
}

export async function saveTafsirLanguagePreference(language: string) {
  await writeJson(FILE_TAFSIR_LANGUAGE, language);
}
