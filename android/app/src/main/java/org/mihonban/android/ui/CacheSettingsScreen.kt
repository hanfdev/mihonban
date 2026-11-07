package org.mihonban.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.imageLoader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.mihonban.android.MihonbanApplication
import org.mihonban.android.playback.PlaybackCache

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@OptIn(coil.annotation.ExperimentalCoilApi::class)
@Composable
fun CacheSettingsScreen() {
    val context = LocalContext.current
    val application = context.applicationContext as MihonbanApplication
    val cache = remember { application.playbackCache }
    val limit by cache.limitMb.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var audioBytes by remember { mutableLongStateOf(0) }
    var imageBytes by remember { mutableLongStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var chooseLimit by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var cleared by remember { mutableStateOf(false) }
    suspend fun readUsage() = withContext(Dispatchers.IO) {
        audioBytes = cache.audio.cacheSpace
        imageBytes = context.imageLoader.diskCache?.size ?: 0L
    }
    LaunchedEffect(Unit) { readUsage() }
    val failed = words("缓存操作失败，请重试。", "Could not update the cache. Please retry.")
    fun change(action: suspend () -> Unit) {
        busy = true
        error = null
        cleared = false
        scope.launch {
            try { action(); readUsage() }
            catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (_: Exception) { error = failed }
            finally { busy = false }
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ListItem(headlineContent = { Text(words("音乐缓存", "Music cache")) },
            supportingContent = { Text("%.1f MB".format(audioBytes / 1048576.0)) }, leadingContent = { Icon(Icons.Outlined.MusicNote, null) })
        ListItem(headlineContent = { Text(words("图片缓存", "Image cache")) },
            supportingContent = { Text("%.1f MB / 64 MB".format(imageBytes / 1048576.0)) }, leadingContent = { Icon(Icons.Outlined.Image, null) })
        ListItem(modifier = Modifier.testTag("cache-limit").clickable(enabled = !busy) { chooseLimit = true },
            headlineContent = { Text(words("音乐缓存上限", "Music cache limit")) }, supportingContent = { Text("$limit MB") },
            leadingContent = { Icon(Icons.Outlined.Storage, null) }, trailingContent = { Icon(Icons.Outlined.ChevronRight, null) })
        Text(words("在线播放会自动缓存，达到上限时优先清理较久未使用的内容。降低上限会立即整理缓存。", "Streamed music is cached automatically. Older content is removed when full; lowering the limit frees space immediately."),
            Modifier.padding(20.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton({ confirmClear = true }, Modifier.fillMaxWidth().padding(horizontal = 20.dp).testTag("clear-cache"), enabled = !busy) {
            Icon(Icons.Outlined.DeleteOutline, null)
            Spacer(Modifier.width(8.dp))
            Text(words("清除缓存", "Clear cache"))
        }
        Text(words("清除音乐与图片缓存，保留离线下载、已保存曲库和登录状态。播放过程中可能重新产生缓存。", "Clears music and images. Downloads, saved library and sign-in stay available. Playback may create new cache data."),
            Modifier.padding(20.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 20.dp))
        if (cleared) Text(words("缓存已清除", "Cache cleared"), Modifier.padding(20.dp))
        error?.let { Text(it, Modifier.padding(20.dp), color = MaterialTheme.colorScheme.error) }
    }
    if (chooseLimit) AlertDialog(onDismissRequest = { chooseLimit = false }, title = { Text(words("音乐缓存上限", "Music cache limit")) },
        text = { Column { PlaybackCache.limitsMb.forEach { mb ->
            TextButton({ chooseLimit = false; change { cache.setLimit(mb) } }, Modifier.fillMaxWidth()) {
                RadioButton(selected = limit == mb, onClick = null)
                Spacer(Modifier.width(12.dp)); Text("$mb MB")
            }
        } } }, confirmButton = { TextButton({ chooseLimit = false }) { Text(words("取消", "Cancel")) } })
    if (confirmClear) AlertDialog(onDismissRequest = { confirmClear = false }, title = { Text(words("清除缓存？", "Clear cache?")) },
        text = { Text(words("将清除自动缓存的音频和图片。已下载歌曲会保留。", "Remove automatically cached audio and images. Downloaded songs are kept.")) },
        confirmButton = { TextButton({ confirmClear = false; change {
            cache.clear()
            withContext(Dispatchers.IO) { context.imageLoader.diskCache?.clear() }
            context.imageLoader.memoryCache?.clear()
            cleared = true
        } }) { Text(words("清除", "Clear")) } },
        dismissButton = { TextButton({ confirmClear = false }) { Text(words("取消", "Cancel")) } })
}
