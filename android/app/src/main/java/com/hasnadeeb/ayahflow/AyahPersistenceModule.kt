package com.hasnadeeb.ayahflow

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
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
 * survive app uninstall/reinstall:
 *
 * - Data backup: /storage/emulated/0/Download/AyatFlow/ayah-flow-backup.json
 * - Audio:       /storage/emulated/0/Download/AyatFlow/quran-audio/SurahN/{arabic,english}/N.mp3
 *
 * - Android 10+ (API 29+): MediaStore.Downloads, no permissions needed.
 * - Android 9- (API 28-): public Downloads dir via File API (requires the
 *   WRITE_EXTERNAL_STORAGE runtime permission, requested from JS).
 */
class AyahPersistenceModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val appContext: Context = reactContext.applicationContext

    override fun getName(): String = "AyahPersistenceModule"

    private val fileName = "ayah-flow-backup.json"
    private val backupRelativePath = "Download/AyatFlow/"
    private val audioRelativeRoot = "Download/AyatFlow/quran-audio/"
    private val legacyRootDir = "AyatFlow"

    // ---- Data backup ----

    @ReactMethod
    fun saveBackup(data: String, promise: Promise) {
        try {
            if (data.isBlank()) {
                promise.resolve(false)
                return
            }
            val bytes = data.toByteArray(Charsets.UTF_8)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeBytesViaMediaStore(bytes, backupRelativePath, fileName, "application/json")
            } else {
                writeBytesLegacy(bytes, "$legacyRootDir/$fileName")
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SAVE_BACKUP_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun loadBackup(promise: Promise) {
        try {
            val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                readBytesViaMediaStore(backupRelativePath, fileName)
            } else {
                readLegacy("$legacyRootDir/$fileName")
            }
            promise.resolve(data?.toString(Charsets.UTF_8))
        } catch (e: Exception) {
            promise.reject("LOAD_BACKUP_FAILED", e.message, e)
        }
    }

    // ---- Audio mirroring ----

    /**
     * Copy a freshly downloaded file from app storage into shared storage.
     * relativeDir looks like "Surah1/arabic" (the "quran-audio/" root is
     * added by audioRelativeRoot).
     */
    @ReactMethod
    fun saveAudioFile(relativeDir: String, audioName: String, sourcePath: String, promise: Promise) {
        try {
            val source = resolveSourceFile(sourcePath)
            if (!source.exists() || source.length() == 0L) {
                throw IOException("Source audio file missing or empty: $sourcePath")
            }
            val bytes = source.readBytes()
            val relPath = "$audioRelativeRoot$relativeDir/"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeBytesViaMediaStore(bytes, relPath, audioName, "audio/mpeg")
            } else {
                writeBytesLegacy(bytes, "$legacyRootDir/$relativeDir/$audioName")
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SAVE_AUDIO_FAILED", e.message, e)
        }
    }

    /**
     * Copy a file from shared storage back into app storage (reinstall restore).
     * destPath is a file:// URI inside the app's working directory.
     */
    @ReactMethod
    fun restoreAudioFile(relativeDir: String, audioName: String, destPath: String, promise: Promise) {
        try {
            val bytes = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                readBytesViaMediaStore("$audioRelativeRoot$relativeDir/", audioName)
            } else {
                readLegacy("$legacyRootDir/$relativeDir/$audioName")
            }
            if (bytes == null) {
                promise.resolve(false)
                return
            }
            val dest = resolveSourceFile(destPath)
            dest.parentFile?.mkdirs()
            dest.writeBytes(bytes)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("RESTORE_AUDIO_FAILED", e.message, e)
        }
    }

    /** Remove the shared-storage copy (kept in sync with app-side deletes). */
    @ReactMethod
    fun deleteAudioFile(relativeDir: String, audioName: String, promise: Promise) {
        try {
            val relPath = "$audioRelativeRoot$relativeDir/"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = appContext.contentResolver
                val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
                val selection =
                    "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?"
                val args = arrayOf(audioName, relPath)
                resolver.query(collection, arrayOf(MediaStore.MediaColumns._ID), selection, args, null)
                    ?.use { cursor ->
                        if (cursor.moveToFirst()) {
                            val uri = ContentUris.withAppendedId(collection, cursor.getLong(0))
                            resolver.delete(uri, null, null)
                        }
                    }
            } else {
                deleteLegacy("$legacyRootDir/$relativeDir/$audioName")
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("DELETE_AUDIO_FAILED", e.message, e)
        }
    }

    /**
     * List every audio file in shared storage as relative paths like
     * "quran-audio/Surah1/arabic/1.mp3" so the download manager can rebuild
     * its status and restore missing files after a reinstall.
     */
    @ReactMethod
    fun listAudioFiles(promise: Promise) {
        try {
            val result = Arguments.createArray()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = appContext.contentResolver
                val projection = arrayOf(
                    MediaStore.MediaColumns.DISPLAY_NAME,
                    MediaStore.MediaColumns.RELATIVE_PATH
                )
                val selection = "${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ?"
                val args = arrayOf("$audioRelativeRoot%")
                resolver.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, projection, selection, args, null)
                    ?.use { cursor ->
                        val nameCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
                        val pathCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.RELATIVE_PATH)
                        while (cursor.moveToNext()) {
                            val name = cursor.getString(nameCol) ?: continue
                            val rel = cursor.getString(pathCol) ?: continue
                            result.pushString("${rel.removePrefix("Download/AyatFlow/")}$name")
                        }
                    }
            } else {
                collectAudioFilesLegacy(result)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("LIST_AUDIO_FAILED", e.message, e)
        }
    }

    /**
     * Zip a directory of downloaded audio files (SurahN/{arabic,english}/N.mp3)
     * into a single archive so the whole surah can be shared at once. Streams
     * from disk — safe for surahs with hundreds of megabytes of audio.
     */
    @ReactMethod
    fun zipAudioFiles(sourceDirPath: String, zipPath: String, promise: Promise) {
        try {
            val sourceDir = resolveSourceFile(sourceDirPath)
            if (!sourceDir.exists() || !sourceDir.isDirectory) {
                throw IOException("Source directory not found: $sourceDirPath")
            }
            val dest = resolveSourceFile(zipPath)
            dest.parentFile?.mkdirs()
            if (dest.exists()) dest.delete()

            val base = sourceDir.absolutePath
            val buffer = ByteArray(64 * 1024)
            ZipOutputStream(BufferedOutputStream(FileOutputStream(dest))).use { zip ->
                sourceDir.walkTopDown().forEach { file ->
                    if (!file.isFile) return@forEach
                    if (file.name.endsWith(".part") || file.name.endsWith(".tmp")) return@forEach
                    val relPath = file.absolutePath.removePrefix(base).removePrefix("/")
                    zip.putNextEntry(ZipEntry(relPath))
                    file.inputStream().use { input ->
                        var read = input.read(buffer)
                        while (read != -1) {
                            zip.write(buffer, 0, read)
                            read = input.read(buffer)
                        }
                    }
                    zip.closeEntry()
                }
            }
            promise.resolve(dest.absolutePath)
        } catch (e: Exception) {
            promise.reject("ZIP_AUDIO_FAILED", e.message, e)
        }
    }

    // ---- MediaStore helpers (Android 10+) ----

    private fun writeBytesViaMediaStore(bytes: ByteArray, relPath: String, name: String, mimeType: String) {
        val resolver = appContext.contentResolver
        val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
        val selection =
            "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?"
        val args = arrayOf(name, relPath)

        var uri = resolver.query(collection, arrayOf(MediaStore.MediaColumns._ID), selection, args, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    ContentUris.withAppendedId(collection, cursor.getLong(0))
                } else {
                    null
                }
            }

        if (uri == null) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                put(MediaStore.MediaColumns.RELATIVE_PATH, relPath)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            uri = resolver.insert(collection, values)
        } else {
            val pending = ContentValues().apply {
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            resolver.update(uri, pending, null, null)
        }

        if (uri == null) throw IOException("Failed to create file in shared storage")

        resolver.openOutputStream(uri)?.use { output ->
            output.write(bytes)
        } ?: throw IOException("Failed to open file in shared storage for writing")

        val done = ContentValues().apply {
            put(MediaStore.MediaColumns.IS_PENDING, 0)
        }
        resolver.update(uri, done, null, null)
    }

    private fun readBytesViaMediaStore(relPath: String, name: String): ByteArray? {
        val resolver = appContext.contentResolver
        val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
        val selection =
            "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?"
        val args = arrayOf(name, relPath)

        resolver.query(collection, arrayOf(MediaStore.MediaColumns._ID), selection, args, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val uri = ContentUris.withAppendedId(collection, cursor.getLong(0))
                    return resolver.openInputStream(uri)?.use { input ->
                        input.readBytes()
                    }
                }
            }
        return null
    }

    // ---- Legacy File helpers (Android 9-) ----

    private fun legacyDownloadsRoot(): File {
        val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        return File(downloads, legacyRootDir)
    }

    private fun writeBytesLegacy(bytes: ByteArray, relativePath: String) {
        val dest = File(legacyDownloadsRoot(), relativePath)
        dest.parentFile?.mkdirs()
        dest.writeBytes(bytes)
    }

    private fun readLegacy(relativePath: String): ByteArray? {
        val file = File(legacyDownloadsRoot(), relativePath)
        return if (file.exists()) file.readBytes() else null
    }

    private fun deleteLegacy(relativePath: String) {
        File(legacyDownloadsRoot(), relativePath).delete()
    }

    private fun collectAudioFilesLegacy(out: WritableArray) {
        val root = File(legacyDownloadsRoot(), "quran-audio")
        if (!root.exists()) return
        collectAudioFiles(root, "", out)
    }

    private fun collectAudioFiles(dir: File, prefix: String, out: WritableArray) {
        dir.listFiles()?.forEach { file ->
            val rel = if (prefix.isEmpty()) file.name else "$prefix/${file.name}"
            if (file.isDirectory) {
                collectAudioFiles(file, rel, out)
            } else if (file.name.endsWith(".mp3")) {
                out.pushString("quran-audio/$rel")
            }
        }
    }

    // ---- Shared helpers ----

    private fun resolveSourceFile(path: String): File {
        return if (path.startsWith("file://")) File(URI.create(path)) else File(path)
    }
}
