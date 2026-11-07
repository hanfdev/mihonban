package org.mihonban.android.playback

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.*
import org.junit.Test

class CancellableCallTest {
    @Test fun successfulConsumptionReturnsTheWholeBody() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("complete audio response"))
            val client = OkHttpClient()
            try {
                val value = client.newCall(Request.Builder().url(server.url("/audio")).build())
                    .consumeCancellable { it.body!!.string() }
                assertEquals("complete audio response", value)
            } finally {
                client.dispatcher.executorService.shutdown()
                client.connectionPool.evictAll()
            }
        }
    }

    @Test fun cancellationInterruptsBothHeaderWaitAndBodyRead() = runBlocking {
        for (waitingForBody in listOf(false, true)) {
            MockWebServer().use { server ->
                server.enqueue(if (waitingForBody) MockResponse().setBody("partial").setHeader("Content-Length", 1024)
                    else MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
                val client = OkHttpClient()
                val call = client.newCall(Request.Builder().url(server.url("/audio")).build())
                val readingBody = CompletableDeferred<Unit>()
                val job = launch {
                    call.consumeCancellable { response ->
                        readingBody.complete(Unit)
                        response.body!!.string()
                    }
                }
                try {
                    withTimeout(3_000) {
                        if (waitingForBody) readingBody.await()
                        else while (server.requestCount == 0) delay(10)
                    }
                    job.cancelAndJoin()
                    assertTrue("Cancellation must reach the network call", call.isCanceled())
                    withTimeout(3_000) { while (client.dispatcher.runningCallsCount() > 0) delay(10) }
                    assertTrue(job.isCancelled)
                } finally {
                    call.cancel()
                    job.cancelAndJoin()
                    client.dispatcher.executorService.shutdown()
                    client.connectionPool.evictAll()
                }
            }
        }
    }
}
