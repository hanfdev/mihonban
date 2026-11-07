import XCTest
@testable import Mihonban

@MainActor
final class TrackListingTests: XCTestCase {
    func testLargeCatalogSortsOffMainAndReusesTheListOnReentry() async {
        let index = await Task.detached {
            let tracks = (0..<10_000).reversed().map {
                Track(id: "t\($0)", title: "Song \($0)", albumId: "album", artist: "Artist")
            }
            return CatalogIndex(albums: [], tracks: tracks, artists: [], includeHidden: false)
        }.value
        let listing = TrackListing()
        let request = TrackListingRequest(revision: UUID(), query: "", filters: .init(), sort: .title)
        let start = ContinuousClock.now
        await listing.update(index: index, request: request)
        print("Tracks: 10000 songs sorted in \(start.duration(to: .now)); main thread = \(listing.result.builtOnMainThread)")
        XCTAssertFalse(listing.result.builtOnMainThread)
        XCTAssertEqual(listing.result.tracks.count, 10_000)
        XCTAssertEqual(listing.result.tracks.first?.id, "t0")
        XCTAssertEqual(listing.result.tracks.last?.id, "t9999")
        XCTAssertEqual(listing.result.positions["t5678"], 5678, "row playback must retain the displayed queue position")
        let buildID = listing.result.buildID
        await listing.update(index: index, request: request)
        XCTAssertEqual(listing.result.buildID, buildID, "returning to an unchanged tab must reuse its sorted list")
    }

    func testSupersededSearchCannotReplaceTheRestoredCachedList() async throws {
        let index = CatalogIndex(albums: [], tracks: [Track(id: "a", title: "Alpha"), Track(id: "b", title: "Beta")],
                                 artists: [], includeHidden: false)
        let listing = TrackListing()
        let revision = UUID()
        let all = TrackListingRequest(revision: revision, query: "", filters: .init(), sort: .title)
        await listing.update(index: index, request: all)
        let buildID = listing.result.buildID
        let search = Task {
            await listing.update(index: index, request: TrackListingRequest(revision: revision,
                query: "Beta", filters: .init(), sort: .title))
        }
        for _ in 0..<50 where !listing.loading { try await Task.sleep(for: .milliseconds(1)) }
        XCTAssertTrue(listing.loading)
        await listing.update(index: index, request: all)
        await search.value
        XCTAssertEqual(listing.result.tracks.map(\.id), ["a", "b"])
        XCTAssertEqual(listing.result.buildID, buildID)
        XCTAssertFalse(listing.loading)
        let cancelled = Task {
            await listing.update(index: index, request: TrackListingRequest(revision: revision,
                query: "Alpha", filters: .init(), sort: .title))
        }
        cancelled.cancel()
        await cancelled.value
        XCTAssertEqual(listing.result.buildID, buildID)
    }

    func testRevisionAndFiltersReplaceResultsWithoutChangingAnExistingQueue() async {
        let album = Album(id: "album", title: "Album", artist: "Band", year: 1984, genres: ["Jazz"])
        let tracks = [Track(id: "a", title: "Night 2", albumId: "album", artist: "Guest"),
                      Track(id: "b", title: "Night 1", albumId: "album", artist: "Guest"),
                      Track(id: "c", title: "Night 3", albumId: "album", artist: "Band")]
        let index = CatalogIndex(albums: [album], tracks: tracks, artists: [], includeHidden: false)
        let listing = TrackListing()
        await listing.update(index: index, request: TrackListingRequest(revision: UUID(), query: "night",
            filters: AlbumFilters(genre: "jazz", decade: 1980, artist: "Guest"), sort: .title))
        XCTAssertEqual(listing.result.tracks.map(\.id), ["b", "a"])
        var queue = PlaybackQueue()
        queue.replace(listing.result.tracks, startingAt: listing.result.positions["a"]!, shuffle: false)
        let newer = CatalogIndex(albums: [album], tracks: tracks + [Track(id: "new", title: "New import")],
                                 artists: [], includeHidden: false)
        await listing.update(index: newer, request: TrackListingRequest(revision: UUID(), query: "",
            filters: .init(), sort: .title))
        XCTAssertEqual(listing.result.tracks.count, 4)
        XCTAssertNotNil(listing.result.positions["new"])
        XCTAssertEqual(queue.current?.id, "a")
    }
}
