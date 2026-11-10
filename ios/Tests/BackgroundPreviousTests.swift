import XCTest
import MediaPlayer
@testable import Mihonban

extension NowPlayingTests {
    private func backgroundPreviousPlayer() throws -> PlayerModel {
        let player = PlayerModel(monitorNetwork: false)
        let audio = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "tone", withExtension: "flac"))
        player.connect(try APIClient(address: "https://example.invalid"), demoURL: audio)
        player.setForeground(false)
        addTeardownBlock { await MainActor.run { player.stop(); player.setForeground(false) } }
        player.play([
            Track(id: "background-history", title: "Previous track"),
            Track(id: "background-current", title: "Current track")
        ], index: 1)
        return player
    }

    private func backgroundPreviousTimeline() -> NowPlayingTimeline? {
        guard let info = MPNowPlayingInfoCenter.default().nowPlayingInfo,
              let elapsed = info[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double,
              let duration = info[MPMediaItemPropertyPlaybackDuration] as? Double,
              let rate = info[MPNowPlayingInfoPropertyPlaybackRate] as? Double else { return nil }
        return NowPlayingTimeline(elapsed: elapsed, duration: duration, rate: rate)
    }

    private func waitForBackgroundPrevious(_ predicate: () -> Bool,
                                          file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while ContinuousClock.now < deadline {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Background Previous did not reach the expected playback state", file: file, line: line)
        throw NSError(domain: "BackgroundPreviousTests", code: 1)
    }

    private func requireBackgroundPrevious(_ condition: Bool, _ message: String,
                                          file: StaticString = #filePath, line: UInt = #line) throws {
        guard condition else {
            XCTFail(message, file: file, line: line)
            throw NSError(domain: "BackgroundPreviousTests", code: 2)
        }
    }

    func testBackgroundPreviousUsesTheAdvancingEngineClockInsteadOfTheFrozenUIPosition() async throws {
        let player = try backgroundPreviousPlayer()
        try await waitForBackgroundPrevious {
            self.backgroundPreviousTimeline().map { $0.rate == 1 && $0.duration > 7.5 } == true && !player.isLoading
        }
        // Let initial rendering and metadata callbacks settle before measuring
        // the stale UI anchor. The real decoder continues with its timer off.
        try await Task.sleep(for: .milliseconds(200))
        try await waitForBackgroundPrevious {
            player.setForeground(false)
            return player.elapsed > 0.05
        }
        try requireBackgroundPrevious(player.elapsed > 0.05 && player.elapsed < 3,
                                      "Actual rendering must have advanced, but not yet reached three seconds")
        let frozenPosition = player.elapsed
        try await Task.sleep(for: .milliseconds(3500))
        try requireBackgroundPrevious(player.current?.id == "background-current" && !player.hasEnded &&
                                      player.wantsPlayback && !player.isLoading && player.elapsed < 3 &&
                                      abs(player.elapsed - frozenPosition) < 0.05,
                                      "The real track must still be playing while its UI position remains frozen below three seconds")

        player.previous()

        XCTAssertEqual(player.current?.id, "background-current", "Previous after three seconds restarts the current track")
        try await waitForBackgroundPrevious {
            self.backgroundPreviousTimeline().map { $0.elapsed < 0.5 && $0.rate == 1 } == true && !player.isSeeking
        }
        player.setForeground(true)
        try await waitForBackgroundPrevious { player.elapsed > 0.3 && player.elapsed < 2 }
        XCTAssertEqual(player.current?.id, "background-current")
        XCTAssertTrue(player.wantsPlayback)
        XCTAssertNil(player.error)
    }

    func testBackgroundPreviousNearTheStartReturnsToQueueHistory() async throws {
        let player = try backgroundPreviousPlayer()
        try await waitForBackgroundPrevious {
            self.backgroundPreviousTimeline().map { $0.rate == 1 && $0.duration > 7.5 } == true && !player.isLoading
        }

        player.previous()

        XCTAssertEqual(player.current?.id, "background-history")
        player.setForeground(true)
        try await waitForBackgroundPrevious { !player.isLoading && player.elapsed > 0.3 && player.elapsed < 2 }
        XCTAssertEqual(player.current?.id, "background-history")
        XCTAssertTrue(player.wantsPlayback)
        XCTAssertNil(player.error)
    }

    func testBackgroundPreviousAfterThreeSecondsRestartsWithoutResumingAnExplicitPause() async throws {
        let player = try backgroundPreviousPlayer()
        try await waitForBackgroundPrevious {
            self.backgroundPreviousTimeline().map { $0.rate == 1 && $0.duration > 7.5 } == true && !player.isLoading
        }
        player.seek(to: 4)
        try await waitForBackgroundPrevious {
            self.backgroundPreviousTimeline().map { $0.elapsed >= 3.9 && $0.rate == 1 } == true &&
                !player.isLoading && !player.isSeeking
        }
        try await Task.sleep(for: .milliseconds(350))
        player.pause()
        try requireBackgroundPrevious(player.elapsed > 4.1 && !player.wantsPlayback && !player.hasEnded,
                                      "Actual playback must have advanced past the seek target before pausing")

        player.previous()

        try await waitForBackgroundPrevious {
            self.backgroundPreviousTimeline().map { $0.elapsed < 0.2 && $0.rate == 0 } == true && !player.isSeeking
        }
        XCTAssertEqual(player.current?.id, "background-current")
        XCTAssertFalse(player.wantsPlayback)
        let pausedPosition = player.elapsed
        try await Task.sleep(for: .milliseconds(350))
        XCTAssertEqual(player.elapsed, pausedPosition, accuracy: 0.05)
        XCTAssertEqual(try XCTUnwrap(backgroundPreviousTimeline()).rate, 0)
        player.resume()
        player.setForeground(true)
        try await waitForBackgroundPrevious { player.elapsed > 0.3 && player.elapsed < 2 }
        XCTAssertEqual(player.current?.id, "background-current")
        XCTAssertTrue(player.wantsPlayback)
        XCTAssertNil(player.error)
    }
}
