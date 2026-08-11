package com.hasnadeeb.ayahflow

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject

class AyatWidgetModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    
    private val sharedPrefs: SharedPreferences = reactContext.getSharedPreferences("AyahWidgetPrefs", Context.MODE_PRIVATE)
    
    override fun getName(): String {
        return "AyahWidgetModule"
    }
    
    @ReactMethod
    fun updateWidget() {
        try {
            val context = reactApplicationContext
            val intent = Intent(context, AyatWidgetProvider::class.java).apply {
                action = AyatWidgetProvider.ACTION_UPDATE_WIDGET
            }
            context.sendBroadcast(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
    
    @ReactMethod
    fun saveLastPosition(surah: Int, ayahIndex: Int) {
        try {
            val lastPosition = JSONObject().apply {
                put("surah", surah)
                put("ayahIndex", ayahIndex)
            }
            sharedPrefs.edit().putString("lastPosition", lastPosition.toString()).apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        updateWidget()
    }
    
    @ReactMethod
    fun saveAyahData(
        surahName: String?,
        ayahNumber: String?,
        arabicText: String?,
        translation: String?,
        totalAyahs: Int?,
        ayahIndex: Int?
    ) {
        // Skip if required fields are null or blank - but allow translation to be optional
        if (surahName.isNullOrBlank() || ayahNumber.isNullOrBlank() ||
            arabicText.isNullOrBlank()
        ) {
            return
        }
        try {
            val ayahData = JSONObject().apply {
                put("surahName", surahName)
                put("ayahNumber", ayahNumber)
                put("arabicText", arabicText)
                put("translation", translation ?: "")
                put("totalAyahs", totalAyahs ?: 0)
                put("ayahIndex", ayahIndex ?: 0)
            }
            sharedPrefs.edit().putString("ayahData", ayahData.toString()).apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        updateWidget()
    }

    @ReactMethod
    fun setWidgetPlayingState(isPlaying: Boolean) {
        try {
            sharedPrefs.edit().putBoolean("isPlaying", isPlaying).apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        updateWidget()
    }

    @ReactMethod
    fun setAudioPrefs(arabic: Boolean, english: Boolean, tafsir: Boolean) {
        try {
            sharedPrefs.edit()
                .putBoolean("audioArabic", arabic)
                .putBoolean("audioEnglish", english)
                .putBoolean("audioTafsir", tafsir)
                .apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        updateWidget()
    }
}
