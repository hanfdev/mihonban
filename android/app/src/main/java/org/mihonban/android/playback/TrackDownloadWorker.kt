package org.mihonban.android.playback

import android.content.Context
import android.os.SystemClock
import android.graphics.BitmapFactory
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request

/** Each bounded job persists partial bytes so WorkManager can resume after process death. */
class TrackDownloadWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val scope = inputData.getString("scope") ?: return@withContext Result.failure()
        val id = inputData.getString("trackId") ?: return@withContext Result.failure()
        val repository = PlaybackEnvironment.repository(applicationContext)
        val store = DownloadStore.get(applicationContext, repository)
        var item = store.record(scope, id) ?: return@withContext Result.failure()
        val attempt = inputData.getString("attempt") ?: return@withContext Result.failure()
        if (item.attempt != attempt) return@withContext Result.failure()
        if (scope != repository.playbackScope() || !repository.session.value.ok) {
            store.update(scope, item.copy(status = DownloadStatus.PAUSED, error = "请登录原服务器后重试"), true)
            return@withContext Result.failure()
        }
        if (item.status == DownloadStatus.PAUSED || item.status == DownloadStatus.COMPLETE) return@withContext Result.success()
        val partial = store.partialFile(scope, id, attempt)
        var bytes = if (partial.isFile) partial.length() else 0L
        // Without a source validator, appending could join two different versions of a track.
        if (bytes > 0 && item.validator.isNullOrEmpty()) { partial.delete(); bytes = 0 }
        val request = Request.Builder().url(repository.streamUrl(id, proxy = true))
            .header("Accept-Encoding", "identity")
        if (bytes > 0) request.header("Range", "bytes=$bytes-").header("If-Range", item.validator!!)
        val client = repository.httpClient.newBuilder().readTimeout(90, TimeUnit.SECONDS)
            .callTimeout(8, TimeUnit.MINUTES).build()
        val call = client.newCall(request.build())
        try {
            val earlyResult = call.consumeCancellable { response ->
                if (response.code == 401 || response.code == 403) {
                    store.update(scope, item.copy(status = DownloadStatus.FAILED, error = "登录已失效或没有下载权限"), true)
                    return@consumeCancellable Result.failure()
                }
                if (response.code == 416) {
                    partial.delete()
                    store.update(scope, item.copy(status = DownloadStatus.QUEUED, bytes = 0, validator = null), true)
                    return@consumeCancellable Result.retry()
                }
                if (response.code == 408 || response.code == 429 || response.code >= 500) throw IOException("服务器暂时不可用（${response.code}）")
                if (!response.isSuccessful) {
                    store.update(scope, item.copy(status = DownloadStatus.FAILED, error = "下载失败（HTTP ${response.code}）"), true)
                    return@consumeCancellable Result.failure()
                }
                val body = response.body ?: throw IOException("服务器未返回音频")
                val contentType = body.contentType()?.toString().orEmpty()
                if (contentType.contains("text/html") || contentType.contains("application/json")) throw IOException("服务器返回的不是音频文件")
                val validator = response.header("ETag")?.takeUnless { it.startsWith("W/") }
                    ?: response.header("Last-Modified")
                var total = body.contentLength().takeIf { it >= 0 } ?: 0L
                if (response.code == 206) {
                    val range = DownloadRange.parse(response.header("Content-Range")) ?: throw IOException("下载服务器返回了无效的字节范围")
                    if (range.start != bytes || (bytes > 0 && validator != item.validator)) {
                        partial.delete()
                        store.update(scope, item.copy(status = DownloadStatus.QUEUED, bytes = 0, validator = null), true)
                        return@consumeCancellable Result.retry()
                    }
                    total = range.total
                } else {
                    bytes = 0L
                }
                item = item.copy(status = DownloadStatus.DOWNLOADING, bytes = bytes, total = total, validator = validator, error = null)
                store.update(scope, item, true)
                val started = SystemClock.elapsedRealtime()
                var published = started
                body.byteStream().use { input ->
                    FileOutputStream(partial, bytes > 0).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            if (isStopped || !repository.session.value.ok || repository.playbackScope() != scope || store.record(scope, id)?.status == DownloadStatus.PAUSED || store.record(scope, id)?.attempt != attempt) {
                                call.cancel()
                                return@consumeCancellable Result.failure()
                            }
                            val count = input.read(buffer)
                            if (count < 0) break
                            output.write(buffer, 0, count)
                            bytes += count
                            val now = SystemClock.elapsedRealtime()
                            if (now - published > 700) {
                                store.update(scope, item.copy(bytes = bytes), true)
                                published = now
                            }
                            if (now - started > TimeUnit.MINUTES.toMillis(7)) {
                                store.update(scope, item.copy(bytes = bytes, status = DownloadStatus.QUEUED), true)
                                return@consumeCancellable Result.retry()
                            }
                        }
                        output.fd.sync()
                    }
                }
                if (bytes == 0L || (total > 0 && bytes != total)) throw IOException("下载尚未完成，请重试")
                null
            }
            if (earlyResult != null) return@withContext earlyResult
            if (isStopped || store.record(scope, id)?.attempt != attempt || store.record(scope, id)?.status == DownloadStatus.PAUSED) return@withContext Result.failure()
            cacheArtwork(scope, item.track.albumId, store)
            if (!isStopped && store.complete(scope, item, partial)) Result.success() else Result.failure()
        } catch (error: CancellationException) {
            call.cancel()
            throw error
        } catch (error: IOException) {
            val latest = store.record(scope, id)
            if (isStopped || latest == null || latest.attempt != attempt || latest.status == DownloadStatus.PAUSED) return@withContext Result.failure()
            val retry = runAttemptCount < 5
            store.update(scope, latest.copy(bytes = partial.length(), status = if (retry) DownloadStatus.QUEUED else DownloadStatus.FAILED,
                error = error.message ?: "网络连接中断"), true)
            if (retry) Result.retry() else Result.failure()
        }
    }

    private suspend fun cacheArtwork(scope: String, albumId: String, store: DownloadStore) {
        if (albumId.isBlank() || isStopped) return
        val repository = PlaybackEnvironment.repository(applicationContext)
        if (repository.playbackScope() != scope) return
        val destination = store.artworkDestination(scope, albumId)
        if (destination.isFile) return
        try {
            val client = repository.httpClient.newBuilder().callTimeout(15, TimeUnit.SECONDS).build()
            client.newCall(Request.Builder().url(repository.artworkUrl(albumId, 600)).build()).consumeCancellable { response ->
                if (!response.isSuccessful) return@consumeCancellable
                val body = response.body ?: return@consumeCancellable
                if (body.contentLength() > 2_000_000) return@consumeCancellable
                val bytes = body.byteStream().use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (output.size() + count > 2_000_000) return@use null
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                } ?: return@consumeCancellable
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || isStopped || repository.playbackScope() != scope) return@consumeCancellable
                val temporary = java.io.File(destination.parentFile, "${destination.name}.${id}.tmp")
                temporary.writeBytes(bytes)
                if (!temporary.renameTo(destination)) temporary.delete()
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) { }
    }
}
