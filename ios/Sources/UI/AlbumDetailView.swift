import SwiftUI

struct AlbumView: View {
    let model: AppModel
    let albumID: String
    @State private var album: Album?
    @State private var error: String?
    @State private var expandedNote = false
    @State private var gallery: String?

    var body: some View {
        ScrollView {
            if let album {
                VStack(alignment: .leading, spacing: 28) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 32) {
                            cover(album).frame(width: 300)
                            header(album).frame(minWidth: 300, maxWidth: .infinity, alignment: .leading)
                        }
                        VStack(alignment: .leading, spacing: 22) {
                            cover(album).frame(maxWidth: 380).frame(maxWidth: .infinity)
                            header(album)
                        }
                    }
                    trackList(album)
                    details(album)
                }.padding(.horizontal, 20).padding(.vertical, 16).frame(maxWidth: 1000).frame(maxWidth: .infinity)
            } else if let error {
                ContentUnavailableView {
                    Label(L10n.text("common.loadFailed"), systemImage: "wifi.exclamationmark")
                } description: { Text(error) } actions: {
                    Button(L10n.text("common.retry")) { Task { await load() } }
                }
            } else { ProgressView().frame(maxWidth: .infinity).padding(80) }
        }
        .background(Theme.background).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if let album {
                    Menu { AlbumActions(album: album, model: model) } label: { Image(systemName: "ellipsis") }
                        .accessibilityLabel(L10n.text("common.more"))
                }
            }
        }
        .refreshable { await load(refresh: true) }
        .task { await load() }
        .sheet(item: Binding(get: { gallery.map(GallerySelection.init) }, set: { gallery = $0?.id })) { selection in
            GalleryViewer(images: album?.images ?? [], client: model.imageClient, selection: selection.id)
        }
    }

    private func cover(_ album: Album) -> some View {
        Cover(albumID: album.id, size: 800, revision: album.updatedAt, client: model.imageClient)
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func header(_ album: Album) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(album.title).font(Theme.title(29)).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            FlowLayout(spacing: 4) {
                ForEach(Array(album.credits.enumerated()), id: \.offset) { index, credit in
                    NavigationLink(value: CatalogRoute.artist(credit.name)) {
                        Text(credit.name + (index < album.credits.count - 1 ? " ·" : ""))
                            .font(.body).foregroundStyle(Theme.dim)
                    }.buttonStyle(.plain)
                }
            }
            HStack(spacing: 14) {
                if let year = album.year, year > 0 { Text(String(year)) }
                Text(L10n.text("count.tracks", String(album.normalizedTracks.count)))
                if let duration = album.duration, duration > 0 { Text(timestamp(duration)) }
                if album.hidden == true { Label(L10n.text("albumPage.hiddenBadge"), systemImage: "eye.slash") }
            }.font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
            if let rym = album.rym, let rating = rym.validRating { ratingRow(rym, rating: rating) }
            HStack(spacing: 18) {
                Button { model.player.play(album.normalizedTracks) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "play.fill").font(.system(size: 18)).foregroundStyle(Theme.ink)
                            .frame(width: 48, height: 48).background(Theme.accent, in: Circle())
                        Text(L10n.text("common.playAll")).font(.body.weight(.semibold))
                    }
                }.buttonStyle(.plain).accessibilityIdentifier("album.play")
                Spacer()
                Button { model.player.play(album.normalizedTracks, shuffle: true) } label: {
                    Label(L10n.text("common.shuffle"), systemImage: "shuffle").frame(minHeight: 48)
                }.buttonStyle(.plain).foregroundStyle(Theme.dim)
                if model.sessionStore.isAdmin {
                    let faved = model.favorites.contains(.album, id: album.id)
                    Button { Task { await model.favorites.toggle(.album, id: album.id) } } label: {
                        Image(systemName: faved ? "heart.fill" : "heart").font(.title3)
                            .foregroundStyle(faved ? Theme.accent : Theme.dim).frame(width: 44, height: 44)
                    }.buttonStyle(.plain).accessibilityLabel(L10n.text(faved ? "common.unfav" : "common.fav"))
                        .accessibilityIdentifier("album.favorite")
                }
            }.padding(.top, 8).disabled(album.normalizedTracks.isEmpty)
        }
    }

    private func ratingRow(_ rym: RymRating, rating: Double) -> some View {
        HStack(spacing: 10) {
            Label(String(format: "%.2f", rating), systemImage: "star.fill").foregroundStyle(Theme.ink)
            if let votes = rym.votes, votes > 0 { Text(L10n.text("rym.votes", String(votes))) }
            if let rank = rym.rank?.nonEmpty { Text(rank).lineLimit(1) }
            if let link = rym.rymUrl.flatMap({ URL(string: $0) }), link.scheme == "https" {
                Link(destination: link) { Image(systemName: "arrow.up.right.square") }
                    .accessibilityLabel(L10n.text("rym.page"))
            }
        }.font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
    }

    private func trackList(_ album: Album) -> some View {
        let tracks = album.normalizedTracks
        let multiDisc = Set(tracks.map { $0.disc ?? 1 }).count > 1
        return LazyVStack(spacing: 0) {
            ForEach(Array(tracks.enumerated()), id: \.element.id) { index, track in
                if multiDisc && (index == 0 || track.disc != tracks[index - 1].disc) {
                    Text(L10n.text("common.disc", String(track.disc ?? 1)))
                        .font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, index == 0 ? 0 : 18).padding(.bottom, 6)
                }
                CatalogTrackRow(track: track, model: model, number: track.track ?? index + 1,
                                hideArtist: track.artist == album.artist, identifier: "track.\(index)") {
                    model.player.play(tracks, index: index)
                }
                Divider().overlay(Theme.line)
            }
        }
    }

    @ViewBuilder
    private func details(_ album: Album) -> some View {
        let primary = album.genres ?? album.rym?.genres ?? []
        let secondary = album.secondaryGenres ?? album.rym?.secondaryGenres ?? []
        let descriptors = album.rym?.descriptors ?? []
        if !primary.isEmpty || !secondary.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeading(title: L10n.text("common.genres"))
                FlowLayout {
                    ForEach(primary, id: \.self) { genre in
                        NavigationLink(value: CatalogRoute.genre(genre)) { Chip(text: genre, prominent: true) }.buttonStyle(.plain)
                    }
                    ForEach(secondary, id: \.self) { genre in
                        NavigationLink(value: CatalogRoute.genre(genre)) { Chip(text: genre) }.buttonStyle(.plain)
                    }
                }
            }
        }
        if !descriptors.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeading(title: L10n.text("common.descriptors"))
                FlowLayout { ForEach(descriptors, id: \.self) { Chip(text: $0) } }
            }
        }
        if let note = album.note?.nonEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeading(title: L10n.text("albumPage.note"))
                MarkdownText(source: note).lineLimit(expandedNote ? nil : 6)
                Button(L10n.text(expandedNote ? "md.collapse" : "md.expand")) { expandedNote.toggle() }
            }
        }
        if let images = album.images, !images.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeading(title: L10n.text("albumPage.gallery"), count: images.count)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 10) {
                        ForEach(images, id: \.self) { id in
                            Button { gallery = id } label: {
                                RemoteArtwork(url: model.imageClient?.imageURL(id, size: 400), client: model.imageClient, pixels: 400)
                                    .frame(width: 120, height: 120).clipShape(RoundedRectangle(cornerRadius: 8))
                            }.buttonStyle(.plain).accessibilityLabel(L10n.text("common.zoom"))
                                .accessibilityIdentifier("gallery.\(id)")
                        }
                    }
                }
            }
        }
        formatSummary(album)
        if let similar = album.similar, !similar.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeading(title: L10n.text("albumPage.similar"))
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 14) {
                        ForEach(similar) { item in
                            NavigationLink(value: CatalogRoute.album(item.id)) {
                                VStack(alignment: .leading, spacing: 5) {
                                    Cover(albumID: item.id, size: 480, client: model.imageClient)
                                        .frame(width: 136).clipShape(RoundedRectangle(cornerRadius: 8))
                                    Text(item.title).font(.subheadline).foregroundStyle(Theme.ink).lineLimit(2)
                                    Text(item.artist ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }.frame(width: 136, alignment: .leading)
                            }.buttonStyle(.plain).accessibilityIdentifier("similar.\(item.id)")
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func formatSummary(_ album: Album) -> some View {
        let tracks = album.normalizedTracks
        let formats = Array(Set(tracks.compactMap { $0.format?.uppercased().nonEmpty })).sorted()
        let bytes = tracks.compactMap(\.size).reduce(0, +)
        if !formats.isEmpty || bytes > 0 {
            HStack(spacing: 10) {
                if !formats.isEmpty { Text(formats.joined(separator: " · ")) }
                if bytes > 0 { Text(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)) }
            }.font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
        }
    }

    private func load(refresh: Bool = false) async {
        error = nil
        do { album = try await model.catalog.album(albumID, refresh: refresh) }
        catch is CancellationError { return }
        catch { if album == nil { self.error = error.localizedDescription } }
    }
}

private struct GallerySelection: Identifiable { let id: String }
