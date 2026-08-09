import AsyncStorage from "@react-native-async-storage/async-storage";

const LAST_KEY = "ayah-flow:last";
const AYAH_BOOKMARKS_KEY = "ayah-flow:ayah-bookmarks";
const LEGACY_BOOKMARKS_KEY = "ayah-flow:bookmarks";
const SURAH_BOOKMARKS_KEY = "ayah-flow:surah-bookmarks";
const PROGRESS_KEY = "ayah-flow:progress";
const AUDIO_PREFS_KEY = "ayah-flow:audio-prefs";

export type LastPosition = {
  surah: number;
  ayahIndex: number;
};

export type AudioPrefs = {
  arabic: boolean;
  english: boolean;
};

export async function saveLastPosition(position: LastPosition) {
  await AsyncStorage.setItem(LAST_KEY, JSON.stringify(position));
}

export async function getLastPosition(): Promise<LastPosition | null> {
  const raw = await AsyncStorage.getItem(LAST_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearLastPosition() {
  await AsyncStorage.removeItem(LAST_KEY);
}

// ---- Ayah bookmarks (keys look like "1:7") ----

export async function toggleAyahBookmark(key: string): Promise<string[]> {
  const current = await getAyahBookmarks();
  const next = current.includes(key)
    ? current.filter((item) => item !== key)
    : [...current, key];

  await AsyncStorage.setItem(AYAH_BOOKMARKS_KEY, JSON.stringify(next));
  return next;
}

export async function getAyahBookmarks(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(AYAH_BOOKMARKS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function setAyahBookmarks(list: string[]) {
  await AsyncStorage.setItem(AYAH_BOOKMARKS_KEY, JSON.stringify(list));
}

// ---- Surah bookmarks (surah numbers) ----

export async function toggleSurahBookmark(number: number): Promise<number[]> {
  const current = await getSurahBookmarks();
  const next = current.includes(number)
    ? current.filter((n) => n !== number)
    : [...current, number].sort((a, b) => a - b);

  await AsyncStorage.setItem(SURAH_BOOKMARKS_KEY, JSON.stringify(next));
  return next;
}

export async function getSurahBookmarks(): Promise<number[]> {
  const raw = await AsyncStorage.getItem(SURAH_BOOKMARKS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function setSurahBookmarks(list: number[]) {
  await AsyncStorage.setItem(SURAH_BOOKMARKS_KEY, JSON.stringify(list));
}

// ---- Migration from the old single bookmark list ----

export async function migrateLegacyBookmarks(): Promise<void> {
  const raw = await AsyncStorage.getItem(LEGACY_BOOKMARKS_KEY);
  if (!raw) return;
  try {
    const legacy: unknown = JSON.parse(raw);
    if (Array.isArray(legacy) && legacy.length > 0) {
      const current = await getAyahBookmarks();
      const merged = [...new Set([...current, ...legacy])];
      await AsyncStorage.setItem(AYAH_BOOKMARKS_KEY, JSON.stringify(merged));
    }
  } catch {
    // Ignore corrupted legacy data
  }
  await AsyncStorage.removeItem(LEGACY_BOOKMARKS_KEY);
}

// ---- Surah progress ----

export async function saveSurahProgress(surah: number, ayahIndex: number) {
  const map = await getSurahProgress();
  map[surah] = ayahIndex;
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
}

export async function saveSurahProgressMap(map: Record<number, number>) {
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
}

export async function getSurahProgress(): Promise<Record<number, number>> {
  const raw = await AsyncStorage.getItem(PROGRESS_KEY);
  return raw ? JSON.parse(raw) : {};
}

// ---- Audio prefs ----

export async function saveAudioPrefs(prefs: AudioPrefs) {
  await AsyncStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(prefs));
}

export async function getAudioPrefs(): Promise<AudioPrefs> {
  const raw = await AsyncStorage.getItem(AUDIO_PREFS_KEY);
  return raw ? JSON.parse(raw) : { arabic: true, english: true };
}
