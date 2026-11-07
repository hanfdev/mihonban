package org.mihonban.android.data

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Cookie
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class ApiTransportTest {
    private class MemoryStorage(var value: StoredCredential = StoredCredential()) : CredentialStorage {
        override fun read() = value
        override fun write(value: StoredCredential) { this.value = value }
        override fun clear() { value = StoredCredential() }
    }

    @Test fun subpathUrlsAndUnicodeArtistNamesRemainOnTheConfiguredOrigin() {
        val address = ServerAddress.parse("https://music.example/listen/?ignored=1#albums")
        val name = "坂本 / R&B?"
        val url = address.endpoint("/api/artist-bio/${ServerAddress.encodeSegment(name)}")
        assertEquals("https://music.example/listen", address.value)
        assertEquals(name, url.pathSegments.last())
        assertTrue(url.encodedPath.startsWith("/listen/api/artist-bio/"))
        assertNotEquals(address.scope, ServerAddress.parse("https://music.example/elsewhere").scope)
        assertThrows(IllegalArgumentException::class.java) { address.endpoint("/api/../../escape") }
        assertThrows(IllegalArgumentException::class.java) { address.endpoint("//another.example/api/me") }
        assertThrows(IllegalArgumentException::class.java) { ServerAddress.parse("https://user:password@example.com") }
    }

    @Test fun cookiesNeverCrossServerPortsOrEscapeTheApiPrefix() {
        val address = ServerAddress.parse("https://music.example/listen")
        val storage = MemoryStorage()
        val jar = ScopedCookieJar(address, storage)
        val login = address.endpoint("/api/login")
        jar.saveFromResponse(login, listOf(Cookie.parse(login, "mihonban_session=secret; Path=/; Max-Age=3600; Secure; HttpOnly")!!))
        jar.saveSession(Session(true, "admin"))
        assertEquals(1, jar.loadForRequest(address.endpoint("/api/stream/1")).size)
        assertTrue(jar.loadForRequest(login.newBuilder().port(8443).build()).isEmpty())
        assertTrue(jar.loadForRequest(login.newBuilder().host("cdn.example").build()).isEmpty())
        assertTrue(jar.loadForRequest(login.newBuilder().encodedPath("/elsewhere").build()).isEmpty())
        assertTrue(ScopedCookieJar(address, storage).restoredSession().isAdmin)
        assertFalse(ScopedCookieJar(address, storage) { System.currentTimeMillis() + 7_200_000 }.restoredSession().ok)
    }

    @Test fun invalidatedCookieJarCannotPersistAStaleLogin() {
        val address = ServerAddress.parse("https://music.example")
        val storage = MemoryStorage()
        val jar = ScopedCookieJar(address, storage)
        jar.invalidate()
        jar.saveFromResponse(address.endpoint("/api/login"), listOf(Cookie.parse(address.url, "mihonban_session=late; Path=/; Max-Age=3600")!!))
        jar.saveSession(Session(true, "admin"))
        assertEquals("", storage.value.cookie)
        assertFalse(storage.value.session.ok)
    }

    @Test fun apiRedirectCannotReplayAPasswordToAnotherServer() = runBlocking {
        MockWebServer().use { origin ->
            MockWebServer().use { target ->
                origin.start(); target.start()
                origin.enqueue(MockResponse().setResponseCode(307).setHeader("Location", target.url("/capture")))
                val address = ServerAddress.parse(origin.url("/").toString())
                val transport = ApiTransport(address, ScopedCookieJar(address, MemoryStorage()))
                try {
                    transport.request("POST", "/api/login", buildJsonObject { put("password", "private") })
                    fail("A redirect must be rejected")
                } catch (error: ApiException) { assertEquals(307, error.status) }
                assertEquals(0, target.requestCount)
                assertEquals("POST", origin.takeRequest().method)
                transport.close()
            }
        }
    }

    @Test fun streamingRedirectStripsCookiesAndAuthorization() {
        MockWebServer().use { origin ->
            MockWebServer().use { target ->
                origin.start(); target.start()
                origin.enqueue(MockResponse().setResponseCode(302).setHeader("Location", target.url("/audio")))
                target.enqueue(MockResponse().setBody("audio-data"))
                val address = ServerAddress.parse(origin.url("/").toString())
                val jar = ScopedCookieJar(address, MemoryStorage())
                jar.saveFromResponse(address.endpoint("/api/login"), listOf(Cookie.parse(address.url,
                    "mihonban_session=private; Path=/; Max-Age=3600")!!))
                val transport = ApiTransport(address, jar)
                transport.httpClient.newCall(Request.Builder().url(address.endpoint("/api/stream/1"))
                    .header("Authorization", "Bearer private").build()).execute().use {
                    assertEquals("audio-data", it.body!!.string())
                }
                assertNotNull(origin.takeRequest().getHeader("Cookie"))
                val redirected = target.takeRequest()
                assertNull(redirected.getHeader("Cookie"))
                assertNull(redirected.getHeader("Authorization"))
                transport.close()
            }
        }
    }
}
