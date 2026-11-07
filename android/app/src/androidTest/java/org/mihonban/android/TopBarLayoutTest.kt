@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.mihonban.android

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import kotlin.math.roundToInt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.mihonban.android.ui.ActionIcon
import org.mihonban.android.ui.MainTopBar
import org.mihonban.android.ui.MihonbanTheme

@RunWith(AndroidJUnit4::class)
class TopBarLayoutTest {
    @get:Rule val compose = createComposeRule()

    @Test fun nearCollapsedToolbarDoesNotLeaveIconOrTitleStrips() {
        lateinit var state: TopAppBarState
        var display by mutableStateOf(Density(2.625f, 1f))
        var inset by mutableIntStateOf(24)
        var searchClicks = 0
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides display) {
                MihonbanTheme {
                    state = rememberTopAppBarState()
                    val behavior = TopAppBarDefaults.enterAlwaysScrollBehavior(state)
                    Column(Modifier.fillMaxWidth().height(160.dp)
                        .background(MaterialTheme.colorScheme.background).testTag("toolbar-fixture")) {
                        Spacer(Modifier.height(inset.dp))
                        MainTopBar("見本盤", behavior, actions = {
                            ActionIcon(Icons.Outlined.Search, "Search library", { searchClicks++ })
                            ActionIcon(Icons.Outlined.Refresh, "Refresh library", {})
                        })
                        Box(Modifier.fillMaxWidth().height(1.dp).testTag("content-start"))
                    }
                }
            }
        }
        for ((index, density) in listOf(Density(2.625f), Density(2.75f), Density(3f, 1.6f), Density(3.5f, 1.3f)).withIndex()) {
            compose.runOnIdle { display = density; inset = if (index % 2 == 0) 24 else 32; state.heightOffset = 0f }
            compose.waitForIdle()
            compose.onNodeWithContentDescription("Search library").assertIsDisplayed().performClick()
            val fullHeight = compose.onNodeWithTag("main-top-bar").fetchSemanticsNode().boundsInRoot.height
            assertEquals("Collapse distance must match measured height", fullHeight, -state.heightOffsetLimit, 1f)
            for (remaining in listOf(8f, 2f, 0.2f, 0f)) {
                compose.runOnIdle { state.heightOffset = state.heightOffsetLimit + remaining * density.density }
                compose.waitForIdle()
                val bitmap = compose.onNodeWithTag("toolbar-fixture").captureToImage().asAndroidBitmap()
                if (index == 0 && remaining == 8f) save(bitmap, "34-toolbar-terminal-strip")
                val background = bitmap.getPixel(bitmap.width / 2, bitmap.height - 1)
                val start = (inset * density.density).roundToInt()
                val end = (start + 12 * density.density).roundToInt()
                var fragments = 0
                for (y in start until end) for (x in 0 until bitmap.width) {
                    if (bitmap.getPixel(x, y) != background) fragments++
                }
                if (fragments > 0) save(bitmap, "34-toolbar-terminal-strip-failure")
                assertEquals("No title or icon fragments with $remaining dp remaining at $density", 0, fragments)
            }
            val content = compose.onNodeWithTag("content-start").fetchSemanticsNode().boundsInRoot.top
            assertEquals("Collapsed bar leaves only the status inset", (inset * density.density).roundToInt().toFloat(), content, 1f)
            compose.onNodeWithContentDescription("Search library").assertIsNotDisplayed()
            compose.runOnIdle { state.heightOffset = 0f }
            compose.onNodeWithContentDescription("Search library").assertIsDisplayed()
        }
        assertEquals(4, searchClicks)
        compose.runOnIdle { state.heightOffset = state.heightOffsetLimit }
        compose.runOnIdle { display = Density(2.625f, 1f) }
        compose.waitForIdle()
        assertTrue("Changing display scale must keep a closed toolbar closed", state.collapsedFraction >= 0.999f)
    }

    private fun save(bitmap: Bitmap, name: String) {
        val context = ApplicationProvider.getApplicationContext<MihonbanApplication>()
        val directory = File(context.filesDir, "test-screenshots").apply { mkdirs() }
        File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
