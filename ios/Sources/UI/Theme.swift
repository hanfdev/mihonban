import SwiftUI
import CoreText

nonisolated enum Theme {
    static let background = Color(hex: 0x0d0b09)
    static let surface = Color(hex: 0x16130f)
    static let raised = Color(hex: 0x1e1a15)
    static let line = Color(hex: 0x2b251d)
    static let ink = Color(hex: 0xf4ecdd)
    static let dim = Color(hex: 0xb0a58f)
    static let faint = Color(hex: 0x8d8370)
    static let accent = Color(hex: 0xe8542f)

    static func title(_ size: CGFloat, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom("ShipporiMincho-SemiBold", size: size, relativeTo: style)
    }
    static func body(_ size: CGFloat = 15, weight: Font.Weight = .regular) -> Font {
        .custom(weight == .semibold ? "Inter-SemiBold" : "Inter-Regular", size: size, relativeTo: .body)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 255) / 255,
                  green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255, opacity: 1)
    }
}

struct RecordPlaceholder: View {
    var body: some View {
        GeometryReader { geometry in
            let size = min(geometry.size.width, geometry.size.height)
            ZStack {
                Theme.raised
                Circle().stroke(Theme.faint.opacity(0.45), lineWidth: 1).padding(size * 0.16)
                Circle().stroke(Theme.line, lineWidth: 1).padding(size * 0.24)
                Circle().fill(Theme.ink.opacity(0.8)).padding(size * 0.36)
                Circle().fill(Theme.background).padding(size * 0.465)
            }
        }.accessibilityHidden(true)
    }
}

struct Cover: View {
    let albumID: String
    var size = 480
    var revision: Int?
    var client: APIClient?
    @State private var image: UIImage?

    var body: some View {
        CoverFrame(image: image)
        .task(id: "\(client?.baseURL.absoluteString ?? "")/\(albumID)/\(size)/\(revision ?? 0)") {
            image = nil
            guard let client else { return }
            let result = await ArtworkStore.shared.image(url: client.artworkURL(albumID, size: size, revision: revision),
                session: client.session, pixels: size <= 160 ? 256 : size <= 480 ? 640 : 1200,
                pinned: MediaPaths.pinnedCover(baseURL: client.baseURL, album: albumID))
            if !Task.isCancelled { image = result }
        }
    }
}

// A square sized by its container. The artwork is an overlay, so a cover that
// is not square is cropped instead of widening the layout around it.
struct CoverFrame: View {
    let image: UIImage?
    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { RecordPlaceholder() }
            .overlay { if let image { Image(uiImage: image).resizable().scaledToFill() } }
            .clipped()
            .contentShape(Rectangle())
    }
}

// A selected mode, such as shuffle or repeat, is lit: accent glyph on a soft
// accent disc, so it reads as a switch rather than an action.
struct IconButton: View {
    let symbol: String
    let label: String
    var selected = false
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 20, weight: .medium))
                .foregroundStyle(selected ? Theme.accent : Theme.ink)
                .frame(width: 44, height: 44)
                .background { if selected { Circle().fill(Theme.accent.opacity(0.18)) } }
                .contentShape(Circle())
                .animation(.snappy(duration: 0.2), value: selected)
        }.buttonStyle(.plain).accessibilityLabel(label)
            .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// Shuffle only sets the mode; Play all or a track row then starts playback.
struct ShuffleToggle: View {
    let player: PlayerModel
    var identifier = "shuffle"
    var body: some View {
        IconButton(symbol: "shuffle", label: L10n.text("common.shuffle"), selected: player.queue.shuffled) {
            player.toggleShuffle()
        }.accessibilityIdentifier(identifier)
    }
}

// The play row at the top of track lists. It sits on the page background with
// no separator, so it reads as part of the list header rather than a band.
struct PlayAllRow: View {
    let player: PlayerModel
    var identifier = "list"
    let play: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Button(action: play) {
                HStack(spacing: 12) {
                    Image(systemName: "play.fill").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                        .frame(width: 44, height: 44).background(Theme.accent, in: Circle())
                    Text(L10n.text("common.playAll")).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                        .lineLimit(1)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("\(identifier).play")
            Spacer(minLength: 8)
            ShuffleToggle(player: player, identifier: "\(identifier).shuffle")
        }
        .padding(.vertical, 4)
        .listRowBackground(Theme.background)
        .listRowSeparator(.hidden)
    }
}

struct PlayButton: View {
    let player: PlayerModel
    var diameter: CGFloat = 64
    var body: some View {
        Button { player.toggle() } label: {
            ZStack {
                Circle().fill(Theme.accent)
                if player.isLoading || player.isSeeking {
                    ProgressView().tint(Theme.ink)
                } else {
                    Image(systemName: player.wantsPlayback ? "pause.fill" : "play.fill")
                        .font(.system(size: diameter * 0.34, weight: .semibold))
                        .offset(x: player.wantsPlayback ? 0 : 1.5)
                        .foregroundStyle(Theme.ink)
                }
            }.frame(width: diameter, height: diameter)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L10n.text(player.wantsPlayback ? "common.pause" : "common.play"))
        .accessibilityIdentifier("player.toggle")
        .sensoryFeedback(.selection, trigger: player.wantsPlayback)
    }
}
