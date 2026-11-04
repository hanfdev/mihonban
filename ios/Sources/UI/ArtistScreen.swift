import SwiftUI

struct ArtistScreen: View {
    let model: AppModel
    let name: String
    @State private var featured: [Track] = []
    @State private var biography = ""
    @State private var readingBio = false
    @State private var error: String?

    private var artist: Artist { model.catalog.artist(name) ?? Artist(name: name) }
    private var albums: [Album] {
        model.catalog.index.albums.filter { $0.credits.contains { $0.name == name } }
            .sorted { ($0.year ?? 0, $0.title) < ($1.year ?? 0, $1.title) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header
                if let error { CatalogProblem(message: error) { Task { await load() } } }
                VStack(alignment: .leading, spacing: 14) {
                    SectionHeading(title: L10n.text("nav.library"), count: albums.count)
                    if albums.isEmpty {
                        Text(L10n.text("artistPage.emptyAlbums")).font(.callout).foregroundStyle(.secondary)
                    } else {
                        LazyVGrid(columns: CatalogLayout.grid, alignment: .leading, spacing: 24) {
                            ForEach(albums) { AlbumTile(album: $0, model: model) }
                        }
                    }
                }
                if !featured.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        SectionHeading(title: L10n.text("artistPage.featuredTracks"), count: featured.count)
                        LazyVStack(spacing: 0) {
                            ForEach(Array(featured.enumerated()), id: \.element.id) { index, track in
                                CatalogTrackRow(track: track, model: model) { model.player.play(featured, index: index) }
                                Divider().overlay(Theme.line)
                            }
                        }
                    }
                }
            }.padding(.horizontal, 20).padding(.vertical, 16).frame(maxWidth: 1000).frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle(name).navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task(id: name) { await load() }
        .sheet(isPresented: $readingBio) { BiographySheet(name: name, text: biography) }
    }

    private var header: some View {
        VStack(spacing: 14) {
            ArtistAvatar(artist: artist, model: model, size: 148)
            Text(name).font(Theme.title(28)).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
            let aliases = ([artist.sort?.nonEmpty].compactMap { $0 } + (artist.aliases ?? []))
                .filter { $0 != name }
            if !aliases.isEmpty {
                Text(aliases.joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            HStack(spacing: 18) {
                Button { Task { await model.playArtist(name) } } label: {
                    Label(L10n.text("common.playAll"), systemImage: "play.fill").font(.body.weight(.semibold))
                        .padding(.horizontal, 20).frame(minHeight: 48)
                        .background(Theme.accent, in: Capsule()).foregroundStyle(Theme.ink)
                }.buttonStyle(.plain).accessibilityIdentifier("artist.play")
                ShuffleToggle(player: model.player, identifier: "artist.shuffle")
            }.disabled(albums.isEmpty && featured.isEmpty)
            if let note = artist.note?.nonEmpty {
                MarkdownText(source: note).multilineTextAlignment(.leading).frame(maxWidth: 640, alignment: .leading)
            }
            if !biography.isEmpty {
                Button(L10n.text("artistPage.readBio")) { readingBio = true }.accessibilityIdentifier("artist.bio")
            }
        }.frame(maxWidth: .infinity)
    }

    private func load() async {
        error = nil
        do {
            featured = try await model.catalog.artistTracks(name)
            if artist.hasBio == true { biography = (try? await model.catalog.biography(name)) ?? "" }
        } catch is CancellationError {
        } catch { self.error = error.localizedDescription }
    }
}

private struct BiographySheet: View {
    let name: String
    let text: String
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView { MarkdownText(source: text).padding(20).frame(maxWidth: 680, alignment: .leading) }
                .frame(maxWidth: .infinity).background(Theme.background)
                .navigationTitle(name).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L10n.text("common.done")) { dismiss() } } }
        }.presentationDragIndicator(.visible)
    }
}
