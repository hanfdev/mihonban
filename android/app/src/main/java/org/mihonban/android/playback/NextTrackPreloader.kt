package org.mihonban.android.playback

import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheWriter
import androidx.media3.datasource.okhttp.OkHttpDataSource
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import okhttp3.Call
import okhttp3.OkHttpClient

internal data class PreloadTarget(val scope: String, val uri: Uri)

internal fun audioCacheKey(scope: String, uri: Uri): String = "$scope:$uri"

@androidx.annotation.OptIn(UnstableApi::class)
internal class NextTrackPreloader(private val cache: Cache, private val scope: CoroutineScope) : AutoCloseable {
    private var target: PreloadTarget? = null
    private var task: PreloadTask? = null
    private var job: Job? = null

    // Called on the player thread; each replacement cancels the old HTTP request immediately.
    fun update(next: PreloadTarget?, client: OkHttpClient) {
        if (next == target) return
        close()
        target = next
        if (next == null) return
        val pending = PreloadTask(cache, next, client)
        task = pending
        job = scope.launch(Dispatchers.IO) {
            delay(750)
            // A speculative request must never interrupt playback or retry in a tight loop.
            runCatching { runInterruptible { pending.cache() } }
        }
    }

    override fun close() {
        task?.cancel()
        job?.cancel()
        task = null
        job = null
        target = null
    }

    companion object { const val MAX_BYTES = 16L * 1024 * 1024 }
}

@androidx.annotation.OptIn(UnstableApi::class)
private class PreloadTask(cache: Cache, target: PreloadTarget, client: OkHttpClient) {
    private val cancelled = AtomicBoolean(false)
    private val call = AtomicReference<Call?>()
    private val calls = Call.Factory { request ->
        client.newCall(request).also {
            call.set(it)
            if (cancelled.get()) it.cancel()
        }
    }
    private val source = CacheDataSource.Factory().setCache(cache)
        .setCacheKeyFactory { audioCacheKey(target.scope, it.uri) }
        .setUpstreamDataSourceFactory(OkHttpDataSource.Factory(calls)
            .setUserAgent("Mihonban-Android/1.0")
            .setContentTypePredicate { !it.contains("text/html", true) && !it.contains("application/json", true) })
        .setFlags(CacheDataSource.FLAG_BLOCK_ON_CACHE)
        .createDataSource()
    private val writer = CacheWriter(source,
        DataSpec.Builder().setUri(target.uri).setLength(NextTrackPreloader.MAX_BYTES).build(), null, null)

    fun cache() { if (!cancelled.get()) writer.cache() }

    fun cancel() {
        cancelled.set(true)
        writer.cancel()
        call.get()?.cancel()
    }
}
