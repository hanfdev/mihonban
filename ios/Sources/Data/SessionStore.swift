import Foundation
import Observation

@MainActor @Observable
final class SessionStore {
    private(set) var client: APIClient?
    private(set) var info: SessionInfo?
    private(set) var revision = UUID()
    private(set) var needsSignIn = false
    @ObservationIgnored private var renewal: Task<SessionInfo, Error>?
    var isAdmin: Bool { info?.role == "admin" }
    var canSeeHidden: Bool { isAdmin || info?.role == "companion" }

    func connect(_ client: APIClient, info: SessionInfo) {
        invalidate()
        self.client = client
        self.info = info
        needsSignIn = false
    }

    func invalidate() {
        revision = UUID()
        renewal?.cancel()
        renewal = nil
        client = nil
        info = nil
    }

    // All callers share a single password renewal, and never retry writes after
    // transport failures. Only an explicit 401 permits one authenticated retry.
    func perform<Value: Sendable>(_ operation: @escaping @Sendable (APIClient) async throws -> Value) async throws -> Value {
        guard let client else { throw ClientError.sessionExpired }
        let token = revision
        do {
            let value = try await operation(client)
            guard token == revision else { throw CancellationError() }
            return value
        } catch {
            let expired = (error as? ServerError)?.status == 401 ||
                (error as? ClientError)?.key == "mobile.sessionExpired"
            guard expired, token == revision else { throw error }
            do {
                let renewed = try await renew(client, token: token)
                guard token == revision else { throw CancellationError() }
                info = renewed
                let value = try await operation(client)
                guard token == revision else { throw CancellationError() }
                return value
            } catch {
                if token == revision && !(error is CancellationError) { needsSignIn = true }
                throw error
            }
        }
    }

    private func renew(_ client: APIClient, token: UUID) async throws -> SessionInfo {
        if let renewal { return try await renewal.value }
        guard let password = CredentialStore.read(for: client.baseURL.absoluteString) else {
            throw ClientError.sessionExpired
        }
        let task = Task { try await client.login(password: password) }
        renewal = task
        defer { if token == revision { renewal = nil } }
        let result = try await task.value
        guard result.ok else { throw ClientError.sessionExpired }
        return result
    }
}
