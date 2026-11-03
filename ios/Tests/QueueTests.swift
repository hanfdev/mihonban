import XCTest
@testable import Mihonban

final class QueueTests: XCTestCase {
    private let tracks = (0..<8).map { Track(id: String($0), title: "Track \($0)") }

    func testSequentialQueueStopsAtEnd() {
        var queue = PlaybackQueue()
        queue.replace(tracks, startingAt: 6)
        XCTAssertEqual(queue.current?.id, "6")
        XCTAssertTrue(queue.advance())
        XCTAssertFalse(queue.advance())
        XCTAssertEqual(queue.current?.id, "7")
    }

    func testShuffleDoesNotReplayHistory() {
        var queue = PlaybackQueue()
        queue.replace(tracks, startingAt: 0)
        _ = queue.advance()
        queue.setShuffle(true)
        XCTAssertEqual(queue.current?.id, "1")
        var played = ["0", "1"]
        while queue.advance() { played.append(queue.current!.id) }
        XCTAssertEqual(Set(played).count, tracks.count)
        XCTAssertEqual(played.count, tracks.count)
        XCTAssertTrue(queue.previous())
        XCTAssertEqual(queue.current?.id, played[played.count - 2])
    }

    func testTurningShuffleOffPreservesActualHistory() {
        var queue = PlaybackQueue()
        queue.replace(tracks, startingAt: 0, shuffle: true)
        _ = queue.advance()
        let previous = queue.current?.id
        _ = queue.advance()
        let current = queue.current?.id
        queue.setShuffle(false)
        XCTAssertEqual(queue.current?.id, current)
        _ = queue.previous()
        XCTAssertEqual(queue.current?.id, previous)
    }

    func testRepeatOneDoesNotTrapManualNext() {
        var queue = PlaybackQueue()
        queue.replace(tracks, startingAt: 0)
        queue.repeatMode = .one
        XCTAssertTrue(queue.advance(automatic: true))
        XCTAssertEqual(queue.current?.id, "0")
        XCTAssertTrue(queue.advance())
        XCTAssertEqual(queue.current?.id, "1")
    }

    func testRepeatAllWrapsWithoutConsecutiveDuplicate() {
        for _ in 0..<30 {
            var queue = PlaybackQueue()
            queue.replace(tracks, startingAt: 0, shuffle: true)
            queue.repeatMode = .all
            for _ in 0..<7 { _ = queue.advance() }
            let last = queue.current?.id
            XCTAssertTrue(queue.advance())
            XCTAssertNotEqual(queue.current?.id, last)
        }
    }

    func testEmptyQueueNeverAdvances() {
        var queue = PlaybackQueue()
        queue.repeatMode = .all
        XCTAssertFalse(queue.advance())
        XCTAssertFalse(queue.previous())
        XCTAssertNil(queue.current)
    }

    func testPrefetchDoesNotAdvanceVisibleQueue() {
        var queue = PlaybackQueue()
        queue.replace(tracks, startingAt: 0)
        XCTAssertEqual(queue.nextSnapshot()?.current?.id, "1")
        XCTAssertEqual(queue.current?.id, "0")
    }
}
