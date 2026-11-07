package org.mihonban.android

import android.Manifest
import android.os.Build
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.lifecycle.Lifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mihonban.android.data.Track
import org.mihonban.android.playback.DownloadStatus
import org.mihonban.android.playback.DownloadStore
import org.mihonban.android.playback.PlaybackConnection
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.sin

@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class NativePlaybackTest {
    private val audioDurationSeconds = 30
    private var playbackSnapshot: () -> String = { "No playback connection" }

    @Test fun realServicePlaysSeeksChangesQueueAndPlaysDownloadedAudioOffline() = runBlocking {
        val application = ApplicationProvider.getApplicationContext<MihonbanApplication>()
        if (Build.VERSION.SDK_INT >= 33) InstrumentationRegistry.getInstrumentation().uiAutomation
            .grantRuntimePermission(application.packageName, Manifest.permission.POST_NOTIFICATIONS)
        val repository = application.repository
        val server = MockWebServer()
        val audio = tone()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty().substringBefore('?')
                return when {
                    path == "/api/me" -> json("""{"ok":true,"role":"user","guest":true}""")
                    path == "/api/logout" -> json("""{"ok":true}""")
                    path == "/api/library" || path == "/api/tracks" || path == "/api/artists" -> json("[]")
                    path == "/api/favorites" -> json("""{"albums":[],"tracks":[]}""")
                    path.startsWith("/api/stream/") -> {
                        val offset = Regex("bytes=([0-9]+)-").find(request.getHeader("Range").orEmpty())
                            ?.groupValues?.get(1)?.toIntOrNull() ?: 0
                        if (offset >= audio.size) MockResponse().setResponseCode(416)
                            .setHeader("Content-Range", "bytes */${audio.size}")
                        else MockResponse().setResponseCode(if (offset > 0) 206 else 200)
                            .setHeader("Content-Type", "audio/wav")
                            .setHeader("Accept-Ranges", "bytes").setHeader("ETag", "\"native-audio-v1\"")
                            .apply { if (offset > 0) setHeader("Content-Range", "bytes $offset-${audio.lastIndex}/${audio.size}") }
                            .setBody(Buffer().write(audio, offset, audio.size - offset))
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        repository.configureServer(server.url("/").toString())
        repository.me()
        val downloads = DownloadStore.get(application, repository)
        downloads.onSessionChanged()
        val first = Track(id = "instrumentation-first", title = "First tone", artist = "Native fixture", duration = audioDurationSeconds.toDouble(), format = "wav")
        val second = Track(id = "instrumentation-second", title = "Second tone", artist = "Native fixture", duration = audioDurationSeconds.toDouble(), format = "wav")
        var connection: PlaybackConnection? = null
        var scenario: ActivityScenario<MainActivity>? = null
        var stopped = false
        try {
            scenario = ActivityScenario.launch(MainActivity::class.java)
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            onMain { connection = PlaybackConnection(application, repository) }
            val player = requireNotNull(connection)
            playbackSnapshot = { player.state.value.toString() }
            onMain { player.play(listOf(first, second)) }
            await("initial PCM playback") { player.state.value.current?.id == first.id && player.state.value.isPlaying && player.state.value.positionMs > 200 }
            onMain { player.seekTo(4_000) }
            await("seek") { player.state.value.positionMs >= 3_800 }
            onMain { player.next() }
            await("next track") { player.state.value.current?.id == second.id && player.state.value.isPlaying }
            onMain { player.setShuffle(true); player.addNext(first) }
            await("queue insertion") { player.state.value.queue.size == 3 && player.state.value.shuffle }
            onMain { player.next() }
            await("play-next under shuffle") { player.state.value.current?.id == first.id && player.state.value.currentIndex == 2 }

            onMain { player.play(listOf(first, second), shuffle = true) }
            await("shuffle album replaces queue and starts playback") { player.state.value.queue.size == 2 && player.state.value.shuffle && player.state.value.isPlaying }
            onMain { player.play(listOf(first, second), shuffle = false) }
            await("ordered playback resets shuffle") { player.state.value.current?.id == first.id && !player.state.value.shuffle && player.state.value.isPlaying }

            downloads.enqueue(second)
            await("background download", 45_000) { downloads.items.value.any { it.id == second.id && it.status == DownloadStatus.COMPLETE } }
            assertEquals(audio.size.toLong(), requireNotNull(downloads.localFile(second.id)).length())
            assertTrue("Streaming should populate the music cache", application.playbackCache.audio.cacheSpace > 0)
            // Keep the media session while taking the server offline. Clearing it here can
            // overlap Android's asynchronous notification-dismissal stop with the next play.
            onMain { if (player.state.value.isPlaying) player.toggle() }
            await("pause before disconnecting the server") { !player.state.value.isPlaying }
            application.playbackCache.clear()
            assertTrue("Clearing temporary cache must preserve explicit downloads", requireNotNull(downloads.localFile(second.id)).isFile)
            server.shutdown()
            stopped = true
            onMain { player.play(listOf(second)) }
            await("offline PCM playback") { player.state.value.current?.id == second.id && player.state.value.isPlaying && player.state.value.positionMs > 300 }
            val backgroundPosition = player.state.value.positionMs
            scenario.moveToState(Lifecycle.State.CREATED)
            await("background playback") { player.state.value.isPlaying && player.state.value.positionMs > backgroundPosition + 300 }
            scenario.moveToState(Lifecycle.State.RESUMED)
            onMain { player.setSleepTimer(15) }
            await("service sleep timer") { player.state.value.sleepRemainingMs > 14 * 60_000 }
            assertTrue(player.state.value.error.orEmpty().isBlank())
        } finally {
            onMain { connection?.stopAndClear(); connection?.release() }
            downloads.remove(first.id)
            downloads.remove(second.id)
            scenario?.close()
            runCatching { repository.logout() }
            if (!stopped) server.shutdown()
        }
    }

    private fun json(value: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(value)

    private fun onMain(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(block)

    private suspend fun await(description: String, timeoutMs: Long = 20_000, ready: () -> Boolean) {
        try { withTimeout(timeoutMs) { while (!ready()) delay(100) } }
        catch (error: kotlinx.coroutines.TimeoutCancellationException) {
            throw AssertionError("Timed out waiting for $description: ${playbackSnapshot()}", error)
        }
    }

    private fun tone(): ByteArray {
        val sampleRate = 44_100
        val frames = sampleRate * audioDurationSeconds
        val bytes = frames * 2
        return ByteBuffer.allocate(44 + bytes).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + bytes); put("WAVE".toByteArray())
            put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
            putInt(sampleRate); putInt(sampleRate * 2); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(bytes)
            repeat(frames) { putShort((sin(2 * PI * 440 * it / sampleRate) * 2_000).toInt().toShort()) }
        }.array()
    }
}
