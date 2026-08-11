import { NativeModules, PermissionsAndroid, Platform } from "react-native";

/**
 * Bridge to the native AyahPersistenceModule (Android only). Backs up app
 * data and mirrors audio downloads into shared storage
 * (/storage/emulated/0/AyatFlow/) so they survive app uninstall.
 * On iOS this is null: the app sandbox has no shared folder without cloud.
 */
export const sharedStorage =
  Platform.OS === "android" ? NativeModules.AyahPersistenceModule : null;

/**
 * Ask for the storage-related runtime permission at startup so Android shows
 * the prompt when the app is installed or reinstalled. On Android 10+ the
 * prompt is still useful for file access visibility; on Android 9 and below we
 * use the legacy WRITE_EXTERNAL_STORAGE permission.
 */
export async function ensureSharedStoragePermission(): Promise<boolean> {
  if (!sharedStorage) return false;
  const sdk = Number(Platform.Version ?? 99);

  if (sdk >= 33) {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }

  if (sdk >= 30) {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export async function openAyatFlowFolder(): Promise<boolean> {
  if (!sharedStorage) return false;
  try {
    return (await sharedStorage.openAyatFlowFolder()) === true;
  } catch {
    return false;
  }
}
