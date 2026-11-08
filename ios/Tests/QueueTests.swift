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
        XCTAssertFalse(queue.restart())
        XCTAssertNil(queue.current)
    }

    func testExplicitRestartPreservesEditedShuffleOrderAndRepeatMode() {
        var queue = PlaybackQueue()
        queue.replace(tracks, startingAt: 2, shuffle: true)
        queue.removeUpcoming(at: IndexSet(integer: 0))
        queue.moveUpcoming(from: IndexSet(integer: 2), to: 0)
        let order = queue.order
        while queue.advance(automatic: true) {}
        XCTAssertTrue(queue.restart())
        XCTAssertEqual(queue.current?.id, tracks[order[0]].id)
        XCTAssertEqual(queue.order, order)
        XCTAssertTrue(queue.shuffled)
        XCTAssertEqual(queue.repeatMode, .off)
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

    func testEntryIdentitySurvivesMovesAndDistinguishesDuplicates() {
        var queue = PlaybackQueue()
        queue.replace([tracks[0], tracks[1], tracks[1], tracks[2]], startingAt: 0)
        let before = queue.upcomingEntries
        XCTAssertEqual(Set(before.map(\.id)).count, 3)
        XCTAssertEqual(before[0].track.id, before[1].track.id)
        queue.moveUpcoming(entries: [before[1].id], before: before[0].id)
        XCTAssertEqual(queue.upcomingEntries.map(\.id), [before[1].id, before[0].id, before[2].id])
        XCTAssertEqual(queue.current?.id, "0")
        queue.removeUpcoming(entries: [before[0].id])
        XCTAssertEqual(queue.upcomingEntries.map(\.id), [before[1].id, before[2].id])
        queue.setShuffle(true)
        XCTAssertEqual(Set(queue.upcomingEntries.map(\.id)), Set([before[1].id, before[2].id]))
        queue.setShuffle(false)
        XCTAssertEqual(queue.upcomingEntries.map(\.id), [before[1].id, before[2].id])
    }

    func testStaleDragNeverMovesThePlayingEntryOrANewQueue() {
        var queue = PlaybackQueue()
        queue.replace(tracks, startingAt: 0)
        let before = queue.upcomingEntries
        XCTAssertTrue(queue.advance())
        let remaining = queue.upcomingEntries.map(\.id)
        queue.moveUpcoming(entries: [before[0].id], before: nil)
        XCTAssertEqual(queue.upcomingEntries.map(\.id), remaining)
        queue.removeUpcoming(entries: [before[0].id])
        XCTAssertEqual(queue.current?.id, "1")
        queue.replace(tracks, startingAt: 0)
        let fresh = queue.upcomingEntries.map(\.id)
        queue.moveUpcoming(entries: [before[2].id], before: nil)
        XCTAssertEqual(queue.upcomingEntries.map(\.id), fresh)
        XCTAssertNil(queue.upcomingOffset(for: before[2].id))
    }

    func testStableMoveMatchesIndexMoveInBothDirections() {
        for source in 0..<7 {
            for destination in 0...7 {
                var expected = PlaybackQueue()
                expected.replace(tracks, startingAt: 0)
                var actual = expected
                let entries = actual.upcomingEntries
                expected.moveUpcoming(from: IndexSet(integer: source), to: destination)
                actual.moveUpcoming(entries: [entries[source].id], before: destination < entries.count ? entries[destination].id : nil)
                XCTAssertEqual(actual.order, expected.order, "\(source) to \(destination)")
            }
        }
    }

    func testShuffleOffKeepsQueueEdits() {
        var queue = PlaybackQueue()
        queue.replace(Array(tracks.prefix(5)), startingAt: 0, shuffle: true)
        queue.removeUpcoming(at: IndexSet(integer: queue.upcoming.firstIndex { $0.id == "3" }!))
        queue.setShuffle(false)
        XCTAssertEqual(queue.upcoming.map(\.id), ["1", "2", "4"])
    }
}

// Keep these regressions in the playback suite exercised on both device sizes.
extension PlaybackCompletionTests {
    private var shuffleBoundaryTracks: [Track] {
        (0..<8).map { Track(id: String($0), title: "Track \($0)") }
    }

    func testShuffleRepeatSnapshotsAgreeWithAdvanceAcrossCycles() throws {
        var queue = PlaybackQueue(shuffleSeed: 42)
        queue.replace(shuffleBoundaryTracks, startingAt: 0, shuffle: true)
        queue.repeatMode = .all
        while queue.cursor + 1 < queue.order.count { XCTAssertTrue(queue.advance()) }
        var cycleOrders: Set<[Int]> = []

        for _ in 0..<6 {
            let oldOrder = queue.order
            let oldCursor = queue.cursor
            let last = queue.current?.id
            let planned = try XCTUnwrap(queue.nextSnapshot())
            for _ in 0..<4 {
                XCTAssertEqual(queue.nextSnapshot()?.order, planned.order)
                XCTAssertEqual(queue.order, oldOrder, "Prefetch must not change the visible queue")
                XCTAssertEqual(queue.cursor, oldCursor)
            }
            var manual = queue
            XCTAssertTrue(manual.advance())
            XCTAssertTrue(queue.advance(automatic: true))
            XCTAssertEqual(manual.order, planned.order)
            XCTAssertEqual(queue.order, planned.order)
            XCTAssertEqual(queue.current?.id, planned.current?.id)
            XCTAssertNotEqual(queue.current?.id, last)
            XCTAssertEqual(Set(queue.order), Set(oldOrder))
            cycleOrders.insert(queue.order)

            // Gapless playback adopts the prefetched snapshot; direct playback
            // advances the live queue. Both must also agree on the next cycle.
            var adopted = planned
            while queue.cursor + 1 < queue.order.count {
                XCTAssertTrue(queue.advance())
                XCTAssertTrue(adopted.advance())
            }
            XCTAssertEqual(queue.nextSnapshot()?.order, adopted.nextSnapshot()?.order)
        }
        XCTAssertGreaterThan(cycleOrders.count, 1, "Later cycles must continue to reshuffle")
    }

    func testShuffleRepeatPlanningPreservesQueueEditsAndHistory() throws {
        var queue = PlaybackQueue(shuffleSeed: 12)
        queue.replace(shuffleBoundaryTracks, startingAt: 0, shuffle: true)
        queue.repeatMode = .all
        XCTAssertTrue(queue.advance())
        let history = Array(queue.order.prefix(queue.cursor + 1))
        let removed = try XCTUnwrap(queue.upcomingEntries.first)
        queue.removeUpcoming(entries: [removed.id])
        let first = try XCTUnwrap(queue.upcomingEntries.first)
        let last = try XCTUnwrap(queue.upcomingEntries.last)
        queue.moveUpcoming(entries: [last.id], before: first.id)
        queue.enqueue([Track(id: "added", title: "Added")], next: false)
        XCTAssertEqual(Array(queue.order.prefix(queue.cursor + 1)), history)
        let editedOrder = queue.order
        while queue.cursor + 1 < queue.order.count { XCTAssertTrue(queue.advance()) }
        let planned = try XCTUnwrap(queue.nextSnapshot())
        XCTAssertEqual(queue.nextSnapshot()?.order, planned.order)
        XCTAssertEqual(Set(planned.order), Set(editedOrder))
        XCTAssertEqual(planned.order.count, editedOrder.count)
        XCTAssertFalse(planned.order.contains(removed.id.slot))
        XCTAssertTrue(queue.advance(automatic: true))
        XCTAssertEqual(queue.order, planned.order)
    }

    func testShuffleRepeatPlanningDoesNotConsumeRandomnessWhenRepeatChanges() throws {
        var queue = PlaybackQueue(shuffleSeed: 93)
        queue.replace(shuffleBoundaryTracks, startingAt: 0, shuffle: true)
        while queue.cursor + 1 < queue.order.count { XCTAssertTrue(queue.advance()) }
        queue.repeatMode = .all
        let planned = try XCTUnwrap(queue.nextSnapshot())
        queue.repeatMode = .one
        XCTAssertEqual(queue.nextSnapshot()?.current?.id, queue.current?.id)
        XCTAssertEqual(queue.nextSnapshot()?.order, queue.order)
        queue.repeatMode = .off
        XCTAssertNil(queue.nextSnapshot())
        queue.repeatMode = .all
        XCTAssertEqual(queue.nextSnapshot()?.order, planned.order)
        XCTAssertTrue(queue.advance(automatic: true))
        XCTAssertEqual(queue.order, planned.order)
    }

    func testShuffleRepeatAvoidsDuplicateSongAtCycleBoundaryWhenPossible() throws {
        let duplicates = (0..<8).map { Track(id: String($0 % 3), title: "Duplicate \($0 % 3)") }
        for seed in UInt64(0)..<16 {
            var queue = PlaybackQueue(shuffleSeed: seed)
            queue.replace(duplicates, startingAt: 0, shuffle: true)
            queue.repeatMode = .all
            while queue.cursor + 1 < queue.order.count { XCTAssertTrue(queue.advance()) }
            let last = queue.current?.id
            let planned = try XCTUnwrap(queue.nextSnapshot())
            XCTAssertNotEqual(planned.current?.id, last)
            XCTAssertTrue(queue.advance(automatic: true))
            XCTAssertEqual(queue.order, planned.order)
            XCTAssertEqual(Set(queue.order), Set(duplicates.indices))
        }
        var sameSong = PlaybackQueue(shuffleSeed: 3)
        sameSong.replace(Array(repeating: duplicates[0], count: 2), startingAt: 0, shuffle: true)
        sameSong.repeatMode = .all
        XCTAssertTrue(sameSong.advance())
        XCTAssertTrue(sameSong.advance(automatic: true), "Repeated copies of one song must remain playable")
        XCTAssertEqual(sameSong.current?.id, duplicates[0].id)
    }
}
