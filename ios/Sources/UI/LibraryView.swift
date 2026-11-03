import SwiftUI

struct LibraryView: View {
    @Bindable var model: AppModel
    var body: some View {
        GeometryReader { geometry in
            let columns = geometry.size.width < 600 ? 2 : max(3, Int(geometry.size.width / 210))
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(L10n.text("nav.library")).font(Theme.title(32))
                        Spacer()
                        Text(L10n.text("count.albums", String(model.visibleAlbums.count)))
                            .font(Theme.body(12)).foregroundStyle(Theme.faint)
                    }
                    if let error = model.error {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(error).font(Theme.body(14)).foregroundStyle(Theme.dim)
                            Button(L10n.text("common.retry")) { Task { await model.refresh() } }
                        }
                    }
                    if model.visibleAlbums.isEmpty {
                        ContentUnavailableView(L10n.text("common.empty"), systemImage: "square.stack")
                    } else {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16, alignment: .top), count: columns),
                                  alignment: .leading, spacing: 28) {
                            ForEach(model.visibleAlbums) { album in
                                NavigationLink(value: album.id) {
                                    VStack(alignment: .leading, spacing: 8) {
                                        Cover(albumID: album.id, revision: album.updatedAt, client: model.demo ? nil : model.client)
                                            .clipShape(RoundedRectangle(cornerRadius: 10))
                                        Text(album.title).font(Theme.title(17, relativeTo: .headline)).lineLimit(2)
                                            .foregroundStyle(Theme.ink)
                                        Text(album.artist).font(Theme.body(12)).foregroundStyle(Theme.dim).lineLimit(1)
                                    }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                                }.buttonStyle(.plain).accessibilityIdentifier("album.\(album.id)")
                            }
                        }
                    }
                }.padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 28)
            }
            .background(Theme.background)
            .refreshable { await model.refresh() }
            .searchable(text: $model.query, prompt: L10n.text("mobile.searchAlbums"))
            .navigationTitle("見本盤").navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { id in AlbumView(model: model, albumID: id) }
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }
}

struct AlbumView: View {
    let model: AppModel
    let albumID: String
    @State private var album: Album?
    @State private var error: String?
    @State private var expandedNote = false

    var body: some View {
        ScrollView {
            if let album {
                VStack(alignment: .leading, spacing: 24) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 32) {
                            Cover(albumID: album.id, size: 800, revision: album.updatedAt, client: model.demo ? nil : model.client)
                                .frame(width: 300).clipShape(RoundedRectangle(cornerRadius: 10))
                            header(album).frame(minWidth: 300, maxWidth: .infinity, alignment: .leading)
                        }
                        VStack(alignment: .leading, spacing: 24) {
                            Cover(albumID: album.id, size: 800, revision: album.updatedAt, client: model.demo ? nil : model.client)
                                .frame(maxWidth: 380).clipShape(RoundedRectangle(cornerRadius: 10))
                                .frame(maxWidth: .infinity)
                            header(album)
                        }
                    }
                    let tracks = album.normalizedTracks
                    LazyVStack(spacing: 0) {
                        ForEach(Array(tracks.enumerated()), id: \.element.id) { index, track in
                            if track.disc != (index > 0 ? tracks[index - 1].disc : tracks.first?.disc) {
                                Text(L10n.text("common.disc", String(track.disc ?? 1)))
                                    .font(Theme.body(12)).foregroundStyle(Theme.faint)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 16)
                            }
                            Button { model.player.play(tracks, index: index) } label: {
                                HStack(spacing: 14) {
                                    if model.player.current?.id == track.id {
                                        Image(systemName: "waveform").foregroundStyle(Theme.accent).frame(width: 24)
                                    } else {
                                        Text(String(track.track ?? index + 1)).font(Theme.body(13)).monospacedDigit()
                                            .foregroundStyle(Theme.faint).frame(width: 24)
                                    }
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(track.title).font(Theme.body(15)).foregroundStyle(model.player.current?.id == track.id ? Theme.accent : Theme.ink)
                                            .multilineTextAlignment(.leading)
                                        if let artist = track.artist, artist != album.artist {
                                            Text(artist).font(Theme.body(12)).foregroundStyle(Theme.dim)
                                        }
                                    }.frame(maxWidth: .infinity, alignment: .leading)
                                    Text(timestamp(track.duration ?? 0)).font(Theme.body(12)).monospacedDigit().foregroundStyle(Theme.faint)
                                }.padding(.vertical, 14).frame(minHeight: 52).contentShape(Rectangle())
                            }.buttonStyle(.plain).accessibilityIdentifier("track.\(index)")
                            Rectangle().fill(Theme.line).frame(height: 0.5)
                        }
                    }
                    if let note = album.note, !note.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(note).font(Theme.body(14)).foregroundStyle(Theme.dim).lineSpacing(5)
                                .lineLimit(expandedNote ? nil : 5)
                            Button(L10n.text(expandedNote ? "common.less" : "common.more")) { expandedNote.toggle() }
                        }
                    }
                }.padding(24).frame(maxWidth: 1000).frame(maxWidth: .infinity)
            } else if let error {
                ContentUnavailableView {
                    Label(L10n.text("common.loadFailed"), systemImage: "wifi.exclamationmark")
                } description: { Text(error) } actions: {
                    Button(L10n.text("common.retry")) { Task { await load() } }
                }
            } else { ProgressView().frame(maxWidth: .infinity).padding(80) }
        }
        .background(Theme.background).navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func header(_ album: Album) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(album.title).font(Theme.title(29)).fixedSize(horizontal: false, vertical: true)
            Text(album.artist).font(Theme.body(16)).foregroundStyle(Theme.dim)
            HStack(spacing: 16) {
                if let year = album.year, year > 0 { Text(String(year)) }
                Text(L10n.text("count.tracks", String(album.normalizedTracks.count)))
                if let duration = album.duration { Text(timestamp(duration)) }
            }.font(Theme.body(12)).foregroundStyle(Theme.faint)
            HStack(spacing: 18) {
                Button { model.player.play(album.normalizedTracks) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "play.fill").font(.system(size: 18)).foregroundStyle(Theme.ink)
                            .frame(width: 48, height: 48).background(Theme.accent, in: Circle())
                        Text(L10n.text("common.playAll")).font(Theme.body(15, weight: .semibold))
                    }
                }.buttonStyle(.plain).accessibilityIdentifier("album.play")
                Spacer()
                Button { model.player.play(album.normalizedTracks, shuffle: true) } label: {
                    Label(L10n.text("common.shuffle"), systemImage: "shuffle").font(Theme.body(14)).frame(minHeight: 48)
                }.buttonStyle(.plain).foregroundStyle(Theme.dim)
            }.padding(.top, 12).disabled(album.normalizedTracks.isEmpty)
        }
    }

    private func load() async {
        error = nil
        do { album = try await model.album(albumID) }
        catch { self.error = (error as? ClientError)?.errorDescription ?? L10n.text("mobile.connectionFailed") }
    }
}
