import * as FileSystem from 'expo-file-system/legacy';
import { sharedStorage } from './sharedStorage';

export type TafsirLanguage = 'urdu' | 'english';

const CACHE_DIR = `${FileSystem.documentDirectory}AyatFlow/tafsir/`;
/** Pre-folder-layout location — migrated into AyatFlow/tafsir/ on startup. */
const LEGACY_CACHE_DIR = `${FileSystem.documentDirectory}tafsir/`;
const TMP_SUFFIX = '.tmp';

const memoryCache = new Map<string, Record<string, string>>();

function filePath(language: TafsirLanguage, surahNumber: number): string {
  return `${CACHE_DIR}${language}/${surahNumber}.json`;
}

function memoryKey(language: TafsirLanguage, surahNumber: number): string {
  return `${language}:${surahNumber}`;
}

/**
 * Cache-first tafsir store. Whole surahs are cached to disk as
 * `{ [ayahNumber]: tafsirText }` objects (one file per language+surah),
 * so tafsir works fully offline once a surah has been viewed once.
 *
 * Working copies live in <documentDirectory>/AyatFlow/tafsir/ and are
 * mirrored into the shared /storage/emulated/0/Download/AyatFlow/tafsir/
 * folder, so the cache travels with the rest of the app data when the user
 * copies the AyatFlow folder to another phone.
 */
export async function loadSurahFromCache(
  language: TafsirLanguage,
  surahNumber: number
): Promise<Record<string, string> | null> {
  const key = memoryKey(language, surahNumber);
  const mem = memoryCache.get(key);
  if (mem) return mem;

  try {
    const path = filePath(language, surahNumber);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const map = parsed as Record<string, string>;
      memoryCache.set(key, map);
      return map;
    }
  } catch (error) {
    console.warn('TafsirCache: failed to read cache', error);
  }
  return null;
}

export async function saveSurahToCache(
  language: TafsirLanguage,
  surahNumber: number,
  ayahMap: Record<string, string>
): Promise<void> {
  try {
    const finalPath = filePath(language, surahNumber);
    await FileSystem.makeDirectoryAsync(finalPath.substring(0, finalPath.lastIndexOf('/')), {
      intermediates: true,
    });
    const tmpPath = `${finalPath}${TMP_SUFFIX}`;
    await FileSystem.writeAsStringAsync(tmpPath, JSON.stringify(ayahMap));
    await FileSystem.deleteAsync(finalPath, { idempotent: true });
    await FileSystem.moveAsync({ from: tmpPath, to: finalPath });
    memoryCache.set(memoryKey(language, surahNumber), ayahMap);
  } catch (error) {
    console.warn('TafsirCache: failed to write cache', error);
  }

  // Mirror into the shared AyatFlow folder so the cache is portable too.
  if (sharedStorage?.saveTafsirFile) {
    try {
      await sharedStorage.saveTafsirFile(language, String(surahNumber), JSON.stringify(ayahMap));
    } catch (error) {
      console.warn('TafsirCache: failed to mirror cache to shared storage', error);
    }
  }
}

/**
 * Restores cached tafsir from the shared AyatFlow folder into app storage
 * after a fresh install (or when the folder was copied from another phone),
 * and moves any pre-folder-layout caches into place. Called once at startup,
 * alongside the bookmark/audio restore.
 */
export async function syncTafsirCacheFromShared(): Promise<void> {
  try {
    const legacyInfo = await FileSystem.getInfoAsync(LEGACY_CACHE_DIR);
    if (legacyInfo.exists && legacyInfo.isDirectory) {
      await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
      const entries = await FileSystem.readDirectoryAsync(LEGACY_CACHE_DIR);
      for (const entry of entries) {
        const from = `${LEGACY_CACHE_DIR}${entry}`;
        const to = `${CACHE_DIR}${entry}`;
        const info = await FileSystem.getInfoAsync(from);
        if (!info.exists) continue;
        const destInfo = await FileSystem.getInfoAsync(to);
        if (destInfo.exists) continue;
        await FileSystem.moveAsync({ from, to }).catch(() => {});
      }
      await FileSystem.deleteAsync(LEGACY_CACHE_DIR, { idempotent: true }).catch(() => {});
    }

    if (!sharedStorage?.listTafsirFiles) return;

    const files: string[] = await sharedStorage.listTafsirFiles();
    for (const rel of files) {
      // rel looks like "urdu/7.json"
      const match = rel.match(/^(urdu|english)\/(\d+)\.json$/);
      if (!match) continue;
      const language = match[1] as TafsirLanguage;
      const surahNumber = match[2];

      const dest = `${CACHE_DIR}${language}/${surahNumber}.json`;
      const destInfo = await FileSystem.getInfoAsync(dest);
      if (destInfo.exists) continue;

      try {
        const content = await sharedStorage.readTafsirFile(language, surahNumber);
        if (content) {
          await FileSystem.makeDirectoryAsync(`${CACHE_DIR}${language}`, { intermediates: true });
          await FileSystem.writeAsStringAsync(dest, content, { encoding: 'utf8' });
        }
      } catch (error) {
        console.warn(`TafsirCache: failed to restore ${rel}`, error);
      }
    }
  } catch (error) {
    console.warn('TafsirCache: shared sync failed', error);
  }
}
