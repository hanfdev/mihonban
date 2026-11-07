package org.mihonban.android.playback

import java.io.IOException
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response

/** Keep cancellation connected until response consumption, including blocked body reads, ends. */
internal suspend fun <T> Call.consumeCancellable(consume: (Response) -> T): T = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) {
            continuation.resumeWith(Result.failure(error))
        }

        override fun onResponse(call: Call, response: Response) {
            if (!continuation.isActive) {
                response.close()
                return
            }
            // Run body/file IO on OkHttp's worker and always close a delivered response.
            continuation.resumeWith(runCatching { response.use(consume) })
        }
    })
}
