import SwiftUI

struct TracksScreen: View {
    let model: AppModel
    var initialQuery = ""
    @State private var query = ""
    @State private var sort: TrackSort = .title
    @State private var shown: [Track] = []
    @State private var filters = AlbumFilters()
    @State private var filtering = false

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
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, track in
                    CatalogTrackRow(track: track, model: model) { model.player.play(shown, index: index) }
                        .listRowBackground(Theme.background).id(track.id)
                }
            }.listStyle(.plain).scrollContentBackground(.hidden).background(Theme.background)
                .refreshable { await model.catalog.ensureTracks(force: true) }
                .overlay {
                    if model.catalog.loadingTracks && shown.isEmpty { ProgressView() }
                    else if model.catalog.tracksLoaded && shown.isEmpty {
                        if query.isEmpty { ContentUnavailableView(L10n.text("empty.noMatch"), systemImage: "music.note.list") }
                        else { ContentUnavailableView.search(text: query) }
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        if let current = model.player.current, shown.contains(where: { $0.id == current.id }) {
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
        .onChange(of: filters) { _, _ in update() }
        .onAppear { if !initialQuery.isEmpty && query.isEmpty { query = initialQuery }; update() }
        .task { await model.catalog.ensureTracks(force: true); update() }
        .onChange(of: query) { _, _ in update() }
        .onChange(of: sort) { _, _ in update() }
        .onChange(of: model.catalog.revision) { _, _ in update() }
    }
    private func update() { shown = model.catalog.index.tracks(query: query, filters: filters, sort: sort) }
}
