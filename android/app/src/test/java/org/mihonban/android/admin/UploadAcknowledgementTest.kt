package org.mihonban.android.admin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.IOException

class UploadAcknowledgementTest {
    @Test fun googleAcknowledgementUsesInclusiveByteRange() {
        assertEquals(327680L, uploadAcknowledgedOffset("gdrive", 308, "bytes=0-327679", "", 655360, 1_000_000))
    }

    @Test fun emptyGoogleStatusMeansNothingHasBeenCommitted() {
        assertEquals(0L, uploadAcknowledgedOffset("gdrive", 308, null, "", 0, 1_000_000, true))
        assertThrows(IllegalStateException::class.java) {
            uploadAcknowledgedOffset("gdrive", 308, null, "", 327680, 1_000_000)
        }
    }

    @Test fun invalidRangesCannotCompleteOrOverflowTheUpload() {
        for (range in listOf("bytes=0-1000000", "bytes=0-9223372036854775807", "bytes=1-24")) {
            assertThrows(RuntimeException::class.java) {
                uploadAcknowledgedOffset("gdrive", 308, range, "", 327680, 1_000_000)
            }
        }
    }

    @Test fun oneDriveResumeStartsAtTheServersExpectedByte() {
        assertEquals(123L, uploadAcknowledgedOffset("onedrive", 202, null,
            """{"nextExpectedRanges":["123-"]}""", 327680, 1_000_000))
        assertEquals(123L, uploadAcknowledgedOffset("onedrive", 200, null,
            """{"nextExpectedRanges":["123-"]}""", 0, 1_000_000, true))
    }

    @Test fun missingOrNegativeOneDriveOffsetsAreRejected() {
        for (body in listOf("{}", """{"nextExpectedRanges":["-1-"]}""", """{"nextExpectedRanges":["1000001-"]}""")) {
            assertThrows(IllegalArgumentException::class.java) {
                uploadAcknowledgedOffset("onedrive", 202, null, body, 327680, 1_000_000)
            }
        }
    }

    @Test fun onlyFinalSuccessCompletesAnUpload() {
        assertEquals(1_000_000L, uploadAcknowledgedOffset("gdrive", 201, null, "{}", 1_000_000, 1_000_000))
        assertThrows(IllegalArgumentException::class.java) {
            uploadAcknowledgedOffset("gdrive", 200, null, "{}", 327680, 1_000_000)
        }
        assertThrows(IllegalArgumentException::class.java) {
            uploadAcknowledgedOffset("gdrive", 202, null, "{}", 1_000_000, 1_000_000)
        }
        assertThrows(IOException::class.java) {
            uploadAcknowledgedOffset("onedrive", 429, null, "{}", 1_000_000, 1_000_000)
        }
    }
}
