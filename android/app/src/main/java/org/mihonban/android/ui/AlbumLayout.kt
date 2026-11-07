package org.mihonban.android.ui

internal fun albumColumnCount(widthDp: Float, compact: Boolean): Int {
    val comfortable = when {
        widthDp < 320f -> 1
        widthDp < 600f -> 2
        else -> ((widthDp - 20f) / 192f).toInt().coerceAtLeast(3)
    }
    // Explicit counts keep both modes distinct at phone-width breakpoints.
    return comfortable + if (compact) (if (widthDp < 600f) 1 else 2) else 0
}
