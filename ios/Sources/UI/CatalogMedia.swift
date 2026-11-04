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
    // Centres each line, for headers laid out under a centred cover.
    var centered = false

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = centered ? bounds.minX + max(0, bounds.width - row.width) / 2 : bounds.minX
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
    @State private var pagingLocked = false
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(images, id: \.self) { id in
                        ZoomableArtwork(url: client?.imageURL(id), client: client, isActive: selection == id,
                                        pageNumber: (images.firstIndex(of: id) ?? 0) + 1, pageCount: images.count) { locked in
                            if selection == id { pagingLocked = locked }
                        }
                        .containerRelativeFrame(.horizontal)
                        .frame(maxHeight: .infinity)
                        .id(id)
                    }
                }.scrollTargetLayout()
            }
                .scrollTargetBehavior(.paging)
                .scrollPosition(id: Binding<String?>(get: { selection }, set: { if let id = $0 { selection = id } }))
                .scrollIndicators(.hidden)
                // Only the outer pager is disabled; the UIKit image scroller remains interactive.
                .scrollDisabled(pagingLocked)
                .onChange(of: selection) { _, _ in pagingLocked = false }
                .overlay(alignment: .bottom) {
                    if images.count > 1 {
                        GalleryPageIndicator(count: images.count, current: images.firstIndex(of: selection) ?? 0)
                            .frame(height: 36).padding(.bottom, 8).allowsHitTesting(false)
                    }
                }
                .background(Color.black.ignoresSafeArea())
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L10n.text("common.done")) { dismiss() } } }
                .navigationTitle(L10n.text("albumPage.gallery")).navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct ZoomableArtwork: View {
    let url: URL?
    let client: APIClient?
    let isActive: Bool
    let pageNumber: Int
    let pageCount: Int
    let onPagingLockChange: (Bool) -> Void
    @State private var image: UIImage?
    var body: some View {
        ZStack {
            if image == nil { RecordPlaceholder() }
            GalleryZoomArtwork(image: image, isActive: isActive, pageNumber: pageNumber, pageCount: pageCount,
                               onPagingLockChange: onPagingLockChange)
        }
        .clipped()
        .task(id: url) {
            image = nil
            guard let url, let client else { return }
            let result = await ArtworkStore.shared.image(url: url, session: client.session, pixels: 2400)
            if !Task.isCancelled { image = result }
        }
    }
}
