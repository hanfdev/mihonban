package org.mihonban.android.data

import org.junit.Assert.*
import org.junit.Test

class CatalogContractTest {
    @Test fun sqliteFlagsAndNullableColumnsDecodeWithoutDroppingTheCatalog() {
        val tracks = CatalogJson.decodeFromString<List<Track>>("""[
            {"id":"t1","title":"One","duration":null,"hidden":1,"hasCustomArtists":true,"format":null},
            {"id":"t2","title":"Two","duration":201.5,"hidden":false,"hasCustomArtists":0}
        ]""")
        assertEquals(2, tracks.size)
        assertTrue(tracks[0].hidden)
        assertTrue(tracks[0].hasCustomArtists)
        assertEquals(0.0, tracks[0].duration, 0.0)
        assertFalse(tracks[1].hidden)
        assertEquals(201.5, tracks[1].duration, 0.0)
    }

    @Test fun albumTracksInheritAlbumIdentityButPreserveCollaboratingArtists() {
        val album = CatalogJson.decodeFromString<Album>("""{
            "id":"a1","title":"Record","artist":"Lead","year":1999,"storageId":null,
            "artists":[{"name":"Lead","sort":null}],"duration":null,
            "tracks":[{"id":"t1","title":"Track"},{"id":"t2","title":"Duet",
                "artist":"Guest","artists":[{"name":"Guest"}]}]
        }""")
        val normalized = album.normalizedTracks
        assertEquals("a1", normalized[0].albumId)
        assertEquals("Record", normalized[0].albumTitle)
        assertEquals("Lead", normalized[0].credits.single().name)
        assertEquals("Guest", normalized[1].credits.single().name)
        assertEquals(1999, normalized[1].year)
        assertEquals("", album.storageId)
    }

    @Test fun sparsePerfectRatingDoesNotOutrankEstablishedConsensus() {
        assertTrue(RymRating(4.2, 1000).weighted > RymRating(5.0, 1).weighted)
        assertEquals(3.0, RymRating(3.0, 100).weighted, 0.0)
    }

    @Test fun loggedOutAndGuestSessionsCannotBecomeAdministrators() {
        assertFalse(Session(false, "admin").isAdmin)
        assertFalse(Session(true, "admin", true).isAdmin)
        assertTrue(Session(true, "admin").isAdmin)
        assertFalse(CatalogJson.decodeFromString<Session>("""{"ok":false,"role":null}""").isAdmin)
    }
}
