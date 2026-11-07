package org.mihonban.android.ui

import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.node.*
import org.commonmark.parser.Parser
import java.net.URI

internal object MarkdownDocument {
    private val parser = Parser.builder().extensions(listOf(TablesExtension.create(), StrikethroughExtension.create())).build()

    fun parse(source: String): Node = parser.parse(source)

    fun preview(document: Node): String = buildString {
        fun visit(node: Node) {
            if (length >= 600) return
            when (node) {
                is Text -> append(node.literal.take(600 - length))
                is Code -> append(node.literal.take(600 - length))
                is SoftLineBreak, is HardLineBreak -> append(' ')
                is HtmlBlock, is HtmlInline -> Unit
                is FencedCodeBlock -> append(node.literal.take(600 - length))
                is IndentedCodeBlock -> append(node.literal.take(600 - length))
                else -> node.children().forEach(::visit)
            }
            if (node is Block) append(' ')
        }
        visit(document)
    }.replace(Regex("\\s+"), " ").trim()

    fun link(destination: String, baseUrl: String): String? = runCatching {
        val resolved = URI(baseUrl).resolve(destination.trim())
        when (resolved.scheme?.lowercase()) {
            "http", "https" -> resolved.takeIf { !it.host.isNullOrBlank() }?.toASCIIString()
            "mailto" -> resolved.toASCIIString()
            else -> null
        }
    }.getOrNull()
}

internal fun Node.children(): List<Node> = buildList {
    var child = firstChild
    while (child != null) { add(child); child = child.next }
}
