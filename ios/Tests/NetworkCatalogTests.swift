import XCTest
@testable import Mihonban

// Runs the real stores against tools/fixture-server.py, whose responses follow
// the worker's shapes, including SQLite 0/1 flags in track lists.
@MainActor
final class NetworkCatalogTests: XCTestCase {
    private func connect(password: String) async throws -> (SessionStore, FavoritesStore, CatalogStore) {
        let api = try APIClient(address: "http://127.0.0.1:8766")
        api.clearCookies()
        let info = try await api.login(password: password)
        XCTAssertTrue(info.ok)
        let session = SessionStore()
        session.connect(api, info: info)
        let favorites = FavoritesStore(session: session)
        let catalog = CatalogStore(session: session, favorites: favorites)
        await catalog.connect()
        XCTAssertNil(catalog.error)
        return (session, favorites, catalog)
    }

    func testCatalogArtistsTracksAndDetail() async throws {
        let (_, favorites, catalog) = try await connect(password: "fixture-password")
        XCTAssertEqual(catalog.index.albums.count, 3)
        XCTAssertEqual(catalog.index.albums(query: "", sort: .rating).first?.id, "network-mp3",
                       "420 votes at 3.9 must outrank 3 votes at 4.1")

        let names = Set(catalog.index.artists.map(\.id))
        XCTAssertEqual(names, ["Test Ensemble", "Guest Singer", "Session Player"])
        let session = try XCTUnwrap(catalog.index.artists.first { $0.id == "Session Player" })
        XCTAssertEqual(session.albumCount, 0)
        XCTAssertEqual(session.featuredCount, 1)
        XCTAssertEqual(catalog.index.artists(query: "the test ensemble").first?.id, "Test Ensemble")
        XCTAssertEqual(catalog.index.albums(query: "guest singer").map(\.id), ["network-flac"])

        await catalog.ensureTracks()
        XCTAssertNil(catalog.error)
        XCTAssertTrue(catalog.tracksLoaded)
        XCTAssertEqual(catalog.tracks.count, 3, "numeric hidden flags must decode")
        XCTAssertEqual(catalog.tracks.first { $0.id == "network-ogg" }?.hidden, false)
        XCTAssertEqual(catalog.index.tracks(query: "session player").map(\.id), ["network-ogg"])

        let featured = try await catalog.artistTracks("Session Player")
        XCTAssertEqual(featured.map(\.id), ["network-ogg"])
        let bio = try await catalog.biography("Test Ensemble")
        XCTAssertTrue(bio.contains("testing"))

        let album = try await catalog.album("network-mp3")
        XCTAssertEqual(album.images, ["booklet-1", "booklet-2"])
        XCTAssertEqual(album.similar?.count, 2)
        XCTAssertEqual(album.rym?.descriptors, ["warm", "nocturnal"])
        XCTAssertEqual(album.normalizedTracks.first?.bitrate, 192000)
        let flac = try await catalog.album("network-flac")
        XCTAssertEqual(flac.credits.map(\.name), ["Test Ensemble", "Guest Singer"])

        XCTAssertTrue(favorites.contains(.album, id: "network-mp3"))
        XCTAssertTrue(favorites.contains(.track, id: "network-flac"))
        // Listeners may read picks but never change them.
        await favorites.toggle(.album, id: "network-mp3")
        XCTAssertTrue(favorites.contains(.album, id: "network-mp3"))
    }

    func testAdminFavoriteWritesRoundTrip() async throws {
        let (_, favorites, _) = try await connect(password: "fixture-admin")
        let original = favorites.value.albums.map(\.id)
        XCTAssertEqual(original, ["network-mp3", "network-ogg"])
        // Restore the shared fixture state even when an assertion fails.
        defer {
            Task { @MainActor in
                if !favorites.contains(.album, id: "network-mp3") { await favorites.toggle(.album, id: "network-mp3") }
                await favorites.reorder(.album, ids: original)
            }
        }

        await favorites.toggle(.album, id: "network-mp3")
        XCTAssertNil(favorites.error)
        XCTAssertFalse(favorites.contains(.album, id: "network-mp3"))
        try await favorites.refresh()
        XCTAssertEqual(favorites.value.albums.map(\.id), ["network-ogg"], "server state must match")

        await favorites.toggle(.album, id: "network-mp3")
        await favorites.reorder(.album, ids: ["network-ogg", "network-mp3"])
        XCTAssertNil(favorites.error)
        try await favorites.refresh()
        XCTAssertEqual(favorites.value.albums.map(\.id), ["network-ogg", "network-mp3"])

        await favorites.reorder(.album, ids: original)
        try await favorites.refresh()
        XCTAssertEqual(favorites.value.albums.map(\.id), original)
    }
}
