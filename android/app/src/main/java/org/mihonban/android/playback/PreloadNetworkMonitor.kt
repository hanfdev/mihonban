package org.mihonban.android.playback

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

internal class PreloadNetworkMonitor(context: Context) : AutoCloseable {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    @Volatile private var current = connectivity.activeNetwork
    private val mutableNetwork = MutableStateFlow(describe(current?.let(connectivity::getNetworkCapabilities)))
    val network = mutableNetwork.asStateFlow()
    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            current = network
            mutableNetwork.value = PreloadNetwork()
        }

        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            if (current == network) mutableNetwork.value = describe(capabilities)
        }

        override fun onLost(network: Network) {
            if (current == network) { current = null; mutableNetwork.value = PreloadNetwork() }
        }
    }

    init { connectivity.registerDefaultNetworkCallback(callback) }

    override fun close() { connectivity.unregisterNetworkCallback(callback) }

    private fun describe(capabilities: NetworkCapabilities?) = PreloadNetwork(
        connected = capabilities != null,
        wifi = capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true,
        cellular = capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true,
    )
}
