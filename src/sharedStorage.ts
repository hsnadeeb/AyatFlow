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
 * Android 9 and below need a runtime grant to touch the public Downloads
 * directory. Android 10 (API 29) also requires WRITE_EXTERNAL_STORAGE to
 * write to the MediaStore.Downloads collection. Android 11+ (API 30+)
 * needs nothing.
 */
export async function ensureSharedStoragePermission(): Promise<boolean> {
  if (!sharedStorage) return false;
  const sdk = Number(Platform.Version ?? 99);

  if (sdk >= 30) {
    try {
      const hasAccess = await sharedStorage.hasAllFilesAccess();
      if (hasAccess) return true;
      await sharedStorage.requestAllFilesAccess();
      return false;
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
