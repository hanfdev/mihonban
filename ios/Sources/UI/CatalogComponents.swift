import SwiftUI

enum CatalogLayout {
    // Two columns on phones, more on wider iPad layouts, without a GeometryReader.
    static var grid: [GridItem] { [GridItem(.adaptive(minimum: 150, maximum: 240), spacing: 16, alignment: .top)] }
}

struct AlbumTile: View {
    let album: Album
    let model: AppModel
    var body: some View {
        NavigationLink(value: CatalogRoute.album(album.id)) {
            VStack(alignment: .leading, spacing: 7) {
                Cover(albumID: album.id, revision: album.updatedAt, client: model.imageClient)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(alignment: .topTrailing) {
                        if model.favorites.contains(.album, id: album.id) {
                            Image(systemName: "heart.fill").font(.caption).foregroundStyle(Theme.accent)
                                .padding(7).background(.regularMaterial, in: Circle()).padding(6)
                                .accessibilityLabel(L10n.text("common.faved"))
                        }
                    }
                Text(album.title).font(Theme.title(17, relativeTo: .headline)).lineLimit(2).foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.leading)
                Text(album.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                HStack(spacing: 6) {
                    if let year = album.year, year > 0 { Text(String(year)) }
                    Spacer(minLength: 0)
                    if album.hidden == true {
                        Image(systemName: "eye.slash").accessibilityLabel(L10n.text("albumPage.hiddenBadge"))
                    }
                    if let rating = album.rym?.validRating {
                        Label(String(format: "%.2f", rating), systemImage: "star.fill").labelStyle(.titleAndIcon)
                    }
                }.font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier("album.\(album.id)")
            .contextMenu { AlbumActions(album: album, model: model) }
    }
}

// Context-menu content cannot push onto a stack itself, so links go through
// the shell, which owns the navigation paths.
struct AlbumActions: View {
    let album: Album
    let model: AppModel
    var body: some View {
        Button(L10n.text("common.playAll"), systemImage: "play") { Task { await model.playAlbum(album.id) } }
        Button(L10n.text("common.shuffle"), systemImage: "shuffle") { Task { await model.playAlbum(album.id, shuffle: true) } }
        Button(L10n.text("mobile.playNext"), systemImage: "text.line.first.and.arrowtriangle.forward") {
            Task { await model.enqueueAlbum(album.id, next: true) }
        }
        Button(L10n.text("mobile.addToQueue"), systemImage: "text.badge.plus") {
            Task { await model.enqueueAlbum(album.id, next: false) }
        }
        if model.sessionStore.isAdmin {
            let faved = model.favorites.contains(.album, id: album.id)
            Button(L10n.text(faved ? "common.unfav" : "common.fav"), systemImage: faved ? "heart.slash" : "heart") {
                Task { await model.favorites.toggle(.album, id: album.id) }
            }
        }
        Section {
            ForEach(album.credits, id: \.name) { credit in
                Button(credit.name, systemImage: "person") { model.pendingRoute = .artist(credit.name) }
            }
        }
    }
}

struct AlbumRow: View {
    let album: Album
    let model: AppModel
    var body: some View {
        HStack(spacing: 12) {
            Cover(albumID: album.id, size: 160, revision: album.updatedAt, client: model.imageClient)
                .frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 7))
            VStack(alignment: .leading, spacing: 3) {
                Text(album.title).font(.body).foregroundStyle(Theme.ink).lineLimit(2)
                Text(album.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                HStack(spacing: 8) {
                    if let year = album.year, year > 0 { Text(String(year)) }
                    if let rating = album.rym?.validRating { Label(String(format: "%.2f", rating), systemImage: "star.fill") }
                }.font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading)
        }.padding(.vertical, 2).contentShape(Rectangle())
            .accessibilityElement(children: .combine)
    }
}
