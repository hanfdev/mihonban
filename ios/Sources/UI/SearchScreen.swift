import SwiftUI

// One search across artists, albums and tracks, using the precomputed index
// (aliases, romaji, kana and Han variants) shared with the other tabs.
struct SearchScreen: View {
    let model: AppModel
    @State private var query = ""
    @State private var artists: [ArtistSummary] = []
    @State private var albums: [Album] = []
    @State private var tracks: [Track] = []
    private let limit = 8

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        List {
            if trimmed.isEmpty { recent } else { results }
        }
        .listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Theme.background)
        .navigationTitle(L10n.text("common.search"))
        .navigationBarTitleDisplayMode(.inline)
        // One global search field belongs to the dedicated search tab.
        .searchable(text: $query, prompt: L10n.text("search.placeholder"))
        .overlay {
            if !trimmed.isEmpty && artists.isEmpty && albums.isEmpty && tracks.isEmpty
                && (model.catalog.tracksLoaded || !model.catalog.loadingTracks) {
                ContentUnavailableView.search(text: trimmed)
            }
        }
        .task { await model.catalog.ensureTracks() }
        .task(id: trimmed) {
            // Debounce typing so large catalogs are filtered once per pause.
            try? await Task.sleep(for: .milliseconds(150))
            if !Task.isCancelled { update() }
        }
        .onChange(of: model.catalog.revision) { _, _ in update() }
    }

    @ViewBuilder
    private var recent: some View {
        let latest = model.catalog.index.albums(query: "", sort: .added).prefix(12)
        if !latest.isEmpty {
            Section(L10n.text("library.sortAdded")) {
                ForEach(Array(latest)) { album in
                    NavigationLink(value: CatalogRoute.album(album.id)) { AlbumRow(album: album, model: model) }
                        .listRowBackground(Theme.surface)
                        .accessibilityIdentifier("search.album.\(album.id)")
                }
            }
        }
    }

    @ViewBuilder
    private var results: some View {
        if !artists.isEmpty {
            Section {
                ForEach(artists.prefix(limit)) { summary in
                    NavigationLink(value: CatalogRoute.artist(summary.artist.name)) {
                        HStack(spacing: 12) {
                            ArtistAvatar(artist: summary.artist, model: model, size: 40)
                            Text(summary.artist.name).foregroundStyle(Theme.ink)
                        }
                    }.listRowBackground(Theme.surface).accessibilityIdentifier("search.artist.\(summary.artist.name)")
                }
            } header: { header("nav.artists", count: artists.count) }
        }
        if !albums.isEmpty {
            Section {
                ForEach(albums.prefix(limit)) { album in
                    NavigationLink(value: CatalogRoute.album(album.id)) { AlbumRow(album: album, model: model) }
                        .listRowBackground(Theme.surface)
                        .accessibilityIdentifier("search.album.\(album.id)")
                }
                if albums.count > limit {
                    NavigationLink(L10n.text("mobile.allResults"), value: CatalogRoute.albumSearch(trimmed)).listRowBackground(Theme.surface)
                }
            } header: { header("nav.library", count: albums.count) }
        }
        if !tracks.isEmpty {
            Section {
                let shown = Array(tracks.prefix(limit))
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, track in
                    CatalogTrackRow(track: track, model: model) { model.player.play(shown, index: index) }
                        .listRowBackground(Theme.surface)
                }
                if tracks.count > limit {
                    NavigationLink(L10n.text("mobile.allResults"), value: CatalogRoute.trackSearch(trimmed)).listRowBackground(Theme.surface)
                }
            } header: { header("nav.tracks", count: tracks.count) }
        }
    }

    private func header(_ key: String, count: Int) -> some View {
        HStack { Text(L10n.text(key)); Spacer(); Text(String(count)).monospacedDigit() }
    }

    private func update() {
        let needle = trimmed
        guard !needle.isEmpty else { artists = []; albums = []; tracks = []; return }
        let index = model.catalog.index
        artists = index.artists(query: needle, sort: .count)
        albums = index.albums(query: needle, sort: .rating)
        tracks = index.tracks(query: needle, sort: .title)
    }
}
