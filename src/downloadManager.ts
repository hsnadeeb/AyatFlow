import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { sharedStorage, ensureSharedStoragePermission } from './sharedStorage';

const AUDIO_DIRECTORY = 'AyatFlow/quran-audio';
const DOWNLOAD_STATUS_KEY = 'ayah-flow:download-status';

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
};

class DownloadManager {
  private audioDir: string;
  private statusCache: DownloadStatus = {};
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.audioDir = this.getAudioDirectory();
    // loadStatus is async; hold onto the promise so every status check can
    // await it before trusting the (initially empty) cache. Otherwise a fast
    // "isDownloaded?" right after launch reports false and re-downloads.
    this.initPromise = this.loadStatus().catch(() => {});
  }

  /** Resolves once the status cache has been loaded and synced with disk. */
  private async whenReady(): Promise<void> {
    await this.initPromise;
  }

  private getAudioDirectory(): string {
    if (Platform.OS === 'android') {
      // Internal app storage holds the working copies used for playback.
      // Completed downloads are ALSO mirrored to shared storage
      // (/storage/emulated/0/Download/AyatFlow/quran-audio/) so they survive
      // app uninstall/reinstall and get restored on next launch.
      return `${FileSystem.documentDirectory}${AUDIO_DIRECTORY}/`;
    } else {
      // iOS app group directory or documents directory
      return `${FileSystem.documentDirectory}${AUDIO_DIRECTORY}/`;
    }
  }

  private async ensureDirectoryExists(): Promise<void> {
    const dirInfo = await FileSystem.getInfoAsync(this.audioDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(this.audioDir, { intermediates: true });
    }
  }

  private getAudioKey(surahNumber: number, ayahNumber: number, type: 'arabic' | 'english'): string {
    return `${surahNumber}-${ayahNumber}-${type}`;
  }

  private getFileName(surahNumber: number, ayahNumber: number, type: 'arabic' | 'english'): string {
    // Organize files by surah and language for better categorization
    return `Surah${surahNumber}/${type}/${ayahNumber}.mp3`;
  }

  private async loadStatus(): Promise<void> {
    try {
      const raw = await FileSystem.readAsStringAsync(
        `${this.audioDir}${DOWNLOAD_STATUS_KEY}`,
        { encoding: 'utf8' }
      );
      const loaded = JSON.parse(raw);
      
      // Reconstruct full status objects from optimized format
      this.statusCache = {};
      for (const [key, data] of Object.entries(loaded)) {
        const status = data as { downloaded: boolean; filePath?: string; lastUpdated: number };
        this.statusCache[key] = {
          downloaded: status.downloaded,
          progress: status.downloaded ? 1 : 0,
          filePath: status.filePath,
          lastUpdated: status.lastUpdated
        };
      }
    } catch (error) {
      // File doesn't exist yet, initialize empty cache
      this.statusCache = {};
    }
    
    // Sync with actual files on disk (for app reinstalls)
    await this.syncWithDiskFiles();
    await this.syncWithSharedStorage();
  }

  /**
   * Restore previously downloaded audio from shared storage after a fresh
   * install: any file found in Download/AyatFlow/quran-audio that is missing
   * from the app's working directory is copied back and marked as downloaded.
   */
  private async syncWithSharedStorage(): Promise<void> {
    if (!sharedStorage) return;
    if (!(await ensureSharedStoragePermission())) return;
    try {
      const files: string[] = await sharedStorage.listAudioFiles();
      for (const rel of files) {
        const match = rel.match(/^quran-audio\/Surah(\d+)\/(arabic|english)\/(\d+)\.mp3$/);
        if (!match) continue;
        const surahNumber = parseInt(match[1], 10);
        const type = match[2] as 'arabic' | 'english';
        const ayahNumber = parseInt(match[3], 10);
        const key = this.getAudioKey(surahNumber, ayahNumber, type);
        if (this.statusCache[key]?.downloaded) continue;

        const destPath = `${this.audioDir}${this.getFileName(surahNumber, ayahNumber, type)}`;
        // Native side already scopes to "Download/AyatFlow/quran-audio/",
        // so only pass the surah/language path here.
        const restored = await sharedStorage.restoreAudioFile(
          `Surah${surahNumber}/${type}`,
          `${ayahNumber}.mp3`,
          destPath
        );
        if (restored) {
          this.statusCache[key] = {
            downloaded: true,
            progress: 1,
            filePath: destPath,
            lastUpdated: Date.now()
          };
        }
      }
      this.debouncedSave();
    } catch (error) {
      console.error('Failed to sync audio with shared storage:', error);
    }
  }

  /**
   * Mirror a freshly downloaded file into shared storage so it survives
   * app reinstall. Fire-and-forget: playback never depends on this copy.
   */
  private async mirrorAudioToSharedStorage(
    surahNumber: number,
    ayahNumber: number,
    type: 'arabic' | 'english',
    sourcePath: string
  ): Promise<void> {
    if (!sharedStorage) return;
    if (!(await ensureSharedStoragePermission())) return;
    try {
      await sharedStorage.saveAudioFile(
        `Surah${surahNumber}/${type}`,
        `${ayahNumber}.mp3`,
        sourcePath
      );
    } catch (error) {
      console.warn('Failed to mirror audio to shared storage:', error);
    }
  }

  private async deleteFromSharedStorage(
    surahNumber: number,
    ayahNumber: number,
    type: 'arabic' | 'english'
  ): Promise<void> {
    if (!sharedStorage) return;
    if (!(await ensureSharedStoragePermission())) return;
    try {
      await sharedStorage.deleteAudioFile(
        `Surah${surahNumber}/${type}`,
        `${ayahNumber}.mp3`
      );
    } catch (error) {
      console.warn('Failed to delete audio from shared storage:', error);
    }
  }
  
  private async syncWithDiskFiles(): Promise<void> {
    try {
      await this.ensureDirectoryExists();
      const files = await FileSystem.readDirectoryAsync(this.audioDir);
      
      // Rebuild status cache based on actual files
      // Handle both flat structure (old) and hierarchical structure (new)
      for (const file of files) {
        const filePath = `${this.audioDir}${file}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        
        if (fileInfo.exists && fileInfo.isDirectory) {
          // This is a directory (new hierarchical structure)
          await this.syncHierarchicalDirectory(filePath, file);
        } else if (file.endsWith('.mp3')) {
          // This is a flat file (old structure)
          await this.syncFlatFile(filePath, file);
        }
      }
      
      // Save the synchronized status
      this.debouncedSave();
    } catch (error) {
      console.error('Failed to sync with disk files:', error);
    }
  }
  
  private async syncHierarchicalDirectory(dirPath: string, dirName: string): Promise<void> {
    try {
      // Extract surah number from directory name (e.g., "Surah1")
      const surahNumber = parseInt(dirName.replace('Surah', ''), 10);
      if (isNaN(surahNumber)) return;
      
      const subFiles = await FileSystem.readDirectoryAsync(dirPath);
      
      for (const subFile of subFiles) {
        const subPath = `${dirPath}/${subFile}`;
        const subInfo = await FileSystem.getInfoAsync(subPath);
        
        if (subInfo.exists && subInfo.isDirectory) {
          // This is a language directory (arabic or english)
          const type = subFile as 'arabic' | 'english';
          if (type === 'arabic' || type === 'english') {
            await this.syncLanguageDirectory(subPath, surahNumber, type);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to sync directory ${dirName}:`, error);
    }
  }
  
  private async syncLanguageDirectory(langPath: string, surahNumber: number, type: 'arabic' | 'english'): Promise<void> {
    try {
      const audioFiles = await FileSystem.readDirectoryAsync(langPath);
      
      for (const audioFile of audioFiles) {
        if (audioFile.endsWith('.mp3')) {
          const ayahNumber = parseInt(audioFile.replace('.mp3', ''), 10);
          if (!isNaN(ayahNumber)) {
            const filePath = `${langPath}/${audioFile}`;
            const fileInfo = await FileSystem.getInfoAsync(filePath);
            
            if (fileInfo.exists && fileInfo.size && fileInfo.size > 1000) {
              const key = this.getAudioKey(surahNumber, ayahNumber, type);
              this.statusCache[key] = {
                downloaded: true,
                progress: 1,
                filePath,
                lastUpdated: Date.now()
              };
            }
          }
        }
      }
    } catch (error) {
      console.error(`Failed to sync language directory for surah ${surahNumber}:`, error);
    }
  }
  
  private async syncFlatFile(filePath: string, fileName: string): Promise<void> {
    try {
      // Parse old format: {surahNumber}_{ayahNumber}_{type}.mp3
      const parts = fileName.replace('.mp3', '').split('_');
      if (parts.length === 3) {
        const surahNumber = parseInt(parts[0], 10);
        const ayahNumber = parseInt(parts[1], 10);
        const type = parts[2] as 'arabic' | 'english';
        
        if (!isNaN(surahNumber) && !isNaN(ayahNumber) && (type === 'arabic' || type === 'english')) {
          const fileInfo = await FileSystem.getInfoAsync(filePath);
          if (fileInfo.exists && fileInfo.size && fileInfo.size > 1000) {
            const key = this.getAudioKey(surahNumber, ayahNumber, type);
            this.statusCache[key] = {
              downloaded: true,
              progress: 1,
              filePath,
              lastUpdated: Date.now()
            };
          }
        }
      }
    } catch (error) {
      console.error(`Failed to sync flat file ${fileName}:`, error);
    }
  }

  private async saveStatus(): Promise<void> {
    try {
      await this.ensureDirectoryExists();
      
      // Optimize data by only saving essential information
      const optimizedStatus: Record<string, { downloaded: boolean; filePath?: string; lastUpdated: number }> = {};
      
      for (const [key, status] of Object.entries(this.statusCache)) {
        // Only save downloaded items or items in progress
        if (status.downloaded || status.progress > 0) {
          optimizedStatus[key] = {
            downloaded: status.downloaded,
            filePath: status.downloaded ? status.filePath : undefined,
            lastUpdated: status.lastUpdated
          };
        }
      }
      
      await FileSystem.writeAsStringAsync(
        `${this.audioDir}${DOWNLOAD_STATUS_KEY}`,
        JSON.stringify(optimizedStatus),
        { encoding: 'utf8' }
      );
    } catch (error) {
      console.error('Failed to save download status:', error);
    }
  }
  
  private debouncedSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveStatus();
      this.saveTimeout = null;
    }, 1000); // Save at most once per second
  }

  async isDownloaded(surahNumber: number, ayahNumber: number, type: 'arabic' | 'english'): Promise<boolean> {
    await this.whenReady();
    const key = this.getAudioKey(surahNumber, ayahNumber, type);
    const status = this.statusCache[key];
    
    // First check cache
    if (status?.downloaded && status.filePath) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(status.filePath);
        if (fileInfo.exists && fileInfo.size > 1000) {
          return true;
        } else {
          // File exists but is invalid, remove from cache
          delete this.statusCache[key];
          this.debouncedSave();
          return false;
        }
      } catch (error) {
        console.error('Error checking file existence:', error);
        return false;
      }
    }
    
    return false;
  }

  async getLocalAudioPath(surahNumber: number, ayahNumber: number, type: 'arabic' | 'english'): Promise<string | null> {
    await this.whenReady();
    const key = this.getAudioKey(surahNumber, ayahNumber, type);
    const status = this.statusCache[key];
    
    if (status?.downloaded && status.filePath) {
      const fileInfo = await FileSystem.getInfoAsync(status.filePath);
      if (fileInfo.exists) {
        return status.filePath;
      }
    }
    
    return null;
  }

  async downloadAudio(
    url: string,
    surahNumber: number,
    ayahNumber: number,
    type: 'arabic' | 'english',
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<string> {
    const key = this.getAudioKey(surahNumber, ayahNumber, type);
    const fileName = this.getFileName(surahNumber, ayahNumber, type);
    const filePath = `${this.audioDir}${fileName}`;

    await this.ensureDirectoryExists();

    // Create the per-surah/per-language subdirectories. Android's native
    // download task refuses to start when the target directory is missing,
    // which silently broke every download when the hierarchical layout was
    // introduced.
    const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
    await FileSystem.makeDirectoryAsync(parentDir, { intermediates: true });

    // Check if already downloaded and valid
    const existingPath = await this.getLocalAudioPath(surahNumber, ayahNumber, type);
    if (existingPath) {
      // Verify the file exists and has content
      const fileInfo = await FileSystem.getInfoAsync(existingPath);
      if (fileInfo.exists && fileInfo.size && fileInfo.size > 1000) {
        // File already exists and is valid, skip download
        return existingPath;
      } else {
        // Delete invalid file and update status
        await FileSystem.deleteAsync(existingPath, { idempotent: true });
        delete this.statusCache[key];
        this.debouncedSave();
      }
    }

    // Update status to downloading
    this.statusCache[key] = {
      downloaded: false,
      progress: 0,
      filePath,
      lastUpdated: Date.now()
    };
    this.debouncedSave();

    try {
      const downloadResumable = FileSystem.createDownloadResumable(
        url,
        filePath,
        {},
        (downloadProgress) => {
          const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
          this.statusCache[key] = {
            ...this.statusCache[key],
            progress,
            lastUpdated: Date.now()
          };
          
          if (onProgress) {
            onProgress({
              surahNumber,
              ayahNumber,
              progress,
              totalBytes: downloadProgress.totalBytesExpectedToWrite,
              downloadedBytes: downloadProgress.totalBytesWritten
            });
          }
        }
      );

      const result = await downloadResumable.downloadAsync();
      
      if (result && result.uri) {
        // Verify the downloaded file
        const fileInfo = await FileSystem.getInfoAsync(result.uri);
        if (!fileInfo.exists || fileInfo.size === 0) {
          throw new Error('Downloaded file is empty or missing');
        }
        
        // Update status to completed
        this.statusCache[key] = {
          downloaded: true,
          progress: 1,
          filePath: result.uri,
          lastUpdated: Date.now()
        };
        this.debouncedSave();

        // Mirror into shared storage so the download survives reinstalls
        this.mirrorAudioToSharedStorage(surahNumber, ayahNumber, type, result.uri);

        return result.uri;
      } else {
        throw new Error('Download failed');
      }
    } catch (error) {
      console.error(`Failed to download ${type} audio for ayah ${ayahNumber}:`, error);
      
      // Clean up failed download
      try {
        await FileSystem.deleteAsync(filePath, { idempotent: true });
      } catch (e) {
        // Ignore cleanup errors
      }
      
      delete this.statusCache[key];
      this.debouncedSave();
      
      throw error;
    }
  }

  async downloadSurahAudio(
    surahNumber: number,
    ayahs: Array<{ number: number; audio: string; englishAudio: string }>,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    const downloadPromises = [];

    for (const ayah of ayahs) {
      // Download Arabic audio
      if (ayah.audio) {
        downloadPromises.push(
          this.downloadAudio(ayah.audio, surahNumber, ayah.number, 'arabic', onProgress)
            .catch(error => console.error(`Failed to download Arabic audio for ayah ${ayah.number}:`, error))
        );
      }

      // Download English audio
      if (ayah.englishAudio) {
        downloadPromises.push(
          this.downloadAudio(ayah.englishAudio, surahNumber, ayah.number, 'english', onProgress)
            .catch(error => console.error(`Failed to download English audio for ayah ${ayah.number}:`, error))
        );
      }
    }

    await Promise.all(downloadPromises);
  }

  async getDownloadStatus(surahNumber: number, ayahNumber: number, type: 'arabic' | 'english'): Promise<number> {
    await this.whenReady();
    const key = this.getAudioKey(surahNumber, ayahNumber, type);
    const status = this.statusCache[key];
    if (!status) return 0;
    if (status.downloaded) {
      // Don't report "downloaded" for entries whose file vanished from disk.
      if (!status.filePath) return 0;
      const fileInfo = await FileSystem.getInfoAsync(status.filePath);
      if (!fileInfo.exists || !(fileInfo.size && fileInfo.size > 1000)) {
        delete this.statusCache[key];
        this.debouncedSave();
        return 0;
      }
      return 1;
    }
    return status.progress ?? 0;
  }

  getStorageLocation(): string {
    if (Platform.OS === 'android') {
      // Where the persistent copies live (shared storage, survives reinstall)
      return `/storage/emulated/0/Download/AyatFlow/quran-audio/`;
    } else {
      // For iOS, return the app documents directory path
      return this.audioDir;
    }
  }

  async getSurahDownloadProgress(surahNumber: number, totalAyats: number): Promise<number> {
    await this.whenReady();
    let downloadedCount = 0;
    
    for (let i = 1; i <= totalAyats; i++) {
      const arabicDownloaded = await this.isDownloaded(surahNumber, i, 'arabic');
      const englishDownloaded = await this.isDownloaded(surahNumber, i, 'english');
      
      if (arabicDownloaded && englishDownloaded) {
        downloadedCount++;
      }
    }
    
    return downloadedCount / totalAyats;
  }

  async deleteAudio(surahNumber: number, ayahNumber: number, type: 'arabic' | 'english'): Promise<void> {
    const key = this.getAudioKey(surahNumber, ayahNumber, type);
    const status = this.statusCache[key];
    
    if (status?.filePath) {
      try {
        await FileSystem.deleteAsync(status.filePath, { idempotent: true });
      } catch (error) {
        console.error('Failed to delete audio file:', error);
      }
    }

    this.deleteFromSharedStorage(surahNumber, ayahNumber, type);

    delete this.statusCache[key];
    this.debouncedSave();
  }

  async deleteSurahAudio(surahNumber: number, totalAyats: number): Promise<void> {
    for (let i = 1; i <= totalAyats; i++) {
      await this.deleteAudio(surahNumber, i, 'arabic');
      await this.deleteAudio(surahNumber, i, 'english');
    }
  }

  async getTotalStorageSize(): Promise<number> {
    await this.whenReady();
    try {
      const files = await FileSystem.readDirectoryAsync(this.audioDir);
      let totalSize = 0;

      for (const file of files) {
        const filePath = `${this.audioDir}${file}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        if (fileInfo.exists) {
          if (fileInfo.isDirectory) {
            totalSize += await this.getDirectorySize(filePath);
          } else if (fileInfo.size) {
            totalSize += fileInfo.size;
          }
        }
      }

      return totalSize;
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
  
  async cleanup(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      await this.saveStatus();
      this.saveTimeout = null;
    }
  }

  async shareAudioFile(surahNumber: number, ayahNumber: number, type: 'arabic' | 'english'): Promise<void> {
    const filePath = await this.getLocalAudioPath(surahNumber, ayahNumber, type);
    if (!filePath) {
      throw new Error('Audio file not found');
    }

    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        throw new Error('Sharing is not available on this platform');
      }

      await Sharing.shareAsync(filePath, {
        mimeType: 'audio/mpeg',
        dialogTitle: `Share Ayat ${ayahNumber} ${type} audio`,
      });
    } catch (error) {
      console.error('Failed to share audio file:', error);
      throw error;
    }
  }

  async shareSurahAudio(surahNumber: number, totalAyats: number): Promise<void> {
    // For now, share the first available audio file as a sample
    // In a full implementation, you might want to create a zip file
    for (let i = 1; i <= totalAyats; i++) {
      const arabicPath = await this.getLocalAudioPath(surahNumber, i, 'arabic');
      if (arabicPath) {
        await this.shareAudioFile(surahNumber, i, 'arabic');
        return;
      }
    }
    throw new Error('No downloaded audio files found for this surah');
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