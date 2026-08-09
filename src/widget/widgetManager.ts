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

export function initializeWidget() {
  if (Platform.OS === 'android' && AyahWidgetModule) {
    try {
      AyahWidgetModule.updateWidget();
    } catch (error) {
      console.error('Failed to initialize widget:', error);
    }
  }
}