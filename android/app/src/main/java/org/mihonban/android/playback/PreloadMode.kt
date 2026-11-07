package org.mihonban.android.playback

enum class PreloadMode {
    OFF, ALWAYS, WIFI_ONLY;

    fun allows(network: PreloadNetwork): Boolean = network.connected && when (this) {
        OFF -> false
        ALWAYS -> true
        WIFI_ONLY -> network.wifi && !network.cellular
    }
}

data class PreloadNetwork(val connected: Boolean = false, val wifi: Boolean = false, val cellular: Boolean = false)
