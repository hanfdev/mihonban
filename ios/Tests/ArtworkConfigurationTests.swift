import XCTest
import UIKit
@testable import Mihonban

// Delay the actual directory creation across an application state change.
// The deadline keeps a failed test from leaving a worker permanently blocked.
private final class ArtworkDirectoryGate: @unchecked Sendable {
    private let condition = NSCondition()
    private var released = false
    private var target: URL?
    private var completed = false
    private var timedOut = false
    private var usedMainThread = false

    var state: (target: URL?, completed: Bool, timedOut: Bool, usedMainThread: Bool) {
        condition.lock()
        defer { condition.unlock() }
        return (target, completed, timedOut, usedMainThread)
    }

    func prepare(_ directory: URL) async {
        await Task.detached(priority: .utility) { self.create(directory) }.value
    }

    private func create(_ directory: URL) {
        condition.lock()
        target = directory
        usedMainThread = Thread.isMainThread
        let deadline = Date(timeIntervalSinceNow: 10)
        while !released {
            if !condition.wait(until: deadline) { timedOut = true; break }
        }
        condition.unlock()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: MediaPaths.protection)
        try? Data([1]).write(to: directory.appendingPathComponent("prepare-complete.marker"))
        condition.lock()
        completed = true
        condition.unlock()
    }

    func release() {
        condition.lock()
        released = true
        condition.broadcast()
        condition.unlock()
    }
}

private final class ArtworkConfigurationProtocol: URLProtocol {
    final class Responses: @unchecked Sendable {
        private let lock = NSLock()
        private var images: [String: Data] = [:]
        private var imageRequests: [String: Int] = [:]
        private var holdNext: Set<String> = []
        private var held: [String: ArtworkConfigurationProtocol] = [:]
        private var stopped: Set<ObjectIdentifier> = []

        func configure(_ host: String, png: Data) { lock.withLock { images[host] = png } }
        func holdNextImage(_ host: String) { lock.withLock { _ = holdNext.insert(host) } }
        func image(_ connection: ArtworkConfigurationProtocol) -> Data? {
            let host = connection.request.url!.host!
            return lock.withLock {
                imageRequests[host, default: 0] += 1
                if holdNext.remove(host) != nil {
                    held[host] = connection
                    return nil
                }
                return images[host]
            }
        }
        func stop(_ connection: ArtworkConfigurationProtocol) {
            lock.withLock {
                if held.values.contains(where: { $0 === connection }) { stopped.insert(ObjectIdentifier(connection)) }
            }
        }
        func finishHeld(_ host: String, data: Data) {
            let connection = lock.withLock { () -> ArtworkConfigurationProtocol? in
                guard let connection = held.removeValue(forKey: host) else { return nil }
                guard stopped.remove(ObjectIdentifier(connection)) == nil else { return nil }
                return connection
            }
            connection?.respond(data, mime: "image/png")
        }
        func count(_ host: String) -> Int { lock.withLock { imageRequests[host] ?? 0 } }
        func remove(_ host: String) {
            lock.withLock {
                images[host] = nil
                imageRequests[host] = nil
                holdNext.remove(host)
                if let connection = held.removeValue(forKey: host) { stopped.remove(ObjectIdentifier(connection)) }
            }
        }
    }

    static let responses = Responses()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() { Self.responses.stop(self) }
    override func startLoading() {
        guard let url = request.url else { return }
        let data: Data
        let mime: String
        switch url.path {
        case "/api/login", "/api/me":
            data = Data(#"{"ok":true,"role":"user","guest":false}"#.utf8)
            mime = "application/json"
        case "/api/favorites":
            data = Data(#"{"albums":[],"tracks":[]}"#.utf8)
            mime = "application/json"
        case "/api/library", "/api/tracks", "/api/artists":
            data = Data("[]".utf8)
            mime = "application/json"
        case "/cover.png":
            guard let image = Self.responses.image(self) else { return }
            data = image
            mime = "image/png"
        default:
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        respond(data, mime: mime)
    }

    fileprivate func respond(_ data: Data, mime: String) {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": mime])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}

@MainActor
private final class ArtworkConfigurationFixture {
    let host = "artwork-configuration-\(UUID().uuidString.lowercased()).invalid"
    let defaultsName = "org.mihonban.artwork-configuration.\(UUID().uuidString)"
    let artwork = ArtworkStore()
    let gate = ArtworkDirectoryGate()
    let transport: URLSession
    let model: AppModel
    let api: APIClient
    private var connecting: Task<Void, Never>?
    private var attachedMedia: MediaCache?
    private var imageTasks: [Task<UIImage?, Never>] = []
    private(set) var finishedImageRequests = 0

    init() throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ArtworkConfigurationProtocol.self]
        transport = URLSession(configuration: configuration)
        let defaults = try XCTUnwrap(UserDefaults(suiteName: defaultsName))
        let gate = gate
        model = AppModel(defaults: defaults, transport: transport, artworkStore: artwork,
                         prepareArtworkDirectory: { await gate.prepare($0) })
        api = try APIClient(address: "https://\(host)", session: transport)
        let settings = CacheSettings(defaults: defaults)
        settings.enabled = true
        model.cache = settings
        model.player.cache = settings
        model.address = api.baseURL.absoluteString
        model.password = "fixture-password"
        model.rememberPassword = false
        let png = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).pngData { context in
            UIColor.blue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        ArtworkConfigurationProtocol.responses.configure(host, png: png)
    }

    func connect() {
        connecting = Task { @MainActor in await model.connect() }
    }

    func retainAttachedMedia() { attachedMedia = model.media }

    func finishConnecting() async {
        gate.release()
        await connecting?.value
    }

    func startImageRequest() -> Task<UIImage?, Never> {
        let task = Task {
            let image = await artwork.image(url: api.url("cover.png"), session: transport, pixels: 32)
            finishedImageRequests += 1
            return image
        }
        imageTasks.append(task)
        return task
    }

    func verifyMemoryOnlyArtwork(expectedRequests: Int = 1, file: StaticString = #filePath, line: UInt = #line) async throws {
        let directory = try XCTUnwrap(gate.state.target, file: file, line: line)
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.path),
                      "The old directory really finished creating after invalidation", file: file, line: line)
        let url = api.url("cover.png")
        let image = await artwork.image(url: url, session: transport, pixels: 32)
        XCTAssertNotNil(image, file: file, line: line)
        XCTAssertEqual(ArtworkConfigurationProtocol.responses.count(host), expectedRequests, file: file, line: line)
        let diskFile = directory.appendingPathComponent(digest(url.absoluteString) + ".img")
        XCTAssertFalse(FileManager.default.fileExists(atPath: diskFile.path),
                       "Finishing an obsolete directory operation must not turn disk caching back on", file: file, line: line)
        XCTAssertFalse(gate.state.timedOut, file: file, line: line)
        XCTAssertFalse(gate.state.usedMainThread, file: file, line: line)
    }

    func cleanup() async {
        model.disconnect()
        gate.release()
        await connecting?.value
        await model.applyCacheSettings()
        model.player.stop()
        model.player.setForeground(false)
        await artwork.configure(disk: nil)
        transport.invalidateAndCancel()
        for task in imageTasks { _ = await task.value }
        if let attachedMedia { _ = await attachedMedia.clear() }
        let service = MediaPaths.service(api.baseURL)
        let downloads = MediaPaths.downloads(service: service)
        _ = await DownloadManifestStorage.shared.load(directory: downloads)
        ArtworkConfigurationProtocol.responses.remove(host)
        _ = CredentialStore.save(nil, for: api.baseURL.absoluteString)
        UserDefaults(suiteName: defaultsName)?.removePersistentDomain(forName: defaultsName)
        try? FileManager.default.removeItem(at: api.cacheDirectory)
        try? FileManager.default.removeItem(at: downloads.deletingLastPathComponent())
    }
}

// Both native device suites select this class, including application wiring.
extension OfflineLaunchTests {
    func testDisablingCacheWhileArtworkDirectoryIsPreparingKeepsDiskWritesDisabled() async throws {
        let fixture = try ArtworkConfigurationFixture()
        addTeardownBlock { await fixture.cleanup() }
        fixture.connect()
        try await waitForArtworkDirectory { fixture.gate.state.target != nil }
        fixture.retainAttachedMedia()
        XCTAssertTrue(fixture.model.signedIn)
        XCTAssertNotNil(fixture.model.media)
        XCTAssertFalse(fixture.gate.state.completed)

        fixture.model.cache.enabled = false
        await fixture.model.applyCacheSettings()
        XCTAssertFalse(fixture.gate.state.completed, "Disabling cache must not wait for an obsolete directory operation")
        await fixture.finishConnecting()

        XCTAssertTrue(fixture.model.signedIn)
        XCTAssertFalse(fixture.model.cache.enabled)
        XCTAssertFalse(fixture.model.connecting)
        XCTAssertNil(fixture.model.error)
        // Observe the post-prepare disabled-cache prune before requesting the
        // PNG, so a concurrent cleanup cannot hide an incorrect disk write.
        let directory = try XCTUnwrap(fixture.gate.state.target)
        let marker = directory.appendingPathComponent("prepare-complete.marker")
        try await waitForArtworkDirectory { !FileManager.default.fileExists(atPath: marker.path) }
        try await fixture.verifyMemoryOnlyArtwork()
    }

    func testDisconnectWhileArtworkDirectoryIsPreparingCannotRepublishItsCache() async throws {
        let fixture = try ArtworkConfigurationFixture()
        addTeardownBlock { await fixture.cleanup() }
        fixture.connect()
        try await waitForArtworkDirectory { fixture.gate.state.target != nil }
        fixture.retainAttachedMedia()
        XCTAssertTrue(fixture.model.signedIn)
        XCTAssertFalse(fixture.gate.state.completed)

        fixture.model.disconnect()
        await fixture.model.applyCacheSettings()
        XCTAssertNil(fixture.model.media)
        XCTAssertNil(fixture.model.downloads)
        XCTAssertFalse(fixture.model.signedIn)
        XCTAssertFalse(fixture.gate.state.completed)
        await fixture.finishConnecting()

        XCTAssertNil(fixture.model.client)
        XCTAssertFalse(fixture.model.signedIn, "The obsolete connection cannot restore an authenticated shell")
        XCTAssertTrue(fixture.model.catalog.albums.isEmpty)
        try await fixture.verifyMemoryOnlyArtwork()
    }

    func testCacheToggleCannotPreserveAnOldAuthorizationWhileNewStoragePrepares() async throws {
        let fixture = try ArtworkConfigurationFixture()
        addTeardownBlock { await fixture.cleanup() }
        await fixture.artwork.configure(disk: nil)
        ArtworkConfigurationProtocol.responses.holdNextImage(fixture.host)
        let old = fixture.startImageRequest()
        try await waitForArtworkDirectory { ArtworkConfigurationProtocol.responses.count(fixture.host) == 1 }

        // A new authorized session begins while the previous image response
        // remains held at exactly the same URL and decoded size.
        fixture.connect()
        try await waitForArtworkDirectory { fixture.gate.state.target != nil }
        fixture.retainAttachedMedia()
        XCTAssertTrue(fixture.model.signedIn)
        try await waitForArtworkDirectory { fixture.finishedImageRequests == 1 }
        let retired = await old.value
        XCTAssertNil(retired, "The previous authorization must retire before the new shell prepares its cache")
        let red = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).pngData { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        ArtworkConfigurationProtocol.responses.finishHeld(fixture.host, data: red)

        // New-session views can request images before storage preparation
        // finishes. A cache toggle must preserve these authorized callers.
        ArtworkConfigurationProtocol.responses.holdNextImage(fixture.host)
        let current = fixture.startImageRequest()
        try await waitForArtworkDirectory { ArtworkConfigurationProtocol.responses.count(fixture.host) == 2 }
        fixture.model.cache.enabled = false
        await fixture.model.applyCacheSettings()
        XCTAssertFalse(fixture.gate.state.completed)
        let blue = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).pngData { context in
            UIColor.blue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        ArtworkConfigurationProtocol.responses.finishHeld(fixture.host, data: blue)
        let visible = await current.value
        XCTAssertNotNil(visible, "Changing cache settings must not strand a current-session image view")

        await fixture.finishConnecting()
        let directory = try XCTUnwrap(fixture.gate.state.target)
        let marker = directory.appendingPathComponent("prepare-complete.marker")
        try await waitForArtworkDirectory { !FileManager.default.fileExists(atPath: marker.path) }
        try await fixture.verifyMemoryOnlyArtwork(expectedRequests: 3)
        XCTAssertTrue(fixture.model.signedIn)
        XCTAssertNil(fixture.model.error)
    }

    private func waitForArtworkDirectory(_ condition: () -> Bool,
                                         file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while ContinuousClock.now < deadline {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("The initial artwork directory operation did not reach its gate", file: file, line: line)
        throw NSError(domain: "ArtworkConfigurationTests", code: 1)
    }
}
