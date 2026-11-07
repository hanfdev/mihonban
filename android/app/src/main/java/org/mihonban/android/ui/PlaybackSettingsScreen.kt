package org.mihonban.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.mihonban.android.MihonbanApplication
import org.mihonban.android.playback.PreloadMode

@Composable
fun PlaybackSettingsScreen() {
    val application = LocalContext.current.applicationContext as MihonbanApplication
    val settings = application.playbackSettings
    val mode by settings.preloadMode.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ListItem(headlineContent = { Text(words("下一首预加载", "Preload next track")) },
            supportingContent = { Text(words("提前缓存即将播放的歌曲，减少切歌等待。", "Cache the upcoming track ahead of time for faster transitions.")) },
            leadingContent = { Icon(Icons.Outlined.SkipNext, null) })
        Column(Modifier.selectableGroup()) {
            listOf(PreloadMode.WIFI_ONLY, PreloadMode.ALWAYS, PreloadMode.OFF).forEach { value ->
                val label = when (value) {
                    PreloadMode.WIFI_ONLY -> words("仅 Wi-Fi", "Wi-Fi only")
                    PreloadMode.ALWAYS -> words("始终开启", "Always on")
                    PreloadMode.OFF -> words("关闭", "Off")
                }
                val detail = when (value) {
                    PreloadMode.WIFI_ONLY -> words("切换到移动网络时自动停止预加载", "Stops preloading when switching to mobile data")
                    PreloadMode.ALWAYS -> words("使用 Wi-Fi 或移动流量预加载", "Preload using Wi-Fi or mobile data")
                    PreloadMode.OFF -> words("不提前下载下一首歌曲", "Do not download the next track ahead of playback")
                }
                ListItem(modifier = Modifier.selectable(mode == value, role = Role.RadioButton) { settings.setPreloadMode(value) },
                    headlineContent = { Text(label) }, supportingContent = { Text(detail) },
                    leadingContent = { RadioButton(selected = mode == value, onClick = null) })
            }
        }
        Text(words("按照队列的实际播放顺序预加载，包括随机播放。最多缓存下一首前 16 MB，计入音乐缓存上限；已下载歌曲无需重复加载。暂停播放时停止预加载。", "Follows the actual queue order, including shuffle. Caches up to the first 16 MB of the next track within your music cache limit. Downloaded tracks are skipped. Preloading stops when playback is paused."),
            Modifier.padding(20.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
