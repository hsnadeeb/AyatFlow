package com.hasnadeeb.ayahflow

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs widget playback commands as a headless JS task without any UI.
 *
 * The service is started with [android.content.Context.startForegroundService]
 * (the only allowed way to launch from a widget tap while the app is dead),
 * so it must call [startForeground] within a few seconds. Once playback is
 * actually running, expo-audio's own media-session foreground service keeps
 * the process alive and this transient notification is dismissed.
 */
class WidgetActionService : HeadlessJsTaskService() {

    private val handler = Handler(Looper.getMainLooper())

    private val dismissForegroundRunnable = object : Runnable {
        override fun run() {
            val playing = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .getBoolean(KEY_IS_PLAYING, false)
            if (playing) {
                // Playback started: the media notification from expo-audio keeps
                // the process alive, so this transient notification can go away.
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                handler.postDelayed(this, 1000)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val result = super.onStartCommand(intent, flags, startId)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                buildNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } else {
            @Suppress("DEPRECATION")
            startForeground(NOTIFICATION_ID, buildNotification())
        }
        handler.removeCallbacks(dismissForegroundRunnable)
        handler.postDelayed(dismissForegroundRunnable, 4000)
        return result
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(dismissForegroundRunnable)
    }

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val action = intent?.getStringExtra(EXTRA_ACTION) ?: return null
        val data = Arguments.createMap().apply {
            putString("action", action)
        }
        return HeadlessJsTaskConfig(
            taskKey = TASK_KEY,
            data = data,
            timeout = 0, // no timeout: the task stays alive while audio is playing
            isAllowedInForeground = true // must run even when the app UI is visible
        )
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Widget playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Playback controls started from the home screen widget"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Ayat Flow")
            .setContentText("Preparing playback…")
            .setContentIntent(pendingIntent)
            .setOnlyAlertOnce(true)
            .build()
    }

    companion object {
        const val TASK_KEY = "WidgetPlaybackTask"
        const val EXTRA_ACTION = "action"
        private const val CHANNEL_ID = "widget_action"
        private const val NOTIFICATION_ID = 1001
        private const val PREFS_NAME = "AyahWidgetPrefs"
        private const val KEY_IS_PLAYING = "isPlaying"
    }
}
