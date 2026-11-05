import XCTest
@testable import Mihonban

private final class FavoritesRefreshProtocol: URLProtocol {
    final class State: @unchecked Sendable {
        let lock = NSLock()
        var version = 1
        var unavailable = false
        var trackHeaders: [String?] = []
        func reset() { lock.withLock { version = 1; unavailable = false; trackHeaders = [] } }
    }
    static let state = State()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        let path = request.url!.path
        let (version, unavailable) = Self.state.lock.withLock {
            if path == "/api/tracks" { Self.state.trackHeaders.append(request.value(forHTTPHeaderField: "If-None-Match")) }
            return (Self.state.version, Self.state.unavailable)
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
