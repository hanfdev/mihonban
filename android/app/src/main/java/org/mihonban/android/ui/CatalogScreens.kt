@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class, androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.mihonban.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.mihonban.android.data.Album
import org.mihonban.android.data.Track
import java.text.Normalizer
import java.util.Locale

internal fun searchKey(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKD)
    .replace(Regex("\\p{M}+"), "").lowercase(Locale.ROOT)

private fun Album.matches(query: String) = query.isBlank() || query.split(Regex("\\s+")).all {
    searchKey("$title $artist ${artists.joinToString { a -> a.name }} $year ${genres.joinToString()} ${secondaryGenres.joinToString()}").contains(it)
}
private fun Track.matches(query: String) = query.isBlank() || query.split(Regex("\\s+")).all {
    searchKey("$title $artist $albumTitle ${artists.joinToString { a -> a.name }} $year $format").contains(it)
}

@Composable
fun LibraryScreen(vm: AppViewModel, onAlbum: (String) -> Unit, onArtist: (String) -> Unit) {
    val catalog by vm.catalog.collectAsStateWithLifecycle()
    var tracksTab by rememberSaveable { mutableStateOf(false) }
    var albumSort by rememberSaveable { mutableIntStateOf(4) }
    var trackSort by rememberSaveable { mutableIntStateOf(0) }
    val sort = if (tracksTab) trackSort else albumSort
    fun setSort(value: Int) { if (tracksTab) trackSort = value else albumSort = value }
    var genre by rememberSaveable { mutableStateOf("") }
    var filters by rememberSaveable { mutableStateOf(false) }
    val compact by vm.compactGrid.collectAsStateWithLifecycle()
    val refreshing by vm.busy.collectAsStateWithLifecycle()
    val sortNames = listOf(words("最近加入", "Recently added"), words("名称", "Title"), words("艺人", "Artist"), words("发行年份", "Year"), words("评分（加权）", "Rating (weighted)"))
    val albums = remember(catalog.albums, albumSort, genre) {
        val filtered = catalog.albums.filter { genre.isEmpty() || it.hasGenre(genre) }
        when (albumSort) {
            1 -> filtered.sortedBy { searchKey(it.title) }
            2 -> filtered.sortedBy { searchKey(it.artistSort.ifBlank { it.artist }) }
            3 -> filtered.sortedByDescending { it.year ?: 0 }
            4 -> filtered.sortedWith(weightedAlbumOrder)
            else -> filtered.sortedByDescending { it.createdAt }
        }
    }
    val tracks = remember(catalog.tracks, albums, genre, sort) {
        val ids = albums.map { it.id }.toSet()
        val filtered = catalog.tracks.filter { genre.isEmpty() || it.albumId in ids }
        when (sort) {
            1 -> filtered.sortedBy { searchKey(it.title) }
            2 -> filtered.sortedBy { searchKey(it.artistSort.ifBlank { it.artist }) }
            3 -> filtered.sortedByDescending { it.year ?: 0 }
            else -> filtered.sortedByDescending { it.addedAt }
        }
    }
    val genres = remember(catalog.albums) { catalog.albums.flatMap { it.genres + it.secondaryGenres }.distinct().sorted() }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val columns = albumColumnCount(maxWidth.value, compact)
        Column(Modifier.fillMaxSize()) {
            CollectionTabs(tracksTab, albums.size, tracks.size, { tracksTab = it }) {
                if (!tracksTab) GridDensityControl(columns, compact, vm::toggleGridDensity)
                ActionIcon(Icons.Outlined.Tune, words("筛选与排序", "Filter and sort"), { filters = true }, genre.isNotBlank() || sort != if (tracksTab) 0 else 4)
            }
            if (genre.isNotBlank()) Row(Modifier.padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(genre, Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary)
                TextButton({ genre = "" }) { Text(words("清除筛选", "Clear filter")) }
            }
            PullToRefreshBox(isRefreshing = refreshing, onRefresh = vm::refresh, modifier = Modifier.weight(1f)) {
                if (genre.isNotEmpty() && (if (tracksTab) tracks.isEmpty() else albums.isEmpty())) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                        EmptyState(words("没有匹配的内容", "No matches"), genre,
                            action = { TextButton({ genre = "" }) { Text(words("查看全部", "Show all")) } })
                    }
                } else if (tracksTab) TrackList(tracks, vm, onAlbum, onArtist)
                else AlbumGrid(albums, vm, onAlbum, columns)
            }
        }
    }
    if (filters) ModalBottomSheet(onDismissRequest = { filters = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface, dragHandle = null) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(words("筛选与排序", "Filter and sort"), Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            ActionIcon(Icons.Outlined.Close, words("关闭筛选", "Close filters"), { filters = false })
        }
        Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
            Text(words("排序", "Sort"), Modifier.padding(top = 16.dp, bottom = 8.dp), style = MaterialTheme.typography.titleSmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                sortNames.forEachIndexed { index, label ->
                    if (!tracksTab || index != 4) FilterChip(sort == index, { setSort(index) }, { Text(label) })
                }
            }
            if (genres.isNotEmpty()) {
                Text(words("风格", "Genres"), Modifier.padding(top = 16.dp, bottom = 8.dp), style = MaterialTheme.typography.titleSmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(genre.isBlank(), { genre = "" }, { Text(words("全部", "All")) })
                    genres.forEach { value -> FilterChip(genre == value, { genre = if (genre == value) "" else value }, { Text(value) }) }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton({ genre = ""; setSort(if (tracksTab) 0 else 4) }) { Text(words("重置", "Reset")) }
            Button({ filters = false }, Modifier.weight(1f)) {
                Text(words("显示", "Show") + " ${if (tracksTab) tracks.size else albums.size} " +
                    if (tracksTab) words("首歌曲", "tracks") else words("张专辑", "albums"))
            }
        }
    }
}

@Composable
fun GenreScreen(genre: String, vm: AppViewModel, onAlbum: (String) -> Unit) {
    val catalog by vm.catalog.collectAsStateWithLifecycle()
    val compact by vm.compactGrid.collectAsStateWithLifecycle()
    val albums = remember(catalog.albums, genre) { catalog.albums.filter { it.hasGenre(genre) }.sortedWith(weightedAlbumOrder) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val columns = albumColumnCount(maxWidth.value, compact)
        Column {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("${albums.size} ${words("张专辑 · 按加权评分", "albums · Weighted rating")}", Modifier.weight(1f),
                    style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                GridDensityControl(columns, compact, vm::toggleGridDensity)
            }
            Box(Modifier.weight(1f)) { AlbumGrid(albums, vm, onAlbum, columns) }
        }
    }
}

@Composable
fun AlbumGrid(albums: List<Album>, vm: AppViewModel, onAlbum: (String) -> Unit, columns: Int = 2) {
    if (albums.isEmpty()) EmptyState(words("这里还没有专辑", "No albums here yet"), words("刷新曲库，或在管理页面导入专辑。", "Refresh your library, or import an album from Administration."))
    else LazyVerticalGrid(columns = GridCells.Fixed(columns),
        modifier = Modifier.fillMaxSize().testTag("album-grid"), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        items(albums, key = { it.id }) { album -> AlbumCard(album, vm, onAlbum) }
    }
}

@Composable
private fun AlbumCard(album: Album, vm: AppViewModel, onAlbum: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().testTag("album-card:${album.id}").clip(RoundedCornerShape(8.dp)).clickable { onAlbum(album.id) }, verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Box {
            Cover(vm.repository.artworkUrl(album.id), Modifier.fillMaxWidth().aspectRatio(1f)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp)))
            album.rym?.rating?.let { rating ->
                Text("★ %.2f".format(rating), modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp)
                    .background(MaterialTheme.colorScheme.background.copy(alpha = .88f), RoundedCornerShape(5.dp)).padding(horizontal = 6.dp, vertical = 3.dp),
                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
            }
            if (album.hidden) Icon(Icons.Outlined.VisibilityOff, words("已隐藏", "Hidden"), Modifier.align(Alignment.TopEnd).padding(8.dp).size(16.dp))
        }
        Text(album.title, Modifier.padding(top = 3.dp), style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(album.artist, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        album.year?.let { Text(it.toString(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
fun TrackList(tracks: List<Track>, vm: AppViewModel, onAlbum: (String) -> Unit, onArtist: (String) -> Unit) {
    val player by vm.player.state.collectAsStateWithLifecycle()
    var shuffle by rememberSaveable { mutableStateOf(false) }
    if (tracks.isEmpty()) EmptyState(words("暂无歌曲", "No tracks"), words("试试其他筛选条件。", "Try a different filter."), Icons.Outlined.MusicNote)
    else LazyColumn(contentPadding = PaddingValues(bottom = 20.dp)) {
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Button({ vm.player.play(tracks, 0, shuffle = shuffle) }) { Icon(Icons.Outlined.PlayArrow, null); Text(words("播放全部", "Play all")) }
                Spacer(Modifier.weight(1f))
                IconToggleButton(checked = shuffle, onCheckedChange = { shuffle = it }, modifier = Modifier.testTag("track-list-shuffle")) {
                    Icon(Icons.Outlined.Shuffle, words("随机播放", "Shuffle"), tint = if (shuffle) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text("${tracks.size}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        itemsIndexed(tracks, key = { _, t -> t.id }) { i, track -> TrackRow(track, vm, { vm.player.play(tracks, i) }, onAlbum, onArtist, track.id == player.current?.id) }
    }
}

@Composable
fun ArtistsScreen(vm: AppViewModel, onArtist: (String) -> Unit) {
    val catalog by vm.catalog.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }
    val artists = remember(catalog.artists, query) { catalog.artists.filter {
        searchKey(it.name + " " + it.aliases.joinToString()).contains(searchKey(query))
    }.sortedBy { searchKey(it.sort.ifBlank { it.name }) } }
    val albumCounts = remember(catalog.albums) { catalog.albums.flatMap { it.credits.map { credit -> credit.name }.distinct() }.groupingBy { it }.eachCount() }
    Column(Modifier.fillMaxSize()) {
        CatalogSearchField(query, { query = it }, words("搜索艺人", "Search artists"))
        LazyColumn(contentPadding = PaddingValues(bottom = 16.dp), modifier = Modifier.weight(1f)) {
            if (artists.isEmpty()) item { EmptyState(words("没有匹配的艺人", "No artists found"), words("尝试其他名称。", "Try another name."), Icons.Outlined.People) }
            items(artists, key = { it.name }) { artist ->
                val count = albumCounts[artist.name] ?: 0
                ListItem(modifier = Modifier.clickable { onArtist(artist.name) }, headlineContent = { Text(artist.name) },
                    supportingContent = { Text("$count ${words("张专辑", "albums")}" + if (artist.featuredTrackCount > 0) " · ${artist.featuredTrackCount} ${words("首参与歌曲", "featured tracks")}" else "") },
                    colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
                    leadingContent = { Cover(vm.repository.artistArtworkUrl(artist.name), Modifier.size(52.dp).clip(androidx.compose.foundation.shape.CircleShape)) },
                    trailingContent = { Icon(Icons.Outlined.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp)) })
            }
        }
    }
}

@Composable
fun SearchScreen(vm: AppViewModel, onAlbum: (String) -> Unit, onArtist: (String) -> Unit) {
    val catalog by vm.catalog.collectAsStateWithLifecycle()
    val player by vm.player.state.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableIntStateOf(0) }
    val key = searchKey(query.trim())
    val albums = remember(catalog.albums, key) { if (key.isBlank()) emptyList() else catalog.albums.filter { it.matches(key) } }
    val tracks = remember(catalog.tracks, key) { if (key.isBlank()) emptyList() else catalog.tracks.filter { it.matches(key) } }
    val artists = remember(catalog.artists, key) { if (key.isBlank()) emptyList() else catalog.artists.filter { searchKey(it.name + " " + it.aliases.joinToString()).contains(key) } }
    val genres = remember(catalog.albums) { catalog.albums.flatMap { it.genres }.groupingBy { it }.eachCount().entries.sortedByDescending { it.value }.take(12).map { it.key } }
    val recent = remember(catalog.albums) { catalog.albums.sortedByDescending { it.createdAt }.take(6) }
    Column(Modifier.fillMaxSize()) {
        CatalogSearchField(query, { query = it }, words("专辑、歌曲、艺人或风格", "Albums, tracks, artists or genres"))
        if (key.isNotBlank()) Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(words("全部", "All"), words("专辑", "Albums"), words("歌曲", "Tracks"), words("艺人", "Artists")).forEachIndexed { index, label ->
                FilterChip(category == index, { category = index }, { Text(label) })
            }
        }
        LazyColumn(contentPadding = PaddingValues(bottom = 16.dp), modifier = Modifier.weight(1f)) {
            if (key.isBlank()) {
                if (genres.isNotEmpty()) item {
                    SectionTitle(words("风格", "Genres"))
                    FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        genres.forEach { value -> SuggestionChip({ query = value; category = 0 }, { Text(value) }) }
                    }
                }
                if (recent.isNotEmpty()) item { SectionTitle(words("最近加入", "Recently added")) }
                items(recent, key = { "recent:${it.id}" }) { album -> AlbumResultRow(album, vm, onAlbum) }
            } else {
                val showAlbums = category == 0 || category == 1
                val showTracks = category == 0 || category == 2
                val showArtists = category == 0 || category == 3
                if ((!showAlbums || albums.isEmpty()) && (!showTracks || tracks.isEmpty()) && (!showArtists || artists.isEmpty()))
                    item { EmptyState(words("没有找到结果", "No results"), words("换一个关键词或分类试试。", "Try another search or category."), Icons.Outlined.SearchOff) }
                if (showArtists && artists.isNotEmpty()) {
                    item { SectionTitle(words("艺人", "Artists"), "${artists.size}") }
                    items(artists, key = { "artist:${it.name}" }) { artist -> ListItem(modifier = Modifier.clickable { onArtist(artist.name) },
                        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
                        headlineContent = { Text(artist.name) }, leadingContent = { Cover(vm.repository.artistArtworkUrl(artist.name), Modifier.size(48.dp)) }) }
                }
                if (showAlbums && albums.isNotEmpty()) {
                    item { SectionTitle(words("专辑", "Albums"), "${albums.size}") }
                    items(albums, key = { "album:${it.id}" }) { album -> AlbumResultRow(album, vm, onAlbum) }
                }
                if (showTracks && tracks.isNotEmpty()) {
                    item { SectionTitle(words("歌曲", "Tracks"), "${tracks.size}") }
                    itemsIndexed(tracks, key = { _, t -> "track:${t.id}" }) { i, track -> TrackRow(track, vm, { vm.player.play(tracks, i) }, onAlbum, onArtist, track.id == player.current?.id) }
                }
            }
        }
    }
}

@Composable
private fun AlbumResultRow(album: Album, vm: AppViewModel, onAlbum: (String) -> Unit) {
    ListItem(modifier = Modifier.clickable { onAlbum(album.id) },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
        headlineContent = { Text(album.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = { Text(listOfNotNull(album.artist, album.year?.toString()).joinToString(" · "), maxLines = 1, overflow = TextOverflow.Ellipsis) },
        leadingContent = { Cover(vm.repository.artworkUrl(album.id, 160), Modifier.size(52.dp)) },
        trailingContent = { Icon(Icons.Outlined.ChevronRight, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) })
}

@Composable
fun FavoritesScreen(vm: AppViewModel, onAlbum: (String) -> Unit, onArtist: (String) -> Unit) {
    val catalog by vm.catalog.collectAsStateWithLifecycle()
    var tracksTab by rememberSaveable { mutableStateOf(false) }
    val compact by vm.compactGrid.collectAsStateWithLifecycle()
    val albums = remember(catalog) { val byId = catalog.albums.associateBy { it.id }; catalog.favorites.albums.mapNotNull { byId[it.id] } }
    val tracks = remember(catalog) { val byId = catalog.tracks.associateBy { it.id }; catalog.favorites.tracks.mapNotNull { byId[it.id] } }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val columns = albumColumnCount(maxWidth.value, compact)
        Column(Modifier.fillMaxSize()) {
            CollectionTabs(tracksTab, albums.size, tracks.size, { tracksTab = it }) {
                if (!tracksTab) GridDensityControl(columns, compact, vm::toggleGridDensity)
            }
            Box(Modifier.weight(1f)) {
                if (albums.isEmpty() && tracks.isEmpty()) EmptyState(words("暂无精选", "No favorites"),
                    words("管理员添加的精选会显示在这里。", "Your curator's album and track selections appear here."), Icons.Outlined.FavoriteBorder)
                else if (tracksTab) TrackList(tracks, vm, onAlbum, onArtist) else AlbumGrid(albums, vm, onAlbum, columns)
            }
        }
    }
}
