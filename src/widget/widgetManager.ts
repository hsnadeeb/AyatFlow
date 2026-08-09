import { NativeModules, Platform } from 'react-native';

const { AyahWidgetModule } = NativeModules;

export function updateWidget() {
  if (Platform.OS === 'android' && AyahWidgetModule) {
    try {
      AyahWidgetModule.updateWidget();
    } catch (error) {
      console.error('Failed to update widget:', error);
    }
  }
}

export function saveLastPositionForWidget(surah: number, ayahIndex: number) {
  if (Platform.OS === 'android' && AyahWidgetModule) {
    try {
      AyahWidgetModule.saveLastPosition(surah, ayahIndex);
    } catch (error) {
      console.error('Failed to save last position for widget:', error);
    }
  }
}

export function saveAyahDataForWidget(
  surahName: string,
  ayahNumber: string,
  arabicText: string,
  translation: string,
  totalAyahs = 0,
  ayahIndex = 0
) {
  if (Platform.OS === 'android' && AyahWidgetModule) {
    try {
      AyahWidgetModule.saveAyahData(surahName, ayahNumber, arabicText, translation, totalAyahs, ayahIndex);
    } catch (error) {
      console.error('Failed to save ayah data for widget:', error);
    }
  }
}

export function initializeWidget() {
  if (Platform.OS === 'android' && AyahWidgetModule) {
    try {
      AyahWidgetModule.updateWidget();
    } catch (error) {
      console.error('Failed to initialize widget:', error);
    }
  }
}

export function setWidgetPlayingState(isPlaying: boolean) {
  if (Platform.OS === 'android' && AyahWidgetModule?.setWidgetPlayingState) {
    try {
      AyahWidgetModule.setWidgetPlayingState(isPlaying);
    } catch (error) {
      console.error('Failed to set widget playing state:', error);
    }
  }
}

export function setAudioPrefsForWidget(arabic: boolean, english: boolean) {
  if (Platform.OS === 'android' && AyahWidgetModule?.setAudioPrefs) {
    try {
      AyahWidgetModule.setAudioPrefs(arabic, english);
    } catch (error) {
      console.error('Failed to set widget audio prefs:', error);
    }
  }
}
