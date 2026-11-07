package org.mihonban.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.Player
import org.mihonban.android.playback.PlaybackState

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun NowPlayingContent(
    state: PlaybackState,
    artworkUrl: String,
    modifier: Modifier = Modifier,
    onToggle: () -> Unit,
    onSeek: (Long) -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onShuffle: () -> Unit,
    onRepeat: () -> Unit,
    onAlbum: () -> Unit,
    onArtist: (String) -> Unit,
    quickActions: @Composable () -> Unit = {},
) {
    val track = state.current ?: return
    BoxWithConstraints(modifier.testTag("player-content")) {
        val landscape = maxWidth > maxHeight && maxWidth >= 600.dp
        val tall = maxHeight >= 600.dp
        val horizontalPadding = if (maxWidth < 360.dp) 16.dp else 24.dp
        val metadata: @Composable () -> Unit = {
            Column {
                Text(track.title, Modifier.testTag("player-title").heightIn(min = 48.dp)
                    .clickable(enabled = track.albumId.isNotBlank(), role = Role.Button,
                        onClickLabel = words("查看专辑", "Go to album"), onClick = onAlbum).wrapContentHeight(Alignment.CenterVertically),
                    style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    track.credits.filter { it.name.isNotBlank() }.forEach { credit ->
                        Box(Modifier.heightIn(min = 48.dp).clickable(role = Role.Button) { onArtist(credit.name) },
                            contentAlignment = Alignment.CenterStart) {
                            Text(credit.name, style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (state.sleepRemainingMs > 0) Text(words("定时停止：", "Sleep in: ") + duration(state.sleepRemainingMs / 1000.0),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
                state.error?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    OutlinedButton(onToggle) { Text(words("重试播放", "Retry playback")) }
                }
            }
        }
        val controls: @Composable () -> Unit = {
            PlaybackControls(state, onToggle, onSeek, onPrevious, onNext, onShuffle, onRepeat)
        }
        if (landscape) Row(Modifier.fillMaxSize().padding(horizontal = horizontalPadding, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            Column(Modifier.weight(1f).fillMaxHeight()) {
                PlayerArtwork(artworkUrl, track.albumTitle, Modifier.weight(1f).fillMaxWidth())
                quickActions()
            }
            Column(Modifier.weight(1.25f).fillMaxHeight()) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 8.dp)) { metadata() }
                controls()
            }
        } else Column(Modifier.widthIn(max = 560.dp).fillMaxSize().align(Alignment.Center)
            .padding(horizontal = horizontalPadding).padding(top = 8.dp, bottom = if (tall) 28.dp else 16.dp)) {
            // Measure controls first; artwork only consumes space left above them.
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                val metadataHeight = maxHeight * .62f
                Column(Modifier.fillMaxSize()) {
                    PlayerArtwork(artworkUrl, track.albumTitle, Modifier.weight(1f).fillMaxWidth().padding(bottom = 20.dp),
                        alignment = Alignment.BottomCenter)
                    Column(Modifier.fillMaxWidth().heightIn(max = metadataHeight).verticalScroll(rememberScrollState())
                        .padding(bottom = 8.dp)) { metadata() }
                }
            }
            controls()
            Spacer(Modifier.height(if (tall) 20.dp else 12.dp))
            quickActions()
        }
    }
}

@Composable
private fun PlayerArtwork(url: String, title: String, modifier: Modifier, alignment: Alignment = Alignment.Center) {
    BoxWithConstraints(modifier, contentAlignment = alignment) {
        val side = minOf(maxWidth, maxHeight).coerceAtLeast(0.dp)
        if (side > 0.dp) Cover(url, Modifier.size(side).testTag("player-artwork"), title)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlaybackControls(
    state: PlaybackState, onToggle: () -> Unit, onSeek: (Long) -> Unit,
    onPrevious: () -> Unit, onNext: () -> Unit, onShuffle: () -> Unit, onRepeat: () -> Unit,
) {
    var seek by remember(state.current?.id) { mutableStateOf<Float?>(null) }
    val seekLabel = words("播放进度", "Playback position")
    Column(Modifier.fillMaxWidth().testTag("player-controls")) {
        val max = state.durationMs.coerceAtLeast(1).toFloat()
        Slider(value = (seek ?: state.positionMs.toFloat()).coerceIn(0f, max), onValueChange = { seek = it },
            onValueChangeFinished = { seek?.let { onSeek(it.toLong()) }; seek = null }, valueRange = 0f..max,
            thumb = { Box(Modifier.size(12.dp).background(MaterialTheme.colorScheme.primary, androidx.compose.foundation.shape.CircleShape)) },
            track = { slider -> SliderDefaults.Track(slider, Modifier.height(4.dp), thumbTrackGapSize = 0.dp, drawStopIndicator = null) },
            enabled = state.durationMs > 0, modifier = Modifier.fillMaxWidth().testTag("player-seek")
                .semantics { contentDescription = seekLabel })
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(duration((seek?.toDouble() ?: state.positionMs.toDouble()) / 1000), style = MaterialTheme.typography.labelSmall)
            Text(duration(state.durationMs / 1000.0), style = MaterialTheme.typography.labelSmall)
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically) {
            ActionIcon(Icons.Outlined.Shuffle, words("随机播放", "Shuffle"), onShuffle, state.shuffle)
            ActionIcon(Icons.Outlined.SkipPrevious, words("上一首", "Previous track"), onPrevious)
            PlaybackToggle(state, onToggle, prominent = true)
            ActionIcon(Icons.Outlined.SkipNext, words("下一首", "Next track"), onNext)
            ActionIcon(if (state.repeatMode == Player.REPEAT_MODE_ONE) Icons.Outlined.RepeatOne else Icons.Outlined.Repeat,
                when (state.repeatMode) {
                    Player.REPEAT_MODE_ALL -> words("列表循环", "Repeat all")
                    Player.REPEAT_MODE_ONE -> words("单曲循环", "Repeat one")
                    else -> words("循环关闭", "Repeat off")
                }, onRepeat, state.repeatMode != Player.REPEAT_MODE_OFF)
        }
    }
}

@Composable
internal fun PlaybackToggle(state: PlaybackState, onClick: () -> Unit, prominent: Boolean) {
    val pause = state.isPlaying || (state.isBuffering && state.playWhenReady)
    val action = if (pause) words("暂停", "Pause") else words("播放", "Play")
    val status = if (state.isBuffering) words("缓冲中", "Buffering") else if (state.isPlaying) words("正在播放", "Playing") else words("已暂停", "Paused")
    val modifier = Modifier.size(if (prominent) 72.dp else 48.dp).testTag(if (prominent) "player-toggle" else "mini-player-toggle")
        .semantics { contentDescription = action; stateDescription = status }
    val content: @Composable () -> Unit = {
        Box(contentAlignment = Alignment.Center) {
            if (state.isBuffering) CircularProgressIndicator(Modifier.size(if (prominent) 58.dp else 32.dp),
                color = LocalContentColor.current.copy(alpha = .65f), strokeWidth = 2.dp)
            Icon(if (pause) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, null,
                Modifier.size(if (prominent) 36.dp else 24.dp))
        }
    }
    if (prominent) FilledIconButton(onClick, modifier) { content() }
    else IconButton(onClick, modifier) { content() }
}
