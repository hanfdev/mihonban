package org.mihonban.android.playback

import org.junit.Assert.*
import org.junit.Test

class PreloadModeTest {
    @Test fun wifiOnlyStopsForMobileOfflineAndAmbiguousVpnTransports() {
        assertTrue(PreloadMode.WIFI_ONLY.allows(PreloadNetwork(connected = true, wifi = true)))
        assertFalse(PreloadMode.WIFI_ONLY.allows(PreloadNetwork(connected = true, cellular = true)))
        assertFalse(PreloadMode.WIFI_ONLY.allows(PreloadNetwork(connected = true, wifi = true, cellular = true)))
        assertFalse(PreloadMode.WIFI_ONLY.allows(PreloadNetwork(connected = true)))
        assertFalse(PreloadMode.WIFI_ONLY.allows(PreloadNetwork()))
    }

    @Test fun alwaysRequiresAConnectionAndOffNeverPreloads() {
        for (network in listOf(PreloadNetwork(), PreloadNetwork(true, true), PreloadNetwork(true, cellular = true), PreloadNetwork(true))) {
            assertEquals(network.connected, PreloadMode.ALWAYS.allows(network))
            assertFalse(PreloadMode.OFF.allows(network))
        }
    }
}
