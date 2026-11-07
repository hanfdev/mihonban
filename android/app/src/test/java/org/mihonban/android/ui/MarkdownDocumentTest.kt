package org.mihonban.android.ui

import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.node.*
import org.junit.Assert.*
import org.junit.Test

class MarkdownDocumentTest {
    @Test fun previewPreservesReadableTextWithoutMarkdownSyntax() {
        val source = "# Notes\n\n**Warm** and *quiet*, with [source](https://example.com).\n\n- First\n- Second"
        assertEquals("Notes Warm and quiet, with source. First Second", MarkdownDocument.preview(MarkdownDocument.parse(source)))
    }

    @Test fun standardAndExtendedBlocksAreParsed() {
        val source = "# Notes\n\n> A quotation\n\n3. First\n4. Second\n\n```text\nFLAC\n```\n\n| Track | Length |\n| --- | --- |\n| One | 3:00 |\n\n~~Old~~"
        val blocks = MarkdownDocument.parse(source).children()
        assertTrue(blocks[0] is Heading)
        assertTrue(blocks[1] is BlockQuote)
        assertEquals(3, (blocks[2] as OrderedList).markerStartNumber)
        assertEquals("FLAC\n", (blocks[3] as FencedCodeBlock).literal)
        assertTrue(blocks[4] is TableBlock)
        assertTrue(blocks[5].firstChild is Strikethrough)
    }

    @Test fun linksResolveAgainstTheServerAndRejectExecutableSchemes() {
        val base = "https://music.example.com/"
        assertEquals("https://music.example.com/about", MarkdownDocument.link("/about", base))
        assertEquals("https://example.com/source", MarkdownDocument.link("https://example.com/source", base))
        assertEquals("mailto:editor@example.com", MarkdownDocument.link("mailto:editor@example.com", base))
        listOf("javascript:alert(1)", "file:///data/private", "intent://open", "data:text/html,test").forEach {
            assertNull(MarkdownDocument.link(it, base))
        }
    }
}
