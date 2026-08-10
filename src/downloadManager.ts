import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { NativeModules, Platform } from 'react-native';
import { sharedStorage, ensureSharedStoragePermission } from './sharedStorage';

const AUDIO_DIRECTORY = 'AyatFlow/quran-audio';
const DOWNLOAD_STATUS_KEY = 'ayah-flow:download-status';
const STATUS_TMP_SUFFIX = '.tmp';
const PART_SUFFIX = '.part';

/** Anything smaller than this is treated as a failed/corrupt download, not real audio. */
const MIN_VALID_FILE_SIZE = 1000;
/** How many files to download at once for a whole-surah download. Uncapped concurrency
 *  (e.g. 572 requests for Al-Baqarah) saturates the radio and starves every request. */
const MAX_CONCURRENT_DOWNLOADS = 4;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 800;
const PERMISSION_CACHE_TTL_MS = 5 * 60 * 1000;

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
  failedItems: Array<{ ayahNumber: number; type: AudioType; error: string }>;
};

function isValidPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `items` through `worker`, at most `limit` concurrently. Keeps bulk downloads
 *  (and bulk disk-stat checks) from stampeding the network or the filesystem. */
async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const current = cursor++;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------
// Minimal ZIP writer (STORED entries, no compression) — used only as an
// iOS fallback. Android zips natively (AyahPersistenceModule.zipAudioFiles)
// so surah-sized downloads never balloon the JS heap.
// ---------------------------------------------------------------------

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8Encode(str: string): Uint8Array {
  const utf8 = unescape(encodeURIComponent(str));
  const bytes = new Uint8Array(utf8.length);
  for (let i = 0; i < utf8.length; i++) {
    bytes[i] = utf8.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function readFileBytes(filePath: string): Promise<Uint8Array> {
  const base64 = await FileSystem.readAsStringAsync(filePath, { encoding: FileSystem.EncodingType.Base64 });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function buildZipArchive(files: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = utf8Encode(file.name);
    const crc = crc32(file.bytes);
    const size = file.bytes.length;

    const localHeader = new Uint8Array(30);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed to extract
    local.setUint16(6, 0x0800, true); // UTF-8 filenames
    local.setUint16(8, 0, true); // method: stored
    local.setUint16(12, 0x0021, true); // DOS date 1980-01-01
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra length

    const centralHeader = new Uint8Array(46);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true); // version needed to extract
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true); // method: stored
    central.setUint16(12, 0x0021, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true); // extra length
    central.setUint32(42, offset, true); // local header offset

    localParts.push(localHeader, nameBytes, file.bytes);
    centralParts.push(centralHeader, nameBytes);
    offset += 30 + nameBytes.length + size;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const end = new DataView(eocd.buffer);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); // entries on this disk
  end.setUint16(10, files.length, true); // total entries
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true); // central directory offset

  const archive = new Uint8Array(offset + centralSize + 22);
  let position = 0;
  for (const part of [...localParts, ...centralParts, eocd]) {
    archive.set(part, position);
    position += part.length;
  }
  return archive;
}

type DownloadResumableHandle = ReturnType<typeof FileSystem.createDownloadResumable>;

class DownloadManager {
  private audioDir: string;
  private statusCache: DownloadStatus = {};

  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Serializes writes to the status file so two saves can never interleave and corrupt it. */
  private savePromiseChain: Promise<void> = Promise.resolve();

  private initPromise: Promise<void>;

  /** In-flight downloads keyed by audio key, so two callers asking for the same file
   *  share one network request instead of racing to write the same path. */
  private inFlight = new Map<string, Promise<string>>();
  /** Active resumable handles, so a download can be cancelled by key. */
  private activeDownloads = new Map<string, DownloadResumableHandle>();
  /** Surahs whose bulk download has been asked to stop; checked between queued jobs. */
  private cancelledSurahs = new Set<number>();

  private sharedStoragePermission: { granted: boolean; checkedAt: number } | null = null;

  constructor() {
    this.audioDir = this.getAudioDirectory();
    this.initPromise = this.loadStatus().catch((error) => {
      console.error('DownloadManager: failed to initialize', error);
    });
  }

  /** Resolves once the status cache has been loaded and synced with disk. */
  private async whenReady(): Promise<void> {
    await this.initPromise;
  }

  private assertValidIds(surahNumber: number, ayahNumber: number): void {
    if (!isValidPositiveInt(surahNumber) || !isValidPositiveInt(ayahNumber)) {
      throw new Error(`Invalid surah/ayah number: ${surahNumber}/${ayahNumber}`);
    }
  }

  private getAudioDirectory(): string {
    // Internal app storage holds the working copies used for playback. On Android,
    // completed downloads are ALSO mirrored to shared storage
    // (/storage/emulated/0/Download/AyatFlow/quran-audio/) so they survive
    // app uninstall/reinstall and get restored on next launch.
    return `${FileSystem.documentDirectory}${AUDIO_DIRECTORY}/`;
  }

  private async ensureDirectoryExists(): Promise<void> {
    const dirInfo = await FileSystem.getInfoAsync(this.audioDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(this.audioDir, { intermediates: true });
    }
  }

  private getAudioKey(surahNumber: number, ayahNumber: number, type: AudioType): string {
    return `${surahNumber}-${ayahNumber}-${type}`;
  }

  private getFileName(surahNumber: number, ayahNumber: number, type: AudioType): string {
    return `Surah${surahNumber}/${type}/${ayahNumber}.mp3`;
  }

  // ---------------------------------------------------------------------
  // Shared-storage permission (cached — avoids re-prompting on every call)
  // ---------------------------------------------------------------------

  private async hasSharedStoragePermission(): Promise<boolean> {
    if (!sharedStorage) return false;
    const now = Date.now();
    if (this.sharedStoragePermission && now - this.sharedStoragePermission.checkedAt < PERMISSION_CACHE_TTL_MS) {
      return this.sharedStoragePermission.granted;
    }
    const granted = await ensureSharedStoragePermission().catch(() => false);
    this.sharedStoragePermission = { granted, checkedAt: now };
    return granted;
  }

  // ---------------------------------------------------------------------
  // Startup: load status, reconcile with disk, clean up crash leftovers
  // ---------------------------------------------------------------------

  private async loadStatus(): Promise<void> {
    await this.ensureDirectoryExists();
    const statusFilePath = `${this.audioDir}${DOWNLOAD_STATUS_KEY}`;

    try {
      const info = await FileSystem.getInfoAsync(statusFilePath);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(statusFilePath, { encoding: 'utf8' });
        try {
          const loaded = JSON.parse(raw);
          this.statusCache = {};
          for (const [key, data] of Object.entries(loaded)) {
            const status = data as { downloaded: boolean; filePath?: string; lastUpdated: number };
            this.statusCache[key] = {
              downloaded: !!status.downloaded,
              progress: status.downloaded ? 1 : 0,
              filePath: status.filePath,
              lastUpdated: status.lastUpdated ?? Date.now(),
            };
          }
        } catch (parseError) {
          // Corrupt status file. Don't crash startup, and don't trust the file — but
          // don't panic either: syncWithDiskFiles below rediscovers every completed
          // download directly from the files that actually exist on disk.
          console.error('DownloadManager: status file corrupt, rebuilding from disk', parseError);
          this.statusCache = {};
        }
      }
    } catch (error) {
      console.error('DownloadManager: failed to read status file', error);
      this.statusCache = {};
    }

    await this.syncWithDiskFiles();
    await this.syncWithSharedStorage();
    await this.cleanupStalePartialFiles();
  }

  /**
   * Downloads are written to a `.part` file and only moved to their real filename
   * after the completed file is validated. So any `.part` file found at startup can
   * only be debris from a session that was killed mid-download — always safe to purge.
   */
  private async cleanupStalePartialFiles(): Promise<void> {
    try {
      await this.walkAndDeletePartials(this.audioDir);
    } catch (error) {
      console.warn('DownloadManager: failed to clean up stale partial downloads', error);
    }
  }

  private async walkAndDeletePartials(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await FileSystem.readDirectoryAsync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = `${dir}${entry}`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) continue;
      if (info.isDirectory) {
        await this.walkAndDeletePartials(`${path}/`);
      } else if (entry.endsWith(PART_SUFFIX)) {
        await FileSystem.deleteAsync(path, { idempotent: true });
      }
    }
  }

  /**
   * Restore previously downloaded audio from shared storage after a fresh install:
   * any file found in Download/AyatFlow/quran-audio missing from the app's working
   * directory is copied back and marked as downloaded.
   */
  private async syncWithSharedStorage(): Promise<void> {
    if (!(await this.hasSharedStoragePermission())) return;
    try {
      const files: string[] = await sharedStorage!.listAudioFiles();
      for (const rel of files) {
        const match = rel.match(/^quran-audio\/Surah(\d+)\/(arabic|english)\/(\d+)\.mp3$/);
        if (!match) continue;
        const surahNumber = parseInt(match[1], 10);
        const type = match[2] as AudioType;
        const ayahNumber = parseInt(match[3], 10);
        const key = this.getAudioKey(surahNumber, ayahNumber, type);
        if (this.statusCache[key]?.downloaded) continue;

        const destPath = `${this.audioDir}${this.getFileName(surahNumber, ayahNumber, type)}`;
        const restored = await sharedStorage!.restoreAudioFile(
          `Surah${surahNumber}/${type}`,
          `${ayahNumber}.mp3`,
          destPath
        );
        if (restored) {
          this.statusCache[key] = { downloaded: true, progress: 1, filePath: destPath, lastUpdated: Date.now() };
        }
      }
      this.debouncedSave();
    } catch (error) {
      console.error('Failed to sync audio with shared storage:', error);
    }
  }

  private async mirrorAudioToSharedStorage(
    surahNumber: number,
    ayahNumber: number,
    type: AudioType,
    sourcePath: string
  ): Promise<void> {
    if (!(await this.hasSharedStoragePermission())) return;
    try {
      await sharedStorage!.saveAudioFile(`Surah${surahNumber}/${type}`, `${ayahNumber}.mp3`, sourcePath);
    } catch (error) {
      console.warn('Failed to mirror audio to shared storage:', error);
    }
  }

  private async deleteFromSharedStorage(surahNumber: number, ayahNumber: number, type: AudioType): Promise<void> {
    if (!(await this.hasSharedStoragePermission())) return;
    try {
      await sharedStorage!.deleteAudioFile(`Surah${surahNumber}/${type}`, `${ayahNumber}.mp3`);
    } catch (error) {
      console.warn('Failed to delete audio from shared storage:', error);
    }
  }

  private async syncWithDiskFiles(): Promise<void> {
    try {
      await this.ensureDirectoryExists();
      const files = await FileSystem.readDirectoryAsync(this.audioDir);

      for (const file of files) {
        const filePath = `${this.audioDir}${file}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);

        if (fileInfo.exists && fileInfo.isDirectory) {
          await this.syncHierarchicalDirectory(filePath, file);
        } else if (file.endsWith('.mp3')) {
          await this.syncFlatFile(filePath, file);
        }
      }

      this.debouncedSave();
    } catch (error) {
      console.error('Failed to sync with disk files:', error);
    }
  }

  private async syncHierarchicalDirectory(dirPath: string, dirName: string): Promise<void> {
    try {
      const surahNumber = parseInt(dirName.replace('Surah', ''), 10);
      if (isNaN(surahNumber)) return;

      const subFiles = await FileSystem.readDirectoryAsync(dirPath);
      for (const subFile of subFiles) {
        const subPath = `${dirPath}/${subFile}`;
        const subInfo = await FileSystem.getInfoAsync(subPath);
        if (subInfo.exists && subInfo.isDirectory && (subFile === 'arabic' || subFile === 'english')) {
          await this.syncLanguageDirectory(subPath, surahNumber, subFile as AudioType);
        }
      }
    } catch (error) {
      console.error(`Failed to sync directory ${dirName}:`, error);
    }
  }

  private async syncLanguageDirectory(langPath: string, surahNumber: number, type: AudioType): Promise<void> {
    try {
      const audioFiles = await FileSystem.readDirectoryAsync(langPath);
      for (const audioFile of audioFiles) {
        // `.part` files are always incomplete by construction — never treat as valid.
        if (!audioFile.endsWith('.mp3') || audioFile.endsWith(PART_SUFFIX)) continue;

        const ayahNumber = parseInt(audioFile.replace('.mp3', ''), 10);
        if (isNaN(ayahNumber)) continue;

        const filePath = `${langPath}/${audioFile}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        if (fileInfo.exists && fileInfo.size && fileInfo.size > MIN_VALID_FILE_SIZE) {
          const key = this.getAudioKey(surahNumber, ayahNumber, type);
          this.statusCache[key] = { downloaded: true, progress: 1, filePath, lastUpdated: Date.now() };
        }
      }
    } catch (error) {
      console.error(`Failed to sync language directory for surah ${surahNumber}:`, error);
    }
  }

  private async syncFlatFile(filePath: string, fileName: string): Promise<void> {
    try {
      const parts = fileName.replace('.mp3', '').split('_');
      if (parts.length !== 3) return;

      const surahNumber = parseInt(parts[0], 10);
      const ayahNumber = parseInt(parts[1], 10);
      const type = parts[2] as AudioType;

      if (isNaN(surahNumber) || isNaN(ayahNumber) || (type !== 'arabic' && type !== 'english')) return;

      const fileInfo = await FileSystem.getInfoAsync(filePath);
      if (fileInfo.exists && fileInfo.size && fileInfo.size > MIN_VALID_FILE_SIZE) {
        const key = this.getAudioKey(surahNumber, ayahNumber, type);
        this.statusCache[key] = { downloaded: true, progress: 1, filePath, lastUpdated: Date.now() };
      }
    } catch (error) {
      console.error(`Failed to sync flat file ${fileName}:`, error);
    }
  }

  // ---------------------------------------------------------------------
  // Status persistence — atomic write, serialized, debounced or immediate
  // ---------------------------------------------------------------------

  private async writeStatusToDisk(): Promise<void> {
    try {
      await this.ensureDirectoryExists();

      const optimizedStatus: Record<string, { downloaded: boolean; filePath?: string; lastUpdated: number }> = {};
      for (const [key, status] of Object.entries(this.statusCache)) {
        if (status.downloaded || status.progress > 0) {
          optimizedStatus[key] = {
            downloaded: status.downloaded,
            filePath: status.downloaded ? status.filePath : undefined,
            lastUpdated: status.lastUpdated,
          };
        }
      }

      const finalPath = `${this.audioDir}${DOWNLOAD_STATUS_KEY}`;
      const tmpPath = `${finalPath}${STATUS_TMP_SUFFIX}`;

      // Write-then-rename: a crash mid-write leaves the untouched old file (or nothing),
      // never a half-written, unparseable status file.
      await FileSystem.writeAsStringAsync(tmpPath, JSON.stringify(optimizedStatus), { encoding: 'utf8' });
      await FileSystem.deleteAsync(finalPath, { idempotent: true });
      await FileSystem.moveAsync({ from: tmpPath, to: finalPath });
    } catch (error) {
      console.error('Failed to save download status:', error);
    }
  }

  private async saveStatus(): Promise<void> {
    // Chain onto the previous save so concurrent callers can't interleave writes.
    this.savePromiseChain = this.savePromiseChain.then(() => this.writeStatusToDisk());
    await this.savePromiseChain;
  }

  private debouncedSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.saveStatus();
    }, 1000);
  }

  /** Persist right away — used for transitions that shouldn't be lost if the app dies
   *  a moment later (download started / completed / failed / deleted). */
  private saveStatusImmediate(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.saveStatus().catch(() => {});
  }

  // ---------------------------------------------------------------------
  // Public status queries
  // ---------------------------------------------------------------------

  async isDownloaded(surahNumber: number, ayahNumber: number, type: AudioType): Promise<boolean> {
    this.assertValidIds(surahNumber, ayahNumber);
    await this.whenReady();
    const key = this.getAudioKey(surahNumber, ayahNumber, type);
    const status = this.statusCache[key];
    if (!status?.downloaded || !status.filePath) return false;

    try {
      const fileInfo = await FileSystem.getInfoAsync(status.filePath);
      if (fileInfo.exists && fileInfo.size > MIN_VALID_FILE_SIZE) return true;
      delete this.statusCache[key];
      this.debouncedSave();
      return false;
    } catch (error) {
      console.error('Error checking file existence:', error);
      return false;
    }
  }

  async getLocalAudioPath(surahNumber: number, ayahNumber: number, type: AudioType): Promise<string | null> {
    this.assertValidIds(surahNumber, ayahNumber);
    await this.whenReady();
    const key = this.getAudioKey(surahNumber, ayahNumber, type);
    const status = this.statusCache[key];
    if (status?.downloaded && status.filePath) {
      const fileInfo = await FileSystem.getInfoAsync(status.filePath);
      if (fileInfo.exists) return status.filePath;
    }
    return null;
  }

  async getDownloadStatus(surahNumber: number, ayahNumber: number, type: AudioType): Promise<number> {
    this.assertValidIds(surahNumber, ayahNumber);
    await this.whenReady();
    const key = this.getAudioKey(surahNumber, ayahNumber, type);
    const status = this.statusCache[key];
    if (!status) return 0;
    if (status.downloaded) {
      if (!status.filePath) return 0;
      const fileInfo = await FileSystem.getInfoAsync(status.filePath);
      if (!fileInfo.exists || !(fileInfo.size && fileInfo.size > MIN_VALID_FILE_SIZE)) {
        delete this.statusCache[key];
        this.debouncedSave();
        return 0;
      }
      return 1;
    }
    return status.progress ?? 0;
  }

  /** Parallelized (not one-stat-call-per-ayah-in-sequence) — matters once a surah has
   *  hundreds of ayahs. */
  async getSurahDownloadProgress(surahNumber: number, totalAyats: number): Promise<number> {
    await this.whenReady();
    if (totalAyats <= 0) return 0;

    const ayahNumbers = Array.from({ length: totalAyats }, (_, i) => i + 1);
    const results = await runWithConcurrencyLimit(ayahNumbers, 8, async (ayahNumber) => {
      const [arabic, english] = await Promise.all([
        this.isDownloaded(surahNumber, ayahNumber, 'arabic'),
        this.isDownloaded(surahNumber, ayahNumber, 'english'),
      ]);
      return arabic && english;
    });

    return results.filter(Boolean).length / totalAyats;
  }

  getStorageLocation(): string {
    if (Platform.OS === 'android') {
      return `/storage/emulated/0/Download/AyatFlow/quran-audio/`;
    }
    return this.audioDir;
  }

  async getTotalStorageSize(): Promise<number> {
    await this.whenReady();
    try {
      return await this.getDirectorySize(this.audioDir);
    } catch (error) {
      console.error('Failed to calculate storage size:', error);
      return 0;
    }
  }

  private async getDirectorySize(dirPath: string): Promise<number> {
    try {
      const entries = await FileSystem.readDirectoryAsync(dirPath);
      let total = 0;
      for (const entry of entries) {
        const entryPath = `${dirPath}/${entry}`;
        const info = await FileSystem.getInfoAsync(entryPath);
        if (!info.exists) continue;
        if (info.isDirectory) {
          total += await this.getDirectorySize(entryPath);
        } else if (info.size) {
          total += info.size;
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------------
  // Downloading
  // ---------------------------------------------------------------------

  async downloadAudio(
    url: string,
    surahNumber: number,
    ayahNumber: number,
    type: AudioType,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<string> {
    this.assertValidIds(surahNumber, ayahNumber);
    if (!url) {
      throw new Error(`No audio URL provided for surah ${surahNumber} ayah ${ayahNumber} (${type})`);
    }

    await this.whenReady();

    const key = this.getAudioKey(surahNumber, ayahNumber, type);

    // If this exact file is already being downloaded, share that request instead of
    // starting a second one that writes to the same path.
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = this.downloadAudioInternal(url, surahNumber, ayahNumber, type, onProgress).finally(() => {
      this.inFlight.delete(key);
      this.activeDownloads.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  private async downloadAudioInternal(
    url: string,
    surahNumber: number,
    ayahNumber: number,
    type: AudioType,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<string> {
    const key = this.getAudioKey(surahNumber, ayahNumber, type);
    const fileName = this.getFileName(surahNumber, ayahNumber, type);
    const filePath = `${this.audioDir}${fileName}`;
    const partPath = `${filePath}${PART_SUFFIX}`;

    await this.ensureDirectoryExists();
    const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
    await FileSystem.makeDirectoryAsync(parentDir, { intermediates: true });

    const existingPath = await this.getLocalAudioPath(surahNumber, ayahNumber, type);
    if (existingPath) return existingPath;

    await FileSystem.deleteAsync(partPath, { idempotent: true });

    this.statusCache[key] = { downloaded: false, progress: 0, filePath, lastUpdated: Date.now() };
    this.saveStatusImmediate();

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const uri = await this.attemptDownload(url, partPath, key, surahNumber, ayahNumber, type, onProgress);

        // Validate BEFORE promoting the file to its real name. This is what guarantees
        // that a file at `filePath` is always a complete, playable download — never a
        // truncated one from an interrupted attempt.
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists || !info.size || info.size < MIN_VALID_FILE_SIZE) {
          throw new Error('Downloaded file is missing, empty, or too small to be valid audio');
        }

        await FileSystem.deleteAsync(filePath, { idempotent: true });
        await FileSystem.moveAsync({ from: uri, to: filePath });

        this.statusCache[key] = { downloaded: true, progress: 1, filePath, lastUpdated: Date.now() };
        this.saveStatusImmediate();

        // Fire-and-forget — playback never depends on this copy existing.
        this.mirrorAudioToSharedStorage(surahNumber, ayahNumber, type, filePath);

        return filePath;
      } catch (error) {
        lastError = error;
        console.warn(
          `DownloadManager: attempt ${attempt}/${MAX_RETRIES} failed for ${key}:`,
          error instanceof Error ? error.message : error
        );
        await FileSystem.deleteAsync(partPath, { idempotent: true });
        if (attempt < MAX_RETRIES) {
          await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }

    delete this.statusCache[key];
    this.saveStatusImmediate();

    const message =
      lastError instanceof Error ? lastError.message : `Failed to download ${type} audio for ayah ${ayahNumber}`;
    throw new Error(message);
  }

  private attemptDownload(
    url: string,
    partPath: string,
    key: string,
    surahNumber: number,
    ayahNumber: number,
    type: AudioType,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        const handle = this.activeDownloads.get(key);
        this.activeDownloads.delete(key);
        handle?.pauseAsync().catch(() => {});
        reject(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s`));
      }, DOWNLOAD_TIMEOUT_MS);

      const downloadResumable = FileSystem.createDownloadResumable(url, partPath, {}, (downloadProgress) => {
        if (settled) return;
        const total = downloadProgress.totalBytesExpectedToWrite || 0;
        const progress = total > 0 ? downloadProgress.totalBytesWritten / total : 0;
        this.statusCache[key] = { ...this.statusCache[key], progress, lastUpdated: Date.now() };
        onProgress?.({
          surahNumber,
          ayahNumber,
          progress,
          totalBytes: total,
          downloadedBytes: downloadProgress.totalBytesWritten,
          type,
        });
      });

      this.activeDownloads.set(key, downloadResumable);

      downloadResumable
        .downloadAsync()
        .then((result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          this.activeDownloads.delete(key);
          if (result?.uri) {
            resolve(result.uri);
          } else {
            reject(new Error('Download did not return a file'));
          }
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          this.activeDownloads.delete(key);
          reject(error);
        });
    });
  }

  /** Best-effort cancellation of a single in-progress download. */
  async cancelDownload(surahNumber: number, ayahNumber: number, type: AudioType): Promise<void> {
    const key = this.getAudioKey(surahNumber, ayahNumber, type);
    const handle = this.activeDownloads.get(key);
    if (handle) {
      try {
        await handle.pauseAsync();
      } catch {
        // Best-effort — nothing useful to do if the native side already finished/errored.
      }
      this.activeDownloads.delete(key);
    }
    delete this.statusCache[key];
    this.saveStatusImmediate();
  }

  /**
   * Downloads every ayah's audio for a surah, capped at MAX_CONCURRENT_DOWNLOADS in
   * flight at once, and reports a real result instead of silently swallowing failures.
   */
  async downloadSurahAudio(
    surahNumber: number,
    ayahs: Array<{ number: number; audio: string; englishAudio: string }>,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<SurahDownloadResult> {
    this.cancelledSurahs.delete(surahNumber);

    type Job = { ayahNumber: number; type: AudioType; url: string };
    const jobs: Job[] = [];
    for (const ayah of ayahs) {
      if (ayah.audio) jobs.push({ ayahNumber: ayah.number, type: 'arabic', url: ayah.audio });
      if (ayah.englishAudio) jobs.push({ ayahNumber: ayah.number, type: 'english', url: ayah.englishAudio });
    }

    const result: SurahDownloadResult = { succeeded: 0, failed: 0, cancelled: false, failedItems: [] };

    await runWithConcurrencyLimit(jobs, MAX_CONCURRENT_DOWNLOADS, async (job) => {
      if (this.cancelledSurahs.has(surahNumber)) {
        result.cancelled = true;
        return;
      }
      try {
        await this.downloadAudio(job.url, surahNumber, job.ayahNumber, job.type, onProgress);
        result.succeeded++;
      } catch (error) {
        result.failed++;
        result.failedItems.push({
          ayahNumber: job.ayahNumber,
          type: job.type,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`Failed to download ${job.type} audio for ayah ${job.ayahNumber}:`, error);
      }
    });

    this.cancelledSurahs.delete(surahNumber);
    return result;
  }

  /** Stops a bulk surah download: jobs already in flight finish, queued ones are skipped. */
  cancelSurahDownload(surahNumber: number): void {
    this.cancelledSurahs.add(surahNumber);
  }

  // ---------------------------------------------------------------------
  // Deletion
  // ---------------------------------------------------------------------

  async deleteAudio(surahNumber: number, ayahNumber: number, type: AudioType): Promise<void> {
    this.assertValidIds(surahNumber, ayahNumber);
    const key = this.getAudioKey(surahNumber, ayahNumber, type);
    const filePath = this.statusCache[key]?.filePath;

    // Stop any download in flight for this file first, so it can't finish and
    // resurrect the file right after we delete it.
    await this.cancelDownload(surahNumber, ayahNumber, type);

    if (filePath) {
      try {
        await FileSystem.deleteAsync(filePath, { idempotent: true });
        await FileSystem.deleteAsync(`${filePath}${PART_SUFFIX}`, { idempotent: true });
      } catch (error) {
        console.error('Failed to delete audio file:', error);
      }
    }

    this.deleteFromSharedStorage(surahNumber, ayahNumber, type);

    delete this.statusCache[key];
    this.saveStatusImmediate();
  }

  async deleteSurahAudio(surahNumber: number, totalAyats: number): Promise<void> {
    this.cancelSurahDownload(surahNumber);
    const ayahNumbers = Array.from({ length: totalAyats }, (_, i) => i + 1);
    await runWithConcurrencyLimit(ayahNumbers, 8, async (ayahNumber) => {
      await this.deleteAudio(surahNumber, ayahNumber, 'arabic');
      await this.deleteAudio(surahNumber, ayahNumber, 'english');
    });
  }

  // ---------------------------------------------------------------------
  // Sharing / lifecycle
  // ---------------------------------------------------------------------

  /**
   * Packages every downloaded ayah (Arabic AND English) for the surah into a
   * single ZIP archive and shares it, so the whole surah — not one sample
   * file — is what lands on the recipient. Android zips natively; iOS falls
   * back to a JS zip writer.
   */
  async shareSurahAudio(surahNumber: number, totalAyats: number): Promise<void> {
    await this.whenReady();

    const downloaded: Array<{ ayahNumber: number; type: AudioType; filePath: string }> = [];
    for (let i = 1; i <= totalAyats; i++) {
      const [arabic, english] = await Promise.all([
        this.getLocalAudioPath(surahNumber, i, 'arabic'),
        this.getLocalAudioPath(surahNumber, i, 'english'),
      ]);
      if (arabic) downloaded.push({ ayahNumber: i, type: 'arabic', filePath: arabic });
      if (english) downloaded.push({ ayahNumber: i, type: 'english', filePath: english });
    }

    if (downloaded.length === 0) {
      throw new Error('No downloaded audio files found for this surah');
    }

    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      throw new Error('Sharing is not available on this platform');
    }

    const zipPath = await this.buildSurahZip(surahNumber, downloaded);
    try {
      await Sharing.shareAsync(zipPath, {
        mimeType: 'application/zip',
        dialogTitle: `Share Surah ${surahNumber} audio`,
      });
    } finally {
      await FileSystem.deleteAsync(zipPath, { idempotent: true }).catch(() => {});
    }
  }

  private async buildSurahZip(
    surahNumber: number,
    downloaded: Array<{ ayahNumber: number; type: AudioType; filePath: string }>
  ): Promise<string> {
    const zipPath = `${FileSystem.cacheDirectory}share/Surah${surahNumber}.zip`;
    await FileSystem.makeDirectoryAsync(`${FileSystem.cacheDirectory}share`, { intermediates: true });
    await FileSystem.deleteAsync(zipPath, { idempotent: true });

    const nativeZipper = sharedStorage?.zipAudioFiles;
    if (Platform.OS === 'android' && typeof nativeZipper === 'function') {
      // Zip the whole surah folder natively — streams from disk, so even
      // Al-Baqarah-sized downloads never blow the JS heap.
      await nativeZipper(`${this.audioDir}Surah${surahNumber}`, zipPath);
      return zipPath;
    }

    // iOS (or an outdated native module): build the archive in JS.
    const files = [];
    for (const item of downloaded) {
      files.push({
        name: `Surah${surahNumber}/${item.type}/${item.ayahNumber}.mp3`,
        bytes: await readFileBytes(item.filePath),
      });
    }
    const archive = buildZipArchive(files);
    await FileSystem.writeAsStringAsync(zipPath, bytesToBase64(archive), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return zipPath;
  }

  async cleanup(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
      await this.saveStatus();
    }
  }
}

// Singleton instance
let downloadManagerInstance: DownloadManager | null = null;

export function getDownloadManager(): DownloadManager {
  if (!downloadManagerInstance) {
    downloadManagerInstance = new DownloadManager();
  }
  return downloadManagerInstance;
}

export async function cleanupDownloadManager(): Promise<void> {
  if (downloadManagerInstance) {
    await downloadManagerInstance.cleanup();
  }
}