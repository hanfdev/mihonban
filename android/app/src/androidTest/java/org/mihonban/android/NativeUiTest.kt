package org.mihonban.android

import android.Manifest
import android.app.LocaleManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Build
import android.os.LocaleList
import android.util.Log
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso.closeSoftKeyboard
import androidx.test.espresso.Espresso.pressBack
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.rules.TestName
import org.mihonban.android.playback.PreloadMode
import org.mihonban.android.playback.PlaybackSettings
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.PI
import kotlin.math.sin

@RunWith(AndroidJUnit4::class)
class NativeUiTest {
    @get:Rule val compose = createEmptyComposeRule()
    @get:Rule val testName = TestName()
    private val application get() = ApplicationProvider.getApplicationContext<MihonbanApplication>()
    private val server = MockWebServer()
    private val authenticated = AtomicBoolean(false)
    @Volatile private var guest = true
    @Volatile private var administrator = false
    @Volatile private var expandedCatalog = false
    @Volatile private var discoveryCatalog = false
    private val fixtureTitles = listOf("Evening Signals", "Quiet Geometry", "Northern Lights", "Slow Motion", "Paper Moon", "Soft Focus",
        "The Blue Room", "Distant Cities", "Sunday Sketches", "Velvet Lines", "Open Water", "After the Rain", "Inner Space", "Daybreak", "Small Hours", "Echo Patterns")
    private val albumTitle = AtomicReference("Midnight Sessions")
    private val trackTitle = AtomicReference("Blue Hour")
    private val albumNote = AtomicReference("A late-night session, carried in your pocket.")
    private val noteImageAvailable = AtomicBoolean(false)
    private val noteImageRequests = AtomicInteger(0)
    private val albumPatch = AtomicReference<String?>(null)
    private val settingsWrite = AtomicReference<String?>(null)
    private val overviewReads = AtomicInteger(0)
    private var scenario: ActivityScenario<MainActivity>? = null
    private val album = """{"id":"ui-album","title":"Midnight Sessions","artist":"The Native Quartet",
        "artists":[{"name":"The Native Quartet"}],"year":1964,"trackCount":1,"duration":30,
        "genres":["Jazz"],"rym":{"rating":4.2,"votes":500},"createdAt":100,"hidden":false}"""
    private val track get() = """{"id":"ui-track","title":"${trackTitle.get()}","artist":"The Native Quartet",
        "artists":[{"name":"The Native Quartet"}],"albumId":"ui-album","albumTitle":"Midnight Sessions",
        "duration":30,"format":"wav","track":1,"disc":1,"year":1964,"hidden":0}"""

    @Before fun setup() = runBlocking {
        application.getSharedPreferences("mihonban_ui", android.content.Context.MODE_PRIVATE).edit().clear().commit()
        if (Build.VERSION.SDK_INT >= 33) InstrumentationRegistry.getInstrumentation().runOnMainSync {
            application.getSystemService(LocaleManager::class.java).applicationLocales = LocaleList.forLanguageTags("zh-CN")
        }
        if (Build.VERSION.SDK_INT >= 33) InstrumentationRegistry.getInstrumentation().uiAutomation
            .grantRuntimePermission(application.packageName, Manifest.permission.POST_NOTIFICATIONS)
        val artwork = artwork()
        val covers = fixtureTitles.indices.map { artwork(it + 1) }
        val audio = tone()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty().substringBefore('?')
                val role = if (administrator && authenticated.get()) "admin" else "user"
                if (path == "/api/me") return json(if (guest || authenticated.get())
                    """{"ok":true,"role":"$role","guest":${!authenticated.get()}}""" else """{"ok":false,"role":null}""")
                if (path == "/api/login") {
                    if (!request.body.readUtf8().contains("fixture-passphrase")) return json("""{"error":"wrong password"}""").setResponseCode(401)
                    authenticated.set(true)
                    val loginRole = if (administrator) "admin" else "user"
                    return json("""{"ok":true,"role":"$loginRole"}""")
                        .setHeader("Set-Cookie", "mihonban_session=fixture-session; Path=/; Max-Age=3600; HttpOnly")
                }
                if (path == "/api/logout") { authenticated.set(false); return json("""{"ok":true}""") }
                if (!guest && !authenticated.get()) return json("""{"error":"unauthorized"}""").setResponseCode(401)
                if ((path.startsWith("/api/admin/") || request.method in listOf("PATCH", "PUT")) &&
                    !(administrator && authenticated.get())) return json("""{"error":"forbidden"}""").setResponseCode(403)
                return when {
                    path == "/note-photo.png" -> {
                        noteImageRequests.incrementAndGet()
                        if (noteImageAvailable.get()) MockResponse().setHeader("Content-Type", "image/png")
                            .setBody(Buffer().write(artwork))
                        else MockResponse().setResponseCode(404).setHeader("Cache-Control", "no-store")
                    }
                    path == "/api/library" -> json(if (discoveryCatalog) discoveryAlbums() else if (expandedCatalog) expandedAlbums() else "[${album.replace("Midnight Sessions", albumTitle.get())}]")
                    path == "/api/tracks" -> json("[$track]")
                    path == "/api/artists" -> json("""[{"name":"The Native Quartet","hasBio":true}]""")
                    path == "/api/favorites" -> json("""{"albums":[{"id":"ui-album","order":0}],"tracks":[{"id":"ui-track","order":0}]}""")
                    path == "/api/album/ui-album" && request.method == "PATCH" -> {
                        val body = request.body.readUtf8()
                        albumPatch.set(body)
                        albumTitle.set(Json.parseToJsonElement(body).jsonObject.getValue("title").jsonPrimitive.content)
                        json("""{"ok":true}""")
                    }
                    path == "/api/album/ui-album" -> json((if (discoveryCatalog) discoveryAlbum else album).replace("Midnight Sessions", albumTitle.get()).trim().dropLast(1) + """, "tracks":[$track],"images":["ui-sleeve"],"note":${JsonPrimitive(albumNote.get())}}""")
                    path == "/api/admin/overview" -> {
                        overviewReads.incrementAndGet()
                        json("""{"albums":1,"tracks":1,"bytes":1000000,"newPosts":0,"companionLastSeen":null,"sourceLastScan":null,"sourceLastError":""}""")
                    }
                    path == "/api/admin/settings" && request.method == "PUT" -> {
                        settingsWrite.set(request.body.readUtf8())
                        json("""{"ok":true}""")
                    }
                    path == "/api/admin/settings" -> json("""{"guestOpen":false,"moduleSource":false,"streamProxy":false,"sourceUrl":"","streamProxyUrl":"","discogsToken":"","archivePasswords":[]}""")
                    path == "/api/admin/storages" -> json("""{"storages":[]}""")
                    path == "/api/admin/r2" -> json("""{"enabled":false,"endpoint":"","bucket":"","publicUrl":"","mirrored":0}""")
                    path.startsWith("/api/artist-bio/") -> json("""{"bio":"Four musicians. One memorable session."}""")
                    path.startsWith("/api/artists/") -> json("[]")
                    path.startsWith("/api/art/") || path.startsWith("/api/artist-art/") || path.startsWith("/api/image/") -> {
                        val index = path.substringAfterLast('/').removePrefix("fixture-").toIntOrNull()
                        MockResponse().setHeader("Content-Type", "image/png").setBody(Buffer().write(index?.let { covers.getOrNull(it) } ?: artwork))
                    }
                    path == "/api/stream/ui-track" -> {
                        val start = Regex("bytes=(\\d+)-").find(request.getHeader("Range").orEmpty())?.groupValues?.get(1)?.toIntOrNull() ?: 0
                        if (start >= audio.size) MockResponse().setResponseCode(416)
                        else MockResponse().setHeader("Content-Type", "audio/wav").setHeader("Accept-Ranges", "bytes")
                            .apply { if (start > 0) setResponseCode(206).setHeader("Content-Range", "bytes $start-${audio.lastIndex}/${audio.size}") }
                            .setBody(Buffer().write(audio, start, audio.size - start))
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        application.repository.configureServer(server.url("/").toString())
    }

    @After fun teardown() {
        snapshot("end-${testName.methodName}")
        scenario?.close()
        runBlocking { application.repository.logout() }
        server.shutdown()
    }

    @Test fun guestBrowsesSearchFavoritesArtistAndNativePlayer() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitText("Midnight Sessions")
        screenshot("01-library")
        compose.onNodeWithText("Midnight Sessions").performClick()
        waitText("A late-night session, carried in your pocket.")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText(label("唱片内页", "Sleeve notes")))
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(0)
        screenshot("02-album")
        compose.onNode(hasText("The Native Quartet") and hasClickAction()).performScrollTo().performClick()
        waitText("Four musicians. One memorable session.")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("Blue Hour"))
        compose.onNodeWithText("Blue Hour").assertExists()
        compose.onNodeWithContentDescription(label("返回", "Back")).performClick()
        compose.onNodeWithText(label("播放", "Play"), useUnmergedTree = true).performScrollTo().performClick()
        compose.onNodeWithTag("nav-4").performClick()
        waitText(label("访客 · 只读", "Guest · Read only"))
        compose.onNodeWithText(label("管理中心", "Administration")).assertDoesNotExist()
        waitText("Blue Hour")
        snapshot("before-open-player")
        compose.onNodeWithContentDescription(label("打开播放器", "Open player")).assertIsDisplayed().performClick()
        snapshot("after-open-player")
        waitText(label("正在播放", "Now playing"))
        screenshot("03-player")
        compose.onNodeWithContentDescription(label("收起播放器", "Close player")).performClick()
        compose.onNodeWithTag("nav-1").performClick()
        compose.onNode(hasSetTextAction()).performTextInput("Midnight")
        compose.onNode(hasSetTextAction()).performImeAction()
        waitText("Midnight Sessions")
        screenshot("04-search")
        compose.onNodeWithTag("nav-3").performClick()
        waitText("Midnight Sessions")
        compose.onNodeWithText("Midnight Sessions").assertExists()
        screenshot("05-favorites")
        assertFalse(application.repository.session.value.isAdmin)
    }

    @Test fun passphraseLoginUsesNativeFieldsAndRestoresListenerAccess() {
        guest = false
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitText(label("连接曲库", "Connect to library"))
        compose.onAllNodes(hasSetTextAction())[1].performTextInput("fixture-passphrase")
        compose.onAllNodes(hasSetTextAction())[1].performImeAction()
        waitText("Midnight Sessions")
        compose.onNodeWithTag("nav-4").performClick()
        waitText(label("听众 · 只读", "Listener · Read only"))
        assertFalse(application.repository.session.value.guest)
        assertFalse(application.repository.session.value.isAdmin)
    }

    @Test fun libraryFiltersDensityAndCollapsingToolbarKeepContentAccessible() {
        expandedCatalog = true
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitText("Midnight Sessions")
        val grid = compose.onNodeWithTag("album-grid")
        val firstTop = compose.onNodeWithText("Midnight Sessions").fetchSemanticsNode().boundsInRoot.top
        val density = application.resources.displayMetrics.density
        assertTrue("The first album must be visible above 360 dp", firstTop / density < 360)
        screenshot("08-library-overview")
        val initialHeight = compose.onNodeWithTag("main-top-bar").fetchSemanticsNode().boundsInRoot.height
        grid.performTouchInput { swipeUp() }
        compose.waitUntil(5_000) {
            compose.onNodeWithTag("main-top-bar").fetchSemanticsNode().boundsInRoot.height <= 1f
        }
        compose.onNodeWithText("見本盤").assertIsNotDisplayed()
        compose.onNodeWithContentDescription(label("搜索曲库", "Search library")).assertIsNotDisplayed()
        compose.onNodeWithContentDescription(label("刷新曲库", "Refresh library")).assertIsNotDisplayed()
        screenshot("09-library-scrolled")
        grid.performScrollToIndex(0)
        grid.performTouchInput { swipeDown() }
        compose.waitUntil(5_000) {
            compose.onNodeWithTag("main-top-bar").fetchSemanticsNode().boundsInRoot.height >= initialHeight - density
        }
        compose.onNodeWithContentDescription(label("筛选与排序", "Filter and sort")).performClick()
        compose.onNodeWithText("Ambient", substring = false).performClick()
        screenshot("10-library-filters")
        compose.onNodeWithContentDescription(label("关闭筛选", "Close filters")).performClick()
        compose.onNodeWithText(label("清除筛选", "Clear filter")).assertIsDisplayed()
        compose.onNodeWithText("Midnight Sessions").assertDoesNotExist()
        compose.onNodeWithTag("nav-2").performClick()
        waitText("The Native Quartet")
        screenshot("12-artists")
        compose.onNodeWithTag("nav-0").performClick()
        compose.onNodeWithText(label("清除筛选", "Clear filter")).assertIsDisplayed().performClick()
        waitText("Midnight Sessions")
        val comfortableFirst = compose.onNodeWithText("Midnight Sessions").fetchSemanticsNode().boundsInRoot
        val comfortableThird = compose.onNodeWithText("Quiet Geometry").fetchSemanticsNode().boundsInRoot
        assertTrue("Comfortable layout places the third album on the next row", comfortableThird.top > comfortableFirst.bottom)
        compose.onNodeWithContentDescription(label("紧凑网格", "Compact grid")).performClick()
        compose.onNodeWithContentDescription(label("舒展网格", "Comfortable grid")).assertIsDisplayed()
        val first = compose.onNodeWithText("Midnight Sessions").fetchSemanticsNode().boundsInRoot
        val third = compose.onNodeWithText("Quiet Geometry").fetchSemanticsNode().boundsInRoot
        assertTrue("Compact layout fits three albums in the first row", kotlin.math.abs(first.top - third.top) < density)
        screenshot("11-library-compact")
        compose.onNodeWithContentDescription(label("舒展网格", "Comfortable grid")).performClick()
        val restoredThird = compose.onNodeWithText("Quiet Geometry").fetchSemanticsNode().boundsInRoot
        assertTrue("Switching back visibly restores two columns", restoredThird.top > comfortableFirst.bottom)
        screenshot("16-library-comfortable")
        compose.onNodeWithContentDescription(label("紧凑网格", "Compact grid")).performClick()
        scenario?.recreate()
        waitText("Midnight Sessions")
        compose.onNodeWithContentDescription(label("舒展网格", "Comfortable grid")).assertIsDisplayed()
        compose.onNodeWithTag("nav-3").performClick()
        compose.onNodeWithContentDescription(label("舒展网格", "Comfortable grid")).assertIsDisplayed()
        compose.onNodeWithTag("nav-1").performClick()
        waitText(label("最近加入", "Recently added"))
        screenshot("13-search-browse")
        compose.onNode(hasSetTextAction()).performTextInput("Midnight")
        compose.onNode(hasSetTextAction()).performImeAction()
        compose.onNode(hasText(label("歌曲", "Tracks")) and isSelectable()).performClick()
        waitText("Blue Hour")
        compose.onNodeWithText("Midnight Sessions").assertDoesNotExist()
        compose.onNodeWithTag("nav-0").performClick()
        compose.onNodeWithContentDescription(label("舒展网格", "Comfortable grid")).assertIsDisplayed()
    }

    @Test fun weightedDefaultAndGenreChipsOpenPrimaryAndSecondaryMatches() {
        discoveryCatalog = true
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitText("Midnight Sessions")
        val first = compose.onNodeWithTag("album-card:ui-album").fetchSemanticsNode().boundsInRoot
        val sparse = compose.onNodeWithTag("album-card:fixture-0").fetchSemanticsNode().boundsInRoot
        assertTrue("Established consensus leads the newer sparse perfect score", first.top <= sparse.top && first.left < sparse.left)
        compose.onNodeWithContentDescription(label("筛选与排序", "Filter and sort")).performClick()
        compose.onNodeWithText(label("评分（加权）", "Rating (weighted)")).assertIsSelected()
        compose.onNodeWithText(label("最近加入", "Recently added")).performClick()
        compose.onNodeWithText(label("重置", "Reset")).performClick()
        compose.onNodeWithText(label("评分（加权）", "Rating (weighted)")).assertIsSelected()
        compose.onNodeWithContentDescription(label("关闭筛选", "Close filters")).performClick()
        compose.onNode(hasText(label("歌曲", "Tracks")) and isSelectable()).performClick()
        compose.onNode(hasText(label("专辑", "Albums")) and isSelectable()).performClick()
        compose.onNodeWithContentDescription(label("筛选与排序", "Filter and sort")).performClick()
        compose.onNodeWithText(label("评分（加权）", "Rating (weighted)")).assertIsSelected()
        compose.onNodeWithContentDescription(label("关闭筛选", "Close filters")).performClick()
        compose.onNodeWithTag("album-card:ui-album").performClick()
        waitText("Soul / Funk")
        screenshot("31-album-genre-chips")
        compose.onNodeWithText("Jazz").performClick()
        waitText(label("2 张专辑 · 按加权评分", "2 albums · Weighted rating"))
        compose.onNodeWithTag("album-card:ui-album").assertIsDisplayed()
        compose.onNodeWithTag("album-card:fixture-0").assertIsDisplayed()
        compose.onNodeWithTag("album-card:fixture-1").assertDoesNotExist()
        screenshot("32-genre-albums")
        scenario?.recreate()
        waitText(label("2 张专辑 · 按加权评分", "2 albums · Weighted rating"))
        pressBack()
        waitText("Soul / Funk")
        compose.onNodeWithText("Soul / Funk").performClick()
        waitText(label("1 张专辑 · 按加权评分", "1 albums · Weighted rating"))
        compose.onNodeWithTag("album-card:ui-album").assertIsDisplayed()
        pressBack()
        waitText("Soul / Funk")
        pressBack()
        waitText("Midnight Sessions")
        compose.onNodeWithTag("album-card:fixture-1").assertExists()
    }

    @Test fun preloadSettingsPersistAcrossRecreation() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitText("Midnight Sessions")
        compose.onNodeWithTag("nav-4").performClick()
        compose.onNodeWithText(label("播放设置", "Playback settings")).performScrollTo().performClick()
        compose.onNodeWithText(label("始终开启", "Always on")).performClick()
        compose.onNodeWithText(label("始终开启", "Always on")).assertIsSelected()
        assertEquals(PreloadMode.ALWAYS, PlaybackSettings(application).preloadMode.value)
        scenario?.recreate()
        compose.onNodeWithText(label("始终开启", "Always on")).assertIsSelected()
        compose.onNodeWithText(label("关闭", "Off")).performClick()
        assertEquals(PreloadMode.OFF, application.playbackSettings.preloadMode.value)
        compose.onNodeWithText(label("仅 Wi-Fi", "Wi-Fi only")).performClick()
        assertEquals(PreloadMode.WIFI_ONLY, PlaybackSettings(application).preloadMode.value)
        screenshot("33-preload-settings")
    }

    @Test fun shuffleStartsAlbumAndQueueConfirmationPreservesPlayback() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitText("Midnight Sessions")
        compose.onNodeWithText("Midnight Sessions").performClick()
        waitText("A late-night session, carried in your pocket.")
        compose.onNodeWithContentDescription(label("随机播放", "Shuffle")).performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription(label("打开播放器", "Open player")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription(label("打开播放器", "Open player")).performClick()
        waitText(label("正在播放", "Now playing"))
        compose.onNodeWithTag("player-toggle").assertIsDisplayed()
        compose.onNodeWithText("WAV").assertDoesNotExist()
        compose.onNodeWithText("The Native Quartet").assertIsDisplayed()
        val downloads = org.mihonban.android.playback.DownloadStore.get(application, application.repository)
        compose.onNodeWithTag("player-download").assertIsEnabled().performClick()
        compose.waitUntil(20_000) { downloads.localFile("ui-track") != null }
        compose.onNodeWithTag("player-download").assertIsNotEnabled()
        assertTrue(downloads.localFile("ui-track")!!.length() > 0)
        val shared = AtomicReference<android.content.Intent?>(null)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val monitor = object : android.app.Instrumentation.ActivityMonitor() {
            override fun onStartActivity(intent: android.content.Intent): android.app.Instrumentation.ActivityResult? {
                if (intent.action != android.content.Intent.ACTION_CHOOSER) return null
                shared.set(intent)
                return android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED, null)
            }
        }
        instrumentation.addMonitor(monitor)
        try {
            compose.onNodeWithTag("player-share").performClick()
            compose.waitUntil(5_000) { shared.get() != null }
            @Suppress("DEPRECATION")
            val send = shared.get()!!.getParcelableExtra<android.content.Intent>(android.content.Intent.EXTRA_INTENT)!!
            assertEquals(android.content.Intent.ACTION_SEND, send.action)
            assertEquals("text/plain", send.type)
            assertEquals("Blue Hour — The Native Quartet\n${application.repository.serverUrl}/#/album/ui-album",
                send.getStringExtra(android.content.Intent.EXTRA_TEXT))
        } finally { instrumentation.removeMonitor(monitor) }
        screenshot("14-player-simple")
        compose.onNodeWithContentDescription(label("播放队列", "Queue")).performClick()
        compose.onNodeWithText(label("清空队列", "Clear queue")).performClick()
        waitText(label("清空播放队列？", "Clear the queue?"))
        screenshot("15-queue-confirmation")
        compose.onNodeWithText(label("取消", "Cancel")).performClick()
        compose.onNodeWithTag("queue-track-0").assertIsDisplayed()
        pressBack()
        waitText(label("正在播放", "Now playing"))
        compose.onNodeWithContentDescription(label("收起播放器", "Close player")).assertIsDisplayed()
        compose.onNodeWithContentDescription(label("播放队列", "Queue")).performClick()
        compose.onNodeWithText(label("清空队列", "Clear queue")).performClick()
        compose.onNodeWithText(label("清空", "Clear")).performClick()
        compose.onNodeWithContentDescription(label("打开播放器", "Open player")).assertDoesNotExist()
        org.mihonban.android.playback.DownloadStore.get(application, application.repository).remove("ui-track")
    }

    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    @Test fun songShuffleWaitsForPlayAllAndCacheSettingsPreserveTheLibrary() {
        trackTitle.set("Everything You Know (Remake)")
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitText("Midnight Sessions")
        lateinit var vm: org.mihonban.android.ui.AppViewModel
        scenario!!.onActivity { vm = androidx.lifecycle.ViewModelProvider(it)[org.mihonban.android.ui.AppViewModel::class.java] }
        compose.onNode(hasText(label("歌曲", "Tracks")) and isSelectable()).performClick()
        compose.onNodeWithTag("track-list-shuffle").assertIsOff().performClick().assertIsOn()
        compose.onNodeWithContentDescription(label("打开播放器", "Open player")).assertDoesNotExist()
        assertEquals(null, vm.player.state.value.current)
        compose.onNodeWithTag("track-list-shuffle").performClick().assertIsOff().performClick().assertIsOn()
        compose.onNodeWithText(label("播放全部", "Play all")).performClick()
        compose.waitUntil(15_000) { vm.player.state.value.isPlaying && vm.player.state.value.shuffle }
        compose.onNodeWithTag("track-list-shuffle").performClick().assertIsOff()
        assertTrue(vm.player.state.value.shuffle)
        compose.onNodeWithText(label("播放全部", "Play all")).performClick()
        compose.waitUntil(10_000) { vm.player.state.value.isPlaying && !vm.player.state.value.shuffle }
        compose.onNodeWithContentDescription(label("打开播放器", "Open player")).performClick()
        compose.onNodeWithTag("player-toggle").assertIsDisplayed()
        val bounds = compose.onNodeWithTag("player-toggle").fetchSemanticsNode().boundsInRoot
        val content = compose.onNodeWithTag("player-content").fetchSemanticsNode().boundsInRoot
        assertTrue("Long titles must not push the play button out of view", bounds.bottom <= content.bottom)
        scenario!!.onActivity { activity ->
            val insets = androidx.core.view.ViewCompat.getRootWindowInsets(activity.window.decorView)!!
                .getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            val screenBottom = activity.window.decorView.height - insets.bottom
            assertTrue("The whole button must sit above the system navigation area", bounds.bottom <= screenBottom)
        }
        screenshot("18-player-long-title")
        compose.onNodeWithTag("player-title").performClick()
        waitText("A late-night session, carried in your pocket.")
        compose.onNodeWithContentDescription(label("收起播放器", "Close player")).assertDoesNotExist()
        compose.runOnIdle { if (vm.player.state.value.isPlaying) vm.player.toggle() }
        compose.waitUntil(10_000) { !vm.player.state.value.isPlaying }
        compose.onNodeWithContentDescription(label("返回", "Back")).performClick()
        compose.onNodeWithTag("nav-4").performClick()
        compose.onNodeWithText(label("缓存设置", "Cache settings")).performScrollTo().performClick()
        compose.onNodeWithTag("cache-limit").performClick()
        compose.onNodeWithText("128 MB").performClick()
        compose.waitUntil(10_000) { application.playbackCache.limitMb.value == 128 }
        scenario!!.recreate()
        waitText("128 MB")
        screenshot("19-cache-settings")
        compose.onNodeWithTag("clear-cache").performScrollTo().performClick()
        compose.onNodeWithText(label("清除", "Clear")).performClick()
        waitText(label("缓存已清除", "Cache cleared"))
        assertEquals(0L, application.playbackCache.audio.cacheSpace)
        assertTrue(application.repository.session.value.ok)
        runBlocking {
            assertTrue(application.repository.cachedCatalog() != null)
            application.playbackCache.setLimit(512)
        }
    }

    @Test fun markdownDescriptionClosesFromAnyPositionAndRestoresAlbumScroll() {
        albumNote.set("""
            # 深夜录音笔记

            **温暖的钢琴**与 *克制的鼓点*，留下唱片最自然的呼吸。

            ## 录音与演奏

            > 保留房间的声音，也保留乐手之间的距离。

            - 钢琴与贝斯的对话
            - 细腻的鼓刷
              - 自然的混响

            1. 开场曲
            2. 夜色渐深

            [资料来源](https://example.com/notes)

            | 曲目 | 时长 |
            | --- | --- |
            | Blue Hour | 3:13 |

            ```text
            FLAC · 24 bit / 96 kHz
            ```

            ---

        """.trimIndent() + "\n\n" + (1..24).joinToString("\n\n") { "第 $it 段：旋律与留白交织，适合在安静的夜里反复聆听。" } + "\n\n阅读结束。")
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitText("Midnight Sessions")
        compose.onNodeWithText("Midnight Sessions").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("album-note-preview").fetchSemanticsNodes().isNotEmpty() }
        compose.waitUntil(10_000) { compose.onAllNodesWithText("深夜录音笔记", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("album-note-preview").performScrollTo()
        val previewTop = compose.onNodeWithTag("album-note-preview").fetchSemanticsNode().boundsInRoot.top
        screenshot("20-album-note-preview")
        compose.onNodeWithTag("album-note-preview").performClick()
        waitText("深夜录音笔记")
        compose.onNodeWithText("# 深夜录音笔记").assertDoesNotExist()
        val bold = compose.onNodeWithText("温暖的钢琴", substring = true).fetchSemanticsNode()
            .config[androidx.compose.ui.semantics.SemanticsProperties.Text].first()
        assertTrue("Strong emphasis must be rendered as bold", bold.spanStyles.any { it.item.fontWeight == androidx.compose.ui.text.font.FontWeight.Bold })
        val headerTop = compose.onNodeWithTag("note-reader-header").fetchSemanticsNode().boundsInRoot.top
        screenshot("21-note-markdown")
        compose.onNodeWithTag("note-reader-body").performScrollToNode(hasText("Blue Hour"))
        compose.onNodeWithText("Blue Hour").assertIsDisplayed()
        screenshot("22-note-table")
        compose.onNodeWithTag("note-reader-body").performScrollToNode(hasText("阅读结束。"))
        compose.onNodeWithContentDescription(label("关闭简介", "Close description")).assertIsDisplayed()
        assertEquals(headerTop, compose.onNodeWithTag("note-reader-header").fetchSemanticsNode().boundsInRoot.top, 1f)
        screenshot("23-note-bottom")
        compose.onNodeWithContentDescription(label("回到简介顶部", "Back to description top")).performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("深夜录音笔记").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("note-reader-body").performScrollToNode(hasText("阅读结束。"))
        compose.onNodeWithContentDescription(label("关闭简介", "Close description")).performClick()
        compose.onNodeWithTag("album-note-preview").assertIsDisplayed()
        assertEquals(previewTop, compose.onNodeWithTag("album-note-preview").fetchSemanticsNode().boundsInRoot.top, 1f)
        compose.onNodeWithTag("album-note-preview").performClick()
        waitText("阅读结束。")
        scenario!!.recreate()
        waitText("阅读结束。")
        compose.onNodeWithContentDescription(label("关闭简介", "Close description")).assertIsDisplayed()
        pressBack()
        compose.onNodeWithTag("album-note-preview").assertIsDisplayed()
    }

    @Test fun longSingleParagraphOffersBackToTopAndKeepsCloseVisible() {
        albumNote.set("# 长篇乐评\n\n" + "钢琴与鼓点在夜色中交织，旋律之间的留白同样值得倾听。".repeat(100))
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitText("Midnight Sessions")
        compose.onNodeWithText("Midnight Sessions").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("album-note-preview").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("album-note-preview").performScrollTo().performClick()
        waitText("长篇乐评")
        compose.onNodeWithContentDescription(label("回到简介顶部", "Back to description top")).assertDoesNotExist()
        repeat(3) { compose.onNodeWithTag("note-reader-body").performTouchInput { swipeUp() } }
        compose.onNodeWithText("长篇乐评").assertIsNotDisplayed()
        compose.onNodeWithContentDescription(label("关闭简介", "Close description")).assertIsDisplayed()
        screenshot("26-note-long-paragraph")
        compose.onNodeWithContentDescription(label("回到简介顶部", "Back to description top")).assertIsDisplayed().performClick()
        compose.onNodeWithText("长篇乐评").assertIsDisplayed()
        compose.onNodeWithContentDescription(label("回到简介顶部", "Back to description top")).assertDoesNotExist()
        screenshot("27-note-returned-top")
        compose.onNodeWithContentDescription(label("关闭简介", "Close description")).performClick()
        compose.onNodeWithTag("album-note-preview").assertIsDisplayed()

        // A quote is one lazy-list item even when it contains many paragraphs.
        albumNote.set((1..24).joinToString("\n>\n") { "> 引用第 $it 段：钢琴与鼓点之间的留白，让旋律更有呼吸。" })
        compose.onNodeWithTag("album-note-preview").performClick()
        waitText("引用第 1 段：钢琴与鼓点之间的留白，让旋律更有呼吸。")
        repeat(3) { compose.onNodeWithTag("note-reader-body").performTouchInput { swipeUp() } }
        compose.onNodeWithText("引用第 1 段：钢琴与鼓点之间的留白，让旋律更有呼吸。").assertIsNotDisplayed()
        compose.onNodeWithContentDescription(label("回到简介顶部", "Back to description top")).assertIsDisplayed().performClick()
        compose.onNodeWithText("引用第 1 段：钢琴与鼓点之间的留白，让旋律更有呼吸。").assertIsDisplayed()
        compose.onNodeWithContentDescription(label("回到简介顶部", "Back to description top")).assertDoesNotExist()
        pressBack()
        compose.onNodeWithTag("album-note-preview").assertIsDisplayed()
    }

    @Test fun repeatedActivityRecreationKeepsTheReaderUsable() {
        albumNote.set("# 持续阅读\n\n多次重建页面后，简介内容与操作仍然可用。")
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitText("Midnight Sessions")
        compose.onNodeWithText("Midnight Sessions").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("album-note-preview").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("album-note-preview").performScrollTo().performClick()
        waitText("持续阅读")
        repeat(12) {
            scenario!!.recreate()
            waitText("持续阅读")
            compose.onNodeWithContentDescription(label("关闭简介", "Close description")).assertIsDisplayed()
        }
        compose.onNodeWithContentDescription(label("关闭简介", "Close description")).performClick()
        compose.onNodeWithTag("album-note-preview").assertIsDisplayed()
    }

    @Test fun descriptionImageFailureCanBeRetriedWithoutLeavingTheReader() {
        val alt = "录音现场：钢琴与鼓组"
        albumNote.set("# 录音现场\n\n![$alt](/note-photo.png)\n\n图片后的录音说明。")
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitText("Midnight Sessions")
        compose.onNodeWithText("Midnight Sessions").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("album-note-preview").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("album-note-preview").performScrollTo().performClick()
        waitText(label("图片未能加载", "Image could not be loaded"))
        compose.onNodeWithText(alt).assertIsDisplayed()
        compose.onNodeWithContentDescription(label("关闭简介", "Close description")).assertIsDisplayed()
        screenshot("24-note-image-error")
        val attempts = noteImageRequests.get()
        assertTrue("The image request must reach the fixture server", attempts > 0)
        noteImageAvailable.set(true)
        compose.onNodeWithText(label("重新加载图片", "Retry image")).performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription(alt).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription(alt).assertIsDisplayed()
        compose.onNodeWithText(label("图片未能加载", "Image could not be loaded")).assertDoesNotExist()
        assertTrue("Retry must issue a new request", noteImageRequests.get() > attempts)
        compose.onNodeWithText("图片后的录音说明。").assertIsDisplayed()
        screenshot("25-note-image-loaded")
        pressBack()
        compose.onNodeWithTag("album-note-preview").assertIsDisplayed()
    }

    @Test fun descriptionImagesWithAdjacentCaptionsRemainVisibleInsideQuotes() {
        val firstAlt = "钢琴与鼓组同框"
        val quotedAlt = "引用中的录音照片"
        albumNote.set("# 图文笔记\n\n**开场说明**\n![$firstAlt](/note-photo.png)\n第一张照片说明。\n\n" +
            "> 外层引用。\n>\n> > **引用中的说明**\n> > ![$quotedAlt](/note-photo.png)\n> > 引用中的照片说明。\n\n图文阅读结束。")
        noteImageAvailable.set(true)
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitText("Midnight Sessions")
        compose.onNodeWithText("Midnight Sessions").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("album-note-preview").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("album-note-preview").performScrollTo().performClick()
        waitText("图文笔记")
        screenshot("28-note-adjacent-caption")
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription(firstAlt).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription(firstAlt).assertIsDisplayed()
        compose.onNodeWithText("第一张照片说明。").assertIsDisplayed()
        val bold = compose.onNodeWithText("开场说明").fetchSemanticsNode()
            .config[androidx.compose.ui.semantics.SemanticsProperties.Text].first()
        assertTrue("Text around the image must keep its Markdown styles",
            bold.spanStyles.any { it.item.fontWeight == androidx.compose.ui.text.font.FontWeight.Bold })
        val imageBounds = compose.onNodeWithContentDescription(firstAlt).fetchSemanticsNode().boundsInRoot
        assertTrue("The caption must follow the image",
            compose.onNodeWithText("第一张照片说明。").fetchSemanticsNode().boundsInRoot.top >= imageBounds.bottom)
        screenshot("29-note-caption-image-loaded")
        compose.onNodeWithTag("note-reader-body").performScrollToNode(hasText("引用中的照片说明。"))
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription(quotedAlt).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription(quotedAlt).assertIsDisplayed()
        compose.onNodeWithText("引用中的照片说明。").assertIsDisplayed()
        compose.onNodeWithContentDescription(label("关闭简介", "Close description")).assertIsDisplayed()
        screenshot("30-note-quoted-caption")
        compose.onNodeWithTag("note-reader-body").performScrollToNode(hasText("图文阅读结束。"))
        compose.onNodeWithText("图文阅读结束。").assertIsDisplayed()
        pressBack()
        compose.onNodeWithTag("album-note-preview").assertIsDisplayed()
    }

    @Test fun administratorEditsAlbumAndSavesGuestAccessThroughNativeForms() {
        guest = false
        administrator = true
        scenario = ActivityScenario.launch(MainActivity::class.java)
        waitText(label("连接曲库", "Connect to library"))
        compose.onAllNodes(hasSetTextAction())[1].performTextInput("fixture-passphrase")
        closeSoftKeyboard()
        compose.onNodeWithText(label("连接曲库", "Connect to library")).performScrollTo().assertIsDisplayed().performClick()
        waitText("Midnight Sessions")
        assertTrue(application.repository.session.value.isAdmin)
        compose.onNodeWithText("Midnight Sessions").performClick()
        waitText("A late-night session, carried in your pocket.")
        compose.onNodeWithContentDescription(label("专辑操作", "Album actions")).performClick()
        compose.onNodeWithText(label("编辑专辑", "Edit album")).performClick()
        compose.onNode(hasSetTextAction() and hasText("专辑名称")).performTextReplacement("After Hours")
        compose.onNodeWithText("保存").performClick()
        compose.waitUntil(20_000) { albumPatch.get() != null }
        waitText("After Hours")
        assertEquals("After Hours", Json.parseToJsonElement(albumPatch.get()!!).jsonObject.getValue("title").jsonPrimitive.content)
        screenshot("06-edited-album")
        compose.onNodeWithTag("nav-4").performClick()
        waitText(label("管理中心", "Administration"))
        compose.onNodeWithText(label("管理中心", "Administration")).performScrollTo().performClick()
        waitText("曲库概览")
        compose.waitUntil(20_000) { overviewReads.get() > 0 }
        val toggle = isToggleable() and hasText("允许免口令只读访问")
        // Overview and settings load independently; wait for the actual control to be ready.
        compose.waitUntil(20_000) { compose.onAllNodes(toggle and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(toggle).performScrollTo().assertIsOff().performClick().assertIsOn()
        compose.onNodeWithText("保存设置").performScrollTo().performClick()
        compose.waitUntil(20_000) { settingsWrite.get() != null }
        assertTrue(Json.parseToJsonElement(settingsWrite.get()!!).jsonObject.getValue("guestOpen").jsonPrimitive.boolean)
        waitText("已保存")
        compose.onNodeWithText("访问与服务").performScrollTo()
        screenshot("07-admin-settings")
    }

    private fun waitText(text: String) {
        try {
            compose.waitUntil(20_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
        } catch (failure: Throwable) {
            snapshot("timeout-${text.replace(Regex("[^A-Za-z0-9_-]"), "_")}")
            throw failure
        }
    }

    private fun snapshot(name: String) {
        runCatching {
            val directory = File(application.filesDir, "test-screenshots").apply { mkdirs() }
            val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            bitmap?.let { image ->
                File(directory, "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
                image.recycle()
            }
            val roots = compose.onAllNodes(isRoot(), useUnmergedTree = true)
            val tree = (0 until roots.fetchSemanticsNodes().size).joinToString("\n") { roots[it].printToString() }
            File(directory, "$name.txt").writeText(tree)
            tree.chunked(3500).forEach { Log.e("MihonbanUiEvidence", "$name\n$it") }
        }.onFailure { Log.e("MihonbanUiEvidence", "Could not capture $name", it) }
    }

    private fun label(chinese: String, english: String): String =
        if (application.resources.configuration.locales[0].language == "zh") chinese else english

    private fun screenshot(name: String) {
        compose.waitForIdle()
        // Allow the device compositor to present the frame after Compose becomes idle.
        android.os.SystemClock.sleep(150)
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: return
        val directory = File(application.filesDir, "test-screenshots").apply { mkdirs() }
        File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }

    private fun json(body: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(body)

    private fun expandedAlbums(): String = (listOf(album) + fixtureTitles.mapIndexed { index, title ->
        album.replace("ui-album", "fixture-$index").replace("Midnight Sessions", title)
            .replace("1964", "${1970 + index * 3}").replace("\"createdAt\":100", "\"createdAt\":${99 - index}")
            .replace("\"Jazz\"", if (index % 2 == 0) "\"Ambient\"" else "\"Jazz\"")
    }).joinToString(",", "[", "]")

    private val discoveryAlbum get() = album.replace("\"genres\":[\"Jazz\"]", "\"genres\":[\"Jazz\"],\"secondaryGenres\":[\"Soul / Funk\"]")

    private fun discoveryAlbums(): String = listOf(
        album.replace("ui-album", "fixture-0").replace("Midnight Sessions", "Evening Signals")
            .replace("\"rating\":4.2,\"votes\":500", "\"rating\":5.0,\"votes\":1")
            .replace("\"createdAt\":100", "\"createdAt\":999")
            .replace("\"genres\":[\"Jazz\"]", "\"genres\":[\"Ambient\"],\"secondaryGenres\":[\"Jazz\"]"),
        album.replace("ui-album", "fixture-1").replace("Midnight Sessions", "Quiet Geometry")
            .replace("\"rym\":{\"rating\":4.2,\"votes\":500}", "\"rym\":null").replace("\"Jazz\"", "\"Ambient\""),
        discoveryAlbum,
    ).joinToString(",", "[", "]")

    private fun artwork(index: Int = 0): ByteArray {
        val bitmap = Bitmap.createBitmap(500, 500, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val palettes = listOf(0xff182c36.toInt() to 0xffe29942.toInt(), 0xff5a322f.toInt() to 0xffe4ac91.toInt(),
            0xffb4bba9.toInt() to 0xff344c44.toInt(), 0xff303650.toInt() to 0xffaaa3c1.toInt(), 0xffbd9866.toInt() to 0xff333329.toInt())
        val (background, accent) = palettes[index % palettes.size]
        canvas.drawColor(background)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = accent
        when (index % 3) {
            0 -> canvas.drawCircle(330f, 190f, 125f, paint)
            1 -> repeat(5) { line -> canvas.drawRect(35f + line * 95, 40f + line * 20, 70f + line * 95, 285f, paint) }
            else -> { canvas.drawCircle(180f, 150f, 105f, paint); paint.color = background; canvas.drawCircle(225f, 130f, 80f, paint) }
        }
        paint.color = Color.rgb(9, 17, 22); canvas.drawRect(0f, 290f, 500f, 500f, paint)
        paint.color = Color.rgb(244, 236, 221); paint.textSize = 32f
        val title = if (index == 0) "MIDNIGHT SESSIONS" else fixtureTitles[index - 1].uppercase()
        canvas.drawText(title.substringBefore(' '), 32f, 380f, paint); canvas.drawText(title.substringAfter(' '), 32f, 424f, paint)
        return ByteArrayOutputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it); bitmap.recycle(); it.toByteArray() }
    }

    private fun tone(): ByteArray {
        val rate = 8_000
        val frames = rate * 30
        return ByteBuffer.allocate(44 + frames * 2).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + frames * 2); put("WAVEfmt ".toByteArray()); putInt(16)
            putShort(1); putShort(1); putInt(rate); putInt(rate * 2); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(frames * 2)
            repeat(frames) { putShort((sin(2 * PI * 440 * it / rate) * 800).toInt().toShort()) }
        }.array()
    }
}
