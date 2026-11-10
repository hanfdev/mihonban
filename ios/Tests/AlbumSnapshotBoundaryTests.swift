import XCTest
@testable import Mihonban

// Each host owns its responses so these cases cannot change another test's service.
private final class AlbumSnapshotProtocol: URLProtocol {
    final class State: @unchecked Sendable {
        struct Service {
            let album: Data
            var offline = false
            var albumRequests = 0
        }
        private let lock = NSLock()
        private var services: [String: Service] = [:]

        func register(_ host: String, album: Data) {
            lock.withLock { services[host] = Service(album: album) }
        }
        func goOffline(_ host: String) { lock.withLock { services[host]?.offline = true } }
        func remove(_ host: String) { _ = lock.withLock { services.removeValue(forKey: host) } }
        func count(_ host: String) -> Int { lock.withLock { services[host]?.albumRequests ?? 0 } }
        func response(_ host: String, albumRequest: Bool) -> Service? {
            lock.withLock {
                if albumRequest { services[host]?.albumRequests += 1 }
                return services[host]
            }
        }
    }
    static let state = State()
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host?.hasPrefix("album-snapshot-") == true
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        guard let url = request.url, let host = url.host else { return }
        let isAlbum = url.path.contains("/api/album/")
        guard let service = Self.state.response(host, albumRequest: isAlbum) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        if service.offline {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let data: Data
        let status: Int
        if isAlbum {
            data = service.album
            status = 200
        } else if url.path.hasSuffix("/api/favorites") {
            data = Data(#"{"albums":[],"tracks":[]}"#.utf8)
            status = 200
        } else if ["library", "artists", "tracks"].contains(url.lastPathComponent) {
            data = Data("[]".utf8)
            status = 200
        } else {
            data = Data("{}".utf8)
            status = 404
        }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}

// The actual disk operation has finished. Hold its caller at the suspension
// boundary until the test changes authorization or cancels that caller.
@MainActor
private final class AlbumSnapshotGate {
    let entered = XCTestExpectation(description: "Album snapshot operation finished")
    private(set) var count = 0
    private var continuation: CheckedContinuation<Void, Never>?
    private var released = false

    func hold() async {
        guard !released else { return }
        count += 1
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            entered.fulfill()
        }
    }

    func release() {
        released = true
        let waiting = continuation
        continuation = nil
        waiting?.resume()
    }
}

@MainActor
private final class AlbumSnapshotFixture {
    let model: AppModel
    let api: APIClient
    let album: Album
    let root: URL
    let host: String
    let audio: URL
    private let defaults: UserDefaults
    private let suiteName: String

    init() throws {
        let identity = UUID().uuidString.lowercased()
        host = "album-snapshot-" + identity + ".invalid"
        suiteName = "org.mihonban.album-snapshot." + identity
        defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AlbumSnapshotProtocol.self]
        api = try APIClient(address: "https://" + host + "/library-" + identity,
                            session: URLSession(configuration: configuration))
        audio = try XCTUnwrap(Bundle(for: OfflineLaunchTests.self).url(forResource: "tone", withExtension: "flac"))
        album = Album(id: "saved-album", title: "Saved album", artist: "Saved artist",
                      tracks: [Track(id: "saved-track", title: "Saved track", format: "flac")])
        root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Mihonban/" + digest(api.baseURL.absoluteString) + "/catalog", isDirectory: true)
        model = AppModel(defaults: defaults, transport: api.session, artworkStore: ArtworkStore())
        model.sessionStore.connect(api, info: SessionInfo(ok: true, role: "user", guest: false))
        model.player.connect(api, demoURL: audio)
        model.player.setForeground(false)
        AlbumSnapshotProtocol.state.register(host, album: try JSONEncoder().encode(album))
    }

    func connect() async { await model.catalog.connect() }

    func prepareOfflineSnapshot() async throws {
        await connect()
        let online = try await model.catalog.album(album.id)
        XCTAssertEqual(online, album)
        XCTAssertEqual(try savedAlbum(), album, "The fallback must use a real persisted album")
        AlbumSnapshotProtocol.state.goOffline(host)
        await model.catalog.connect()
        XCTAssertNil(model.catalog.cachedAlbum(album.id), "A memory hit must not bypass the disk boundary")
    }

    func savedAlbum() throws -> Album {
        let key = "v1-user-visible:album:" + album.id
        let path = root.appendingPathComponent(digest(key) + ".json")
        return try JSONDecoder().decode(Album.self, from: Data(contentsOf: path))
    }

    func install(_ gate: AlbumSnapshotGate) {
        model.catalog.albumSnapshotBoundary = { await gate.hold() }
    }

    func cleanup() {
        model.catalog.albumSnapshotBoundary = nil
        model.catalog.reset()
        model.sessionStore.invalidate()
        model.player.stop()
        model.player.setForeground(false)
        api.session.invalidateAndCancel()
        AlbumSnapshotProtocol.state.remove(host)
        defaults.removePersistentDomain(forName: suiteName)
        try? FileManager.default.removeItem(at: root)
    }
}

// OfflineLaunchTests is included in both the iPhone and iPad native selections.
extension OfflineLaunchTests {
    private func waitForAlbumSnapshot(_ gate: AlbumSnapshotGate) async throws {
        await fulfillment(of: [gate.entered], timeout: 5)
        guard gate.count == 1 else {
            throw NSError(domain: "AlbumSnapshotBoundaryTests", code: 1)
        }
    }

    func testSavedAlbumCannotRestartAnEmptyQueueAfterSignOut() async throws {
        let fixture = try AlbumSnapshotFixture()
        defer { fixture.cleanup() }
        await fixture.connect()
        let gate = AlbumSnapshotGate()
        fixture.install(gate)
        let pending = Task { await fixture.model.enqueueAlbum(fixture.album.id, next: true) }
        defer { pending.cancel(); gate.release() }
        try await waitForAlbumSnapshot(gate)
        XCTAssertEqual(try fixture.savedAlbum(), fixture.album)

        fixture.model.disconnect()
        gate.release()
        await pending.value

        XCTAssertFalse(fixture.model.signedIn)
        XCTAssertNil(fixture.model.player.current, "A completed disk save must not revive playback after sign-out")
        XCTAssertTrue(fixture.model.player.queue.tracks.isEmpty)
        XCTAssertFalse(fixture.model.player.wantsPlayback)
        XCTAssertNil(fixture.model.player.error)
        XCTAssertNil(fixture.model.catalog.cachedAlbum(fixture.album.id))
    }

    func testOfflineAlbumCannotEnterAReplacementSessionsQueue() async throws {
        let fixture = try AlbumSnapshotFixture()
        defer { fixture.cleanup() }
        try await fixture.prepareOfflineSnapshot()
        let gate = AlbumSnapshotGate()
        fixture.install(gate)
        let pending = Task { await fixture.model.enqueueAlbum(fixture.album.id, next: false) }
        defer { pending.cancel(); gate.release() }
        try await waitForAlbumSnapshot(gate)
        XCTAssertEqual(AlbumSnapshotProtocol.state.count(fixture.host), 2)

        fixture.model.disconnect()
        let replacement = try APIClient(address: "https://album-snapshot-replacement-" + UUID().uuidString.lowercased() + ".invalid",
                                        session: fixture.api.session)
        fixture.model.sessionStore.connect(replacement, info: SessionInfo(ok: true, role: "user", guest: false))
        fixture.model.player.connect(replacement, demoURL: fixture.audio)
        fixture.model.player.play([Track(id: "replacement", title: "Replacement session track")])
        fixture.model.player.pause()
        gate.release()
        await pending.value

        XCTAssertEqual(fixture.model.client?.baseURL, replacement.baseURL)
        XCTAssertEqual(fixture.model.player.queue.tracks.map(\.id), ["replacement"],
                       "An old disk read must not append metadata to a replacement service's queue")
        XCTAssertEqual(fixture.model.player.current?.id, "replacement")
        XCTAssertTrue(fixture.model.player.queue.upcoming.isEmpty)
        XCTAssertFalse(fixture.model.player.wantsPlayback)
        XCTAssertNil(fixture.model.player.error)
    }

    func testCurrentSessionStillReadsThePersistedAlbumOffline() async throws {
        let fixture = try AlbumSnapshotFixture()
        defer { fixture.cleanup() }
        try await fixture.prepareOfflineSnapshot()
        let gate = AlbumSnapshotGate()
        fixture.install(gate)
        let pending = Task { try await fixture.model.catalog.album(fixture.album.id) }
        defer { pending.cancel(); gate.release() }
        try await waitForAlbumSnapshot(gate)
        gate.release()
        let restored = try await pending.value

        XCTAssertEqual(restored, fixture.album)
        XCTAssertEqual(restored.normalizedTracks.map(\.id), ["saved-track"])
        XCTAssertEqual(AlbumSnapshotProtocol.state.count(fixture.host), 2)
        XCTAssertTrue(fixture.model.signedIn)
        XCTAssertNil(fixture.model.player.current)
    }

    func testCancelledAlbumSnapshotOperationsDoNotReturnMetadata() async throws {
        for offline in [false, true] {
            let fixture = try AlbumSnapshotFixture()
            defer { fixture.cleanup() }
            if offline { try await fixture.prepareOfflineSnapshot() }
            else { await fixture.connect() }
            let gate = AlbumSnapshotGate()
            fixture.install(gate)
            let pending = Task { try await fixture.model.catalog.album(fixture.album.id) }
            defer { pending.cancel(); gate.release() }
            try await waitForAlbumSnapshot(gate)
            pending.cancel()
            gate.release()
            do {
                _ = try await pending.value
                XCTFail("A cancelled caller must not receive metadata after snapshot \(offline ? "load" : "save")")
            } catch {
                XCTAssertTrue(error is CancellationError, "Cancellation must stay silent and retain its identity")
            }
            XCTAssertTrue(fixture.model.signedIn, "Cancelling a view does not revoke its service authorization")
            XCTAssertNil(fixture.model.player.current)
            XCTAssertNil(fixture.model.player.error)
        }
    }
}
