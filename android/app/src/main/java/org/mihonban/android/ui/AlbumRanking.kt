package org.mihonban.android.ui

import org.mihonban.android.data.Album

internal val weightedAlbumOrder = compareByDescending<Album> { it.rym?.weighted ?: -1.0 }
    .thenByDescending { (it.rym?.votes ?: 0).coerceAtLeast(0) }
    .thenByDescending { it.rym?.rating?.takeIf { value -> value.isFinite() && value in 0.0..5.0 } ?: -1.0 }

internal fun Album.hasGenre(genre: String): Boolean =
    (genres + secondaryGenres).any { it.trim().equals(genre.trim(), ignoreCase = true) }
