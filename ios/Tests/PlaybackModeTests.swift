import XCTest
@testable import Mihonban

final class PlaybackModeTests: XCTestCase {
    private let tracks = (0..<8).map { Track(id: String($0), title: "Track \($0)") }

    func testEmptyQueueRemembersShuffleWithoutStarting() {
        var queue = PlaybackQueue()
        queue.setShuffle(true)
        XCTAssertTrue(queue.shuffled)
        XCTAssertNil(queue.current)
        XCTAssertTrue(queue.order.isEmpty)
        queue.replace(tracks, startingAt: 4)
        XCTAssertTrue(queue.shuffled)
        XCTAssertEqual(queue.current?.id, "4")
        XCTAssertEqual(queue.cursor, 0)
        XCTAssertEqual(Set(queue.upcoming.map(\.id)), Set(tracks.filter { $0.id != "4" }.map(\.id)))
        XCTAssertEqual(queue.upcoming.count, tracks.count - 1)
    }

    func testNewQueuesKeepTheChosenMode() {
        var queue = PlaybackQueue()
        queue.setShuffle(true)
        queue.replace(tracks, startingAt: 0)
        queue.replace(tracks, startingAt: 6)
        XCTAssertTrue(queue.shuffled)
        XCTAssertEqual(queue.current?.id, "6")
        XCTAssertEqual(Set(queue.order), Set(tracks.indices))
        queue.setShuffle(false)
        queue.replace(tracks, startingAt: 0)
        XCTAssertFalse(queue.shuffled)
        XCTAssertEqual(queue.order, Array(tracks.indices))
        queue.replace(tracks, startingAt: 3, shuffle: true)
        XCTAssertTrue(queue.shuffled)
        queue.replace(tracks, startingAt: 2, shuffle: false)
        XCTAssertFalse(queue.shuffled)
        XCTAssertEqual(queue.current?.id, "2")
        XCTAssertEqual(queue.upcoming.map(\.id), ["3", "4", "5", "6", "7"])
    }

    @MainActor
    func testPlayerShuffleDoesNotStartOrPrepareAudio() throws {
        let player = PlayerModel()
        player.connect(try APIClient(address: "https://example.invalid"))
        defer { player.stop(); player.setForeground(false) }
        player.toggleShuffle()
        XCTAssertTrue(player.queue.shuffled)
        XCTAssertFalse(player.wantsPlayback)
        XCTAssertFalse(player.isLoading)
        XCTAssertNil(player.current)
        XCTAssertNil(player.preparedNextID)
        player.toggleShuffle()
        XCTAssertFalse(player.queue.shuffled)
        XCTAssertFalse(player.wantsPlayback)
        XCTAssertNil(player.current)
    }
}
