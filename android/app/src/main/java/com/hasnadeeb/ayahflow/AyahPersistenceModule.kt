package com.hasnadeeb.ayahflow

import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings

import androidx.documentfile.provider.DocumentFile

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray

import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.URI
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream


/**
 * AyatFlow persistent storage bridge.
 *
 * Canonical shared-storage layout (all Android versions):
 *
 * /storage/emulated/0/Download/AyatFlow/
 * ├── data/
 * │   ├── bookmarks.json
 * │   ├── surah-bookmarks.json
 * │   ├── progress.json
 * │   ├── audio-prefs.json
 * │   ├── last.json
 * │   └── tafsir-language.json
 * ├── quran-audio/
 * │   └── SurahN/{arabic,english}/N.mp3
 * ├── tafsir/
 * │   └── {urdu,english}/N.json
 * └── backups/
 *     └── ayah-flow-backup.json
 *
 * IMPORTANT:
 * - Android 10+ shared files are written through MediaStore.
 * - Android 9- uses the legacy File API, also under Download/AyatFlow.
 * - SAF methods are available for a user-selected folder.
 * - SAF URI permissions are explicitly persisted.
 * - Large files are copied using streams rather than readBytes().
 */
class AyahPersistenceModule(
    private val appContext: ReactApplicationContext
) : ReactContextBaseJavaModule(appContext) {

    override fun getName(): String = "AyahPersistenceModule"

    companion object {
    private const val TAG = "AyahPersistenceModule"

    private const val BACKUP_FILE_NAME =
        "ayah-flow-backup.json"

    private const val ANCHOR_FILE_NAME =
        ".ayatflow"

    /*
     * Canonical shared-storage layout. Single source of truth.
     *
     *   Download/AyatFlow/
     *   ├── data/            bookmarks.json, surah-bookmarks.json, ...
     *   ├── quran-audio/     SurahN/{arabic,english}/N.mp3
     *   ├── tafsir/          {urdu,english}/N.json
     *   └── backups/         ayah-flow-backup.json
     *
     * MediaStore RELATIVE_PATH values for the public Downloads directory.
     *
     * Do not use Environment.DIRECTORY_DOWNLOADS here in a const val.
     * It is a runtime value, not a Kotlin compile-time constant.
     */
    private const val MEDIASTORE_ROOT =
        "Download/AyatFlow/"

    private const val DATA_ROOT =
        "Download/AyatFlow/data/"

    private const val AUDIO_ROOT =
        "Download/AyatFlow/quran-audio/"

    private const val TAFSIR_ROOT =
        "Download/AyatFlow/tafsir/"

    private const val BACKUPS_ROOT =
        "Download/AyatFlow/backups/"

    /*
     * Legacy (Android 9-) roots.
     *
     * The legacy layout now matches the canonical layout:
     * /storage/emulated/0/Download/AyatFlow/...
     *
     * These strings are relative to Environment.getExternalStorageDirectory().
     */
    private const val LEGACY_ROOT =
        "Download/AyatFlow"

    private const val LEGACY_DATA_ROOT =
        "$LEGACY_ROOT/data/"

    private const val LEGACY_AUDIO_ROOT =
        "$LEGACY_ROOT/quran-audio/"

    private const val LEGACY_TAFSIR_ROOT =
        "$LEGACY_ROOT/tafsir/"

    private const val LEGACY_BACKUPS_ROOT =
        "$LEGACY_ROOT/backups/"

    private const val BUFFER_SIZE =
        64 * 1024
}

    // -------------------------------------------------------------------------
    // All-files access
    // -------------------------------------------------------------------------

    /**
     * Returns whether MANAGE_EXTERNAL_STORAGE is currently granted.
     *
     * This is only relevant on Android 11+.
     *
     * The app does NOT require this permission for its normal MediaStore
     * operation. It is retained because the existing JS API exposes it.
     */
    @ReactMethod
    fun hasAllFilesAccess(promise: Promise) {
        try {
            val granted =
                Build.VERSION.SDK_INT < Build.VERSION_CODES.R ||
                    Environment.isExternalStorageManager()

            promise.resolve(granted)
        } catch (e: Exception) {
            promise.reject(
                "ALL_FILES_ACCESS_CHECK_FAILED",
                e.message,
                e
            )
        }
    }

    /**
     * Opens Android's settings page for this app's "All files access".
     */
    @ReactMethod
    fun requestAllFilesAccess(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                if (!Environment.isExternalStorageManager()) {
                    val intent = Intent(
                        Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:${appContext.packageName}")
                    ).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }

                    appContext.startActivity(intent)
                }
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "ALL_FILES_ACCESS_REQUEST_FAILED",
                e.message,
                e
            )
        }
    }

    // -------------------------------------------------------------------------
    // Folder helpers
    // -------------------------------------------------------------------------

    /**
     * Checks whether AyatFlow storage already contains something.
     *
     * On Android 10+ we query MediaStore instead of File.exists(), because
     * RELATIVE_PATH storage is MediaStore-backed.
     */
    @ReactMethod
    fun isAyatFlowFolderPresent(promise: Promise) {
        try {
            val exists = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                mediaStorePathExists(MEDIASTORE_ROOT)
            } else {
                legacyAyatFlowRoot().exists()
            }

            promise.resolve(exists)
        } catch (e: Exception) {
            promise.reject(
                "FOLDER_CHECK_FAILED",
                e.message,
                e
            )
        }
    }

    /**
     * Ensures the canonical AyatFlow storage structure exists and migrates any
     * files left in the legacy (pre-canonical) locations.
     *
     * Android 10+:
     * - Moves data files found in the old duplicated-prefix locations
     *   (Download/AyatFlow/data/AyatFlow/data/ and Download/AyatFlow/data/data/)
     *   into Download/AyatFlow/data/.
     * - Moves the old backup at Download/AyatFlow/ayah-flow-backup.json into
     *   Download/AyatFlow/backups/.
     * - Inserts a small durable anchor file into every canonical directory so
     *   MediaStore indexes them and file managers show the folder tree even on
     *   a pristine install with no user data yet. Anchors are never deleted.
     *
     * Android 9 and below:
     * - Moves the legacy /storage/emulated/0/AyatFlow tree into
     *   /storage/emulated/0/Download/AyatFlow.
     * - Creates every canonical directory explicitly.
     */
    @ReactMethod
    fun ensureAyatFlowFolder(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                migrateMediaStoreLayout()
                ensureMediaStoreAnchors()
            } else {
                migrateLegacyFilesystemLayout()
                ensureLegacyFolders()
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "FOLDER_CREATE_FAILED",
                e.message,
                e
            )
        }
    }

    /**
     * The old implementation attempted:
     *
     * Uri.fromFile(dir)
     *
     * which is unsafe on modern Android and can throw FileUriExposedException.
     *
     * There is no universally reliable way to tell an arbitrary installed
     * file manager to open a filesystem directory using a file:// URI.
     *
     * Instead, this method opens the system document picker at a reasonable
     * location when possible.
     *
     * NOTE:
     * Android 11+ intentionally prevents apps from requesting the Download
     * root through ACTION_OPEN_DOCUMENT_TREE. This is therefore a picker,
     * not a direct "open Download/AyatFlow" operation.
     */
    @ReactMethod
    fun openAyatFlowFolder(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                    addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
                }

                if (intent.resolveActivity(appContext.packageManager) != null) {
                    appContext.startActivity(intent)
                    promise.resolve(true)
                } else {
                    promise.resolve(false)
                }
            } else {
                promise.resolve(false)
            }
        } catch (e: Exception) {
            promise.reject(
                "OPEN_FOLDER_FAILED",
                e.message,
                e
            )
        }
    }

    // -------------------------------------------------------------------------
    // Backup
    // -------------------------------------------------------------------------

    @ReactMethod
    fun saveBackup(
        data: String,
        promise: Promise
    ) {
        try {
            if (data.isBlank()) {
                promise.resolve(false)
                return
            }

            val bytes = data.toByteArray(Charsets.UTF_8)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeBytesViaMediaStore(
                    bytes = bytes,
                    relPath = BACKUPS_ROOT,
                    name = BACKUP_FILE_NAME,
                    mimeType = "application/json"
                )
            } else {
                writeBytesLegacy(
                    bytes,
                    "$LEGACY_BACKUPS_ROOT$BACKUP_FILE_NAME"
                )
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "SAVE_BACKUP_FAILED",
                e.message,
                e
            )
        }
    }

    @ReactMethod
    fun loadBackup(promise: Promise) {
        try {
            val data =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    readBytesViaMediaStore(
                        BACKUPS_ROOT,
                        BACKUP_FILE_NAME
                    )
                } else {
                    readLegacy(
                        "$LEGACY_BACKUPS_ROOT$BACKUP_FILE_NAME"
                    )
                }

            promise.resolve(
                data?.toString(Charsets.UTF_8)
            )
        } catch (e: Exception) {
            promise.reject(
                "LOAD_BACKUP_FAILED",
                e.message,
                e
            )
        }
    }

    // -------------------------------------------------------------------------
    // Per-file data mirroring
    // -------------------------------------------------------------------------

    /**
     * Saves one JSON data file into Download/AyatFlow/data/.
     *
     * `relativeDir` is a path relative to the data root (may be empty, which
     * means the file lives directly in Download/AyatFlow/data/).
     *
     * IMPORTANT:
     * Callers must NOT pass a full path such as "AyatFlow/data" or
     * "Download/AyatFlow/data/..." — that duplicates the DATA_ROOT prefix.
     */
    @ReactMethod
    fun saveDataFile(
        relativeDir: String,
        dataFileName: String,
        content: String,
        promise: Promise
    ) {
        try {
            if (content.isEmpty()) {
                promise.resolve(false)
                return
            }

            validateDataRelativeDir(relativeDir)
            validateFileName(dataFileName)

            val bytes = content.toByteArray(Charsets.UTF_8)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeBytesViaMediaStore(
                    bytes = bytes,
                    relPath = buildRelPath(DATA_ROOT, relativeDir),
                    name = dataFileName,
                    mimeType = "application/json"
                )
            } else {
                writeBytesLegacy(
                    bytes,
                    buildLegacyRelPath(LEGACY_DATA_ROOT, relativeDir, dataFileName)
                )
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "SAVE_DATA_FAILED",
                e.message,
                e
            )
        }
    }

    @ReactMethod
    fun readDataFile(
        relativeDir: String,
        dataFileName: String,
        promise: Promise
    ) {
        try {
            validateDataRelativeDir(relativeDir)
            validateFileName(dataFileName)

            val data =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    readBytesViaMediaStore(
                        buildRelPath(DATA_ROOT, relativeDir),
                        dataFileName
                    )
                } else {
                    readLegacy(
                        buildLegacyRelPath(LEGACY_DATA_ROOT, relativeDir, dataFileName)
                    )
                }

            promise.resolve(
                data?.toString(Charsets.UTF_8)
            )
        } catch (e: Exception) {
            promise.reject(
                "READ_DATA_FAILED",
                e.message,
                e
            )
        }
    }

    @ReactMethod
    fun deleteDataFile(
        relativeDir: String,
        dataFileName: String,
        promise: Promise
    ) {
        try {
            validateDataRelativeDir(relativeDir)
            validateFileName(dataFileName)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                deleteMediaStoreFile(
                    buildRelPath(DATA_ROOT, relativeDir),
                    dataFileName
                )
            } else {
                deleteLegacy(
                    buildLegacyRelPath(LEGACY_DATA_ROOT, relativeDir, dataFileName)
                )
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "DELETE_DATA_FAILED",
                e.message,
                e
            )
        }
    }

    // -------------------------------------------------------------------------
    // Audio mirroring
    // -------------------------------------------------------------------------

    /**
     * Copies an app-private audio file into shared storage.
     *
     * IMPORTANT:
     * This implementation streams the file instead of source.readBytes().
     * That prevents large MP3 files from being duplicated entirely in RAM.
     */
    @ReactMethod
    fun saveAudioFile(
        relativeDir: String,
        audioName: String,
        sourcePath: String,
        promise: Promise
    ) {
        try {
            validateRelativePath(relativeDir)
            validateFileName(audioName)

            val source = resolveSourceFile(sourcePath)

            if (!source.exists() || !source.isFile || source.length() == 0L) {
                throw IOException(
                    "Source audio file missing or empty: $sourcePath"
                )
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val relPath =
                    "$AUDIO_ROOT${cleanRelativePath(relativeDir)}/"

                copyFileToMediaStore(
                    source,
                    relPath,
                    audioName,
                    "audio/mpeg"
                )
            } else {
                val destination = File(
                    sharedStorageRoot(),
                    buildLegacyRelPath(LEGACY_AUDIO_ROOT, relativeDir, audioName)
                )

                copyFile(
                    source,
                    destination
                )
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "SAVE_AUDIO_FAILED",
                e.message,
                e
            )
        }
    }

    /**
     * Restores a shared-storage audio file into app storage.
     */
    @ReactMethod
    fun restoreAudioFile(
        relativeDir: String,
        audioName: String,
        destPath: String,
        promise: Promise
    ) {
        try {
            validateRelativePath(relativeDir)
            validateFileName(audioName)

            val destination = resolveSourceFile(destPath)
            destination.parentFile?.mkdirs()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val sourceUri = findMediaStoreUri(
                    "$AUDIO_ROOT${cleanRelativePath(relativeDir)}/",
                    audioName
                )

                if (sourceUri == null) {
                    promise.resolve(false)
                    return
                }

                appContext.contentResolver.openInputStream(
                    sourceUri
                )?.use { input ->
                    FileOutputStream(destination).use { output ->
                        copyStream(input, output)
                    }
                } ?: throw IOException(
                    "Unable to open shared audio file"
                )
            } else {
                val source = File(
                    sharedStorageRoot(),
                    buildLegacyRelPath(LEGACY_AUDIO_ROOT, relativeDir, audioName)
                )

                if (!source.exists() || !source.isFile) {
                    promise.resolve(false)
                    return
                }

                copyFile(
                    source,
                    destination
                )
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "RESTORE_AUDIO_FAILED",
                e.message,
                e
            )
        }
    }

    @ReactMethod
    fun deleteAudioFile(
        relativeDir: String,
        audioName: String,
        promise: Promise
    ) {
        try {
            validateRelativePath(relativeDir)
            validateFileName(audioName)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                deleteMediaStoreFile(
                    "$AUDIO_ROOT${cleanRelativePath(relativeDir)}/",
                    audioName
                )
            } else {
                deleteLegacy(
                    buildLegacyRelPath(LEGACY_AUDIO_ROOT, relativeDir, audioName)
                )
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "DELETE_AUDIO_FAILED",
                e.message,
                e
            )
        }
    }

    // -------------------------------------------------------------------------
    // Audio listing
    // -------------------------------------------------------------------------

    @ReactMethod
    fun listAudioFiles(
        promise: Promise
    ) {
        try {
            val result = Arguments.createArray()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                listMediaStoreFiles(
                    AUDIO_ROOT,
                    "quran-audio/",
                    result
                )
            } else {
                collectAudioFilesLegacy(result)
            }

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject(
                "LIST_AUDIO_FAILED",
                e.message,
                e
            )
        }
    }

    // -------------------------------------------------------------------------
    // Tafsir
    // -------------------------------------------------------------------------

    @ReactMethod
    fun saveTafsirFile(
        language: String,
        surahNumber: String,
        content: String,
        promise: Promise
    ) {
        try {
            if (content.isEmpty()) {
                promise.resolve(false)
                return
            }

            validateSimpleSegment(language)
            validateFileName("$surahNumber.json")

            val bytes = content.toByteArray(Charsets.UTF_8)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeBytesViaMediaStore(
                    bytes = bytes,
                    relPath = "$TAFSIR_ROOT$language/",
                    name = "$surahNumber.json",
                    mimeType = "application/json"
                )
            } else {
                writeBytesLegacy(
                    bytes,
                    "$LEGACY_TAFSIR_ROOT$language/$surahNumber.json"
                )
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "SAVE_TAFSIR_FAILED",
                e.message,
                e
            )
        }
    }

    @ReactMethod
    fun readTafsirFile(
        language: String,
        surahNumber: String,
        promise: Promise
    ) {
        try {
            validateSimpleSegment(language)
            validateFileName("$surahNumber.json")

            val data =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    readBytesViaMediaStore(
                        "$TAFSIR_ROOT$language/",
                        "$surahNumber.json"
                    )
                } else {
                    readLegacy(
                        "$LEGACY_TAFSIR_ROOT$language/$surahNumber.json"
                    )
                }

            promise.resolve(
                data?.toString(Charsets.UTF_8)
            )
        } catch (e: Exception) {
            promise.reject(
                "READ_TAFSIR_FAILED",
                e.message,
                e
            )
        }
    }

    @ReactMethod
    fun listTafsirFiles(
        promise: Promise
    ) {
        try {
            val result = Arguments.createArray()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                listMediaStoreFiles(
                    TAFSIR_ROOT,
                    "",
                    result
                )
            } else {
                val root = File(
                    legacyAyatFlowRoot(),
                    "tafsir"
                )

                if (root.exists()) {
                    root.listFiles()?.forEach { langDir ->
                        if (!langDir.isDirectory) return@forEach

                        langDir.listFiles()?.forEach { file ->
                            if (
                                file.isFile &&
                                file.name.endsWith(".json")
                            ) {
                                result.pushString(
                                    "tafsir/${langDir.name}/${file.name}"
                                )
                            }
                        }
                    }
                }
            }

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject(
                "LIST_TAFSIR_FAILED",
                e.message,
                e
            )
        }
    }

    // -------------------------------------------------------------------------
    // Zip audio
    // -------------------------------------------------------------------------

    @ReactMethod
    fun zipAudioFiles(
        sourceDirPath: String,
        zipPath: String,
        promise: Promise
    ) {
        try {
            val sourceDir = resolveSourceFile(sourceDirPath)

            if (
                !sourceDir.exists() ||
                !sourceDir.isDirectory
            ) {
                throw IOException(
                    "Source directory not found: $sourceDirPath"
                )
            }

            val allDirs =
                sourceDir
                    .walkTopDown()
                    .filter {
                        it.isDirectory &&
                            it != sourceDir
                    }
                    .map {
                        it.absolutePath
                            .removePrefix(
                                sourceDir.absolutePath
                            )
                            .removePrefix("/")
                    }
                    .toList()

            zipAudioSelection(
                sourceDirPath,
                Arguments.fromArray(
                    allDirs.toTypedArray()
                ),
                zipPath,
                promise
            )
        } catch (e: Exception) {
            promise.reject(
                "ZIP_AUDIO_FAILED",
                e.message,
                e
            )
        }
    }

    @ReactMethod
    fun zipAudioSelection(
        audioRootPath: String,
        includes: ReadableArray,
        zipPath: String,
        promise: Promise
    ) {
        try {
            val audioRoot =
                resolveSourceFile(audioRootPath)

            if (
                !audioRoot.exists() ||
                !audioRoot.isDirectory
            ) {
                throw IOException(
                    "Audio root not found: $audioRootPath"
                )
            }

            val destination =
                resolveSourceFile(zipPath)

            destination.parentFile?.mkdirs()

            if (destination.exists()) {
                destination.delete()
            }

            val base = audioRoot.absolutePath

            ZipOutputStream(
                BufferedOutputStream(
                    FileOutputStream(destination)
                )
            ).use { zip ->

                val buffer = ByteArray(BUFFER_SIZE)

                for (i in 0 until includes.size()) {
                    val rel =
                        includes.getString(i)
                            ?: continue

                    val dir = File(
                        audioRoot,
                        rel
                    )

                    if (
                        !dir.exists() ||
                        !dir.isDirectory
                    ) {
                        continue
                    }

                    dir.walkTopDown().forEach { file ->

                        if (!file.isFile) {
                            return@forEach
                        }

                        if (
                            file.name.endsWith(".part") ||
                            file.name.endsWith(".tmp")
                        ) {
                            return@forEach
                        }

                        val relPath =
                            file.absolutePath
                                .removePrefix(base)
                                .removePrefix("/")

                        zip.putNextEntry(
                            ZipEntry(relPath)
                        )

                        FileInputStream(file).use { input ->
                            var read = input.read(buffer)

                            while (read != -1) {
                                zip.write(
                                    buffer,
                                    0,
                                    read
                                )

                                read = input.read(buffer)
                            }
                        }

                        zip.closeEntry()
                    }
                }
            }

            promise.resolve(
                destination.absolutePath
            )
        } catch (e: Exception) {
            promise.reject(
                "ZIP_AUDIO_FAILED",
                e.message,
                e
            )
        }
    }

    // =========================================================================
    // MediaStore — Android 10+
    // =========================================================================

    private fun getSharedFilesCollection(): Uri =
        MediaStore.Files.getContentUri("external")

    /**
     * Writes a byte array to MediaStore.
     *
     * Used for small JSON files and markers.
     */
    private fun writeBytesViaMediaStore(
        bytes: ByteArray,
        relPath: String,
        name: String,
        mimeType: String
    ) {
        val resolver =
            appContext.contentResolver

        val collection =
            getSharedFilesCollection()

        var uri =
            findMediaStoreUri(
                relPath,
                name
            )

        var createdNew = false

        if (uri == null) {
            val values =
                ContentValues().apply {
                    put(
                        MediaStore.MediaColumns.DISPLAY_NAME,
                        name
                    )

                    put(
                        MediaStore.MediaColumns.MIME_TYPE,
                        mimeType
                    )

                    put(
                        MediaStore.MediaColumns.RELATIVE_PATH,
                        normalizeRelativePath(relPath)
                    )

                    if (
                        Build.VERSION.SDK_INT >=
                        Build.VERSION_CODES.Q
                    ) {
                        put(
                            MediaStore.MediaColumns.IS_PENDING,
                            1
                        )
                    }
                }

            uri = resolver.insert(
                collection,
                values
            )

            if (uri == null) {
                throw IOException(
                    "Failed to create MediaStore file: $name"
                )
            }

            createdNew = true
        } else if (
            Build.VERSION.SDK_INT >=
            Build.VERSION_CODES.Q
        ) {
            val pending =
                ContentValues().apply {
                    put(
                        MediaStore.MediaColumns.IS_PENDING,
                        1
                    )
                }

            resolver.update(
                uri,
                pending,
                null,
                null
            )
        }

        try {
            resolver.openOutputStream(
                uri,
                "w"
            )?.use { output ->
                output.write(bytes)
                output.flush()
            } ?: throw IOException(
                "Failed to open MediaStore file for writing: $name"
            )

            if (
                Build.VERSION.SDK_INT >=
                Build.VERSION_CODES.Q
            ) {
                val done =
                    ContentValues().apply {
                        put(
                            MediaStore.MediaColumns.IS_PENDING,
                            0
                        )
                    }

                resolver.update(
                    uri,
                    done,
                    null,
                    null
                )
            }
        } catch (e: Exception) {
            if (createdNew) {
                runCatching {
                    resolver.delete(
                        uri,
                        null,
                        null
                    )
                }
            }

            throw e
        }
    }

    /**
     * Streams a potentially large file into MediaStore.
     */
    private fun copyFileToMediaStore(
        source: File,
        relPath: String,
        name: String,
        mimeType: String
    ) {
        val resolver =
            appContext.contentResolver

        val collection =
            getSharedFilesCollection()

        var uri =
            findMediaStoreUri(
                relPath,
                name
            )

        var createdNew = false

        if (uri == null) {
            val values =
                ContentValues().apply {
                    put(
                        MediaStore.MediaColumns.DISPLAY_NAME,
                        name
                    )

                    put(
                        MediaStore.MediaColumns.MIME_TYPE,
                        mimeType
                    )

                    put(
                        MediaStore.MediaColumns.RELATIVE_PATH,
                        normalizeRelativePath(relPath)
                    )

                    put(
                        MediaStore.MediaColumns.IS_PENDING,
                        1
                    )
                }

            uri = resolver.insert(
                collection,
                values
            )

            if (uri == null) {
                throw IOException(
                    "Failed to create MediaStore audio file: $name"
                )
            }

            createdNew = true
        } else {
            val pending =
                ContentValues().apply {
                    put(
                        MediaStore.MediaColumns.IS_PENDING,
                        1
                    )
                }

            resolver.update(
                uri,
                pending,
                null,
                null
            )
        }

        try {
            FileInputStream(source).use { input ->
                resolver.openOutputStream(
                    uri,
                    "w"
                )?.use { output ->
                    copyStream(
                        input,
                        output
                    )
                } ?: throw IOException(
                    "Failed to open MediaStore audio output"
                )
            }

            val done =
                ContentValues().apply {
                    put(
                        MediaStore.MediaColumns.IS_PENDING,
                        0
                    )
                }

            resolver.update(
                uri,
                done,
                null,
                null
            )
        } catch (e: Exception) {
            if (createdNew) {
                runCatching {
                    resolver.delete(
                        uri,
                        null,
                        null
                    )
                }
            }

            throw e
        }
    }

    private fun readBytesViaMediaStore(
        relPath: String,
        name: String
    ): ByteArray? {
        val uri =
            findMediaStoreUri(
                relPath,
                name
            ) ?: return null

        return appContext.contentResolver
            .openInputStream(uri)
            ?.use { input ->
                input.readBytes()
            }
    }

    private fun findMediaStoreUri(
        relPath: String,
        name: String
    ): Uri? {
        val resolver =
            appContext.contentResolver

        val collection =
            getSharedFilesCollection()

        val normalizedPath =
            normalizeRelativePath(relPath)

        val selection =
            "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND " +
                "${MediaStore.MediaColumns.RELATIVE_PATH} = ?"

        val args =
            arrayOf(
                name,
                normalizedPath
            )

        resolver.query(
            collection,
            arrayOf(
                MediaStore.MediaColumns._ID
            ),
            selection,
            args,
            null
        )?.use { cursor ->

            if (cursor.moveToFirst()) {
                return ContentUris.withAppendedId(
                    collection,
                    cursor.getLong(0)
                )
            }
        }

        return null
    }

    private fun deleteMediaStoreFile(
        relPath: String,
        name: String
    ) {
        val resolver =
            appContext.contentResolver

        val uri =
            findMediaStoreUri(
                relPath,
                name
            ) ?: return

        resolver.delete(
            uri,
            null,
            null
        )
    }

    /**
     * Determines whether MediaStore contains anything beneath a RELATIVE_PATH.
     */
    private fun mediaStorePathExists(
        relPath: String
    ): Boolean {
        val resolver =
            appContext.contentResolver

        val collection =
            getSharedFilesCollection()

        val normalized =
            normalizeRelativePath(relPath)

        val selection =
            "${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ?"

        val args =
            arrayOf("$normalized%")

        resolver.query(
            collection,
            arrayOf(
                MediaStore.MediaColumns._ID
            ),
            selection,
            args,
            null
        )?.use { cursor ->
            return cursor.moveToFirst()
        }

        return false
    }

    private fun listMediaStoreFiles(
        rootPath: String,
        outputPrefix: String,
        result: WritableArray
    ) {
        val resolver =
            appContext.contentResolver

        val collection =
            getSharedFilesCollection()

        val normalizedRoot =
            normalizeRelativePath(rootPath)

        val projection =
            arrayOf(
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.RELATIVE_PATH
            )

        val selection =
            "${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ?"

        val args =
            arrayOf("$normalizedRoot%")

        resolver.query(
            collection,
            projection,
            selection,
            args,
            null
        )?.use { cursor ->

            val nameCol =
                cursor.getColumnIndex(
                    MediaStore.MediaColumns.DISPLAY_NAME
                )

            val pathCol =
                cursor.getColumnIndex(
                    MediaStore.MediaColumns.RELATIVE_PATH
                )

            if (
                nameCol < 0 ||
                pathCol < 0
            ) {
                return
            }

            if (cursor.moveToFirst()) {
                do {
                    val name =
                    cursor.getString(nameCol)
                        ?: continue

                val rel =
                    cursor.getString(pathCol)
                        ?: continue

                if (name == ".ayatflow") {
                    continue
                }

                val relative =
                    rel.removePrefix(normalizedRoot)

                    result.pushString(
                        "$outputPrefix$relative$name"
                    )
                } while (cursor.moveToNext())
            }
        }
    }

    /**
     * Builds a MediaStore RELATIVE_PATH by joining a canonical root with an
     * optional subdirectory.
     *
     * An empty `relativeDir` resolves to the root itself:
     *
     *   buildRelPath("Download/AyatFlow/data/", "")      -> "Download/AyatFlow/data/"
     *   buildRelPath("Download/AyatFlow/data/", "misc")  -> "Download/AyatFlow/data/misc/"
     */
    private fun buildRelPath(
        root: String,
        relativeDir: String
    ): String {
        val clean =
            cleanRelativePath(relativeDir)

        if (clean.isEmpty()) {
            return normalizeRelativePath(root)
        }

        return normalizeRelativePath(
            "$root$clean/"
        )
    }

    /**
     * Builds a legacy (Android 9-) relative path by joining a canonical legacy
     * root with an optional subdirectory and the file name.
     */
    private fun buildLegacyRelPath(
        root: String,
        relativeDir: String,
        name: String
    ): String {
        val clean =
            cleanRelativePath(relativeDir)

        if (clean.isEmpty()) {
            return "$root$name"
        }

        return "$root$clean/$name"
    }

    /**
     * Guards the saveDataFile/readDataFile/deleteDataFile contract.
     *
     * `relativeDir` must be a path relative to Download/AyatFlow/data/ (or
     * empty). Passing a full path such as "AyatFlow/data" or
     * "Download/AyatFlow/data/..." would silently duplicate the DATA_ROOT
     * prefix, so it is rejected here.
     */
    private fun validateDataRelativeDir(
        dir: String
    ) {
        validateRelativePath(dir)

        if (
            dir.contains(
                "AyatFlow",
                ignoreCase = true
            )
        ) {
            throw IllegalArgumentException(
                "relativeDir must be relative to the data root, got: $dir"
            )
        }
    }

    // =========================================================================
    // Canonical layout creation + migration
    // =========================================================================

    /**
     * Known user-data file names inside Download/AyatFlow/data/.
     */
    private val DATA_FILE_NAMES =
        listOf(
            "bookmarks.json",
            "surah-bookmarks.json",
            "progress.json",
            "audio-prefs.json",
            "last.json",
            "tafsir-language.json"
        )

    /**
     * Subdirectories (relative to Download/AyatFlow/data/) that previous
     * builds wrote data files into by duplicating the data prefix:
     *
     *   storage.ts used to pass "AyatFlow/data"  -> .../data/AyatFlow/data/
     *   backup.ts  used to pass "data"          -> .../data/data/
     */
    private val LEGACY_NESTED_DATA_DIRS =
        listOf(
            "AyatFlow/data",
            "data"
        )

    /**
     * Migrates MediaStore files that previous builds placed in the wrong
     * (duplicated-prefix) locations into the canonical layout.
     *
     * Idempotent and safe to run on every startup. Files are moved only when
     * the canonical destination does not already exist.
     */
    private fun migrateMediaStoreLayout() {
        for (name in DATA_FILE_NAMES) {
            for (nested in LEGACY_NESTED_DATA_DIRS) {
                val oldRelPath =
                    "$DATA_ROOT$nested/"

                if (
                    findMediaStoreUri(
                        oldRelPath,
                        name
                    ) == null
                ) {
                    continue
                }

                if (
                    findMediaStoreUri(
                        DATA_ROOT,
                        name
                    ) == null
                ) {
                    val bytes =
                        readBytesViaMediaStore(
                            oldRelPath,
                            name
                        )

                    if (bytes != null) {
                        writeBytesViaMediaStore(
                            bytes,
                            DATA_ROOT,
                            name,
                            "application/json"
                        )
                    }
                }

                deleteMediaStoreFile(
                    oldRelPath,
                    name
                )
            }
        }

        if (
            findMediaStoreUri(
                MEDIASTORE_ROOT,
                BACKUP_FILE_NAME
            ) != null
        ) {
            if (
                findMediaStoreUri(
                    BACKUPS_ROOT,
                    BACKUP_FILE_NAME
                ) == null
            ) {
                val bytes =
                    readBytesViaMediaStore(
                        MEDIASTORE_ROOT,
                        BACKUP_FILE_NAME
                    )

                if (bytes != null) {
                    writeBytesViaMediaStore(
                        bytes,
                        BACKUPS_ROOT,
                        BACKUP_FILE_NAME,
                        "application/json"
                    )
                }
            }

            deleteMediaStoreFile(
                MEDIASTORE_ROOT,
                BACKUP_FILE_NAME
            )
        }
    }

    /**
     * Inserts a small durable anchor file into every canonical directory.
     *
     * MediaStore only indexes files, so a directory never materializes in
     * file managers until at least one file has been written to it. The
     * anchor guarantees that Download/AyatFlow/ (and every subdirectory)
     * is visible even on a pristine install with no user data yet.
     *
     * Anchors are never deleted. All listing code skips ".ayatflow".
     */
    private fun ensureMediaStoreAnchors() {
        val anchorDirs =
            listOf(
                MEDIASTORE_ROOT,
                DATA_ROOT,
                AUDIO_ROOT,
                TAFSIR_ROOT,
                BACKUPS_ROOT
            )

        for (dir in anchorDirs) {
            if (
                findMediaStoreUri(
                    dir,
                    ANCHOR_FILE_NAME
                ) == null
            ) {
                writeBytesViaMediaStore(
                    ByteArray(0),
                    dir,
                    ANCHOR_FILE_NAME,
                    "application/octet-stream"
                )
            }
        }
    }

    /**
     * Moves the old legacy tree into the canonical location.
     *
     * Previous builds wrote to /storage/emulated/0/AyatFlow/. The canonical
     * location is /storage/emulated/0/Download/AyatFlow/. Runs only on
     * Android 9 and below, where the app has direct filesystem access.
     */
    private fun migrateLegacyFilesystemLayout() {
        val oldRoot =
            File(
                sharedStorageRoot(),
                "AyatFlow"
            )

        if (!oldRoot.exists()) {
            return
        }

        val newRoot =
            legacyAyatFlowRoot()

        if (!newRoot.exists()) {
            newRoot.parentFile?.mkdirs()

            if (oldRoot.renameTo(newRoot)) {
                return
            }
        }

        // Both roots exist (or rename failed): merge any missing pieces.
        for (sub in listOf("data", "quran-audio", "tafsir", "backups")) {
            val source =
                File(oldRoot, sub)

            if (
                source.exists() &&
                !File(newRoot, sub).exists()
            ) {
                source.renameTo(
                    File(newRoot, sub)
                )
            }
        }

        val oldBackup =
            File(
                oldRoot,
                BACKUP_FILE_NAME
            )

        if (oldBackup.exists()) {
            val backupsDir =
                File(
                    newRoot,
                    "backups"
                )

            backupsDir.mkdirs()

            val target =
                File(
                    backupsDir,
                    BACKUP_FILE_NAME
                )

            if (target.exists()) {
                oldBackup.delete()
            } else {
                oldBackup.renameTo(target)
            }
        }

        oldRoot.listFiles()
            ?.takeIf { it.isEmpty() }
            ?.let { oldRoot.delete() }
    }

    /**
     * Creates every canonical directory explicitly on Android 9 and below.
     */
    private fun ensureLegacyFolders() {
        val root =
            legacyAyatFlowRoot()

        root.mkdirs()

        for (sub in listOf("data", "quran-audio", "tafsir", "backups")) {
            File(root, sub).mkdirs()
        }
    }

    // =========================================================================
    // Legacy storage — Android 9 and below
    // =========================================================================

    private fun sharedStorageRoot(): File =
        Environment.getExternalStorageDirectory()

    /**
     * Canonical legacy root:
     *
     * /storage/emulated/0/Download/AyatFlow
     *
     * (LEGACY_ROOT = "Download/AyatFlow" is relative to the storage root.)
     */
    private fun legacyAyatFlowRoot(): File =
        File(
            sharedStorageRoot(),
            LEGACY_ROOT
        )

    private fun writeBytesLegacy(
        bytes: ByteArray,
        relativePath: String
    ) {
        val destination =
            File(
                sharedStorageRoot(),
                relativePath
            )

        destination.parentFile?.mkdirs()

        FileOutputStream(destination).use { output ->
            output.write(bytes)
            output.flush()
        }
    }

    private fun readLegacy(
        relativePath: String
    ): ByteArray? {
        val file =
            File(
                sharedStorageRoot(),
                relativePath
            )

        if (!file.exists() || !file.isFile) {
            return null
        }

        return file.readBytes()
    }

    private fun deleteLegacy(
        relativePath: String
    ) {
        File(
            sharedStorageRoot(),
            relativePath
        ).delete()
    }

    private fun collectAudioFilesLegacy(
        out: WritableArray
    ) {
        val root =
            File(
                legacyAyatFlowRoot(),
                "quran-audio"
            )

        if (!root.exists()) {
            return
        }

        collectAudioFiles(
            root,
            "",
            out
        )
    }

    private fun collectAudioFiles(
        dir: File,
        prefix: String,
        out: WritableArray
    ) {
        dir.listFiles()?.forEach { file ->

            val rel =
                if (prefix.isEmpty()) {
                    file.name
                } else {
                    "$prefix/${file.name}"
                }

            if (file.isDirectory) {
                collectAudioFiles(
                    file,
                    rel,
                    out
                )
            } else if (
                file.name.endsWith(
                    ".mp3",
                    ignoreCase = true
                )
            ) {
                out.pushString(
                    "quran-audio/$rel"
                )
            }
        }
    }

    // =========================================================================
    // SAF
    // =========================================================================

    /**
     * Converts a persisted tree URI into DocumentFile.
     */
    private fun safTreeRoot(
        treeUri: String
    ): DocumentFile? {
        return runCatching {
            DocumentFile.fromTreeUri(
                appContext,
                Uri.parse(treeUri)
            )
        }.getOrNull()
    }

    private fun safResolve(
        treeUri: String,
        relativePath: String
    ): DocumentFile? {
        val root =
            safTreeRoot(treeUri)
                ?: return null

        var current = root

        for (
            segment in
            relativePath
                .split("/")
                .filter { it.isNotBlank() }
        ) {
            current =
                current.findFile(segment)
                    ?: return null
        }

        return current
    }

    private fun mimeFor(
        name: String
    ): String =
        when {
            name.endsWith(
                ".mp3",
                ignoreCase = true
            ) -> "audio/mpeg"

            name.endsWith(
                ".json",
                ignoreCase = true
            ) -> "application/json"

            name.endsWith(
                ".zip",
                ignoreCase = true
            ) -> "application/zip"

            else ->
                "application/octet-stream"
        }

    /**
     * Creates every directory/file required by a SAF relative path.
     */
    private fun safEnsureFile(
        treeUri: String,
        relativePath: String
    ): DocumentFile? {
        val root =
            safTreeRoot(treeUri)
                ?: return null

        var current = root

        val segments =
            relativePath
                .split("/")
                .filter { it.isNotBlank() }

        if (segments.isEmpty()) {
            return current
        }

        for (i in segments.indices) {
            val segment =
                segments[i]

            val isLast =
                i == segments.lastIndex

            var child =
                current.findFile(segment)

            if (child == null) {
                child =
                    if (isLast) {
                        current.createFile(
                            mimeFor(segment),
                            segment
                        )
                    } else {
                        current.createDirectory(
                            segment
                        )
                    }

                if (child == null) {
                    return null
                }
            }

            current = child
        }

        return current
    }

    @ReactMethod
    fun safWriteTextFile(
        treeUri: String,
        relativePath: String,
        content: String,
        promise: Promise
    ) {
        try {
            val file =
                safEnsureFile(
                    treeUri,
                    relativePath
                )

            if (
                file == null ||
                !file.canWrite()
            ) {
                promise.resolve(false)
                return
            }

            appContext.contentResolver
                .openOutputStream(
                    file.uri,
                    "w"
                )
                ?.use { output ->
                    output.write(
                        content.toByteArray(
                            Charsets.UTF_8
                        )
                    )

                    output.flush()
                }
                ?: throw IOException(
                    "Failed to open $relativePath for writing"
                )

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "SAF_WRITE_FAILED",
                e.message,
                e
            )
        }
    }

    @ReactMethod
    fun safReadTextFile(
        treeUri: String,
        relativePath: String,
        promise: Promise
    ) {
        try {
            val file =
                safResolve(
                    treeUri,
                    relativePath
                )

            if (
                file == null ||
                !file.isFile
            ) {
                promise.resolve(null)
                return
            }

            val text =
                appContext.contentResolver
                    .openInputStream(file.uri)
                    ?.use { input ->
                        input.readBytes()
                            .toString(
                                Charsets.UTF_8
                            )
                    }

            promise.resolve(text)
        } catch (e: Exception) {
            promise.reject(
                "SAF_READ_FAILED",
                e.message,
                e
            )
        }
    }

    @ReactMethod
    fun safListFiles(
        treeUri: String,
        relativePath: String,
        promise: Promise
    ) {
        try {
            val root =
                if (relativePath.isBlank()) {
                    safTreeRoot(treeUri)
                } else {
                    safResolve(
                        treeUri,
                        relativePath
                    )
                }

            val result =
                Arguments.createArray()

            if (
                root != null &&
                root.isDirectory
            ) {
                collectSafFiles(
                    root,
                    relativePath.trimEnd('/'),
                    result
                )
            }

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject(
                "SAF_LIST_FAILED",
                e.message,
                e
            )
        }
    }

    private fun collectSafFiles(
        dir: DocumentFile,
        prefix: String,
        out: WritableArray
    ) {
        for (child in dir.listFiles()) {
            val name =
                child.name
                    ?: continue

            val rel =
                if (prefix.isEmpty()) {
                    name
                } else {
                    "$prefix/$name"
                }

            if (child.isDirectory) {
                collectSafFiles(
                    child,
                    rel,
                    out
                )
            } else {
                out.pushString(rel)
            }
        }
    }

    @ReactMethod
    fun safDeleteFile(
        treeUri: String,
        relativePath: String,
        promise: Promise
    ) {
        try {
            val file =
                safResolve(
                    treeUri,
                    relativePath
                )

            if (file != null) {
                file.delete()
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "SAF_DELETE_FAILED",
                e.message,
                e
            )
        }
    }

    /**
     * Copies a file from a granted SAF tree into app storage.
     */
    @ReactMethod
    fun safCopyFileToApp(
        treeUri: String,
        relativePath: String,
        destPath: String,
        promise: Promise
    ) {
        try {
            val file =
                safResolve(
                    treeUri,
                    relativePath
                )

            if (
                file == null ||
                !file.isFile
            ) {
                promise.resolve(false)
                return
            }

            val destination =
                resolveSourceFile(destPath)

            destination.parentFile?.mkdirs()

            appContext.contentResolver
                .openInputStream(file.uri)
                ?.use { input ->
                    FileOutputStream(
                        destination
                    ).use { output ->
                        copyStream(
                            input,
                            output
                        )
                    }
                }
                ?: throw IOException(
                    "Failed to read $relativePath"
                )

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "SAF_COPY_FAILED",
                e.message,
                e
            )
        }
    }

    /**
     * Copies an app file into a granted SAF tree.
     *
     * This also streams large MP3 files instead of loading the entire file
     * into memory.
     */
    @ReactMethod
    fun safCopyFileFromApp(
        treeUri: String,
        relativePath: String,
        sourcePath: String,
        promise: Promise
    ) {
        try {
            val source =
                resolveSourceFile(sourcePath)

            if (
                !source.exists() ||
                !source.isFile ||
                source.length() == 0L
            ) {
                promise.resolve(false)
                return
            }

            val file =
                safEnsureFile(
                    treeUri,
                    relativePath
                )

            if (
                file == null ||
                !file.canWrite()
            ) {
                promise.resolve(false)
                return
            }

            FileInputStream(source).use { input ->
                appContext.contentResolver
                    .openOutputStream(
                        file.uri,
                        "wt"
                    )
                    ?.use { output ->
                        copyStream(
                            input,
                            output
                        )
                    }
                    ?: throw IOException(
                        "Failed to open $relativePath for writing"
                    )
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "SAF_COPY_FAILED",
                e.message,
                e
            )
        }
    }

    // -------------------------------------------------------------------------
    // SAF permission helpers
    // -------------------------------------------------------------------------

    /**
     * Persist the URI permission returned by ACTION_OPEN_DOCUMENT_TREE.
     *
     * JS can call this after receiving the selected tree URI.
     */
    @ReactMethod
    fun safTakePersistablePermission(
        treeUri: String,
        promise: Promise
    ) {
        try {
            val uri =
                Uri.parse(treeUri)

            val flags =
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION

            appContext.contentResolver
                .takePersistableUriPermission(
                    uri,
                    flags
                )

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "SAF_PERSIST_PERMISSION_FAILED",
                e.message,
                e
            )
        }
    }

    /**
     * Checks whether this app still has persisted access to a SAF URI.
     */
    @ReactMethod
    fun safHasPersistedPermission(
        treeUri: String,
        promise: Promise
    ) {
        try {
            val target =
                Uri.parse(treeUri)

            val hasPermission =
                appContext.contentResolver
                    .persistedUriPermissions
                    .any { permission ->
                        permission.uri == target &&
                            permission.isReadPermission &&
                            permission.isWritePermission
                    }

            promise.resolve(hasPermission)
        } catch (e: Exception) {
            promise.reject(
                "SAF_PERMISSION_CHECK_FAILED",
                e.message,
                e
            )
        }
    }

    /**
     * Returns persisted SAF tree/document URI strings.
     */
    @ReactMethod
    fun safGetPersistedPermissions(
        promise: Promise
    ) {
        try {
            val result =
                Arguments.createArray()

            appContext.contentResolver
                .persistedUriPermissions
                .forEach { permission ->
                    result.pushString(
                        permission.uri.toString()
                    )
                }

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject(
                "SAF_PERMISSION_LIST_FAILED",
                e.message,
                e
            )
        }
    }

    // =========================================================================
    // Shared utility functions
    // =========================================================================

    /**
     * Stream data from input to output.
     */
    private fun copyStream(
        input: InputStream,
        output: OutputStream
    ) {
        val buffer =
            ByteArray(BUFFER_SIZE)

        var read =
            input.read(buffer)

        while (read != -1) {
            output.write(
                buffer,
                0,
                read
            )

            read =
                input.read(buffer)
        }

        output.flush()
    }

    private fun copyFile(
        source: File,
        destination: File
    ) {
        destination.parentFile?.mkdirs()

        FileInputStream(source).use { input ->
            FileOutputStream(destination).use { output ->
                copyStream(
                    input,
                    output
                )
            }
        }
    }

    /**
     * Normalizes a MediaStore RELATIVE_PATH.
     *
     * MediaStore paths must use '/' separators and end in '/'.
     */
    private fun normalizeRelativePath(
        path: String
    ): String {
        var normalized =
            path
                .replace('\\', '/')
                .trimStart('/')

        if (!normalized.endsWith('/')) {
            normalized += "/"
        }

        return normalized
    }

    private fun cleanRelativePath(
        path: String
    ): String {
        return path
            .replace('\\', '/')
            .trim('/')
    }

    /**
     * Prevent accidental ../ traversal from JS arguments.
     */
    private fun validateRelativePath(
        path: String
    ) {
        val normalized =
            path.replace('\\', '/')

        if (
            normalized.contains("..") ||
            normalized.startsWith("/") ||
            normalized.contains("//")
        ) {
            throw IllegalArgumentException(
                "Invalid relative path: $path"
            )
        }
    }

    private fun validateFileName(
        name: String
    ) {
        if (
            name.isBlank() ||
            name == "." ||
            name == ".." ||
            name.contains("/") ||
            name.contains("\\")
        ) {
            throw IllegalArgumentException(
                "Invalid file name: $name"
            )
        }
    }

    private fun validateSimpleSegment(
        value: String
    ) {
        if (
            value.isBlank() ||
            value == "." ||
            value == ".." ||
            value.contains("/") ||
            value.contains("\\")
        ) {
            throw IllegalArgumentException(
                "Invalid path segment: $value"
            )
        }
    }

    /**
     * Resolves:
     *
     * file:///...
     *
     * as well as normal filesystem paths.
     */
    private fun resolveSourceFile(
        path: String
    ): File {
        return if (path.startsWith("file://")) {
            File(
                URI.create(path)
            )
        } else {
            File(path)
        }
    }
}