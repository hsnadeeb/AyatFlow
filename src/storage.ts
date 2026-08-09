import AsyncStorage from "@react-native-async-storage/async-storage";

const LAST_KEY = "ayah-flow:last";
const BOOKMARKS_KEY = "ayah-flow:bookmarks";
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

export async function toggleBookmark(key: string): Promise<string[]> {
  const current = await getBookmarks();
  const next = current.includes(key)
    ? current.filter((item) => item !== key)
    : [...current, key];

  await AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
  return next;
}

export async function getBookmarks(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(BOOKMARKS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function saveSurahProgress(surah: number, ayahIndex: number) {
  const map = await getSurahProgress();
  map[surah] = ayahIndex;
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
}

export async function getSurahProgress(): Promise<Record<number, number>> {
  const raw = await AsyncStorage.getItem(PROGRESS_KEY);
  return raw ? JSON.parse(raw) : {};
}

export async function saveAudioPrefs(prefs: AudioPrefs) {
  await AsyncStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(prefs));
}

export async function getAudioPrefs(): Promise<AudioPrefs> {
  const raw = await AsyncStorage.getItem(AUDIO_PREFS_KEY);
  return raw ? JSON.parse(raw) : { arabic: true, english: true };
}
