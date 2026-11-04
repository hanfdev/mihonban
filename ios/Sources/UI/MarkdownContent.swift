import SwiftUI

/// The parent owns vertical scrolling and the prose width (normally at most 680 points).
/// Rendering a retained document performs no Markdown parsing or remote image loading.
struct MarkdownContent: View {
    let document: MarkdownDocument

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 16) {
            ForEach(document.blocks) { block in
                MarkdownBlockContent(block: block)
            }
        }
        .font(.body)
        .foregroundStyle(Theme.ink)
        .tint(Theme.accent)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.openURL, OpenURLAction { url in
            MarkdownDocument.isSafeURL(url) ? .systemAction(url) : .discarded
        })
    }
}

private struct MarkdownBlockContent: View {
    let block: MarkdownDocument.Block
    @ScaledMetric(relativeTo: .callout) private var markerWidth: CGFloat = 22

    var body: some View {
        contents.accessibilityIdentifier(block.accessibilityIdentifier)
    }

    @ViewBuilder
    private var contents: some View {
        switch block.kind {
        case .paragraph, .tableCell:
            prose(block.text)
        case .heading(let level):
            prose(block.text)
                .font(headingFont(level))
                .foregroundStyle(Theme.ink)
                .padding(.top, level <= 2 ? 8 : 2)
                .accessibilityAddTraits(.isHeader)
        case .list:
            VStack(alignment: .leading, spacing: 8) { children }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .contain)
        case .listItem(let marker):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(verbatim: marker).font(.callout.monospacedDigit()).foregroundStyle(Theme.dim)
                    .fixedSize().frame(minWidth: markerWidth, alignment: .trailing)
                VStack(alignment: .leading, spacing: 8) { children }
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .contain)
        case .quote:
            VStack(alignment: .leading, spacing: 12) { children }
                .foregroundStyle(Theme.dim)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 14)
                .overlay(alignment: .leading) { Rectangle().fill(Theme.line).frame(width: 3) }
                .accessibilityElement(children: .contain)
        case .code(let language):
            VStack(alignment: .leading, spacing: 8) {
                if let language {
                    Text(verbatim: language).font(.caption.monospaced()).foregroundStyle(Theme.dim)
                        .lineLimit(1)
                }
                ScrollView(.horizontal) {
                    Text(verbatim: String(block.text.characters))
                        .font(.system(.callout, design: .monospaced))
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: true, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                .overlay { RoundedRectangle(cornerRadius: 8).stroke(Theme.line, lineWidth: 1) }
                .accessibilityIdentifier("\(block.accessibilityIdentifier)-scroll")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
        case .thematicBreak:
            Rectangle().fill(Theme.line).frame(height: 1).padding(.vertical, 5).accessibilityHidden(true)
        case .table(let alignments):
            ScrollView(.horizontal) {
                Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
                    ForEach(block.children) { row in
                        GridRow(alignment: .top) {
                            ForEach(Array(row.children.enumerated()), id: \.element.id) { index, cell in
                                tableCell(cell, header: row.kind == .tableRow(header: true),
                                          alignment: alignments.indices.contains(index) ? alignments[index] : .leading)
                            }
                        }
                    }
                }
                .fixedSize(horizontal: true, vertical: false)
                .padding(1)
            }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay { RoundedRectangle(cornerRadius: 8).stroke(Theme.line, lineWidth: 1) }
            .accessibilityElement(children: .contain)
        case .tableRow:
            children
        }
    }

    private var children: some View {
        ForEach(block.children) { child in MarkdownBlockContent(block: child) }
    }

    private func prose(_ text: AttributedString) -> some View {
        Text(styled(text))
            .lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func styled(_ text: AttributedString) -> AttributedString {
        var result = text
        // Inline code needs an explicit Dynamic Type font; other inline intents
        // remain native so emphasis inherits the heading or surrounding body font.
        for run in text.runs where run.inlinePresentationIntent?.contains(.code) == true {
            result[run.range].font = .system(.callout, design: .monospaced)
            result[run.range].backgroundColor = Theme.surface
        }
        return result
    }

    private func tableCell(_ cell: MarkdownDocument.Block, header: Bool,
                           alignment: MarkdownDocument.ColumnAlignment) -> some View {
        let horizontal: Alignment = alignment == .center ? .center : alignment == .trailing ? .trailing : .leading
        let textAlignment: TextAlignment = alignment == .center ? .center : alignment == .trailing ? .trailing : .leading
        return Text(styled(cell.text))
            .font(header ? .callout.weight(.semibold) : .callout)
            .multilineTextAlignment(textAlignment)
            .lineSpacing(3)
            .frame(minWidth: 100, maxWidth: 240, alignment: horizontal)
            .fixedSize(horizontal: false, vertical: true)
            .padding(10)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(header ? Theme.line.opacity(0.45) : Color.clear)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 0.5) }
            .accessibilityAddTraits(header ? .isHeader : [])
            .accessibilityIdentifier(cell.accessibilityIdentifier)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2.weight(.bold)
        case 2: .title3.weight(.semibold)
        case 3: .headline
        default: .body.weight(.semibold)
        }
    }
}
