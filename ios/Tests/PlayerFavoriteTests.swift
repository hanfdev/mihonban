import XCTest
@testable import Mihonban

// Hold writes at the transport boundary so pending, rollback and session
// replacement are exercised without timing sleeps or a production service.
private final class FavoriteRequestGate: @unchecked Sendable {
    private let lock = NSLock()
    private var pending: [String: FavoriteWriteProtocol] = [:]
    private var requests: [String: [URLRequest]] = [:]

    func hold(_ connection: FavoriteWriteProtocol) {
        let host = connection.request.url!.host!
        lock.lock()
        pending[host] = connection
        requests[host, default: []].append(connection.request)
        lock.unlock()
    }

    func recorded(_ host: String) -> [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return requests[host] ?? []
    }

    func reply(_ host: String, status: Int) {
        lock.lock()
        let connection = pending.removeValue(forKey: host)
        lock.unlock()
        connection?.finish(status: status)
    }

    func remove(_ host: String) {
        lock.lock()
        pending.removeValue(forKey: host)
        requests.removeValue(forKey: host)
        lock.unlock()
    }
}

private final class FavoriteWriteProtocol: URLProtocol, @unchecked Sendable {
    static let gate = FavoriteRequestGate()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.gate.hold(self) }
    override func stopLoading() {}

    func finish(status: Int) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{\"ok\":true}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

@MainActor
final class PlayerFavoriteTests: XCTestCase {
    private func connect(role: String = "admin") throws -> (String, SessionStore, FavoritesStore) {
        let host = UUID().uuidString.lowercased() + ".invalid"
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FavoriteWriteProtocol.self]
        let transport = URLSession(configuration: configuration)
        let api = try APIClient(address: "https://" + host, session: transport)
        let session = SessionStore()
        session.connect(api, info: SessionInfo(ok: true, role: role, guest: false))
        addTeardownBlock {
            transport.invalidateAndCancel()
            FavoriteWriteProtocol.gate.remove(host)
        }
        return (host, session, FavoritesStore(session: session))
    }

    private func waitForWrite(_ host: String) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while FavoriteWriteProtocol.gate.recorded(host).isEmpty && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(FavoriteWriteProtocol.gate.recorded(host).count, 1)
    }

    func testOnePendingWriteTargetsTheCapturedTrack() async throws {
        let (host, _, store) = try connect()
        store.replace(Favorites(albums: [FavoriteItem(id: "album")], tracks: [FavoriteItem(id: "other")]))
        let write = Task { await store.toggle(.track, id: "playing") }
        try await waitForWrite(host)
        XCTAssertTrue(store.busy)
        XCTAssertTrue(store.contains(.track, id: "playing"))
        await store.toggle(.track, id: "playing")
        await store.toggle(.track, id: "next")
        let requests = FavoriteWriteProtocol.gate.recorded(host)
        XCTAssertEqual(requests.count, 1, "pending writes suppress double taps and writes after a track change")
        XCTAssertEqual(requests.first?.httpMethod, "PUT")
        XCTAssertEqual(requests.first?.url?.path, "/api/favorites/track/playing")
        XCTAssertFalse(store.contains(.track, id: "next"))
        FavoriteWriteProtocol.gate.reply(host, status: 200)
        await write.value
        XCTAssertFalse(store.busy)
        XCTAssertNil(store.error)
        XCTAssertEqual(store.value.albums.map(\.id), ["album"])
        XCTAssertEqual(store.value.tracks.map(\.id), ["playing", "other"])
    }

    func testRejectedRemovalRollsBackAndReportsFailure() async throws {
        let (host, _, store) = try connect()
        store.replace(Favorites(albums: [], tracks: [FavoriteItem(id: "playing"), FavoriteItem(id: "other")]))
        let write = Task { await store.toggle(.track, id: "playing") }
        try await waitForWrite(host)
        XCTAssertFalse(store.contains(.track, id: "playing"))
        XCTAssertEqual(FavoriteWriteProtocol.gate.recorded(host).first?.httpMethod, "DELETE")
        FavoriteWriteProtocol.gate.reply(host, status: 403)
        await write.value
        XCTAssertEqual(store.value.tracks.map(\.id), ["playing", "other"])
        XCTAssertEqual(store.error, L10n.text("mobile.permissionDenied"))
        XCTAssertFalse(store.busy)
    }

    func testListenersCannotSendFavoriteWrites() async throws {
        let (host, _, store) = try connect(role: "user")
        await store.toggle(.track, id: "playing")
        XCTAssertTrue(FavoriteWriteProtocol.gate.recorded(host).isEmpty)
        XCTAssertFalse(store.contains(.track, id: "playing"))
        XCTAssertFalse(store.busy)
    }

    func testOldRequestCannotRestorePicksAfterSignOut() async throws {
        let (host, session, store) = try connect()
        let write = Task { await store.toggle(.track, id: "old-track") }
        try await waitForWrite(host)
        session.invalidate()
        store.reset()
        store.replace(Favorites(albums: [], tracks: [FavoriteItem(id: "new-session-track")]))
        FavoriteWriteProtocol.gate.reply(host, status: 403)
        await write.value
        XCTAssertEqual(store.value.tracks.map(\.id), ["new-session-track"])
        XCTAssertNil(store.error)
        XCTAssertFalse(store.busy)
    }
}
