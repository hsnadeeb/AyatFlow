package com.hasnadeeb.ayahflow

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.IOException

/**
 * Persists app data (bookmarks, progress, settings) to shared storage so it
 * survives app uninstall/reinstall. Writes a small JSON backup to
 * /storage/emulated/0/Download/AyatFlow/ayah-flow-backup.json.
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
    private val relativePath = "Download/AyatFlow/"
    private val legacySubDir = "AyatFlow"

    @ReactMethod
    fun saveBackup(data: String, promise: Promise) {
        try {
            if (data.isBlank()) {
                promise.resolve(false)
                return
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveViaMediaStore(data)
            } else {
                saveViaLegacyFile(data)
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
                loadViaMediaStore()
            } else {
                loadViaLegacyFile()
            }
            promise.resolve(data)
        } catch (e: Exception) {
            promise.reject("LOAD_BACKUP_FAILED", e.message, e)
        }
    }

    // ---- Android 10+ : MediaStore (silent, permission-free) ----

    private fun saveViaMediaStore(data: String) {
        val resolver = appContext.contentResolver
        val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
        val selection =
            "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?"
        val selectionArgs = arrayOf(fileName, relativePath)

        var uri = resolver.query(collection, arrayOf(MediaStore.MediaColumns._ID), selection, selectionArgs, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    ContentUris.withAppendedId(collection, cursor.getLong(0))
                } else {
                    null
                }
            }

        if (uri == null) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
                put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            uri = resolver.insert(collection, values)
        } else {
            val pending = ContentValues().apply {
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            resolver.update(uri, pending, null, null)
        }

        if (uri == null) throw IOException("Failed to create backup file")

        resolver.openOutputStream(uri)?.use { output ->
            output.write(data.toByteArray(Charsets.UTF_8))
        } ?: throw IOException("Failed to open backup file for writing")

        val done = ContentValues().apply {
            put(MediaStore.MediaColumns.IS_PENDING, 0)
        }
        resolver.update(uri, done, null, null)
    }

    private fun loadViaMediaStore(): String? {
        val resolver = appContext.contentResolver
        val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
        val selection =
            "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?"
        val selectionArgs = arrayOf(fileName, relativePath)

        resolver.query(collection, arrayOf(MediaStore.MediaColumns._ID), selection, selectionArgs, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val uri = ContentUris.withAppendedId(collection, cursor.getLong(0))
                    return resolver.openInputStream(uri)?.use { input ->
                        input.readBytes().toString(Charsets.UTF_8)
                    }
                }
            }
        return null
    }

    // ---- Android 9- : legacy File API ----

    private fun legacyDir(): File {
        val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        return File(downloads, legacySubDir)
    }

    private fun saveViaLegacyFile(data: String) {
        val dir = legacyDir()
        if (!dir.exists() && !dir.mkdirs()) throw IOException("Failed to create backup directory")
        File(dir, fileName).writeText(data, Charsets.UTF_8)
    }

    private fun loadViaLegacyFile(): String? {
        val file = File(legacyDir(), fileName)
        return if (file.exists()) file.readText(Charsets.UTF_8) else null
    }
}
