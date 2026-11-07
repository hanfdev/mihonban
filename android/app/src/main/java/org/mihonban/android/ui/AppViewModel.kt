package org.mihonban.android.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import org.mihonban.android.MihonbanApplication
import org.mihonban.android.data.*
import org.mihonban.android.playback.DownloadStore
import org.mihonban.android.playback.PlaybackConnection
import java.io.IOException

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val preferences = application.getSharedPreferences("mihonban_ui", android.content.Context.MODE_PRIVATE)
    private val _compactGrid = MutableStateFlow(preferences.getBoolean("compact_grid", false))
    val compactGrid = _compactGrid.asStateFlow()
    val repository = (application as MihonbanApplication).repository
    val player = PlaybackConnection(application, repository)
    val downloads = DownloadStore.get(application, repository)
    private val _catalog = MutableStateFlow(Catalog())
    val catalog = _catalog.asStateFlow()
    private val _ready = MutableStateFlow(false)
    val ready = _ready.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy = _busy.asStateFlow()
    private val _offline = MutableStateFlow(false)
    val offline = _offline.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message = _message.asStateFlow()
    var showHidden = MutableStateFlow(false)
        private set
    private var connectionGeneration = 0
    private var activeOperations = 0

    init {
        viewModelScope.launch {
            combine(repository.catalog, repository.session, showHidden) { catalog, session, hidden ->
                when {
                    !session.ok -> Catalog()
                    hidden && session.isAdmin -> catalog
                    else -> catalog.visibleOnly()
                }
            }.collect { _catalog.value = it }
        }
        viewModelScope.launch {
            repository.isOffline.collect { _offline.value = it && repository.session.value.ok }
        }
        viewModelScope.launch {
            var previous = repository.session.value
            repository.session.collect { session ->
                downloads.onSessionChanged()
                if (!session.ok || previous.cacheRole != session.cacheRole) player.stopAndClear()
                if (!session.ok) {
                    _ready.value = false
                    _catalog.value = Catalog()
                    _offline.value = false
                    showHidden.value = false
                } else if (!session.isAdmin) {
                    showHidden.value = false
                }
                previous = session
            }
        }
        viewModelScope.launch {
            val started = connectionGeneration
            if (repository.serverUrl.isNotBlank()) {
                val cached = repository.cachedCatalog() != null
                if (started != connectionGeneration) return@launch
                _ready.value = cached && repository.session.value.ok
                try {
                    val session = repository.me()
                    if (started != connectionGeneration) return@launch
                    if (session.ok) { _ready.value = true; refreshNow() }
                    else { _ready.value = false; _catalog.value = Catalog() }
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    if (started != connectionGeneration) return@launch
                    _ready.value = e is IOException && cached && repository.session.value.ok
                    _offline.value = _ready.value
                    _message.value = if (_ready.value) "当前离线，显示已保存的曲库 / Showing your saved library offline" else e.message
                }
            }
        }
    }

    fun connect(server: String, password: String) = work {
        val started = ++connectionGeneration
        player.stopAndClear()
        _ready.value = false
        _catalog.value = Catalog()
        _offline.value = false
        showHidden.value = false
        repository.configureServer(server)
        if (password.isBlank()) {
            check(repository.me().ok) { "请输入访问口令 / Enter your passphrase" }
        } else repository.login(password)
        if (started != connectionGeneration) return@work
        downloads.onSessionChanged()
        _ready.value = true
        refreshNow()
    }

    fun refresh() = work { refreshNow() }
    private suspend fun refreshNow() {
        if (!repository.session.value.ok) return
        repository.refreshCatalog(showHidden.value && repository.session.value.isAdmin)
        _offline.value = repository.isOffline.value
    }

    fun toggleHidden() { showHidden.value = !showHidden.value; refresh() }

    fun toggleGridDensity() {
        _compactGrid.value = !_compactGrid.value
        preferences.edit().putBoolean("compact_grid", _compactGrid.value).apply()
    }

    fun favorite(kind: String, id: String, enabled: Boolean) = work {
        repository.setFavorite(kind, id, enabled)
        refreshNow()
    }

    fun playAlbum(id: String, shuffle: Boolean = false) = work {
        val album = repository.album(id)
        player.play(album.tracks, 0, shuffle)
    }

    fun downloadAlbum(id: String) = work {
        repository.album(id).tracks.forEach { downloads.enqueue(it) }
        _message.value = "已加入下载队列 / Added to downloads"
    }

    fun signOut() = work {
        ++connectionGeneration
        _ready.value = false
        player.stopAndClear()
        try { repository.logout() } finally {
            downloads.onSessionChanged()
            _ready.value = false
            _catalog.value = Catalog()
            _offline.value = false
        }
    }

    fun notify(message: String) { _message.value = message }
    fun clearMessage() { _message.value = null }
    fun work(block: suspend () -> Unit) = viewModelScope.launch {
        activeOperations += 1
        _busy.value = true
        try { block() } catch (e: Exception) {
            if (e is CancellationException) throw e
            _message.value = e.message ?: "操作失败 / Operation failed"
        } finally {
            activeOperations -= 1
            _busy.value = activeOperations > 0
        }
    }

    private fun Catalog.visibleOnly(): Catalog {
        val visibleAlbums = albums.filterNot { it.hidden }
        val visibleTracks = tracks.filterNot { it.hidden }
        val albumIds = visibleAlbums.map { it.id }.toSet()
        val trackIds = visibleTracks.map { it.id }.toSet()
        val names = (visibleAlbums.flatMap { it.credits } + visibleTracks.flatMap { it.credits }).map { it.name }.toSet()
        return copy(albums = visibleAlbums, tracks = visibleTracks, artists = artists.filter { it.name in names },
            favorites = Favorites(favorites.albums.filter { it.id in albumIds }, favorites.tracks.filter { it.id in trackIds }),
            includesHidden = false)
    }

    override fun onCleared() { player.release(); super.onCleared() }
}
