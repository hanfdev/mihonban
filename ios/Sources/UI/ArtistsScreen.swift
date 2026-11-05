import SwiftUI

struct ArtistsScreen: View {
    let model: AppModel
    @State private var sort: ArtistSort = .count
    @State private var genre = ""
    @State private var shown: [ArtistSummary] = []

    private var genres: [GenreOption] { model.catalog.index.artistGenres }

    var body: some View {
        List {
            if let error = model.catalog.error {
                CatalogProblem(message: error) { Task { await model.catalog.refresh() } }
            }
            ForEach(shown) { summary in
                NavigationLink(value: CatalogRoute.artist(summary.artist.name)) {
                    HStack(spacing: 14) {
                        ArtistAvatar(artist: summary.artist, model: model)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(summary.artist.name).font(.body).foregroundStyle(Theme.ink).lineLimit(2)
                            Text(caption(summary)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }.padding(.vertical, 2)
                }.listRowBackground(Theme.background).accessibilityIdentifier("artist.\(summary.artist.name)")
            }
        }.listStyle(.plain).scrollContentBackground(.hidden).background(Theme.background)
            .refreshable { await model.catalog.refresh() }
            .overlay {
                if model.catalog.loading && shown.isEmpty { ProgressView() }
                else if shown.isEmpty && !model.catalog.loading {
                    ContentUnavailableView(L10n.text("artists.empty"), systemImage: "person.2")
                }
            }
            .navigationTitle(L10n.text("nav.artists"))

            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker(L10n.text("mobile.sort"), selection: $sort) {
                            ForEach(ArtistSort.allCases, id: \.self) { Text(L10n.text($0.label)).tag($0) }
                        }
                        Picker(L10n.text("artists.filterGenre"), selection: $genre) {
                            Text(L10n.text("library.anyGenre")).tag("")
                            ForEach(genres) { Text($0.title).tag($0.id) }
                        }.pickerStyle(.menu)
                    } label: {
                        Image(systemName: genre.isEmpty ? "arrow.up.arrow.down" : "line.3.horizontal.decrease.circle.fill")
                    }.accessibilityLabel(L10n.text("mobile.sort"))
                }
            }
            .onAppear(perform: update)
            .onChange(of: sort) { _, _ in update() }
            .onChange(of: genre) { _, _ in update() }
            .onChange(of: model.catalog.revision) { _, _ in update() }
    }

    private func caption(_ summary: ArtistSummary) -> String {
        var parts: [String] = []
        if summary.albumCount > 0 { parts.append(L10n.text("artists.albums", String(summary.albumCount))) }
        if summary.featuredCount > 0 { parts.append(L10n.text("artists.featuredTracks", String(summary.featuredCount))) }
        if let years = summary.years.min().map({ ($0, summary.years.max() ?? $0) }) {
            parts.append(years.0 == years.1 ? String(years.0) : "\(years.0)–\(years.1)")
        }
        return parts.joined(separator: " · ")
    }

    private func update() { shown = model.catalog.index.artists(query: "", genre: genre, sort: sort) }
}
