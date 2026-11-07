package org.mihonban.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.commonmark.node.Node
import org.mihonban.android.data.Album

@Composable
internal fun AlbumNotePreview(source: String, onRead: () -> Unit) {
    var preview by remember(source) { mutableStateOf("") }
    LaunchedEffect(source) {
        preview = withContext(Dispatchers.Default) { MarkdownDocument.preview(MarkdownDocument.parse(source)) }
    }
    Column(Modifier.fillMaxWidth().testTag("album-note-preview").clickable(role = Role.Button, onClick = onRead)
        .padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(words("专辑简介", "About this album"), style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(preview, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 3, overflow = TextOverflow.Ellipsis)
        Row(Modifier.heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(words("阅读全文", "Read full description"), style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary)
            Icon(Icons.Outlined.ChevronRight, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
internal fun AlbumNoteReader(id: String, vm: AppViewModel, onClose: () -> Unit) {
    val catalog by vm.catalog.collectAsStateWithLifecycle()
    var album by remember(id) { mutableStateOf<Album?>(null) }
    var document by remember(id) { mutableStateOf<Node?>(null) }
    var error by remember(id) { mutableStateOf<String?>(null) }
    var revision by remember { mutableIntStateOf(0) }
    LaunchedEffect(id, revision) {
        error = null
        try {
            val result = vm.repository.album(id)
            val parsed = withContext(Dispatchers.Default) { MarkdownDocument.parse(result.note) }
            album = result
            document = parsed
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            error = e.message
        }
    }
    BackHandler(onBack = onClose)
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val snackbars = remember { SnackbarHostState() }
    val showTop by remember {
        derivedStateOf {
            // A single Markdown paragraph, quote or list may span several screens.
            listState.canScrollBackward && (listState.firstVisibleItemIndex > 0 ||
                listState.firstVisibleItemScrollOffset > listState.layoutInfo.viewportSize.height / 2)
        }
    }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
            Row(Modifier.fillMaxWidth().testTag("note-reader-header").padding(start = 20.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Cover(vm.repository.artworkUrl(id, 160), Modifier.size(44.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(words("专辑简介", "About this album"), style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(album?.title ?: catalog.albums.find { it.id == id }?.title.orEmpty(),
                        style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                ActionIcon(Icons.Outlined.Close, words("关闭简介", "Close description"), onClose)
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Box(Modifier.fillMaxWidth().weight(1f)) {
                when {
                    error != null -> EmptyState(words("无法加载简介", "Unable to load description"), error.orEmpty(),
                        action = { TextButton({ revision++ }) { Text(words("重试", "Retry")) } })
                    document == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    album?.note.isNullOrBlank() -> EmptyState(words("暂无简介", "No description yet"), "")
                    else -> SelectionContainer {
                        LazyColumn(state = listState, modifier = Modifier.widthIn(max = 760.dp).fillMaxSize()
                            .align(Alignment.TopCenter).testTag("note-reader-body"),
                            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 88.dp),
                            verticalArrangement = Arrangement.spacedBy(18.dp)) {
                            itemsIndexed(document!!.children()) { _, block ->
                                MarkdownBlock(block, vm.repository.serverUrl, { message -> scope.launch { snackbars.showSnackbar(message) } })
                            }
                        }
                    }
                }
                if (showTop) SmallFloatingActionButton({ scope.launch { listState.animateScrollToItem(0) } },
                    Modifier.align(Alignment.BottomEnd).padding(16.dp), containerColor = MaterialTheme.colorScheme.surfaceContainerHigh) {
                    Icon(Icons.Outlined.VerticalAlignTop, words("回到简介顶部", "Back to description top"))
                }
                SnackbarHost(snackbars, Modifier.align(Alignment.BottomCenter))
            }
        }
    }
}
