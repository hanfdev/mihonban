package org.mihonban.android.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Serializable
internal data class StoredCredential(val cookie: String = "", val session: Session = Session())

internal interface CredentialStorage {
    fun read(): StoredCredential
    fun write(value: StoredCredential)
    fun clear()
}

/** Credentials are encrypted with a non-exportable Android Keystore key. */
internal class KeystoreCredentialStorage(context: Context, private val scope: String) : CredentialStorage {
    private val preferences = context.getSharedPreferences("mihonban_credentials", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }

    @Synchronized override fun read(): StoredCredential {
        val encoded = preferences.getString(scope, null) ?: return StoredCredential()
        return runCatching {
            val parts = encoded.split(':', limit = 2)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
            cipher.updateAAD(scope.toByteArray(Charsets.UTF_8))
            json.decodeFromString<StoredCredential>(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)).toString(Charsets.UTF_8))
        }.getOrElse { clear(); StoredCredential() }
    }

    @Synchronized override fun write(value: StoredCredential) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(scope.toByteArray(Charsets.UTF_8))
        val encrypted = cipher.doFinal(json.encodeToString(value).toByteArray(Charsets.UTF_8))
        preferences.edit().putString(scope, Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()
    }

    @Synchronized override fun clear() { preferences.edit().remove(scope).commit() }

    private companion object { const val KEY_ALIAS = "org.mihonban.android.session.v1" }
}

/** A session cookie is never sent to a different origin or outside this API prefix. */
internal class ScopedCookieJar(
    private val address: ServerAddress,
    private val storage: CredentialStorage,
    private val clock: () -> Long = System::currentTimeMillis,
) : CookieJar {
    private var active = true
    private var credential = storage.read()
    private var cookie = Cookie.parse(address.url, credential.cookie)?.takeIf { it.expiresAt > clock() }

    @Synchronized fun restoredSession(): Session = credential.session.takeIf {
        it.ok && (it.guest || cookie != null)
    } ?: Session()

    @Synchronized override fun loadForRequest(url: HttpUrl): List<Cookie> {
        if (!active || !address.contains(url)) return emptyList()
        val current = cookie ?: return emptyList()
        return if (current.expiresAt > clock() && current.matches(url)) listOf(current) else emptyList()
    }

    @Synchronized override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (!active || !address.contains(url)) return
        val next = cookies.lastOrNull { it.name == "mihonban_session" } ?: return
        cookie = next.takeIf { it.expiresAt > clock() && it.value.isNotBlank() }
        credential = credential.copy(cookie = cookie?.toString().orEmpty())
        storage.write(credential)
    }

    @Synchronized fun saveSession(session: Session) {
        if (!active) return
        credential = credential.copy(session = session)
        storage.write(credential)
    }

    @Synchronized fun clear() {
        cookie = null
        credential = StoredCredential()
        storage.clear()
    }

    @Synchronized fun invalidate() { active = false }
}
