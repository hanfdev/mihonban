package org.mihonban.android

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import org.mihonban.android.data.MihonbanRepository
import org.mihonban.android.playback.PlaybackCache
import org.mihonban.android.playback.PlaybackSettings

class MihonbanApplication : Application(), ImageLoaderFactory {
    val repository by lazy { MihonbanRepository(this) }
    val playbackCache by lazy { PlaybackCache(this) }
    val playbackSettings by lazy { PlaybackSettings(this) }
    override fun newImageLoader() = ImageLoader.Builder(this)
        .callFactory(okhttp3.Call.Factory { request -> repository.httpClient.newCall(request) })
        .diskCache { coil.disk.DiskCache.Builder().directory(java.io.File(cacheDir, "image_cache")).maxSizeBytes(64L * 1024 * 1024).build() }
        .crossfade(true)
        .build()
}
