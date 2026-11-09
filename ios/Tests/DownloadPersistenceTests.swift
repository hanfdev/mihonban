import XCTest
@testable import Mihonban

// Pause the actual atomic writer while the main actor queues newer snapshots.
// The bounded wait prevents a failed assertion from stranding a worker thread.
private final class DownloadManifestGate: @unchecked Sendable {
    private let condition = NSCondition()
    private let heldCalls: Set<Int>
    private var released: Set<Int> = []
    private var releaseEverything = false
    private var started = 0
    private var completed = 0
    private var active = 0
    private var peakActive = 0
    private var timedOut = false
    private var wroteOnMainThread = false
    private var onOverlap: (@Sendable () -> Void)?

    init(holding calls: Set<Int>) { heldCalls = calls }

    var state: (started: Int, completed: Int, peakActive: Int, timedOut: Bool, wroteOnMainThread: Bool) {
        condition.lock()
        defer { condition.unlock() }
        return (started, completed, peakActive, timedOut, wroteOnMainThread)
    }

    func observeOverlap(_ callback: @escaping @Sendable () -> Void) {
        condition.lock()
        onOverlap = callback
        condition.unlock()
    }

    func release(_ call: Int? = nil) {
        condition.lock()
        if let call { released.insert(call) } else { releaseEverything = true }
        condition.broadcast()
        condition.unlock()
    }

    func write(_ manifest: DownloadManifest, _ directory: URL) {
        condition.lock()
        started += 1
        let call = started
        active += 1
        peakActive = max(peakActive, active)
        wroteOnMainThread = wroteOnMainThread || Thread.isMainThread
        let overlap = active > 1 ? onOverlap : nil
        condition.unlock()
        overlap?()
        condition.lock()
        let deadline = Date(timeIntervalSinceNow: 10)
        while heldCalls.contains(call) && !released.contains(call) && !releaseEverything {
            if !condition.wait(until: deadline) { timedOut = true; break }
        }
        condition.unlock()
        DownloadManifestStorage.persist(manifest, directory)
        condition.lock()
        active -= 1
        completed += 1
        condition.broadcast()
        condition.unlock()
    }
}

@MainActor
private final class DownloadPersistenceFixture {
    let root: URL
    let directory: URL
    let api: APIClient
    let engine: DownloadEngine
    let gate: DownloadManifestGate
    let storage: DownloadManifestStorage
    let removed: Track
    let kept: Track
    let audio: Data
    private var stores: [DownloadStore] = []

    init(holding calls: Set<Int>) throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("download-order-\(UUID().uuidString)")
        api = try APIClient(address: "https://download-order.invalid")
        engine = DownloadEngine(configuration: .ephemeral, root: root)
        gate = DownloadManifestGate(holding: calls)
        let gate = gate
        storage = DownloadManifestStorage(writeManifest: { manifest, directory in gate.write(manifest, directory) })
        directory = MediaPaths.downloads(root: root, service: MediaPaths.service(api.baseURL))
        removed = Track(id: "removed", title: "Remove this download", format: "flac", albumId: "album")
        kept = Track(id: "kept", title: "Keep this download", format: "flac", albumId: "album")
        let source = try XCTUnwrap(Bundle(for: OfflineLaunchTests.self).url(forResource: "tone", withExtension: "flac"))
        audio = try Data(contentsOf: source)
        let tracks = [removed, kept]
        let records = try tracks.map { track in
            let file = MediaPaths.audioName(track)
            let target = directory.appendingPathComponent("audio", isDirectory: true).appendingPathComponent(file)
            try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try audio.write(to: target)
            return DownloadRecord(track: track, albumID: "album", file: file, attempt: DownloadKey.newAttempt(),
                                  state: .done, written: Int64(audio.count), expected: Int64(audio.count), added: Date())
        }
        let album = Album(id: "album", title: "Saved album", artist: "Saved artist", tracks: tracks)
        DownloadManifestStorage.persist(DownloadManifest(records: records, albums: [album.id: album]), directory)
    }

    func store() -> DownloadStore {
        let value = DownloadStore(client: api, engine: engine, storage: storage)
        stores.append(value)
        return value
    }

    func cleanup() async {
        gate.release()
        stores.forEach { $0.detach() }
        _ = await storage.load(directory: directory)
        try? FileManager.default.removeItem(at: root)
    }

    func manifest() throws -> DownloadManifest {
        try JSONDecoder().decode(DownloadManifest.self,
                                 from: Data(contentsOf: directory.appendingPathComponent("manifest.json")))
    }
}

// OfflineLaunchTests is selected in both iPhone and iPad native validation.
extension OfflineLaunchTests {
    func testDownloadRemovalCannotBeOverwrittenByAnOlderManifestWrite() async throws {
        let fixture = try DownloadPersistenceFixture(holding: [1])
        addTeardownBlock { await fixture.cleanup() }
        let store = fixture.store()
        await store.load()
        XCTAssertEqual(store.records.count, 2)
        let removedFile = try XCTUnwrap(store.localFile(fixture.removed))

        // The older snapshot contains both tracks and has not reached disk yet.
        let older = Task { @MainActor in await store.flush() }
        try await waitForDownloadPersistence { fixture.gate.state.started == 1 }
        store.remove(fixture.removed.id)
        let overlap = expectation(description: "A newer write cannot enter while the older write is held")
        overlap.isInverted = true
        fixture.gate.observeOverlap { overlap.fulfill() }
        var newerStarted = false
        let newer = Task { @MainActor in
            newerStarted = true
            await store.flush()
        }
        try await waitForDownloadPersistence { newerStarted }
        await fulfillment(of: [overlap], timeout: 0.2)
        XCTAssertEqual(fixture.gate.state.completed, 0)
        XCTAssertNil(store.records[fixture.removed.id])
        fixture.gate.release()
        await older.value
        await newer.value

        let disk = try fixture.manifest()
        XCTAssertEqual(disk.records.map(\.id), [fixture.kept.id], "The last requested snapshot must win on disk")
        XCTAssertEqual(fixture.gate.state.peakActive, 1, "Atomic replacements for one manifest must never overlap")
        XCTAssertFalse(fixture.gate.state.timedOut)
        XCTAssertFalse(fixture.gate.state.wroteOnMainThread, "Encoding and disk writes must stay off the main thread")
        try await waitForDownloadPersistence { !FileManager.default.fileExists(atPath: removedFile.path) }

        store.detach()
        let reopened = fixture.store()
        await reopened.load()
        XCTAssertNil(reopened.records[fixture.removed.id], "A removed download must not reappear on relaunch")
        XCTAssertEqual(reopened.records[fixture.kept.id]?.state, .done)
        let keptFile = try XCTUnwrap(reopened.localFile(fixture.kept))
        XCTAssertEqual(try Data(contentsOf: keptFile), fixture.audio, "Unrelated downloaded audio must stay intact")
        XCTAssertEqual(reopened.albums["album"]?.title, "Saved album")
    }

    func testReplacementDownloadStoreWaitsForTheDetachedStoresFinalSnapshot() async throws {
        let fixture = try DownloadPersistenceFixture(holding: [2])
        addTeardownBlock { await fixture.cleanup() }
        let old = fixture.store()
        await old.load()
        await old.flush()
        XCTAssertEqual(try fixture.manifest().records.count, 2)

        // Detaching inside the debounce interval must still persist the removal.
        old.remove(fixture.removed.id)
        old.detach()
        try await waitForDownloadPersistence { fixture.gate.state.started == 2 }
        XCTAssertEqual(try fixture.manifest().records.count, 2, "The final write is deliberately held before replacing the old file")
        let replacement = fixture.store()
        let staleLoad = expectation(description: "A replacement load cannot finish while the detached snapshot is held")
        staleLoad.isInverted = true
        var checkingStaleLoad = true
        var loadStarted = false
        let loading = Task { @MainActor in
            loadStarted = true
            await replacement.load()
            if checkingStaleLoad { staleLoad.fulfill() }
        }
        try await waitForDownloadPersistence { loadStarted }
        await fulfillment(of: [staleLoad], timeout: 0.2)
        checkingStaleLoad = false
        XCTAssertFalse(replacement.loaded, "A replacement must not publish the stale manifest while its predecessor is writing")

        // Retired callers may not remove a surviving track or enqueue old data.
        old.remove(fixture.kept.id)
        await old.flush()
        fixture.gate.release()
        await loading.value
        XCTAssertTrue(replacement.loaded)
        XCTAssertNil(replacement.records[fixture.removed.id])
        XCTAssertEqual(replacement.records[fixture.kept.id]?.state, .done)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(replacement.localFile(fixture.kept))), fixture.audio)
        await replacement.flush()
        XCTAssertEqual(try fixture.manifest().records.map(\.id), [fixture.kept.id])
        XCTAssertEqual(fixture.gate.state.peakActive, 1)
        XCTAssertFalse(fixture.gate.state.timedOut)
        XCTAssertFalse(fixture.gate.state.wroteOnMainThread)
    }

    private func waitForDownloadPersistence(_ condition: () -> Bool,
                                            file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while ContinuousClock.now < deadline {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Download persistence did not reach the expected ordering boundary", file: file, line: line)
        throw NSError(domain: "DownloadPersistenceTests", code: 1)
    }
}
