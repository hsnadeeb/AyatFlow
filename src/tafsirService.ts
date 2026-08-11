import { TafsirLanguage, loadSurahFromCache, saveSurahToCache } from './tafsirCache';

export type { TafsirLanguage };

export type TafsirEdition = {
  language: TafsirLanguage;
  slug: string;
  name: string;
  author: string;
};

/**
 * Editions served by the static tafsir_api dataset
 * (https://github.com/spa5k/tafsir_api, mirrored from Quran.com's tafsir
 * resources) and hosted on the jsDelivr CDN. Both editions are complete
 * per-ayah commentaries with no missing ayahs.
 */
export const TAFSIR_EDITIONS: Record<TafsirLanguage, TafsirEdition> = {
  english: {
    language: 'english',
    slug: 'en-tafisr-ibn-kathir',
    name: 'Tafsir Ibn Kathir (Abridged)',
    author: 'Hafiz Ibn Kathir',
  },
  urdu: {
    language: 'urdu',
    slug: 'tafseer-ibn-e-kaseer-urdu',
    name: 'Tafsir Ibn Kathir (Urdu)',
    author: 'Hafiz Ibn Kathir',
  },
};

const BASE_URL = 'https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir';
const FALLBACK_BASE_URL = 'https://raw.githubusercontent.com/spa5k/tafsir_api/main/tafsir';
const FETCH_TIMEOUT_MS = 30_000;

/** One in-flight whole-surah fetch per language+surah, so repeated ayah
 *  lookups share a single network request. */
const inFlight = new Map<string, Promise<Record<string, string>>>();

type RawTafsirEntry = { surah?: number; ayah?: number; text?: string };

function normalize(data: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  if (!Array.isArray(data)) return map;
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const { ayah, text } = entry as RawTafsirEntry;
    if (typeof ayah === 'number' && typeof text === 'string' && text.trim()) {
      map[String(ayah)] = text.trim();
    }
  }
  return map;
}

/**
 * Returns the tafsir for the whole surah as `{ [ayahNumber]: text }`.
 * Cache-first: disk/memory cache is served immediately, and a miss fetches
 * the entire surah in one request and persists it for offline use.
 */
export async function getSurahTafsir(
  surahNumber: number,
  language: TafsirLanguage
): Promise<Record<string, string>> {
  if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114) {
    throw new Error(`Invalid surah number: ${surahNumber}`);
  }

  const cached = await loadSurahFromCache(language, surahNumber);
  if (cached) return cached;

  const key = `${language}:${surahNumber}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const edition = TAFSIR_EDITIONS[language];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      let response: Response;
      let url = `${BASE_URL}/${edition.slug}/${surahNumber}.json`;
      
      try {
        response = await fetch(url, {
          signal: controller.signal,
        });
      } catch (primaryError) {
        console.warn(`[Tafsir] Primary CDN failed, trying fallback:`, primaryError);
        url = `${FALLBACK_BASE_URL}/${edition.slug}/${surahNumber}.json`;
        response = await fetch(url, {
          signal: controller.signal,
        });
      }
      
      if (!response.ok) {
        throw new Error(`Tafsir request failed (HTTP ${response.status}) from ${url}`);
      }
      const map = normalize(await response.json());
      if (Object.keys(map).length === 0) {
        throw new Error('Tafsir response contained no ayah text');
      }
      // Best-effort persistence — playback/reading never depends on it.
      saveSurahToCache(language, surahNumber, map).catch(() => {});
      return map;
    } finally {
      clearTimeout(timeout);
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/** Single-ayah tafsir for the current ayah. Returns null when this ayah has
 *  no commentary in the selected edition. */
export async function getTafsirForAyah(
  surahNumber: number,
  ayahNumber: number,
  language: TafsirLanguage
): Promise<string | null> {
  const surah = await getSurahTafsir(surahNumber, language);
  return surah[String(ayahNumber)] ?? null;
}
