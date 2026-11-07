import Foundation

/// Prepared off the main actor, then retained by the reader or its model.
/// This is a deliberately bounded Markdown subset, not a CommonMark implementation.
nonisolated struct MarkdownDocument: Sendable {
    enum Kind: Equatable, Sendable {
        case paragraph
        case heading(Int)
        case list(ordered: Bool)
        case listItem(String)
        case quote
        case code(language: String?)
        case thematicBreak
        case table([ColumnAlignment])
        case tableRow(header: Bool)
        case tableCell
    }

    enum ColumnAlignment: Equatable, Sendable { case leading, center, trailing }

    struct Block: Identifiable, Sendable {
        let id: String
        let kind: Kind
        let text: AttributedString
        let children: [Block]

        var accessibilityIdentifier: String {
            let name: String
            switch kind {
            case .paragraph: name = "paragraph"
            case .heading: name = "heading"
            case .list: name = "list"
            case .listItem: name = "list-item"
            case .quote: name = "quote"
            case .code: name = "code"
            case .thematicBreak: name = "break"
            case .table: name = "table"
            case .tableRow: name = "table-row"
            case .tableCell: name = "table-cell"
            }
            return "markdown-\(name)-\(id)"
        }
    }

    /// The original is never normalized, truncated, or replaced with rendered text.
    let source: String
    let blocks: [Block]
    /// Plain, bounded text; the caller still applies its six-line layout limit.
    let plainPreview: String
    let usedLiteralFallback: Bool
    let isTruncated: Bool

    static let maximumSourceBytes = 800_000
    static let maximumInlineCharacters = 4_096
    static let maximumBlocks = 2_048
    static let maximumDepth = 6

    /// Do not construct a document in a SwiftUI body. Keep the returned value in state.
    static func prepare(_ source: String) async -> MarkdownDocument {
        let task = Task.detached(priority: .userInitiated) { parse(source) }
        return await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }
    }

    /// Synchronous entry point for tests and callers already on a background executor.
    static func parse(_ source: String) -> MarkdownDocument {
        let tooLarge = source.utf8.count > maximumSourceBytes
        let bounded = tooLarge ? String(decoding: source.utf8.prefix(maximumSourceBytes), as: UTF8.self) : source
        let parser = MarkdownBlockParser()
        let blocks = parser.parse(MarkdownLine.lines(in: bounded), depth: 0)
        return MarkdownDocument(source: source, blocks: blocks, plainPreview: preview(blocks),
                                usedLiteralFallback: parser.usedFallback, isTruncated: tooLarge)
    }

    /// Links are data, never commands. Relative URLs and app/file/data schemes stay inert.
    static func isSafeURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme),
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        let decoded = url.absoluteString.removingPercentEncoding ?? url.absoluteString
        guard !decoded.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              parts.user == nil, parts.password == nil else { return false }
        if scheme == "mailto" { return !parts.path.isEmpty && parts.host == nil }
        return !(parts.host ?? "").isEmpty
    }

    private static func preview(_ blocks: [Block]) -> String {
        var output = ""
        var length = 0
        var pendingSpace = false
        func append(_ text: String) {
            for character in text {
                if length >= 1_200 { return }
                if character.isWhitespace { pendingSpace = !output.isEmpty }
                else {
                    if pendingSpace {
                        guard length + 1 < 1_200 else { return }
                        output.append(" "); length += 1; pendingSpace = false
                    }
                    output.append(character); length += 1
                }
            }
            pendingSpace = !output.isEmpty
        }
        func visit(_ block: Block) {
            guard length < 1_200 else { return }
            append(String(block.text.characters))
            for child in block.children { visit(child) }
        }
        for block in blocks { visit(block) }
        return output
    }
}

private nonisolated struct MarkdownLine {
    var text: String
    var ending: String
    var isBlank: Bool { text.allSatisfy { $0 == " " || $0 == "\t" } }

    static func lines(in source: String) -> [MarkdownLine] {
        var result: [MarkdownLine] = []
        var start = source.startIndex
        // Character iteration treats CRLF as one newline and preserves its spelling in code.
        for index in source.indices where source[index].isNewline {
            let next = source.index(after: index)
            result.append(MarkdownLine(text: String(source[start..<index]), ending: String(source[index..<next])))
            start = next
        }
        if start < source.endIndex { result.append(MarkdownLine(text: String(source[start...]), ending: "")) }
        return result
    }

    var indentation: Int {
        var width = 0
        for character in text {
            if character == " " { width += 1 }
            else if character == "\t" { width += 4 - width % 4 }
            else { break }
        }
        return width
    }

    func droppingIndent(_ width: Int) -> MarkdownLine {
        var consumed = 0
        var index = text.startIndex
        while index < text.endIndex && consumed < width {
            if text[index] == " " { consumed += 1 }
            else if text[index] == "\t" { consumed += 4 - consumed % 4 }
            else { break }
            index = text.index(after: index)
        }
        return MarkdownLine(text: String(repeating: " ", count: max(0, consumed - width)) + text[index...], ending: ending)
    }
}

private nonisolated final class MarkdownBlockParser {
    typealias Block = MarkdownDocument.Block
    typealias Kind = MarkdownDocument.Kind
    private var nextID = 0
    private(set) var usedFallback = false

    private func block(_ kind: Kind, text: AttributedString = AttributedString(), children: [Block] = []) -> Block {
        defer { nextID += 1 }
        return Block(id: String(nextID), kind: kind, text: text, children: children)
    }

    func parse(_ lines: [MarkdownLine], depth: Int) -> [Block] {
        guard depth < MarkdownDocument.maximumDepth else { return literal(lines) }
        var result: [Block] = []
        var index = 0
        while index < lines.count {
            if Task.isCancelled { return result }
            if nextID >= MarkdownDocument.maximumBlocks {
                result += literal(Array(lines[index...]))
                break
            }
            let line = lines[index]
            if line.isBlank { index += 1; continue }

            if let fence = fenceStart(line) {
                var code = ""
                index += 1
                while index < lines.count && !fenceEnd(lines[index], fence: fence) {
                    let content = lines[index].droppingIndent(min(fence.indent, lines[index].indentation))
                    code += content.text + content.ending
                    index += 1
                }
                if index < lines.count { index += 1 }
                result += literalChunks(code, kind: .code(language: fence.language))
                continue
            }
            if let heading = heading(line) {
                result += prose(heading.text, kind: .heading(heading.level))
                index += 1; continue
            }
            if index + 1 < lines.count, let level = setextLevel(lines[index + 1]), !startsBlock(line) {
                result += prose(line.text.trimmingCharacters(in: .whitespaces), kind: .heading(level))
                index += 2; continue
            }
            if thematicBreak(line) {
                result.append(block(.thematicBreak)); index += 1; continue
            }
            if quoteContent(line) != nil {
                var contents: [MarkdownLine] = []
                while index < lines.count {
                    if let content = quoteContent(lines[index]) { contents.append(content); index += 1 }
                    else if !lines[index].isBlank && !startsBlock(lines[index]) {
                        contents.append(lines[index]); index += 1
                    } else { break }
                }
                result.append(block(.quote, children: parse(contents, depth: depth + 1)))
                continue
            }
            if let first = listMarker(line) {
                var items: [Block] = []
                while index < lines.count, let marker = listMarker(lines[index]),
                      marker.indent == first.indent, marker.ordered == first.ordered {
                    var contents = [MarkdownLine(text: marker.content, ending: lines[index].ending)]
                    index += 1
                    var afterBlank = false
                    while index < lines.count {
                        let next = lines[index]
                        if let nextMarker = listMarker(next), nextMarker.indent <= first.indent { break }
                        if next.isBlank {
                            contents.append(next); index += 1; afterBlank = true; continue
                        }
                        if next.indentation >= marker.contentIndent {
                            contents.append(next.droppingIndent(marker.contentIndent)); index += 1
                            afterBlank = false
                        } else if !afterBlank && !startsBlock(next) {
                            contents.append(next); index += 1
                        } else { break }
                    }
                    items.append(block(.listItem(marker.label), children: parse(contents, depth: depth + 1)))
                    if nextID >= MarkdownDocument.maximumBlocks { break }
                }
                result.append(block(.list(ordered: first.ordered), children: items))
                continue
            }
            if index + 1 < lines.count, let header = cells(line.text),
               let alignments = tableAlignments(lines[index + 1].text), header.count == alignments.count {
                var rows: [Block] = [tableRow(header, header: true)]
                index += 2
                // One table cannot instantiate thousands of cells in a single layout pass.
                while index < lines.count && rows.count < 65 && nextID < MarkdownDocument.maximumBlocks,
                      !lines[index].isBlank, let values = cells(lines[index].text), values.count == header.count {
                    rows.append(tableRow(values, header: false)); index += 1
                }
                result.append(block(.table(alignments), children: rows))
                continue
            }
            if line.indentation >= 4 {
                var code = ""
                while index < lines.count && (lines[index].indentation >= 4 || lines[index].isBlank) {
                    let content = lines[index].droppingIndent(4)
                    code += content.text + content.ending
                    index += 1
                }
                result += literalChunks(code, kind: .code(language: nil))
                continue
            }
            var paragraph = line.text
            index += 1
            while index < lines.count && !lines[index].isBlank && !startsBlock(lines[index]) {
                if index + 1 < lines.count, cells(lines[index].text) != nil,
                   tableAlignments(lines[index + 1].text) != nil { break }
                // Keeping authored line breaks also supports lyric-like album notes.
                paragraph += "\n" + lines[index].text
                index += 1
            }
            result += prose(paragraph, kind: .paragraph)
        }
        return result
    }

    private func prose(_ source: String, kind: Kind) -> [Block] {
        guard source.count <= MarkdownDocument.maximumInlineCharacters else {
            usedFallback = true
            return literalChunks(source, kind: kind)
        }
        return [block(kind, text: MarkdownInline.parse(source))]
    }

    private func literal(_ lines: [MarkdownLine]) -> [Block] {
        usedFallback = true
        return literalChunks(lines.map { $0.text + $0.ending }.joined(), kind: .paragraph)
    }

    private func literalChunks(_ source: String, kind: Kind) -> [Block] {
        if source.isEmpty { return [block(kind)] }
        var result: [Block] = []
        var start = source.startIndex
        while start < source.endIndex {
            let end = source.index(start, offsetBy: MarkdownDocument.maximumInlineCharacters, limitedBy: source.endIndex) ?? source.endIndex
            result.append(block(kind, text: AttributedString(String(source[start..<end]))))
            start = end
        }
        return result
    }

    private func startsBlock(_ line: MarkdownLine) -> Bool {
        fenceStart(line) != nil || heading(line) != nil || thematicBreak(line)
            || quoteContent(line) != nil || listMarker(line) != nil
    }

    private struct Fence { let marker: Character; let count: Int; let indent: Int; let language: String? }

    private func fenceStart(_ line: MarkdownLine) -> Fence? {
        guard line.indentation <= 3 else { return nil }
        let text = line.text.drop(while: { $0 == " " })
        guard let marker = text.first, marker == "`" || marker == "~" else { return nil }
        let count = text.prefix(while: { $0 == marker }).count
        guard count >= 3 else { return nil }
        let info = text.dropFirst(count).trimmingCharacters(in: .whitespaces)
        guard marker != "`" || !info.contains("`") else { return nil }
        let language = info.split(whereSeparator: \.isWhitespace).first.map(String.init)
        return Fence(marker: marker, count: count, indent: line.indentation, language: language)
    }

    private func fenceEnd(_ line: MarkdownLine, fence: Fence) -> Bool {
        guard line.indentation <= 3 else { return false }
        let text = line.text.drop(while: { $0 == " " })
        let count = text.prefix(while: { $0 == fence.marker }).count
        return count >= fence.count && text.dropFirst(count).allSatisfy { $0 == " " || $0 == "\t" }
    }

    private func heading(_ line: MarkdownLine) -> (level: Int, text: String)? {
        guard line.indentation <= 3 else { return nil }
        let text = line.text.drop(while: { $0 == " " })
        let level = text.prefix(while: { $0 == "#" }).count
        guard (1...6).contains(level) else { return nil }
        let rest = text.dropFirst(level)
        guard rest.isEmpty || rest.first?.isWhitespace == true else { return nil }
        var title = rest.trimmingCharacters(in: .whitespaces)
        let suffix = title.reversed().prefix(while: { $0 == "#" }).count
        if suffix > 0 {
            let prefix = title.dropLast(suffix)
            if prefix.isEmpty || prefix.last?.isWhitespace == true { title = prefix.trimmingCharacters(in: .whitespaces) }
        }
        return (level, title)
    }

    private func setextLevel(_ line: MarkdownLine) -> Int? {
        guard line.indentation <= 3 else { return nil }
        let value = line.text.trimmingCharacters(in: .whitespaces)
        guard let marker = value.first, marker == "=" || marker == "-",
              value.allSatisfy({ $0 == marker }) else { return nil }
        return marker == "=" ? 1 : 2
    }

    private func thematicBreak(_ line: MarkdownLine) -> Bool {
        guard line.indentation <= 3 else { return false }
        let compact = line.text.filter { $0 != " " && $0 != "\t" }
        guard compact.count >= 3, let marker = compact.first, ["*", "-", "_"].contains(marker) else { return false }
        return compact.allSatisfy { $0 == marker }
    }

    private func quoteContent(_ line: MarkdownLine) -> MarkdownLine? {
        guard line.indentation <= 3 else { return nil }
        var text = line.text.drop(while: { $0 == " " })
        guard text.first == ">" else { return nil }
        text = text.dropFirst()
        if text.first == " " || text.first == "\t" { text = text.dropFirst() }
        return MarkdownLine(text: String(text), ending: line.ending)
    }

    private struct ListMarker {
        let ordered: Bool
        let label: String
        let indent: Int
        let contentIndent: Int
        let content: String
    }

    private func listMarker(_ line: MarkdownLine) -> ListMarker? {
        let indent = line.indentation
        guard indent <= 3 else { return nil }
        let text = line.text.drop(while: { $0 == " " })
        guard let first = text.first else { return nil }
        let ordered: Bool
        let width: Int
        let label: String
        if ["-", "*", "+"].contains(first) { ordered = false; width = 1; label = "•" }
        else {
            let digits = text.prefix(while: { $0.isASCII && $0.isNumber })
            guard (1...9).contains(digits.count), let delimiter = text.dropFirst(digits.count).first,
                  delimiter == "." || delimiter == ")" else { return nil }
            ordered = true; width = digits.count + 1; label = String(digits) + "."
        }
        let rest = text.dropFirst(width)
        guard rest.isEmpty || rest.first == " " || rest.first == "\t" else { return nil }
        let spaces = rest.prefix(while: { $0 == " " }).count
        let padding = rest.first == "\t" ? 1 : min(max(spaces, 1), 4)
        return ListMarker(ordered: ordered, label: label, indent: indent,
                          contentIndent: indent + width + padding, content: String(rest.dropFirst(padding)))
    }

    private func cells(_ source: String) -> [String]? {
        guard source.contains("|") else { return nil }
        var values: [String] = []
        var value = ""
        var escaped = false
        var ticks = 0
        let characters = Array(source.trimmingCharacters(in: .whitespaces))
        var index = 0
        while index < characters.count {
            let character = characters[index]
            if escaped { value.append(character); escaped = false; index += 1; continue }
            if character == "\\" { value.append(character); escaped = true; index += 1; continue }
            if character == "`" {
                var end = index
                while end < characters.count && characters[end] == "`" { end += 1 }
                let count = end - index
                if ticks == 0 { ticks = count } else if count == ticks { ticks = 0 }
                value += String(repeating: "`", count: count)
                index = end; continue
            }
            if character == "|" && ticks == 0 { values.append(value); value = "" }
            else { value.append(character) }
            index += 1
        }
        values.append(value)
        if characters.first == "|" { values.removeFirst() }
        if characters.last == "|" && values.last?.isEmpty == true { values.removeLast() }
        guard (1...12).contains(values.count),
              values.allSatisfy({ $0.count <= MarkdownDocument.maximumInlineCharacters }) else { return nil }
        return values.map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private func tableAlignments(_ source: String) -> [MarkdownDocument.ColumnAlignment]? {
        guard let values = cells(source) else { return nil }
        var result: [MarkdownDocument.ColumnAlignment] = []
        for value in values {
            var core = value[...]
            if core.first == ":" { core = core.dropFirst() }
            if core.last == ":" { core = core.dropLast() }
            guard core.count >= 3, core.allSatisfy({ $0 == "-" }) else { return nil }
            result.append(value.hasSuffix(":") ? (value.hasPrefix(":") ? .center : .trailing) : .leading)
        }
        return result
    }

    private func tableRow(_ values: [String], header: Bool) -> Block {
        block(.tableRow(header: header), children: values.map { value in
            // Large cells stay readable without creating an expensive inline parse.
            let text = value.count <= MarkdownDocument.maximumInlineCharacters ? MarkdownInline.parse(value) : AttributedString(value)
            return block(.tableCell, text: text)
        })
    }
}

private nonisolated enum MarkdownInline {
    static func parse(_ source: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        let safeSource = textOnlySource(source)
        guard let parsed = try? AttributedString(markdown: safeSource, options: options) else { return AttributedString(source) }
        // Rebuild from known attributes. Image metadata, HTML and extended attributes
        // can never become executable content or trigger an automatic network request.
        var result = AttributedString()
        for run in parsed.runs {
            var piece = AttributedString(String(parsed[run.range].characters))
            if let intent = run.inlinePresentationIntent {
                piece.inlinePresentationIntent = intent.intersection([.emphasized, .stronglyEmphasized, .strikethrough, .code])
            }
            if let url = run.link, MarkdownDocument.isSafeURL(url) { piece.link = url }
            result.append(piece)
        }
        return result
    }

    /// Turn image syntax into explicit text links and escape raw tags before parsing.
    /// Backtick spans and escaped punctuation remain untouched.
    private static func textOnlySource(_ source: String) -> String {
        let characters = Array(source)
        var output = ""
        var index = 0
        var ticks = 0
        while index < characters.count {
            let character = characters[index]
            if character == "\\", ticks == 0, index + 1 < characters.count {
                output.append(character); output.append(characters[index + 1]); index += 2; continue
            }
            if character == "`" {
                var end = index
                while end < characters.count && characters[end] == "`" { end += 1 }
                let count = end - index
                if ticks == 0 { ticks = count } else if ticks == count { ticks = 0 }
                output += String(repeating: "`", count: count); index = end; continue
            }
            if ticks == 0 && character == "!", index + 1 < characters.count, characters[index + 1] == "[" {
                // An empty alternative still has a visible tap target; no image is loaded.
                if index + 2 < characters.count, characters[index + 2] == "]" {
                    output += "[↗"; index += 2; continue
                }
                index += 1; continue
            }
            if ticks == 0 && character == "<" {
                // Keep explicit autolinks, but never interpret HTML tags.
                let suffix = String(characters[(index + 1)...].prefix(8)).lowercased()
                if !suffix.hasPrefix("https://") && !suffix.hasPrefix("http://") && !suffix.hasPrefix("mailto:") {
                    output += "&lt;"; index += 1; continue
                }
            }
            output.append(character); index += 1
        }
        return output
    }
}
