import SwiftUI

struct AlbumsScreen: View {
    let model: AppModel
    var initialGenre = ""
    var initialQuery = ""
    @State private var query = ""
    @State private var filters = AlbumFilters()
    @State private var sort: AlbumSort = .rating
    @State private var filtering = false
    @State private var shown: [Album] = []

    var body: some View {
        ScrollView {
            if let error = model.catalog.error {
                CatalogProblem(message: error) { Task { await model.catalog.refresh() } }
            }
            if !shown.isEmpty {
                Text(L10n.text("count.albums", String(shown.count))).font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20).padding(.top, 4)
            }
            LazyVGrid(columns: CatalogLayout.grid, alignment: .leading, spacing: 26) {
                ForEach(shown) { AlbumTile(album: $0, model: model) }
            }.padding(.horizontal, 20).padding(.vertical, 12)
        }.refreshable { await model.catalog.refresh() }
            .background(Theme.background)
            .overlay {
                if model.catalog.loading && shown.isEmpty { ProgressView() }
                else if shown.isEmpty && !model.catalog.loading {
                    if query.isEmpty { ContentUnavailableView(L10n.text("empty.noMatch"), systemImage: "square.stack") }
                    else { ContentUnavailableView.search(text: query) }
                }
            }
        .navigationTitle(initialGenre.isEmpty ? L10n.text("nav.library") : initialGenre)
        .searchable(text: $query, prompt: L10n.text("mobile.searchAlbums"))
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { filtering = true } label: {
                    Label(L10n.text("mobile.filters"), systemImage: filters.isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }.tint(filters.isActive ? Theme.accent : Theme.dim)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker(L10n.text("mobile.sort"), selection: $sort) {
                        ForEach(AlbumSort.allCases, id: \.self) { Text(L10n.text($0.label)).tag($0) }
                    }
                    if model.sessionStore.canSeeHidden {
                        Toggle(L10n.text("library.showHidden"), isOn: Binding(get: { model.catalog.showHidden }, set: { value in
                            Task { await model.catalog.setShowHidden(value) }
                        }))
                    }
                } label: { Image(systemName: "arrow.up.arrow.down") }
                .accessibilityLabel(L10n.text("mobile.sort"))
            }
        }
        .sheet(isPresented: $filtering) { AlbumFilterSheet(albums: model.catalog.index.albums, filters: $filters) }
        .onAppear {
            if !initialGenre.isEmpty && filters.genre.isEmpty { filters.genre = initialGenre }
            if !initialQuery.isEmpty && query.isEmpty { query = initialQuery }
            update()
        }
        .onChange(of: query) { _, _ in update() }
        .onChange(of: sort) { _, _ in update() }
        .onChange(of: filters) { _, _ in update() }
        .onChange(of: model.catalog.revision) { _, _ in update() }
    }

    private func update() { shown = model.catalog.index.albums(query: query, filters: filters, sort: sort) }
}

private struct AlbumFilterSheet: View {
    let albums: [Album]
    @Binding var filters: AlbumFilters
    @Environment(\.dismiss) private var dismiss
    private var genres: [String] { Array(Set(albums.flatMap { ($0.genres ?? []) + ($0.secondaryGenres ?? []) })).sorted() }
    private var decades: [Int] { Array(Set(albums.compactMap(\.year).filter { $0 > 0 }.map { $0 / 10 * 10 })).sorted() }
    private var artists: [String] { Array(Set(albums.flatMap { $0.credits.map(\.name) })).sorted() }

    var body: some View {
        NavigationStack {
            Form {
                Picker(L10n.text("library.filterRating"), selection: $filters.minimumRating) {
                    Text(L10n.text("library.anyRating")).tag(0.0)
                    ForEach([2.5, 3, 3.2, 3.4, 3.5, 3.6, 3.8, 4, 4.2], id: \.self) {
                        Text(String(format: "%.1f+", $0)).tag($0)
                    }
                }
                Picker(L10n.text("library.filterGenre"), selection: $filters.genre) {
                    Text(L10n.text("library.anyGenre")).tag("")
                    ForEach(genres, id: \.self) { Text($0).tag($0) }
                }
                Picker(L10n.text("library.filterDecade"), selection: $filters.decade) {
                    Text(L10n.text("library.anyDecade")).tag(Int?.none)
                    ForEach(decades, id: \.self) { Text(String($0) + "s").tag(Optional($0)) }
                }
                Picker(L10n.text("library.filterArtist"), selection: $filters.artist) {
                    Text(L10n.text("library.anyArtist")).tag("")
                    ForEach(artists, id: \.self) { Text($0).tag($0) }
                }
                Button(L10n.text("common.clearFilters")) { filters = .init() }
            }.navigationTitle(L10n.text("mobile.filters")).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L10n.text("common.done")) { dismiss() } } }
        }.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }
}
