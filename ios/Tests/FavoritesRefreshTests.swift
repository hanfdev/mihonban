import XCTest
@testable import Mihonban

private final class FavoritesRefreshProtocol: URLProtocol {
    final class State: @unchecked Sendable {
        let lock = NSLock()
        var version = 1
        var unavailable = false
        var failure: URLError.Code?
        var trackHeaders: [String?] = []
        func reset() { lock.withLock { version = 1; unavailable = false; failure = nil; trackHeaders = [] } }
    }
    static let state = State()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        let path = request.url!.path
        let (version, unavailable, failure) = Self.state.lock.withLock {
            if path == "/api/tracks" { Self.state.trackHeaders.append(request.value(forHTTPHeaderField: "If-None-Match")) }
            return (Self.state.version, Self.state.unavailable, Self.state.failure)
        }
        if let failure {
            client?.urlProtocol(self, didFailWithError: URLError(failure))
            return
        }
        if unavailable {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let tag = "\"tracks-\(version)\""
        let unchanged = path == "/api/tracks" && request.value(forHTTPHeaderField: "If-None-Match") == tag
        let data: Data
        switch path {
        case "/api/favorites":
            data = try! JSONEncoder().encode(Favorites(albums: [], tracks: [FavoriteItem(id: version == 1 ? "old" : "new")]))
        case "/api/tracks":
            var tracks = [Track(id: "old", title: "Old")]
            if version > 1 { tracks.append(Track(id: "new", title: "New import")) }
            data = try! JSONEncoder().encode(tracks)
        default: data = Data("[]".utf8)
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: unchanged ? 304 : 200,
            httpVersion: nil, headerFields: ["ETag": tag, "Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !unchanged { client?.urlProtocol(self, didLoad: data) }
        client?.urlProtocolDidFinishLoading(self)
    }
}

@MainActor
final class FavoritesRefreshTests: XCTestCase {
    func testCancelledRequestsRemainSilentAndRealFailuresRemainVisible() async throws {
        FavoritesRefreshProtocol.state.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FavoritesRefreshProtocol.self]
        let transport = URLSession(configuration: config)
        defer { transport.invalidateAndCancel(); FavoritesRefreshProtocol.state.reset() }
        let session = SessionStore()
        session.connect(try APIClient(address: "https://example.invalid", session: transport),
                        info: SessionInfo(ok: true, role: "admin", guest: false))
        let favorites = FavoritesStore(session: session)
        let catalog = CatalogStore(session: session, favorites: favorites)
        await catalog.refresh()
        let previous = catalog.index.tracks.map(\.id)
        XCTAssertFalse(previous.isEmpty)
        FavoritesRefreshProtocol.state.lock.withLock { FavoritesRefreshProtocol.state.failure = .cancelled }
        await catalog.refresh()
        await catalog.ensureTracks(force: true)
        XCTAssertNil(catalog.error, "Tab changes and cancelled refreshes must not show a cancellation/retry banner")
        XCTAssertEqual(catalog.index.tracks.map(\.id), previous)
        await favorites.toggle(.track, id: "cancelled-write")
        XCTAssertFalse(favorites.contains(.track, id: "cancelled-write"))
        XCTAssertFalse(favorites.busy)
        XCTAssertNil(favorites.error, "Cancelled optimistic writes roll back silently")
        XCTAssertFalse(session.needsSignIn)

        FavoritesRefreshProtocol.state.lock.withLock { FavoritesRefreshProtocol.state.failure = .timedOut }
        await catalog.refresh()
        XCTAssertNotNil(catalog.error, "A real connection failure must still be actionable")
        XCTAssertEqual(catalog.index.tracks.map(\.id), previous)
        await favorites.toggle(.track, id: "failed-write")
        XCTAssertNotNil(favorites.error)
        XCTAssertFalse(favorites.contains(.track, id: "failed-write"))
    }

    func testUnchangedTrackRefreshKeepsTheIndexAndConcurrentReadersSharePublication() async throws {
        FavoritesRefreshProtocol.state.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FavoritesRefreshProtocol.self]
        let transport = URLSession(configuration: config)
        defer { transport.invalidateAndCancel() }
        let session = SessionStore()
        session.connect(try APIClient(address: "https://example.invalid", session: transport),
                        info: SessionInfo(ok: true, role: "user", guest: false))
        let catalog = CatalogStore(session: session, favorites: FavoritesStore(session: session))
        await catalog.ensureTracks()
        let revision = catalog.revision
        await catalog.ensureTracks(force: true)
        XCTAssertEqual(catalog.revision, revision, "304 must not invalidate the rendered list or rebuild the search index")
        FavoritesRefreshProtocol.state.lock.withLock { FavoritesRefreshProtocol.state.version = 2 }
        async let first = catalog.requireTracks(force: true)
        async let second = catalog.requireTracks(force: true)
        let values = try await (first, second)
        XCTAssertEqual(values.0.map(\.id), ["old", "new"])
        XCTAssertEqual(values.1.map(\.id), ["old", "new"])
        XCTAssertNotEqual(catalog.revision, revision)
        XCTAssertEqual(FavoritesRefreshProtocol.state.lock.withLock { FavoritesRefreshProtocol.state.trackHeaders.count }, 3)
    }

    func testRefreshResolvesNewFavoriteAgainstCachedTracksAndUsesConditionalRequests() async throws {
        FavoritesRefreshProtocol.state.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FavoritesRefreshProtocol.self]
        let transport = URLSession(configuration: config)
        defer { transport.invalidateAndCancel() }
        let session = SessionStore()
        session.connect(try APIClient(address: "https://example.invalid", session: transport),
                        info: SessionInfo(ok: true, role: "user", guest: false))
        let favorites = FavoritesStore(session: session)
        let catalog = CatalogStore(session: session, favorites: favorites)
        await catalog.ensureTracks()
        XCTAssertEqual(catalog.tracks.map(\.id), ["old"])
        FavoritesRefreshProtocol.state.lock.withLock { FavoritesRefreshProtocol.state.version = 2 }
        await catalog.refresh()
        XCTAssertEqual(favorites.value.tracks.map(\.id), ["new"])
        XCTAssertEqual(catalog.index.tracks.map(\.id), ["old", "new"])
        await catalog.refresh()
        XCTAssertEqual(catalog.index.tracks.map(\.id), ["old", "new"], "304 retains the full cached list")
        let headers = FavoritesRefreshProtocol.state.lock.withLock { FavoritesRefreshProtocol.state.trackHeaders }
        XCTAssertEqual(headers.count, 3)
        XCTAssertNil(headers[0])
        XCTAssertEqual(headers[1], "\"tracks-1\"")
        XCTAssertEqual(headers[2], "\"tracks-2\"")
        FavoritesRefreshProtocol.state.lock.withLock { FavoritesRefreshProtocol.state.unavailable = true }
        await catalog.refresh()
        XCTAssertEqual(catalog.index.tracks.map(\.id), ["old", "new"], "network failure must preserve offline songs")
        XCTAssertEqual(favorites.value.tracks.map(\.id), ["new"])
    }
}
