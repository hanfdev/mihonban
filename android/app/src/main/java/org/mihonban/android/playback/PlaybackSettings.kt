package org.mihonban.android.playback

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

class PlaybackSettings(context: Context) {
    private val preferences = context.getSharedPreferences("mihonban_playback", Context.MODE_PRIVATE)
    private val mutableMode = MutableStateFlow(PreloadMode.entries.find {
        it.name == preferences.getString("preload_mode", null)
    } ?: PreloadMode.WIFI_ONLY)
    val preloadMode = mutableMode.asStateFlow()

    fun setPreloadMode(mode: PreloadMode) {
        preferences.edit().putString("preload_mode", mode.name).apply()
        mutableMode.value = mode
    }
}
