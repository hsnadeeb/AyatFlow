import * as FileSystem from 'expo-file-system/legacy';

export type Ayah = {
  number: number;
  numberInSurah: number;
  text: string;
  audio: string;
  translation: string;
  englishAudio: string;
};

export type Surah = {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  numberOfAyahs: number;
};

type BundledQuranData = {
  surahs: Surah[];
  surahData: {
    [key: string]: {
      surah: Surah;
      ayahs: Ayah[];
    };
  };
};

let bundledData: BundledQuranData | null = null;

function normalizeQuranData(raw: unknown, errorMessage: string): BundledQuranData {
  if (raw && typeof raw === "object") {
    const wrapper = raw as { data?: { surahs?: unknown; surahData?: unknown }; surahs?: unknown; surahData?: unknown };
    if (wrapper.data && wrapper.data.surahs && wrapper.data.surahData) {
      return wrapper.data as unknown as BundledQuranData;
    }
    if (wrapper.surahs && wrapper.surahData) {
      return wrapper as unknown as BundledQuranData;
    }
  }
  throw new Error(errorMessage);
}

async function loadBundledData(): Promise<BundledQuranData> {
  if (bundledData) {
    return bundledData;
  }

  try {
    // Try to load the bundled JSON file
    const quranData = require('../assets/quran-data.json');
    bundledData = normalizeQuranData(quranData, "Invalid Quran data format");
    return bundledData;
  } catch (error) {
    console.error('Failed to load bundled Quran data:', error);

    // Fallback: Try to load from file system
    try {
      const fileUri = FileSystem.documentDirectory + 'quran-data.json';
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (fileInfo.exists) {
        const data = await FileSystem.readAsStringAsync(fileUri);
        const parsedData = JSON.parse(data);
        bundledData = normalizeQuranData(parsedData, "Invalid Quran data format in file");
        return bundledData;
      }
    } catch (fileError) {
      console.error('Fallback file system load also failed:', fileError);
    }

    throw new Error("Could not load Quran data. Please ensure the app is properly installed.");
  }
}

export async function getSurahs(): Promise<Surah[]> {
  const data = await loadBundledData();
  return data.surahs;
}

export async function getSurah(surahNumber: number): Promise<{
  surah: Surah;
  ayahs: Ayah[];
}> {
  const data = await loadBundledData();
  const surahData = data.surahData[surahNumber];
  
  if (!surahData) {
    throw new Error(`Surah ${surahNumber} not found in bundled data`);
  }

  return surahData;
}
