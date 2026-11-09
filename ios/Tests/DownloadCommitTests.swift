import XCTest
@testable import Mihonban

// Hold the real delegate or file queue at an ordering boundary. The deadline
// also releases a worker if a failed test cannot reach its normal cleanup.
private final class DownloadCommitGate: @unchecked Sendable {
    private let condition = NSCondition()
    private let track: String
    private let heldStage: DownloadFileStage?
    private var released = false
    private var holding = false
    private var timedOut = false
    private var touchedMainThread = false
    private var observed: Set<DownloadKey> = []
    private var validated: Set<DownloadKey> = []

    init(track: String, stage: DownloadFileStage?) {
        self.track = track
        heldStage = stage
    }

    var state: (holding: Bool, timedOut: Bool, touchedMainThread: Bool, keys: Set<DownloadKey>, validated: Set<DownloadKey>) {
        condition.lock()
        defer { condition.unlock() }
        return (holding, timedOut, touchedMainThread, observed, validated)
    }

    func observe(_ key: DownloadKey, _ stage: DownloadFileStage) {
        condition.lock()
        defer { condition.unlock() }
        observed.insert(key)
        touchedMainThread = touchedMainThread || Thread.isMainThread
        if case .validated = stage { validated.insert(key) }
        guard key.track == track, let heldStage, matches(stage, heldStage), !released else { return }
        holding = true
        let deadline = Date(timeIntervalSinceNow: 15)
        while !released {
            if !condition.wait(until: deadline) { timedOut = true; break }
        }
        holding = false
    }

    func release() {
        condition.lock()
        released = true
        condition.broadcast()
        condition.unlock()
    }

    private func matches(_ first: DownloadFileStage, _ second: DownloadFileStage) -> Bool {
        switch (first, second) {
        case (.validated, .validated), (.committing, .committing), (.removing, .removing): true
        default: false
        }
    }
}

private final class DownloadCommitEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var terminal: [DownloadKey: DownloadEvent] = [:]

    func record(_ event: DownloadEvent) {
        if case .progress = event { return }
        lock.lock()
        terminal[event.key] = event
        lock.unlock()
    }

    func event(for key: DownloadKey) -> DownloadEvent? {
        lock.lock()
        defer { lock.unlock() }
        return terminal[key]
    }
}

@MainActor
private final class DownloadCommitFixture {
    let root: URL
    let directory: URL
    let api: APIClient
    let engine: DownloadEngine
    let storage = DownloadManifestStorage()
    let gate: DownloadCommitGate
    let events = DownloadCommitEvents()
    let target: Track
    let kept: Track
    let album: Album
    let audio: Data
    private var stores: [DownloadStore] = []
    private var externalSessions: [URLSession] = []
    private var externalKeys: Set<DownloadKey> = []

    init(holding stage: DownloadFileStage?, seedTarget: Bool = false) throws {
        let identifier = UUID().uuidString
        root = FileManager.default.temporaryDirectory.appendingPathComponent("download-commit-\(identifier)")
        api = try APIClient(address: "http://127.0.0.1:8766")
        target = Track(id: "network-flac-race-\(identifier)", title: "Download under test", format: "flac", albumId: "target")
        kept = Track(id: "kept-\(identifier)", title: "Keep this download", format: "flac", albumId: "kept")
        album = Album(id: "target", title: "Download under test", artist: "Fixture artist", tracks: [target])
        gate = DownloadCommitGate(track: target.id, stage: stage)
        let gate = gate
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        engine = DownloadEngine(configuration: configuration, root: root) { key, stage in gate.observe(key, stage) }
        directory = MediaPaths.downloads(root: root, service: MediaPaths.service(api.baseURL))
        let source = try XCTUnwrap(Bundle(for: OfflineLaunchTests.self).url(forResource: "tone", withExtension: "flac"))
        audio = try Data(contentsOf: source)
        let tracks = seedTarget ? [kept, target] : [kept]
        let records = try tracks.map { track in
            let file = MediaPaths.audioName(track)
            let destination = directory.appendingPathComponent("audio", isDirectory: true).appendingPathComponent(file)
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try audio.write(to: destination)
            return DownloadRecord(track: track, albumID: track.albumId ?? "kept", file: file,
                                  attempt: DownloadKey.newAttempt(), state: .done,
                                  written: Int64(audio.count), expected: Int64(audio.count), added: Date())
        }
        let keptAlbum = Album(id: "kept", title: "Unrelated album", artist: "Fixture artist", tracks: [kept])
        var albums = [keptAlbum.id: keptAlbum]
        if seedTarget { albums[album.id] = album }
        DownloadManifestStorage.persist(DownloadManifest(records: records, albums: albums), directory)
    }

    func store(client: APIClient? = nil) async -> DownloadStore {
        let store = DownloadStore(client: client ?? api, engine: engine, storage: storage)
        stores.append(store)
        await store.load()
        return store
    }

    func key(_ record: DownloadRecord) -> DownloadKey {
        DownloadKey(service: MediaPaths.service(api.baseURL), file: record.file, attempt: record.attempt, track: record.id)
    }

    func recordTerminalEvents() {
        let events = events
        engine.attach { events.record($0) }
    }

    // This session deliberately bypasses start/liveKeys, reproducing the
    // delegate's missing in-memory ownership after a background relaunch.
    func startUnregisteredDownload() -> DownloadKey {
        let key = DownloadKey(service: MediaPaths.service(api.baseURL), file: MediaPaths.audioName(target),
                              attempt: DownloadKey.newAttempt(), track: target.id)
        let delegateQueue = OperationQueue()
        delegateQueue.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: .ephemeral, delegate: engine, delegateQueue: delegateQueue)
        externalSessions.append(session)
        externalKeys.insert(key)
        let task = session.downloadTask(with: api.url("media", "tone.flac"))
        task.taskDescription = key.text
        task.resume()
        return key
    }

    func assertUnrelatedFileIntact(in store: DownloadStore, file: StaticString = #filePath, line: UInt = #line) throws {
        XCTAssertEqual(store.records[kept.id]?.state, .done, file: file, line: line)
        let path = try XCTUnwrap(store.localFile(kept), file: file, line: line)
        XCTAssertEqual(try Data(contentsOf: path), audio, file: file, line: line)
        XCTAssertFalse(gate.state.timedOut, "The test must release every ordering gate", file: file, line: line)
        XCTAssertFalse(gate.state.touchedMainThread, "Download validation and file work must stay off the main thread", file: file, line: line)
    }

    func cleanup() async {
        // Detaching stops pending stream resolution from starting another task.
        // Retire all known attempts before removing the root, so even a late
        // delegate cannot recreate a destination after teardown.
        var keys = Set(stores.flatMap { $0.records.values.map(key) })
        stores.forEach { $0.detach() }
        keys.formUnion(gate.state.keys)
        keys.formUnion(externalKeys)
        keys.forEach { engine.cancel($0) }
        gate.release()
        externalSessions.forEach { $0.invalidateAndCancel() }
        // Querying URLSession may need its delegate queue, so never do that
        // while a test deliberately holds one of its callbacks.
        let live = await engine.liveKeys()
        live.forEach { engine.cancel($0) }
        await engine.waitForFileOperations()
        _ = await storage.load(directory: directory)
        try? FileManager.default.removeItem(at: root)
    }
}

// OfflineLaunchTests is selected in both iPhone and iPad native validation.
extension OfflineLaunchTests {
    func testCancelAfterDownloadValidationCannotLeaveAnOrphanedAudioFile() async throws {
        let fixture = try DownloadCommitFixture(holding: .validated)
        addTeardownBlock { await fixture.cleanup() }
        _ = try await fixture.api.login(password: "fixture-password")
        let store = await fixture.store()
        await store.download(album: fixture.album)
        try await waitForDownloadCommit { fixture.gate.state.holding }
        let key = fixture.key(try XCTUnwrap(store.records[fixture.target.id]))
        let destination = fixture.engine.destination(key)

        // Cancellation wins before the delegate can enter the file queue.
        fixture.recordTerminalEvents()
        store.cancel(fixture.target.id)
        await fixture.engine.waitForFileOperations()
        XCTAssertNil(store.records[fixture.target.id])
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        fixture.gate.release()
        try await waitForDownloadCommit { fixture.events.event(for: key) != nil }
        await fixture.engine.waitForFileOperations()

        if case .cancelled? = fixture.events.event(for: key) {} else {
            XCTFail("A retired completion must report cancellation, never success")
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path), "A late delegate must not recreate removed audio")
        try fixture.assertUnrelatedFileIntact(in: store)
    }

    func testRemoveDuringDownloadCommitDeletesTheCompletedFile() async throws {
        let fixture = try DownloadCommitFixture(holding: .committing)
        addTeardownBlock { await fixture.cleanup() }
        _ = try await fixture.api.login(password: "fixture-password")
        let store = await fixture.store()
        await store.download(album: fixture.album)
        try await waitForDownloadCommit { fixture.gate.state.holding }
        let key = fixture.key(try XCTUnwrap(store.records[fixture.target.id]))
        let destination = fixture.engine.destination(key)

        fixture.recordTerminalEvents()
        store.remove(fixture.target.id)
        XCTAssertNil(store.records[fixture.target.id], "Removing a row must not wait for disk work")
        let prematureDrain = expectation(description: "Removal cannot finish while the older commit is held")
        prematureDrain.isInverted = true
        var observingDrain = true
        var drainStarted = false
        let drain = Task { @MainActor in
            drainStarted = true
            await fixture.engine.waitForFileOperations()
            if observingDrain { prematureDrain.fulfill() }
        }
        try await waitForDownloadCommit { drainStarted }
        await fulfillment(of: [prematureDrain], timeout: 0.2)
        observingDrain = false
        fixture.gate.release()
        await drain.value
        try await waitForDownloadCommit { fixture.events.event(for: key) != nil }

        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path), "Removal queued during a commit must run after it")
        XCTAssertNil(store.records[fixture.target.id])
        try fixture.assertUnrelatedFileIntact(in: store)
    }

    func testImmediateRedownloadSurvivesOldRemovalAndStaleCancellation() async throws {
        let fixture = try DownloadCommitFixture(holding: .removing, seedTarget: true)
        addTeardownBlock { await fixture.cleanup() }
        _ = try await fixture.api.login(password: "fixture-password")
        let store = await fixture.store()
        let oldKey = fixture.key(try XCTUnwrap(store.records[fixture.target.id]))
        store.remove(fixture.target.id)
        try await waitForDownloadCommit { fixture.gate.state.holding }

        await store.download(album: fixture.album)
        let newKey = fixture.key(try XCTUnwrap(store.records[fixture.target.id]))
        XCTAssertNotEqual(oldKey.attempt, newKey.attempt)
        try await waitForDownloadCommit { fixture.gate.state.validated.contains(newKey) }
        XCTAssertEqual(store.records[fixture.target.id]?.state, .downloading)
        fixture.gate.release()
        try await waitForDownloadCommit { store.records[fixture.target.id]?.state == .done }
        await fixture.engine.waitForFileOperations()
        let destination = try XCTUnwrap(store.localFile(fixture.target))
        XCTAssertEqual(try Data(contentsOf: destination), fixture.audio)

        // An old cancellation arriving after replacement must not claim its file.
        fixture.engine.cancel(oldKey)
        await fixture.engine.waitForFileOperations()
        XCTAssertEqual(store.records[fixture.target.id]?.attempt, newKey.attempt)
        XCTAssertEqual(store.records[fixture.target.id]?.state, .done)
        XCTAssertEqual(try Data(contentsOf: destination), fixture.audio, "A stale attempt must never unlink the replacement")
        try fixture.assertUnrelatedFileIntact(in: store)
    }

    func testRestoredDownloadCanCommitWithoutAnInMemoryRunningTask() async throws {
        let fixture = try DownloadCommitFixture(holding: nil)
        addTeardownBlock { await fixture.cleanup() }
        fixture.recordTerminalEvents()
        let key = fixture.startUnregisteredDownload()
        try await waitForDownloadCommit { fixture.events.event(for: key) != nil }
        await fixture.engine.waitForFileOperations()
        if case .finished(_, let bytes)? = fixture.events.event(for: key) {
            XCTAssertEqual(bytes, Int64(fixture.audio.count))
        } else {
            XCTFail("A valid restored callback must be accepted before a store or liveKeys attaches")
        }
        XCTAssertEqual(try Data(contentsOf: fixture.engine.destination(key)), fixture.audio)
        XCTAssertTrue(fixture.gate.state.validated.contains(key), "Exercise the actual URLSession download delegate")
        XCTAssertFalse(fixture.gate.state.touchedMainThread)
        XCTAssertFalse(fixture.gate.state.timedOut)
    }

    func testRetryThatFailsBeforeTransferStillRemovesPreviousAudio() async throws {
        let fixture = try DownloadCommitFixture(holding: nil)
        addTeardownBlock { await fixture.cleanup() }
        _ = try await fixture.api.login(password: "fixture-password")
        let original = await fixture.store()
        await original.download(album: fixture.album)
        try await waitForDownloadCommit { original.records[fixture.target.id]?.state == .done }
        var failed = try XCTUnwrap(original.records[fixture.target.id])
        let previousKey = fixture.key(failed)
        let destination = fixture.engine.destination(previousKey)
        XCTAssertEqual(try Data(contentsOf: destination), fixture.audio)

        // Reproduce a failure after the move succeeded but file attributes did
        // not: the previous attempt owns real bytes while its row is failed.
        failed.state = .failed
        failed.status = -1
        let records = original.records.values.map { $0.id == failed.id ? failed : $0 }
        let snapshot = DownloadManifest(records: records, albums: original.albums)
        original.detach()
        await fixture.storage.save(snapshot, directory: fixture.directory).value

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [UnreachableProtocol.self]
        let offlineSession = URLSession(configuration: configuration)
        addTeardownBlock { offlineSession.invalidateAndCancel() }
        let offlineAPI = try APIClient(address: fixture.api.baseURL.absoluteString, session: offlineSession)
        let replacement = await fixture.store(client: offlineAPI)
        XCTAssertEqual(replacement.records[fixture.target.id]?.state, .failed)
        replacement.retry(fixture.target.id)
        let retryKey = fixture.key(try XCTUnwrap(replacement.records[fixture.target.id]))
        XCTAssertNotEqual(retryKey.attempt, previousKey.attempt)
        try await waitForDownloadCommit { replacement.records[fixture.target.id]?.state == .failed }
        XCTAssertEqual(replacement.records[fixture.target.id]?.status, URLError.notConnectedToInternet.rawValue)
        XCTAssertFalse(fixture.gate.state.validated.contains(retryKey), "The retry never reached a download delegate")

        replacement.remove(fixture.target.id)
        await fixture.engine.waitForFileOperations()
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path), "A queued retry must own cleanup even if resolving its address fails")
        XCTAssertNil(replacement.records[fixture.target.id])
        try fixture.assertUnrelatedFileIntact(in: replacement)
    }

    func testBackgroundCompletionWaitsForPendingAudioRemoval() async throws {
        let fixture = try DownloadCommitFixture(holding: .removing, seedTarget: true)
        addTeardownBlock { await fixture.cleanup() }
        let store = await fixture.store()
        let key = fixture.key(try XCTUnwrap(store.records[fixture.target.id]))
        let destination = fixture.engine.destination(key)
        store.remove(fixture.target.id)
        try await waitForDownloadCommit { fixture.gate.state.holding }

        let prematureFinish = expectation(description: "Background completion cannot precede the queued deletion")
        prematureFinish.isInverted = true
        let finished = expectation(description: "Background completion runs after deletion")
        let observingFinish = DownloadBackgroundFinishObservation(premature: prematureFinish, finished: finished)
        fixture.engine.setFinishEvents { observingFinish.finish() }
        fixture.engine.urlSessionDidFinishEvents(forBackgroundURLSession: URLSession.shared)
        await fulfillment(of: [prematureFinish], timeout: 0.2)
        XCTAssertTrue(FileManager.default.fileExists(atPath: destination.path), "The actual deletion is still held")
        observingFinish.stopObservingPrematureFinish()
        fixture.gate.release()
        await fulfillment(of: [finished], timeout: 5)

        XCTAssertTrue(observingFinish.finishedOnMainThread)
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path), "The system must not suspend before file retirement finishes")
        try fixture.assertUnrelatedFileIntact(in: store)
    }

    private func waitForDownloadCommit(_ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while ContinuousClock.now < deadline {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Download commit did not reach the expected ordering boundary", file: file, line: line)
        throw NSError(domain: "DownloadCommitTests", code: 1)
    }
}

private final class DownloadBackgroundFinishObservation: @unchecked Sendable {
    private let lock = NSLock()
    private let premature: XCTestExpectation
    private let finished: XCTestExpectation
    private var observingPremature = true
    private var usedMainThread = false

    init(premature: XCTestExpectation, finished: XCTestExpectation) {
        self.premature = premature
        self.finished = finished
    }

    var finishedOnMainThread: Bool {
        lock.lock()
        defer { lock.unlock() }
        return usedMainThread
    }

    func stopObservingPrematureFinish() {
        lock.lock()
        observingPremature = false
        lock.unlock()
    }

    func finish() {
        lock.lock()
        usedMainThread = Thread.isMainThread
        let isPremature = observingPremature
        lock.unlock()
        if isPremature { premature.fulfill() }
        finished.fulfill()
    }
}
