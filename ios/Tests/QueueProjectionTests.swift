import XCTest
import SwiftUI
@testable import Mihonban

// This suite runs on both iPhone and iPad, including the native List workload.
extension PlayerTransitionTests {
    func testQueueRowsKeepTheirSnapshotWhilePlaybackAndEditsAdvance() throws {
        var queue = PlaybackQueue()
        XCTAssertTrue(queue.upcomingRows.isEmpty)
        let duplicate = Track(id: "repeat", title: "Repeated song")
        queue.replace([Track(id: "first", title: "First"), Track(id: "current", title: "Current"),
                       duplicate, duplicate, Track(id: "last", title: "Last")], startingAt: 1)
        let rows = queue.upcomingRows
        let originalIDs = rows.map(\.id)
        XCTAssertEqual(Array(rows.indices), [0, 1, 2])
        XCTAssertEqual(rows.map(\.offset), [0, 1, 2])
        XCTAssertEqual(rows.track(at: 0), rows.track(at: 1))
        XCTAssertNotEqual(rows[0].id, rows[1].id, "Repeated songs still need separate queue identities")
        XCTAssertEqual(rows.index(rows.endIndex, offsetBy: -2), 1)

        queue.moveUpcoming(entries: [rows[1].id], before: rows[0].id)
        queue.removeUpcoming(entries: [rows[0].id])
        queue.enqueue([Track(id: "appended", title: "Appended later")], next: false)
        XCTAssertEqual(queue.upcomingRows.map(\.id).prefix(2), [rows[1].id, rows[2].id])
        XCTAssertEqual(rows.map(\.id), originalIDs, "Captured callbacks retain their original index mapping")
        XCTAssertEqual(rows.map { rows.track(at: $0.offset).id }, ["repeat", "repeat", "last"])

        XCTAssertTrue(queue.advance())
        let afterAdvance = queue.order
        queue.moveUpcoming(entries: [rows[1].id], before: rows[2].id)
        queue.removeUpcoming(entries: [rows[1].id])
        XCTAssertEqual(queue.order, afterAdvance, "A captured upcoming row cannot move or delete the new current song")
        XCTAssertEqual(queue.current?.id, "repeat")

        queue.replace([duplicate, Track(id: "new", title: "New queue")], startingAt: 0)
        let replacement = queue.order
        queue.moveUpcoming(entries: [rows[2].id], before: nil)
        queue.removeUpcoming(entries: originalIDs)
        XCTAssertEqual(queue.order, replacement, "Old callbacks must not edit a replacement queue")
        XCTAssertTrue(queue.advance())
        XCTAssertTrue(queue.upcomingRows.isEmpty)
        XCTAssertEqual(queue.upcomingRows.startIndex, 0)
        XCTAssertEqual(queue.upcomingRows.endIndex, 0)
        XCTAssertEqual(rows.track(at: 2).title, "Last", "The old snapshot retains its own Track storage")
    }

    func testLargeQueueProjectionMeasuresIdentityAndVisibleTrackWork() {
        var queue = PlaybackQueue()
        queue.replace(queuePerformanceTracks(count: 20_001), startingAt: 0)
        let visibleCount = 40

        // Both workloads visit all identities, as List does. The old path also
        // copies every Track into Entry and then into an enumerated array.
        func eager() -> Int {
            let entries = Array(queue.upcomingEntries.enumerated())
            var digest = entries.reduce(0) { $0 &+ $1.element.id.slot &+ $1.offset }
            for (_, entry) in entries.prefix(visibleCount) { digest &+= entry.track.title.utf8.count }
            return digest
        }
        func projected() -> Int {
            let rows = queue.upcomingRows
            var digest = rows.reduce(0) { $0 &+ $1.id.slot &+ $1.offset }
            for row in rows.prefix(visibleCount) { digest &+= rows.track(at: row.offset).title.utf8.count }
            return digest
        }
        func timed(_ work: () -> Int) -> (Int, Double) {
            let start = DispatchTime.now().uptimeNanoseconds
            let digest = work()
            return (digest, Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
        }

        let expected = eager()
        XCTAssertEqual(projected(), expected)
        var eagerTimes: [Double] = []
        var projectionTimes: [Double] = []
        for sample in 0..<12 {
            let old: (Int, Double)
            let new: (Int, Double)
            if sample.isMultiple(of: 2) {
                old = timed(eager)
                new = timed(projected)
            } else {
                new = timed(projected)
                old = timed(eager)
            }
            XCTAssertEqual(old.0, expected)
            XCTAssertEqual(new.0, expected)
            eagerTimes.append(old.1)
            projectionTimes.append(new.1)
        }
        let eagerMedian = eagerTimes.sorted()[eagerTimes.count / 2]
        let projectionMedian = projectionTimes.sorted()[projectionTimes.count / 2]
        print("Queue projection: 20000 identities; eager 20000 Track copies plus 20000 enumerated entries; projected \(visibleCount) Track lookups; median eager=\(eagerMedian) ms, projected=\(projectionMedian) ms")
        // Native wall timings are evidence, not a hardware-dependent pass gate.
    }

    func testOpeningTenThousandSongQueueOnlyMaterializesNearbyTracks() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        let player = PlayerModel(monitorNetwork: false)
        let audio = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "tone", withExtension: "flac"))
        player.connect(try APIClient(address: "https://example.invalid"), demoURL: audio)
        player.play(queuePerformanceTracks(count: 10_001))
        player.pause()
        player.setForeground(false)
        let lookupStart = QueueView.rowTrackLookups
        let start = DispatchTime.now().uptimeNanoseconds
        let host = UIHostingController(rootView: QueueView(player: player))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        let initialLayoutMilliseconds = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
        defer {
            player.stop()
            window.isHidden = true
            window.rootViewController = nil
            previous?.makeKey()
        }
        try await Task.sleep(for: .milliseconds(500))
        host.view.layoutIfNeeded()
        let lookups = QueueView.rowTrackLookups - lookupStart
        print("Queue native List: 10000 upcoming songs, \(lookups) row Track lookups, initial layout=\(initialLayoutMilliseconds) ms")
        XCTAssertGreaterThan(lookups, 0, "The test must actually render queue rows")
        XCTAssertLessThan(lookups, 1_000, "Opening the queue must not materialize all 10000 Track values")
        XCTAssertEqual(player.queue.upcomingRows.count, 10_000)
    }

    private func queuePerformanceTracks(count: Int) -> [Track] {
        (0..<count).map {
            Track(id: "queue-\($0)", title: "Queue performance song number \($0)", duration: 8,
                  albumId: "album-\($0 / 10)", albumTitle: "Queue performance album \($0 / 10)",
                  artist: "Queue performance artist \($0 / 30)")
        }
    }
}
