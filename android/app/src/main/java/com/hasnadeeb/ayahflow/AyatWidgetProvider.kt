package com.hasnadeeb.ayahflow

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.widget.RemoteViews
import org.json.JSONObject

class AyatWidgetProvider : AppWidgetProvider() {
    
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
        
        when (intent.action) {
            ACTION_PLAY_PAUSE -> dispatchAction(context, "playPause")
            ACTION_NEXT -> dispatchAction(context, "next")
            ACTION_PREVIOUS -> dispatchAction(context, "previous")
            ACTION_TOGGLE_ARABIC -> dispatchAction(context, "toggleArabic")
            ACTION_TOGGLE_ENGLISH -> dispatchAction(context, "toggleEnglish")
            ACTION_TOGGLE_TAFSIR -> dispatchAction(context, "toggleTafsir")
            ACTION_UPDATE_WIDGET -> {
                val appWidgetManager = AppWidgetManager.getInstance(context)
                val appWidgetIds = appWidgetManager.getAppWidgetIds(
                    ComponentName(context, AyatWidgetProvider::class.java)
                )
                onUpdate(context, appWidgetManager, appWidgetIds)
            }
        }
    }

    /**
     * Deliver the widget control action to the headless JS task service.
     * This never launches the UI activity: audio starts and controls run
     * entirely in the background, like a YouTube Music widget.
     *
     * startForegroundService is required: when the app process is dead, a
     * plain startService from a widget tap is blocked by background limits.
     */
    private fun dispatchAction(context: Context, action: String) {
        val appContext = context.applicationContext
        try {
            val serviceIntent = Intent(appContext, WidgetActionService::class.java).apply {
                putExtra(WidgetActionService.EXTRA_ACTION, action)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appContext.startForegroundService(serviceIntent)
            } else {
                appContext.startService(serviceIntent)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    companion object {
        const val ACTION_UPDATE_WIDGET = "com.hasnadeeb.ayahflow.UPDATE_WIDGET"
        const val ACTION_PLAY_PAUSE = "com.hasnadeeb.ayahflow.PLAY_PAUSE"
        const val ACTION_NEXT = "com.hasnadeeb.ayahflow.NEXT"
        const val ACTION_PREVIOUS = "com.hasnadeeb.ayahflow.PREVIOUS"
        const val ACTION_TOGGLE_ARABIC = "com.hasnadeeb.ayahflow.TOGGLE_ARABIC"
        const val ACTION_TOGGLE_ENGLISH = "com.hasnadeeb.ayahflow.TOGGLE_ENGLISH"
        const val ACTION_TOGGLE_TAFSIR = "com.hasnadeeb.ayahflow.TOGGLE_TAFSIR"

        fun updateAppWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
            val sharedPrefs = context.getSharedPreferences("AyahWidgetPrefs", Context.MODE_PRIVATE)
            val ayahDataJson = sharedPrefs.getString("ayahData", null)
            val isPlaying = sharedPrefs.getBoolean("isPlaying", false)
            val arabicOn = sharedPrefs.getBoolean("audioArabic", true)
            val englishOn = sharedPrefs.getBoolean("audioEnglish", true)
            val tafsirOn = sharedPrefs.getBoolean("audioTafsir", false)
            val isDarkTheme = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

            val accentColor = context.getColor(if (isDarkTheme) R.color.widget_accent_dark else R.color.widget_accent_light)
            val mutedColor = context.getColor(if (isDarkTheme) R.color.widget_muted_dark else R.color.widget_muted_light)
            val primaryTextColor = context.getColor(if (isDarkTheme) R.color.widget_text_dark else R.color.widget_text_light)
            val secondaryTextColor = context.getColor(if (isDarkTheme) R.color.widget_secondary_dark else R.color.widget_secondary_light)
            val surfaceColor = context.getColor(if (isDarkTheme) R.color.widget_surface_dark else R.color.widget_surface_light)
            val surfaceAltColor = context.getColor(if (isDarkTheme) R.color.widget_surface_alt_dark else R.color.widget_surface_alt_light)
            val activeChipColor = context.getColor(if (isDarkTheme) R.color.widget_chip_active_dark else R.color.widget_chip_active_light)
            val inactiveChipColor = context.getColor(if (isDarkTheme) R.color.widget_chip_inactive_dark else R.color.widget_chip_inactive_light)
            val controlTint = context.getColor(if (isDarkTheme) R.color.widget_control_tint_dark else R.color.widget_control_tint_light)
            val playButtonColor = context.getColor(if (isDarkTheme) R.color.widget_play_button_dark else R.color.widget_play_button_light)

            var surahName = "Al-Faatiha"
            var ayahNumber = "Ayat 1"
            var arabicText = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ"
            var translation = "In the name of Allah, the Entirely Merciful, the Especially Merciful."
            var totalAyahs = 0
            var ayahIndex = 0

            if (ayahDataJson != null) {
                try {
                    val ayahData = JSONObject(ayahDataJson)
                    surahName = ayahData.optString("surahName").ifBlank { surahName }
                    ayahNumber = ayahData.optString("ayahNumber").ifBlank { ayahNumber }
                    arabicText = ayahData.optString("arabicText").ifBlank { arabicText }
                    translation = ayahData.optString("translation").ifBlank { translation }
                    totalAyahs = ayahData.optInt("totalAyahs", 0)
                    ayahIndex = ayahData.optInt("ayahIndex", 0)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }

            val views = RemoteViews(context.packageName, R.layout.ayat_widget)
            views.setTextViewText(R.id.surah_name, surahName)
            views.setTextViewText(R.id.ayah_number, ayahNumber)
            views.setTextViewText(R.id.arabic_text, arabicText)
            views.setTextViewText(R.id.translation, translation)
            views.setTextViewText(R.id.tafsir_toggle, "Tafsir")

            views.setInt(R.id.widget_root, "setBackgroundColor", surfaceColor)
            views.setTextColor(R.id.surah_name, secondaryTextColor)
            views.setTextColor(R.id.ayah_number, accentColor)
            views.setTextColor(R.id.arabic_text, primaryTextColor)
            views.setTextColor(R.id.translation, secondaryTextColor)
            views.setTextColor(R.id.tafsir_toggle, if (tafsirOn) accentColor else mutedColor)

            // Play/pause icon reflects the current state
            views.setImageViewResource(
                R.id.play_pause_button,
                if (isPlaying) R.drawable.ic_pause else R.drawable.ic_play_arrow
            )

            // Surah progress bar (ayahIndex is 0-based)
            val progressPercent =
                if (totalAyahs > 0) ((ayahIndex + 1) * 100).coerceAtMost(100) else 0
            views.setProgressBar(R.id.progress_bar, 100, progressPercent, false)

            // Language audio toggle chips reflect the saved preferences
            views.setInt(R.id.arabic_toggle, "setBackgroundColor", if (arabicOn) activeChipColor else inactiveChipColor)
            views.setTextColor(R.id.arabic_toggle, if (arabicOn) accentColor else mutedColor)
            views.setInt(R.id.english_toggle, "setBackgroundColor", if (englishOn) activeChipColor else inactiveChipColor)
            views.setTextColor(R.id.english_toggle, if (englishOn) accentColor else mutedColor)
            views.setInt(R.id.tafsir_toggle, "setBackgroundColor", if (tafsirOn) activeChipColor else inactiveChipColor)

            views.setInt(R.id.previous_button, "setColorFilter", controlTint)
            views.setInt(R.id.next_button, "setColorFilter", controlTint)
            views.setInt(R.id.play_pause_button, "setColorFilter", playButtonColor)
            views.setInt(R.id.play_pause_button, "setBackgroundColor", accentColor)
            views.setInt(R.id.previous_button, "setBackgroundColor", surfaceAltColor)
            views.setInt(R.id.next_button, "setBackgroundColor", surfaceAltColor)

            // Tapping the widget body opens the app (no playback action)
            val openAppIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val openAppPendingIntent = PendingIntent.getActivity(
                context, 0, openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // Play/pause: headless action, no activity launch
            val playPausePendingIntent = actionPendingIntent(context, ACTION_PLAY_PAUSE, 1)
            // Next: headless action, no activity launch
            val nextPendingIntent = actionPendingIntent(context, ACTION_NEXT, 2)
            // Previous: headless action, no activity launch
            val previousPendingIntent = actionPendingIntent(context, ACTION_PREVIOUS, 3)
            // Language toggles: headless actions, no activity launch
            val arabicTogglePendingIntent = actionPendingIntent(context, ACTION_TOGGLE_ARABIC, 4)
            val englishTogglePendingIntent = actionPendingIntent(context, ACTION_TOGGLE_ENGLISH, 5)
            val tafsirTogglePendingIntent = actionPendingIntent(context, ACTION_TOGGLE_TAFSIR, 6)

            views.setOnClickPendingIntent(R.id.widget_root, openAppPendingIntent)
            views.setOnClickPendingIntent(R.id.play_pause_button, playPausePendingIntent)
            views.setOnClickPendingIntent(R.id.next_button, nextPendingIntent)
            views.setOnClickPendingIntent(R.id.previous_button, previousPendingIntent)
            views.setOnClickPendingIntent(R.id.arabic_toggle, arabicTogglePendingIntent)
            views.setOnClickPendingIntent(R.id.english_toggle, englishTogglePendingIntent)
            views.setOnClickPendingIntent(R.id.tafsir_toggle, tafsirTogglePendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        private fun actionPendingIntent(context: Context, action: String, requestCode: Int): PendingIntent {
            val intent = Intent(context, AyatWidgetProvider::class.java).apply {
                this.action = action
            }
            return PendingIntent.getBroadcast(
                context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
    }
}
