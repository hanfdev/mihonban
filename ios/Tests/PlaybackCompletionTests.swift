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
