package org.mihonban.android.admin

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.HttpUrl.Companion.toHttpUrl
import okio.BufferedSink
import org.mihonban.android.data.MihonbanRepository
import java.io.IOException
import java.text.Normalizer
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal data class PickedAudio(val uri: Uri, val filename: String, val size: Long,
    val title: String, val album: String, val artist: String, val year: String,
    val track: Int, val disc: Int, val duration: Double, val format: String)

internal suspend fun readPickedAudio(context: Context, uri: Uri, ordinal: Int): PickedAudio = withContext(Dispatchers.IO) {
    var name = uri.lastPathSegment.orEmpty()
    var size = -1L
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (nameColumn >= 0) name = cursor.getString(nameColumn)
            if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn)
        }
    }
    if (size <= 0) context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { size = it.length }
    name = Normalizer.normalize(name, Normalizer.Form.NFC)
    require(size > 0) { "无法读取 $name 的文件大小，请选择本地可读取的音频。" }
    require(name.length <= 255 && name.none { it in "\\/:*?\"<>|" || it.code < 32 }) { "文件名无效：$name" }
    val extension = name.substringAfterLast('.', "").lowercase()
    require(extension in setOf("mp3", "flac", "m4a", "ogg", "opus", "wav", "aac", "aiff", "aif")) { "不支持的音频格式：$name" }
    val metadata = mutableMapOf<Int, String>()
    val retriever = MediaMetadataRetriever()
    try {
        retriever.setDataSource(context, uri)
        listOf(MediaMetadataRetriever.METADATA_KEY_TITLE, MediaMetadataRetriever.METADATA_KEY_ALBUM,
            MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST, MediaMetadataRetriever.METADATA_KEY_ARTIST,
            MediaMetadataRetriever.METADATA_KEY_YEAR, MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER,
            MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER, MediaMetadataRetriever.METADATA_KEY_DURATION).forEach { key ->
            retriever.extractMetadata(key)?.let { metadata[key] = it }
        }
    } catch (_: RuntimeException) {
        // Files whose tags are unsupported remain importable with filename metadata.
    } finally { retriever.release() }
    val stem = name.substringBeforeLast('.')
    val numbered = Regex("^(\\d{1,3})[\\s._-]+(.+)$").matchEntire(stem)
    PickedAudio(uri, name, size, metadata[MediaMetadataRetriever.METADATA_KEY_TITLE]
        ?: numbered?.groupValues?.get(2) ?: stem,
        metadata[MediaMetadataRetriever.METADATA_KEY_ALBUM].orEmpty(),
        metadata[MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST]
            ?: metadata[MediaMetadataRetriever.METADATA_KEY_ARTIST].orEmpty(),
        metadata[MediaMetadataRetriever.METADATA_KEY_YEAR].orEmpty(),
        metadata[MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER]?.substringBefore('/')?.toIntOrNull()
            ?: numbered?.groupValues?.get(1)?.toIntOrNull() ?: ordinal,
        metadata[MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER]?.substringBefore('/')?.toIntOrNull() ?: 1,
        (metadata[MediaMetadataRetriever.METADATA_KEY_DURATION]?.toDoubleOrNull() ?: 0.0) / 1000.0, extension)
}

internal class AudioUploader(private val context: Context, private val repository: MihonbanRepository) {
    private val json = Json { ignoreUnknownKeys = true }
    private val expectedServer = repository.serverScope
    private val serverUrl = repository.serverUrl
    private val authenticatedClient = repository.httpClient
    private val directClient = OkHttpClient.Builder().connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.MINUTES).writeTimeout(5, TimeUnit.MINUTES)
        .followRedirects(false).followSslRedirects(false).build()

    suspend fun upload(file: PickedAudio, path: String, onProgress: (Long) -> Unit) {
        checkServer()
        val session = repository.request("POST", "/api/upload/session", buildJsonObject { put("path", path) }).obj()
        checkServer()
        val storageId = session.text("storageId")
        if (session.flag("proxy")) {
            val url = (serverUrl + "/api/upload/proxy").toHttpUrl().newBuilder()
                .addQueryParameter("path", path).addQueryParameter("storageId", storageId)
                .addQueryParameter("size", file.size.toString()).build()
            val coroutineContext = currentCoroutineContext()
            val body = object : RequestBody() {
                override fun contentType() = "application/octet-stream".toMediaType()
                override fun contentLength() = file.size
                override fun writeTo(sink: BufferedSink) {
                    context.contentResolver.openInputStream(file.uri)?.use { source ->
                        val buffer = ByteArray(64 * 1024)
                        var sent = 0L
                        while (true) {
                            coroutineContext.ensureActive()
                            checkServer()
                            val count = source.read(buffer)
                            if (count == -1) break
                            sink.write(buffer, 0, count)
                            sent += count; onProgress(sent)
                        }
                        if (sent != file.size) throw IOException("文件大小在上传过程中发生变化")
                    } ?: throw IOException("无法读取 ${file.filename}")
                }
            }
            retry {
                checkServer()
                authenticatedClient.newBuilder().writeTimeout(15, TimeUnit.MINUTES)
                    .readTimeout(15, TimeUnit.MINUTES).build().newCall(Request.Builder().url(url).put(body).build())
                    .await().use { response -> checkResponse(response) }
            }
        } else {
            val url = session.text("uploadUrl").toHttpUrl()
            require(url.isHttps) { "上传服务器必须使用 HTTPS" }
            val provider = session.text("provider")
            require(provider == "onedrive" || provider == "gdrive") { "不支持的上传会话" }
            var offset = 0L
            val chunkSize = 10 * 1024 * 1024
            while (offset < file.size) {
                currentCoroutineContext().ensureActive()
                checkServer()
                val start = offset
                val bytes = readChunk(file, start, minOf(chunkSize.toLong(), file.size - start).toInt())
                val end = start + bytes.size
                var attempts = 0
                while (true) {
                    try {
                        val request = Request.Builder().url(url)
                            .header("Content-Range", "bytes $start-${end - 1}/${file.size}")
                            .put(bytes.toRequestBody("application/octet-stream".toMediaType())).build()
                        directClient.newCall(request).await().use { response ->
                            val payload = response.body?.string().orEmpty()
                            offset = uploadAcknowledgedOffset(provider, response.code, response.header("Range"), payload, end, file.size)
                            require(offset > start && offset <= end) { "上传服务端返回了不一致的进度" }
                        }
                        break
                    } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                    catch (error: Exception) {
                        if (++attempts >= 4) throw error
                        delay((700L shl (attempts - 1)).coerceAtMost(6000))
                        // Query the session before replaying a chunk whose acknowledgement was lost.
                        val status = Request.Builder().url(url).apply {
                            if (provider == "gdrive") header("Content-Range", "bytes */${file.size}")
                                .put(ByteArray(0).toRequestBody()) else get()
                        }.build()
                        val resumed = try {
                            directClient.newCall(status).await().use { response ->
                                uploadAcknowledgedOffset(provider, response.code, response.header("Range"),
                                    response.body?.string().orEmpty(), start, file.size, statusQuery = true)
                            }
                        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                        catch (_: Exception) {
                            val complete = if (end == file.size) try {
                                verify(path, storageId, file.size); true
                            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                            catch (_: Exception) { false } else false
                            if (complete) file.size else start
                        }
                        require(resumed in start..end) { "上传会话的恢复位置无效" }
                        if (resumed > start) { offset = resumed; break }
                    }
                }
                onProgress(offset)
            }
        }
        retry { verify(path, storageId, file.size) }
        onProgress(file.size)
    }

    private suspend fun verify(path: String, storageId: String, size: Long) {
        checkServer()
        requireSuccess(repository.request("POST", "/api/upload/verify", buildJsonObject {
            put("path", path); put("storageId", storageId); put("size", size)
        }))
    }

    private fun checkServer() {
        check(repository.serverScope == expectedServer && repository.session.value.isAdmin) {
            "连接或登录状态已变化，请重新登录原服务器后重试上传"
        }
    }

    private suspend fun readChunk(file: PickedAudio, start: Long, count: Int): ByteArray = withContext(Dispatchers.IO) {
        context.contentResolver.openInputStream(file.uri)?.use { source ->
            var remaining = start
            while (remaining > 0) {
                currentCoroutineContext().ensureActive()
                val skipped = source.skip(remaining)
                if (skipped > 0) remaining -= skipped else {
                    if (source.read() == -1) throw IOException("音频文件提前结束")
                    remaining--
                }
            }
            val bytes = ByteArray(count)
            var read = 0
            while (read < count) {
                currentCoroutineContext().ensureActive()
                val size = source.read(bytes, read, count - read)
                if (size == -1) throw IOException("音频文件提前结束")
                read += size
            }
            bytes
        } ?: throw IOException("无法读取 ${file.filename}")
    }

    private fun checkResponse(response: Response) {
        if (!response.isSuccessful) {
            val detail = runCatching { json.parseToJsonElement(response.body?.string().orEmpty()).obj().text("error") }.getOrDefault("")
            throw IOException(detail.ifBlank { "上传失败 HTTP ${response.code}" })
        }
    }

    private suspend fun <T> retry(block: suspend () -> T): T {
        var failure: Exception? = null
        repeat(4) { attempt ->
            try { return block() }
            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (error: Exception) { failure = error; if (attempt < 3) delay(500L shl attempt) }
        }
        throw failure ?: IOException("上传失败")
    }
}

internal fun uploadAcknowledgedOffset(provider: String, status: Int, range: String?, body: String,
    end: Long, total: Long, statusQuery: Boolean = false): Long {
    require(provider == "gdrive" || provider == "onedrive") { "不支持的上传服务" }
    require(total > 0 && end in 0..total) { "上传文件大小无效" }
    if (provider == "gdrive" && status == 308) {
        val acknowledged = Regex("bytes=0-(\\d+)", RegexOption.IGNORE_CASE).matchEntire(range.orEmpty().trim())
            ?.groupValues?.get(1)?.toLongOrNull()
        if (acknowledged == null) {
            if (statusQuery && range.isNullOrBlank()) return 0L
            error("Google Drive 未确认收到的数据范围")
        }
        require(acknowledged in 0 until total) { "上传确认超出文件范围" }
        return acknowledged + 1
    }
    if (status !in 200..299) throw IOException("上传失败 HTTP $status")
    if (provider == "onedrive" && (status == 202 || statusQuery)) {
        val next = runCatching { Json.parseToJsonElement(body).jsonObject["nextExpectedRanges"]?.jsonArray
            ?.firstOrNull()?.jsonPrimitive?.content?.substringBefore('-')?.toLongOrNull() }.getOrNull()
        require(next != null && next in 0..total) { "OneDrive 未确认有效的数据范围" }
        return next
    }
    require(status == 200 || status == 201) { "上传服务未确认文件已完成" }
    require(end == total || statusQuery) { "上传会话过早结束" }
    return total
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (continuation.isActive) continuation.resumeWithException(e) }
        override fun onResponse(call: Call, response: Response) {
            if (continuation.isActive) continuation.resume(response) { _, value, _ -> value.close() }
            else response.close()
        }
    })
}
