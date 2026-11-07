package org.mihonban.android.playback

import android.content.Context
import org.mihonban.android.MihonbanApplication
import org.mihonban.android.data.MihonbanRepository
import java.security.MessageDigest

internal object PlaybackEnvironment {
    @Volatile private var shared: MihonbanRepository? = null

    fun initialize(repository: MihonbanRepository) { shared = repository }

    fun repository(context: Context): MihonbanRepository = shared ?: synchronized(this) {
        shared ?: (context.applicationContext as MihonbanApplication).repository.also { shared = it }
    }
}

internal fun MihonbanRepository.playbackScope(): String =
    serverScope + "-" + session.value.cacheRole

internal fun stableFileName(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
