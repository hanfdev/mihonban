import XCTest
import SwiftUI
@testable import Mihonban

// Fails every request as if the device had no connection.
final class UnreachableProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() {}
}

// Answers every request with 401, as a service that no longer accepts the session.
final class RejectingProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{\"ok\":false}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

// Authorize immediately but hold catalog requests until the test releases them.
private final class StartupRefreshProtocol: URLProtocol {
    final class State: @unchecked Sendable {
        private let lock = NSLock()
        private var pending: [StartupRefreshProtocol] = []
        var count: Int { lock.withLock { pending.count } }
        func add(_ request: StartupRefreshProtocol) { lock.withLock { pending.append(request) } }
        func remove(_ request: StartupRefreshProtocol) { lock.withLock { pending.removeAll { $0 === request } } }
        func finish() {
            let requests = lock.withLock { let copy = pending; pending = []; return copy }
            for request in requests {
                request.respond(request.request.url?.lastPathComponent == "favorites"
                    ? #"{"albums":[],"tracks":[]}"# : "[]")
            }
        }
    }
    static let state = State()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.url?.lastPathComponent == "me" { respond(#"{"ok":true,"role":"user","guest":true}"#) }
        else { Self.state.add(self) }
    }
    override func stopLoading() { Self.state.remove(self) }
    private func respond(_ body: String) {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

// Runs the app model against tools/fixture-server.py first, then relaunches it
// with a transport that cannot reach the service.
@MainActor
final class OfflineLaunchTests: XCTestCase {
    // Each test owns a defaults suite, so the host app's own settings stay untouched.
    private func suite() throws -> (UserDefaults, String) {
        let name = "org.mihonban.offline-tests.\(UUID().uuidString)"
        return (try XCTUnwrap(UserDefaults(suiteName: name)), name)
    }

    private func transport(_ type: URLProtocol.Type) -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [type]
        return URLSession(configuration: configuration)
    }

    private func signIn(_ defaults: UserDefaults) async throws -> AppModel {
        let model = AppModel(defaults: defaults)
        model.address = "http://127.0.0.1:8766"
        model.password = "fixture-password"
        model.rememberPassword = false
        await model.connect()
        XCTAssertNil(model.error)
        XCTAssertTrue(model.signedIn)
        XCTAssertEqual(model.catalog.index.albums.count, 3)
        XCTAssertEqual(RememberedSession.load(defaults)?.role, "user")
        return model
    }

    private func leave(_ model: AppModel) {
        model.player.stop()
        model.downloads?.detach()
    }

    func testFreshLaunchFinishesWithoutConnecting() async throws {
        let (defaults, name) = try suite()
        defer { defaults.removePersistentDomain(forName: name) }
        let model = AppModel(defaults: defaults, transport: transport(UnreachableProtocol.self))
        XCTAssertTrue(model.isBootstrapping)
        await model.bootstrap()
        XCTAssertFalse(model.isBootstrapping)
        XCTAssertFalse(model.signedIn)
        XCTAssertNil(model.error, "a fresh install needs input, not a network request")
    }

    func testAuthorizedCachedHomeAppearsBeforeStartupRefreshCompletes() async throws {
        let (defaults, name) = try suite()
        defer { defaults.removePersistentDomain(forName: name) }
        let session = transport(StartupRefreshProtocol.self)
        let api = try APIClient(address: "https://startup-\(UUID().uuidString.lowercased()).invalid", session: session)
        defaults.set(api.baseURL.absoluteString, forKey: "serviceAddress")
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Mihonban/" + digest(api.baseURL.absoluteString) + "/catalog", isDirectory: true)
        let disk = SnapshotStore(root: directory)
        let snapshot = CatalogSnapshot(albums: [Album(id: "saved", title: "Saved album", artist: "Band")],
            artists: [], favorites: .empty)
        try await disk.save("v1-user-visible", value: snapshot)
        let model = AppModel(defaults: defaults, transport: session)
        let startup = Task { await model.bootstrap() }
        defer {
            startup.cancel()
            StartupRefreshProtocol.state.finish()
            session.invalidateAndCancel()
            leave(model)
            model.player.setForeground(false)
            try? FileManager.default.removeItem(at: directory)
        }
        XCTAssertTrue(RootView(model: model).showsStartupBrand, "Saved data is not exposed before authorization")
        for _ in 0..<250 {
            if StartupRefreshProtocol.state.count == 3 && model.catalog.index.albums.first?.id == "saved" { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertEqual(StartupRefreshProtocol.state.count, 3)
        XCTAssertTrue(model.signedIn)
        XCTAssertTrue(model.isBootstrapping, "The remote refresh is deliberately still pending")
        XCTAssertEqual(model.catalog.index.albums.map(\.id), ["saved"])
        XCTAssertFalse(RootView(model: model).showsStartupBrand, "A ready cached home must not wait behind the logo")
        StartupRefreshProtocol.state.finish()
        await startup.value
        XCTAssertFalse(model.isBootstrapping)
        XCTAssertFalse(RootView(model: model).showsStartupBrand)
        XCTAssertNil(model.error)
    }

    func testStartupBrandUsesBundledLogoWithoutMotionOrNewAssets() throws {
        XCTAssertNotNil(UIImage(named: "Logo"))
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        let host = UIHostingController(rootView: StartupBrandView().environment(\.accessibilityReduceMotion, true))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            window.rootViewController = nil
            previous?.makeKey()
        }
        for style in [UIUserInterfaceStyle.light, .dark] {
            host.overrideUserInterfaceStyle = style
            host.view.layoutIfNeeded()
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = style == .dark ? "71-startup-brand-dark" : "71-startup-brand-light"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    func testUnreachableServiceReopensTheSavedLibrary() async throws {
        let (defaults, name) = try suite()
        defer { defaults.removePersistentDomain(forName: name) }
        // Other suites share the host app's container and may have opened albums
        // against the same fixture, so start from an empty offline catalog.
        let base = try APIClient(address: "http://127.0.0.1:8766").baseURL.absoluteString
        let catalog = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Mihonban/" + digest(base) + "/catalog", isDirectory: true)
        try? FileManager.default.removeItem(at: catalog)
        let online = try await signIn(defaults)
        let detail = try await online.catalog.album("network-mp3")
        leave(online)

        let offline = AppModel(defaults: defaults, transport: transport(UnreachableProtocol.self))
        XCTAssertEqual(offline.address, "http://127.0.0.1:8766")
        XCTAssertTrue(offline.isBootstrapping)
        await offline.bootstrap()
        XCTAssertFalse(offline.isBootstrapping)
        XCTAssertTrue(offline.signedIn, "a previously authorized service opens without a connection")
        XCTAssertNil(offline.error)
        XCTAssertEqual(offline.session?.role, "user")
        XCTAssertEqual(Set(offline.catalog.index.albums.map(\.id)), ["network-mp3", "network-flac", "network-ogg"])
        XCTAssertEqual(offline.catalog.error, L10n.text("mobile.offlineLibrary"))
        XCTAssertNotNil(offline.downloads, "downloads stay reachable offline")

        // Album details opened before stay readable; others report the failure.
        let saved = try await offline.catalog.album("network-mp3")
        XCTAssertEqual(saved.title, detail.title)
        XCTAssertEqual(saved.normalizedTracks.map(\.id), detail.normalizedTracks.map(\.id))
        do {
            _ = try await offline.catalog.album("network-ogg")
            XCTFail("an album never opened has no offline copy")
        } catch {
            XCTAssertTrue(isUnreachable(error))
        }

        await offline.refresh()
        XCTAssertTrue(offline.signedIn)
        XCTAssertEqual(offline.catalog.error, L10n.text("mobile.offlineLibrary"))
        leave(offline)
    }

    func testRejectedSessionNeverFallsBackToLocalData() async throws {
        let (defaults, name) = try suite()
        defer { defaults.removePersistentDomain(forName: name) }
        let online = try await signIn(defaults)
        leave(online)

        let rejected = AppModel(defaults: defaults, transport: transport(RejectingProtocol.self))
        await rejected.bootstrap()
        XCTAssertFalse(rejected.isBootstrapping)
        XCTAssertFalse(rejected.signedIn)
        XCTAssertNotNil(rejected.error)
        XCTAssertNil(RememberedSession.load(defaults), "a refusal forgets the authorization")

        // Once refused, a later launch without a connection stays signed out.
        let offline = AppModel(defaults: defaults, transport: transport(UnreachableProtocol.self))
        await offline.bootstrap()
        XCTAssertFalse(offline.signedIn)
        XCTAssertEqual(offline.error, L10n.text("mobile.connectionFailed"))
        XCTAssertTrue(offline.catalog.index.albums.isEmpty)
    }

    func testSigningOutForgetsTheAuthorization() async throws {
        let (defaults, name) = try suite()
        defer { defaults.removePersistentDomain(forName: name) }
        let model = try await signIn(defaults)
        model.disconnect()
        XCTAssertNil(RememberedSession.load(defaults))

        let offline = AppModel(defaults: defaults, transport: transport(UnreachableProtocol.self))
        await offline.bootstrap()
        XCTAssertFalse(offline.signedIn)
        XCTAssertTrue(offline.catalog.index.albums.isEmpty)
    }

    func testUnreachableClassification() {
        XCTAssertTrue(isUnreachable(URLError(.notConnectedToInternet)))
        XCTAssertTrue(isUnreachable(URLError(.timedOut)))
        XCTAssertFalse(isUnreachable(URLError(.serverCertificateUntrusted)), "a bad certificate is not treated as offline")
        XCTAssertFalse(isUnreachable(ClientError.connection))
        XCTAssertTrue(isRejected(ClientError(key: "mobile.wrongPassword")))
        XCTAssertTrue(isRejected(ServerError(status: 401, code: nil)))
        XCTAssertFalse(isRejected(ServerError(status: 500, code: nil)))
    }
}
