import SwiftUI

struct AlbumView: View {
    let model: AppModel
    let albumID: String
    @State private var album: Album?
    @State private var error: String?
    @State private var expandedNote = false
    @State private var expandedDescriptors = false
    @State private var gallery: String?
    @State private var editing = false
    @State private var confirmDelete = false
    @State private var working = false
    // Failures only; a successful write shows itself in the page.
    @State private var notice: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            if let album {
                VStack(alignment: .leading, spacing: 28) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 32) {
                            cover(album).frame(width: 300)
                            header(album, centered: false).frame(minWidth: 300, maxWidth: .infinity, alignment: .leading)
                        }
                        // On a phone the cover takes about two thirds of the width,
                        // leaving the title and controls in view without scrolling.
                        VStack(spacing: 20) {
                            cover(album).frame(maxWidth: 270).padding(.horizontal, 36).frame(maxWidth: .infinity)
                            header(album, centered: true)
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
            // Picks move to the bar so the play row stays symmetric.
            ToolbarItem(placement: .topBarTrailing) {
                if let album, model.sessionStore.isAdmin { favoriteButton(album) }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if let album {
                    Menu {
                        AlbumActions(album: album, model: model)
                        if model.sessionStore.isAdmin && !model.demo { adminActions(album) }
                    } label: { Image(systemName: "ellipsis") }
                        .accessibilityLabel(L10n.text("mobile.moreActions")).accessibilityIdentifier("album.menu")
                        .disabled(working)
                }
            }
        }
        .refreshable { await load(refresh: true) }
        .task(id: albumID) { await load() }
        .onChange(of: albumID) { _, _ in expandedDescriptors = false }
        .sheet(item: Binding(get: { gallery.map(GallerySelection.init) }, set: { gallery = $0?.id })) { selection in
            GalleryViewer(images: album?.images ?? [], client: model.imageClient, selection: selection.id)
        }
        .sheet(isPresented: $editing) {
            if let album {
                AlbumEditView(model: model, album: album) { Task { await load() } }
            }
        }
        .confirmationDialog(L10n.text("albumPage.deleteTitle"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(L10n.text("albumPage.deleteKeep"), role: .destructive) { Task { await delete(files: false) } }
            Button(L10n.text("albumPage.deleteFiles"), role: .destructive) { Task { await delete(files: true) } }
            Button(L10n.text("common.cancel"), role: .cancel) {}
        } message: { Text(L10n.text("albumPage.deleteBody")) }
        .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button(L10n.text("common.done"), role: .cancel) {}
        }
    }

    @ViewBuilder
    private func adminActions(_ album: Album) -> some View {
        Section(L10n.text("mobile.manage")) {
            Button(L10n.text("albumPage.edit"), systemImage: "pencil") { editing = true }
            Button(L10n.text(album.hidden == true ? "albumPage.unhide" : "albumPage.hide"),
                   systemImage: album.hidden == true ? "eye" : "eye.slash") { Task { await toggleHidden(album) } }
            Button(L10n.text("common.delete"), systemImage: "trash", role: .destructive) { confirmDelete = true }
        }
    }

    private func toggleHidden(_ album: Album) async {
        guard !working else { return }
        working = true
        defer { working = false }
        let next = album.hidden != true
        do {
            try await model.catalog.setHidden(album.id, hidden: next)
            // Without Show Hidden the album leaves the library, so its page closes too.
            if next && !model.catalog.showHidden { dismiss(); return }
            self.album = try await model.catalog.album(album.id, refresh: true)
        } catch is CancellationError {
        } catch {
            notice = L10n.text("albumPage.hideFail", error.localizedDescription)
        }
    }

    // Deletion is irreversible, so a second request is never sent while one is running.
    private func delete(files: Bool) async {
        guard !working, let album else { return }
        working = true
        defer { working = false }
        do {
            try await model.deleteAlbum(album.id, files: files)
            dismiss()
        } catch is CancellationError {
        } catch {
            notice = L10n.text("albumPage.deleteFail", error.localizedDescription)
        }
    }

    private func cover(_ album: Album) -> some View {
        Cover(albumID: album.id, size: 800, revision: album.updatedAt, client: model.imageClient)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .accessibilityElement(children: .ignore).accessibilityLabel(album.title)
            .accessibilityAddTraits(.isImage).accessibilityIdentifier("album.cover")
    }

    private func header(_ album: Album, centered: Bool) -> some View {
        VStack(alignment: centered ? .center : .leading, spacing: 10) {
            Text(album.title).font(Theme.title(centered ? 26 : 29)).fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(centered ? .center : .leading)
                .accessibilityAddTraits(.isHeader).accessibilityIdentifier("album.title")
            FlowLayout(spacing: 4, centered: centered) {
                ForEach(Array(album.credits.enumerated()), id: \.offset) { index, credit in
                    NavigationLink(value: CatalogRoute.artist(credit.name)) {
                        Text(credit.name + (index < album.credits.count - 1 ? " ·" : ""))
                            .font(.body).foregroundStyle(Theme.dim)
                    }.buttonStyle(.plain)
                }
            }
            HStack(spacing: 14) {
                if let year = album.year, year > 0 { Text(String(year)) }
                Text(L10n.count("count.tracks", album.normalizedTracks.count))
                if let duration = album.duration, duration > 0 { Text(timestamp(duration)) }
                if album.hidden == true { Label(L10n.text("albumPage.hiddenBadge"), systemImage: "eye.slash") }
            }.font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
            if let rym = album.rym, let rating = rym.validRating { ratingRow(rym, rating: rating) }
            controls(album).padding(.top, 6).frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
        }
    }

    // Shuffle, Play all, Download: icons only and symmetric about the play
    // button. Shuffle is a mode; Play all applies it.
    private func controls(_ album: Album) -> some View {
        HStack(spacing: 28) {
            ShuffleToggle(player: model.player, identifier: "album.shuffle")
            Button { model.player.play(album.normalizedTracks) } label: {
                Image(systemName: "play.fill").font(.system(size: 22, weight: .semibold)).foregroundStyle(Theme.ink)
                    .frame(width: 60, height: 60).background(Theme.accent, in: Circle())
                    .contentShape(Circle())
            }.buttonStyle(.plain).accessibilityLabel(L10n.text("common.playAll")).accessibilityIdentifier("album.play")
            // An empty slot keeps the play button centred where downloads are unavailable.
            if let downloads = model.downloads { AlbumDownloadButton(album: album, downloads: downloads) }
            else { Color.clear.frame(width: 44, height: 44).accessibilityHidden(true) }
        }.disabled(album.normalizedTracks.isEmpty)
    }

    @ViewBuilder
    private func favoriteButton(_ album: Album) -> some View {
        let faved = model.favorites.contains(.album, id: album.id)
        Button { Task { await model.favorites.toggle(.album, id: album.id) } } label: {
            Image(systemName: faved ? "heart.fill" : "heart").foregroundStyle(faved ? Theme.accent : Theme.ink)
        }.accessibilityLabel(L10n.text(faved ? "common.unfav" : "common.fav"))
            .accessibilityIdentifier("album.favorite")
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
            AlbumDescriptors(descriptors: descriptors, isExpanded: $expandedDescriptors)
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
