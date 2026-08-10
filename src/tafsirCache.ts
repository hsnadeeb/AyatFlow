import * as FileSystem from 'expo-file-system/legacy';

export type TafsirLanguage = 'urdu' | 'english';

const CACHE_DIR = `${FileSystem.documentDirectory}tafsir/`;
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
}
