import XCTest
import MediaPlayer
@testable import Mihonban

@MainActor
final class PlaybackCompletionTests: XCTestCase {
    private let tracks = [Track(id: "first", title: "First", duration: 8),
                          Track(id: "last", title: "Last", duration: 8)]

    private func player() throws -> PlayerModel {
        let value = PlayerModel(monitorNetwork: false)
        let audio = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "tone", withExtension: "flac"))
        value.connect(try APIClient(address: "https://example.invalid"), demoURL: audio)
        addTeardownBlock { await MainActor.run { value.stop(); value.setForeground(false) } }
        return value
    }

    private func finish(_ player: PlayerModel) async throws {
        try await waitUntil { !player.isLoading && player.elapsed > 0.1 }
        player.seek(to: player.duration - 0.2)
        try await waitUntil { player.hasEnded }
        XCTAssertFalse(player.wantsPlayback)
        XCTAssertFalse(player.isSeeking)
        XCTAssertEqual(player.elapsed, player.duration, accuracy: 0.05)
        XCTAssertEqual(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 0)
        try await Task.sleep(for: .milliseconds(650))
        XCTAssertEqual(player.elapsed, player.duration, accuracy: 0.05, "EOF remains stable across timer ticks")
    }

    func testPlayAfterRealEOFReopensTheLastTrackAndAdvancesTime() async throws {
        let value = try player()
        value.play(tracks, index: 1)
        try await finish(value)
        value.toggle()
        XCTAssertFalse(value.hasEnded)
        XCTAssertEqual(value.current?.id, "last")
        try await waitUntil { value.wantsPlayback && value.elapsed > 0.3 && value.elapsed < 3 }
        XCTAssertNil(value.error)
    }

    func testStoppingExpandedPlaybackClosesPresentationAndAllowsNewPlayback() async throws {
        let value = try player()
        for stopWhilePreparing in [true, false] {
            value.play([tracks[0]])
            value.isExpanded = true
            if !stopWhilePreparing { try await waitUntil { value.elapsed > 0.1 } }
            value.stop()
            XCTAssertFalse(value.isExpanded, "Stopping must release the expanded player's presentation state")
            XCTAssertNil(value.current)
            XCTAssertTrue(value.queue.tracks.isEmpty)
            XCTAssertFalse(value.wantsPlayback)
            XCTAssertFalse(value.isLoading)
            XCTAssertFalse(value.isSeeking)
            // Let cancelled preparation and old engine callbacks finish before
            // checking that the stopped player cannot reopen itself.
            try await Task.sleep(for: .milliseconds(200))
            XCTAssertFalse(value.isExpanded)
            XCTAssertNil(value.current)

            value.play([tracks[1]])
            XCTAssertFalse(value.isExpanded, "New playback starts with the mini-player")
            value.isExpanded = true
            try await waitUntil { value.current?.id == "last" && value.elapsed > 0.3 && !value.isLoading }
            XCTAssertTrue(value.isExpanded)
            XCTAssertTrue(value.wantsPlayback)
            XCTAssertNil(value.error)
        }
    }

    func testSeekBeforeFirstRenderKeepsPausedPositionAndThenPlaysFromIt() async throws {
        let value = try player()
        // Pause synchronously before asynchronous preparation can enqueue any
        // audio. Repeat with fresh decoders to exercise startup generations.
        for target in [2.0, 4.0, 1.0] {
            value.play([tracks[0]])
            value.pause()
            try await waitUntil { !value.isLoading && value.duration > 0 }
            value.seek(to: target)
            try await waitUntil { !value.isLoading && !value.isSeeking }
            XCTAssertFalse(value.wantsPlayback)
            XCTAssertEqual(value.elapsed, target, accuracy: 0.15)
            value.resume()
            try await waitUntil { value.elapsed > target + 0.3 && value.elapsed < target + 2 }
            XCTAssertNil(value.error)
        }
    }

    func testSeekingToThePausedPositionDoesNotWaitForAnAbsentCallback() async throws {
        let value = try player()
        value.play([tracks[0]])
        try await waitUntil { value.elapsed > 0.1 }
        value.pause()
        let position = value.elapsed
        value.seek(to: position)
        XCTAssertFalse(value.isSeeking, "The engine does not send didSeek for an unchanged frame")
        XCTAssertFalse(value.wantsPlayback)
        value.resume()
        try await waitUntil { value.elapsed > position + 0.4 && !value.isSeeking }
        XCTAssertNil(value.error)
    }

    func testPlayingClockRecoversAMissingSeekCallbackAndTrackChangesClearWaiting() async throws {
        let value = try player()
        value.play(tracks)
        try await waitUntil { value.elapsed > 0.1 }
        value.suppressSeekCompletionForTesting = true
        value.seek(to: 2)
        XCTAssertTrue(value.isSeeking)
        // Merely reporting the requested target cannot complete a seek: the
        // engine exposes that position while its decoder is still working.
        try await waitUntil { !value.isSeeking && value.elapsed > 2.3 }
        XCTAssertTrue(value.wantsPlayback)
        let position = value.elapsed
        try await waitUntil { value.elapsed > position + 0.4 }
        value.seek(to: 1)
        XCTAssertTrue(value.isSeeking)
        value.next()
        XCTAssertFalse(value.isSeeking, "A new decoder must not inherit the previous seek's spinner")
        try await waitUntil { value.current?.id == "last" && value.elapsed > 0.2 }
        XCTAssertNil(value.error)
    }

    func testRepeatedSeeksFinishAtTheLatestTargetWhilePaused() async throws {
        let value = try player()
        value.play([tracks[0]])
        try await waitUntil { value.elapsed > 0.1 }
        value.pause()
        value.setForeground(false)
        value.seek(to: 4)
        value.seek(to: 1)
        value.seek(to: 3)
        try await waitUntil { !value.isSeeking }
        XCTAssertEqual(value.elapsed, 3, accuracy: 0.15)
        XCTAssertFalse(value.wantsPlayback)
        value.resume()
        value.setForeground(true)
        try await waitUntil { value.elapsed > 3.3 && !value.isSeeking }
        XCTAssertNil(value.error)
    }

    func testPreviousAfterEOFReturnsToHistoryAndSingleTrackRestarts() async throws {
        let value = try player()
        value.play(tracks, index: 1)
        try await finish(value)
        value.previous()
        XCTAssertEqual(value.current?.id, "first")
        try await waitUntil { value.wantsPlayback && value.elapsed > 0.3 && value.elapsed < 3 }
        value.play([tracks[1]])
        try await finish(value)
        value.previous()
        XCTAssertEqual(value.current?.id, "last")
        try await waitUntil { value.wantsPlayback && value.elapsed > 0.3 && value.elapsed < 3 }
        XCTAssertNil(value.error)
    }

    func testManualNextAfterEOFStartsAnotherPassWithoutEnablingRepeat() async throws {
        let value = try player()
        value.play(tracks, index: 1)
        try await finish(value)
        value.next()
        XCTAssertEqual(value.current?.id, "first")
        XCTAssertEqual(value.queue.repeatMode, .off)
        try await waitUntil { value.wantsPlayback && value.elapsed > 0.3 && value.elapsed < 3 }
        XCTAssertNil(value.error)
    }

    func testSeekingAfterEOFKeepsPausedPositionAndThenResumes() async throws {
        let value = try player()
        value.play(tracks, index: 1)
        try await finish(value)
        value.seek(to: 3)
        try await waitUntil { !value.isLoading }
        XCTAssertFalse(value.hasEnded)
        XCTAssertFalse(value.wantsPlayback)
        XCTAssertEqual(value.elapsed, 3, accuracy: 0.15)
        value.resume()
        try await waitUntil { value.elapsed > 3.3 && value.elapsed < 6 }
        XCTAssertNil(value.error)
    }

    func testEnqueueAfterEOFWaitsForExplicitNext() async throws {
        let value = try player()
        value.play([tracks[0]])
        try await finish(value)
        value.enqueue([tracks[1]], next: false)
        XCTAssertTrue(value.hasEnded)
        XCTAssertFalse(value.wantsPlayback)
        value.next()
        XCTAssertEqual(value.current?.id, "last")
        try await waitUntil { value.wantsPlayback && value.elapsed > 0.3 && value.elapsed < 3 }
    }

    func testAutomaticRepeatStillContinuesAtTheEnd() async throws {
        let value = try player()
        value.cycleRepeat()
        value.play(tracks, index: 1)
        try await waitUntil { value.elapsed > 0.1 }
        value.seek(to: value.duration - 0.2)
        try await waitUntil { value.current?.id == "first" && value.elapsed > 0.1 }
        XCTAssertFalse(value.hasEnded)
        XCTAssertTrue(value.wantsPlayback)
        value.cycleRepeat()
        XCTAssertEqual(value.queue.repeatMode, .one)
        value.seek(to: value.duration - 0.2)
        try await waitUntil { value.current?.id == "first" && value.elapsed > 0.1 && value.elapsed < 3 && !value.isSeeking }
        XCTAssertFalse(value.hasEnded)
        XCTAssertTrue(value.wantsPlayback)
        XCTAssertNil(value.error)
    }

    private func waitUntil(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(15))
        while ContinuousClock.now < deadline {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTFail("Audio did not reach the expected completion or playback state", file: file, line: line)
        throw NSError(domain: "PlaybackCompletionTests", code: 1)
    }
}
