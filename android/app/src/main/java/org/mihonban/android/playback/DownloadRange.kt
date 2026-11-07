package org.mihonban.android.playback

internal data class DownloadRange(val start: Long, val end: Long, val total: Long) {
    companion object {
        fun parse(header: String?): DownloadRange? {
            val match = Regex("bytes ([0-9]+)-([0-9]+)/([0-9]+)").matchEntire(header.orEmpty()) ?: return null
            val values = match.groupValues.drop(1).map { it.toLongOrNull() ?: return null }
            val (start, end, total) = values
            return if (start >= 0 && end >= start && total > end) DownloadRange(start, end, total) else null
        }
    }
}
