import SwiftUI

// One search across artists, albums and tracks, using the precomputed index
// (aliases, romaji, kana and Han variants) shared with the other tabs.
struct SearchScreen: View {
    let model: AppModel
    @State private var query = ""
    @State private var listing = SearchListing()

    private var request: SearchListingRequest {
        SearchListingRequest(revision: model.catalog.revision, query: query)
    }
    private var trimmed: String { request.query }
    private var canDisplayResult: Bool {
        guard let completed = listing.completed else { return false }
        // Keep existing hits during typing without exposing a retired catalog
        // or showing search hits as the empty-query recent-album section.
        return completed.revision == request.revision && completed.query.isEmpty == trimmed.isEmpty
    }
    private var searchPlacement: SearchFieldPlacement {
        // A toolbar placement on iPad creates a second search button inside
        // the search tab. Keep the field visible immediately on that device.
        UIDevice.current.userInterfaceIdiom == .pad
            ? .navigationBarDrawer(displayMode: .always) : .automatic
    }

    var body: some View {
        List {
            if canDisplayResult {
                if trimmed.isEmpty { recent } else { results }
            }
        }
        .listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Theme.background)
        .navigationTitle(L10n.text("common.search"))
        .navigationBarTitleDisplayMode(.inline)
        // One global search field belongs to the dedicated search tab.
        .searchable(text: $query, placement: searchPlacement, prompt: L10n.text("search.placeholder"))
        .overlay {
            if !canDisplayResult {
                ProgressView()
            } else if listing.matches(request) && !trimmed.isEmpty && listing.result.isEmpty
                && (model.catalog.tracksLoaded || !model.catalog.loadingTracks) {
                ContentUnavailableView.search(text: trimmed)
            }
        }
        .task { await model.catalog.ensureTracks() }
        .task(id: request) { await listing.update(index: model.catalog.index, request: request) }
    }

    @ViewBuilder
    private var recent: some View {
        let latest = listing.result.recentAlbums
        if !latest.isEmpty {
            Section(L10n.text("library.sortAdded")) {
                ForEach(latest) { album in
                    NavigationLink(value: CatalogRoute.album(album.id)) { AlbumRow(album: album, model: model) }
                        .listRowBackground(Theme.surface)
                        .accessibilityIdentifier("search.album.\(album.id)")
                }
            }
        }
    }

    @ViewBuilder
    private var results: some View {
        let result = listing.result
        let displayedQuery = listing.completed?.query ?? trimmed
        if !result.artists.isEmpty {
            Section {
                ForEach(result.artists) { summary in
                    NavigationLink(value: CatalogRoute.artist(summary.artist.name)) {
                        HStack(spacing: 12) {
                            ArtistAvatar(artist: summary.artist, model: model, size: 40)
                            Text(summary.artist.name).foregroundStyle(Theme.ink)
                        }
                    }.listRowBackground(Theme.surface).accessibilityIdentifier("search.artist.\(summary.artist.name)")
                }
            } header: { header("nav.artists", count: result.artistCount) }
        }
        if !result.albums.isEmpty {
            Section {
                ForEach(result.albums) { album in
                    NavigationLink(value: CatalogRoute.album(album.id)) { AlbumRow(album: album, model: model) }
                        .listRowBackground(Theme.surface)
                        .accessibilityIdentifier("search.album.\(album.id)")
                }
                if result.albumCount > result.albums.count {
                    NavigationLink(L10n.text("mobile.allResults"), value: CatalogRoute.albumSearch(displayedQuery)).listRowBackground(Theme.surface)
                }
            } header: { header("nav.library", count: result.albumCount) }
        }
        if !result.tracks.isEmpty {
            Section {
                let shown = result.tracks
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, track in
                    CatalogTrackRow(track: track, model: model) { model.player.play(shown, index: index) }
                        .listRowBackground(Theme.surface)
                }
                if result.trackCount > result.tracks.count {
                    NavigationLink(L10n.text("mobile.allResults"), value: CatalogRoute.trackSearch(displayedQuery)).listRowBackground(Theme.surface)
                }
            } header: { header("nav.tracks", count: result.trackCount) }
        }
    }

    private func header(_ key: String, count: Int) -> some View {
        HStack { Text(L10n.text(key)); Spacer(); Text(String(count)).monospacedDigit() }
    }
}
