import XCTest
import UIKit
@testable import Mihonban

// Cover responses remain held until the test explicitly chooses their order.
private final class DownloadCoverProtocol: URLProtocol {
    final class Gate: @unchecked Sendable {
        private let lock = NSLock()
        private var requests: [String: [DownloadCoverProtocol]] = [:]
        private var arrivals: [String: [Int: XCTestExpectation]] = [:]
        private var stopped: Set<ObjectIdentifier> = []

        func expect(_ host: String, index: Int) -> XCTestExpectation {
            let expected = XCTestExpectation(description: "Cover request \(index) reached the protocol")
            lock.withLock { arrivals[host, default: [:]][index] = expected }
            return expected
        }

        func add(_ request: DownloadCoverProtocol) {
            let arrived = lock.withLock { () -> XCTestExpectation? in
                let host = request.request.url!.host!
                let index = requests[host]?.count ?? 0
                requests[host, default: []].append(request)
                return arrivals[host]?[index]
            }
            arrived?.fulfill()
        }

        func stop(_ request: DownloadCoverProtocol) {
            lock.withLock { _ = stopped.insert(ObjectIdentifier(request)) }
        }

        func count(_ host: String) -> Int { lock.withLock { requests[host]?.count ?? 0 } }

        func finish(_ host: String, index: Int, data: Data) {
            let request = lock.withLock { () -> DownloadCoverProtocol? in
                guard let values = requests[host], values.indices.contains(index) else { return nil }
                let value = values[index]
                guard stopped.insert(ObjectIdentifier(value)).inserted else { return nil }
                return value
            }
            request?.respond(data, status: 200)
        }

        func remove(_ host: String) {
            lock.withLock {
                for request in requests.removeValue(forKey: host) ?? [] {
                    stopped.remove(ObjectIdentifier(request))
                }
                arrivals.removeValue(forKey: host)
            }
        }
    }
    static let gate = Gate()
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host?.hasPrefix("download-cover-") == true
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() { Self.gate.stop(self) }
    override func startLoading() {
        if request.url?.path.contains("/api/art/") == true { Self.gate.add(self) }
        else { respond(Data("{}".utf8), status: 404) }
    }
    private func respond(_ data: Data, status: Int) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                       headerFields: ["Content-Type": status == 200 ? "image/png" : "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}

// Hold one real file operation off MainActor, with a bounded teardown escape.
private final class DownloadCoverFileGate: @unchecked Sendable {
    let entered = XCTestExpectation(description: "Cover file operation reached its boundary")
    private let condition = NSCondition()
    private let stage: DownloadFileStage?
    private var released = false
    private var held = false
    private var timedOut = false
    private var usedMainThread = false

    init(stage: DownloadFileStage? = nil) { self.stage = stage }

    var state: (held: Bool, timedOut: Bool, usedMainThread: Bool) {
        condition.lock()
        defer { condition.unlock() }
        return (held, timedOut, usedMainThread)
    }

    func observe(_ target: URL, _ actual: DownloadFileStage) {
        condition.lock()
        defer { condition.unlock() }
        usedMainThread = usedMainThread || Thread.isMainThread
        let matches: Bool
        switch (stage, actual) {
        case (.committing?, .committing), (.removing?, .removing): matches = true
        default: matches = false
        }
        guard matches, !held, !released else { return }
        held = true
        entered.fulfill()
        let deadline = Date(timeIntervalSinceNow: 10)
        while !released {
            if !condition.wait(until: deadline) { timedOut = true; break }
        }
    }

    func release() {
        condition.lock()
        released = true
        condition.broadcast()
        condition.unlock()
    }
}

@MainActor
private final class DownloadCoverFixture {
    let host = "download-cover-\(UUID().uuidString.lowercased()).invalid"
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("download-cover-\(UUID().uuidString)")
    let api: APIClient
    let engine: DownloadEngine
    let storage = DownloadManifestStorage()
    let fileGate: DownloadCoverFileGate
    let album: Album
    let red: Data
    let green: Data
    private var stores: [DownloadStore] = []
    private var tasks: [Task<Void, Never>] = []

    var cover: URL { MediaPaths.pinnedCover(baseURL: api.baseURL, album: album.id, root: root) }
    var directory: URL { MediaPaths.downloads(root: root, service: MediaPaths.service(api.baseURL)) }

    init(stage: DownloadFileStage? = nil) throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DownloadCoverProtocol.self]
        api = try APIClient(address: "https://" + host, session: URLSession(configuration: configuration))
        fileGate = DownloadCoverFileGate(stage: stage)
        let gate = fileGate
        engine = DownloadEngine(configuration: configuration, root: root,
                                observeCoverStage: { target, stage in gate.observe(target, stage) })
        album = Album(id: "cover-album", title: "Cover lifecycle", artist: "Fixture artist", tracks: [
            Track(id: "first", title: "First", format: "flac"),
            Track(id: "second", title: "Second", format: "flac")
        ])
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8))
        red = renderer.pngData { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        green = renderer.pngData { context in
            UIColor.green.setFill(); context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
    }

    func seed(_ states: [DownloadRecord.State], pinnedCover: Bool = true) throws {
        let source = try XCTUnwrap(Bundle(for: OfflineLaunchTests.self).url(forResource: "tone", withExtension: "flac"))
        let audio = try Data(contentsOf: source)
        let records = try zip(album.normalizedTracks, states).map { track, state in
            let file = MediaPaths.audioName(track)
            if state == .done {
                let path = directory.appendingPathComponent("audio").appendingPathComponent(file)
                try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
                try audio.write(to: path)
            }
            return DownloadRecord(track: track, albumID: album.id, file: file, attempt: DownloadKey.newAttempt(),
                                  state: state, written: state == .done ? Int64(audio.count) : 0,
                                  expected: Int64(audio.count), added: Date())
        }
        DownloadManifestStorage.persist(DownloadManifest(records: records, albums: [album.id: album]), directory)
        if pinnedCover {
            try FileManager.default.createDirectory(at: cover.deletingLastPathComponent(), withIntermediateDirectories: true)
            try green.write(to: cover)
        }
    }

    func store() async -> DownloadStore {
        let store = DownloadStore(client: api, engine: engine, storage: storage)
        stores.append(store)
        await store.load()
        return store
    }

    func begin(_ store: DownloadStore) -> (Task<Void, Never>, XCTestExpectation, Int) {
        let index = DownloadCoverProtocol.gate.count(host)
        let arrived = DownloadCoverProtocol.gate.expect(host, index: index)
        let task = Task { await store.download(album: album) }
        tasks.append(task)
        return (task, arrived, index)
    }

    func finish(_ index: Int, data: Data) { DownloadCoverProtocol.gate.finish(host, index: index, data: data) }

    func cleanup() async {
        fileGate.release()
        stores.forEach { $0.detach() }
        tasks.forEach { $0.cancel() }
        api.session.invalidateAndCancel()
        for task in tasks { await task.value }
        let keys = await engine.liveKeys()
        keys.forEach { engine.cancel($0) }
        await engine.waitForFileOperations()
        _ = await storage.load(directory: directory)
        DownloadCoverProtocol.gate.remove(host)
        try? FileManager.default.removeItem(at: root)
    }

    func assertFileWorkIsSafe(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertFalse(fileGate.state.timedOut, "The test must release its file gate", file: file, line: line)
        XCTAssertFalse(fileGate.state.usedMainThread, "Cover file operations must stay off MainActor", file: file, line: line)
    }
}

extension OfflineLaunchTests {
    private func waitForCoverRequest(_ expectation: XCTestExpectation, fixture: DownloadCoverFixture,
                                     index: Int) async throws {
        await fulfillment(of: [expectation], timeout: 5)
        guard DownloadCoverProtocol.gate.count(fixture.host) > index else {
            throw NSError(domain: "DownloadCoverLifecycleTests", code: 1)
        }
    }

    func testDelayedDownloadedCoverCannotReturnAfterAlbumRemoval() async throws {
        let fixture = try DownloadCoverFixture()
        addTeardownBlock { await fixture.cleanup() }
        let store = await fixture.store()
        let (pending, arrived, index) = fixture.begin(store)
        try await waitForCoverRequest(arrived, fixture: fixture, index: index)
        XCTAssertFalse(store.records.isEmpty)
        store.remove(album: fixture.album.id)
        await fixture.engine.waitForFileOperations()
        fixture.finish(index, data: fixture.red)
        await pending.value
        await fixture.engine.waitForFileOperations()

        XCTAssertTrue(store.records.isEmpty)
        XCTAssertNil(store.albums[fixture.album.id])
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.cover.path), "A deleted download cannot regain its cover")
        fixture.assertFileWorkIsSafe()
    }

    func testImmediateRedownloadKeepsTheLatestCoverWhenOldResponseArrivesLast() async throws {
        let fixture = try DownloadCoverFixture()
        addTeardownBlock { await fixture.cleanup() }
        let store = await fixture.store()
        let (old, oldArrival, oldIndex) = fixture.begin(store)
        try await waitForCoverRequest(oldArrival, fixture: fixture, index: oldIndex)
        store.remove(album: fixture.album.id)
        let (new, newArrival, newIndex) = fixture.begin(store)
        try await waitForCoverRequest(newArrival, fixture: fixture, index: newIndex)
        fixture.finish(newIndex, data: fixture.green)
        await new.value
        XCTAssertEqual(try Data(contentsOf: fixture.cover), fixture.green)
        fixture.finish(oldIndex, data: fixture.red)
        await old.value
        await fixture.engine.waitForFileOperations()

        XCTAssertEqual(try Data(contentsOf: fixture.cover), fixture.green, "An earlier attempt cannot overwrite the replacement cover")
        XCTAssertNotNil(store.albums[fixture.album.id])
        XCTAssertEqual(store.records.count, 2)
        fixture.assertFileWorkIsSafe()
    }

    func testRemovingTheLastDownloadedTrackAlsoRemovesItsCover() async throws {
        let fixture = try DownloadCoverFixture()
        addTeardownBlock { await fixture.cleanup() }
        try fixture.seed([.done, .done])
        let store = await fixture.store()
        store.remove("first")
        await fixture.engine.waitForFileOperations()
        XCTAssertEqual(try Data(contentsOf: fixture.cover), fixture.green, "A remaining download still owns the album cover")
        XCTAssertEqual(store.records["second"]?.state, .done)
        store.remove("second")
        await fixture.engine.waitForFileOperations()
        await store.flush()

        XCTAssertTrue(store.records.isEmpty)
        XCTAssertNil(store.albums[fixture.album.id])
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.cover.path))
        store.detach()
        let reopened = await fixture.store()
        XCTAssertTrue(reopened.records.isEmpty)
        XCTAssertNil(reopened.albums[fixture.album.id])
        fixture.assertFileWorkIsSafe()
    }

    func testCancellingUnfinishedTracksPreservesTheCompletedAlbumCover() async throws {
        let fixture = try DownloadCoverFixture()
        addTeardownBlock { await fixture.cleanup() }
        try fixture.seed([.done, .interrupted])
        let store = await fixture.store()
        let completed = try XCTUnwrap(store.localFile(fixture.album.normalizedTracks[0]))
        store.cancel(album: fixture.album.id)
        await fixture.engine.waitForFileOperations()

        XCTAssertEqual(Set(store.records.keys), ["first"])
        XCTAssertEqual(store.records["first"]?.state, .done)
        XCTAssertNotNil(store.albums[fixture.album.id])
        XCTAssertTrue(FileManager.default.fileExists(atPath: completed.path))
        XCTAssertEqual(try Data(contentsOf: fixture.cover), fixture.green)
        XCTAssertEqual(store.state(album: fixture.album), .partial)
        fixture.assertFileWorkIsSafe()
    }

    func testDetachedDownloadStoreCannotOverwriteAReplacementStoresCover() async throws {
        let fixture = try DownloadCoverFixture()
        addTeardownBlock { await fixture.cleanup() }
        let original = await fixture.store()
        let (old, oldArrival, oldIndex) = fixture.begin(original)
        try await waitForCoverRequest(oldArrival, fixture: fixture, index: oldIndex)
        original.detach()
        let replacement = await fixture.store()
        let (new, newArrival, newIndex) = fixture.begin(replacement)
        try await waitForCoverRequest(newArrival, fixture: fixture, index: newIndex)
        fixture.finish(newIndex, data: fixture.green)
        await new.value
        fixture.finish(oldIndex, data: fixture.red)
        await old.value
        await fixture.engine.waitForFileOperations()

        XCTAssertEqual(try Data(contentsOf: fixture.cover), fixture.green)
        XCTAssertEqual(replacement.records.count, 2)
        replacement.detach()
        await fixture.engine.waitForFileOperations()
        XCTAssertEqual(try Data(contentsOf: fixture.cover), fixture.green, "Detaching preserves already committed offline artwork")
        fixture.assertFileWorkIsSafe()
    }

    func testCoverCommitAndRemovalOrderingPreservesTheReplacementFile() async throws {
        for stage in [DownloadFileStage.committing, .removing] {
            let fixture = try DownloadCoverFixture(stage: stage)
            addTeardownBlock { await fixture.cleanup() }
            let oldAttempt = UUID(), newAttempt = UUID()
            fixture.engine.prepareCover(fixture.cover, attempt: oldAttempt)
            let oldWrite = Task { await fixture.engine.saveCover(fixture.red, to: fixture.cover, attempt: oldAttempt) }
            if case .removing = stage {
                await oldWrite.value
                XCTAssertEqual(try Data(contentsOf: fixture.cover), fixture.red)
                fixture.engine.removeCover(fixture.cover)
            }
            await fulfillment(of: [fixture.fileGate.entered], timeout: 5)
            guard fixture.fileGate.state.held else {
                fixture.fileGate.release()
                await oldWrite.value
                throw NSError(domain: "DownloadCoverLifecycleTests", code: 2)
            }
            if case .committing = stage { fixture.engine.removeCover(fixture.cover) }
            fixture.engine.prepareCover(fixture.cover, attempt: newAttempt)
            let replacement = Task { await fixture.engine.saveCover(fixture.green, to: fixture.cover, attempt: newAttempt) }
            fixture.fileGate.release()
            await oldWrite.value
            await replacement.value
            await fixture.engine.waitForFileOperations()
            XCTAssertEqual(try Data(contentsOf: fixture.cover), fixture.green)

            // A late store retirement or write cannot erase or replace the newer claim.
            fixture.engine.retireCover(fixture.cover, attempt: oldAttempt)
            await fixture.engine.saveCover(fixture.red, to: fixture.cover, attempt: oldAttempt)
            await fixture.engine.waitForFileOperations()
            XCTAssertEqual(try Data(contentsOf: fixture.cover), fixture.green)
            fixture.assertFileWorkIsSafe()
        }
    }
}
