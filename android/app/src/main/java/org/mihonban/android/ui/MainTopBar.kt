@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.mihonban.android.ui

import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

@Composable
internal fun MainTopBar(
    title: String,
    scrollBehavior: TopAppBarScrollBehavior,
    navigationIcon: @Composable () -> Unit = {},
    actions: @Composable RowScope.() -> Unit,
) {
    val state = scrollBehavior.state
    Layout(
        modifier = Modifier.testTag("main-top-bar")
            .drawWithContent { clipRect { this@drawWithContent.drawContent() } }
            .draggable(
                orientation = Orientation.Vertical,
                enabled = !scrollBehavior.isPinned,
                state = rememberDraggableState { state.heightOffset += it },
                onDragStopped = { velocity ->
                    scrollBehavior.nestedScrollConnection.onPostFling(Velocity.Zero, Velocity(0f, velocity))
                },
            ),
        content = {
            TopAppBar(
                title = { Text(title, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = navigationIcon,
                actions = actions,
                expandedHeight = 56.dp,
                windowInsets = WindowInsets(0, 0, 0, 0),
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    scrolledContainerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
    ) { measurables, constraints ->
        // Keep the controls at full height and slide the whole row out of a clipped viewport.
        // A shrinking Material app bar re-centers its icons inside even a one-pixel remainder.
        val bar = measurables.single().measure(constraints.copy(minHeight = 0))
        val limit = -bar.height.toFloat()
        if (state.heightOffsetLimit != limit) {
            val fraction = state.collapsedFraction
            state.heightOffsetLimit = limit
            state.heightOffset = limit * fraction
        }
        val visibleHeight = (bar.height + state.heightOffset).roundToInt().coerceIn(0, bar.height)
        // Fade before the last strip to cover enlarged fonts and fractional display densities.
        val opacity = ((visibleHeight - 12.dp.toPx()) / 12.dp.toPx()).coerceIn(0f, 1f)
        layout(bar.width, visibleHeight) {
            if (visibleHeight > 0) {
                bar.placeRelativeWithLayer(0, visibleHeight - bar.height) { alpha = opacity }
            }
        }
    }
}
