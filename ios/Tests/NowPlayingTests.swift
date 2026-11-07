import XCTest
import MediaPlayer
import UIKit
import AVFAudio
@testable import Mihonban

// The system can ask for lock-screen artwork on a non-main queue. The box
// transfers the immutable artwork without claiming that the player is Sendable.
private final class ArtworkBox: @unchecked Sendable {
    let value: MPMediaItemArtwork
    init(_ value: MPMediaItemArtwork) { self.value = value }
}

@MainActor
final class NowPlayingTests: XCTestCase {
    func testBackgroundTimelineUsesEngineTimeWithoutForegroundTicks() async throws {
        let player = PlayerModel(monitorNetwork: false)
        let audio = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "tone", withExtension: "flac"))
        player.connect(try APIClient(address: "https://example.invalid"), demoURL: audio)
        player.setForeground(false)
        defer { player.stop(); player.setForeground(false) }
        // No duration in catalog metadata, and the screen is already locked
        // before preparation finishes. The engine must supply the real duration.
        player.play([Track(id: "locked", title: "Background timeline")])
        try await waitForTimeline { $0.duration > 7.5 && $0.rate == 1 }
        try await Task.sleep(for: .milliseconds(700))
        player.pause()
        try await waitForTimeline { $0.elapsed > 0.4 && $0.rate == 0 }
        let paused = try XCTUnwrap(systemTimeline()).elapsed
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(try XCTUnwrap(systemTimeline()).elapsed, paused, accuracy: 0.05)
        player.resume()
        try await waitForTimeline { $0.rate == 1 }
        try await Task.sleep(for: .milliseconds(700))
        // A lock/route metadata refresh must use the current engine position,
        // not reset the system clock to the last foreground UI sample.
        player.setForeground(false)
        try await waitForTimeline { $0.elapsed > paused + 0.4 && $0.rate == 1 }
        XCTAssertGreaterThan(player.duration, 7.5, "background preparation must also enable accurate remote seeking")
        XCTAssertNil(player.error)
    }

    func testBackgroundSeekKeepsTheSystemClockRunning() async throws {
        let player = PlayerModel(monitorNetwork: false)
        let audio = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "tone", withExtension: "flac"))
        player.connect(try APIClient(address: "https://example.invalid"), demoURL: audio)
        player.setForeground(false)
        defer { player.stop(); player.setForeground(false) }
        player.play([Track(id: "seek", title: "Remote seek")])
        try await waitForTimeline { $0.rate == 1 && $0.duration > 7.5 }
        player.seek(to: 3)
        try await waitForTimeline { $0.elapsed >= 2.9 && $0.rate == 1 && !player.isSeeking }
        try await Task.sleep(for: .milliseconds(700))
        player.pause()
        try await waitForTimeline { $0.elapsed > 3.4 && $0.rate == 0 }
        player.seek(to: 1)
        try await waitForTimeline { abs($0.elapsed - 1) < 0.2 && $0.rate == 0 && !player.isSeeking }
        player.resume()
        try await waitForTimeline { $0.rate == 1 }
        XCTAssertNil(player.error)
    }

    func testTimelineKeepsSeekTargetAndIgnoresStaleDecoderAcrossTrackChanges() {
        let seeking = NowPlayingTimeline.capture(elapsed: 30, duration: 100, engineTime: 10, engineDuration: 100,
            playing: true, wantsPlayback: true, loading: false, seeking: true, ended: false)
        XCTAssertEqual(seeking.elapsed, 30)
        XCTAssertEqual(seeking.rate, 1)
        let loading = NowPlayingTimeline.capture(elapsed: 0, duration: 200, engineTime: 99, engineDuration: 100,
            playing: true, wantsPlayback: true, loading: true, seeking: false, ended: false)
        XCTAssertEqual(loading, NowPlayingTimeline(elapsed: 0, duration: 200, rate: 0))
        let ended = NowPlayingTimeline.capture(elapsed: 200, duration: 200, engineTime: 0, engineDuration: nil,
            playing: true, wantsPlayback: false, loading: false, seeking: false, ended: true)
        XCTAssertEqual(ended, NowPlayingTimeline(elapsed: 200, duration: 200, rate: 0))
    }

    private func systemTimeline() -> NowPlayingTimeline? {
        guard let info = MPNowPlayingInfoCenter.default().nowPlayingInfo,
              let elapsed = info[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double,
              let duration = info[MPMediaItemPropertyPlaybackDuration] as? Double,
              let rate = info[MPNowPlayingInfoPropertyPlaybackRate] as? Double else { return nil }
        return NowPlayingTimeline(elapsed: elapsed, duration: duration, rate: rate)
    }

    private func waitForTimeline(_ predicate: (NowPlayingTimeline) -> Bool,
                                 file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while ContinuousClock.now < deadline {
            if let value = systemTimeline(), predicate(value) { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTFail("System playback timeline did not reach the expected state", file: file, line: line)
        throw NSError(domain: "NowPlayingTests", code: 1)
    }

    func testArtworkCanBeRequestedOffMainThread() async throws {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { context in
            UIColor.orange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
        }
        let artwork = ArtworkBox(NowPlayingBridge.artwork(image))
        let requested = expectation(description: "Artwork requested from a system callback queue")
        DispatchQueue.global(qos: .userInitiated).async {
            let result = artwork.value.image(at: CGSize(width: 32, height: 32))
            XCTAssertNotNil(result)
            requested.fulfill()
        }
        await fulfillment(of: [requested], timeout: 10)
    }
}
