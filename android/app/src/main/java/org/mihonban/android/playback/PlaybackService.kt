package org.mihonban.android.playback

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.AtomicFile
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.ShuffleOrder
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.Request
import org.mihonban.android.data.MihonbanRepository
import org.mihonban.android.data.Track
import org.mihonban.android.MihonbanApplication

@Serializable
internal data class SavedQueue(
    val scope: String,
    val tracks: List<Track>,
    val index: Int,
    val position: Long,
    val shuffle: Boolean,
    val repeatMode: Int,
)

@androidx.annotation.OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private lateinit var player: ExoPlayer
    private lateinit var repository: MihonbanRepository
    private var mediaSession: MediaSession? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var identity = ""
    private var artworkJob: kotlinx.coroutines.Job? = null
    private var lastArtworkId: String? = null
    private val json = Json { ignoreUnknownKeys = true }
    private lateinit var preloader: NextTrackPreloader
    private lateinit var preloadNetwork: PreloadNetworkMonitor

    override fun onCreate() {
        super.onCreate()
        repository = PlaybackEnvironment.repository(this)
        identity = repository.playbackScope()
        preloader = NextTrackPreloader((application as MihonbanApplication).playbackCache.audio, scope)
        preloadNetwork = PreloadNetworkMonitor(this)
        val network = DataSource.Factory {
            OkHttpDataSource.Factory(repository.httpClient).setUserAgent("Mihonban-Android/1.0").createDataSource()
        }
        val cachedNetwork = DataSource.Factory {
            val identity = repository.playbackScope()
            CacheDataSource.Factory()
                .setCache((application as MihonbanApplication).playbackCache.audio)
                .setUpstreamDataSourceFactory(network)
                .setCacheKeyFactory { spec -> audioCacheKey(identity, spec.uri) }
                .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
                .createDataSource()
        }
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(this, cachedNetwork)))
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        val sessionBuilder = MediaSession.Builder(this, player).setCallback(object : MediaSession.Callback {
            override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
                if (!controller.isTrusted && controller.packageName != packageName) return MediaSession.ConnectionResult.reject()
                val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                    .add(SessionCommand(SLEEP_COMMAND, Bundle.EMPTY))
                    .add(SessionCommand(PLAY_NEXT_COMMAND, Bundle.EMPTY)).build()
                return MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(commands).build()
            }

            override fun onAddMediaItems(session: MediaSession, controller: MediaSession.ControllerInfo,
                mediaItems: List<MediaItem>): ListenableFuture<List<MediaItem>> {
                adoptCurrentIdentity()
                return Futures.immediateFuture(mediaItems)
            }

            override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo,
                customCommand: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
                if (customCommand.customAction == SLEEP_COMMAND) {
                    val minutes = args.getInt("minutes").coerceIn(0, 240)
                    sleepDeadline = if (minutes > 0) System.currentTimeMillis() + minutes * 60_000L else 0L
                    return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }
                if (customCommand.customAction == PLAY_NEXT_COMMAND) {
                    val track = args.getString(TRACK_EXTRA)?.let { runCatching { json.decodeFromString<Track>(it) }.getOrNull() }
                    if (track != null && (!track.hidden || repository.session.value.isAdmin) && repository.session.value.ok) {
                        adoptCurrentIdentity()
                        val index = if (player.mediaItemCount == 0) 0 else player.currentMediaItemIndex + 1
                        player.addMediaItem(index, mediaItem(track, repository, DownloadStore.get(this@PlaybackService, repository)))
                        // Controller shuffle toggles and custom commands can reach the session
                        // through different queues. Pin the next item even before shuffle is enabled.
                        if (player.mediaItemCount > 1) {
                            val timeline = player.currentTimeline
                            val order = mutableListOf<Int>()
                            var cursor = timeline.getFirstWindowIndex(true)
                            while (cursor != C.INDEX_UNSET && order.size < player.mediaItemCount) {
                                order.add(cursor)
                                cursor = timeline.getNextWindowIndex(cursor, Player.REPEAT_MODE_OFF, true)
                            }
                            order.remove(index)
                            val nextPosition = (order.indexOf(player.currentMediaItemIndex) + 1).coerceIn(0, order.size)
                            order.add(nextPosition, index)
                            player.setShuffleOrder(ShuffleOrder.DefaultShuffleOrder(order.toIntArray(), System.nanoTime()))
                        }
                        if (player.playbackState == Player.STATE_IDLE) player.prepare()
                    }
                    return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }
                return super.onCustomCommand(session, controller, customCommand, args)
            }
        })
        packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            sessionBuilder.setSessionActivity(PendingIntent.getActivity(this, 0, launch,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        }
        mediaSession = sessionBuilder.build()
        restoreQueue()
        player.addListener(object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) {
                if (events.containsAny(Player.EVENT_TIMELINE_CHANGED, Player.EVENT_MEDIA_ITEM_TRANSITION,
                        Player.EVENT_PLAY_WHEN_READY_CHANGED, Player.EVENT_REPEAT_MODE_CHANGED,
                        Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED, Player.EVENT_POSITION_DISCONTINUITY)) saveQueue()
                if (events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION)) loadArtwork()
                updatePreload()
            }
        })
        scope.launch {
            combine((application as MihonbanApplication).playbackSettings.preloadMode,
                preloadNetwork.network, repository.session, DownloadStore.get(this@PlaybackService, repository).items) { _, _, _, _ -> Unit }
                .collect { updatePreload() }
        }
        loadArtwork()
        scope.launch {
            var ticks = 0
            while (true) {
                delay(500)
                if (identity != repository.playbackScope() || !repository.session.value.ok) {
                    player.stop()
                    player.clearMediaItems()
                    sleepDeadline = 0
                    identity = repository.playbackScope()
                    lastArtworkId = null
                    artworkJob?.cancel()
                }
                if (sleepDeadline > 0 && System.currentTimeMillis() >= sleepDeadline) {
                    player.pause()
                    sleepDeadline = 0
                }
                updatePreload()
                if (++ticks % 30 == 0 && player.isPlaying) saveQueue()
            }
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    private fun updatePreload() {
        val mode = (application as MihonbanApplication).playbackSettings.preloadMode.value
        val nextIndex = player.nextMediaItemIndex
        val currentBuffered = player.totalBufferedDuration >= 10_000 ||
            (player.duration != C.TIME_UNSET && player.bufferedPosition >= player.duration)
        val allowed = repository.session.value.ok && identity == repository.playbackScope() &&
            mode.allows(preloadNetwork.network.value) && player.playWhenReady && player.playbackState == Player.STATE_READY &&
            currentBuffered &&
            player.repeatMode != Player.REPEAT_MODE_ONE && nextIndex != C.INDEX_UNSET && nextIndex != player.currentMediaItemIndex
        val next = if (allowed) player.getMediaItemAt(nextIndex) else null
        val uri = next?.localConfiguration?.uri
        val target = if (next != null && uri?.scheme in listOf("http", "https") &&
            DownloadStore.get(this, repository).localFile(next.mediaId) == null) PreloadTarget(identity, uri!!) else null
        preloader.update(target, repository.httpClient)
    }

    private fun adoptCurrentIdentity() {
        if (identity == repository.playbackScope()) return
        player.stop()
        player.clearMediaItems()
        identity = repository.playbackScope()
        sleepDeadline = 0
        lastArtworkId = null
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!player.playWhenReady || player.mediaItemCount == 0 || player.playbackState == Player.STATE_ENDED) stopSelf()
    }

    override fun onDestroy() {
        preloader.close()
        preloadNetwork.close()
        saveQueue()
        mediaSession?.release()
        player.release()
        scope.cancel()
        sleepDeadline = 0L
        super.onDestroy()
    }

    private fun queueFile(): AtomicFile = AtomicFile(File(filesDir, "playback-${stableFileName(identity)}.json"))

    private fun restoreQueue() {
        if (!repository.session.value.ok || repository.serverUrl.isBlank()) return
        val saved = runCatching { queueFile().openRead().use { json.decodeFromString<SavedQueue>(it.readBytes().toString(Charsets.UTF_8)) } }.getOrNull() ?: return
        if (saved.scope != identity || saved.tracks.isEmpty()) return
        val tracks = if (repository.session.value.isAdmin) saved.tracks else saved.tracks.filterNot { it.hidden }
        if (tracks.isEmpty()) return
        val downloads = DownloadStore.get(this, repository)
        player.setMediaItems(tracks.map { mediaItem(it, repository, downloads) }, saved.index.coerceIn(tracks.indices), saved.position.coerceAtLeast(0))
        player.shuffleModeEnabled = saved.shuffle
        player.repeatMode = saved.repeatMode.takeIf { it in 0..2 } ?: Player.REPEAT_MODE_OFF
        // Restoring browsing state must never start playback unexpectedly.
    }

    private fun saveQueue() {
        if (identity != repository.playbackScope()) return
        val tracks = (0 until player.mediaItemCount).mapNotNull { trackFrom(player.getMediaItemAt(it)) }
        val snapshot = SavedQueue(identity, tracks, player.currentMediaItemIndex.coerceAtLeast(0),
            player.currentPosition.coerceAtLeast(0), player.shuffleModeEnabled, player.repeatMode)
        val file = queueFile()
        var output: java.io.FileOutputStream? = null
        try {
            output = file.startWrite()
            output.write(json.encodeToString(snapshot).toByteArray())
            file.finishWrite(output)
        } catch (_: Exception) { output?.let(file::failWrite) }
    }

    private fun loadArtwork() {
        val current = player.currentMediaItem ?: return
        if (current.mediaId == lastArtworkId) return
        lastArtworkId = current.mediaId
        artworkJob?.cancel()
        val track = trackFrom(current) ?: return
        if (track.albumId.isBlank()) return
        val expectedScope = identity
        val artworkUrl = repository.artworkUrl(track.albumId, 300)
        val artworkClient = repository.httpClient
        val localArtwork = DownloadStore.get(this, repository).artworkFile(track.albumId)
        artworkJob = scope.launch {
            val bytes = withContext(Dispatchers.IO) {
                runCatching {
                    if (localArtwork != null && localArtwork.length() <= 2_000_000) return@runCatching localArtwork.readBytes()
                    artworkClient.newCall(Request.Builder().url(artworkUrl).build()).execute().use { response ->
                        if (!response.isSuccessful) return@use null
                        val body = response.body ?: return@use null
                        if (body.contentLength() > 2_000_000) return@use null
                        body.byteStream().use { stream ->
                            val output = java.io.ByteArrayOutputStream()
                            val buffer = ByteArray(8192)
                            var read = stream.read(buffer)
                            while (read >= 0 && output.size() + read <= 2_000_000) {
                                output.write(buffer, 0, read)
                                read = stream.read(buffer)
                            }
                            if (read >= 0) null else output.toByteArray()
                        }
                    }
                }.getOrNull()
            } ?: return@launch
            if (identity != expectedScope || player.currentMediaItem?.mediaId != track.id) return@launch
            val item = player.currentMediaItem ?: return@launch
            player.replaceMediaItem(player.currentMediaItemIndex,
                item.buildUpon().setMediaMetadata(item.mediaMetadata.buildUpon()
                    .setArtworkData(bytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER).build()).build())
        }
    }

    companion object {
        internal const val SLEEP_COMMAND = "org.mihonban.android.SLEEP_TIMER"
        internal const val PLAY_NEXT_COMMAND = "org.mihonban.android.PLAY_NEXT"
        internal const val TRACK_EXTRA = "mihonban_track"
        @Volatile internal var sleepDeadline = 0L
        private val mediaJson = Json { ignoreUnknownKeys = true }

        internal fun mediaItem(track: Track, repository: MihonbanRepository, downloads: DownloadStore): MediaItem {
            val uri = downloads.localFile(track.id)?.let(Uri::fromFile) ?: Uri.parse(repository.streamUrl(track.id, proxy = true))
            val extras = Bundle().apply { putString(TRACK_EXTRA, mediaJson.encodeToString(track)) }
            val metadata = MediaMetadata.Builder().setTitle(track.title).setArtist(track.artist)
                .setAlbumTitle(track.albumTitle).setIsPlayable(true).setIsBrowsable(false).setExtras(extras)
            if (track.albumId.isNotBlank()) metadata.setArtworkUri(downloads.artworkFile(track.albumId)?.let(Uri::fromFile)
                ?: Uri.parse(repository.artworkUrl(track.albumId, 300)))
            return MediaItem.Builder().setMediaId(track.id).setUri(uri).setMediaMetadata(metadata.build()).build()
        }

        internal fun trackFrom(item: MediaItem): Track? = item.mediaMetadata.extras?.getString(TRACK_EXTRA)?.let {
            runCatching { mediaJson.decodeFromString<Track>(it) }.getOrNull()
        }
    }
}
