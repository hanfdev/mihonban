import XCTest
@testable import Mihonban

// Suspend actual detached search work without blocking an executor thread.
private final class SearchListingBuildGate: @unchecked Sendable {
    let entered = XCTestExpectation(description: "Detached search reached its publication boundary")
    private let request: SearchListingRequest
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Never>?
    private var released = false
    private var reached = false

    init(_ request: SearchListingRequest) { self.request = request }

    var hasEntered: Bool { lock.withLock { reached } }

    func hold(_ candidate: SearchListingRequest) async {
        guard candidate == request else { return }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let held = lock.withLock {
                guard !released else { return false }
                reached = true
                self.continuation = continuation
                return true
            }
            if held { entered.fulfill() }
            else { continuation.resume() }
        }
    }

    func release() {
        let pending = lock.withLock {
            released = true
            let value = continuation
            continuation = nil
            return value
        }
        pending?.resume()
    }
}

private actor SearchListingBuildCount {
    private(set) var value = 0
    func record() { value += 1 }
}

// TrackListingTests is included in both native device suites.
extension TrackListingTests {
    func testLargeSearchBuildsBoundedEquivalentPreviewsOffMainAndReusesThem() async {
        let index = await Task.detached {
            let artists = (0..<80).map { Artist(name: "Shared Artist \($0)") }
            let albums = (0..<1_200).reversed().map { number in
                Album(id: "a\(number)", title: "Shared Album \(number)", artist: "Shared Artist \(number % 80)",
                      rym: RymRating(rating: 3 + Double(number % 20) / 10, votes: number % 200), createdAt: number)
            }
            let tracks = (0..<10_000).reversed().map { number in
                Track(id: "t\(number)", title: "Shared Song \(number)", albumId: "a\(number % 1_200)",
                      albumTitle: "Shared Album \(number % 1_200)", artist: "Shared Artist \(number % 80)")
            }
            return CatalogIndex(albums: albums, tracks: tracks, artists: artists, includeHidden: false)
        }.value
        // This is the former synchronous screen workload, measured directly
        // for comparison rather than a brittle wall-clock performance limit.
        let baselineStart = ContinuousClock.now
        let expectedArtists = index.artists(query: "shared", sort: .count)
        let expectedAlbums = index.albums(query: "shared", sort: .rating)
        let expectedTracks = index.tracks(query: "shared", sort: .title)
        let baselineDuration = baselineStart.duration(to: .now)

        let listing = SearchListing()
        let builds = SearchListingBuildCount()
        listing.beforeBuildForTesting = { _ in await builds.record() }
        let revision = UUID()
        let request = SearchListingRequest(revision: revision, query: "  shared\n")
        await listing.update(index: index, request: request)
        XCTAssertTrue(listing.ready)
        XCTAssertTrue(listing.matches(request))
        XCTAssertFalse(listing.loading)
        XCTAssertFalse(listing.result.builtOnMainThread)
        XCTAssertEqual(listing.result.artistCount, 80)
        XCTAssertEqual(listing.result.albumCount, 1_200)
        XCTAssertEqual(listing.result.trackCount, 10_000)
        XCTAssertEqual(listing.result.artists.map(\.id), Array(expectedArtists.prefix(8)).map(\.id))
        XCTAssertEqual(listing.result.albums.map(\.id), Array(expectedAlbums.prefix(8)).map(\.id))
        XCTAssertEqual(listing.result.tracks.map(\.id), Array(expectedTracks.prefix(8)).map(\.id))
        XCTAssertEqual(listing.result.tracks.first?.id, "t0")
        XCTAssertEqual(listing.result.tracks.last?.id, "t7")
        XCTAssertTrue(listing.result.recentAlbums.isEmpty)

        let buildID = listing.result.buildID
        let reuseStart = ContinuousClock.now
        await listing.update(index: index, request: SearchListingRequest(revision: revision, query: "shared"))
        let reuseDuration = reuseStart.duration(to: .now)
        let buildCount = await builds.value
        XCTAssertEqual(listing.result.buildID, buildID)
        XCTAssertEqual(buildCount, 1, "Reentry and surrounding whitespace must not repeat filtering or sorting")
        print("Search: 10000 tracks, 1200 albums; direct full filtering/sorting = \(baselineDuration); detached build = \(listing.result.buildDuration); cached reentry = \(reuseDuration); builds = \(buildCount); main thread = \(listing.result.builtOnMainThread)")
    }

    func testSupersededSearchQueryAndRevisionCannotPublishStalePreviews() async throws {
        for replacingRevision in [false, true] {
            let oldIndex = CatalogIndex(albums: [], tracks: [Track(id: "old", title: "Alpha")], artists: [], includeHidden: false)
            let newTitle = replacingRevision ? "Alpha updated" : "Beta"
            let newIndex = CatalogIndex(albums: [], tracks: [Track(id: "new", title: newTitle)], artists: [], includeHidden: false)
            let revision = UUID()
            let oldRequest = SearchListingRequest(revision: revision, query: "Alpha")
            let newRequest = SearchListingRequest(revision: replacingRevision ? UUID() : revision,
                                                 query: replacingRevision ? "Alpha" : "Beta")
            let listing = SearchListing()
            let gate = SearchListingBuildGate(oldRequest)
            listing.beforeBuildForTesting = { await gate.hold($0) }
            let old = Task { await listing.update(index: oldIndex, request: oldRequest) }
            addTeardownBlock { gate.release(); await old.value }
            await fulfillment(of: [gate.entered], timeout: 5)
            guard gate.hasEntered else { throw NSError(domain: "SearchListingTests", code: 1) }
            XCTAssertTrue(listing.loading)
            XCTAssertFalse(listing.matches(oldRequest))

            await listing.update(index: newIndex, request: newRequest)
            let replacement = listing.result.buildID
            XCTAssertTrue(listing.matches(newRequest))
            XCTAssertEqual(listing.result.tracks.map(\.id), ["new"])
            gate.release()
            await old.value
            XCTAssertEqual(listing.result.buildID, replacement)
            XCTAssertEqual(listing.result.tracks.map(\.id), ["new"])
            XCTAssertTrue(listing.matches(newRequest))
            XCTAssertFalse(listing.matches(oldRequest))
            XCTAssertFalse(listing.loading)
        }
    }

    func testEmptySearchReusesRecentAlbumsAndCancelledWorkCannotFlashQueryResults() async throws {
        let albums = (0..<15).map {
            Album(id: "a\($0)", title: "Album \($0)", artist: "Band", updatedAt: 100 - $0, createdAt: $0)
        }
        let index = CatalogIndex(albums: albums, tracks: [Track(id: "a", title: "Alpha"), Track(id: "b", title: "Beta")],
                                 artists: [], includeHidden: false)
        let listing = SearchListing()
        let revision = UUID()
        let empty = SearchListingRequest(revision: revision, query: " \n")
        await listing.update(index: index, request: empty)
        let buildID = listing.result.buildID
        XCTAssertEqual(listing.result.recentAlbums.map(\.id), (3..<15).reversed().map { "a\($0)" })
        XCTAssertTrue(listing.result.albums.isEmpty)
        XCTAssertTrue(listing.result.artists.isEmpty)
        XCTAssertTrue(listing.result.tracks.isEmpty)

        let search = SearchListingRequest(revision: revision, query: "Alpha")
        let gate = SearchListingBuildGate(search)
        listing.beforeBuildForTesting = { await gate.hold($0) }
        let pending = Task { await listing.update(index: index, request: search) }
        addTeardownBlock { gate.release(); await pending.value }
        await fulfillment(of: [gate.entered], timeout: 5)
        guard gate.hasEntered else { throw NSError(domain: "SearchListingTests", code: 2) }
        XCTAssertTrue(listing.loading)
        XCTAssertFalse(listing.matches(search), "Recent albums cannot be presented as this query's hits")
        await listing.update(index: index, request: SearchListingRequest(revision: revision, query: ""))
        XCTAssertEqual(listing.result.buildID, buildID)
        XCTAssertTrue(listing.matches(empty))
        XCTAssertFalse(listing.loading)
        gate.release()
        await pending.value
        XCTAssertEqual(listing.result.buildID, buildID)

        let cancelledRequest = SearchListingRequest(revision: revision, query: "Beta")
        let cancelledGate = SearchListingBuildGate(cancelledRequest)
        listing.beforeBuildForTesting = { await cancelledGate.hold($0) }
        let cancelled = Task { await listing.update(index: index, request: cancelledRequest) }
        addTeardownBlock { cancelledGate.release(); await cancelled.value }
        await fulfillment(of: [cancelledGate.entered], timeout: 5)
        guard cancelledGate.hasEntered else { throw NSError(domain: "SearchListingTests", code: 3) }
        cancelled.cancel()
        cancelledGate.release()
        await cancelled.value
        XCTAssertEqual(listing.result.buildID, buildID)
        XCTAssertTrue(listing.matches(empty))
        XCTAssertFalse(listing.matches(cancelledRequest))
        XCTAssertFalse(listing.loading)
        XCTAssertEqual(listing.result.recentAlbums.count, 12)
    }

    func testSearchPreviewsPreserveNormalizedAliasesAndHiddenVisibility() async {
        let visible = Album(id: "public", title: "音樂 Café", artist: "中森明菜", createdAt: 10)
        let hidden = Album(id: "private", title: "音樂 Private", artist: "Private Artist", hidden: true, createdAt: 20)
        let tracks = [Track(id: "public-track", title: "音樂", albumId: visible.id, artist: visible.artist),
                      Track(id: "private-track", title: "音樂 Private", albumId: hidden.id, artist: hidden.artist, hidden: true)]
        let index = CatalogIndex(albums: [hidden, visible], tracks: tracks, artists: [], includeHidden: false)
        let listing = SearchListing()
        let revision = UUID()
        for query in ["音乐", "akina nakamori"] {
            await listing.update(index: index, request: SearchListingRequest(revision: revision, query: query))
            XCTAssertEqual(listing.result.albums.map(\.id), [visible.id])
            XCTAssertEqual(listing.result.tracks.map(\.id), ["public-track"])
            XCTAssertEqual(listing.result.albumCount, 1)
            XCTAssertEqual(listing.result.trackCount, 1)
            if query == "akina nakamori" { XCTAssertEqual(listing.result.artists.map(\.id), [visible.artist]) }
        }
        await listing.update(index: index, request: SearchListingRequest(revision: revision, query: "private"))
        XCTAssertTrue(listing.result.isEmpty)
        XCTAssertEqual(listing.result.artistCount, 0)
        XCTAssertEqual(listing.result.albumCount, 0)
        XCTAssertEqual(listing.result.trackCount, 0)
        let authorized = CatalogIndex(albums: [hidden, visible], tracks: tracks, artists: [], includeHidden: true)
        await listing.update(index: authorized, request: SearchListingRequest(revision: UUID(), query: "private"))
        XCTAssertEqual(listing.result.albums.map(\.id), [hidden.id])
        XCTAssertEqual(listing.result.tracks.map(\.id), ["private-track"])
        XCTAssertEqual(listing.result.artists.map(\.id), [hidden.artist])
    }
}
