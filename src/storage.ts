import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { sharedStorage } from "./sharedStorage";

/**
 * All user data lives locally in:
 *
 *   <documentDirectory>/AyatFlow/data/
 *
 * Files:
 *
 *   last.json
 *   bookmarks.json
 *   surah-bookmarks.json
 *   progress.json
 *   audio-prefs.json
 *   tafsir-language.json
 *
 * On Android, every successful local write is mirrored to:
 *
 *   /storage/emulated/0/Download/AyatFlow/data/
 *
 * through AyahPersistenceModule / MediaStore.
 *
 * This gives AyatFlow two layers:
 *
 *   1. Local app storage
 *      Fast and used during normal operation.
 *
 *   2. Android shared persistent storage
 *      Survives app uninstall and can be copied/restored.
 *
 * AsyncStorage is used only for one-time migration from older builds.
 */

const DATA_SUBDIR = "AyatFlow/data/";

const FILE_LAST = "last.json";
const FILE_AYAH_BOOKMARKS = "bookmarks.json";
const FILE_SURAH_BOOKMARKS = "surah-bookmarks.json";
const FILE_PROGRESS = "progress.json";
const FILE_AUDIO_PREFS = "audio-prefs.json";
const FILE_TAFSIR_LANGUAGE = "tafsir-language.json";

const TMP_SUFFIX = ".tmp";

/**
 * Legacy AsyncStorage keys used by builds before the folder layout.
 */
const LEGACY_LAST_KEY = "ayah-flow:last";
const LEGACY_AYAH_BOOKMARKS_KEY =
  "ayah-flow:ayah-bookmarks";
const LEGACY_SURAH_BOOKMARKS_KEY =
  "ayah-flow:surah-bookmarks";
const LEGACY_BOOKMARKS_KEY =
  "ayah-flow:bookmarks";
const LEGACY_PROGRESS_KEY =
  "ayah-flow:progress";
const LEGACY_AUDIO_PREFS_KEY =
  "ayah-flow:audio-prefs";

/**
 * Native relativeDir contract for saveDataFile/readDataFile/deleteDataFile.
 *
 * Empty string means the file lives directly in:
 *
 *   Download/AyatFlow/data/
 *
 * The native module always prepends its own DATA_ROOT, so callers must never
 * pass a full path such as "AyatFlow/data" (that would duplicate the prefix
 * and produce Download/AyatFlow/data/AyatFlow/data/...).
 */
const SHARED_DATA_SUBDIR = "";

export type LastPosition = {
  surah: number;
  ayahIndex: number;
};

export type AudioPrefs = {
  arabic: boolean;
  english: boolean;
  tafsir: boolean;
};

/**
 * Returns the local AyatFlow data directory.
 */
export function getDataDirectory(): string {
  return `${FileSystem.documentDirectory}${DATA_SUBDIR}`;
}

function filePath(name: string): string {
  return `${getDataDirectory()}${name}`;
}

/**
 * ---------------------------------------------------------------------------
 * Initialization / migration state
 * ---------------------------------------------------------------------------
 *
 * IMPORTANT:
 *
 * Never call writeJson() from inside migrateStorageToFiles().
 *
 * writeJson() waits for migration to finish, so doing so would create:
 *
 *   migration -> writeJson -> migration -> ...
 *
 * Instead, migration uses writeJsonLocal().
 */

let migrationPromise: Promise<void> | null = null;

let sharedRestorePromise: Promise<void> | null = null;

/**
 * Serializes writes to prevent two state updates from overwriting each other.
 */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Ensures the local data directory exists.
 */
async function ensureDataDirectory(): Promise<void> {
  const directory = getDataDirectory();

  try {
    const info =
      await FileSystem.getInfoAsync(
        directory
      );

    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(
        directory,
        {
          intermediates: true,
        }
      );
    }
  } catch (error) {
    console.warn(
      "storage: failed to create data directory",
      error
    );

    throw error;
  }
}

/**
 * ---------------------------------------------------------------------------
 * Local JSON primitives
 * ---------------------------------------------------------------------------
 *
 * These functions NEVER invoke migration.
 *
 * That is intentional.
 */

async function readJsonLocal<T>(
  name: string,
  fallback: T
): Promise<T> {
  try {
    const path =
      filePath(name);

    const info =
      await FileSystem.getInfoAsync(
        path
      );

    if (!info.exists) {
      return fallback;
    }

    const raw =
      await FileSystem.readAsStringAsync(
        path,
        {
          encoding: "utf8",
        }
      );

    if (!raw) {
      return fallback;
    }

    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(
      `storage: failed to read local ${name}`,
      error
    );

    return fallback;
  }
}

/**
 * Atomic local write.
 *
 * Writes:
 *
 *   file.tmp
 *
 * then replaces:
 *
 *   file.json
 *
 * This prevents partially-written JSON files after a crash.
 */
async function writeJsonLocal(
  name: string,
  value: unknown
): Promise<void> {
  const finalPath =
    filePath(name);

  await ensureDataDirectory();

  const tmpPath =
    `${finalPath}${TMP_SUFFIX}`;

  try {
    await FileSystem.writeAsStringAsync(
      tmpPath,
      JSON.stringify(value),
      {
        encoding: "utf8",
      }
    );

    await FileSystem.deleteAsync(
      finalPath,
      {
        idempotent: true,
      }
    );

    await FileSystem.moveAsync({
      from: tmpPath,
      to: finalPath,
    });
  } catch (error) {
    await FileSystem.deleteAsync(
      tmpPath,
      {
        idempotent: true,
      }
    ).catch(() => {});

    throw error;
  }
}

/**
 * ---------------------------------------------------------------------------
 * Android shared-storage helpers
 * ---------------------------------------------------------------------------
 */

function isAndroidSharedStorageAvailable(): boolean {
  return (
    Platform.OS === "android" &&
    !!sharedStorage
  );
}

/**
 * Reads a JSON file from Android shared storage.
 *
 * Returns null when:
 * - iOS
 * - native module unavailable
 * - file doesn't exist
 * - native operation fails
 */
async function readJsonFromSharedStorage<T>(
  name: string
): Promise<T | null> {
  if (
    !isAndroidSharedStorageAvailable()
  ) {
    return null;
  }

  try {
    if (
      typeof sharedStorage.readDataFile !==
      "function"
    ) {
      return null;
    }

    const raw =
      await sharedStorage.readDataFile(
        SHARED_DATA_SUBDIR,
        name
      );

    if (
      typeof raw !== "string" ||
      raw.length === 0
    ) {
      return null;
    }

    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(
      `storage: failed to read shared ${name}`,
      error
    );

    return null;
  }
}

/**
 * Writes a JSON file to Android shared storage.
 *
 * Shared-storage mirroring is deliberately best-effort.
 *
 * The local file remains the primary runtime copy. If MediaStore temporarily
 * fails, the app must continue working normally.
 */
async function writeJsonToSharedStorage(
  name: string,
  value: unknown
): Promise<void> {
  if (
    !isAndroidSharedStorageAvailable()
  ) {
    return;
  }

  try {
    if (
      typeof sharedStorage.saveDataFile !==
      "function"
    ) {
      return;
    }

    await sharedStorage.saveDataFile(
      SHARED_DATA_SUBDIR,
      name,
      JSON.stringify(value)
    );
  } catch (error) {
    console.warn(
      `storage: failed to mirror ${name} to shared storage`,
      error
    );
  }
}

/**
 * Restores missing local data from Android shared storage.
 *
 * IMPORTANT:
 *
 * Shared storage is only used when the local file does NOT exist.
 *
 * This means normal app operation always prefers the local file.
 */
async function restoreJsonFromSharedStorage<T>(
  name: string,
  fallback: T
): Promise<T> {
  if (
    !isAndroidSharedStorageAvailable()
  ) {
    return fallback;
  }

  try {
    const localInfo =
      await FileSystem.getInfoAsync(
        filePath(name)
      );

    if (localInfo.exists) {
      return fallback;
    }

    const shared =
      await readJsonFromSharedStorage<T>(
        name
      );

    if (shared === null) {
      return fallback;
    }

    await writeJsonLocal(
      name,
      shared
    );

    return shared;
  } catch (error) {
    console.warn(
      `storage: failed to restore ${name} from shared storage`,
      error
    );

    return fallback;
  }
}

/**
 * Restores all known user-data files from Android shared storage.
 *
 * This is particularly important after:
 *
 *   uninstall → reinstall
 *
 * because the app's documentDirectory is destroyed by Android when the app
 * is uninstalled, while MediaStore/Downloads survives.
 */
export async function restoreStorageFromShared(): Promise<void> {
  if (
    !isAndroidSharedStorageAvailable()
  ) {
    return;
  }

  if (!sharedRestorePromise) {
    sharedRestorePromise =
      (async () => {
        const files = [
          FILE_LAST,
          FILE_AYAH_BOOKMARKS,
          FILE_SURAH_BOOKMARKS,
          FILE_PROGRESS,
          FILE_AUDIO_PREFS,
          FILE_TAFSIR_LANGUAGE,
        ];

        for (const name of files) {
          try {
            const localInfo =
              await FileSystem.getInfoAsync(
                filePath(name)
              );

            if (localInfo.exists) {
              continue;
            }

            const shared =
              await readJsonFromSharedStorage(
                name
              );

            if (shared === null) {
              continue;
            }

            await writeJsonLocal(
              name,
              shared
            );
          } catch (error) {
            console.warn(
              `storage: failed to restore ${name}`,
              error
            );
          }
        }
      })();
  }

  await sharedRestorePromise;
}

/**
 * Resets the shared-storage restore promise.
 *
 * Useful if the user changes/imports storage during the same process.
 */
export function resetSharedStorageRestoreState(): void {
  sharedRestorePromise = null;
}

/**
 * ---------------------------------------------------------------------------
 * AsyncStorage migration
 * ---------------------------------------------------------------------------
 *
 * This is safe to call repeatedly.
 *
 * It executes only once per JS process.
 */

export function migrateStorageToFiles(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise =
      (async () => {
        try {
          await ensureDataDirectory();

          const entries =
            await AsyncStorage.multiGet([
              LEGACY_LAST_KEY,
              LEGACY_AYAH_BOOKMARKS_KEY,
              LEGACY_SURAH_BOOKMARKS_KEY,
              LEGACY_BOOKMARKS_KEY,
              LEGACY_PROGRESS_KEY,
              LEGACY_AUDIO_PREFS_KEY,
            ]);

          const raw =
            Object.fromEntries(
              entries
            );

          /*
           * Last position.
           */
          if (
            raw[LEGACY_LAST_KEY]
          ) {
            const info =
              await FileSystem.getInfoAsync(
                filePath(FILE_LAST)
              );

            if (!info.exists) {
              try {
                const parsed =
                  JSON.parse(
                    raw[
                      LEGACY_LAST_KEY
                    ]!
                  );

                await writeJsonLocal(
                  FILE_LAST,
                  parsed
                );

                await writeJsonToSharedStorage(
                  FILE_LAST,
                  parsed
                );
              } catch (error) {
                console.warn(
                  "storage: failed to migrate last position",
                  error
                );
              }
            }
          }

          /*
           * Ayah bookmarks.
           */
          if (
            raw[
              LEGACY_AYAH_BOOKMARKS_KEY
            ]
          ) {
            const info =
              await FileSystem.getInfoAsync(
                filePath(
                  FILE_AYAH_BOOKMARKS
                )
              );

            if (!info.exists) {
              const parsed =
                safeParseArray(
                  raw[
                    LEGACY_AYAH_BOOKMARKS_KEY
                  ]
                );

              await writeJsonLocal(
                FILE_AYAH_BOOKMARKS,
                parsed
              );

              await writeJsonToSharedStorage(
                FILE_AYAH_BOOKMARKS,
                parsed
              );
            }
          }

          /*
           * Surah bookmarks.
           */
          if (
            raw[
              LEGACY_SURAH_BOOKMARKS_KEY
            ]
          ) {
            const info =
              await FileSystem.getInfoAsync(
                filePath(
                  FILE_SURAH_BOOKMARKS
                )
              );

            if (!info.exists) {
              const parsed =
                safeParseNumberArray(
                  raw[
                    LEGACY_SURAH_BOOKMARKS_KEY
                  ]
                );

              await writeJsonLocal(
                FILE_SURAH_BOOKMARKS,
                parsed
              );

              await writeJsonToSharedStorage(
                FILE_SURAH_BOOKMARKS,
                parsed
              );
            }
          }

          /*
           * Old single bookmark list.
           *
           * Merge into the current ayah bookmark list.
           */
          if (
            raw[
              LEGACY_BOOKMARKS_KEY
            ]
          ) {
            const legacy =
              safeParseArray(
                raw[
                  LEGACY_BOOKMARKS_KEY
                ]
              );

            if (
              legacy.length > 0
            ) {
              const current =
                await readJsonLocal<
                  string[]
                >(
                  FILE_AYAH_BOOKMARKS,
                  []
                );

              const merged =
                Array.from(
                  new Set([
                    ...current,
                    ...legacy,
                  ])
                );

              await writeJsonLocal(
                FILE_AYAH_BOOKMARKS,
                merged
              );

              await writeJsonToSharedStorage(
                FILE_AYAH_BOOKMARKS,
                merged
              );
            }
          }

          /*
           * Progress.
           */
          if (
            raw[
              LEGACY_PROGRESS_KEY
            ]
          ) {
            const info =
              await FileSystem.getInfoAsync(
                filePath(
                  FILE_PROGRESS
                )
              );

            if (!info.exists) {
              const parsed =
                safeParseObject(
                  raw[
                    LEGACY_PROGRESS_KEY
                  ]
                );

              await writeJsonLocal(
                FILE_PROGRESS,
                parsed
              );

              await writeJsonToSharedStorage(
                FILE_PROGRESS,
                parsed
              );
            }
          }

          /*
           * Audio preferences.
           */
          if (
            raw[
              LEGACY_AUDIO_PREFS_KEY
            ]
          ) {
            const info =
              await FileSystem.getInfoAsync(
                filePath(
                  FILE_AUDIO_PREFS
                )
              );

            if (!info.exists) {
              const parsed =
                safeParseObject(
                  raw[
                    LEGACY_AUDIO_PREFS_KEY
                  ]
                );

              await writeJsonLocal(
                FILE_AUDIO_PREFS,
                parsed
              );

              await writeJsonToSharedStorage(
                FILE_AUDIO_PREFS,
                parsed
              );
            }
          }

          /*
           * Only remove legacy keys after the migration has completed.
           */
          await AsyncStorage.multiRemove([
            LEGACY_LAST_KEY,
            LEGACY_AYAH_BOOKMARKS_KEY,
            LEGACY_SURAH_BOOKMARKS_KEY,
            LEGACY_BOOKMARKS_KEY,
            LEGACY_PROGRESS_KEY,
            LEGACY_AUDIO_PREFS_KEY,
          ]);
        } catch (error) {
          /*
           * Do NOT reject the migration promise.
           *
           * The application can still use empty/default local storage if
           * migration fails.
           */
          console.warn(
            "storage: AsyncStorage migration failed",
            error
          );
        }
      })();
  }

  return migrationPromise;
}

/**
 * ---------------------------------------------------------------------------
 * Parsing helpers
 * ---------------------------------------------------------------------------
 */

function safeParseArray(
  raw: string | null
): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed =
      JSON.parse(raw);

    return Array.isArray(
      parsed
    )
      ? parsed.filter(
          (item) =>
            typeof item ===
            "string"
        )
      : [];
  } catch {
    return [];
  }
}

function safeParseNumberArray(
  raw: string | null
): number[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed =
      JSON.parse(raw);

    return Array.isArray(
      parsed
    )
      ? parsed.filter(
          (item) =>
            typeof item ===
              "number" &&
            Number.isFinite(
              item
            )
        )
      : [];
  } catch {
    return [];
  }
}

function safeParseObject(
  raw: string | null
): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed =
      JSON.parse(raw);

    return parsed &&
      typeof parsed ===
        "object" &&
      !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

/**
 * ---------------------------------------------------------------------------
 * Storage initialization
 * ---------------------------------------------------------------------------
 *
 * Every public read/write waits for:
 *
 *   1. AsyncStorage migration
 *   2. shared-storage restoration
 *
 * This prevents a race where the UI asks for bookmarks while restoration is
 * still happening.
 */

export async function initializeStorage(): Promise<void> {
  await migrateStorageToFiles();

  await restoreStorageFromShared();
}

/**
 * ---------------------------------------------------------------------------
 * Public read/write primitive
 * ---------------------------------------------------------------------------
 */

async function readJson<T>(
  name: string,
  fallback: T
): Promise<T> {
  await initializeStorage();

  /*
   * Local storage is authoritative during normal operation.
   */
  const localInfo =
    await FileSystem.getInfoAsync(
      filePath(name)
    );

  if (localInfo.exists) {
    return readJsonLocal(
      name,
      fallback
    );
  }

  /*
   * If a local file disappeared after initialization, attempt one final
   * shared-storage restoration.
   */
  return restoreJsonFromSharedStorage(
    name,
    fallback
  );
}

async function writeJson(
  name: string,
  value: unknown
): Promise<void> {
  await initializeStorage();

  /*
   * Serialize writes.
   *
   * Without this, two operations such as:
   *
   *   toggle bookmark
   *   save progress
   *
   * could both read/write around the same time and race on disk.
   */
  writeQueue =
    writeQueue.then(
      async () => {
        try {
          await writeJsonLocal(
            name,
            value
          );

          /*
           * Local persistence succeeds independently of shared-storage
           * mirroring.
           */
          await writeJsonToSharedStorage(
            name,
            value
          );
        } catch (error) {
          console.warn(
            `storage: failed to write ${name}`,
            error
          );
        }
      }
    );

  await writeQueue;
}

/**
 * ---------------------------------------------------------------------------
 * Last position
 * ---------------------------------------------------------------------------
 */

export async function saveLastPosition(
  position: LastPosition
): Promise<void> {
  await writeJson(
    FILE_LAST,
    position
  );
}

export async function getLastPosition(): Promise<
  LastPosition | null
> {
  return readJson<
    LastPosition | null
  >(
    FILE_LAST,
    null
  );
}

export async function clearLastPosition(): Promise<void> {
  await writeJson(
    FILE_LAST,
    null
  );
}

/**
 * ---------------------------------------------------------------------------
 * Ayah bookmarks
 *
 * Keys look like:
 *
 *   "1:7"
 * ---------------------------------------------------------------------------
 */

export async function toggleAyahBookmark(
  key: string
): Promise<string[]> {
  const current =
    await getAyahBookmarks();

  const next =
    current.includes(key)
      ? current.filter(
          (item) =>
            item !== key
        )
      : [
          ...current,
          key,
        ];

  await writeJson(
    FILE_AYAH_BOOKMARKS,
    next
  );

  return next;
}

export async function getAyahBookmarks(): Promise<
  string[]
> {
  return readJson<
    string[]
  >(
    FILE_AYAH_BOOKMARKS,
    []
  );
}

export async function setAyahBookmarks(
  list: string[]
): Promise<void> {
  const normalized =
    Array.from(
      new Set(
        list.filter(
          (item) =>
            typeof item ===
            "string"
        )
      )
    );

  await writeJson(
    FILE_AYAH_BOOKMARKS,
    normalized
  );
}

/**
 * ---------------------------------------------------------------------------
 * Surah bookmarks
 * ---------------------------------------------------------------------------
 */

export async function toggleSurahBookmark(
  number: number
): Promise<number[]> {
  const current =
    await getSurahBookmarks();

  const next =
    current.includes(number)
      ? current.filter(
          (n) =>
            n !== number
        )
      : [
          ...current,
          number,
        ].sort(
          (a, b) =>
            a - b
        );

  await writeJson(
    FILE_SURAH_BOOKMARKS,
    next
  );

  return next;
}

export async function getSurahBookmarks(): Promise<
  number[]
> {
  return readJson<
    number[]
  >(
    FILE_SURAH_BOOKMARKS,
    []
  );
}

export async function setSurahBookmarks(
  list: number[]
): Promise<void> {
  const normalized =
    Array.from(
      new Set(
        list.filter(
          (n) =>
            Number.isInteger(n) &&
            n > 0
        )
      )
    ).sort(
      (a, b) =>
        a - b
    );

  await writeJson(
    FILE_SURAH_BOOKMARKS,
    normalized
  );
}

/**
 * ---------------------------------------------------------------------------
 * Legacy migration compatibility
 * ---------------------------------------------------------------------------
 */

export async function migrateLegacyBookmarks(): Promise<void> {
  await migrateStorageToFiles();
}

/**
 * ---------------------------------------------------------------------------
 * Surah progress
 * ---------------------------------------------------------------------------
 */

export async function saveSurahProgress(
  surah: number,
  ayahIndex: number
): Promise<void> {
  const map =
    await getSurahProgress();

  map[surah] =
    ayahIndex;

  await writeJson(
    FILE_PROGRESS,
    map
  );
}

export async function saveSurahProgressMap(
  map: Record<
    number,
    number
  >
): Promise<void> {
  await writeJson(
    FILE_PROGRESS,
    map
  );
}

export async function getSurahProgress(): Promise<
  Record<number, number>
> {
  return readJson<
    Record<number, number>
  >(
    FILE_PROGRESS,
    {}
  );
}

/**
 * ---------------------------------------------------------------------------
 * Audio preferences
 * ---------------------------------------------------------------------------
 */

const DEFAULT_AUDIO_PREFS: AudioPrefs =
  {
    arabic: true,
    english: true,
    tafsir: false,
  };

export async function saveAudioPrefs(
  prefs: AudioPrefs
): Promise<void> {
  await writeJson(
    FILE_AUDIO_PREFS,
    {
      arabic:
        !!prefs.arabic,

      english:
        !!prefs.english,

      tafsir:
        !!prefs.tafsir,
    }
  );
}

export async function getAudioPrefs(): Promise<
  AudioPrefs
> {
  const prefs =
    await readJson<
      Partial<AudioPrefs>
    >(
      FILE_AUDIO_PREFS,
      DEFAULT_AUDIO_PREFS
    );

  return {
    arabic:
      prefs.arabic ??
      DEFAULT_AUDIO_PREFS.arabic,

    english:
      prefs.english ??
      DEFAULT_AUDIO_PREFS.english,

    tafsir:
      prefs.tafsir ??
      DEFAULT_AUDIO_PREFS.tafsir,
  };
}

/**
 * ---------------------------------------------------------------------------
 * Tafsir language
 * ---------------------------------------------------------------------------
 */

export async function getTafsirLanguagePreference(): Promise<string> {
  return readJson<string>(
    FILE_TAFSIR_LANGUAGE,
    "urdu"
  );
}

export async function saveTafsirLanguagePreference(
  language: string
): Promise<void> {
  const normalized =
    language === "english"
      ? "english"
      : "urdu";

  await writeJson(
    FILE_TAFSIR_LANGUAGE,
    normalized
  );
}

/**
 * ---------------------------------------------------------------------------
 * Optional explicit backup synchronization
 * ---------------------------------------------------------------------------
 *
 * Useful after the user selects a new storage location or wants to force a
 * synchronization without changing any data.
 */

export async function syncAllUserDataToSharedStorage(): Promise<void> {
  await initializeStorage();

  if (
    !isAndroidSharedStorageAvailable()
  ) {
    return;
  }

  const files = [
    FILE_LAST,
    FILE_AYAH_BOOKMARKS,
    FILE_SURAH_BOOKMARKS,
    FILE_PROGRESS,
    FILE_AUDIO_PREFS,
    FILE_TAFSIR_LANGUAGE,
  ];

  for (const name of files) {
    try {
      const value =
        await readJsonLocal<
          unknown
        >(
          name,
          undefined
        );

      if (
        value !==
        undefined
      ) {
        await writeJsonToSharedStorage(
          name,
          value
        );
      }
    } catch (error) {
      console.warn(
        `storage: failed to sync ${name}`,
        error
      );
    }
  }
}