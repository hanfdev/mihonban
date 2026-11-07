@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package org.mihonban.android.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.QueueMusic
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.activity.compose.BackHandler
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.mihonban.android.playback.DownloadItem
import org.mihonban.android.playback.DownloadStatus

@Composable
fun MiniPlayer(vm: AppViewModel, open: () -> Unit) {
    val state by vm.player.state.collectAsStateWithLifecycle()
    val track = state.current ?: return
    val openLabel = words("打开播放器", "Open player")
    Surface(modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp), shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh, tonalElevation = 0.dp) {
        Column {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f).clickable(role = Role.Button, onClickLabel = openLabel, onClick = open)
                    .semantics { contentDescription = openLabel }.padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Cover(vm.repository.artworkUrl(track.albumId, 160), Modifier.size(40.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                        Text(track.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                PlaybackToggle(state, vm.player::toggle, prominent = false)
                ActionIcon(Icons.Outlined.SkipNext, words("下一首", "Next track"), vm.player::next)
            }
            LinearProgressIndicator(progress = { if (state.durationMs > 0) (state.positionMs.toFloat() / state.durationMs).coerceIn(0f, 1f) else 0f }, modifier = Modifier.fillMaxWidth().height(2.dp))
        }
    }
}

@Composable
fun NowPlayingScreen(vm: AppViewModel, onDismiss: () -> Unit, onAlbum: (String) -> Unit, onArtist: (String) -> Unit) {
    val state by vm.player.state.collectAsStateWithLifecycle()
    val downloads by vm.downloads.items.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var queue by rememberSaveable { mutableStateOf(false) }
    var timer by remember { mutableStateOf(false) }
    var clearQueue by remember { mutableStateOf(false) }
    val track = state.current
    BackHandler { if (queue) queue = false else onDismiss() }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                ActionIcon(Icons.Outlined.KeyboardArrowDown, words("收起播放器", "Close player"), onDismiss)
                Text(if (queue) words("播放队列", "Up next") else words("正在播放", "Now playing"), Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
                ActionIcon(Icons.Outlined.Timer, words("睡眠定时", "Sleep timer"), { timer = true }, state.sleepRemainingMs > 0)
                if (queue) ActionIcon(Icons.AutoMirrored.Outlined.QueueMusic, words("返回播放器", "Back to player"), { queue = false }, true)
            }
            if (queue) {
                Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${state.queue.size} ${words("首歌曲", "tracks")}", Modifier.weight(1f))
                    TextButton({ clearQueue = true }, enabled = state.queue.isNotEmpty()) { Text(words("清空队列", "Clear queue")) }
                }
                val queueState = rememberLazyListState(initialFirstVisibleItemIndex = state.currentIndex.coerceAtLeast(0))
                LazyColumn(Modifier.weight(1f), state = queueState) {
                    itemsIndexed(state.queue, key = { i, t -> "$i:${t.id}" }) { i, item ->
                        Row(Modifier.fillMaxWidth().testTag("queue-track-$i").background(if (i == state.currentIndex) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.background)
                            .clickable { vm.player.skipTo(i) }.padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Cover(vm.repository.artworkUrl(item.albumId, 160), Modifier.size(40.dp))
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f).padding(vertical = 12.dp)) {
                                Text(item.title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    color = if (i == state.currentIndex) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                                Text(item.artist, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            ActionIcon(Icons.Outlined.KeyboardArrowUp, words("上移", "Move up"), { vm.player.move(i, i - 1) }, enabled = i > 0)
                            ActionIcon(Icons.Outlined.KeyboardArrowDown, words("下移", "Move down"), { vm.player.move(i, i + 1) }, enabled = i < state.queue.lastIndex)
                            ActionIcon(Icons.Outlined.Close, words("移出队列", "Remove from queue"), { vm.player.remove(i) })
                        }
                    }
                }
            } else if (track == null) EmptyState(words("队列为空", "The queue is empty"), words("选择一首歌曲开始聆听。", "Choose a track to start listening."))
            else NowPlayingContent(state = state, artworkUrl = vm.repository.artworkUrl(track.albumId, 1200),
                modifier = Modifier.weight(1f).fillMaxWidth(), onToggle = vm.player::toggle,
                onSeek = vm.player::seekTo, onPrevious = vm.player::previous, onNext = vm.player::next,
                onShuffle = { vm.player.setShuffle(!state.shuffle) }, onRepeat = vm.player::cycleRepeat,
                onAlbum = { onAlbum(track.albumId) }, onArtist = onArtist,
                quickActions = {
                    val download = downloads.firstOrNull { it.id == track.id }
                    PlayerQuickActions(download, onDownload = {
                        when (download?.status) {
                            DownloadStatus.QUEUED, DownloadStatus.DOWNLOADING -> vm.downloads.cancel(track.id)
                            DownloadStatus.PAUSED, DownloadStatus.FAILED -> vm.downloads.retry(track.id)
                            DownloadStatus.COMPLETE -> Unit
                            null -> vm.downloads.enqueue(track)
                        }
                    }, onShare = {
                        val url = if (track.albumId.isNotBlank()) "${vm.repository.serverUrl}/#/album/${Uri.encode(track.albumId)}" else vm.repository.serverUrl
                        val intent = Intent(Intent.ACTION_SEND).setType("text/plain")
                            .putExtra(Intent.EXTRA_TEXT, "${track.title} — ${track.artist}\n$url")
                        context.startActivity(Intent.createChooser(intent, null))
                    }, onQueue = { queue = true })
                })
        }
    }
    if (clearQueue) AlertDialog(onDismissRequest = { clearQueue = false },
        title = { Text(words("清空播放队列？", "Clear the queue?")) },
        text = { Text(words("将移除队列中的 ${state.queue.size} 首歌曲并停止播放。", "Remove all ${state.queue.size} tracks and stop playback.")) },
        confirmButton = { TextButton({ clearQueue = false; vm.player.stopAndClear(); onDismiss() }) { Text(words("清空", "Clear")) } },
        dismissButton = { TextButton({ clearQueue = false }) { Text(words("取消", "Cancel")) } })
    if (timer) AlertDialog(onDismissRequest = { timer = false }, title = { Text(words("睡眠定时", "Sleep timer")) },
        text = { Column { listOf(0, 15, 30, 45, 60, 90).forEach { minutes -> TextButton({ vm.player.setSleepTimer(minutes); timer = false }) {
            Text(if (minutes == 0) words("关闭定时", "Turn off") else "$minutes ${words("分钟后停止", "minutes")}")
        } } } }, confirmButton = { TextButton({ timer = false }) { Text(words("取消", "Cancel")) } })
}

@Composable
fun DownloadsScreen(vm: AppViewModel, onAlbum: (String) -> Unit, onArtist: (String) -> Unit) {
    val downloads by vm.downloads.items.collectAsStateWithLifecycle()
    var remove by remember { mutableStateOf<DownloadItem?>(null) }
    val complete = downloads.filter { it.status == DownloadStatus.COMPLETE }
    val bytes = downloads.sumOf { it.bytes }
    Column {
        SectionTitle(words("已下载", "Downloaded"), "${complete.size} · %.1f MB".format(bytes / 1048576.0))
        if (complete.isNotEmpty()) Button({ vm.player.play(complete.map { it.track }, 0, shuffle = false) }, Modifier.padding(horizontal = 20.dp)) {
            Icon(Icons.Outlined.PlayArrow, null); Text(words("播放离线歌曲", "Play downloads"))
        }
        if (downloads.isEmpty()) EmptyState(words("暂无下载", "No downloads"), words("在专辑或歌曲菜单中选择下载。", "Choose Download from an album or track menu."), Icons.Outlined.DownloadForOffline)
        LazyColumn(contentPadding = PaddingValues(vertical = 12.dp)) {
            items(downloads, key = { it.id }) { item ->
                Column {
                    TrackRow(item.track, vm, { if (item.status == DownloadStatus.COMPLETE) vm.player.play(complete.map { it.track }, complete.indexOfFirst { it.id == item.id }) }, onAlbum, onArtist)
                    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(when (item.status) {
                                DownloadStatus.COMPLETE -> words("可离线播放", "Available offline")
                                DownloadStatus.QUEUED -> words("等待下载", "Queued")
                                DownloadStatus.DOWNLOADING -> "${words("下载中", "Downloading")} ${(item.progress * 100).toInt()}%"
                                DownloadStatus.PAUSED -> words("已暂停", "Paused")
                                DownloadStatus.FAILED -> item.error ?: words("下载失败", "Download failed")
                            }, style = MaterialTheme.typography.labelSmall, color = if (item.status == DownloadStatus.FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                            if (item.status == DownloadStatus.DOWNLOADING) LinearProgressIndicator(progress = { item.progress }, Modifier.fillMaxWidth().padding(top = 6.dp))
                        }
                        if (item.status == DownloadStatus.DOWNLOADING || item.status == DownloadStatus.QUEUED) ActionIcon(Icons.Outlined.Pause, words("暂停下载", "Pause download"), { vm.downloads.cancel(item.id) })
                        if (item.status == DownloadStatus.FAILED || item.status == DownloadStatus.PAUSED) ActionIcon(Icons.Outlined.Refresh, words("重试下载", "Retry download"), { vm.downloads.retry(item.id) })
                        ActionIcon(Icons.Outlined.DeleteOutline, words("删除下载", "Delete download"), { remove = item })
                    }
                    HorizontalDivider(Modifier.padding(top = 8.dp))
                }
            }
        }
    }
    remove?.let { item -> AlertDialog(onDismissRequest = { remove = null }, title = { Text(words("删除下载？", "Delete download?")) },
        text = { Text(item.track.title + "\n" + words("只删除此设备中的文件。", "Only the copy on this device will be removed.")) },
        confirmButton = { TextButton({ vm.downloads.remove(item.id); remove = null }) { Text(words("删除", "Delete")) } },
        dismissButton = { TextButton({ remove = null }) { Text(words("取消", "Cancel")) } }) }
}
