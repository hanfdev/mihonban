package org.mihonban.android.ui

import org.junit.Assert.*
import org.junit.Test
import org.mihonban.android.data.Album
import org.mihonban.android.data.RymRating

class AlbumRankingTest {
    @Test fun weightedOrderUsesConsensusThenVotesAndPutsUnratedLast() {
        val albums = listOf(
            Album("sparse", rym = RymRating(5.0, 1), createdAt = 900),
            Album("unrated", createdAt = 1000),
            Album("established", rym = RymRating(4.2, 500), createdAt = 1),
            Album("low-many", rym = RymRating(3.0, 300)),
            Album("low-few", rym = RymRating(3.0, 2)),
        )
        assertEquals(listOf("established", "sparse", "low-many", "low-few", "unrated"), albums.sortedWith(weightedAlbumOrder).map { it.id })
    }

    @Test fun genresMatchPrimaryAndSecondaryLabelsWithoutSubstringMatches() {
        val album = Album("record", genres = listOf("Jazz"), secondaryGenres = listOf("Soul / Funk"))
        assertTrue(album.hasGenre("jazz"))
        assertTrue(album.hasGenre(" Soul / Funk "))
        assertFalse(album.hasGenre("Funk"))
        assertFalse(album.hasGenre("Ambient"))
    }
}
