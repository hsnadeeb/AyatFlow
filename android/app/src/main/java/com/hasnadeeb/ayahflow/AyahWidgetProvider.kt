package com.hasnadeeb.ayahflow

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import com.hasnadeeb.ayahflow.R

class AyahWidgetProvider : AppWidgetProvider() {
    
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    override fun onEnabled(context: Context) {
        // Called when the first widget is created
    }

    override fun onDisabled(context: Context) {
        // Called when the last widget is removed
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (ACTION_UPDATE_WIDGET == intent.action) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val appWidgetIds = appWidgetManager.getAppWidgetIds(
                intent.componentName ?: return
            )
            onUpdate(context, appWidgetManager, appWidgetIds)
        }
    }

    companion object {
        const val ACTION_UPDATE_WIDGET = "com.hasnadeeb.ayahflow.UPDATE_WIDGET"

        fun updateAppWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            val views = RemoteViews(context.packageName, R.layout.ayah_widget)
            
            // Get the last read ayah from widget-specific storage
            val sharedPrefs = context.getSharedPreferences("AyahWidgetPrefs", Context.MODE_PRIVATE)
            val lastPositionJson = sharedPrefs.getString("lastPosition", null)
            
            var surahNumber = 1
            var ayahIndex = 0
            
            if (lastPositionJson != null) {
                try {
                    val lastPosition = org.json.JSONObject(lastPositionJson)
                    surahNumber = lastPosition.optInt("surah", 1)
                    ayahIndex = lastPosition.optInt("ayahIndex", 0)
                } catch (e: Exception) {
                    // Keep defaults if parsing fails
                }
            }
            
            // Load ayah data from bundled assets
            val surahName = getSurahName(surahNumber)
            val arabicText = getArabicText(surahNumber, ayahIndex)
            val translation = getTranslation(surahNumber, ayahIndex)
            
            views.setTextViewText(R.id.surah_name, surahName)
            views.setTextViewText(R.id.ayah_number, "Ayah ${ayahIndex + 1}")
            views.setTextViewText(R.id.arabic_text, arabicText)
            views.setTextViewText(R.id.translation, translation)
            
            // Create intent to open the app
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            val pendingIntent = android.app.PendingIntent.getActivity(
                context,
                appWidgetId,
                intent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.arabic_text, pendingIntent)
            
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
        
        private fun getSurahName(surahNumber: Int): String {
            // Try to load from bundled assets
            return try {
                val inputStream = context.assets.open("quran-data.json")
                val size = inputStream.available()
                val buffer = ByteArray(size)
                inputStream.read(buffer)
                inputStream.close()
                val json = String(buffer, Charsets.UTF_8)
                val jsonObject = org.json.JSONObject(json)
                val surahsArray = jsonObject.getJSONArray("surahs")
                
                for (i in 0 until surahsArray.length()) {
                    val surah = surahsArray.getJSONObject(i)
                    if (surah.getInt("number") == surahNumber) {
                        return surah.getString("englishName")
                    }
                }
                "Surah $surahNumber"
            } catch (e: Exception) {
                // Fallback to hardcoded values
                val surahNames = mapOf(
                    1 to "Al-Faatiha",
                    2 to "Al-Baqara",
                    3 to "Aal-i-Imraan",
                    4 to "An-Nisaa",
                    114 to "An-Nas"
                )
                surahNames[surahNumber] ?: "Surah $surahNumber"
            }
        }
        
        private fun getArabicText(surahNumber: Int, ayahIndex: Int): String {
            return try {
                val inputStream = context.assets.open("quran-data.json")
                val size = inputStream.available()
                val buffer = ByteArray(size)
                inputStream.read(buffer)
                inputStream.close()
                val json = String(buffer, Charsets.UTF_8)
                val jsonObject = org.json.JSONObject(json)
                val surahData = jsonObject.getJSONObject("surahData").getJSONObject(surahNumber.toString())
                val ayahsArray = surahData.getJSONArray("ayahs")
                
                if (ayahIndex < ayahsArray.length()) {
                    val ayah = ayahsArray.getJSONObject(ayahIndex)
                    return ayah.getString("text")
                }
                "Ayah ${ayahIndex + 1}"
            } catch (e: Exception) {
                // Fallback
                if (surahNumber == 1 && ayahIndex == 0) {
                    "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ"
                } else {
                    "Ayah text for Surah $surahNumber, Ayah ${ayahIndex + 1}"
                }
            }
        }
        
        private fun getTranslation(surahNumber: Int, ayahIndex: Int): String {
            return try {
                val inputStream = context.assets.open("quran-data.json")
                val size = inputStream.available()
                val buffer = ByteArray(size)
                inputStream.read(buffer)
                inputStream.close()
                val json = String(buffer, Charsets.UTF_8)
                val jsonObject = org.json.JSONObject(json)
                val surahData = jsonObject.getJSONObject("surahData").getJSONObject(surahNumber.toString())
                val ayahsArray = surahData.getJSONArray("ayahs")
                
                if (ayahIndex < ayahsArray.length()) {
                    val ayah = ayahsArray.getJSONObject(ayahIndex)
                    return ayah.getString("translation")
                }
                "Translation for Ayah ${ayahIndex + 1}"
            } catch (e: Exception) {
                // Fallback
                if (surahNumber == 1 && ayahIndex == 0) {
                    "In the name of Allah, the Entirely Merciful, the Especially Merciful."
                } else {
                    "Translation for Surah $surahNumber, Ayah ${ayahIndex + 1}"
                }
            }
        }
    }
}