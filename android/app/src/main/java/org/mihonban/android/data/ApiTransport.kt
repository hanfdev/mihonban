package org.mihonban.android.data

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiException(val status: Int, override val message: String, val code: String? = null) : Exception(message)

internal class ApiTransport(val address: ServerAddress, val cookies: ScopedCookieJar) {
    val httpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS).cookieJar(cookies)
        .followSslRedirects(false)
        .addNetworkInterceptor { chain ->
            var request = chain.request()
            if (!address.contains(request.url)) {
                request = request.newBuilder().removeHeader("Cookie").removeHeader("Authorization").build()
            }
            chain.proceed(request)
        }
        .build()

    // API redirects are rejected so password bodies cannot be replayed to another host.
    private val apiClient = httpClient.newBuilder().followRedirects(false).callTimeout(60, TimeUnit.SECONDS).build()

    suspend fun request(method: String, path: String, body: JsonObject?): JsonElement {
        val payload = body?.toString()?.toRequestBody("application/json; charset=utf-8".toMediaType())
            ?: if (method in setOf("POST", "PUT", "PATCH")) ByteArray(0).toRequestBody(null) else null
        val request = Request.Builder().url(address.endpoint(path)).method(method, payload)
            .header("Accept", "application/json").header("User-Agent", "Mihonban-Android/0.1")
            .header("Cache-Control", "no-cache").build()
        return apiClient.newCall(request).await().use { response ->
            val text = response.body?.string().orEmpty()
            val data = runCatching { Json.parseToJsonElement(text) }.getOrNull()
            if (!response.isSuccessful) {
                val problem = data as? JsonObject
                val message = (problem?.get("error") as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull
                    ?: when (response.code) {
                        401 -> "登录已失效，请重新登录。"
                        403 -> "此操作需要管理员权限。"
                        404 -> "找不到此内容。"
                        429 -> "请求过于频繁，请稍后重试。"
                        in 300..399 -> "服务器返回重定向，请填写最终服务器地址。"
                        else -> "服务器请求失败（${response.code}）。"
                    }
                throw ApiException(response.code, message,
                    (problem?.get("code") as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull)
            }
            data ?: if (response.code == 204 || text.isBlank()) JsonObject(emptyMap())
            else throw ApiException(response.code, "服务器没有返回有效 JSON，请检查服务器地址。")
        }
    }

    fun close() { cookies.invalidate(); apiClient.dispatcher.cancelAll() }
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) {
            if (!continuation.isCancelled) continuation.resumeWithException(error)
        }
        override fun onResponse(call: Call, response: Response) {
            continuation.resume(response) { _, result, _ -> result.close() }
        }
    })
}
