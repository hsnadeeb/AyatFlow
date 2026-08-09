const fs = require('fs');
const path = require('path');

const BASE = "https://api.alquran.cloud/v1";

async function fetchSurahs() {
  console.log('Fetching surahs list...');
  const response = await fetch(`${BASE}/surah`);
  if (!response.ok) throw new Error("Could not load Surahs.");
  const json = await response.json();
  return json.data;
}

async function fetchWithRetry(url, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      if (i < retries - 1) {
        console.log(`Retry ${i + 1} for ${url}...`);
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      }
    } catch (error) {
      if (i < retries - 1) {
        console.log(`Retry ${i + 1} for ${url} due to error: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      } else {
        throw error;
      }
    }
  }
  throw new Error("Could not load after retries.");
}

async function fetchSurahData(surahNumber) {
  console.log(`Fetching Surah ${surahNumber}...`);
  const [textResponse, audioResponse, englishResponse] = await Promise.all([
    fetchWithRetry(`${BASE}/surah/${surahNumber}/editions/quran-uthmani,en.sahih`),
    fetchWithRetry(`${BASE}/surah/${surahNumber}/ar.alafasy`),
    fetchWithRetry(`${BASE}/surah/${surahNumber}/en.walk`)
  ]);

  if (!textResponse.ok) throw new Error("Could not load this Surah.");
  if (!audioResponse.ok) throw new Error("Could not load this Surah.");
  if (!englishResponse.ok) throw new Error("Could not load this Surah.");

  const textJson = await textResponse.json();
  const audioJson = await audioResponse.json();
  const englishJson = await englishResponse.json();

  const arabic = textJson.data.find(
    (edition) => edition.edition?.identifier === "quran-uthmani"
  );
  const english = textJson.data.find(
    (edition) => edition.edition?.identifier === "en.sahih"
  );

  if (!arabic || !english) throw new Error("Required Quran editions were not returned.");

  const audioAyahs = audioJson.data.ayahs;
  const translationByNumber = new Map(
    english.ayahs.map((a) => [a.numberInSurah, a.text])
  );
  const audioByNumber = new Map(
    audioAyahs.map((a, index) => [arabic.ayahs[index].number, a.audio])
  );
  const englishAudioByNumber = new Map(
    englishJson.data.ayahs.map((a) => [a.numberInSurah, a.audio])
  );

  const ayahs = arabic.ayahs.map((a) => ({
    number: a.number,
    numberInSurah: a.numberInSurah,
    text: a.text,
    audio: audioByNumber.get(a.number) ?? "",
    translation: translationByNumber.get(a.numberInSurah) ?? "",
    englishAudio: englishAudioByNumber.get(a.numberInSurah) ?? ""
  }));

  return {
    surah: {
      number: arabic.number,
      name: arabic.name,
      englishName: arabic.englishName,
      englishNameTranslation: arabic.englishNameTranslation,
      numberOfAyahs: arabic.numberOfAyahs
    },
    ayahs
  };
}

async function bundleAllSurahs() {
  console.log('Starting Quran data bundling...');
  
  const surahs = await fetchSurahs();
  console.log(`Found ${surahs.length} surahs`);

  const bundledData = {
    data: {
      surahs: surahs,
      surahData: {}
    }
  };

  for (const surah of surahs) {
    try {
      const data = await fetchSurahData(surah.number);
      bundledData.data.surahData[surah.number] = data;
      console.log(`Successfully bundled Surah ${surah.number}: ${surah.englishName}`);
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Failed to bundle Surah ${surah.number}:`, error.message);
      // Continue with next surah even if this one fails
    }
  }

  const outputPath = path.join(__dirname, '../assets/quran-data.json');
  fs.writeFileSync(outputPath, JSON.stringify(bundledData, null, 2));
  console.log(`Successfully bundled Quran data to ${outputPath}`);
}

bundleAllSurahs().catch(console.error);