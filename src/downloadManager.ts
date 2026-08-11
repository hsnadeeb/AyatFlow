import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import {
  sharedStorage,
  ensureSharedStoragePermission,
} from './sharedStorage';

import {
  getBackupFolderUri,
  listAudioViaSaf,
  restoreAudioViaSaf,
  saveAudioViaSaf,
  deleteAudioViaSaf,
} from './backup';

const AUDIO_DIRECTORY = 'AyatFlow/quran-audio';
const DOWNLOAD_STATUS_KEY = 'download-status.json';
const LEGACY_STATUS_KEY = 'ayah-flow:download-status';

const STATUS_TMP_SUFFIX = '.tmp';
const PART_SUFFIX = '.part';

const MIN_VALID_FILE_SIZE = 1000;

const MAX_CONCURRENT_DOWNLOADS = 4;

const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 800;

const PERMISSION_CACHE_TTL_MS = 5 * 60 * 1000;
const SIZE_CACHE_TTL_MS = 4000;
const PROGRESS_EMIT_THROTTLE_MS = 700;

export type AudioType = 'arabic' | 'english';

export type DownloadStatus = {
  [key: string]: {
    downloaded: boolean;
    progress: number;
    filePath?: string;
    lastUpdated: number;
  };
};

export type DownloadProgress = {
  surahNumber: number;
  ayahNumber: number;
  progress: number;
  totalBytes: number;
  downloadedBytes: number;
  type: AudioType;
};

export type SurahDownloadResult = {
  succeeded: number;
  failed: number;
  cancelled: boolean;
  failedItems: Array<{
    ayahNumber: number;
    type: AudioType;
    error: string;
  }>;
};

export type DownloadManagerEvent =
  | { type: 'progress'; surahNumber: number }
  | {
    type: 'fileComplete';
    surahNumber: number;
    ayahNumber: number;
    audioType: AudioType;
  }
  | { type: 'batchStart'; surahNumber: number }
  | { type: 'batchDone'; surahNumber: number }
  | { type: 'delete'; surahNumber?: number }
  | { type: 'sync' };

type DownloadEventListener = (
  event: DownloadManagerEvent
) => void;

type DownloadResumableHandle =
  ReturnType<typeof FileSystem.createDownloadResumable>;

function isValidPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runNext(): Promise<void> {
    while (true) {
      const current = cursor++;

      if (current >= items.length) {
        return;
      }

      results[current] = await worker(
        items[current],
        current
      );
    }
  }

  const workers = Array.from(
    {
      length: Math.min(limit, items.length),
    },
    () => runNext()
  );

  await Promise.all(workers);

  return results;
}

// -----------------------------------------------------------------------------
// ZIP fallback
// -----------------------------------------------------------------------------

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n;

    for (let k = 0; k < 8; k++) {
      c =
        (c >>> 1) ^
        (0xedb88320 & -(c & 1));
    }

    table[n] = c >>> 0;
  }

  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (let i = 0; i < bytes.length; i++) {
    crc =
      (crc >>> 8) ^
      ZIP_CRC_TABLE[
      (crc ^ bytes[i]) & 0xff
      ];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function utf8Encode(str: string): Uint8Array {
  const utf8 = unescape(
    encodeURIComponent(str)
  );

  const bytes = new Uint8Array(
    utf8.length
  );

  for (let i = 0; i < utf8.length; i++) {
    bytes[i] = utf8.charCodeAt(i);
  }

  return bytes;
}

async function readFileBytes(
  filePath: string
): Promise<Uint8Array> {
  const base64 =
    await FileSystem.readAsStringAsync(
      filePath,
      {
        encoding:
          FileSystem.EncodingType.Base64,
      }
    );

  const binary = atob(base64);
  const bytes = new Uint8Array(
    binary.length
  );

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function bytesToBase64(
  bytes: Uint8Array
): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {
    binary += String.fromCharCode(
      ...bytes.subarray(
        i,
        Math.min(
          i + chunkSize,
          bytes.length
        )
      )
    );
  }

  return btoa(binary);
}

function buildZipArchive(
  files: Array<{
    name: string;
    bytes: Uint8Array;
  }>
): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];

  let offset = 0;

  for (const file of files) {
    const nameBytes =
      utf8Encode(file.name);

    const crc = crc32(file.bytes);
    const size = file.bytes.length;

    const localHeader =
      new Uint8Array(30);

    const local =
      new DataView(
        localHeader.buffer
      );

    local.setUint32(
      0,
      0x04034b50,
      true
    );

    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(
      12,
      0x0021,
      true
    );

    local.setUint32(
      14,
      crc,
      true
    );

    local.setUint32(
      18,
      size,
      true
    );

    local.setUint32(
      22,
      size,
      true
    );

    local.setUint16(
      26,
      nameBytes.length,
      true
    );

    local.setUint16(
      28,
      0,
      true
    );

    const centralHeader =
      new Uint8Array(46);

    const central =
      new DataView(
        centralHeader.buffer
      );

    central.setUint32(
      0,
      0x02014b50,
      true
    );

    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(
      12,
      0x0021,
      true
    );

    central.setUint32(
      16,
      crc,
      true
    );

    central.setUint32(
      20,
      size,
      true
    );

    central.setUint32(
      24,
      size,
      true
    );

    central.setUint16(
      28,
      nameBytes.length,
      true
    );

    central.setUint16(
      30,
      0,
      true
    );

    central.setUint32(
      42,
      offset,
      true
    );

    localParts.push(
      localHeader,
      nameBytes,
      file.bytes
    );

    centralParts.push(
      centralHeader,
      nameBytes
    );

    offset +=
      30 +
      nameBytes.length +
      size;
  }

  const centralSize =
    centralParts.reduce(
      (sum, part) =>
        sum + part.length,
      0
    );

  const eocd =
    new Uint8Array(22);

  const end =
    new DataView(
      eocd.buffer
    );

  end.setUint32(
    0,
    0x06054b50,
    true
  );

  end.setUint16(
    8,
    files.length,
    true
  );

  end.setUint16(
    10,
    files.length,
    true
  );

  end.setUint32(
    12,
    centralSize,
    true
  );

  end.setUint32(
    16,
    offset,
    true
  );

  const archive =
    new Uint8Array(
      offset +
      centralSize +
      22
    );

  let position = 0;

  for (const part of [
    ...localParts,
    ...centralParts,
    eocd,
  ]) {
    archive.set(
      part,
      position
    );

    position += part.length;
  }

  return archive;
}

// -----------------------------------------------------------------------------
// Download Manager
// -----------------------------------------------------------------------------

class DownloadManager {
  private audioDir: string;

  private statusCache: DownloadStatus = {};

  private saveTimeout:
    ReturnType<typeof setTimeout> | null =
    null;

  private savePromiseChain:
    Promise<void> =
    Promise.resolve();

  private initPromise:
    Promise<void>;

  private inFlight =
    new Map<
      string,
      Promise<string>
    >();

  private activeDownloads =
    new Map<
      string,
      DownloadResumableHandle
    >();

  private cancelledDownloads =
    new Set<string>();

  private cancelledSurahs =
    new Set<number>();

  private downloadingSurahs =
    new Set<number>();

  private surahDownloadPromises =
    new Map<
      number,
      Promise<SurahDownloadResult>
    >();

  private sharedStoragePermission:
    {
      granted: boolean;
      checkedAt: number;
    } | null = null;

  private sizeCache:
    {
      bytes: number;
      at: number;
    } | null = null;

  private listeners =
    new Set<DownloadEventListener>();

  private lastProgressEmitAt = 0;

  constructor() {
    this.audioDir =
      this.getAudioDirectory();

    this.initPromise =
      this.loadStatus().catch(
        (error) => {
          console.error(
            'DownloadManager: initialization failed:',
            error
          );
        }
      );
  }

  private async whenReady(): Promise<void> {
    await this.initPromise;
  }

  private assertValidIds(
    surahNumber: number,
    ayahNumber: number
  ): void {
    if (
      !isValidPositiveInt(
        surahNumber
      ) ||
      !isValidPositiveInt(
        ayahNumber
      )
    ) {
      throw new Error(
        `Invalid surah/ayah number: ${surahNumber}/${ayahNumber}`
      );
    }
  }

  private getAudioDirectory(): string {
    return `${FileSystem.documentDirectory}${AUDIO_DIRECTORY}/`;
  }

  private async ensureDirectoryExists(): Promise<void> {
    const info =
      await FileSystem.getInfoAsync(
        this.audioDir
      );

    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(
        this.audioDir,
        {
          intermediates: true,
        }
      );
    }
  }

  private getAudioKey(
    surahNumber: number,
    ayahNumber: number,
    type: AudioType
  ): string {
    return `${surahNumber}-${ayahNumber}-${type}`;
  }

  private getFileName(
    surahNumber: number,
    ayahNumber: number,
    type: AudioType
  ): string {
    return `Surah${surahNumber}/${type}/${ayahNumber}.mp3`;
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  subscribe(
    listener: DownloadEventListener
  ): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(
        listener
      );
    };
  }

  private emit(
    event: DownloadManagerEvent
  ): void {
    if (event.type === 'progress') {
      const now = Date.now();

      if (
        now -
        this.lastProgressEmitAt <
        PROGRESS_EMIT_THROTTLE_MS
      ) {
        return;
      }

      this.lastProgressEmitAt =
        now;
    }

    this.invalidateSizeCache();

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn(
          'DownloadManager: listener error:',
          error
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Shared storage
  // ---------------------------------------------------------------------------

  /**
   * IMPORTANT:
   *
   * Android 10+ MediaStore does NOT require MANAGE_EXTERNAL_STORAGE for the
   * files this module creates.
   *
   * Therefore we do not gate MediaStore synchronization on
   * ensureSharedStoragePermission().
   *
   * The permission helper remains available for Android 9 / legacy storage.
   */
  private async hasSharedStoragePermission(): Promise<boolean> {
    if (!sharedStorage) {
      return false;
    }

    const androidVersion =
      Platform.OS === 'android'
        ? Number(Platform.Version)
        : 0;

    const isModernAndroid =
      Platform.OS === 'android' &&
      androidVersion >= 29;

    if (isModernAndroid) {
      return true;
    }

    const now = Date.now();

    if (
      this.sharedStoragePermission &&
      now -
      this.sharedStoragePermission
        .checkedAt <
      PERMISSION_CACHE_TTL_MS
    ) {
      return this
        .sharedStoragePermission
        .granted;
    }

    const granted =
      await ensureSharedStoragePermission()
        .catch(() => false);

    this.sharedStoragePermission = {
      granted,
      checkedAt: now,
    };

    return granted;
  }

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------

  private async loadStatus(): Promise<void> {
    await this.ensureDirectoryExists();

    try {
      const info =
        await FileSystem.getInfoAsync(
          `${this.audioDir}${DOWNLOAD_STATUS_KEY}`
        );

      if (info.exists) {
        await this.readStatusFrom(
          `${this.audioDir}${DOWNLOAD_STATUS_KEY}`
        );
      } else {
        const legacyInfo =
          await FileSystem.getInfoAsync(
            `${this.audioDir}${LEGACY_STATUS_KEY}`
          );

        if (legacyInfo.exists) {
          await this.readStatusFrom(
            `${this.audioDir}${LEGACY_STATUS_KEY}`
          );

          await FileSystem.moveAsync({
            from: `${this.audioDir}${LEGACY_STATUS_KEY}`,
            to: `${this.audioDir}${DOWNLOAD_STATUS_KEY}`,
          }).catch(() => { });
        }
      }
    } catch (error) {
      console.error(
        'DownloadManager: failed to read status:',
        error
      );

      this.statusCache = {};
    }

    // Disk is authoritative for local app files.
    await this.syncWithDiskFiles();

    // Shared persistent copies are then restored.
    await this.syncWithSharedStorage();

    // Only after all restoration has completed do we save the rebuilt status.
    await this.saveStatus();

    await this.cleanupStalePartialFiles();

    this.emit({
      type: 'sync',
    });
  }

  private async readStatusFrom(
    statusFilePath: string
  ): Promise<void> {
    try {
      const raw =
        await FileSystem.readAsStringAsync(
          statusFilePath,
          {
            encoding: 'utf8',
          }
        );

      const loaded =
        JSON.parse(raw);

      this.statusCache = {};

      if (
        !loaded ||
        typeof loaded !== 'object'
      ) {
        return;
      }

      for (const [
        key,
        data,
      ] of Object.entries(
        loaded
      )) {
        const status =
          data as {
            downloaded?: boolean;
            progress?: number;
            filePath?: string;
            lastUpdated?: number;
          };

        this.statusCache[key] = {
          downloaded:
            !!status.downloaded,

          progress:
            status.downloaded
              ? 1
              : Math.max(
                0,
                Math.min(
                  1,
                  status.progress ??
                  0
                )
              ),

          filePath:
            status.filePath,

          lastUpdated:
            status.lastUpdated ??
            Date.now(),
        };
      }
    } catch (error) {
      console.error(
        'DownloadManager: status file corrupt; rebuilding:',
        error
      );

      this.statusCache = {};
    }
  }

  private async cleanupStalePartialFiles(): Promise<void> {
    try {
      await this.walkAndDeletePartials(
        this.audioDir
      );
    } catch (error) {
      console.warn(
        'DownloadManager: failed to clean partial files:',
        error
      );
    }
  }

  private async walkAndDeletePartials(
    dir: string
  ): Promise<void> {
    let entries: string[];

    try {
      entries =
        await FileSystem.readDirectoryAsync(
          dir
        );
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = `${dir}${entry}`;

      const info =
        await FileSystem.getInfoAsync(
          path
        );

      if (!info.exists) {
        continue;
      }

      if (info.isDirectory) {
        await this.walkAndDeletePartials(
          `${path}/`
        );
      } else if (
        entry.endsWith(
          PART_SUFFIX
        ) ||
        entry.endsWith(
          STATUS_TMP_SUFFIX
        )
      ) {
        await FileSystem.deleteAsync(
          path,
          {
            idempotent: true,
          }
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Shared-storage restoration
  // ---------------------------------------------------------------------------

  private async syncWithSharedStorage(): Promise<void> {
    if (
      Platform.OS === 'android' &&
      sharedStorage &&
      (await this.hasSharedStoragePermission())
    ) {
      try {
        const files =
          await sharedStorage.listAudioFiles();

        for (const rel of files) {
          const match =
            rel.match(
              /^quran-audio\/Surah(\d+)\/(arabic|english)\/(\d+)\.mp3$/
            );

          if (!match) {
            continue;
          }

          const surahNumber =
            parseInt(
              match[1],
              10
            );

          const type =
            match[2] as AudioType;

          const ayahNumber =
            parseInt(
              match[3],
              10
            );

          if (
            !isValidPositiveInt(
              surahNumber
            ) ||
            !isValidPositiveInt(
              ayahNumber
            )
          ) {
            continue;
          }

          const key =
            this.getAudioKey(
              surahNumber,
              ayahNumber,
              type
            );

          const existing =
            await this.getVerifiedLocalPath(
              surahNumber,
              ayahNumber,
              type
            );

          if (existing) {
            this.statusCache[key] = {
              downloaded: true,
              progress: 1,
              filePath: existing,
              lastUpdated:
                Date.now(),
            };

            continue;
          }

          const destPath =
            `${this.audioDir}${this.getFileName(
              surahNumber,
              ayahNumber,
              type
            )}`;

          const restored =
            await sharedStorage.restoreAudioFile(
              `Surah${surahNumber}/${type}`,
              `${ayahNumber}.mp3`,
              destPath
            );

          if (restored) {
            const valid =
              await this.isValidAudioFile(
                destPath
              );

            if (valid) {
              this.statusCache[key] = {
                downloaded: true,
                progress: 1,
                filePath: destPath,
                lastUpdated:
                  Date.now(),
              };
            } else {
              await FileSystem.deleteAsync(
                destPath,
                {
                  idempotent: true,
                }
              );
            }
          }
        }
      } catch (error) {
        console.error(
          'DownloadManager: failed to restore MediaStore audio:',
          error
        );
      }
    }

    // SAF is the durable fallback and should always be attempted independently.
    await this.syncAudioFromSaf();
  }

  private async syncAudioFromSaf(): Promise<void> {
    const folder =
      await getBackupFolderUri();

    if (!folder) {
      return;
    }

    try {
      const files =
        await listAudioViaSaf(
          folder
        );

      let restoredAny = false;

      for (const file of files) {
        const key =
          this.getAudioKey(
            file.surahNumber,
            file.ayahNumber,
            file.type
          );

        const existing =
          await this.getVerifiedLocalPath(
            file.surahNumber,
            file.ayahNumber,
            file.type
          );

        if (existing) {
          this.statusCache[key] = {
            downloaded: true,
            progress: 1,
            filePath: existing,
            lastUpdated:
              Date.now(),
          };

          continue;
        }

        const destPath =
          `${this.audioDir}${this.getFileName(
            file.surahNumber,
            file.ayahNumber,
            file.type
          )}`;

        const restored =
          await restoreAudioViaSaf(
            folder,
            file,
            destPath
          );

        if (restored) {
          const valid =
            await this.isValidAudioFile(
              destPath
            );

          if (valid) {
            this.statusCache[key] = {
              downloaded: true,
              progress: 1,
              filePath: destPath,
              lastUpdated:
                Date.now(),
            };

            restoredAny = true;
          } else {
            await FileSystem.deleteAsync(
              destPath,
              {
                idempotent: true,
              }
            );
          }
        }
      }

      if (restoredAny) {
        this.invalidateSizeCache();
      }
    } catch (error) {
      console.error(
        'DownloadManager: failed to restore SAF audio:',
        error
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Shared-storage mirroring
  // ---------------------------------------------------------------------------

  private async mirrorAudioToSharedStorage(
    surahNumber: number,
    ayahNumber: number,
    type: AudioType,
    sourcePath: string
  ): Promise<void> {
    // MediaStore mirror.
    if (
      Platform.OS === 'android' &&
      sharedStorage &&
      (await this.hasSharedStoragePermission())
    ) {
      try {
        await sharedStorage.saveAudioFile(
          `Surah${surahNumber}/${type}`,
          `${ayahNumber}.mp3`,
          sourcePath
        );
      } catch (error) {
        console.warn(
          'DownloadManager: failed to mirror to MediaStore:',
          error
        );
      }
    }

    // SAF mirror.
    try {
      const folder =
        await getBackupFolderUri();

      if (folder) {
        await saveAudioViaSaf(
          folder,
          surahNumber,
          type,
          ayahNumber,
          sourcePath
        );
      }
    } catch (error) {
      console.warn(
        'DownloadManager: failed to mirror to SAF:',
        error
      );
    }
  }

  private async deleteFromSharedStorage(
    surahNumber: number,
    ayahNumber: number,
    type: AudioType
  ): Promise<void> {
    if (
      Platform.OS === 'android' &&
      sharedStorage &&
      (await this.hasSharedStoragePermission())
    ) {
      try {
        await sharedStorage.deleteAudioFile(
          `Surah${surahNumber}/${type}`,
          `${ayahNumber}.mp3`
        );
      } catch (error) {
        console.warn(
          'DownloadManager: failed to delete MediaStore audio:',
          error
        );
      }
    }

    try {
      const folder =
        await getBackupFolderUri();

      if (folder) {
        await deleteAudioViaSaf(
          folder,
          surahNumber,
          type,
          ayahNumber
        );
      }
    } catch (error) {
      console.warn(
        'DownloadManager: failed to delete SAF audio:',
        error
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Local disk reconciliation
  // ---------------------------------------------------------------------------

  private async syncWithDiskFiles(): Promise<void> {
    try {
      await this.ensureDirectoryExists();

      const files =
        await FileSystem.readDirectoryAsync(
          this.audioDir
        );

      for (const file of files) {
        const filePath =
          `${this.audioDir}${file}`;

        const fileInfo =
          await FileSystem.getInfoAsync(
            filePath
          );

        if (!fileInfo.exists) {
          continue;
        }

        if (fileInfo.isDirectory) {
          await this.syncHierarchicalDirectory(
            filePath,
            file
          );
        } else if (
          file.endsWith('.mp3')
        ) {
          await this.syncFlatFile(
            filePath,
            file
          );
        }
      }

      this.invalidateSizeCache();
    } catch (error) {
      console.error(
        'DownloadManager: failed to sync local files:',
        error
      );
    }
  }

  private async syncHierarchicalDirectory(
    dirPath: string,
    dirName: string
  ): Promise<void> {
    const surahNumber =
      parseInt(
        dirName.replace(
          'Surah',
          ''
        ),
        10
      );

    if (
      !isValidPositiveInt(
        surahNumber
      )
    ) {
      return;
    }

    try {
      const subFiles =
        await FileSystem.readDirectoryAsync(
          dirPath
        );

      for (const subFile of subFiles) {
        const subPath =
          `${dirPath}/${subFile}`;

        const subInfo =
          await FileSystem.getInfoAsync(
            subPath
          );

        if (
          subInfo.exists &&
          subInfo.isDirectory &&
          (
            subFile === 'arabic' ||
            subFile === 'english'
          )
        ) {
          await this.syncLanguageDirectory(
            subPath,
            surahNumber,
            subFile as AudioType
          );
        }
      }
    } catch (error) {
      console.error(
        `DownloadManager: failed to sync ${dirName}:`,
        error
      );
    }
  }

  private async syncLanguageDirectory(
    langPath: string,
    surahNumber: number,
    type: AudioType
  ): Promise<void> {
    try {
      const audioFiles =
        await FileSystem.readDirectoryAsync(
          langPath
        );

      for (const audioFile of audioFiles) {
        if (
          !audioFile.endsWith('.mp3') ||
          audioFile.endsWith(
            PART_SUFFIX
          )
        ) {
          continue;
        }

        const ayahNumber =
          parseInt(
            audioFile.replace(
              '.mp3',
              ''
            ),
            10
          );

        if (
          !isValidPositiveInt(
            ayahNumber
          )
        ) {
          continue;
        }

        const filePath =
          `${langPath}/${audioFile}`;

        if (
          await this.isValidAudioFile(
            filePath
          )
        ) {
          const key =
            this.getAudioKey(
              surahNumber,
              ayahNumber,
              type
            );

          this.statusCache[key] = {
            downloaded: true,
            progress: 1,
            filePath,
            lastUpdated:
              Date.now(),
          };
        }
      }
    } catch (error) {
      console.error(
        `DownloadManager: failed to sync ${type} for Surah ${surahNumber}:`,
        error
      );
    }
  }

  private async syncFlatFile(
    filePath: string,
    fileName: string
  ): Promise<void> {
    try {
      const parts =
        fileName
          .replace(
            '.mp3',
            ''
          )
          .split('_');

      if (parts.length !== 3) {
        return;
      }

      const surahNumber =
        parseInt(parts[0], 10);

      const ayahNumber =
        parseInt(parts[1], 10);

      const type =
        parts[2] as AudioType;

      if (
        !isValidPositiveInt(
          surahNumber
        ) ||
        !isValidPositiveInt(
          ayahNumber
        ) ||
        (
          type !== 'arabic' &&
          type !== 'english'
        )
      ) {
        return;
      }

      if (
        await this.isValidAudioFile(
          filePath
        )
      ) {
        const key =
          this.getAudioKey(
            surahNumber,
            ayahNumber,
            type
          );

        this.statusCache[key] = {
          downloaded: true,
          progress: 1,
          filePath,
          lastUpdated:
            Date.now(),
        };
      }
    } catch (error) {
      console.error(
        `DownloadManager: failed to sync ${fileName}:`,
        error
      );
    }
  }

  private async isValidAudioFile(
    filePath: string
  ): Promise<boolean> {
    try {
      const info =
        await FileSystem.getInfoAsync(
          filePath
        );

      return (
        info.exists === true &&
        info.isDirectory !== true &&
        typeof info.size === 'number' &&
        info.size >
        MIN_VALID_FILE_SIZE
      );
    } catch {
      return false;
    }
  }

  private async getVerifiedLocalPath(
    surahNumber: number,
    ayahNumber: number,
    type: AudioType
  ): Promise<string | null> {
    const expectedPath =
      `${this.audioDir}${this.getFileName(
        surahNumber,
        ayahNumber,
        type
      )}`;

    if (
      await this.isValidAudioFile(
        expectedPath
      )
    ) {
      return expectedPath;
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Status persistence
  // ---------------------------------------------------------------------------

  private async writeStatusToDisk(): Promise<void> {
    try {
      await this.ensureDirectoryExists();

      const optimizedStatus: Record<
        string,
        {
          downloaded: boolean;
          filePath?: string;
          lastUpdated: number;
        }
      > = {};

      for (const [
        key,
        status,
      ] of Object.entries(
        this.statusCache
      )) {
        if (
          status.downloaded ||
          status.progress > 0
        ) {
          optimizedStatus[key] = {
            downloaded:
              status.downloaded,

            filePath:
              status.downloaded
                ? status.filePath
                : undefined,

            lastUpdated:
              status.lastUpdated,
          };
        }
      }

      const finalPath =
        `${this.audioDir}${DOWNLOAD_STATUS_KEY}`;

      const tmpPath =
        `${finalPath}${STATUS_TMP_SUFFIX}`;

      await FileSystem.writeAsStringAsync(
        tmpPath,
        JSON.stringify(
          optimizedStatus
        ),
        {
          encoding: 'utf8',
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
      console.error(
        'DownloadManager: failed to save status:',
        error
      );
    }
  }

  private async saveStatus(): Promise<void> {
    this.savePromiseChain =
      this.savePromiseChain.then(
        () =>
          this.writeStatusToDisk()
      );

    await this.savePromiseChain;
  }

  private debouncedSave(): void {
    if (this.saveTimeout) {
      clearTimeout(
        this.saveTimeout
      );
    }

    this.saveTimeout =
      setTimeout(() => {
        this.saveTimeout = null;

        this.saveStatus().catch(
          (error) => {
            console.error(
              'DownloadManager: debounced save failed:',
              error
            );
          }
        );
      }, 1000);
  }

  private saveStatusImmediate(): void {
    if (this.saveTimeout) {
      clearTimeout(
        this.saveTimeout
      );

      this.saveTimeout = null;
    }

    this.saveStatus().catch(
      () => { }
    );
  }

  // ---------------------------------------------------------------------------
  // Public status
  // ---------------------------------------------------------------------------

  async isDownloaded(
    surahNumber: number,
    ayahNumber: number,
    type: AudioType
  ): Promise<boolean> {
    this.assertValidIds(
      surahNumber,
      ayahNumber
    );

    await this.whenReady();

    const path =
      await this.getVerifiedLocalPath(
        surahNumber,
        ayahNumber,
        type
      );

    if (path) {
      const key =
        this.getAudioKey(
          surahNumber,
          ayahNumber,
          type
        );

      this.statusCache[key] = {
        downloaded: true,
        progress: 1,
        filePath: path,
        lastUpdated:
          Date.now(),
      };

      return true;
    }

    const key =
      this.getAudioKey(
        surahNumber,
        ayahNumber,
        type
      );

    if (this.statusCache[key]) {
      delete this.statusCache[key];
      this.debouncedSave();
    }

    return false;
  }

  async getLocalAudioPath(
    surahNumber: number,
    ayahNumber: number,
    type: AudioType
  ): Promise<string | null> {
    this.assertValidIds(
      surahNumber,
      ayahNumber
    );

    await this.whenReady();

    const path =
      await this.getVerifiedLocalPath(
        surahNumber,
        ayahNumber,
        type
      );

    if (path) {
      return path;
    }

    const key =
      this.getAudioKey(
        surahNumber,
        ayahNumber,
        type
      );

    if (this.statusCache[key]) {
      delete this.statusCache[key];
      this.debouncedSave();
    }

    return null;
  }

  async getDownloadStatus(
    surahNumber: number,
    ayahNumber: number,
    type: AudioType
  ): Promise<number> {
    this.assertValidIds(
      surahNumber,
      ayahNumber
    );

    await this.whenReady();

    const key =
      this.getAudioKey(
        surahNumber,
        ayahNumber,
        type
      );

    const status =
      this.statusCache[key];

    if (!status) {
      return 0;
    }

    if (status.downloaded) {
      const valid =
        await this.isDownloaded(
          surahNumber,
          ayahNumber,
          type
        );

      return valid ? 1 : 0;
    }

    return Math.max(
      0,
      Math.min(
        1,
        status.progress ?? 0
      )
    );
  }

  async getSurahDownloadProgress(
    surahNumber: number,
    totalAyats: number,
    ayahStart?: number
  ): Promise<number> {
    await this.whenReady();

    if (totalAyats <= 0) {
      return 0;
    }

    const start =
      ayahStart ?? 1;

    const ayahNumbers =
      Array.from(
        {
          length: totalAyats,
        },
        (_, i) => start + i
      );

    const results =
      await runWithConcurrencyLimit(
        ayahNumbers,
        8,
        async (ayahNumber) => {
          const [
            arabic,
            english,
          ] =
            await Promise.all([
              this.isDownloaded(
                surahNumber,
                ayahNumber,
                'arabic'
              ),

              this.isDownloaded(
                surahNumber,
                ayahNumber,
                'english'
              ),
            ]);

          return (
            arabic &&
            english
          );
        }
      );

    return (
      results.filter(Boolean)
        .length /
      totalAyats
    );
  }

  getSurahDownloadInfo(
    surahNumber: number,
    totalAyats: number,
    ayahStart?: number
  ): {
    downloadedAyahs: number;
    full: boolean;
    arabicCount: number;
    englishCount: number;
  } {
    let downloadedAyahs = 0;
    let arabicCount = 0;
    let englishCount = 0;

    const start =
      ayahStart ?? 1;

    for (
      let i = 0;
      i < totalAyats;
      i++
    ) {
      const globalNumber =
        start + i;

      const arabic =
        this.statusCache[
          this.getAudioKey(
            surahNumber,
            globalNumber,
            'arabic'
          )
        ]?.downloaded ??
        false;

      const english =
        this.statusCache[
          this.getAudioKey(
            surahNumber,
            globalNumber,
            'english'
          )
        ]?.downloaded ??
        false;

      if (arabic) {
        arabicCount++;
      }

      if (english) {
        englishCount++;
      }

      if (
        arabic &&
        english
      ) {
        downloadedAyahs++;
      }
    }

    return {
      downloadedAyahs,
      full:
        downloadedAyahs ===
        totalAyats,
      arabicCount,
      englishCount,
    };
  }

  isSurahDownloading(
    surahNumber: number
  ): boolean {
    return this.downloadingSurahs.has(
      surahNumber
    );
  }

  getDownloadingSurahs(): Set<number> {
    return new Set(
      this.downloadingSurahs
    );
  }

  getSurahLiveStatus(
    surahNumber: number,
    totalAyats: number,
    ayahStart?: number
  ): {
    arabicProgress: number;
    englishProgress: number;
    arabicCount: number;
    englishCount: number;
    downloadedCount: number;
    totalProgress: number;
  } {
    let arabicTotal = 0;
    let englishTotal = 0;

    let arabicDone = 0;
    let englishDone = 0;
    let bothDone = 0;

    const start =
      ayahStart ?? 1;

    for (
      let i = 0;
      i < totalAyats;
      i++
    ) {
      const globalNumber =
        start + i;

      const arabic =
        this.statusCache[
        this.getAudioKey(
          surahNumber,
          globalNumber,
          'arabic'
        )
        ];

      const english =
        this.statusCache[
        this.getAudioKey(
          surahNumber,
          globalNumber,
          'english'
        )
        ];

      const ap =
        arabic
          ? arabic.downloaded
            ? 1
            : arabic.progress ??
            0
          : 0;

      const ep =
        english
          ? english.downloaded
            ? 1
            : english.progress ??
            0
          : 0;

      arabicTotal += ap;
      englishTotal += ep;

      if (ap >= 1) {
        arabicDone++;
      }

      if (ep >= 1) {
        englishDone++;
      }

      if (
        ap >= 1 &&
        ep >= 1
      ) {
        bothDone++;
      }
    }

    return {
      arabicProgress:
        totalAyats > 0
          ? arabicTotal /
          totalAyats
          : 0,

      englishProgress:
        totalAyats > 0
          ? englishTotal /
          totalAyats
          : 0,

      arabicCount:
        arabicDone,

      englishCount:
        englishDone,

      downloadedCount:
        bothDone,

      totalProgress:
        totalAyats > 0
          ? (arabicTotal +
            englishTotal) /
          (2 * totalAyats)
          : 0,
    };
  }

  getDownloadedSurahs(
    totalAyatsBySurah: Record<
      number,
      number
    >,
    startBySurah?: Record<
      number,
      number
    >
  ): Set<number> {
    const result =
      new Set<number>();

    for (const [
      surahStr,
      total,
    ] of Object.entries(
      totalAyatsBySurah
    )) {
      const surahNumber =
        Number(surahStr);

      if (
        !Number.isInteger(
          surahNumber
        ) ||
        total <= 0
      ) {
        continue;
      }

      if (
        this.getSurahDownloadInfo(
          surahNumber,
          total,
          startBySurah?.[
          surahNumber
          ]
        ).full
      ) {
        result.add(
          surahNumber
        );
      }
    }

    return result;
  }

  getStorageLocation(): string {
    if (
      Platform.OS ===
      'android'
    ) {
      return `/storage/emulated/0/Download/AyatFlow/quran-audio/`;
    }

    return this.audioDir;
  }

  async resyncFromSharedStorage(): Promise<void> {
    await this.whenReady();

    await this.syncWithSharedStorage();

    await this.saveStatus();

    this.emit({
      type: 'sync',
    });
  }

  private invalidateSizeCache(): void {
    this.sizeCache = null;
  }

  async getTotalStorageSize(): Promise<number> {
    await this.whenReady();

    try {
      const now = Date.now();

      if (
        this.sizeCache &&
        now -
        this.sizeCache.at <
        SIZE_CACHE_TTL_MS
      ) {
        return this.sizeCache.bytes;
      }

      const bytes =
        await this.getDirectorySize(
          this.audioDir
        );

      this.sizeCache = {
        bytes,
        at: now,
      };

      return bytes;
    } catch (error) {
      console.error(
        'DownloadManager: failed to calculate storage:',
        error
      );

      return (
        this.sizeCache?.bytes ??
        0
      );
    }
  }

  private async getDirectorySize(
    dirPath: string
  ): Promise<number> {
    try {
      const entries =
        await FileSystem.readDirectoryAsync(
          dirPath
        );

      let fileTotal = 0;
      const subDirs: string[] =
        [];

      for (const entry of entries) {
        const entryPath =
          `${dirPath}/${entry}`;

        const info =
          await FileSystem.getInfoAsync(
            entryPath
          );

        if (!info.exists) {
          continue;
        }

        if (info.isDirectory) {
          subDirs.push(
            entryPath
          );
        } else if (
          typeof info.size ===
          'number'
        ) {
          fileTotal +=
            info.size;
        }
      }

      const subTotals =
        await runWithConcurrencyLimit(
          subDirs,
          8,
          (dir) =>
            this.getDirectorySize(
              dir
            )
        );

      return (
        fileTotal +
        subTotals.reduce(
          (sum, n) =>
            sum + n,
          0
        )
      );
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Downloading
  // ---------------------------------------------------------------------------

  async downloadAudio(
    url: string,
    surahNumber: number,
    ayahNumber: number,
    type: AudioType,
    onProgress?: (
      progress: DownloadProgress
    ) => void,
    force = false
  ): Promise<string> {
    this.assertValidIds(
      surahNumber,
      ayahNumber
    );

    if (!url) {
      throw new Error(
        `No audio URL provided for Surah ${surahNumber}, ayah ${ayahNumber} (${type})`
      );
    }

    await this.whenReady();

    const key =
      this.getAudioKey(
        surahNumber,
        ayahNumber,
        type
      );

    const existing =
      this.inFlight.get(key);

    if (existing) {
      return existing;
    }

    this.cancelledDownloads.delete(
      key
    );

    const promise =
      this.downloadAudioInternal(
        url,
        surahNumber,
        ayahNumber,
        type,
        onProgress,
        force
      ).finally(() => {
        this.inFlight.delete(key);
        this.activeDownloads.delete(
          key
        );
        this.cancelledDownloads.delete(
          key
        );
      });

    this.inFlight.set(
      key,
      promise
    );

    return promise;
  }

  private async downloadAudioInternal(
    url: string,
    surahNumber: number,
    ayahNumber: number,
    type: AudioType,
    onProgress?: (
      progress: DownloadProgress
    ) => void,
    force = false
  ): Promise<string> {
    const key =
      this.getAudioKey(
        surahNumber,
        ayahNumber,
        type
      );

    const fileName =
      this.getFileName(
        surahNumber,
        ayahNumber,
        type
      );

    const filePath =
      `${this.audioDir}${fileName}`;

    const partPath =
      `${filePath}${PART_SUFFIX}`;

    await this.ensureDirectoryExists();

    const parentDir =
      filePath.substring(
        0,
        filePath.lastIndexOf('/')
      );

    await FileSystem.makeDirectoryAsync(
      parentDir,
      {
        intermediates: true,
      }
    );

    if (!force) {
      const existing =
        await this.getVerifiedLocalPath(
          surahNumber,
          ayahNumber,
          type
        );

      if (existing) {
        this.statusCache[key] = {
          downloaded: true,
          progress: 1,
          filePath: existing,
          lastUpdated:
            Date.now(),
        };

        return existing;
      }
    }

    await FileSystem.deleteAsync(
      partPath,
      {
        idempotent: true,
      }
    );

    this.statusCache[key] = {
      downloaded: false,
      progress: 0,
      filePath,
      lastUpdated:
        Date.now(),
    };

    this.saveStatusImmediate();

    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= MAX_RETRIES;
      attempt++
    ) {
      if (
        this.cancelledDownloads.has(
          key
        )
      ) {
        throw new Error(
          'Download cancelled'
        );
      }

      try {
        const uri =
          await this.attemptDownload(
            url,
            partPath,
            key,
            surahNumber,
            ayahNumber,
            type,
            onProgress,
            attempt
          );

        if (
          this.cancelledDownloads.has(
            key
          )
        ) {
          await FileSystem.deleteAsync(
            partPath,
            {
              idempotent: true,
            }
          );

          throw new Error(
            'Download cancelled'
          );
        }

        if (
          !(await this.isValidAudioFile(
            uri
          ))
        ) {
          throw new Error(
            'Downloaded file is missing, empty, or too small to be valid audio'
          );
        }

        /*
         * IMPORTANT:
         *
         * Never delete the existing valid file before the new download has
         * been validated. This makes force-redownload safe.
         */
        const oldPath =
          filePath;

        if (force) {
          await FileSystem.deleteAsync(
            oldPath,
            {
              idempotent: true,
            }
          );
        }

        await FileSystem.moveAsync({
          from: uri,
          to: filePath,
        });

        if (
          !(await this.isValidAudioFile(
            filePath
          ))
        ) {
          throw new Error(
            'Downloaded file failed final validation'
          );
        }

        this.statusCache[key] = {
          downloaded: true,
          progress: 1,
          filePath,
          lastUpdated:
            Date.now(),
        };

        this.saveStatusImmediate();

        this.emit({
          type: 'fileComplete',
          surahNumber,
          ayahNumber,
          audioType: type,
        });

        /*
         * Persistence mirror is awaited.
         *
         * This is intentional. A "completed" download should mean that
         * AyatFlow has at least attempted its durable mirror before returning.
         *
         * Failure to mirror does NOT fail playback/download.
         */
        await this.mirrorAudioToSharedStorage(
          surahNumber,
          ayahNumber,
          type,
          filePath
        );

        return filePath;
      } catch (error) {
        lastError = error;

        console.warn(
          `DownloadManager: attempt ${attempt}/${MAX_RETRIES} failed for ${key}:`,
          error instanceof Error
            ? error.message
            : error
        );

        await FileSystem.deleteAsync(
          partPath,
          {
            idempotent: true,
          }
        );

        if (
          this.cancelledDownloads.has(
            key
          )
        ) {
          throw new Error(
            'Download cancelled'
          );
        }

        if (
          attempt <
          MAX_RETRIES
        ) {
          await delay(
            RETRY_BASE_DELAY_MS *
            2 **
            (attempt - 1)
          );
        }
      }
    }

    delete this.statusCache[
      key
    ];

    this.saveStatusImmediate();

    const message =
      lastError instanceof Error
        ? lastError.message
        : `Failed to download ${type} audio for ayah ${ayahNumber}`;

    throw new Error(
      message
    );
  }

  private attemptDownload(
    url: string,
    partPath: string,
    key: string,
    surahNumber: number,
    ayahNumber: number,
    type: AudioType,
    onProgress?: (
      progress: DownloadProgress
    ) => void,
    attempt = 1
  ): Promise<string> {
    return new Promise<string>(
      (
        resolve,
        reject
      ) => {
        let settled = false;

        const timeoutMs =
          DOWNLOAD_TIMEOUT_MS *
          attempt;

        let timeoutId:
          ReturnType<
            typeof setTimeout
          >;

        const finishReject = (
          error: unknown
        ) => {
          if (settled) {
            return;
          }

          settled = true;

          clearTimeout(
            timeoutId
          );

          this.activeDownloads.delete(
            key
          );

          reject(
            error instanceof Error
              ? error
              : new Error(
                String(error)
              )
          );
        };

        const finishResolve = (
          uri: string
        ) => {
          if (settled) {
            return;
          }

          settled = true;

          clearTimeout(
            timeoutId
          );

          this.activeDownloads.delete(
            key
          );

          resolve(uri);
        };

        const downloadResumable =
          FileSystem.createDownloadResumable(
            url,
            partPath,
            {},
            (downloadProgress) => {
              if (settled) {
                return;
              }

              const total =
                downloadProgress.totalBytesExpectedToWrite ||
                0;

              const progress =
                total > 0
                  ? downloadProgress.totalBytesWritten /
                  total
                  : 0;

              this.statusCache[
                key
              ] = {
                ...this.statusCache[
                key
                ],

                downloaded:
                  false,

                progress:
                  Math.max(
                    0,
                    Math.min(
                      1,
                      progress
                    )
                  ),

                lastUpdated:
                  Date.now(),
              };

              this.emit({
                type: 'progress',
                surahNumber,
              });

              onProgress?.({
                surahNumber,
                ayahNumber,
                progress,
                totalBytes:
                  total,
                downloadedBytes:
                  downloadProgress.totalBytesWritten,
                type,
              });
            }
          );

        this.activeDownloads.set(
          key,
          downloadResumable
        );

        timeoutId =
          setTimeout(
            () => {
              if (settled) {
                return;
              }

              /*
               * cancelAsync() is important here.
               * pauseAsync() leaves a resumable native operation around.
               */
              downloadResumable
                .cancelAsync()
                .catch(() => { })
                .finally(() => {
                  finishReject(
                    new Error(
                      `Download timed out after ${Math.round(
                        timeoutMs / 1000
                      )}s`
                    )
                  );
                });
            },
            timeoutMs
          );

        downloadResumable
          .downloadAsync()
          .then((result) => {
            if (settled) {
              return;
            }

            if (
              !result?.uri
            ) {
              finishReject(
                new Error(
                  'Download did not return a file'
                )
              );

              return;
            }

            finishResolve(
              result.uri
            );
          })
          .catch((error) => {
            finishReject(
              error
            );
          });
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Cancellation
  // ---------------------------------------------------------------------------

  async cancelDownload(
    surahNumber: number,
    ayahNumber: number,
    type: AudioType
  ): Promise<void> {
    this.assertValidIds(
      surahNumber,
      ayahNumber
    );

    const key =
      this.getAudioKey(
        surahNumber,
        ayahNumber,
        type
      );

    this.cancelledDownloads.add(
      key
    );

    const handle =
      this.activeDownloads.get(
        key
      );

    if (handle) {
      try {
        await handle.cancelAsync();
      } catch {
        // Native operation may already have completed.
      }

      this.activeDownloads.delete(
        key
      );
    }

    const filePath =
      `${this.audioDir}${this.getFileName(
        surahNumber,
        ayahNumber,
        type
      )}`;

    const partPath =
      `${filePath}${PART_SUFFIX}`;

    await FileSystem.deleteAsync(
      partPath,
      {
        idempotent: true,
      }
    );

    /*
     * Only remove the final file if it wasn't a completed download.
     * Cancellation should never destroy an already-valid file.
     */
    const status =
      this.statusCache[key];

    if (!status?.downloaded) {
      await FileSystem.deleteAsync(
        filePath,
        {
          idempotent: true,
        }
      );

      delete this.statusCache[
        key
      ];
    } else {
      this.statusCache[key] = {
        ...status,
        downloaded: true,
        progress: 1,
        filePath,
        lastUpdated:
          Date.now(),
      };
    }

    this.saveStatusImmediate();

    this.emit({
      type: 'delete',
      surahNumber,
    });
  }

  // ---------------------------------------------------------------------------
  // Bulk downloads
  // ---------------------------------------------------------------------------

  async downloadSurahAudio(
    surahNumber: number,
    ayahs: Array<{
      number: number;
      audio: string;
      englishAudio: string;
    }>,
    onProgress?: (
      progress: DownloadProgress
    ) => void,
    force = false
  ): Promise<SurahDownloadResult> {
    if (
      !isValidPositiveInt(
        surahNumber
      )
    ) {
      throw new Error(
        `Invalid surah number: ${surahNumber}`
      );
    }

    const existing =
      this.surahDownloadPromises.get(
        surahNumber
      );

    if (existing) {
      return existing;
    }

    this.downloadingSurahs.add(
      surahNumber
    );

    this.cancelledSurahs.delete(
      surahNumber
    );

    this.emit({
      type: 'batchStart',
      surahNumber,
    });

    const promise =
      this.downloadSurahAudioInternal(
        surahNumber,
        ayahs,
        onProgress,
        force
      ).finally(() => {
        this.downloadingSurahs.delete(
          surahNumber
        );

        this.surahDownloadPromises.delete(
          surahNumber
        );

        this.cancelledSurahs.delete(
          surahNumber
        );

        this.emit({
          type: 'batchDone',
          surahNumber,
        });
      });

    this.surahDownloadPromises.set(
      surahNumber,
      promise
    );

    return promise;
  }

  private async downloadSurahAudioInternal(
    surahNumber: number,
    ayahs: Array<{
      number: number;
      audio: string;
      englishAudio: string;
    }>,
    onProgress?: (
      progress: DownloadProgress
    ) => void,
    force = false
  ): Promise<SurahDownloadResult> {
    type Job = {
      ayahNumber: number;
      type: AudioType;
      url: string;
    };

    const jobs: Job[] = [];

    for (const ayah of ayahs) {
      if (
        isValidPositiveInt(
          ayah.number
        ) &&
        ayah.audio
      ) {
        jobs.push({
          ayahNumber:
            ayah.number,
          type: 'arabic',
          url: ayah.audio,
        });
      }

      if (
        isValidPositiveInt(
          ayah.number
        ) &&
        ayah.englishAudio
      ) {
        jobs.push({
          ayahNumber:
            ayah.number,
          type: 'english',
          url:
            ayah.englishAudio,
        });
      }
    }

    const result: SurahDownloadResult =
    {
      succeeded: 0,
      failed: 0,
      cancelled: false,
      failedItems: [],
    };

    await runWithConcurrencyLimit(
      jobs,
      MAX_CONCURRENT_DOWNLOADS,
      async (job) => {
        if (
          this.cancelledSurahs.has(
            surahNumber
          )
        ) {
          result.cancelled =
            true;

          return;
        }

        try {
          await this.downloadAudio(
            job.url,
            surahNumber,
            job.ayahNumber,
            job.type,
            onProgress,
            force
          );

          result.succeeded++;
        } catch (error) {
          if (
            this.cancelledSurahs.has(
              surahNumber
            )
          ) {
            result.cancelled =
              true;

            return;
          }

          result.failed++;

          result.failedItems.push({
            ayahNumber:
              job.ayahNumber,

            type:
              job.type,

            error:
              error instanceof Error
                ? error.message
                : String(error),
          });

          console.error(
            `DownloadManager: failed to download ${job.type} audio for ayah ${job.ayahNumber}:`,
            error
          );
        }
      }
    );

    if (
      this.cancelledSurahs.has(
        surahNumber
      )
    ) {
      result.cancelled =
        true;
    }

    return result;
  }

  cancelSurahDownload(
    surahNumber: number
  ): void {
    this.cancelledSurahs.add(
      surahNumber
    );

    /*
     * Also cancel individual downloads belonging to this surah.
     * Jobs that have already started must not be allowed to continue and
     * resurrect the batch after the user pressed cancel.
     */
    for (const key of this.activeDownloads.keys()) {
      const prefix =
        `${surahNumber}-`;

      if (key.startsWith(prefix)) {
        this.cancelledDownloads.add(
          key
        );

        const handle =
          this.activeDownloads.get(
            key
          );

        handle
          ?.cancelAsync()
          .catch(() => { });

        this.activeDownloads.delete(
          key
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Deletion
  // ---------------------------------------------------------------------------

  async deleteAudio(
    surahNumber: number,
    ayahNumber: number,
    type: AudioType
  ): Promise<void> {
    this.assertValidIds(
      surahNumber,
      ayahNumber
    );

    const key =
      this.getAudioKey(
        surahNumber,
        ayahNumber,
        type
      );

    await this.cancelDownload(
      surahNumber,
      ayahNumber,
      type
    );

    const filePath =
      `${this.audioDir}${this.getFileName(
        surahNumber,
        ayahNumber,
        type
      )}`;

    try {
      await FileSystem.deleteAsync(
        filePath,
        {
          idempotent: true,
        }
      );

      await FileSystem.deleteAsync(
        `${filePath}${PART_SUFFIX}`,
        {
          idempotent: true,
        }
      );
    } catch (error) {
      console.error(
        'DownloadManager: failed to delete local audio:',
        error
      );
    }

    await this.deleteFromSharedStorage(
      surahNumber,
      ayahNumber,
      type
    );

    delete this.statusCache[
      key
    ];

    this.invalidateSizeCache();

    this.saveStatusImmediate();

    this.emit({
      type: 'delete',
      surahNumber,
    });
  }

  /**
   * Deletes all audio for a surah.
   *
   * `ayahStart` should be supplied when `ayah.number` is stored using the
   * global Quran-wide ayah numbering scheme.
   *
   * For backwards compatibility, when omitted this assumes 1..totalAyats.
   */
  async deleteSurahAudio(
    surahNumber: number,
    totalAyats: number,
    ayahStart = 1
  ): Promise<void> {
    if (
      !isValidPositiveInt(
        surahNumber
      ) ||
      totalAyats <= 0 ||
      !isValidPositiveInt(
        ayahStart
      )
    ) {
      throw new Error(
        'Invalid surah deletion parameters'
      );
    }

    this.cancelSurahDownload(
      surahNumber
    );

    const ayahNumbers =
      Array.from(
        {
          length: totalAyats,
        },
        (_, i) =>
          ayahStart + i
      );

    await runWithConcurrencyLimit(
      ayahNumbers,
      8,
      async (ayahNumber) => {
        await Promise.all([
          this.deleteAudio(
            surahNumber,
            ayahNumber,
            'arabic'
          ),

          this.deleteAudio(
            surahNumber,
            ayahNumber,
            'english'
          ),
        ]);
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Sharing
  // ---------------------------------------------------------------------------

  async shareAudios(
    surahNumbers: number[],
    languages: AudioType[],
    totalAyatsBySurah: Record<
      number,
      number
    >,
    startBySurah?: Record<
      number,
      number
    >
  ): Promise<void> {
    await this.whenReady();

    const unique =
      [
        ...new Set(
          surahNumbers
        ),
      ].filter(
        (n) =>
          Number.isInteger(n) &&
          n > 0
      );

    if (
      unique.length === 0
    ) {
      throw new Error(
        'No surahs selected to share'
      );
    }

    const wanted =
      new Set(
        languages.filter(
          (
            l
          ): l is AudioType =>
            l === 'arabic' ||
            l === 'english'
        )
      );

    if (
      wanted.size === 0
    ) {
      throw new Error(
        'No audio languages selected'
      );
    }

    const items: Array<{
      surahNumber: number;
      ayahNumber: number;
      type: AudioType;
      filePath: string;
    }> = [];

    for (const surahNumber of unique) {
      const total =
        totalAyatsBySurah[
        surahNumber
        ] ?? 0;

      if (total <= 0) {
        continue;
      }

      const start =
        startBySurah?.[
        surahNumber
        ] ?? 1;

      const ayahNumbers =
        Array.from(
          {
            length: total,
          },
          (_, i) =>
            start + i
        );

      await runWithConcurrencyLimit(
        ayahNumbers,
        8,
        async (ayahNumber) => {
          for (const type of wanted) {
            const path =
              await this.getLocalAudioPath(
                surahNumber,
                ayahNumber,
                type
              );

            if (path) {
              items.push({
                surahNumber,
                ayahNumber,
                type,
                filePath: path,
              });
            }
          }
        }
      );
    }

    if (
      items.length === 0
    ) {
      throw new Error(
        'No downloaded audio files found for the selected surahs'
      );
    }

    const isAvailable =
      await Sharing.isAvailableAsync();

    if (!isAvailable) {
      throw new Error(
        'Sharing is not available on this platform'
      );
    }

    const zipPath =
      await this.buildSelectionZip(
        unique,
        items
      );

    try {
      await Sharing.shareAsync(
        zipPath,
        {
          mimeType:
            'application/zip',

          dialogTitle:
            unique.length === 1
              ? `Share Surah ${unique[0]} audio`
              : 'Share Ayat Flow audio',
        }
      );
    } finally {
      await FileSystem.deleteAsync(
        zipPath,
        {
          idempotent: true,
        }
      ).catch(() => { });
    }
  }

  async shareSurahAudio(
    surahNumber: number,
    totalAyats: number,
    ayahStart = 1
  ): Promise<void> {
    await this.shareAudios(
      [surahNumber],
      [
        'arabic',
        'english',
      ],
      {
        [surahNumber]:
          totalAyats,
      },
      {
        [surahNumber]:
          ayahStart,
      }
    );
  }

  private async buildSelectionZip(
    surahNumbers: number[],
    items: Array<{
      surahNumber: number;
      ayahNumber: number;
      type: AudioType;
      filePath: string;
    }>
  ): Promise<string> {
    const stamp =
      surahNumbers.length === 1
        ? `Surah${surahNumbers[0]}`
        : 'AyatFlow-audio';

    const zipDir =
      `${FileSystem.cacheDirectory}share/`;

    const zipPath =
      `${zipDir}${stamp}.zip`;

    await FileSystem.makeDirectoryAsync(
      zipDir,
      {
        intermediates: true,
      }
    );

    await FileSystem.deleteAsync(
      zipPath,
      {
        idempotent: true,
      }
    );

    const nativeZipper =
      sharedStorage
        ?.zipAudioSelection;

    if (
      Platform.OS === 'android' &&
      typeof nativeZipper ===
      'function'
    ) {
      const includes =
        new Set<string>();

      for (const item of items) {
        includes.add(
          `Surah${item.surahNumber}/${item.type}`
        );
      }

      await nativeZipper(
        this.audioDir,
        Array.from(includes),
        zipPath
      );

      return zipPath;
    }

    /*
     * iOS fallback.
     *
     * The old implementation builds the entire ZIP in JS memory. Keep it for
     * compatibility, but explicitly reject archives that are too large to
     * safely construct in JS.
     */
    const MAX_JS_ZIP_BYTES =
      50 * 1024 * 1024;

    let estimatedSize = 0;

    for (const item of items) {
      const info =
        await FileSystem.getInfoAsync(
          item.filePath
        );

      if (
        info.exists &&
        typeof info.size ===
        'number'
      ) {
        estimatedSize +=
          info.size;
      }

      if (
        estimatedSize >
        MAX_JS_ZIP_BYTES
      ) {
        throw new Error(
          'This selection is too large to package on this platform. Please share a smaller selection.'
        );
      }
    }

    const files: Array<{
      name: string;
      bytes: Uint8Array;
    }> = [];

    for (const item of items) {
      files.push({
        name:
          `Surah${item.surahNumber}/${item.type}/${item.ayahNumber}.mp3`,

        bytes:
          await readFileBytes(
            item.filePath
          ),
      });
    }

    const archive =
      buildZipArchive(
        files
      );

    await FileSystem.writeAsStringAsync(
      zipPath,
      bytesToBase64(
        archive
      ),
      {
        encoding:
          FileSystem.EncodingType.Base64,
      }
    );

    return zipPath;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  async cleanup(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(
        this.saveTimeout
      );

      this.saveTimeout = null;

      await this.saveStatus();
    }
  }
}

// -----------------------------------------------------------------------------
// Singleton
// -----------------------------------------------------------------------------

let downloadManagerInstance:
  DownloadManager | null =
  null;

export function getDownloadManager(): DownloadManager {
  if (!downloadManagerInstance) {
    downloadManagerInstance =
      new DownloadManager();
  }

  return downloadManagerInstance;
}

export async function cleanupDownloadManager(): Promise<void> {
  if (
    downloadManagerInstance
  ) {
    await downloadManagerInstance.cleanup();
  }
}