package org.mihonban.android.data

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.security.MessageDigest

@ConsistentCopyVisibility
data class ServerAddress private constructor(val url: HttpUrl) {
    val value: String get() = url.toString().trimEnd('/')
    val scope: String get() = sha256(value)

    fun contains(target: HttpUrl): Boolean = sameOrigin(url, target) &&
        target.encodedPath.startsWith(url.encodedPath.trimEnd('/') + "/api/")

    fun endpoint(path: String): HttpUrl {
        require(path.startsWith("/api/")) { "API paths must begin with /api/." }
        val target = (value + path).toHttpUrlOrNull()
            ?: throw IllegalArgumentException("Invalid API path.")
        require(contains(target)) { "API path escapes the configured server." }
        return target
    }

    companion object {
        fun parse(address: String): ServerAddress {
            val parsed = address.trim().toHttpUrlOrNull()
                ?: throw IllegalArgumentException("请输入完整的 http:// 或 https:// 服务器地址。")
            require(parsed.username.isEmpty() && parsed.password.isEmpty()) { "服务器地址不能包含账号或口令。" }
            val clean = parsed.newBuilder().query(null).fragment(null).build()
            return ServerAddress(clean)
        }

        fun sameOrigin(a: HttpUrl, b: HttpUrl): Boolean =
            a.scheme == b.scheme && a.host == b.host && a.port == b.port

        fun encodeSegment(value: String): String = HttpUrl.Builder().scheme("https")
            .host("localhost").addPathSegment(value).build().encodedPath.removePrefix("/")

        fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}
