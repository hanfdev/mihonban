import SwiftUI

// Only structured credits identify individual artists. A display string may
// contain commas or ampersands within a band's name, so it is never split.
struct PlaybackCredits: Equatable, Sendable {
    let names: [String]
    let rawText: String

    init(track: Track?) {
        var seen: Set<String> = []
        names = (track?.artists ?? []).compactMap { credit in
            let name = credit.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, seen.insert(name).inserted else { return nil }
            return name
        }
        rawText = track?.artist?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    var isEmpty: Bool { names.isEmpty && rawText.isEmpty }
    var firstName: String { names.first ?? rawText }
    var additionalCount: Int { max(0, names.count - 1) }
    var singleArtist: String? { names.count == 1 ? names.first : nil }
    var fullText: String { names.isEmpty ? rawText : names.joined(separator: " · ") }
    var moreText: String { L10n.text("mobile.moreArtists", String(additionalCount)) }
    var compactText: String { additionalCount > 0 ? firstName + " · " + moreText : firstName }
}

struct PlaybackCreditsButton: View {
    let credits: PlaybackCredits
    let action: () -> Void

    var body: some View {
        if !credits.isEmpty {
            Button(action: action) {
                HStack(spacing: 8) {
                    Text(credits.firstName).lineLimit(1).truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if credits.additionalCount > 0 {
                        Text(credits.moreText).fixedSize()
                            .accessibilityIdentifier("player.artists.count")
                    }
                    if credits.singleArtist == nil {
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).accessibilityHidden(true)
                    }
                }.font(Theme.body(17)).foregroundStyle(Theme.dim)
                    .frame(minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("player.artist")
                .accessibilityLabel(credits.fullText)
                .accessibilityValue(credits.additionalCount > 0 ? credits.moreText : "")
                .accessibilityHint(L10n.text(credits.singleArtist == nil ? "mobile.viewCredits" : "mobile.viewArtist"))
        }
    }
}

struct NowPlayingHeading: View {
    let track: Track?
    let openAlbum: () -> Void
    let openArtists: () -> Void
    var favorite: PlayerFavoriteButton? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 12) {
                Button(action: openAlbum) {
                    Text(track?.title ?? "").font(Theme.title(27)).foregroundStyle(Theme.ink)
                        .lineLimit(2).multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }.buttonStyle(.plain).disabled(track?.albumId == nil)
                    .accessibilityHint(L10n.text("player.viewAlbum")).accessibilityIdentifier("player.title")
                if let favorite { favorite.id(track?.id).fixedSize() }
            }
            PlaybackCreditsButton(credits: PlaybackCredits(track: track), action: openArtists)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PlaybackCreditsSheet: View {
    let credits: PlaybackCredits
    let selectArtist: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if credits.names.isEmpty {
                    Text(credits.rawText).font(.body).foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                        .listRowBackground(Theme.surface).accessibilityIdentifier("player.credits.raw")
                } else {
                    ForEach(Array(credits.names.enumerated()), id: \.element) { index, name in
                        Button { selectArtist(name) } label: {
                            HStack(spacing: 12) {
                                Text(name).font(.body).foregroundStyle(Theme.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.dim)
                                    .accessibilityHidden(true)
                            }.frame(minHeight: 44).contentShape(Rectangle())
                        }.buttonStyle(.plain).listRowBackground(Theme.surface)
                            .accessibilityIdentifier("player.credit.\(index)")
                            .accessibilityHint(L10n.text("mobile.viewArtist"))
                    }
                }
            }.scrollContentBackground(.hidden).background(Theme.background)
                .navigationTitle(L10n.text("nav.artists")).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(L10n.text("common.done")) { dismiss() }.accessibilityIdentifier("player.credits.done")
                    }
                }
        }.presentationDetents([.medium, .large]).presentationDragIndicator(.visible).tint(Theme.accent)
    }
}
