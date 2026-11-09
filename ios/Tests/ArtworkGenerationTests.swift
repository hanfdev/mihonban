import XCTest
import UIKit
@testable import Mihonban

private final class ArtworkGenerationProtocol: URLProtocol {
    final class Gate: @unchecked Sendable {
        private let lock = NSLock()
        private var requests: [String: [ArtworkGenerationProtocol]] = [:]
        private var stopped: Set<ObjectIdentifier> = []

        func add(_ connection: ArtworkGenerationProtocol) {
            lock.withLock { requests[connection.request.url!.host!, default: []].append(connection) }
        }

        func stop(_ connection: ArtworkGenerationProtocol) {
            lock.withLock { _ = stopped.insert(ObjectIdentifier(connection)) }
        }

        func count(_ host: String) -> Int { lock.withLock { requests[host]?.count ?? 0 } }

        func finish(_ host: String, index: Int, status: Int = 200, data: Data) {
            // URLSession may cancel a retired generation before this gate opens.
            // Do not send protocol callbacks to an already stopped connection.
            let connection = lock.withLock { () -> ArtworkGenerationProtocol? in
                guard let values = requests[host], values.indices.contains(index) else { return nil }
                let connection = values[index]
                guard stopped.insert(ObjectIdentifier(connection)).inserted else { return nil }
                return connection
            }
            guard let connection else { return }
            let response = HTTPURLResponse(url: connection.request.url!, statusCode: status, httpVersion: nil,
                                           headerFields: ["Content-Type": "image/png"])!
            connection.client?.urlProtocol(connection, didReceive: response, cacheStoragePolicy: .notAllowed)
            connection.client?.urlProtocol(connection, didLoad: data)
            connection.client?.urlProtocolDidFinishLoading(connection)
        }

        func remove(_ host: String) {
            lock.withLock {
                for request in requests.removeValue(forKey: host) ?? [] {
                    stopped.remove(ObjectIdentifier(request))
                }
            }
        }
    }

    static let gate = Gate()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.gate.add(self) }
    override func stopLoading() { Self.gate.stop(self) }
}

@MainActor
private final class ArtworkGenerationFixture {
    let host = "artwork-\(UUID().uuidString.lowercased()).invalid"
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let store = ArtworkStore()
    let session: URLSession
    let red: Data
    let green: Data

    var url: URL { URL(string: "https://\(host)/cover.png")! }
    var oldDirectory: URL { root.appendingPathComponent("old") }
    var newDirectory: URL { root.appendingPathComponent("new") }
    func file(in directory: URL) -> URL { directory.appendingPathComponent(digest(url.absoluteString) + ".img") }

    init() throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ArtworkGenerationProtocol.self]
        session = URLSession(configuration: configuration)
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8))
        red = renderer.pngData { context in
            UIColor.red.setFill(); context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        green = renderer.pngData { context in
            UIColor.green.setFill(); context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        for directory in [oldDirectory, newDirectory] {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
    }

    func load(pixels: Int = 32, pinned: URL? = nil) async -> UIImage? {
        await store.image(url: url, session: session, pixels: pixels, pinned: pinned)
    }

    func finish(_ index: Int, status: Int = 200, data: Data? = nil) {
        ArtworkGenerationProtocol.gate.finish(host, index: index, status: status, data: data ?? green)
    }

    func cleanup() async {
        await store.configure(disk: nil)
        session.invalidateAndCancel()
        ArtworkGenerationProtocol.gate.remove(host)
        try? FileManager.default.removeItem(at: root)
    }
}

// OfflineLaunchTests runs on both native devices, including cache lifecycle checks.
extension OfflineLaunchTests {
    func testCacheOnlyArtworkChangesKeepVisibleResponsesWithoutRefillingTheCache() async throws {
        for disabled in [true, false] {
            let fixture = try ArtworkGenerationFixture()
            addTeardownBlock { await fixture.cleanup() }
            await fixture.store.configure(disk: fixture.oldDirectory)
            let first = Task { await fixture.load() }
            try await waitForArtworkRequest(fixture, count: 1)
            await fixture.store.configure(disk: disabled ? nil : fixture.newDirectory, preservingRequests: true)
            // A view entering after the cache change can still share this
            // authorized request without letting it populate either cache.
            let second = Task { await fixture.load() }
            try await waitForArtworkJoin(fixture)
            fixture.finish(0, data: fixture.red)
            let a = await first.value
            let b = await second.value
            XCTAssertNotNil(a, "Cache controls must not strand a visible cover at its placeholder")
            XCTAssertEqual(a?.pngData(), b?.pngData())
            XCTAssertEqual(ArtworkGenerationProtocol.gate.count(fixture.host), 1)
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.file(in: fixture.oldDirectory).path))
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.file(in: fixture.newDirectory).path))
            let fresh = Task { await fixture.load() }
            try await waitForArtworkRequest(fixture, count: 2)
            fixture.finish(1)
            let newImage = await fresh.value
            XCTAssertNotNil(newImage)
            XCTAssertNotEqual(a?.pngData(), newImage?.pngData(), "The retired response must not repopulate memory")
        }
    }

    func testAuthorizationResetRetiresAnInflightArtworkDiskWrite() async throws {
        let fixture = try ArtworkGenerationFixture()
        addTeardownBlock { await fixture.cleanup() }
        await fixture.store.configure(disk: fixture.oldDirectory)
        let old = Task { await fixture.load() }
        try await waitForArtworkRequest(fixture, count: 1)
        await fixture.store.configure(disk: nil)
        fixture.finish(0, data: fixture.red)
        let retired = await old.value
        XCTAssertNil(retired, "A response from the retired configuration cannot escape to the caller")
        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.oldDirectory.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.file(in: fixture.oldDirectory).path),
                       "Retiring authorization must prevent write-back even if its directory still exists")
        let fresh = Task { await fixture.load() }
        try await waitForArtworkRequest(fixture, count: 2)
        fixture.finish(1)
        let image = await fresh.value
        XCTAssertNotNil(image)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.file(in: fixture.oldDirectory).path))
    }

    func testArtworkConfigurationReplacementDoesNotJoinOrRemoveAnOldRequest() async throws {
        let fixture = try ArtworkGenerationFixture()
        addTeardownBlock { await fixture.cleanup() }
        await fixture.store.configure(disk: fixture.oldDirectory)
        let old = Task { await fixture.load() }
        try await waitForArtworkRequest(fixture, count: 1)
        await fixture.store.configure(disk: fixture.newDirectory)
        let fresh = Task { await fixture.load() }
        try await waitForArtworkRequest(fixture, count: 2)
        fixture.finish(0, data: fixture.red)
        let retired = await old.value
        XCTAssertNil(retired)
        fixture.finish(1)
        let freshImage = await fresh.value
        let replacement = try XCTUnwrap(freshImage)
        let cachedImage = await fixture.load()
        let cached = try XCTUnwrap(cachedImage)
        XCTAssertEqual(cached.pngData(), replacement.pngData())
        XCTAssertEqual(try Data(contentsOf: fixture.file(in: fixture.newDirectory)), fixture.green)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.file(in: fixture.oldDirectory).path))
        XCTAssertEqual(ArtworkGenerationProtocol.gate.count(fixture.host), 2)
    }

    func testRetiredArtworkFailureCannotSuppressANewConfiguration() async throws {
        let fixture = try ArtworkGenerationFixture()
        addTeardownBlock { await fixture.cleanup() }
        await fixture.store.configure(disk: nil)
        let old = Task { await fixture.load() }
        try await waitForArtworkRequest(fixture, count: 1)
        // The disk URL can remain nil while the authorization or service changes.
        await fixture.store.configure(disk: nil)
        fixture.finish(0, status: 404)
        let retired = await old.value
        XCTAssertNil(retired)
        let fresh = Task { await fixture.load() }
        try await waitForArtworkRequest(fixture, count: 2)
        fixture.finish(1)
        let image = await fresh.value
        XCTAssertNotNil(image, "An old failure must not install a new 30-second missing-image entry")
    }

    func testArtworkRequestsStillCoalesceAndReuseDiskWithinTheCurrentConfiguration() async throws {
        let fixture = try ArtworkGenerationFixture()
        addTeardownBlock { await fixture.cleanup() }
        await fixture.store.configure(disk: fixture.newDirectory)
        let first = Task { await fixture.load() }
        try await waitForArtworkRequest(fixture, count: 1)
        let second = Task { await fixture.load() }
        try await waitForArtworkJoin(fixture)
        fixture.finish(0)
        let a = await first.value
        let b = await second.value
        XCTAssertNotNil(a)
        XCTAssertEqual(a?.pngData(), b?.pngData())
        XCTAssertEqual(ArtworkGenerationProtocol.gate.count(fixture.host), 1)
        XCTAssertEqual(try Data(contentsOf: fixture.file(in: fixture.newDirectory)), fixture.green)
        await fixture.store.configure(disk: fixture.newDirectory)
        let fromDisk = await fixture.load()
        XCTAssertEqual(fromDisk?.pngData(), a?.pngData())
        XCTAssertEqual(ArtworkGenerationProtocol.gate.count(fixture.host), 1)
    }

    func testPinnedArtworkRemainsAvailableWhenCacheIsDisabled() async throws {
        let fixture = try ArtworkGenerationFixture()
        addTeardownBlock { await fixture.cleanup() }
        let pinned = fixture.root.appendingPathComponent("downloaded-cover.png")
        try fixture.red.write(to: pinned)
        await fixture.store.configure(disk: nil)
        let image = await fixture.load(pinned: pinned)
        XCTAssertNotNil(image)
        XCTAssertEqual(ArtworkGenerationProtocol.gate.count(fixture.host), 0)
        XCTAssertEqual(try Data(contentsOf: pinned), fixture.red)
    }

    private func waitForArtworkRequest(_ fixture: ArtworkGenerationFixture, count: Int,
                                       file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<250 {
            if ArtworkGenerationProtocol.gate.count(fixture.host) >= count { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Expected artwork request did not start", file: file, line: line)
        throw URLError(.timedOut)
    }

    private func waitForArtworkJoin(_ fixture: ArtworkGenerationFixture) async throws {
        for _ in 0..<250 {
            let count = await fixture.store.coalescedRequestsForTesting
            if count > 0 { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("The second artwork caller did not join the pending request")
        throw URLError(.timedOut)
    }
}
