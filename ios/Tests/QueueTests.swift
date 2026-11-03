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

    func testEnqueueNextAndLater() {
        var queue = PlaybackQueue()
        queue.replace(Array(tracks.prefix(3)), startingAt: 0)
        queue.enqueue([Track(id: "later", title: "Later")], next: false)
        queue.enqueue([Track(id: "soon", title: "Soon")], next: true)
        XCTAssertEqual(queue.current?.id, "0")
        XCTAssertEqual(queue.upcoming.map(\.id), ["soon", "1", "2", "later"])
        var empty = PlaybackQueue()
        empty.enqueue([Track(id: "only", title: "Only")], next: true)
        XCTAssertEqual(empty.current?.id, "only")
    }

    func testRemoveMoveAndJumpOnlyTouchUpcoming() {
        var queue = PlaybackQueue()
        queue.replace(Array(tracks.prefix(6)), startingAt: 1)
        queue.removeUpcoming(at: IndexSet([1]))
        XCTAssertEqual(queue.upcoming.map(\.id), ["2", "4", "5"])
        queue.moveUpcoming(from: IndexSet([2]), to: 0)
        XCTAssertEqual(queue.upcoming.map(\.id), ["5", "2", "4"])
        queue.moveUpcoming(from: IndexSet([0]), to: 3)
        XCTAssertEqual(queue.upcoming.map(\.id), ["2", "4", "5"])
        XCTAssertEqual(queue.current?.id, "1")
        XCTAssertTrue(queue.jumpToUpcoming(1))
        XCTAssertEqual(queue.current?.id, "4")
        XCTAssertEqual(queue.upcoming.map(\.id), ["5"])
        XCTAssertTrue(queue.previous())
        XCTAssertEqual(queue.current?.id, "1")
        XCTAssertFalse(queue.jumpToUpcoming(9))
    }

    func testShuffleOffKeepsQueueEdits() {
        var queue = PlaybackQueue()
        queue.replace(Array(tracks.prefix(5)), startingAt: 0, shuffle: true)
        queue.removeUpcoming(at: IndexSet(integer: queue.upcoming.firstIndex { $0.id == "3" }!))
        queue.setShuffle(false)
        XCTAssertEqual(queue.upcoming.map(\.id), ["1", "2", "4"])
    }
}
