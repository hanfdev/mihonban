package org.mihonban.android

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertArrayEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.mihonban.android.data.Track
import org.mihonban.android.playback.DownloadStatus
import org.mihonban.android.playback.DownloadStore
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class NativeDownloadTest {
    @Test fun pausingDownloadCancelsAStalledRequestPromptly() = verifyCancellation(waitingForBody = false)

    @Test fun removingDownloadCancelsAStalledBodyPromptly() = verifyCancellation(waitingForBody = true)

    private fun verifyCancellation(waitingForBody: Boolean) = runBlocking {
        val application = ApplicationProvider.getApplicationContext<MihonbanApplication>()
        val repository = application.repository
        val server = MockWebServer()
        val id = "stalled-download-fixture"
        val available = AtomicBoolean(false)
        val audio = "complete audio fixture"
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.path?.substringBefore('?')) {
                "/api/me" -> MockResponse().setBody("""{"ok":true,"role":"user","guest":true}""")
                "/api/logout" -> MockResponse().setBody("""{"ok":true}""")
                "/api/stream/$id" -> MockResponse().setHeader("Content-Type", "audio/wav")
                    .apply {
                        when {
                            available.get() -> setBody(audio)
                            waitingForBody -> setBody("partial").setHeader("Content-Length", 4096)
                            else -> setSocketPolicy(SocketPolicy.NO_RESPONSE)
                        }
                    }
                else -> MockResponse().setResponseCode(404)
            }
        }
        server.start()
        repository.configureServer(server.url("/").toString())
        repository.me()
        val client = repository.httpClient
        val downloads = DownloadStore.get(application, repository)
        downloads.onSessionChanged()
        fun activeCalls() = client.dispatcher.runningCalls().filter { it.request().url.encodedPath == "/api/stream/$id" }
        try {
            downloads.enqueue(Track(id = id, title = "Stalled request", artist = "Download fixture"))
            withTimeout(10_000) {
                while (activeCalls().isEmpty() || (waitingForBody && downloads.items.value.none {
                    it.id == id && it.status == DownloadStatus.DOWNLOADING
                })) delay(50)
            }
            if (waitingForBody) downloads.remove(id) else downloads.cancel(id)
            withTimeout(3_000) { while (activeCalls().isNotEmpty()) delay(50) }
            assertNull(downloads.localFile(id))
            if (waitingForBody) assertNull(downloads.items.value.firstOrNull { it.id == id })
            else {
                assertEquals(DownloadStatus.PAUSED, downloads.items.value.single { it.id == id }.status)
                available.set(true)
                downloads.retry(id)
                withTimeout(10_000) { while (downloads.items.value.none { it.id == id && it.status == DownloadStatus.COMPLETE }) delay(50) }
                assertArrayEquals(audio.toByteArray(), downloads.localFile(id)!!.readBytes())
            }
        } finally {
            activeCalls().forEach { it.cancel() }
            downloads.remove(id)
            repository.logout()
            server.shutdown()
        }
    }
}
