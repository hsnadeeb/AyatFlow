package com.hasnadeeb.ayahflow

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URI
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Persists app data and mirrors audio downloads to shared storage so they
 * survive app uninstall/reinstall.
 *
 * Shared storage layout:
 *
 * /storage/emulated/0/AyatFlow/
 * ├── ayah-flow-backup.json
 * ├── data/
 * │   ├── bookmarks.json
 * │   ├── surah-bookmarks.json
 * │   ├── progress.json
 * │   ├── audio-prefs.json
 * │   ├── last.json
 * │   └── tafsir-language.json
 * ├── quran-audio/
 * │   └── SurahN/{arabic,english}/N.mp3
 * └── tafsir/
 *     └── {urdu,english}/N.json
 *
 * The whole AyatFlow folder is portable: copying it to a new phone and
 * installing the app there allows the app to restore the data.
 *
 * Android 10+ (API 29+):
 *   Uses MediaStore.Files with RELATIVE_PATH.
 *
 * Android 9- (API 28-):
 *   Uses the public external storage root through the File API.
 *   WRITE_EXTERNAL_STORAGE permission is required.
 */
class AyahPersistenceModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val appContext: Context = reactContext.applicationContext

    override fun getName(): String = "AyahPersistenceModule"

    // ---------------------------------------------------------------------
    // All-files access (Android 11+) — makes /storage/emulated/0/AyatFlow
    // directly readable/writable, so the folder is visible in file managers
    // and survives uninstall/reinstall (MediaStore files become unreadable
    // to a reinstalled app).
    // ---------------------------------------------------------------------

    @ReactMethod
    fun hasAllFilesAccess(promise: Promise) {
        try {
            promise.resolve(
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
                    Environment.isExternalStorageManager()
            )
        } catch (e: Exception) {
            promise.reject("ALL_FILES_ACCESS_CHECK_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun requestAllFilesAccess(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
                !Environment.isExternalStorageManager()
            ) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:${appContext.packageName}")
                )
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                appContext.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ALL_FILES_ACCESS_REQUEST_FAILED", e.message, e)
        }
    }

    /** Whether the AyatFlow folder already exists on shared storage. */
    @ReactMethod
    fun isAyatFlowFolderPresent(promise: Promise) {
        try {
            val root = File(sharedStorageRoot(), legacyRootDir)
            promise.resolve(root.exists())
        } catch (e: Exception) {
            promise.reject("FOLDER_CHECK_FAILED", e.message, e)
        }
    }

    /**
     * Create the AyatFlow folder (and its subfolders) up front so it always
     * exists even before the first data/audio write.
     */
    @ReactMethod
    fun ensureAyatFlowFolder(promise: Promise) {
        try {
            val root = File(sharedStorageRoot(), legacyRootDir)
            File(root, "data").mkdirs()
            File(root, "quran-audio").mkdirs()
            File(root, "tafsir").mkdirs()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("FOLDER_CREATE_FAILED", e.message, e)
        }
    }

    // ---------------------------------------------------------------------
    // Shared storage layout
    // ---------------------------------------------------------------------

    private val fileName = "ayah-flow-backup.json"

    /**
     * IMPORTANT:
     * These paths are relative to the shared internal-storage root.
     *
     * Result:
     * /storage/emulated/0/AyatFlow/
     */
    private val backupRelativePath = "AyatFlow/"
    // JS passes the "data" subfolder as relativeDir, so the data root is just
    // "AyatFlow/" — concatenating it with relativeDir yields "AyatFlow/data/".
    private val dataRelativeRoot = "AyatFlow/"
    private val audioRelativeRoot = "AyatFlow/quran-audio/"
    private val tafsirRelativeRoot = "AyatFlow/tafsir/"

    /**
     * Used by the legacy File API on Android 9 and below.
     */
    private val legacyRootDir = "AyatFlow"

    // ---------------------------------------------------------------------
    // Data backup
    // ---------------------------------------------------------------------

    @ReactMethod
    fun saveBackup(data: String, promise: Promise) {
        try {
            if (data.isBlank()) {
                promise.resolve(false)
                return
            }

            val bytes = data.toByteArray(Charsets.UTF_8)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeBytesViaMediaStore(
                    bytes,
                    backupRelativePath,
                    fileName,
                    "application/json"
                )
            } else {
                writeBytesLegacy(
                    bytes,
                    "$legacyRootDir/$fileName"
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
            val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                readBytesViaMediaStore(
                    backupRelativePath,
                    fileName
                )
            } else {
                readLegacy(
                    "$legacyRootDir/$fileName"
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

    // ---------------------------------------------------------------------
    // Per-file data mirroring
    // ---------------------------------------------------------------------

    /**
     * Write one JSON data file into:
     *
     * /AyatFlow/data/
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

            val bytes = content.toByteArray(Charsets.UTF_8)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeBytesViaMediaStore(
                    bytes,
                    "$dataRelativeRoot$relativeDir/",
                    dataFileName,
                    "application/json"
                )
            } else {
                writeBytesLegacy(
                    bytes,
                    "$legacyRootDir/$relativeDir/$dataFileName"
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
            val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                readBytesViaMediaStore(
                    "$dataRelativeRoot$relativeDir/",
                    dataFileName
                )
            } else {
                readLegacy(
                    "$legacyRootDir/$relativeDir/$dataFileName"
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
            val relPath =
                "$dataRelativeRoot$relativeDir/"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = appContext.contentResolver

                /**
                 * Use MediaStore.Files rather than MediaStore.Downloads
                 * because AyatFlow is stored at the shared-storage root.
                 */
                val collection =
                    MediaStore.Files.getContentUri("external")

                val selection =
                    "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND " +
                    "${MediaStore.MediaColumns.RELATIVE_PATH} = ?"

                val args = arrayOf(
                    dataFileName,
                    relPath
                )

                resolver.query(
                    collection,
                    arrayOf(MediaStore.MediaColumns._ID),
                    selection,
                    args,
                    null
                )?.use { cursor ->

                    if (cursor.moveToFirst()) {
                        val uri =
                            ContentUris.withAppendedId(
                                collection,
                                cursor.getLong(0)
                            )

                        resolver.delete(
                            uri,
                            null,
                            null
                        )
                    }
                }
            } else {
                deleteLegacy(
                    "$legacyRootDir/$relativeDir/$dataFileName"
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

    // ---------------------------------------------------------------------
    // Audio mirroring
    // ---------------------------------------------------------------------

    /**
     * Copy a freshly downloaded file from app storage into:
     *
     * /AyatFlow/quran-audio/...
     *
     * relativeDir looks like:
     *
     * Surah1/arabic
     */
    @ReactMethod
    fun saveAudioFile(
        relativeDir: String,
        audioName: String,
        sourcePath: String,
        promise: Promise
    ) {
        try {
            val source =
                resolveSourceFile(sourcePath)

            if (!source.exists() || source.length() == 0L) {
                throw IOException(
                    "Source audio file missing or empty: $sourcePath"
                )
            }

            val bytes = source.readBytes()

            val relPath =
                "$audioRelativeRoot$relativeDir/"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeBytesViaMediaStore(
                    bytes,
                    relPath,
                    audioName,
                    "audio/mpeg"
                )
            } else {
                writeBytesLegacy(
                    bytes,
                    "$legacyRootDir/$relativeDir/$audioName"
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
     * Copy a file from shared storage back into app storage.
     * Used during reinstall restore.
     *
     * destPath is a file:// URI inside the app's working directory.
     */
    @ReactMethod
    fun restoreAudioFile(
        relativeDir: String,
        audioName: String,
        destPath: String,
        promise: Promise
    ) {
        try {
            val bytes =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    readBytesViaMediaStore(
                        "$audioRelativeRoot$relativeDir/",
                        audioName
                    )
                } else {
                    readLegacy(
                        "$legacyRootDir/$relativeDir/$audioName"
                    )
                }

            if (bytes == null) {
                promise.resolve(false)
                return
            }

            val dest =
                resolveSourceFile(destPath)

            dest.parentFile?.mkdirs()
            dest.writeBytes(bytes)

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                "RESTORE_AUDIO_FAILED",
                e.message,
                e
            )
        }
    }

    /**
     * Remove the shared-storage copy.
     */
    @ReactMethod
    fun deleteAudioFile(
        relativeDir: String,
        audioName: String,
        promise: Promise
    ) {
        try {
            val relPath =
                "$audioRelativeRoot$relativeDir/"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver =
                    appContext.contentResolver

                val collection =
                    MediaStore.Files.getContentUri("external")

                val selection =
                    "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND " +
                    "${MediaStore.MediaColumns.RELATIVE_PATH} = ?"

                val args = arrayOf(
                    audioName,
                    relPath
                )

                resolver.query(
                    collection,
                    arrayOf(MediaStore.MediaColumns._ID),
                    selection,
                    args,
                    null
                )?.use { cursor ->

                    if (cursor.moveToFirst()) {
                        val uri =
                            ContentUris.withAppendedId(
                                collection,
                                cursor.getLong(0)
                            )

                        resolver.delete(
                            uri,
                            null,
                            null
                        )
                    }
                }
            } else {
                deleteLegacy(
                    "$legacyRootDir/$relativeDir/$audioName"
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

    // ---------------------------------------------------------------------
    // Audio listing
    // ---------------------------------------------------------------------

    /**
     * List every audio file in shared storage.
     *
     * Returns relative paths such as:
     *
     * quran-audio/Surah1/arabic/1.mp3
     */
    @ReactMethod
    fun listAudioFiles(
        promise: Promise
    ) {
        try {
            val result =
                Arguments.createArray()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver =
                    appContext.contentResolver

                val collection =
                    MediaStore.Files.getContentUri("external")

                val projection = arrayOf(
                    MediaStore.MediaColumns.DISPLAY_NAME,
                    MediaStore.MediaColumns.RELATIVE_PATH
                )

                val selection =
                    "${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ?"

                val args =
                    arrayOf("$audioRelativeRoot%")

                resolver.query(
                    collection,
                    projection,
                    selection,
                    args,
                    null
                )?.use { cursor ->

                    val nameCol =
                        cursor.getColumnIndexOrThrow(
                            MediaStore.MediaColumns.DISPLAY_NAME
                        )

                    val pathCol =
                        cursor.getColumnIndexOrThrow(
                            MediaStore.MediaColumns.RELATIVE_PATH
                        )

                    while (cursor.moveToNext()) {
                        val name =
                            cursor.getString(nameCol)
                                ?: continue

                        val rel =
                            cursor.getString(pathCol)
                                ?: continue

                        result.pushString(
                            "quran-audio/${rel.removePrefix(audioRelativeRoot)}$name"
                        )
                    }
                }
            } else {
                collectAudioFilesLegacy(
                    result
                )
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

    // ---------------------------------------------------------------------
    // Tafsir cache mirroring
    // ---------------------------------------------------------------------

    /**
     * Write one tafsir cache file into:
     *
     * /AyatFlow/tafsir/{language}/{surahNumber}.json
     */
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

            val bytes = content.toByteArray(Charsets.UTF_8)
            val relPath = "$tafsirRelativeRoot$language/"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeBytesViaMediaStore(
                    bytes,
                    relPath,
                    "$surahNumber.json",
                    "application/json"
                )
            } else {
                writeBytesLegacy(
                    bytes,
                    "$legacyRootDir/tafsir/$language/$surahNumber.json"
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
            val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                readBytesViaMediaStore(
                    "$tafsirRelativeRoot$language/",
                    "$surahNumber.json"
                )
            } else {
                readLegacy(
                    "$legacyRootDir/tafsir/$language/$surahNumber.json"
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

    /**
     * List every tafsir cache file in shared storage.
     *
     * Returns relative paths such as:
     *
     * tafsir/urdu/7.json
     */
    @ReactMethod
    fun listTafsirFiles(
        promise: Promise
    ) {
        try {
            val result =
                Arguments.createArray()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver =
                    appContext.contentResolver

                val collection =
                    MediaStore.Files.getContentUri("external")

                val projection = arrayOf(
                    MediaStore.MediaColumns.DISPLAY_NAME,
                    MediaStore.MediaColumns.RELATIVE_PATH
                )

                val selection =
                    "${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ?"

                val args =
                    arrayOf("$tafsirRelativeRoot%")

                resolver.query(
                    collection,
                    projection,
                    selection,
                    args,
                    null
                )?.use { cursor ->

                    val nameCol =
                        cursor.getColumnIndexOrThrow(
                            MediaStore.MediaColumns.DISPLAY_NAME
                        )

                    val pathCol =
                        cursor.getColumnIndexOrThrow(
                            MediaStore.MediaColumns.RELATIVE_PATH
                        )

                    while (cursor.moveToNext()) {
                        val name =
                            cursor.getString(nameCol)
                                ?: continue

                        val rel =
                            cursor.getString(pathCol)
                                ?: continue

                        result.pushString(
                            "${rel.removePrefix(tafsirRelativeRoot)}$name"
                        )
                    }
                }
            } else {
                val root =
                    File(
                        legacyAyatFlowRoot(),
                        "tafsir"
                    )

                if (root.exists()) {
                    root.listFiles()?.forEach { langDir ->
                        if (!langDir.isDirectory) {
                            return@forEach
                        }

                        langDir.listFiles()?.forEach { file ->
                            if (file.isFile &&
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

    // ---------------------------------------------------------------------
    // Zip audio files
    // ---------------------------------------------------------------------

    /**
     * Zip a directory of downloaded audio files.
     */
    @ReactMethod
    fun zipAudioFiles(
        sourceDirPath: String,
        zipPath: String,
        promise: Promise
    ) {
        try {
            val sourceDir =
                resolveSourceFile(sourceDirPath)

            if (!sourceDir.exists() ||
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

    /**
     * Zip only selected language folders.
     *
     * Example:
     *
     * ["Surah1/arabic", "Surah2/english"]
     */
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

            if (!audioRoot.exists() ||
                !audioRoot.isDirectory
            ) {
                throw IOException(
                    "Audio root not found: $audioRootPath"
                )
            }

            val dest =
                resolveSourceFile(zipPath)

            dest.parentFile?.mkdirs()

            if (dest.exists()) {
                dest.delete()
            }

            val base =
                audioRoot.absolutePath

            val buffer =
                ByteArray(64 * 1024)

            ZipOutputStream(
                BufferedOutputStream(
                    FileOutputStream(dest)
                )
            ).use { zip ->

                for (i in 0 until includes.size()) {
                    val rel =
                        includes.getString(i)
                            ?: continue

                    val dir =
                        File(audioRoot, rel)

                    if (!dir.exists() ||
                        !dir.isDirectory
                    ) {
                        continue
                    }

                    dir.walkTopDown().forEach { file ->

                        if (!file.isFile) {
                            return@forEach
                        }

                        if (file.name.endsWith(".part") ||
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

                        file.inputStream().use { input ->
                            var read =
                                input.read(buffer)

                            while (read != -1) {
                                zip.write(
                                    buffer,
                                    0,
                                    read
                                )

                                read =
                                    input.read(buffer)
                            }
                        }

                        zip.closeEntry()
                    }
                }
            }

            promise.resolve(
                dest.absolutePath
            )
        } catch (e: Exception) {
            promise.reject(
                "ZIP_AUDIO_FAILED",
                e.message,
                e
            )
        }
    }

    // ---------------------------------------------------------------------
    // MediaStore helpers — Android 10+
    // ---------------------------------------------------------------------

    /**
     * Uses MediaStore.Files because AyatFlow is a general-purpose application
     * data directory rather than a Downloads-specific directory.
     */
    private fun getSharedFilesCollection() =
        MediaStore.Files.getContentUri("external")

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

        val selection =
            "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND " +
            "${MediaStore.MediaColumns.RELATIVE_PATH} = ?"

        val args =
            arrayOf(name, relPath)

        var uri =
            resolver.query(
                collection,
                arrayOf(MediaStore.MediaColumns._ID),
                selection,
                args,
                null
            )?.use { cursor ->

                if (cursor.moveToFirst()) {
                    ContentUris.withAppendedId(
                        collection,
                        cursor.getLong(0)
                    )
                } else {
                    null
                }
            }

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
                        relPath
                    )

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        put(
                            MediaStore.MediaColumns.IS_PENDING,
                            1
                        )
                    }
                }

            uri =
                resolver.insert(
                    collection,
                    values
                )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
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

        if (uri == null) {
            throw IOException(
                "Failed to create file in shared storage"
            )
        }

        resolver.openOutputStream(
            uri
        )?.use { output ->
            output.write(bytes)
        } ?: throw IOException(
            "Failed to open file in shared storage for writing"
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
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
    }

    private fun readBytesViaMediaStore(
        relPath: String,
        name: String
    ): ByteArray? {

        val resolver =
            appContext.contentResolver

        val collection =
            getSharedFilesCollection()

        val selection =
            "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND " +
            "${MediaStore.MediaColumns.RELATIVE_PATH} = ?"

        val args =
            arrayOf(name, relPath)

        resolver.query(
            collection,
            arrayOf(MediaStore.MediaColumns._ID),
            selection,
            args,
            null
        )?.use { cursor ->

            if (cursor.moveToFirst()) {
                val uri =
                    ContentUris.withAppendedId(
                        collection,
                        cursor.getLong(0)
                    )

                return resolver
                    .openInputStream(uri)
                    ?.use { input ->
                        input.readBytes()
                    }
            }
        }

        return null
    }

    // ---------------------------------------------------------------------
    // Legacy File helpers — Android 9 and below
    // ---------------------------------------------------------------------

    /**
     * Shared external-storage root:
     *
     * /storage/emulated/0/
     */
    private fun sharedStorageRoot(): File {
        return Environment.getExternalStorageDirectory()
    }

    /**
     * Actual AyatFlow directory:
     *
     * /storage/emulated/0/AyatFlow/
     */
    private fun legacyAyatFlowRoot(): File {
        return File(
            sharedStorageRoot(),
            legacyRootDir
        )
    }

    private fun writeBytesLegacy(
        bytes: ByteArray,
        relativePath: String
    ) {
        val dest =
            File(
                sharedStorageRoot(),
                relativePath
            )

        dest.parentFile?.mkdirs()
        dest.writeBytes(bytes)
    }

    private fun readLegacy(
        relativePath: String
    ): ByteArray? {
        val file =
            File(
                sharedStorageRoot(),
                relativePath
            )

        return if (file.exists()) {
            file.readBytes()
        } else {
            null
        }
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
                file.name.endsWith(".mp3")
            ) {
                out.pushString(
                    "quran-audio/$rel"
                )
            }
        }
    }

    // ---------------------------------------------------------------------
    // SAF helpers — operate on the folder the user granted via the system
    // folder picker. DocumentFile descends into subfolders correctly, which
    // expo's JS SAF layer cannot do, so all folder-backed mirror/restore
    // goes through these methods.
    // ---------------------------------------------------------------------

    private fun safTreeRoot(treeUri: String): DocumentFile? =
        runCatching { DocumentFile.fromTreeUri(appContext, Uri.parse(treeUri)) }.getOrNull()

    private fun safResolve(treeUri: String, relativePath: String): DocumentFile? {
        val root = safTreeRoot(treeUri) ?: return null
        var current = root
        for (segment in relativePath.split("/")) {
            if (segment.isBlank()) continue
            current = current.findFile(segment) ?: return null
        }
        return current
    }

    private fun mimeFor(name: String): String = when {
        name.endsWith(".mp3") -> "audio/mpeg"
        name.endsWith(".json") -> "application/json"
        else -> "application/octet-stream"
    }

    /** Find `relativePath` inside the granted folder, creating missing dirs/files. */
    private fun safEnsureFile(treeUri: String, relativePath: String): DocumentFile? {
        val root = safTreeRoot(treeUri) ?: return null
        var current = root
        val segments = relativePath.split("/").filter { it.isNotBlank() }
        for (i in segments.indices) {
            val segment = segments[i]
            val isLast = i == segments.lastIndex
            var child = current.findFile(segment)
            if (child == null) {
                child = if (isLast) {
                    current.createFile(mimeFor(segment), segment)
                } else {
                    current.createDirectory(segment)
                } ?: return null
            }
            current = child
        }
        return current
    }

    @ReactMethod
    fun safWriteTextFile(treeUri: String, relativePath: String, content: String, promise: Promise) {
        try {
            val file = safEnsureFile(treeUri, relativePath)
            if (file == null) {
                promise.resolve(false)
                return
            }
            appContext.contentResolver.openOutputStream(file.uri, "wt")?.use { output ->
                output.write(content.toByteArray(Charsets.UTF_8))
            } ?: throw IOException("Failed to open $relativePath for writing")
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SAF_WRITE_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun safReadTextFile(treeUri: String, relativePath: String, promise: Promise) {
        try {
            val file = safResolve(treeUri, relativePath)
            if (file == null || !file.isFile) {
                promise.resolve(null)
                return
            }
            val text = appContext.contentResolver.openInputStream(file.uri)?.use { input ->
                input.readBytes().toString(Charsets.UTF_8)
            }
            promise.resolve(text)
        } catch (e: Exception) {
            promise.reject("SAF_READ_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun safListFiles(treeUri: String, relativePath: String, promise: Promise) {
        try {
            val root = safResolve(treeUri, relativePath) ?: safTreeRoot(treeUri)
            val result = Arguments.createArray()
            if (root != null && root.isDirectory) {
                collectSafFiles(root, relativePath.trimEnd('/'), result)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("SAF_LIST_FAILED", e.message, e)
        }
    }

    private fun collectSafFiles(dir: DocumentFile, prefix: String, out: WritableArray) {
        for (child in dir.listFiles()) {
            val name = child.name ?: continue
            val rel = if (prefix.isEmpty()) name else "$prefix/$name"
            if (child.isDirectory) {
                collectSafFiles(child, rel, out)
            } else {
                out.pushString(rel)
            }
        }
    }

    @ReactMethod
    fun safDeleteFile(treeUri: String, relativePath: String, promise: Promise) {
        try {
            safResolve(treeUri, relativePath)?.delete()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SAF_DELETE_FAILED", e.message, e)
        }
    }

    /** Copy a file from the granted folder back into app storage (audio restore). */
    @ReactMethod
    fun safCopyFileToApp(treeUri: String, relativePath: String, destPath: String, promise: Promise) {
        try {
            val file = safResolve(treeUri, relativePath)
            if (file == null || !file.isFile) {
                promise.resolve(false)
                return
            }
            val dest = resolveSourceFile(destPath)
            dest.parentFile?.mkdirs()
            appContext.contentResolver.openInputStream(file.uri)?.use { input ->
                dest.writeBytes(input.readBytes())
            } ?: throw IOException("Failed to read $relativePath")
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SAF_COPY_FAILED", e.message, e)
        }
    }

    /** Copy an app file into the granted folder (audio mirror on download). */
    @ReactMethod
    fun safCopyFileFromApp(treeUri: String, relativePath: String, sourcePath: String, promise: Promise) {
        try {
            val source = resolveSourceFile(sourcePath)
            if (!source.exists() || source.length() == 0L) {
                promise.resolve(false)
                return
            }
            val file = safEnsureFile(treeUri, relativePath)
            if (file == null) {
                promise.resolve(false)
                return
            }
            appContext.contentResolver.openOutputStream(file.uri, "wt")?.use { output ->
                output.write(source.readBytes())
            } ?: throw IOException("Failed to open $relativePath for writing")
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SAF_COPY_FAILED", e.message, e)
        }
    }

    // ---------------------------------------------------------------------
    // Shared helpers
    // ---------------------------------------------------------------------

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