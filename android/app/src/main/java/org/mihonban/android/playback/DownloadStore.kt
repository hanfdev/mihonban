package org.mihonban.android.playback

import android.content.Context
import android.util.AtomicFile
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.mihonban.android.data.MihonbanRepository
import org.mihonban.android.data.Track

@Serializable
enum class DownloadStatus { QUEUED, DOWNLOADING, COMPLETE, FAILED, PAUSED }

@Serializable
data class DownloadItem(
    val track: Track,
    val status: DownloadStatus = DownloadStatus.QUEUED,
    val bytes: Long = 0,
    val total: Long = 0,
    val error: String? = null,
    val validator: String? = null,
    val wifiOnly: Boolean = false,
    val attempt: String = "",
) {
    val id: String get() = track.id
    val progress: Float get() = if (status == DownloadStatus.COMPLETE) 1f
        else if (total > 0) (bytes.toDouble() / total).toFloat().coerceIn(0f, 1f) else 0f
}

/** Explicit downloads are separate from disposable image and HTTP caches. */
class DownloadStore private constructor(
    context: Context,
    private var repository: MihonbanRepository,
) {
    private val appContext = context.applicationContext
    private val manager = WorkManager.getInstance(appContext)
    private val root = File(appContext.filesDir, "audio-downloads")
    private val json = Json { ignoreUnknownKeys = true }
    private var activeScope = repository.playbackScope()
    private val records = mutableMapOf<String, MutableList<DownloadItem>>()
    private val mutableItems = MutableStateFlow<List<DownloadItem>>(emptyList())
    val items: StateFlow<List<DownloadItem>> = mutableItems.asStateFlow()
    private val observer = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        onSessionChanged()
        observer.launch { repository.session.collect { onSessionChanged() } }
    }

    @Synchronized
    fun onSessionChanged() {
        val next = repository.playbackScope()
        if (next != activeScope) {
            manager.cancelAllWorkByTag(tag(activeScope))
            val previous = recordsFor(activeScope)
            for (i in previous.indices) {
                if (previous[i].status == DownloadStatus.DOWNLOADING || previous[i].status == DownloadStatus.QUEUED) {
                    previous[i] = previous[i].copy(status = DownloadStatus.PAUSED)
                }
            }
            publish(activeScope)
        }
        activeScope = next
        val restored = recordsFor(next)
        for (i in restored.indices) {
            val item = restored[i]
            if (item.status == DownloadStatus.COMPLETE && !finalFile(next, item.id).isFile) {
                restored[i] = item.copy(status = DownloadStatus.FAILED, bytes = 0, error = "下载文件已丢失，请重试")
            }
        }
        publish(next)
    }

    @Synchronized
    fun enqueue(track: Track, wifiOnly: Boolean = false) {
        if (track.hidden && !repository.session.value.isAdmin) return
        val scope = repository.playbackScope()
        val existing = recordsFor(scope).firstOrNull { it.id == track.id }
        if (existing?.status == DownloadStatus.COMPLETE && finalFile(scope, track.id).isFile) return
        if (existing?.status in setOf(DownloadStatus.QUEUED, DownloadStatus.DOWNLOADING)) return
        val attempt = java.util.UUID.randomUUID().toString()
        existing?.let { partialFile(scope, track.id, it.attempt).delete() }
        update(scope, DownloadItem(track = track, wifiOnly = wifiOnly, attempt = attempt))
        val request = OneTimeWorkRequestBuilder<TrackDownloadWorker>()
            .setInputData(workDataOf("scope" to scope, "trackId" to track.id, "attempt" to attempt))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(
                if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
            ).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .addTag(tag(scope))
            .build()
        manager.enqueueUniqueWork(workName(scope, track.id), ExistingWorkPolicy.REPLACE, request)
    }

    fun enqueue(tracks: List<Track>, wifiOnly: Boolean = false) = tracks.forEach { enqueue(it, wifiOnly) }

    @Synchronized
    fun retry(id: String) { recordsFor(activeScope).firstOrNull { it.id == id }?.let { enqueue(it.track, it.wifiOnly) } }

    @Synchronized
    fun cancel(id: String) {
        manager.cancelUniqueWork(workName(activeScope, id))
        recordsFor(activeScope).firstOrNull { it.id == id }?.let {
            update(activeScope, it.copy(status = DownloadStatus.PAUSED, error = null))
        }
    }

    @Synchronized
    fun remove(id: String) {
        manager.cancelUniqueWork(workName(activeScope, id))
        val old = recordsFor(activeScope).firstOrNull { it.id == id }
        recordsFor(activeScope).removeAll { it.id == id }
        finalFile(activeScope, id).delete()
        old?.let { partialFile(activeScope, id, it.attempt).delete() }
        val albumIds = recordsFor(activeScope).map { it.track.albumId }.toSet()
        directory(activeScope).listFiles()?.filter { it.extension == "art" }?.forEach { art ->
            if (albumIds.none { stableFileName(it) == art.nameWithoutExtension }) art.delete()
        }
        publish(activeScope)
    }

    @Synchronized
    fun localFile(id: String): File? = recordsFor(repository.playbackScope())
        .firstOrNull { it.id == id && it.status == DownloadStatus.COMPLETE }
        ?.let { finalFile(repository.playbackScope(), id).takeIf(File::isFile) }

    fun artworkFile(albumId: String): File? = artworkDestination(repository.playbackScope(), albumId).takeIf(File::isFile)

    @Synchronized
    internal fun record(scope: String, id: String): DownloadItem? = recordsFor(scope).firstOrNull { it.id == id }

    @Synchronized
    internal fun update(scope: String, item: DownloadItem, existingOnly: Boolean = false) {
        val list = recordsFor(scope)
        val index = list.indexOfFirst { it.id == item.id }
        if (existingOnly && index >= 0 && list[index].attempt != item.attempt) return
        if (existingOnly && index >= 0 && list[index].status == DownloadStatus.PAUSED && item.status != DownloadStatus.PAUSED) return
        if (index >= 0) list[index] = item else if (!existingOnly) list.add(item) else return
        publish(scope)
    }

    @Synchronized
    internal fun complete(scope: String, item: DownloadItem, partial: File): Boolean {
        val current = recordsFor(scope).firstOrNull { it.id == item.id }
        if (current == null || current.attempt != item.attempt || current.status == DownloadStatus.PAUSED || repository.playbackScope() != scope) {
            partial.delete()
            return false
        }
        val size = partial.length()
        if (!partial.renameTo(finalFile(scope, item.id))) throw java.io.IOException("无法保存下载文件")
        update(scope, item.copy(status = DownloadStatus.COMPLETE, bytes = size, total = size, error = null), true)
        return true
    }

    internal fun partialFile(scope: String, id: String, attempt: String): File = File(directory(scope), stableFileName("$id/$attempt") + ".part")
    internal fun finalFile(scope: String, id: String): File = File(directory(scope), stableFileName(id) + ".audio")
    internal fun artworkDestination(scope: String, albumId: String): File = File(directory(scope), stableFileName(albumId) + ".art")

    private fun directory(scope: String): File = File(root, stableFileName(scope)).apply { mkdirs() }

    private fun recordsFor(scope: String): MutableList<DownloadItem> = records.getOrPut(scope) {
        runCatching {
            AtomicFile(File(directory(scope), "manifest.json")).openRead().use {
                json.decodeFromString<List<DownloadItem>>(it.readBytes().toString(Charsets.UTF_8)).toMutableList()
            }
        }.getOrDefault(mutableListOf())
    }

    private fun publish(scope: String) {
        val list = recordsFor(scope).toList()
        val file = AtomicFile(File(directory(scope), "manifest.json"))
        var stream: java.io.FileOutputStream? = null
        try {
            stream = file.startWrite()
            stream.write(json.encodeToString(list).toByteArray())
            file.finishWrite(stream)
        } catch (error: Exception) {
            stream?.let { file.failWrite(it) }
        }
        if (scope == activeScope) mutableItems.value = list
    }

    companion object {
        @Volatile private var instance: DownloadStore? = null
        fun get(context: Context, repository: MihonbanRepository): DownloadStore = instance ?: synchronized(this) {
            instance ?: DownloadStore(context, repository).also { instance = it }
        }
        internal fun workName(scope: String, id: String) = "mihonban-download-${stableFileName("$scope/$id")}"
        private fun tag(scope: String) = "mihonban-downloads-${stableFileName(scope)}"
    }
}
