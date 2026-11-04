import XCTest
import MediaPlayer
@testable import Mihonban

@MainActor
final class NetworkPlaybackTests: XCTestCase {
    func testAuthenticatedStreamingWithArtworkForAllFormats() async throws {
        let api = try APIClient(address: "http://127.0.0.1:8766")
        api.clearCookies()
        let session = try await api.login(password: "fixture-password")
        XCTAssertTrue(session.ok)
        let library = try await api.library(previous: nil)
        XCTAssertEqual(library.albums.count, 3)
        let player = PlayerModel()
        let defaultsName = "org.mihonban.network-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: defaultsName))
        let preferences = CacheSettings(defaults: defaults)
        preferences.preloadNext = false
        preferences.enabled = false
        player.cache = preferences
        player.connect(api)
        defer {
            player.stop()
            player.setForeground(false)
            defaults.removePersistentDomain(forName: defaultsName)
        }
        for album in library.albums {
            let detail = try await api.album(album.id)
            player.play(detail.normalizedTracks)
            try await waitUntil { player.elapsed > 0.5 && !player.isLoading }
            XCTAssertNil(player.error, album.id)
            try await waitUntil {
                MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork] != nil
            }
            player.pause()
            try await Task.sleep(for: .milliseconds(650))
            let paused = player.elapsed
            try await Task.sleep(for: .milliseconds(800))
            XCTAssertEqual(player.elapsed, paused, accuracy: 0.15, album.id)
            player.seek(to: 3)
            try await waitUntil { !player.isSeeking && player.elapsed >= 2.8 }
            player.resume()
            try await waitUntil { player.elapsed > 3.5 }
            XCTAssertNil(player.error, album.id)
            player.stop()
        }
    }

    // Shuffle and repeat only change what follows. The playing decoder stays,
    // and the prefetched next track always matches the edited queue.
    func testShuffleAndRepeatKeepTheCurrentTrackPlaying() async throws {
        let api = try APIClient(address: "http://127.0.0.1:8766")
        api.clearCookies()
        _ = try await api.login(password: "fixture-password")
        var tracks: [Track] = []
        for album in try await api.library(previous: nil).albums {
            tracks += try await api.album(album.id).normalizedTracks
        }
        XCTAssertGreaterThanOrEqual(tracks.count, 3)
        let player = PlayerModel()
        let defaultsName = "org.mihonban.network-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: defaultsName))
        let preferences = CacheSettings(defaults: defaults)
        preferences.preloadNext = true
        preferences.enabled = false
        player.cache = preferences
        player.connect(api)
        defer {
            player.stop()
            player.setForeground(false)
            defaults.removePersistentDomain(forName: defaultsName)
        }
        player.play(tracks)
        try await waitUntil { player.elapsed > 0.3 && !player.isLoading }
        try await waitUntil { player.preparedNextID != nil }
        XCTAssertEqual(player.preparedNextID, player.queue.nextSnapshot()?.current?.id)
        let playing = player.current?.id
        let start = player.elapsed

        player.toggleShuffle()
        XCTAssertFalse(player.isLoading, "changing the order keeps the playing decoder")
        XCTAssertEqual(player.current?.id, playing)
        try await waitUntil { player.preparedNextID != nil && player.preparedNextID == player.queue.nextSnapshot()?.current?.id }

        player.cycleRepeat()
        XCTAssertEqual(player.queue.repeatMode, .all)
        XCTAssertFalse(player.isLoading)
        player.cycleRepeat()
        XCTAssertEqual(player.queue.repeatMode, .one)
        XCTAssertFalse(player.isLoading)
        // Repeating one track has no different next track to prefetch.
        XCTAssertNil(player.preparedNextID)
        player.cycleRepeat()
        XCTAssertEqual(player.queue.repeatMode, .off)
        try await waitUntil { player.preparedNextID != nil && player.preparedNextID == player.queue.nextSnapshot()?.current?.id }

        try await Task.sleep(for: .milliseconds(600))
        XCTAssertGreaterThan(player.elapsed, start + 0.4, "playback continued through every change")
        XCTAssertEqual(player.current?.id, playing)
        XCTAssertFalse(player.isLoading)
        XCTAssertNil(player.error)
    }

    private func waitUntil(_ predicate: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(20))
        while ContinuousClock.now < deadline {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTFail("Playback did not reach the expected state", file: file, line: line)
        throw NSError(domain: "NetworkPlaybackTests", code: 1)
    }
}
