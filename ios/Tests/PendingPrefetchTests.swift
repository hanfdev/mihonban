import XCTest
@testable import Mihonban

// These real-decoder regressions run in the completion suite on both devices.
extension PlaybackCompletionTests {
    private func heldPrefetchPlayer(includeLater: Bool = false) async throws -> (PlayerModel, String) {
        let token = UUID().uuidString
        let api = try APIClient(address: "http://127.0.0.1:8766")
        _ = try await api.login(password: "fixture-password")
        let name = "org.mihonban.pending-prefetch.\(token)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        let settings = CacheSettings(defaults: defaults)
        settings.enabled = false
        settings.preloadPolicy = .always
        let player = PlayerModel(monitorNetwork: false)
        player.cache = settings
        player.updatePreloadNetwork(PreloadNetwork(connected: true, wifiOrEthernet: true))
        player.connect(api)
        addTeardownBlock {
            await MainActor.run {
                player.stop(); player.setForeground(false)
                UserDefaults(suiteName: name)?.removePersistentDomain(forName: name)
            }
            try? await Self.releasePrefetch(token)
        }
        var tracks = [Track(id: "network-flac-current-\(token)", title: "Current", duration: 8, format: "flac"),
                      Track(id: "network-flac-held-\(token)", title: "Held", duration: 8, format: "flac")]
        if includeLater {
            tracks.append(Track(id: "network-flac-later-\(token)", title: "Later", duration: 8, format: "flac"))
        }
        player.play(tracks)
        try await waitForPrefetchState { player.elapsed > 0.1 && !player.isLoading }
        player.seek(to: player.duration - 0.2)
        try await waitForPrefetchState { player.isWaitingForNextForTesting }
        XCTAssertFalse(player.hasEnded)
        XCTAssertTrue(player.wantsPlayback)
        XCTAssertNil(player.preparedNextID, "The server is holding the next decoder's response")
        return (player, token)
    }

    private static func releasePrefetch(_ token: String) async throws {
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:8766/fixture/stream-gate/\(token)/release"))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    }

    func testRemovingHeldNextAtRealEOFSettlesAndCanReplay() async throws {
        let (player, token) = try await heldPrefetchPlayer()
        let current = player.current?.id
        player.removeUpcoming(at: IndexSet(integer: 0))
        XCTAssertTrue(player.hasEnded, "Removing the pending final entry must settle the exhausted decoder")
        XCTAssertFalse(player.wantsPlayback)
        XCTAssertFalse(player.isWaitingForNextForTesting)
        XCTAssertEqual(player.elapsed, player.duration, accuracy: 0.05)
        try await Self.releasePrefetch(token)
        player.resume()
        try await waitForPrefetchState { player.elapsed > 0.3 && player.elapsed < 3 && !player.isLoading }
        XCTAssertEqual(player.current?.id, current)
        XCTAssertTrue(player.wantsPlayback)
        XCTAssertFalse(player.hasEnded)
        XCTAssertNil(player.error)
    }

    func testReorderingHeldNextAtRealEOFStartsTheReplacement() async throws {
        let (player, token) = try await heldPrefetchPlayer(includeLater: true)
        player.moveUpcoming(from: IndexSet(integer: 1), to: 0)
        try await waitForPrefetchState { player.current?.title == "Later" && player.elapsed > 0.3 }
        XCTAssertFalse(player.isWaitingForNextForTesting)
        try await Self.releasePrefetch(token)
        let position = player.elapsed
        try await waitForPrefetchState { player.elapsed > position + 0.4 }
        XCTAssertEqual(player.current?.title, "Later", "A cancelled preparation must not replace the edited current track")
        XCTAssertTrue(player.wantsPlayback)
        XCTAssertFalse(player.hasEnded)
        XCTAssertNil(player.error)
    }

    func testEditingLaterEntryAtRealEOFKeepsThePendingNext() async throws {
        let (player, token) = try await heldPrefetchPlayer(includeLater: true)
        player.removeUpcoming(at: IndexSet(integer: 1))
        XCTAssertTrue(player.isWaitingForNextForTesting)
        XCTAssertEqual(player.current?.title, "Current")
        try await Self.releasePrefetch(token)
        try await waitForPrefetchState { player.current?.title == "Held" && player.elapsed > 0.3 }
        XCTAssertFalse(player.isWaitingForNextForTesting)
        XCTAssertTrue(player.wantsPlayback)
        XCTAssertFalse(player.hasEnded)
        XCTAssertNil(player.error)
    }

    private func waitForPrefetchState(_ predicate: () -> Bool,
                                      file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(15))
        while ContinuousClock.now < deadline {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTFail("Playback did not reach the expected pending-prefetch boundary", file: file, line: line)
        throw NSError(domain: "PendingPrefetchTests", code: 1)
    }
}
