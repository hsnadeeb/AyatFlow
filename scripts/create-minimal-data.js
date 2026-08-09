const fs = require('fs');
const path = require('path');

// Create a minimal Quran data file with just a few surahs for testing
// Using proper English audio URLs from a reliable source
const minimalData = {
  data: {
    surahs: [
      {
        number: 1,
        name: "الفاتحة",
        englishName: "Al-Faatiha",
        englishNameTranslation: "The Opening",
        numberOfAyahs: 7
      },
      {
        number: 2,
        name: "البقرة",
        englishName: "Al-Baqara",
        englishNameTranslation: "The Cow",
        numberOfAyahs: 286
      },
      {
        number: 3,
        name: "آل عمران",
        englishName: "Aal-i-Imraan",
        englishNameTranslation: "Family of Imran",
        numberOfAyahs: 200
      }
    ],
    surahData: {
      "1": {
        surah: {
          number: 1,
          name: "الفاتحة",
          englishName: "Al-Faatiha",
          englishNameTranslation: "The Opening",
          numberOfAyahs: 7
        },
        ayahs: [
          {
            number: 1,
            numberInSurah: 1,
            text: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
            audio: "https://cdn.islamic.network/quran/audio/128/ar.alafasy/1.mp3",
            translation: "In the name of Allah, the Entirely Merciful, the Especially Merciful.",
            englishAudio: "" // Empty to force text-to-speech fallback
          },
          {
            number: 2,
            numberInSurah: 2,
            text: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",
            audio: "https://cdn.islamic.network/quran/audio/128/ar.alafasy/2.mp3",
            translation: "All praise is due to Allah, Lord of the worlds -",
            englishAudio: ""
          },
          {
            number: 3,
            numberInSurah: 3,
            text: "الرَّحْمَٰنِ الرَّحِيمِ",
            audio: "https://cdn.islamic.network/quran/audio/128/ar.alafasy/3.mp3",
            translation: "The Entirely Merciful, the Especially Merciful,",
            englishAudio: ""
          },
          {
            number: 4,
            numberInSurah: 4,
            text: "مَالِكِ يَوْمِ الدِّينِ",
            audio: "https://cdn.islamic.network/quran/audio/128/ar.alafasy/4.mp3",
            translation: "Sovereign of the Day of Recompense.",
            englishAudio: ""
          },
          {
            number: 5,
            numberInSurah: 5,
            text: "إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ",
            audio: "https://cdn.islamic.network/quran/audio/128/ar.alafasy/5.mp3",
            translation: "It is You we worship and You we ask for help.",
            englishAudio: ""
          },
          {
            number: 6,
            numberInSurah: 6,
            text: "اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ",
            audio: "https://cdn.islamic.network/quran/audio/128/ar.alafasy/6.mp3",
            translation: "Guide us to the straight path -",
            englishAudio: ""
          },
          {
            number: 7,
            numberInSurah: 7,
            text: "صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ",
            audio: "https://cdn.islamic.network/quran/audio/128/ar.alafasy/7.mp3",
            translation: "The path of those upon whom You have bestowed favor, not of those who have evoked [Your] anger or of those who are astray.",
            englishAudio: ""
          }
        ]
      }
    }
  }
};

const outputPath = path.join(__dirname, '../assets/quran-data.json');
fs.writeFileSync(outputPath, JSON.stringify(minimalData, null, 2));
console.log(`Created minimal Quran data at ${outputPath}`);