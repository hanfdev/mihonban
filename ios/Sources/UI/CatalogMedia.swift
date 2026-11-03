import SwiftUI

struct RemoteArtwork: View {
    let url: URL?
    let client: APIClient?
    var pixels = 640
    var fill = true
    @State private var image: UIImage?
    var body: some View {
        ZStack {
            if image == nil || fill { RecordPlaceholder() }
            if let image {
                if fill { Image(uiImage: image).resizable().scaledToFill() }
                else { Image(uiImage: image).resizable().scaledToFit() }
            }
        }.aspectRatio(fill ? 1 : nil, contentMode: .fit).clipped()
            .task(id: url) {
                image = nil
                guard let url, let client else { return }
                let result = await ArtworkStore.shared.image(url: url, session: client.session, pixels: pixels)
                if !Task.isCancelled { image = result }
            }
    }
}

struct ArtistAvatar: View {
    let artist: Artist
    let model: AppModel
    var size: CGFloat = 52
    var body: some View {
        RemoteArtwork(url: model.imageClient?.artistArtURL(artist.name, custom: artist.hasAvatar == true),
                      client: model.imageClient, pixels: size > 100 ? 640 : 256)
            .frame(width: size, height: size).clipShape(Circle())
            .overlay(Circle().stroke(Theme.line, lineWidth: 0.5))
            .accessibilityHidden(true)
    }
}

// Wraps chips onto as many lines as the proposed width needs.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var items: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = row.items.isEmpty ? size.width : row.width + spacing + size.width
            if needed > width && !row.items.isEmpty {
                rows.append(row)
                row = Row()
            }
            row.width = row.items.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.items.append(index)
        }
        if !row.items.isEmpty { rows.append(row) }
        return rows
    }
}

struct Chip: View {
    let text: String
    var prominent = false
    var body: some View {
        Text(text).font(.footnote)
            .padding(.horizontal, 11).padding(.vertical, 6)
            .foregroundStyle(prominent ? Theme.ink : Theme.dim)
            .background(prominent ? Theme.raised : Theme.surface, in: Capsule())
            .overlay(Capsule().stroke(Theme.line, lineWidth: 0.5))
    }
}

// Notes and biographies are Markdown on the web. Inline syntax is rendered
// natively; block structure is kept as plain paragraphs.
struct MarkdownText: View {
    let source: String
    var body: some View {
        Text(Self.attributed(source)).font(.callout).foregroundStyle(Theme.dim).lineSpacing(4)
            .tint(Theme.accent).textSelection(.enabled)
    }

    static func attributed(_ source: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: source, options: options)) ?? AttributedString(source)
    }
}

struct GalleryViewer: View {
    let images: [String]
    let client: APIClient?
    @State var selection: String
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            TabView(selection: $selection) {
                ForEach(images, id: \.self) { id in
                    ZoomableArtwork(url: client?.imageURL(id), client: client).tag(id)
                }
            }.tabViewStyle(.page(indexDisplayMode: images.count > 1 ? .always : .never))
                .background(Color.black.ignoresSafeArea())
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L10n.text("common.done")) { dismiss() } } }
                .navigationTitle(L10n.text("albumPage.gallery")).navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct ZoomableArtwork: View {
    let url: URL?
    let client: APIClient?
    @State private var scale: CGFloat = 1
    @State private var settled: CGFloat = 1
    var body: some View {
        RemoteArtwork(url: url, client: client, pixels: 2400, fill: false)
            .scaleEffect(scale)
            .gesture(MagnifyGesture()
                .onChanged { scale = min(5, max(1, settled * $0.magnification)) }
                .onEnded { _ in settled = scale })
            .onTapGesture(count: 2) { withAnimation(.snappy) { scale = scale > 1 ? 1 : 2.5; settled = scale } }
            .accessibilityAddTraits(.isImage)
            .accessibilityLabel(L10n.text("common.zoom"))
    }
}
