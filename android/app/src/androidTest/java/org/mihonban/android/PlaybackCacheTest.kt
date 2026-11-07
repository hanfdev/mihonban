package org.mihonban.android

import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.SimpleCache
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mihonban.android.playback.ResizableCacheEvictor
import java.io.File

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@RunWith(AndroidJUnit4::class)
class PlaybackCacheTest {
    @Test fun reducingTheLimitEvictsOldAudioAndKeepsTheCacheWritable() {
        val context = ApplicationProvider.getApplicationContext<MihonbanApplication>()
        val directory = File(context.cacheDir, "cache-test-${System.nanoTime()}")
        val evictor = ResizableCacheEvictor(4096)
        val cache = SimpleCache(directory, evictor, StandaloneDatabaseProvider(context))
        fun write(key: String) {
            val hole = requireNotNull(cache.startReadWrite(key, 0, 1024))
            try {
                val file = cache.startFile(key, 0, 1024)
                file.writeBytes(ByteArray(1024) { 7 })
                cache.commitFile(file, 1024)
            } finally { cache.releaseHoleSpan(hole) }
        }
        try {
            write("first"); write("second"); write("third")
            assertEquals(3072, cache.cacheSpace)
            evictor.resize(cache, 1024)
            assertEquals(1024, cache.cacheSpace)
            assertFalse(cache.isCached("first", 0, 1024))
            assertTrue(cache.isCached("third", 0, 1024))
            write("fourth")
            assertTrue(cache.isCached("fourth", 0, 1024))
            assertEquals(1024, cache.cacheSpace)
        } finally { cache.release(); directory.deleteRecursively() }
    }
}
