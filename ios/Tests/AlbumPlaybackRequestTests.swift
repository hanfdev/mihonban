import XCTest
@testable import Mihonban

// Holds the bulk response until a test explicitly releases it.
private final class BulkTracksProtocol: URLProtocol {
    final class State: @unchecked Sendable {
        let lock = NSLock()
        var pending: [BulkTracksProtocol] = []
        var paths: [String] = []
        func record(_ request: BulkTracksProtocol) {
            lock.withLock {
                paths.append(request.request.url!.path)
                pending.append(request)
            }
        }
        func remove(_ request: BulkTracksProtocol) { lock.withLock { pending.removeAll { $0 === request } } }
        var count: Int { lock.withLock { paths.count } }
        func reset() { lock.withLock { pending = []; paths = [] } }
        func finish(_ tracks: [Track]) throws {
            let data = try JSONEncoder().encode(tracks)
            let requests = lock.withLock { let copy = pending; pending = []; return copy }
            for request in requests {
                let response = HTTPURLResponse(url: request.request.url!, statusCode: 200, httpVersion: nil,
                                               headerFields: ["Content-Type": "application/json"])!
                request.client?.urlProtocol(request, didReceive: response, cacheStoragePolicy: .notAllowed)
                request.client?.urlProtocol(request, didLoad: data)
                request.client?.urlProtocolDidFinishLoading(request)
            }
        }
    }
    static let state = State()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.state.record(self) }
    override func stopLoading() { Self.state.remove(self) }
}

@MainActor
final class AlbumPlaybackRequestTests: XCTestCase {
    private let albums = [Album(id: "a", title: "A", artist: "Band", trackCount: 1),
                          Album(id: "b", title: "B", artist: "Band", trackCount: 1)]
    private let tracks = [Track(id: "b1", title: "B", albumId: "b"), Track(id: "a1", title: "A", albumId: "a")]

    private func model() throws -> AppModel {
        BulkTracksProtocol.state.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [BulkTracksProtocol.self]
        let client = try APIClient(address: "https://example.invalid/bulk-tests", session: URLSession(configuration: config))
        let model = AppModel(transport: client.session)
        model.sessionStore.connect(client, info: SessionInfo(ok: true, role: "user", guest: false))
        model.player.connect(client, demoURL: try DemoLibrary.tone())
        return model
    }

    private func waitForRequest() async throws {
        for _ in 0..<100 {
            if BulkTracksProtocol.state.count > 0 { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("The bulk request was not started")
        throw URLError(.timedOut)
    }

    func testAlbumPlaybackAndSongsScreenShareOneBulkRequest() async throws {
        let model = try model()
        defer { model.player.stop(); model.player.setForeground(false) }
        let playback = Task { try await model.catalog.playbackTracks(for: albums) }
        try await waitForRequest()
        let screen = Task { await model.catalog.ensureTracks() }
        await Task.yield()
        try BulkTracksProtocol.state.finish(tracks)
        let result = try await playback.value
        await screen.value
        XCTAssertEqual(result.map(\.id), ["a1", "b1"])
        XCTAssertEqual(BulkTracksProtocol.state.count, 1, "no serial album detail requests")
        let cached = try await model.catalog.playbackTracks(for: Array(albums.reversed()))
        XCTAssertEqual(cached.map(\.id), ["b1", "a1"])
        XCTAssertEqual(BulkTracksProtocol.state.count, 1)
    }

    func testLateAlbumQueueCannotReplaceANewerPlaybackChoice() async throws {
        let model = try model()
        defer { model.player.stop(); model.player.setForeground(false) }
        let request = Task { await model.playAlbums(albums) }
        try await waitForRequest()
        model.player.play([Track(id: "new", title: "New choice")])
        try BulkTracksProtocol.state.finish(tracks)
        await request.value
        XCTAssertEqual(model.player.current?.id, "new")
        XCTAssertNil(model.player.error)
    }

    func testPauseWhilePreparingCancelsThePendingPlaybackIntent() async throws {
        let model = try model()
        defer { model.player.stop(); model.player.setForeground(false) }
        model.player.play([Track(id: "old", title: "Current")])
        let request = Task { await model.playAlbums(albums) }
        try await waitForRequest()
        model.player.pause()
        try BulkTracksProtocol.state.finish(tracks)
        await request.value
        XCTAssertEqual(model.player.current?.id, "old")
        XCTAssertFalse(model.player.wantsPlayback)
    }

    func testIncompleteBulkResultKeepsThePreviousQueueAndReportsFailure() async throws {
        let model = try model()
        defer { model.player.stop(); model.player.setForeground(false) }
        model.player.play([Track(id: "old", title: "Current")])
        let request = Task { await model.playAlbums(albums) }
        try await waitForRequest()
        try BulkTracksProtocol.state.finish(Array(tracks.prefix(1)))
        await request.value
        XCTAssertEqual(model.player.current?.id, "old")
        XCTAssertEqual(model.player.error, L10n.text("mobile.incompleteQueue"))
    }
}
