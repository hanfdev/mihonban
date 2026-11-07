package org.mihonban.android.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AlbumLayoutTest {
    @Test fun phonesAlwaysSwitchBetweenTwoAndThreeColumns() {
        listOf(320f, 360f, 375f, 393f, 412f, 480f, 599f).forEach { width ->
            assertEquals("Comfortable layout at $width dp", 2, albumColumnCount(width, false))
            assertEquals("Compact layout at $width dp", 3, albumColumnCount(width, true))
        }
    }

    @Test fun narrowWindowsAndTabletsHaveDistinctDensities() {
        listOf(240f, 280f, 600f, 768f, 840f, 1024f, 1280f).forEach { width ->
            val comfortable = albumColumnCount(width, false)
            val compact = albumColumnCount(width, true)
            assertTrue(comfortable >= 1)
            assertTrue("Layout toggle must change columns at $width dp", compact > comfortable)
        }
    }
}
