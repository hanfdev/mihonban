@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)

package org.mihonban.android.ui

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import kotlinx.coroutines.CancellationException
import org.mihonban.android.admin.AlbumEditDialog
import org.mihonban.android.admin.AlbumArtworkDialog
import org.mihonban.android.admin.ArtistEditDialog
import org.mihonban.android.admin.TrackEditDialog
import org.mihonban.android.data.*

@Composable
fun AlbumScreen(id: String, vm: AppViewModel, onArtist: (String) -> Unit, onAlbum: (String) -> Unit,
                onReadNote: () -> Unit, onGenre: (String) -> Unit, onDeleted: () -> Unit = {}) {
    val catalog by vm.catalog.collectAsStateWithLifecycle()
    val session by vm.repository.session.collectAsStateWithLifecycle()
    val player by vm.player.state.collectAsStateWithLifecycle()
    var album by remember(id) { mutableStateOf<Album?>(catalog.albums.find { it.id == id }) }
    var error by remember(id) { mutableStateOf<String?>(null) }
    var detailLoaded by remember(id) { mutableStateOf(false) }
    var revision by remember(id) { mutableIntStateOf(0) }
    var edit by remember { mutableStateOf(false) }
    var editArtwork by remember { mutableStateOf(false) }
    var editTrack by remember { mutableStateOf<Track?>(null) }
    var gallery by remember { mutableStateOf<Int?>(null) }
    var albumMenu by remember { mutableStateOf(false) }
    val context = LocalContext.current
    LaunchedEffect(id, revision) {
        detailLoaded = false
        try { album = vm.repository.album(id); detailLoaded = true; error = null }
        catch (e: Exception) {
            if (e is CancellationException) throw e
            if (e is ApiException && e.status in setOf(401, 403, 404)) album = null
            error = e.message
        }
    }
    val currentAlbum = album
    if (currentAlbum == null) {
        if (error != null) EmptyState(words("无法打开专辑", "Unable to load album"), error!!, action = { Button({ revision++ }) { Text(words("重试", "Retry")) } })
        else Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    val tracks = currentAlbum.tracks.ifEmpty { catalog.tracks.filter { it.albumId == id }.sortedWith(compareBy({ it.disc }, { it.track })) }
    val favorite = catalog.favorites.albums.any { it.id == id }
    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
                    Cover(vm.repository.artworkUrl(id, 600), Modifier.size(120.dp).clickable { gallery = 0 }, words("查看封面", "View artwork"))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(currentAlbum.title, style = MaterialTheme.typography.titleLarge)
                        currentAlbum.credits.forEach { credit ->
                            Text(credit.name, Modifier.heightIn(min = 32.dp).clickable { onArtist(credit.name) }.padding(vertical = 6.dp),
                                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(listOfNotNull(currentAlbum.year?.toString(), "${tracks.size} ${words("首歌曲", "tracks")}", duration(currentAlbum.duration)).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        currentAlbum.rym?.rating?.let { Text("★ %.2f  ·  %d %s".format(it, currentAlbum.rym?.votes ?: 0, words("人评分", "ratings")),
                            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary) }
                    }
                }
                val genres = (currentAlbum.genres + currentAlbum.secondaryGenres).distinct()
                if (genres.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    genres.filter { it.isNotBlank() }.forEach { genre ->
                        SuggestionChip(onClick = { onGenre(genre) }, label = { Text(genre) },
                            colors = SuggestionChipDefaults.suggestionChipColors(labelColor = MaterialTheme.colorScheme.onSurfaceVariant))
                    }
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Button({ vm.player.play(tracks, 0, shuffle = false) }, Modifier.weight(1f), enabled = tracks.isNotEmpty()) { Icon(Icons.Outlined.PlayArrow, null); Text(words("播放", "Play")) }
                    ActionIcon(Icons.Outlined.Shuffle, words("随机播放", "Shuffle"), { vm.player.play(tracks, shuffle = true) }, enabled = tracks.isNotEmpty())
                    if (session.isAdmin) ActionIcon(if (favorite) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder,
                        words("精选专辑", "Favorite album"), { vm.favorite("album", id, !favorite) }, favorite)
                    ActionIcon(Icons.Outlined.Download, words("下载专辑", "Download album"), { tracks.forEach { vm.downloads.enqueue(it) } }, enabled = tracks.isNotEmpty())
                    Box {
                        ActionIcon(Icons.Outlined.MoreHoriz, words("专辑操作", "Album actions"), { albumMenu = true })
                        DropdownMenu(albumMenu, { albumMenu = false }) {
                            DropdownMenuItem(text = { Text(words("分享专辑", "Share album")) }, leadingIcon = { Icon(Icons.Outlined.Share, null) }, onClick = {
                                albumMenu = false
                                val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,
                                    "${currentAlbum.artist} — ${currentAlbum.title}\n${vm.repository.serverUrl}/#/album/$id")
                                context.startActivity(Intent.createChooser(intent, null))
                            })
                            if (session.isAdmin) {
                                DropdownMenuItem(text = { Text(words("编辑专辑", "Edit album")) }, enabled = detailLoaded,
                                    leadingIcon = { Icon(Icons.Outlined.Edit, null) }, onClick = { albumMenu = false; edit = true })
                                DropdownMenuItem(text = { Text(words("封面与内页", "Artwork & sleeve notes")) }, enabled = detailLoaded,
                                    leadingIcon = { Icon(Icons.Outlined.PhotoLibrary, null) }, onClick = { albumMenu = false; editArtwork = true })
                            }
                        }
                    }
                }
                if (currentAlbum.note.isNotBlank()) {
                    AlbumNotePreview(currentAlbum.note, onReadNote)
                }
                if (error != null) TextButton({ revision++ }) { Text("${error} · ${words("重试", "Retry")}") }
            }
        }
        itemsIndexed(tracks, key = { _, t -> t.id }) { index, track ->
            if (index == 0 || track.disc != tracks[index - 1].disc) {
                if (tracks.any { it.disc > 1 }) Text("DISC ${track.disc}", Modifier.padding(horizontal = 20.dp, vertical = 12.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { TrackRow(track, vm, { vm.player.play(tracks, index) }, onAlbum, onArtist, track.id == player.current?.id, index) }
                if (session.isAdmin) ActionIcon(Icons.Outlined.Edit, words("编辑歌曲", "Edit track"), { editTrack = track })
            }
        }
        if (currentAlbum.images.isNotEmpty()) item {
            SectionTitle(words("唱片内页", "Sleeve notes"), "${currentAlbum.images.size}")
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                currentAlbum.images.forEachIndexed { index, image -> Cover(vm.repository.imageUrl(image), Modifier.size(140.dp).clickable { gallery = index + 1 }) }
            }
        }
        if (currentAlbum.similar.isNotEmpty()) {
            item { SectionTitle(words("相关专辑", "Related albums")) }
            items(currentAlbum.similar, key = { "similar:${it.id}" }) { similar ->
                ListItem(modifier = Modifier.clickable { onAlbum(similar.id) }, headlineContent = { Text(similar.title) }, supportingContent = { Text(similar.artist) },
                    leadingContent = { Cover(vm.repository.artworkUrl(similar.id, 160), Modifier.size(52.dp)) })
            }
        }
    }
    if (edit) AlbumEditDialog(vm.repository, currentAlbum, { edit = false }, { edit = false; revision++; vm.refresh() }, {
        edit = false
        if (vm.player.state.value.current?.albumId == id) vm.player.stopAndClear()
        vm.refresh()
        onDeleted()
    })
    if (editArtwork) AlbumArtworkDialog(vm.repository, currentAlbum, { editArtwork = false }, { editArtwork = false; revision++; vm.refresh() })
    editTrack?.let { track -> TrackEditDialog(vm.repository, track, { editTrack = null }, { editTrack = null; revision++; vm.refresh() }) }
    gallery?.let { initial -> ArtworkGallery(listOf(vm.repository.artworkUrl(id, 1600)) + currentAlbum.images.map { vm.repository.imageUrl(it) }, initial, { gallery = null }) }
}

@Composable
private fun ArtworkGallery(urls: List<String>, initial: Int, onDismiss: () -> Unit) {
    val pager = rememberPagerState(initialPage = initial.coerceIn(0, urls.lastIndex), pageCount = { urls.size })
    Dialog(onDismiss, DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column {
                Row(Modifier.fillMaxWidth().statusBarsPadding(), verticalAlignment = Alignment.CenterVertically) {
                    ActionIcon(Icons.Outlined.Close, words("关闭图片", "Close artwork"), onDismiss)
                    Text("${pager.currentPage + 1} / ${urls.size}")
                    Spacer(Modifier.weight(1f))
                    Text(words("双指缩放", "Pinch to zoom"), Modifier.padding(12.dp), style = MaterialTheme.typography.labelSmall)
                }
                HorizontalPager(pager, Modifier.weight(1f)) { page ->
                    var scale by remember { mutableFloatStateOf(1f) }
                    var x by remember { mutableFloatStateOf(0f) }
                    var y by remember { mutableFloatStateOf(0f) }
                    AsyncImage(scopedImageRequest(urls[page]), words("专辑图片", "Album artwork"), contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize().pointerInput(Unit) {
                            awaitEachGesture {
                                awaitFirstDown(requireUnconsumed = false)
                                do {
                                    val event = awaitPointerEvent()
                                    if (event.changes.count { it.pressed } > 1 || scale > 1f) {
                                        scale = (scale * event.calculateZoom()).coerceIn(1f, 4f)
                                        val pan = event.calculatePan()
                                        x = if (scale == 1f) 0f else (x + pan.x).coerceIn(-size.width * (scale - 1) / 2, size.width * (scale - 1) / 2)
                                        y = if (scale == 1f) 0f else (y + pan.y).coerceIn(-size.height * (scale - 1) / 2, size.height * (scale - 1) / 2)
                                        event.changes.forEach { it.consume() }
                                    }
                                } while (event.changes.any { it.pressed })
                            }
                        }.graphicsLayer { scaleX = scale; scaleY = scale; translationX = x; translationY = y })
                }
            }
        }
    }
}

@Composable
fun ArtistScreen(name: String, vm: AppViewModel, onAlbum: (String) -> Unit, onArtist: (String) -> Unit) {
    val catalog by vm.catalog.collectAsStateWithLifecycle()
    val session by vm.repository.session.collectAsStateWithLifecycle()
    val showHidden by vm.showHidden.collectAsStateWithLifecycle()
    var bio by remember(name) { mutableStateOf("") }
    var error by remember(name) { mutableStateOf<String?>(null) }
    var featured by remember(name) { mutableStateOf(emptyList<Track>()) }
    var edit by remember { mutableStateOf(false) }
    var revision by remember(name) { mutableIntStateOf(0) }
    val artist = catalog.artists.find { it.name == name } ?: Artist(name)
    val albums = catalog.albums.filter { a -> a.credits.any { it.name == name } }.sortedByDescending { it.year ?: 0 }
    val tracks = remember(catalog.tracks, albums, featured, showHidden, name) {
        val albumIds = albums.map { it.id }.toSet()
        (catalog.tracks.filter { it.albumId in albumIds || it.credits.any { credit -> credit.name == name } } + featured)
            .filter { !it.hidden || (showHidden && session.isAdmin) }.distinctBy { it.id }
            .sortedWith(compareBy<Track>({ it.albumTitle }, { it.disc }, { it.track }, { it.title }))
    }
    LaunchedEffect(name, revision, showHidden) {
        try { bio = vm.repository.artistBio(name); featured = vm.repository.artistTracks(name, showHidden); error = null }
        catch (e: Exception) { if (e is CancellationException) throw e; error = e.message }
    }
    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Cover(vm.repository.artistArtworkUrl(name), Modifier.size(150.dp))
                Text(name, style = MaterialTheme.typography.headlineLarge)
                if (artist.aliases.isNotEmpty()) Text(artist.aliases.joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (bio.isNotBlank()) Text(bio, style = MaterialTheme.typography.bodyMedium)
                if (artist.note.isNotBlank()) Text(artist.note, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Button({ vm.player.play(tracks, 0, shuffle = false) }, enabled = tracks.isNotEmpty()) { Text(words("播放全部", "Play all")) }
                    if (session.isAdmin) OutlinedButton({ edit = true }) { Text(words("编辑艺人", "Edit artist")) }
                }
                if (error != null) TextButton({ revision++ }) { Text("$error · ${words("重试", "Retry")}") }
            }
        }
        item { SectionTitle(words("专辑作品", "Discography"), "${albums.size}") }
        items(albums, key = { "album:${it.id}" }) { album -> ListItem(modifier = Modifier.clickable { onAlbum(album.id) },
            headlineContent = { Text(album.title) }, supportingContent = { Text("${album.year ?: "—"} · ${album.artist}") },
            leadingContent = { Cover(vm.repository.artworkUrl(album.id, 160), Modifier.size(60.dp)) }) }
        item { SectionTitle(words("参与歌曲", "Tracks & collaborations"), "${tracks.size}") }
        itemsIndexed(tracks, key = { _, t -> "track:${t.id}" }) { i, track -> TrackRow(track, vm, { vm.player.play(tracks, i) }, onAlbum, onArtist) }
    }
    if (edit) ArtistEditDialog(vm.repository, artist, { edit = false }, { edit = false; revision++; vm.refresh() })
}
