package org.mihonban.android

import android.Manifest
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.mihonban.android.data.Track
import org.mihonban.android.playback.*
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class NativePreloadTest {
    @Test fun preloaderBoundsLargeResponsesAndReusesOnlyMatchingScope() = runBlocking {
        val application = ApplicationProvider.getApplicationContext<MihonbanApplication>()
        val cache = application.playbackCache.audio
        val server = MockWebServer()
        server.enqueue(MockResponse().setHeader("Content-Type", "audio/wav").setBody(Buffer().write(ByteArray(20 * 1024 * 1024))))
        server.enqueue(MockResponse().setHeader("Content-Type", "audio/wav").setBody(Buffer().write(ByteArray(20 * 1024 * 1024))))
        server.start()
        val scopeJob = SupervisorJob()
        val preloader = NextTrackPreloader(cache, CoroutineScope(scopeJob + Dispatchers.Main.immediate))
        val uri = android.net.Uri.parse(server.url("/large.wav").toString())
        val client = okhttp3.OkHttpClient()
        val target = PreloadTarget("fixture-preload-user", uri)
        val key = audioCacheKey(target.scope, uri)
        val other = target.copy(scope = "fixture-preload-guest")
        val otherKey = audioCacheKey(other.scope, uri)
        try {
            onMain { preloader.update(target, client) }
            await("bounded prefix") { cache.isCached(key, 0, NextTrackPreloader.MAX_BYTES) && client.dispatcher.runningCallsCount() == 0 }
            assertEquals(NextTrackPreloader.MAX_BYTES, cache.getCachedBytes(key, 0, Long.MAX_VALUE))
            assertEquals("bytes=0-${NextTrackPreloader.MAX_BYTES - 1}", server.takeRequest(3, TimeUnit.SECONDS)!!.getHeader("Range"))
            onMain { preloader.update(null, client); preloader.update(target, client) }
            delay(1500)
            assertEquals("Same identity and URL reuse cached bytes", 1, server.requestCount)
            onMain { preloader.update(other, client) }
            await("separate access-role cache") { cache.isCached(otherKey, 0, NextTrackPreloader.MAX_BYTES) && client.dispatcher.runningCallsCount() == 0 }
            assertEquals(2, server.requestCount)
        } finally {
            onMain { preloader.close() }
            scopeJob.cancelAndJoin()
            cache.removeResource(key)
            cache.removeResource(otherKey)
            server.shutdown()
        }
    }

    @Test fun servicePreloadsNextReusesCacheAndCancelsForSettingsAndMobileNetwork() = runBlocking {
        val application = ApplicationProvider.getApplicationContext<MihonbanApplication>()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        if (Build.VERSION.SDK_INT >= 33) instrumentation.uiAutomation
            .grantRuntimePermission(application.packageName, Manifest.permission.POST_NOTIFICATIONS)
        val repository = application.repository
        val settings = application.playbackSettings
        val previousMode = settings.preloadMode.value
        settings.setPreloadMode(PreloadMode.OFF)
        val server = MockWebServer()
        val firstAudio = wav(180)
        val nextAudio = wav(15)
        val nextRequests = AtomicInteger()
        val stalledRequests = AtomicInteger()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.requestUrl!!.encodedPath
                return when {
                    path == "/api/me" -> json("""{"ok":true,"role":"user","guest":true}""")
                    path == "/api/logout" -> json("""{"ok":true}""")
                    path == "/api/favorites" -> json("""{"albums":[],"tracks":[]}""")
                    path == "/api/stream/preload-stalled" -> {
                        stalledRequests.incrementAndGet()
                        MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
                    }
                    path.startsWith("/api/stream/") -> {
                        val bytes = if (path.endsWith("preload-first")) firstAudio else nextAudio.also { nextRequests.incrementAndGet() }
                        val range = Regex("bytes=(\\d+)-(\\d*)").find(request.getHeader("Range").orEmpty())
                        val start = range?.groupValues?.get(1)?.toInt() ?: 0
                        val end = range?.groupValues?.get(2)?.toIntOrNull()?.coerceAtMost(bytes.lastIndex) ?: bytes.lastIndex
                        if (start >= bytes.size) MockResponse().setResponseCode(416).setHeader("Content-Range", "bytes */${bytes.size}")
                        else MockResponse().setResponseCode(if (range == null) 200 else 206)
                            .setHeader("Content-Type", "audio/wav").setHeader("Accept-Ranges", "bytes")
                            .apply { if (range != null) setHeader("Content-Range", "bytes $start-$end/${bytes.size}") }
                            .setBody(Buffer().write(bytes, start, end - start + 1))
                    }
                    else -> json("[]")
                }
            }
        }
        server.start()
        repository.configureServer(server.url("/").toString())
        repository.me()
        val first = Track("preload-first", title = "Long current track", duration = 180.0, format = "wav")
        val next = Track("preload-next", title = "Prefetched next track", duration = 15.0, format = "wav")
        val stalled = Track("preload-stalled", title = "Stalled next track", duration = 15.0, format = "wav")
        var scenario: ActivityScenario<MainActivity>? = null
        var connection: PlaybackConnection? = null
        val monitor = PreloadNetworkMonitor(application)
        try {
            shell("svc wifi enable")
            await("Wi-Fi connection") { monitor.network.value.wifi && !monitor.network.value.cellular }
            scenario = ActivityScenario.launch(MainActivity::class.java)
            onMain { connection = PlaybackConnection(application, repository) }
            val player = requireNotNull(connection)
            onMain { player.play(listOf(first, next), shuffle = false) }
            await("current playback") { player.state.value.isPlaying && player.state.value.positionMs > 500 }
            delay(1500)
            assertEquals("Off must not speculatively request the next track", 0, nextRequests.get())
            settings.setPreloadMode(PreloadMode.ALWAYS)
            val key = audioCacheKey(repository.playbackScope(), android.net.Uri.parse(repository.streamUrl(next.id, true)))
            await("next track in shared cache") { application.playbackCache.audio.isCached(key, 0, nextAudio.size.toLong()) }
            assertEquals(first.id, player.state.value.current?.id)
            assertEquals(1, nextRequests.get())

            onMain { player.setShuffle(true); player.addNext(stalled) }
            await("actual next item under shuffle") { stalledRequests.get() >= 1 && activeStalledCalls(application) > 0 }
            settings.setPreloadMode(PreloadMode.OFF)
            await("immediate cancellation when disabled", 3000) { activeStalledCalls(application) == 0 }
            val disabledCount = stalledRequests.get()
            delay(1200)
            assertEquals(disabledCount, stalledRequests.get())

            settings.setPreloadMode(PreloadMode.WIFI_ONLY)
            await("Wi-Fi preloading resumes") { stalledRequests.get() > disabledCount && activeStalledCalls(application) > 0 }
            shell("svc wifi disable")
            await("cellular default network") { monitor.network.value.cellular && !monitor.network.value.wifi }
            await("Wi-Fi-only request cancelled on mobile", 3000) { activeStalledCalls(application) == 0 }
            val mobileCount = stalledRequests.get()
            delay(1200)
            assertEquals("No speculative requests on mobile", mobileCount, stalledRequests.get())
            assertEquals(PreloadMode.WIFI_ONLY, settings.preloadMode.value)
            shell("svc wifi enable")
            await("preloading automatically resumes on Wi-Fi") { stalledRequests.get() > mobileCount && activeStalledCalls(application) > 0 }

            settings.setPreloadMode(PreloadMode.OFF)
            await("final stalled request cancelled", 3000) { activeStalledCalls(application) == 0 }
            onMain { player.remove(1); player.setShuffle(false); player.next() }
            await("next song plays from prefetched data") { player.state.value.current?.id == next.id && player.state.value.isPlaying && player.state.value.positionMs > 300 }
            assertEquals("Playback reuses the exact cache key without downloading again", 1, nextRequests.get())
            assertTrue(player.state.value.error.orEmpty().isBlank())
        } finally {
            settings.setPreloadMode(PreloadMode.OFF)
            onMain { connection?.stopAndClear(); connection?.release() }
            scenario?.close()
            repository.logout()
            monitor.close()
            shell("svc wifi enable")
            settings.setPreloadMode(previousMode)
            server.shutdown()
        }
    }

    private fun activeStalledCalls(application: MihonbanApplication) = application.repository.httpClient.dispatcher.runningCalls()
        .count { it.request().url.encodedPath.endsWith("preload-stalled") && !it.isCanceled() }

    private fun shell(command: String) = ParcelFileDescriptor.AutoCloseInputStream(
        InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)).use { it.readBytes() }

    private fun onMain(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(block)

    private suspend fun await(description: String, timeout: Long = 20_000, condition: () -> Boolean) {
        try { withTimeout(timeout) { while (!condition()) delay(100) } }
        catch (error: kotlinx.coroutines.TimeoutCancellationException) { throw AssertionError(description, error) }
    }

    private fun json(body: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(body)

    private fun wav(seconds: Int): ByteArray {
        val bytes = 8_000 * seconds * 2
        return ByteBuffer.allocate(44 + bytes).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + bytes); put("WAVEfmt ".toByteArray()); putInt(16)
            putShort(1); putShort(1); putInt(8_000); putInt(16_000); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(bytes)
        }.array()
    }
}
