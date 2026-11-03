import SwiftUI

struct CatalogTrackRow: View {
    let track: Track
    let model: AppModel
    var showCover = true
    // When set, the row shows a track number instead of a cover.
    var number: Int?
    // Album pages hide the credit line when it repeats the album artist.
    var hideArtist = false
    var identifier: String?
    let play: () -> Void

    private var isCurrent: Bool { model.player.current?.id == track.id }

    var body: some View {
        Button(action: play) {
            HStack(spacing: 12) {
                if let number {
                    Group {
                        if isCurrent { Image(systemName: "waveform").foregroundStyle(Theme.accent) }
                        else { Text(String(number)).foregroundStyle(.secondary) }
                    }.font(.subheadline.monospacedDigit()).frame(width: 26)
                } else if showCover {
                    Cover(albumID: track.albumId ?? "", size: 160, client: model.imageClient)
                        .frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 6))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(track.title).font(.body).foregroundStyle(isCurrent ? Theme.accent : Theme.ink)
                        .lineLimit(2).multilineTextAlignment(.leading)
                    if !hideArtist {
                        Text(track.artist ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
                if model.favorites.contains(.track, id: track.id) {
                    Image(systemName: "heart.fill").font(.caption).foregroundStyle(Theme.accent)
                        .accessibilityLabel(L10n.text("common.faved"))
                }
                Text(timestamp(track.duration ?? 0)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }.padding(.vertical, 4).frame(minHeight: hideArtist ? 44 : 52).contentShape(Rectangle())
        }.buttonStyle(.plain)
            .accessibilityIdentifier(identifier ?? "track.\(track.id)")
            .contextMenu { TrackActions(track: track, model: model, play: play) }
            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                Button { model.player.enqueue([track], next: true) } label: {
                    Label(L10n.text("mobile.playNext"), systemImage: "text.line.first.and.arrowtriangle.forward")
                }.tint(Theme.accent)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button { model.player.enqueue([track], next: false) } label: {
                    Label(L10n.text("mobile.addToQueue"), systemImage: "text.badge.plus")
                }
            }
    }
}

struct TrackActions: View {
    let track: Track
    let model: AppModel
    var play: (() -> Void)?
    var body: some View {
        if let play { Button(L10n.text("common.play"), systemImage: "play", action: play) }
        Button(L10n.text("mobile.playNext"), systemImage: "text.line.first.and.arrowtriangle.forward") {
            model.player.enqueue([track], next: true)
        }
        Button(L10n.text("mobile.addToQueue"), systemImage: "text.badge.plus") {
            model.player.enqueue([track], next: false)
        }
        if model.sessionStore.isAdmin {
            let faved = model.favorites.contains(.track, id: track.id)
            Button(L10n.text(faved ? "common.unfav" : "common.fav"), systemImage: faved ? "heart.slash" : "heart") {
                Task { await model.favorites.toggle(.track, id: track.id) }
            }
        }
        Section {
            if let album = track.albumId {
                Button(L10n.text("player.viewAlbum"), systemImage: "square.stack") { model.pendingRoute = .album(album) }
            }
            ForEach(track.credits.filter { !$0.name.isEmpty }, id: \.name) { credit in
                Button(credit.name, systemImage: "person") { model.pendingRoute = .artist(credit.name) }
            }
        }
    }
}

struct CatalogProblem: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(message, systemImage: "exclamationmark.circle").font(.subheadline)
            Button(L10n.text("common.retry"), action: retry)
        }.padding().frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SectionHeading: View {
    let title: String
    var count: Int?
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(Theme.title(22, relativeTo: .title2)).foregroundStyle(Theme.ink)
            Spacer()
            if let count { Text(String(count)).font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
        }.accessibilityAddTraits(.isHeader)
    }
}
