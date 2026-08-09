package com.hasnadeeb.ayahflow

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject

class AyahWidgetModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    
    private val sharedPrefs: SharedPreferences = reactContext.getSharedPreferences("AyahWidgetPrefs", Context.MODE_PRIVATE)
    
    override fun getName(): String {
        return "AyahWidgetModule"
    }
    
    @ReactMethod
    fun updateWidget() {
        val context = reactApplicationContext
        val intent = Intent(context, AyahWidgetProvider::class.java).apply {
            action = AyahWidgetProvider.ACTION_UPDATE_WIDGET
        }
        context.sendBroadcast(intent)
    }
    
    @ReactMethod
    fun saveLastPosition(surah: Int, ayahIndex: Int) {
        val lastPosition = JSONObject().apply {
            put("surah", surah)
            put("ayahIndex", ayahIndex)
        }
        sharedPrefs.edit().putString("lastPosition", lastPosition.toString()).apply()
        updateWidget()
    }
}