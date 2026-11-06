import SwiftUI

struct TracksScreen: View {
    let model: AppModel
    var initialQuery = ""
    @State private var query = ""
    @State private var sort: TrackSort = .title
    @State private var listing = TrackListing()
    @State private var filters = AlbumFilters()
    @State private var filtering = false

    private var shown: [Track] { listing.result.tracks }
    private var request: TrackListingRequest {
        TrackListingRequest(revision: model.catalog.revision, query: query, filters: filters, sort: sort)
    }

    init(model: AppModel, initialQuery: String = "") {
        self.model = model
        self.initialQuery = initialQuery
        _query = State(initialValue: initialQuery)
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                if let error = model.catalog.error {
                    CatalogProblem(message: error) { Task { await model.catalog.ensureTracks(force: true) } }
                }
                if !shown.isEmpty {
                    PlayAllRow(player: model.player, identifier: "tracks") { model.player.play(shown) }
                    Text(L10n.count("count.tracks", shown.count)).font(Theme.body(13).monospacedDigit())
                        .foregroundStyle(Theme.dim).listRowBackground(Theme.background)
                        .accessibilityIdentifier("tracks.count")
                }
                ForEach(shown) { track in
                    CatalogTrackRow(track: track, model: model) {
                        if let index = listing.result.positions[track.id] { model.player.play(shown, index: index) }
                    }
                        .listRowBackground(Theme.background)
                }
            }.listStyle(.plain).scrollContentBackground(.hidden).background(Theme.background)
                .refreshable { await model.catalog.ensureTracks(force: true) }
                .overlay {
                    if (model.catalog.loadingTracks || listing.loading || !listing.ready) && shown.isEmpty { ProgressView() }
                    else if model.catalog.tracksLoaded && shown.isEmpty {
                        if query.isEmpty { ContentUnavailableView(L10n.text("empty.noMatch"), systemImage: "music.note.list") }
                        else { ContentUnavailableView.search(text: query) }
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        if let current = model.player.current, listing.result.positions[current.id] != nil {
                            Button { withAnimation { proxy.scrollTo(current.id, anchor: .center) } } label: { Image(systemName: "scope") }
                                .accessibilityLabel(L10n.text("common.locate"))
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { filtering = true } label: {
                            Image(systemName: filters.isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                        }.tint(filters.isActive ? Theme.accent : Theme.dim)
                            .accessibilityLabel(L10n.text("mobile.filters"))
                            .accessibilityValue(String(filters.count)).accessibilityIdentifier("tracks.filters")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Picker(L10n.text("mobile.sort"), selection: $sort) {
                                ForEach(TrackSort.allCases, id: \.self) { Text(L10n.text($0.label)).tag($0) }
                            }
                        } label: { Image(systemName: "arrow.up.arrow.down") }
                    }
                }
        }
        .navigationTitle(L10n.text("nav.tracks"))
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L10n.text("mobile.searchTracks"))
        .sheet(isPresented: $filtering) {
            AlbumFilterSheet(albums: model.catalog.index.albums, genres: model.catalog.index.genres,
                             filters: $filters, trackOptions: model.catalog.index.tracks)
        }
        .task(id: request) { await listing.update(index: model.catalog.index, request: request) }
        .task { await model.catalog.ensureTracks(force: true) }
    }
}
