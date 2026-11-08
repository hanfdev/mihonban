import XCTest
@testable import Mihonban

private final class SessionRecoveryProtocol: URLProtocol {
    enum Reply {
        case response(Int, String)
        case failure(URLError.Code)
        case held
    }

    final class Gate: @unchecked Sendable {
        private let lock = NSLock()
        private var replies: [String: [String: [Reply]]] = [:]
        private var counts: [String: [String: Int]] = [:]
        private var pending: [String: [String: [SessionRecoveryProtocol]]] = [:]

        func configure(_ host: String, replies: [String: [Reply]]) {
            lock.withLock { self.replies[host] = replies }
        }

        func take(_ connection: SessionRecoveryProtocol) -> Reply {
            let host = connection.request.url!.host!
            let path = connection.request.url!.lastPathComponent
            return lock.withLock {
                counts[host, default: [:]][path, default: 0] += 1
                guard var queue = replies[host]?[path], !queue.isEmpty else {
                    return .response(500, "{}")
                }
                let reply = queue.removeFirst()
                replies[host]?[path] = queue
                if case .held = reply { pending[host, default: [:]][path, default: []].append(connection) }
                return reply
            }
        }

        func count(_ host: String, _ path: String) -> Int {
            lock.withLock { counts[host]?[path] ?? 0 }
        }

        func release(_ host: String, _ path: String, reply: Reply) {
            let connections = lock.withLock { () -> [SessionRecoveryProtocol] in
                let values = pending[host]?[path] ?? []
                pending[host]?[path] = nil
                return values
            }
            for connection in connections { connection.finish(reply) }
        }

        func remove(_ host: String) {
            lock.withLock {
                replies[host] = nil
                counts[host] = nil
                pending[host] = nil
            }
        }
    }

    static let gate = Gate()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { finish(Self.gate.take(self)) }
    override func stopLoading() {}

    private func finish(_ reply: Reply) {
        switch reply {
        case .response(let status, let body):
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        case .failure(let code): client?.urlProtocol(self, didFailWithError: URLError(code))
        case .held: break
        }
    }
}

@MainActor
extension OfflineLaunchTests {
    private var success: String { #"{"ok":true,"role":"admin","guest":false}"# }

    private func fixture(password: Bool = true, login: [SessionRecoveryProtocol.Reply],
                         requests: [SessionRecoveryProtocol.Reply]) throws -> (SessionStore, APIClient, String) {
        let host = "session-\(UUID().uuidString.lowercased()).invalid"
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SessionRecoveryProtocol.self]
        let transport = URLSession(configuration: configuration)
        let api = try APIClient(address: "https://" + host, session: transport)
        SessionRecoveryProtocol.gate.configure(host, replies: ["login": login, "favorites": requests])
        addTeardownBlock {
            transport.invalidateAndCancel()
            SessionRecoveryProtocol.gate.remove(host)
            await MainActor.run { _ = CredentialStore.save(nil, for: api.baseURL.absoluteString) }
        }
        XCTAssertTrue(CredentialStore.save(password ? "test-password" : nil, for: api.baseURL.absoluteString))
        XCTAssertEqual(CredentialStore.read(for: api.baseURL.absoluteString), password ? "test-password" : nil)
        let session = SessionStore()
        session.connect(api, info: SessionInfo(ok: true, role: "user", guest: false))
        return (session, api, host)
    }

    private func failure(_ session: SessionStore) async -> Error? {
        do {
            _ = try await session.perform { try await $0.favorites() }
            XCTFail("The scripted request should fail")
            return nil
        } catch { return error }
    }

    private func waitForRequests(_ host: String, _ path: String, count: Int) async throws {
        for _ in 0..<200 {
            if SessionRecoveryProtocol.gate.count(host, path) == count { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("The expected request did not reach the transport")
        throw URLError(.timedOut)
    }

    func testSuccessfulRenewalKeepsAuthorizationWhenRetriedRequestFailsForOtherReasons() async throws {
        for reply: SessionRecoveryProtocol.Reply in [.failure(.timedOut), .response(500, "{}"), .response(403, "{}")] {
            let (session, _, host) = try fixture(login: [.response(200, success)],
                requests: [.response(401, "{}"), reply])
            var rejected: [URL] = []
            session.authorizationRejected = { rejected.append($0) }
            let error = await failure(session)
            XCTAssertNotNil(error)
            XCTAssertEqual(SessionRecoveryProtocol.gate.count(host, "login"), 1)
            XCTAssertEqual(SessionRecoveryProtocol.gate.count(host, "favorites"), 2)
            XCTAssertEqual(session.info?.role, "admin")
            XCTAssertFalse(session.needsSignIn, "A timeout, server failure or resource permission error is not a login refusal")
            XCTAssertTrue(rejected.isEmpty)
        }
    }

    func testTransientOrCancelledRenewalDoesNotForgetAuthorization() async throws {
        for reply: SessionRecoveryProtocol.Reply in [.failure(.timedOut), .response(503, "{}"), .failure(.cancelled)] {
            let (session, _, host) = try fixture(login: [reply], requests: [.response(401, "{}")])
            var rejected: [URL] = []
            session.authorizationRejected = { rejected.append($0) }
            let error = await failure(session)
            XCTAssertNotNil(error)
            if case .failure(.cancelled) = reply { XCTAssertTrue(error is CancellationError) }
            XCTAssertEqual(SessionRecoveryProtocol.gate.count(host, "favorites"), 1, "Failed renewal must not retry the operation")
            XCTAssertFalse(session.needsSignIn)
            XCTAssertTrue(rejected.isEmpty)
        }
    }

    func testMissingCredentialsAndRejectedLoginNotifyOnceForTheActiveService() async throws {
        for password in [false, true] {
            let (session, api, host) = try fixture(password: password,
                login: [.response(401, "{}"), .response(401, "{}")],
                requests: [.response(401, "{}"), .response(401, "{}")])
            var rejected: [URL] = []
            session.authorizationRejected = { rejected.append($0) }
            let firstError = await failure(session)
            let secondError = await failure(session)
            XCTAssertNotNil(firstError)
            XCTAssertNotNil(secondError)
            XCTAssertTrue(session.needsSignIn)
            XCTAssertEqual(rejected, [api.baseURL])
            XCTAssertEqual(SessionRecoveryProtocol.gate.count(host, "login"), password ? 2 : 0)
        }
    }

    func testConcurrentRequestsShareRenewalAndRejectAnInvalidRenewedSession() async throws {
        let (session, api, host) = try fixture(login: [.held],
            requests: [.response(401, "{}"), .response(401, "{}")])
        var rejected: [URL] = []
        session.authorizationRejected = { rejected.append($0) }
        let first = Task { await failure(session) }
        let second = Task { await failure(session) }
        defer { first.cancel(); second.cancel() }
        try await waitForRequests(host, "favorites", count: 2)
        try await waitForRequests(host, "login", count: 1)
        SessionRecoveryProtocol.gate.release(host, "login", reply: .response(200, #"{"ok":false}"#))
        let firstError = await first.value
        let secondError = await second.value
        XCTAssertNotNil(firstError)
        XCTAssertNotNil(secondError)
        XCTAssertEqual(SessionRecoveryProtocol.gate.count(host, "login"), 1)
        XCTAssertEqual(SessionRecoveryProtocol.gate.count(host, "favorites"), 2, "Neither waiter retries after invalid renewal")
        XCTAssertTrue(session.needsSignIn)
        XCTAssertEqual(rejected, [api.baseURL])
    }

    func testRetriedUnauthorizedRequestRejectsTheRenewedSession() async throws {
        let (session, api, host) = try fixture(login: [.response(200, success)],
            requests: [.response(401, "{}"), .response(401, "{}")])
        var rejected: [URL] = []
        session.authorizationRejected = { rejected.append($0) }
        let error = await failure(session)
        XCTAssertEqual((error as? ServerError)?.status, 401)
        XCTAssertEqual(SessionRecoveryProtocol.gate.count(host, "login"), 1)
        XCTAssertTrue(session.needsSignIn)
        XCTAssertEqual(rejected, [api.baseURL])
    }

    func testLateUnauthorizedResponseCannotRejectAReplacementSession() async throws {
        let (session, original, host) = try fixture(password: false, login: [], requests: [.held])
        var rejected: [URL] = []
        session.authorizationRejected = { rejected.append($0) }
        let request = Task { await failure(session) }
        defer { request.cancel() }
        try await waitForRequests(host, "favorites", count: 1)
        let replacement = try APIClient(address: "https://replacement.invalid", session: original.session)
        session.connect(replacement, info: SessionInfo(ok: true, role: "admin", guest: false))
        SessionRecoveryProtocol.gate.release(host, "favorites", reply: .response(401, "{}"))
        let error = await request.value
        XCTAssertTrue(error is CancellationError)
        XCTAssertEqual(session.client?.baseURL, replacement.baseURL)
        XCTAssertEqual(session.info?.role, "admin")
        XCTAssertFalse(session.needsSignIn)
        XCTAssertTrue(rejected.isEmpty)
        XCTAssertEqual(SessionRecoveryProtocol.gate.count(host, "login"), 0)
    }
}
