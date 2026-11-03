import XCTest
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

    func testUnreachableServiceReopensTheSavedLibrary() async throws {
        let (defaults, name) = try suite()
        defer { defaults.removePersistentDomain(forName: name) }
        let online = try await signIn(defaults)
        let detail = try await online.catalog.album("network-mp3")
        leave(online)

        let offline = AppModel(defaults: defaults, transport: transport(UnreachableProtocol.self))
        XCTAssertEqual(offline.address, "http://127.0.0.1:8766")
        await offline.bootstrap()
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
