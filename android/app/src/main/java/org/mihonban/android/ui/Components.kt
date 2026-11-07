package org.mihonban.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import org.mihonban.android.MihonbanApplication
import org.mihonban.android.data.Track
import org.mihonban.android.playback.DownloadStore
import org.mihonban.android.playback.DownloadStatus
import android.net.Uri

@Composable
fun words(chinese: String, english: String): String =
    if (LocalConfiguration.current.locales[0].language == "zh") chinese else english

fun duration(seconds: Double): String {
    val n = if (seconds.isFinite()) seconds.toLong().coerceAtLeast(0) else 0
    return if (n >= 3600) "%d:%02d:%02d".format(n / 3600, n / 60 % 60, n % 60)
    else "%d:%02d".format(n / 60, n % 60)
}

@Composable
fun Cover(url: String, modifier: Modifier = Modifier, description: String? = null) {
    val line = MaterialTheme.colorScheme.outlineVariant
    val ink = MaterialTheme.colorScheme.onSurfaceVariant
    val accent = MaterialTheme.colorScheme.primary
    Box(modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainer)) {
        Canvas(Modifier.matchParentSize()) {
            val radius = size.minDimension / 2
            drawCircle(line, radius * .78f, style = Stroke(1.dp.toPx()))
            drawCircle(line, radius * .62f, style = Stroke(1.dp.toPx()))
            drawCircle(ink, radius * .31f)
            drawCircle(accent, radius * .07f)
        }
        if (url.isNotBlank()) AsyncImage(model = scopedImageRequest(url), contentDescription = description,
            modifier = Modifier.matchParentSize(), contentScale = ContentScale.Crop)
    }
}

@Composable
internal fun scopedImageRequest(url: String): ImageRequest {
    val context = LocalContext.current
    val repository = (context.applicationContext as MihonbanApplication).repository
    val session by repository.session.collectAsState()
    val downloads = remember(repository) { DownloadStore.get(context, repository) }
    val downloaded by downloads.items.collectAsState()
    val localArtwork = remember(url, downloaded, session.cacheRole) {
        val segments = Uri.parse(url).pathSegments
        val artIndex = segments.indexOf("art")
        if (artIndex > 0 && segments.getOrNull(artIndex - 1) == "api")
            segments.getOrNull(artIndex + 1)?.let(downloads::artworkFile) else null
    }
    val cacheKey = "${repository.serverScope}/${session.cacheRole}/$url"
    return remember(context, url, cacheKey, localArtwork) {
        ImageRequest.Builder(context).data(localArtwork ?: url).memoryCacheKey(cacheKey).diskCacheKey(cacheKey).build()
    }
}

@Composable
fun ActionIcon(icon: ImageVector, label: String, onClick: () -> Unit, selected: Boolean = false, enabled: Boolean = true) {
    IconButton(onClick = onClick, enabled = enabled) {
        Icon(icon, label, tint = if (selected) MaterialTheme.colorScheme.primary else LocalContentColor.current)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GridDensityControl(columns: Int, compact: Boolean, onClick: () -> Unit) {
    val label = if (compact) words("舒展网格", "Comfortable grid") else words("紧凑网格", "Compact grid")
    val state = words("当前 $columns 列", "$columns columns")
    TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = { PlainTooltip { Text(label) } }, state = rememberTooltipState()) {
        IconButton(onClick, modifier = Modifier
            .semantics { contentDescription = label; stateDescription = state }) {
            Icon(if (compact) Icons.Outlined.Apps else Icons.Outlined.GridView, null, Modifier.size(22.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun TrackDownloadButton(track: Track, vm: AppViewModel) {
    val downloads by vm.downloads.items.collectAsState()
    val download = downloads.firstOrNull { it.id == track.id }
    val downloadedMessage = words("已下载，可离线播放", "Downloaded and available offline")
    when (download?.status) {
        DownloadStatus.COMPLETE -> ActionIcon(Icons.Outlined.DownloadDone, words("已下载", "Downloaded"),
            { vm.notify(downloadedMessage) }, selected = true)
        DownloadStatus.DOWNLOADING, DownloadStatus.QUEUED -> IconButton({ vm.downloads.cancel(track.id) }) {
            Box(contentAlignment = Alignment.Center) {
                if (download.total > 0) CircularProgressIndicator(progress = { download.progress }, modifier = Modifier.size(28.dp), strokeWidth = 2.dp)
                else CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.dp)
                Icon(Icons.Outlined.Pause, words("暂停下载", "Pause download"), Modifier.size(16.dp))
            }
        }
        DownloadStatus.PAUSED, DownloadStatus.FAILED -> ActionIcon(Icons.Outlined.Refresh, words("继续下载", "Resume download"), { vm.downloads.retry(track.id) })
        null -> ActionIcon(Icons.Outlined.Download, words("下载歌曲", "Download track"), { vm.downloads.enqueue(track) })
    }
}

@Composable
fun EmptyState(title: String, subtitle: String, icon: ImageVector = Icons.Outlined.Album, action: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(icon, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
        Text(title, style = MaterialTheme.typography.titleLarge)
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        action?.invoke()
    }
}

@Composable
fun TrackRow(track: Track, vm: AppViewModel, onPlay: () -> Unit, onAlbum: (String) -> Unit,
             onArtist: (String) -> Unit, isCurrent: Boolean = false, index: Int? = null) {
    var menu by remember { mutableStateOf(false) }
    val session by vm.repository.session.collectAsState()
    val catalog by vm.catalog.collectAsState()
    val favorite = catalog.favorites.tracks.any { it.id == track.id }
    val downloads by vm.downloads.items.collectAsState()
    val downloaded = downloads.any { it.id == track.id && it.status == DownloadStatus.COMPLETE }
    val downloadLabel = words("下载", "Download")
    Row(Modifier.fillMaxWidth().background(if (isCurrent) MaterialTheme.colorScheme.surfaceContainer else androidx.compose.ui.graphics.Color.Transparent)
        .clickable(onClick = onPlay).padding(start = 18.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (index != null) Text("${index + 1}", Modifier.width(26.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        else Cover(vm.repository.artworkUrl(track.albumId, 160), Modifier.size(50.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                color = if (isCurrent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
            Text(listOf(track.artist, track.format.uppercase()).filter(String::isNotBlank).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (favorite) Icon(Icons.Outlined.Favorite, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
        if (downloaded) Icon(Icons.Outlined.DownloadDone, words("已下载", "Downloaded"), Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(duration(track.duration), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box {
            ActionIcon(Icons.Outlined.MoreVert, words("歌曲操作", "Track actions"), { menu = true })
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text(words("下一首播放", "Play next")) }, onClick = { vm.player.addNext(track); menu = false })
                DropdownMenuItem(text = { Text(words("加入队列", "Add to queue")) }, onClick = { vm.player.enqueue(track); menu = false })
                DropdownMenuItem(text = { Text(if (downloaded) words("已下载", "Downloaded") else downloadLabel) }, enabled = !downloaded,
                    onClick = { vm.downloads.enqueue(track); menu = false })
                if (session.isAdmin) DropdownMenuItem(text = { Text(if (favorite) words("移出精选", "Remove favorite") else words("加入精选", "Add favorite")) },
                    onClick = { vm.favorite("track", track.id, !favorite); menu = false })
                if (track.albumId.isNotBlank()) DropdownMenuItem(text = { Text(words("查看专辑", "Go to album")) }, onClick = { onAlbum(track.albumId); menu = false })
                track.artists.ifEmpty { listOf(org.mihonban.android.data.ArtistCredit(track.artist)) }.forEach { credit ->
                    DropdownMenuItem(text = { Text(credit.name) }, onClick = { onArtist(credit.name); menu = false })
                }
            }
        }
    }
}

@Composable
fun SectionTitle(title: String, subtitle: String? = null, trailing: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        if (subtitle != null) Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        else Spacer(Modifier.weight(1f))
        trailing?.invoke()
    }
}

@Composable
fun CollectionTabs(tracksSelected: Boolean, albumCount: Int, trackCount: Int, onSelect: (Boolean) -> Unit,
                   actions: @Composable RowScope.() -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState())) {
            listOf(words("专辑", "Albums") to albumCount, words("歌曲", "Tracks") to trackCount).forEachIndexed { index, (label, count) ->
                val selected = tracksSelected == (index == 1)
                Column(Modifier.selectable(selected, role = Role.Tab, onClick = { onSelect(index == 1) }).padding(horizontal = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    Row(Modifier.heightIn(min = 46.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(label, style = MaterialTheme.typography.titleSmall,
                            color = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("$count", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Box(Modifier.width(24.dp).height(2.dp).background(if (selected) MaterialTheme.colorScheme.primary else androidx.compose.ui.graphics.Color.Transparent))
                }
            }
        }
        actions()
    }
}

@Composable
fun CatalogSearchField(value: String, onValueChange: (String) -> Unit, hint: String) {
    val focus = LocalFocusManager.current
    TextField(value, onValueChange, singleLine = true,
        placeholder = { Text(hint, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        leadingIcon = { Icon(Icons.Outlined.Search, null, Modifier.size(20.dp)) },
        trailingIcon = { if (value.isNotEmpty()) ActionIcon(Icons.Outlined.Close, words("清空", "Clear"), { onValueChange("") }) },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
        shape = RoundedCornerShape(12.dp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
            focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
            unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp))
}
