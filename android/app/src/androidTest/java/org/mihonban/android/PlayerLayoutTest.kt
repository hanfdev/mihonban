package org.mihonban.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.mihonban.android.data.Track
import org.mihonban.android.playback.PlaybackState
import org.mihonban.android.playback.DownloadItem
import org.mihonban.android.playback.DownloadStatus
import org.mihonban.android.ui.MihonbanTheme
import org.mihonban.android.ui.NowPlayingContent
import org.mihonban.android.ui.PlayerQuickActions
import java.io.File

@RunWith(AndroidJUnit4::class)
class PlayerLayoutTest {
    @get:Rule val compose = createComposeRule()

    @Test fun longTitleAndLargeTextKeepControlsVisibleAndBufferingCanBePaused() {
        var largeText by mutableStateOf(false)
        var playback by mutableStateOf(PlaybackState(current = Track(id = "long-title",
            title = "Everything You Know (Remake)", artist = "주혜린", albumId = "remake", albumTitle = "Re-Make", format = "FLAC"),
            isBuffering = true, playWhenReady = true, durationMs = 193_000, positionMs = 189_000))
        var albumClicks = 0
        var toggles = 0
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, if (largeText) 1.6f else 1f)) {
                MihonbanTheme { Surface {
                    NowPlayingContent(playback, "", Modifier.fillMaxWidth().height(480.dp),
                        onToggle = { toggles++; playback = playback.copy(playWhenReady = !playback.playWhenReady) },
                        onSeek = {}, onPrevious = {}, onNext = {}, onShuffle = {}, onRepeat = {},
                        onAlbum = { albumClicks++ }, onArtist = {},
                        quickActions = { PlayerQuickActions(null, {}, {}, {}) })
                } }
            }
        }
        fun assertControlsFit() {
            val parent = compose.onNodeWithTag("player-content").fetchSemanticsNode().boundsInRoot
            listOf("player-toggle", "player-seek", "player-controls", "player-quick-actions").forEach { tag ->
                compose.onNodeWithTag(tag).assertIsDisplayed()
                val bounds = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
                assertTrue("$tag must fit completely inside the player", bounds.top >= parent.top && bounds.bottom <= parent.bottom && bounds.left >= parent.left && bounds.right <= parent.right)
            }
            val toggle = compose.onNodeWithTag("player-toggle").fetchSemanticsNode().boundsInRoot
            assertTrue("The main button must retain its full height", toggle.height >= 70 * compose.density.density)
            assertTrue("Keep the main control away from the bottom edge", parent.bottom - toggle.bottom >= 72 * compose.density.density)
        }
        assertControlsFit()
        compose.onNodeWithText("Re-Make").assertDoesNotExist()
        compose.onNodeWithText("FLAC").assertDoesNotExist()
        compose.onNodeWithTag("player-title").performClick()
        assertEquals(1, albumClicks)
        compose.onNodeWithTag("player-toggle").assertHasClickAction().performClick()
        assertEquals(1, toggles)
        assertTrue(!playback.playWhenReady)
        val label = compose.onNodeWithTag("player-toggle").fetchSemanticsNode().config[SemanticsProperties.ContentDescription].single()
        assertTrue(label in listOf("播放", "Play"))
        compose.runOnIdle { largeText = true }
        assertControlsFit()
        val application = ApplicationProvider.getApplicationContext<MihonbanApplication>()
        val image = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        val directory = File(application.filesDir, "test-screenshots").apply { mkdirs() }
        image?.let { bitmap -> File(directory, "17-player-large-text.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle() }
    }

    @Test fun quickActionsReportDownloadProgressAndStayAboveTheBottomEdge() {
        val track = Track(id = "player-actions", title = "Dewy Roses", artist = "Pitcher56", albumId = "album")
        var download by mutableStateOf<DownloadItem?>(null)
        var clicks = 0
        var shares = 0
        var queues = 0
        compose.setContent {
            MihonbanTheme { Surface {
                NowPlayingContent(PlaybackState(current = track, durationMs = 288_000, positionMs = 207_000), "",
                    Modifier.fillMaxSize(), onToggle = {}, onSeek = {}, onPrevious = {}, onNext = {},
                    onShuffle = {}, onRepeat = {}, onAlbum = {}, onArtist = {},
                    quickActions = { PlayerQuickActions(download, { clicks++ }, { shares++ }, { queues++ }) })
            } }
        }
        val parent = compose.onNodeWithTag("player-content").fetchSemanticsNode().boundsInRoot
        val toggle = compose.onNodeWithTag("player-toggle").fetchSemanticsNode().boundsInRoot
        assertTrue("Main button must leave room for one-handed utilities and a bottom margin",
            parent.bottom - toggle.bottom >= 72 * compose.density.density)
        compose.onNodeWithTag("player-download").assertIsEnabled().performClick()
        compose.runOnIdle { download = DownloadItem(track, status = DownloadStatus.DOWNLOADING, bytes = 25, total = 100) }
        compose.onNodeWithTag("player-download").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "25%"))
            .performClick()
        compose.runOnIdle { download = download!!.copy(status = DownloadStatus.PAUSED) }
        compose.onNodeWithTag("player-download").assertIsEnabled().performClick()
        compose.runOnIdle { download = download!!.copy(status = DownloadStatus.COMPLETE) }
        compose.onNodeWithTag("player-download").assertIsNotEnabled()
        compose.onNodeWithTag("player-share").performClick()
        compose.onNodeWithTag("player-queue").performClick()
        assertEquals(3, clicks)
        assertEquals(1, shares)
        assertEquals(1, queues)
    }
}
