package org.mihonban.android.playback

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.CacheEvictor
import androidx.media3.datasource.cache.CacheSpan
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

@androidx.annotation.OptIn(UnstableApi::class)
class PlaybackCache(context: Context) {
    private val preferences = context.getSharedPreferences("mihonban_cache", Context.MODE_PRIVATE)
    private val mutableLimit = MutableStateFlow(preferences.getInt("music_limit_mb", 512).takeIf { it in limitsMb } ?: 512)
    val limitMb = mutableLimit.asStateFlow()
    private val evictor = ResizableCacheEvictor(mutableLimit.value * 1024L * 1024L)
    val audio = SimpleCache(File(context.cacheDir, "playback-audio"), evictor, StandaloneDatabaseProvider(context))
    private val mutation = Mutex()

    suspend fun setLimit(megabytes: Int) = withContext(Dispatchers.IO) {
        require(megabytes in limitsMb)
        mutation.withLock {
            evictor.resize(audio, megabytes * 1024L * 1024L)
            preferences.edit().putInt("music_limit_mb", megabytes).apply()
            mutableLimit.value = megabytes
        }
    }

    suspend fun clear() = withContext(Dispatchers.IO) {
        mutation.withLock { audio.keys.toList().forEach(audio::removeResource) }
    }

    companion object {
        val limitsMb = listOf(128, 256, 512, 1024, 2048)
    }
}

@androidx.annotation.OptIn(UnstableApi::class)
internal class ResizableCacheEvictor(maxBytes: Long) : CacheEvictor {
    private var delegate = LeastRecentlyUsedCacheEvictor(maxBytes)

    fun resize(cache: Cache, maxBytes: Long) = synchronized(cache) {
        // Rebuild the eviction policy under the cache lock, preserving existing readers.
        val spans = cache.keys.flatMap { cache.getCachedSpans(it) }.sortedBy { it.lastTouchTimestamp }
        delegate = LeastRecentlyUsedCacheEvictor(maxBytes)
        spans.forEach { delegate.onSpanAdded(cache, it) }
    }

    override fun requiresCacheSpanTouches() = true
    override fun onCacheInitialized() = delegate.onCacheInitialized()
    override fun onStartFile(cache: Cache, key: String, position: Long, length: Long) = delegate.onStartFile(cache, key, position, length)
    override fun onSpanAdded(cache: Cache, span: CacheSpan) = delegate.onSpanAdded(cache, span)
    override fun onSpanRemoved(cache: Cache, span: CacheSpan) = delegate.onSpanRemoved(cache, span)
    override fun onSpanTouched(cache: Cache, oldSpan: CacheSpan, newSpan: CacheSpan) = delegate.onSpanTouched(cache, oldSpan, newSpan)
}
