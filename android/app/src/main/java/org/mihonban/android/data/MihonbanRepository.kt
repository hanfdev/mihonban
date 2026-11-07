package org.mihonban.android.data

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import java.io.File
import java.io.IOException
import java.util.concurrent.atomic.AtomicLong

/** One application-scoped instance owns session identity, network clients, and catalog snapshots. */
class MihonbanRepository(context: Context) {
    private val context = context.applicationContext
    private val preferences = context.getSharedPreferences("mihonban_connection", Context.MODE_PRIVATE)
    private val cacheRoot = File(context.noBackupFilesDir, "catalog")
    private val identityLock = Any()
    private val authMutex = Mutex()
    private val generation = AtomicLong(0)
    private val catalogRequest = AtomicLong(0)
    private val mutableSession = MutableStateFlow(Session())
    private val mutableCatalog = MutableStateFlow(Catalog())
    private val mutableOffline = MutableStateFlow(false)
    val session: StateFlow<Session> = mutableSession.asStateFlow()
    val catalog: StateFlow<Catalog> = mutableCatalog.asStateFlow()
    val isOffline: StateFlow<Boolean> = mutableOffline.asStateFlow()
    val json = CatalogJson

    @Volatile private var transport: ApiTransport? = preferences.getString("server", null)?.let {
        runCatching { createTransport(ServerAddress.parse(it)) }.getOrNull()
    }

    init { mutableSession.value = transport?.cookies?.restoredSession() ?: Session() }

    val serverUrl: String get() = transport?.address?.value.orEmpty()
    val serverScope: String get() = transport?.address?.scope ?: "unconfigured"
    val httpClient: OkHttpClient get() = requireTransport().httpClient

    suspend fun configureServer(address: String) = withContext(Dispatchers.IO) {
        val parsed = ServerAddress.parse(address)
        authMutex.withLock {
            synchronized(identityLock) {
                if (transport?.address?.value != parsed.value) {
                    generation.incrementAndGet()
                    transport?.close()
                    val next = createTransport(parsed)
                    transport = next
                    preferences.edit().putString("server", parsed.value).commit()
                    mutableSession.value = next.cookies.restoredSession()
                    mutableCatalog.value = Catalog()
                    mutableOffline.value = false
                }
            }
        }
    }

    suspend fun login(password: String): Session = withContext(Dispatchers.IO) {
        require(password.isNotEmpty()) { "请输入口令。" }
        authMutex.withLock {
            val identity = synchronized(identityLock) {
                val previous = requireTransport()
                generation.incrementAndGet()
                previous.cookies.clear()
                previous.close()
                val next = createTransport(previous.address)
                transport = next
                mutableSession.value = Session()
                mutableCatalog.value = Catalog()
                mutableOffline.value = false
                Identity(next, generation.get(), "signed-out")
            }
            val result = json.decodeFromJsonElement<Session>(identity.transport.request("POST", "/api/login",
                buildJsonObject { put("password", password) }))
            synchronized(identityLock) {
                ensureCurrent(identity)
                check(result.ok) { "服务器没有确认登录。" }
                updateSession(identity.transport, result)
            }
            result
        }
    }

    suspend fun me(): Session = withContext(Dispatchers.IO) {
        val identity = identity()
        val result = json.decodeFromJsonElement<Session>(execute(identity, "GET", "/api/me", null))
        synchronized(identityLock) {
            ensureCurrent(identity)
            if (!result.ok) expire(identity.transport) else updateSession(identity.transport, result)
        }
        result
    }

    suspend fun logout() = withContext(Dispatchers.IO) {
        authMutex.withLock {
            val current = transport ?: return@withLock
            try {
                withTimeoutOrNull(5_000) {
                    try { current.request("POST", "/api/logout", null) }
                    catch (_: IOException) { }
                    catch (_: ApiException) { }
                }
            } finally {
                synchronized(identityLock) {
                    generation.incrementAndGet()
                    current.cookies.clear()
                    current.close()
                    transport = createTransport(current.address)
                    mutableSession.value = Session()
                    mutableCatalog.value = Catalog()
                    mutableOffline.value = false
                    File(cacheRoot, current.address.scope).deleteRecursively()
                }
            }
        }
    }

    suspend fun request(method: String, path: String, body: JsonObject? = null): JsonElement =
        withContext(Dispatchers.IO) { execute(identity(), method.uppercase(), path, body) }

    suspend fun refreshCatalog(includeHidden: Boolean = false): Catalog = withContext(Dispatchers.IO) {
        val identity = identity()
        val revision = catalogRequest.incrementAndGet()
        val hidden = includeHidden && session.value.isAdmin
        val query = if (hidden) "?hidden=1" else ""
        try {
            val result = coroutineScope {
                val albums = async { json.decodeFromJsonElement<List<Album>>(execute(identity, "GET", "/api/library$query", null)) }
                val tracks = async { json.decodeFromJsonElement<List<Track>>(execute(identity, "GET", "/api/tracks$query", null)) }
                val artists = async { json.decodeFromJsonElement<List<Artist>>(execute(identity, "GET", "/api/artists$query", null)) }
                val favorites = async { json.decodeFromJsonElement<Favorites>(execute(identity, "GET", "/api/favorites", null)) }
                Catalog(albums.await(), tracks.await(), artists.await(), favorites.await(), System.currentTimeMillis(), hidden)
            }
            synchronized(identityLock) {
                ensureCurrent(identity)
                ensureCatalogRequest(revision)
                runCatching { save(identity, "catalog.json", json.encodeToString(result)) }
                mutableCatalog.value = result
                mutableOffline.value = false
            }
            result
        } catch (error: IOException) {
            synchronized(identityLock) {
                ensureCurrent(identity)
                ensureCatalogRequest(revision)
                val saved = readCatalog(identity) ?: throw error
                val visible = if (hidden) saved else saved.visibleOnly()
                mutableCatalog.value = visible
                mutableOffline.value = true
                visible
            }
        }
    }

    suspend fun cachedCatalog(): Catalog? = withContext(Dispatchers.IO) {
        val identity = identityOrNull() ?: return@withContext null
        synchronized(identityLock) {
            ensureCurrent(identity)
            readCatalog(identity)?.also { mutableCatalog.value = it; mutableOffline.value = true }
        }
    }

    suspend fun album(id: String): AlbumDetail = withContext(Dispatchers.IO) {
        val identity = identity()
        val name = "album-${ServerAddress.sha256(id)}.json"
        try {
            val album = json.decodeFromJsonElement<Album>(execute(identity, "GET", "/api/album/${encodeSegment(id)}", null))
            val normalized = album.copy(tracks = album.normalizedTracks)
            synchronized(identityLock) {
                ensureCurrent(identity)
                runCatching { save(identity, name, json.encodeToString(normalized)) }
            }
            normalized
        } catch (error: IOException) {
            synchronized(identityLock) {
                ensureCurrent(identity)
                read(identity, name)?.let { runCatching { json.decodeFromString<Album>(it) }.getOrNull() } ?: throw error
            }
        }
    }

    suspend fun artists(includeHidden: Boolean = false): List<Artist> = json.decodeFromJsonElement(request("GET", "/api/artists" + hiddenQuery(includeHidden)))
    suspend fun tracks(includeHidden: Boolean = false): List<Track> = json.decodeFromJsonElement(request("GET", "/api/tracks" + hiddenQuery(includeHidden)))
    suspend fun favorites(): Favorites = json.decodeFromJsonElement(request("GET", "/api/favorites"))
    suspend fun artistTracks(name: String, includeHidden: Boolean = false): List<Track> = json.decodeFromJsonElement(
        request("GET", "/api/artists/${encodeSegment(name)}/tracks" + hiddenQuery(includeHidden)))
    suspend fun artistBio(name: String): String = (request("GET", "/api/artist-bio/${encodeSegment(name)}") as? JsonObject)
        ?.get("bio")?.let { (it as? JsonPrimitive)?.content }.orEmpty()

    suspend fun setFavorite(kind: String, id: String, enabled: Boolean) {
        require(kind in setOf("album", "track"))
        if (!session.value.isAdmin) throw ApiException(403, "精选由管理员维护；听众可以浏览和播放。")
        request(if (enabled) "PUT" else "DELETE", "/api/favorites/$kind/${encodeSegment(id)}")
    }

    fun artworkUrl(id: String, size: Int = 600): String = endpoint("/api/art/${encodeSegment(id)}?s=${size.coerceIn(64, 2000)}")
    fun artistArtworkUrl(name: String): String = endpoint("/api/artist-art/${encodeSegment(name)}")
    fun imageUrl(id: String): String = endpoint("/api/image/${encodeSegment(id)}")
    fun streamUrl(id: String, proxy: Boolean = false): String = endpoint("/api/stream/${encodeSegment(id)}${if (proxy) "?proxy=1" else ""}")

    private fun endpoint(path: String): String = requireTransport().address.endpoint(path).toString()
    private fun hiddenQuery(hidden: Boolean) = if (hidden && session.value.isAdmin) "?hidden=1" else ""
    private fun requireTransport(): ApiTransport = checkNotNull(transport) { "请先设置服务器地址。" }
    private fun createTransport(address: ServerAddress) = ApiTransport(address,
        ScopedCookieJar(address, KeystoreCredentialStorage(context, address.scope)))

    private data class Identity(val transport: ApiTransport, val generation: Long, val role: String)
    private fun identity(): Identity = synchronized(identityLock) {
        Identity(requireTransport(), generation.get(), session.value.cacheRole)
    }
    private fun identityOrNull(): Identity? = synchronized(identityLock) {
        if (transport == null || !session.value.ok) null else identity()
    }
    private fun ensureCurrent(identity: Identity) {
        if (identity.transport !== transport || identity.generation != generation.get())
            throw CancellationException("The server or signed-in identity changed.")
    }
    private fun ensureCatalogRequest(revision: Long) {
        if (revision != catalogRequest.get()) throw CancellationException("A newer catalog request superseded this response.")
    }

    private suspend fun execute(identity: Identity, method: String, path: String, body: JsonObject?): JsonElement {
        synchronized(identityLock) { ensureCurrent(identity) }
        try {
            val result = identity.transport.request(method, path, body)
            synchronized(identityLock) { ensureCurrent(identity) }
            return result
        } catch (error: ApiException) {
            synchronized(identityLock) {
                ensureCurrent(identity)
                if (error.status == 401) expire(identity.transport)
            }
            throw error
        }
    }

    private fun updateSession(client: ApiTransport, next: Session) {
        if (mutableSession.value.cacheRole != next.cacheRole) {
            generation.incrementAndGet()
            mutableCatalog.value = Catalog()
            mutableOffline.value = false
            if (!next.isAdmin) File(cacheRoot, client.address.scope + "/admin").deleteRecursively()
        }
        client.cookies.saveSession(next)
        mutableSession.value = next
    }

    private fun expire(client: ApiTransport) {
        generation.incrementAndGet()
        client.cookies.clear()
        mutableSession.value = Session()
        mutableCatalog.value = Catalog()
        mutableOffline.value = false
        File(cacheRoot, client.address.scope).deleteRecursively()
    }

    private fun cacheFile(identity: Identity, name: String) = File(cacheRoot, "${identity.transport.address.scope}/${identity.role}/$name")
    private fun read(identity: Identity, name: String): String? {
        if (identity.role == "signed-out") return null
        return runCatching { cacheFile(identity, name).readText() }.getOrNull()
    }
    private fun readCatalog(identity: Identity): Catalog? = read(identity, "catalog.json")?.let {
        runCatching { json.decodeFromString<Catalog>(it) }.getOrNull()
    }
    private fun save(identity: Identity, name: String, content: String) {
        if (identity.role == "signed-out") return
        val target = cacheFile(identity, name)
        target.parentFile?.mkdirs()
        val temporary = File(target.parentFile, "$name.tmp")
        temporary.writeText(content)
        if (!temporary.renameTo(target)) { target.writeText(content); temporary.delete() }
    }

    private fun Catalog.visibleOnly(): Catalog {
        val visibleAlbums = albums.filterNot { it.hidden }
        val visibleTracks = tracks.filterNot { it.hidden }
        val albumIds = visibleAlbums.map { it.id }.toSet()
        val trackIds = visibleTracks.map { it.id }.toSet()
        val names = (visibleAlbums.flatMap { it.credits } + visibleTracks.flatMap { it.credits }).map { it.name }.toSet()
        return copy(albums = visibleAlbums, tracks = visibleTracks, artists = artists.filter { it.name in names },
            favorites = Favorites(favorites.albums.filter { it.id in albumIds }, favorites.tracks.filter { it.id in trackIds }), includesHidden = false)
    }

    companion object { fun encodeSegment(value: String): String = ServerAddress.encodeSegment(value) }
}
