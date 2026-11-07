package org.mihonban.android.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DownloadRangeTest {
    @Test fun acceptsValidResumeResponse() {
        assertEquals(DownloadRange(4096, 8191, 8192), DownloadRange.parse("bytes 4096-8191/8192"))
    }

    @Test fun rejectsRangesThatCouldCorruptDownloads() {
        listOf(null, "", "bytes */8192", "bytes 4096-8192/8192", "bytes 8191-4096/8192",
            "bytes -1-3/4", "bytes 0-999999999999999999999/200", "items 0-2/3").forEach {
            assertNull(it, DownloadRange.parse(it))
        }
    }

    @Test fun fileNamesCannotEscapeDownloadDirectory() {
        val name = stableFileName("../../../private?track/id")
        assertEquals(64, name.length)
        assertEquals(true, name.all { it in '0'..'9' || it in 'a'..'f' })
        assertEquals(name, stableFileName("../../../private?track/id"))
    }
}
