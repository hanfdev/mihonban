package org.mihonban.android.playback

import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.mihonban.android.data.MihonbanRepository
import org.mihonban.android.data.Track
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

data class PlaybackState(
    val current: Track? = null,
    val queue: List<Track> = emptyList(),
    val currentIndex: Int = -1,
    val isPlaying: Boolean = false,
    val playWhenReady: Boolean = false,
    val isBuffering: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val shuffle: Boolean = false,
    val repeatMode: Int = Player.REPEAT_MODE_OFF,
    val error: String? = null,
    val sleepRemainingMs: Long = 0,
)

@androidx.annotation.OptIn(UnstableApi::class)
class PlaybackConnection(context: Context, private val repository: MihonbanRepository) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutableState = MutableStateFlow(PlaybackState())
    val state: StateFlow<PlaybackState> = mutableState.asStateFlow()
    private val downloads = DownloadStore.get(appContext, repository)
    private var controller: MediaController? = null
    private var released = false
    private val pending = mutableListOf<(MediaController) -> Unit>()
    private val controllerFuture: com.google.common.util.concurrent.ListenableFuture<MediaController>

    init {
        PlaybackEnvironment.initialize(repository)
        controllerFuture = MediaController.Builder(appContext,
            SessionToken(appContext, ComponentName(appContext, PlaybackService::class.java))).buildAsync()
        controllerFuture.addListener({
            if (!released) {
                runCatching { controllerFuture.get() }.onSuccess { connected ->
                    controller = connected
                    connected.addListener(object : Player.Listener {
                        override fun onEvents(player: Player, events: Player.Events) {
                            updateState(events.containsAny(Player.EVENT_TIMELINE_CHANGED, Player.EVENT_MEDIA_ITEM_TRANSITION,
                                Player.EVENT_MEDIA_METADATA_CHANGED))
                        }
                        override fun onPlayerError(error: PlaybackException) {
                            mutableState.value = mutableState.value.copy(error = "播放失败：${error.errorCodeName}。请检查网络连接或重试。")
                        }
                    })
                    updateState(true)
                    val actions = pending.toList()
                    pending.clear()
                    actions.forEach { it(connected) }
                }.onFailure { error ->
                    mutableState.value = mutableState.value.copy(error = "无法连接播放服务：${error.message.orEmpty()}")
                }
            }
        }, ContextCompat.getMainExecutor(appContext))
        scope.launch {
            while (true) { delay(400); updateState(false) }
        }
    }

    fun play(tracks: List<Track>, index: Int = 0, shuffle: Boolean? = null) {
        val allowed = if (repository.session.value.isAdmin) tracks else tracks.filterNot { it.hidden }
        if (allowed.isEmpty() || repository.serverUrl.isBlank()) return
        val requested = tracks.getOrNull(index)
        val start = if (shuffle == true) allowed.indices.random()
            else allowed.indexOfFirst { it === requested || it.id == requested?.id }.coerceAtLeast(0)
        val expectedScope = repository.playbackScope()
        withController { player ->
            if (expectedScope != repository.playbackScope()) return@withController
            mutableState.value = mutableState.value.copy(error = null)
            shuffle?.let { player.shuffleModeEnabled = it }
            player.setMediaItems(allowed.map { PlaybackService.mediaItem(it, repository, downloads) }, start, 0)
            player.prepare()
            player.play()
            updateState(true)
        }
    }

    fun toggle() = withController { player ->
        if (player.isPlaying || player.playWhenReady && player.playbackState == Player.STATE_BUFFERING) player.pause()
        else {
            mutableState.value = mutableState.value.copy(error = null)
            if (player.playbackState == Player.STATE_IDLE || player.playerError != null) player.prepare()
            if (player.playbackState == Player.STATE_ENDED) player.seekToDefaultPosition()
            player.play()
        }
    }

    fun seekTo(positionMs: Long) = withController { it.seekTo(positionMs.coerceAtLeast(0)) }
    fun previous() = withController { it.seekToPrevious() }
    fun next() = withController { it.seekToNextMediaItem() }
    fun skipTo(index: Int) = withController {
        if (index in 0 until it.mediaItemCount) { it.seekToDefaultPosition(index); it.prepare(); it.play() }
    }
    fun setShuffle(enabled: Boolean) = withController { it.shuffleModeEnabled = enabled }
    fun cycleRepeat() = withController {
        it.repeatMode = when (it.repeatMode) {
            Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
            Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
    }

    fun addNext(track: Track) = withController {
        it.sendCustomCommand(SessionCommand(PlaybackService.PLAY_NEXT_COMMAND, Bundle.EMPTY),
            Bundle().apply { putString(PlaybackService.TRACK_EXTRA, Json.encodeToString(track)) })
    }
    fun enqueue(track: Track) = add(listOf(track), false)
    fun enqueue(tracks: List<Track>) = add(tracks, false)

    private fun add(tracks: List<Track>, next: Boolean) {
        val allowed = if (repository.session.value.isAdmin) tracks else tracks.filterNot { it.hidden }
        if (allowed.isEmpty() || repository.serverUrl.isBlank()) return
        withController { player ->
            val index = if (next && player.mediaItemCount > 0) player.currentMediaItemIndex + 1 else player.mediaItemCount
            player.addMediaItems(index, allowed.map { PlaybackService.mediaItem(it, repository, downloads) })
            if (player.playbackState == Player.STATE_IDLE) player.prepare()
            updateState(true)
        }
    }

    fun remove(index: Int) = withController {
        if (index in 0 until it.mediaItemCount) it.removeMediaItem(index)
    }

    fun move(from: Int, to: Int) = withController {
        if (from in 0 until it.mediaItemCount && to in 0 until it.mediaItemCount) it.moveMediaItem(from, to)
    }

    fun setSleepTimer(minutes: Int) = withController {
        it.sendCustomCommand(SessionCommand(PlaybackService.SLEEP_COMMAND, Bundle.EMPTY),
            Bundle().apply { putInt("minutes", minutes.coerceIn(0, 240)) })
    }

    fun stopAndClear() {
        pending.clear()
        PlaybackService.sleepDeadline = 0
        withController {
            it.stop()
            it.clearMediaItems()
            it.sendCustomCommand(SessionCommand(PlaybackService.SLEEP_COMMAND, Bundle.EMPTY),
                Bundle().apply { putInt("minutes", 0) })
            updateState(true)
        }
        mutableState.value = PlaybackState()
    }

    fun release() {
        released = true
        pending.clear()
        scope.cancel()
        MediaController.releaseFuture(controllerFuture)
        controller = null
    }

    private fun withController(action: (MediaController) -> Unit) {
        if (released) return
        val player = controller
        if (player != null) action(player) else pending.add(action)
    }

    private fun updateState(refreshQueue: Boolean) {
        val player = controller ?: return
        val old = mutableState.value
        val queue = if (refreshQueue) (0 until player.mediaItemCount).mapNotNull { PlaybackService.trackFrom(player.getMediaItemAt(it)) } else old.queue
        val current = player.currentMediaItem?.let(PlaybackService::trackFrom)
        val duration = player.duration.takeUnless { it == C.TIME_UNSET || it < 0 }
            ?: ((current?.duration ?: 0.0) * 1000).toLong()
        mutableState.value = old.copy(current = current, queue = queue,
            currentIndex = if (player.mediaItemCount == 0) -1 else player.currentMediaItemIndex,
            isPlaying = player.isPlaying, playWhenReady = player.playWhenReady,
            isBuffering = player.playbackState == Player.STATE_BUFFERING,
            positionMs = player.currentPosition.coerceAtLeast(0), durationMs = duration,
            shuffle = player.shuffleModeEnabled, repeatMode = player.repeatMode,
            error = if (player.isPlaying) null else old.error,
            sleepRemainingMs = (PlaybackService.sleepDeadline - System.currentTimeMillis()).coerceAtLeast(0))
    }
}
