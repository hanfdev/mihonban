import XCTest
import SwiftUI
@testable import Mihonban

final class LibraryExperienceTests: XCTestCase {
    func testPreloadPolicyNetworkMatrix() {
        let wifi = PreloadNetwork(connected: true, wifiOrEthernet: true)
        let cellular = PreloadNetwork(connected: true, expensive: true)
        let hotspot = PreloadNetwork(connected: true, wifiOrEthernet: true, expensive: true)
        let lowData = PreloadNetwork(connected: true, wifiOrEthernet: true, constrained: true)
        for network in [wifi, cellular, hotspot, lowData] {
            XCTAssertFalse(PreloadPolicy.off.allows(network))
            XCTAssertTrue(PreloadPolicy.always.allows(network))
        }
        XCTAssertTrue(PreloadPolicy.automatic.allows(wifi))
        for network in [cellular, hotspot, lowData, PreloadNetwork()] {
            XCTAssertFalse(PreloadPolicy.automatic.allows(network))
        }
        XCTAssertFalse(PreloadPolicy.always.allows(PreloadNetwork()))
    }

    @MainActor
    func testPreloadMigrationPersistenceAndImmediateNotification() throws {
        let name = "org.mihonban.preload.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        XCTAssertEqual(CacheSettings(defaults: defaults).preloadPolicy, .automatic)
        defaults.set(false, forKey: "cache.preload")
        let settings = CacheSettings(defaults: defaults)
        XCTAssertEqual(settings.preloadPolicy, .off)
        var changes = 0
        settings.preloadDidChange = { changes += 1 }
        settings.preloadPolicy = .always
        XCTAssertEqual(changes, 1)
        XCTAssertEqual(CacheSettings(defaults: defaults).preloadPolicy, .always)
        settings.preloadPolicy = .automatic
        XCTAssertEqual(CacheSettings(defaults: defaults).preloadPolicy, .automatic)
    }

    func testAlbumQueuePreservesSelectionAndDiscOrderAndRejectsPartialData() throws {
        let albums = [Album(id: "b", title: "B", artist: "Band", trackCount: 1),
                      Album(id: "a", title: "A", artist: "Band", trackCount: 3)]
        let tracks = [Track(id: "a3", title: "First on disc two", disc: 2, track: 1, albumId: "a"),
                      Track(id: "a2", title: "Second", disc: 1, track: 2, albumId: "a"),
                      Track(id: "b1", title: "B", albumId: "b"),
                      Track(id: "a1", title: "First", disc: 1, track: 1, albumId: "a"),
                      Track(id: "unselected", title: "Other", albumId: "c")]
        XCTAssertEqual(try AlbumPlayback.assemble(albums: albums, tracks: tracks).map(\.id), ["b1", "a1", "a2", "a3"])
        XCTAssertThrowsError(try AlbumPlayback.assemble(albums: albums, tracks: Array(tracks.dropFirst())))
        XCTAssertThrowsError(try AlbumPlayback.assemble(albums: [Album(id: "missing", title: "", artist: "")], tracks: tracks))
    }

    func testTrackFiltersUseOwnArtistsAndAlbumMetadataWithSearchAndSort() {
        var album = Album(id: "a", title: "Sessions", artist: "Band", year: 1984, genres: ["Jazz"])
        album.secondaryGenres = ["City Pop"]
        album.rym = RymRating(rating: 4, votes: 100)
        let tracks = [Track(id: "b", title: "Night two", albumId: "a", artist: "Guest"),
                      Track(id: "a", title: "Night one", albumId: "a", artist: "Guest"),
                      Track(id: "c", title: "Night band", albumId: "a", artist: "Band"),
                      Track(id: "d", title: "Night later", albumId: "a", artist: "Guest", year: 1991),
                      Track(id: "e", title: "Night unknown", albumId: "unknown", artist: "Guest"),
                      Track(id: "f", title: "Night hidden", albumId: "a", artist: "Guest", hidden: true)]
        let index = CatalogIndex(albums: [album], tracks: tracks, artists: [], includeHidden: false)
        let filters = AlbumFilters(genre: "city pop", decade: 1980, artist: "Guest", minimumRating: 3.8)
        let shown = index.tracks(query: "night", filters: filters, sort: .title)
        XCTAssertEqual(shown.map(\.id), ["a", "b"])
        XCTAssertTrue(index.tracks(query: "absent", filters: filters).isEmpty)
        XCTAssertTrue(index.tracks(query: "", filters: AlbumFilters(minimumRating: 4.2)).isEmpty)
        var queue = PlaybackQueue()
        queue.replace(shown, startingAt: 0, shuffle: false)
        XCTAssertEqual(queue.current?.id, "a")
        XCTAssertEqual(queue.upcoming.map(\.id), ["b"])
        queue.replace(shown, startingAt: 1, shuffle: true)
        XCTAssertEqual(Set([queue.current!.id] + queue.upcoming.map(\.id)), ["a", "b"])
        _ = index.tracks(query: "", filters: AlbumFilters(artist: "Band"))
        XCTAssertEqual(queue.current?.id, "b", "filtering the catalog does not edit an existing queue")
    }

    func testShareURLPreservesPrefixAndEncodesOnlyTheAlbumIdentifier() throws {
        let base = try XCTUnwrap(URL(string: "https://example.com/music?token=private#old"))
        let url = try XCTUnwrap(ShareSelection.albumURL(base: base, id: "a/b ?#"))
        XCTAssertEqual(url.absoluteString, "https://example.com/music/#/album/a%2Fb%20%3F%23")
        XCTAssertNil(URLComponents(url: url, resolvingAgainstBaseURL: false)?.query)
        XCTAssertNil(ShareSelection.albumURL(base: URL(string: "https://user:password@example.com")!, id: "a"))
        XCTAssertNil(ShareSelection.albumURL(base: URL(string: "file:///private")!, id: "a"))
        XCTAssertNil(ShareSelection.albumURL(base: base, id: ""))
    }

    func testSharePayloadIsAnImmutableMetadataSnapshot() throws {
        let client = try APIClient(address: "https://example.com/music")
        var track = Track(id: "t", title: "Song", albumId: "a", albumTitle: "Album", artist: "Singer")
        let selection = try XCTUnwrap(ShareSelection.track(track, client: client))
        track.title = "Next song"
        XCTAssertEqual(selection.text, "Song\nSinger\nAlbum")
        XCTAssertEqual(selection.url.absoluteString, "https://example.com/music/#/album/a")
        XCTAssertNil(ShareSelection.track(Track(id: "t", title: "No album"), client: client))
        XCTAssertNil(ShareSelection.track(track, client: nil))
    }

    @MainActor
    func testAppearanceUsesAdaptiveReadableColorsAndSystemHasNoOverride() {
        XCTAssertNil(Appearance.system.colorScheme)
        XCTAssertEqual(Appearance.light.colorScheme, .light)
        XCTAssertEqual(Appearance.dark.colorScheme, .dark)
        func luminance(_ color: Color, _ style: UIUserInterfaceStyle) -> Double {
            let resolved = UIColor(color).resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            XCTAssertTrue(resolved.getRed(&r, green: &g, blue: &b, alpha: &a))
            let c = [r, g, b].map { Double($0) <= 0.04045 ? Double($0) / 12.92 : pow((Double($0) + 0.055) / 1.055, 2.4) }
            return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722
        }
        for style in [UIUserInterfaceStyle.light, .dark] {
            for background in [Theme.background, Theme.surface, Theme.raised] {
                let bg = luminance(background, style)
                for foreground in [Theme.ink, Theme.dim] {
                    let fg = luminance(foreground, style)
                    XCTAssertGreaterThanOrEqual((max(bg, fg) + 0.05) / (min(bg, fg) + 0.05), 4.5)
                }
            }
        }
        XCTAssertGreaterThan(luminance(Theme.background, .light), 0.8)
        XCTAssertLessThan(luminance(Theme.background, .dark), 0.02)
    }
}
