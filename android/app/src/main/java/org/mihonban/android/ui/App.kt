@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.mihonban.android.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.mihonban.android.admin.AdminScreen
import org.mihonban.android.admin.ImportScreen

@Composable
fun MihonbanApp(vm: AppViewModel) {
    val ready by vm.ready.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val offline by vm.offline.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val player by vm.player.state.collectAsStateWithLifecycle()
    val session by vm.repository.session.collectAsStateWithLifecycle()
    val identity = vm.repository.serverScope + ":" + session.cacheRole
    // Keep state objects stable for callbacks retained by Scaffold's subcompositions.
    var savedIdentity by rememberSaveable { mutableStateOf(identity) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var routes by rememberSaveable { mutableStateOf(listOf<String>()) }
    var nowPlaying by rememberSaveable { mutableStateOf(false) }
    val activeRoutes = if (savedIdentity == identity) routes else emptyList()
    val activeTab = if (savedIdentity == identity) tab else 0
    val showPlayer = savedIdentity == identity && nowPlaying
    LaunchedEffect(identity) {
        if (savedIdentity != identity) {
            tab = 0
            routes = emptyList()
            nowPlaying = false
            savedIdentity = identity
        }
    }
    val screens = rememberSaveableStateHolder()
    val snackbars = remember { SnackbarHostState() }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(ready) {
        if (ready && Build.VERSION.SDK_INT >= 33) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        if (!ready) { routes = emptyList(); nowPlaying = false }
    }
    LaunchedEffect(message) { message?.let { snackbars.showSnackbar(it); vm.clearMessage() } }
    fun open(route: String) { routes = routes + route }
    fun back() { routes = routes.dropLast(1) }
    BackHandler(showPlayer || activeRoutes.isNotEmpty()) { if (showPlayer) nowPlaying = false else back() }
    val labels = listOf(words("曲库", "Library"), words("搜索", "Search"), words("艺人", "Artists"), words("精选", "Favorites"), words("我的", "More"))
    val icons = listOf(Icons.Outlined.Album, Icons.Outlined.Search, Icons.Outlined.People, Icons.Outlined.FavoriteBorder, Icons.Outlined.Tune)
    val barState = rememberTopAppBarState()
    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior(barState,
        canScroll = { activeRoutes.isEmpty() && activeTab != 4 })
    LaunchedEffect(activeTab, activeRoutes, ready) { barState.heightOffset = 0f; barState.contentOffset = 0f }
    val route = activeRoutes.lastOrNull()
    val pageTitle = when {
        route?.startsWith("album:") == true -> words("专辑", "Album")
        route?.startsWith("artist:") == true -> words("艺人", "Artist")
        route == "downloads" -> words("离线下载", "Downloads")
        route == "cache" -> words("缓存设置", "Cache settings")
        route == "playback-settings" -> words("播放设置", "Playback settings")
        route?.startsWith("genre:") == true -> route.removePrefix("genre:")
        route == "admin" -> words("管理中心", "Administration")
        route == "import" -> words("导入专辑", "Import albums")
        activeTab == 0 -> "見本盤"
        else -> labels[activeTab]
    }
    if (showPlayer) {
        NowPlayingScreen(vm, { nowPlaying = false }, { nowPlaying = false; open("album:$it") }, { nowPlaying = false; open("artist:$it") })
        return
    }
    if (ready && route?.startsWith("album-note:") == true) {
        screens.SaveableStateProvider("$identity:$route") {
            AlbumNoteReader(route.removePrefix("album-note:"), vm, { back() })
        }
        return
    }
    Scaffold(modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection), snackbarHost = { SnackbarHost(snackbars) },
        topBar = { if (ready) Column(Modifier.statusBarsPadding()) {
            MainTopBar(title = pageTitle, scrollBehavior = scrollBehavior,
                navigationIcon = { if (activeRoutes.isNotEmpty()) ActionIcon(Icons.AutoMirrored.Outlined.ArrowBack, words("返回", "Back"), { back() }) },
                actions = {
                    if (activeRoutes.isEmpty() && activeTab == 0)
                        ActionIcon(Icons.Outlined.Search, words("搜索曲库", "Search library"), { tab = 1 })
                    ActionIcon(Icons.Outlined.Refresh, words("刷新曲库", "Refresh library"), vm::refresh, enabled = !busy)
                })
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp))
            if (offline) Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
                Text(words("离线模式 · 已缓存曲库和下载仍可使用", "Offline · Cached library and downloads are available"),
                    Modifier.fillMaxWidth().padding(10.dp), style = MaterialTheme.typography.labelMedium)
            }
        } },
        bottomBar = { if (ready) Column(Modifier.background(MaterialTheme.colorScheme.surface).navigationBarsPadding()) {
            if (player.current != null) MiniPlayer(vm, { nowPlaying = true })
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            NavigationBar(modifier = Modifier.height(64.dp), windowInsets = WindowInsets(0, 0, 0, 0),
                containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
                labels.forEachIndexed { i, title -> NavigationBarItem(selected = activeTab == i, onClick = { tab = i; routes = emptyList() },
                    modifier = Modifier.testTag("nav-$i"),
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = MaterialTheme.colorScheme.primary,
                        selectedTextColor = MaterialTheme.colorScheme.onSurface, indicatorColor = MaterialTheme.colorScheme.surfaceContainerHigh),
                    icon = { Icon(icons[i], null, Modifier.size(22.dp)) }, label = { Text(title, style = MaterialTheme.typography.labelSmall) }) }
            }
        } }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            if (!ready) LoginScreen(vm, busy)
            else {
                screens.SaveableStateProvider("$identity:${route ?: "tab:$activeTab"}") {
                when {
                    route?.startsWith("album:") == true -> AlbumScreen(route.removePrefix("album:"), vm, { open("artist:$it") }, { open("album:$it") },
                        onReadNote = { open("album-note:${route.removePrefix("album:")}") }, onGenre = { open("genre:$it") }, onDeleted = { back() })
                    route?.startsWith("artist:") == true -> ArtistScreen(route.removePrefix("artist:"), vm, { open("album:$it") }, { open("artist:$it") })
                    route == "downloads" -> DownloadsScreen(vm, { open("album:$it") }, { open("artist:$it") })
                    route == "cache" -> CacheSettingsScreen()
                    route == "playback-settings" -> PlaybackSettingsScreen()
                    route?.startsWith("genre:") == true -> GenreScreen(route.removePrefix("genre:"), vm, { open("album:$it") })
                    route == "admin" && session.isAdmin -> AdminScreen(vm.repository, vm::refresh)
                    route == "import" && session.isAdmin -> ImportScreen(vm.repository) { vm.refresh(); routes = routes.dropLast(1) + "album:$it" }
                    activeTab == 0 -> LibraryScreen(vm, { open("album:$it") }, { open("artist:$it") })
                    activeTab == 1 -> SearchScreen(vm, { open("album:$it") }, { open("artist:$it") })
                    activeTab == 2 -> ArtistsScreen(vm, { open("artist:$it") })
                    activeTab == 3 -> FavoritesScreen(vm, { open("album:$it") }, { open("artist:$it") })
                    else -> MoreScreen(vm, { open(it) })
                }
                }
            }
        }
    }
}

@Composable
private fun LoginScreen(vm: AppViewModel, busy: Boolean) {
    var server by rememberSaveable { mutableStateOf(vm.repository.serverUrl) }
    var password by remember { mutableStateOf("") }
    val focusManager = LocalFocusManager.current
    val connect = {
        if (!busy && server.isNotBlank()) {
            focusManager.clearFocus()
            vm.connect(server.trim(), password)
            password = ""
        }
    }
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(28.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(org.mihonban.android.R.drawable.ic_launcher), null, Modifier.size(112.dp))
        Spacer(Modifier.height(24.dp))
        Text("見本盤", fontFamily = BrandSerif, fontSize = 42.sp)
        Text("MIHONBAN / YOUR PRIVATE RECORD COLLECTION", style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp, bottom = 40.dp))
        Text(words("连接你的音乐世界", "Your collection, wherever you are"), style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(20.dp))
        OutlinedTextField(server, { server = it }, label = { Text(words("服务器地址", "Server address")) },
            placeholder = { Text("https://music.example.com") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
            keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Next) }), enabled = !busy)
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(password, { password = it }, label = { Text(words("访问口令", "Passphrase")) },
            supportingText = { Text(words("启用访客访问时可留空", "Leave blank when guest access is enabled")) },
            singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { connect() }), enabled = !busy)
        Spacer(Modifier.height(20.dp))
        Button(connect, enabled = !busy && server.isNotBlank(), modifier = Modifier.fillMaxWidth().height(52.dp)) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text(words("连接曲库", "Connect to library"))
        }
        Text(words("使用现有 Mihonban 服务器；管理员口令会解锁管理功能。局域网可填写电脑的 IP 地址。", "Connect to your existing Mihonban server. An administrator passphrase unlocks management. On your local network, use your computer's IP address."),
            modifier = Modifier.padding(top = 20.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun MoreScreen(vm: AppViewModel, open: (String) -> Unit) {
    val session by vm.repository.session.collectAsStateWithLifecycle()
    val hidden by vm.showHidden.collectAsStateWithLifecycle()
    var confirmLogout by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Surface(Modifier.padding(16.dp).fillMaxWidth(), shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Icon(Icons.Outlined.Dns, null, tint = MaterialTheme.colorScheme.primary)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(if (session.isAdmin) words("管理员", "Administrator") else if (session.guest) words("访客 · 只读", "Guest · Read only") else words("听众 · 只读", "Listener · Read only"), style = MaterialTheme.typography.titleSmall)
                    Text(vm.repository.serverUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        ListItem(modifier = Modifier.clickable { open("downloads") }, headlineContent = { Text(words("离线下载", "Downloads")) }, supportingContent = { Text(words("保存音乐，随时聆听", "Keep your music close, even offline")) },
            leadingContent = { Icon(Icons.Outlined.DownloadForOffline, null) }, trailingContent = { Icon(Icons.Outlined.ChevronRight, null) })
        ListItem(modifier = Modifier.clickable { open("cache") }, headlineContent = { Text(words("缓存设置", "Cache settings")) },
            supportingContent = { Text(words("容量上限与清理", "Size limit and cleanup")) },
            leadingContent = { Icon(Icons.Outlined.Storage, null) }, trailingContent = { Icon(Icons.Outlined.ChevronRight, null) })
        ListItem(modifier = Modifier.clickable { open("playback-settings") }, headlineContent = { Text(words("播放设置", "Playback settings")) },
            supportingContent = { Text(words("下一首预加载与网络偏好", "Next-track preloading and network preferences")) },
            leadingContent = { Icon(Icons.Outlined.GraphicEq, null) }, trailingContent = { Icon(Icons.Outlined.ChevronRight, null) })
        if (session.isAdmin) {
            ListItem(modifier = Modifier.clickable { open("admin") }, headlineContent = { Text(words("管理中心", "Administration")) }, supportingContent = { Text(words("存储、权限、服务状态", "Storage, access and server status")) },
                leadingContent = { Icon(Icons.Outlined.Settings, null) }, trailingContent = { Icon(Icons.Outlined.ChevronRight, null) })
            ListItem(modifier = Modifier.clickable { open("import") }, headlineContent = { Text(words("导入专辑", "Import albums")) }, supportingContent = { Text(words("扫描服务器目录与 Discogs 元数据", "Scan server folders and look up Discogs metadata")) },
                leadingContent = { Icon(Icons.Outlined.LibraryAdd, null) }, trailingContent = { Icon(Icons.Outlined.ChevronRight, null) })
            ListItem(headlineContent = { Text(words("显示隐藏专辑", "Show hidden albums")) }, trailingContent = { Switch(hidden, { vm.toggleHidden() }) })
        }
        HorizontalDivider(Modifier.padding(horizontal = 16.dp, vertical = 12.dp))
        Text("Mihonban Android ${org.mihonban.android.BuildConfig.VERSION_NAME} · AGPL-3.0-only", Modifier.padding(horizontal = 20.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton({ confirmLogout = true }, Modifier.padding(20.dp).fillMaxWidth()) { Text(words("退出并更换服务器", "Sign out / Change server")) }
    }
    if (confirmLogout) AlertDialog(onDismissRequest = { confirmLogout = false }, title = { Text(words("退出登录？", "Sign out?")) },
        text = { Text(words("播放将停止。已下载文件会保留在本机，下次连接此服务器时可继续使用。", "Playback will stop. Downloads stay on this device for your next connection to this server.")) },
        confirmButton = { TextButton({ confirmLogout = false; vm.signOut() }) { Text(words("退出", "Sign out")) } },
        dismissButton = { TextButton({ confirmLogout = false }) { Text(words("取消", "Cancel")) } })
}
