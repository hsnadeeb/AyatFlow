import {
  NativeModules,
  Platform,
  PermissionsAndroid,
} from 'react-native';

/**
 * Native bridge to AyahPersistenceModule.
 *
 * Android:
 * - Mirrors Quran audio into shared storage.
 * - Uses MediaStore on Android 10+.
 * - Uses legacy filesystem storage on Android 9 and below.
 *
 * iOS:
 * - null. iOS app storage is sandboxed unless the user explicitly chooses
 *   an external/Files location through SAF-equivalent APIs.
 */
export const sharedStorage =
  Platform.OS === 'android'
    ? NativeModules.AyahPersistenceModule
    : null;

/**
 * Android storage API levels:
 *
 * API 29+:
 *   MediaStore/Downloads is scoped-storage compatible.
 *   The app does NOT need READ_MEDIA_AUDIO or READ_EXTERNAL_STORAGE to
 *   access media files that the app itself created.
 *
 * API 28 and below:
 *   Legacy external storage permissions are required.
 */
export async function ensureSharedStoragePermission(): Promise<boolean> {
  if (!sharedStorage) {
    return false;
  }

  if (Platform.OS !== 'android') {
    return false;
  }

  const sdk = Number(Platform.Version ?? 0);

  /*
   * Android 10+ / API 29+.
   *
   * IMPORTANT:
   *
   * Do NOT request READ_MEDIA_AUDIO here.
   *
   * AyatFlow is accessing files that AyatFlow itself creates in MediaStore.
   * Android grants the owning app access to its own MediaStore files without
   * a runtime storage permission.
   *
   * This is also important because requesting READ_MEDIA_AUDIO here can make
   * the app look like it needs access to the user's entire audio library,
   * even though it doesn't.
   */
  if (sdk >= 29) {
    return true;
  }

  /*
   * Android 9 / API 28 and below.
   *
   * WRITE_EXTERNAL_STORAGE is the relevant permission for creating files in
   * shared external storage.
   */
  try {
    const permission =
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;

    const alreadyGranted =
      await PermissionsAndroid.check(permission);

    if (alreadyGranted) {
      return true;
    }

    const result =
      await PermissionsAndroid.request(
        permission
      );

    return (
      result ===
      PermissionsAndroid.RESULTS.GRANTED
    );
  } catch (error) {
    console.warn(
      'sharedStorage: failed to request legacy storage permission:',
      error
    );

    return false;
  }
}

/**
 * Opens AyatFlow's shared/backup folder.
 *
 * The native implementation is responsible for launching the appropriate
 * Android folder picker / storage UI.
 */
export async function openAyatFlowFolder(): Promise<boolean> {
  if (!sharedStorage) {
    return false;
  }

  try {
    const result =
      await sharedStorage.openAyatFlowFolder();

    return result === true;
  } catch (error) {
    console.warn(
      'sharedStorage: failed to open AyatFlow folder:',
      error
    );

    return false;
  }
}