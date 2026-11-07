package org.mihonban.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.tables.*
import org.commonmark.node.*
import org.commonmark.node.Text as MarkdownText
import org.commonmark.node.Paragraph as MarkdownParagraph

@Composable
internal fun MarkdownBlock(node: Node, baseUrl: String, notify: (String) -> Unit, depth: Int = 0) {
    if (depth > 24) {
        Text(MarkdownDocument.preview(node), style = MaterialTheme.typography.bodyMedium)
        return
    }
    val children = node.children()
    val paragraphStyle = MaterialTheme.typography.bodyLarge.copy(lineHeight = 27.sp)
    when (node) {
        is Heading -> {
            val size = when (node.level) { 1 -> 26.sp; 2 -> 23.sp; 3 -> 20.sp; else -> 17.sp }
            Text(markdownInline(children, baseUrl, notify), Modifier.semantics { heading() },
                style = MaterialTheme.typography.titleLarge.copy(fontSize = size, lineHeight = size * 1.45f))
        }
        is MarkdownParagraph -> {
            if (children.none { it is Image }) Text(markdownInline(children, baseUrl, notify), style = paragraphStyle)
            else {
                // Markdown does not require blank lines between images and their captions.
                val parts = remember(node) {
                    buildList {
                        var start = 0
                        children.forEachIndexed { index, child ->
                            if (child is Image) {
                                if (start < index) add(children.subList(start, index))
                                add(listOf(child))
                                start = index + 1
                            }
                        }
                        if (start < children.size) add(children.subList(start, children.size))
                    }.map { part ->
                        part.dropWhile { it is SoftLineBreak || it is HardLineBreak }
                            .dropLastWhile { it is SoftLineBreak || it is HardLineBreak }
                    }.filter { it.isNotEmpty() }
                }
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    parts.forEach { part ->
                        val image = part.singleOrNull() as? Image
                        if (image == null) Text(markdownInline(part, baseUrl, notify), style = paragraphStyle)
                        else {
                            val url = MarkdownDocument.link(image.destination, baseUrl)?.takeIf { it.startsWith("http") }
                            MarkdownImage(url, MarkdownDocument.preview(image))
                        }
                    }
                }
            }
        }
        is BlockQuote -> Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)
            .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(8.dp))) {
            Spacer(Modifier.fillMaxHeight().width(3.dp).background(MaterialTheme.colorScheme.secondary))
            Column(Modifier.weight(1f).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                children.forEach { MarkdownBlock(it, baseUrl, notify, depth + 1) }
            }
        }
        is BulletList, is OrderedList -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            children.forEachIndexed { index, item ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(if (node is OrderedList) "${node.markerStartNumber + index}." else "•",
                        Modifier.widthIn(min = 18.dp), color = MaterialTheme.colorScheme.secondary, style = paragraphStyle)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        item.children().forEach { MarkdownBlock(it, baseUrl, notify, depth + 1) }
                    }
                }
            }
        }
        is FencedCodeBlock -> MarkdownCode(node.literal, node.info)
        is IndentedCodeBlock -> MarkdownCode(node.literal, "")
        is ThematicBreak -> HorizontalDivider(Modifier.padding(vertical = 6.dp), color = MaterialTheme.colorScheme.outlineVariant)
        is TableBlock -> {
            val rows = children.flatMap { it.children() }
            Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
                .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(8.dp))) {
                rows.forEach { row ->
                    Row {
                        row.children().forEach { cell ->
                            Text(markdownInline(cell.children(), baseUrl, notify), Modifier.width(180.dp).padding(12.dp),
                                style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 23.sp,
                                    fontWeight = if ((cell as? TableCell)?.isHeader == true) FontWeight.Bold else FontWeight.Normal))
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
        is HtmlBlock -> Text(node.literal, style = paragraphStyle)
        else -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            children.forEach { MarkdownBlock(it, baseUrl, notify, depth + 1) }
        }
    }
}

@Composable
private fun MarkdownCode(code: String, language: String) {
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(8.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (language.isNotBlank()) Text(language, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(code.trimEnd('\n'), Modifier.horizontalScroll(rememberScrollState()),
            style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace, lineHeight = 23.sp))
    }
}

@Composable
private fun markdownInline(nodes: List<Node>, baseUrl: String, notify: (String) -> Unit): AnnotatedString {
    val accent = MaterialTheme.colorScheme.primary
    val codeBackground = MaterialTheme.colorScheme.surfaceContainerHigh
    val handler = LocalUriHandler.current
    val failed = words("无法打开此链接", "Unable to open this link")
    return buildAnnotatedString {
        fun appendNode(node: Node, depth: Int = 0) {
            if (depth > 32) return
            fun appendChildren() { node.children().forEach { appendNode(it, depth + 1) } }
            when (node) {
                is MarkdownText -> append(node.literal)
                is SoftLineBreak -> append(' ')
                is HardLineBreak -> append('\n')
                is Emphasis -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendChildren() }
                is StrongEmphasis -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { appendChildren() }
                is Strikethrough -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { appendChildren() }
                is Code -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBackground)) { append(node.literal) }
                is Link, is Image -> {
                    val destination = if (node is Link) node.destination else (node as Image).destination
                    val url = MarkdownDocument.link(destination, baseUrl)
                    if (url == null) appendChildren()
                    else withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = accent, textDecoration = TextDecoration.Underline)),
                        linkInteractionListener = { runCatching { handler.openUri(url) }.onFailure { notify(failed) } })) { appendChildren() }
                }
                is HtmlInline -> append(node.literal)
                else -> appendChildren()
            }
        }
        nodes.forEach { appendNode(it) }
    }
}
