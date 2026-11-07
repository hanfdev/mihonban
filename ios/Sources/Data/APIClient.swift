import Foundation

// URLSession cancellation is an NSURLErrorCancelled, not a Swift
// CancellationError. Both represent an ended request, not a user-facing failure.
func isRequestCancellation(_ error: Error) -> Bool {
    error is CancellationError || (error as? URLError)?.code == .cancelled
}

struct ClientError: LocalizedError, Sendable {
    let key: String
    var errorDescription: String? { L10n.text(key) }
    static let connection = ClientError(key: "mobile.connectionFailed")
    static let sessionExpired = ClientError(key: "mobile.sessionExpired")
}

// The service could not be reached at all, as opposed to answering with an error.
func isUnreachable(_ error: Error) -> Bool {
    guard let error = error as? URLError else { return false }
    switch error.code {
    case .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost,
         .dnsLookupFailed, .timedOut, .internationalRoamingOff, .dataNotAllowed, .callIsActive:
        return true
    default:
        return false
    }
}

// The service answered and refused the credentials or the session.
func isRejected(_ error: Error) -> Bool {
    if let error = error as? ClientError { return ["mobile.sessionExpired", "mobile.wrongPassword"].contains(error.key) }
    if let error = error as? ServerError { return error.status == 401 || error.status == 403 }
    return false
}

final class RedirectPolicy: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        guard let origin = task.originalRequest?.url, let target = request.url else { completionHandler(nil); return }
        if origin.scheme == "https" && target.scheme != "https" { completionHandler(nil); return }
        let sameOrigin = origin.host == target.host && origin.port == target.port && origin.scheme == target.scheme
        // Login bodies must never follow a redirect to another origin.
        if !sameOrigin && task.originalRequest?.httpMethod == "POST" { completionHandler(nil); return }
        var safe = request
        if !sameOrigin {
            safe.setValue(nil, forHTTPHeaderField: "Cookie")
            safe.setValue(nil, forHTTPHeaderField: "Authorization")
        }
        completionHandler(safe)
    }
}

final class APIClient: Sendable {
    let baseURL: URL
    let session: URLSession
    let cacheDirectory: URL

    init(address: String, session: URLSession? = nil) throws {
        guard var parts = URLComponents(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["https", "http"].contains(parts.scheme?.lowercased() ?? ""),
              let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil else {
            throw ClientError(key: "mobile.invalidAddress")
        }
        parts.query = nil
        parts.fragment = nil
        while parts.path.hasSuffix("/") { parts.path.removeLast() }
        guard let url = parts.url else { throw ClientError(key: "mobile.invalidAddress") }
        baseURL = url
        if let session { self.session = session }
        else {
            let configuration = URLSessionConfiguration.default
            configuration.httpCookieStorage = .shared
            configuration.urlCache = URLCache(memoryCapacity: 8 * 1024 * 1024, diskCapacity: 48 * 1024 * 1024)
            configuration.timeoutIntervalForRequest = 25
            configuration.timeoutIntervalForResource = 60
            configuration.httpAdditionalHeaders = ["User-Agent": "Mihonban-iOS/0.1"]
            self.session = URLSession(configuration: configuration, delegate: RedirectPolicy(), delegateQueue: nil)
        }
        cacheDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Mihonban/" + digest(url.absoluteString), isDirectory: true)
    }

    func url(_ components: String...) -> URL {
        components.reduce(baseURL) { $0.appendingPathComponent($1) }
    }

    func artworkURL(_ id: String, size: Int, revision: Int? = nil) -> URL {
        var parts = URLComponents(url: url("api", "art", id), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "s", value: String(size)),
                            URLQueryItem(name: "v", value: String(revision ?? 0))]
        return parts.url!
    }

    func me() async throws -> SessionInfo {
        let (data, response) = try await session.data(from: url("api", "me"))
        if (response as? HTTPURLResponse)?.statusCode == 401 { return SessionInfo(ok: false, role: nil, guest: false) }
        try Self.validate(response)
        return try JSONDecoder().decode(SessionInfo.self, from: data)
    }

    func login(password: String) async throws -> SessionInfo {
        var request = URLRequest(url: url("api", "login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["password": password])
        let (data, response) = try await session.data(for: request)
        try Self.validate(response, login: true)
        return try JSONDecoder().decode(SessionInfo.self, from: data)
    }

    func library(previous: LibrarySnapshot?) async throws -> LibrarySnapshot {
        var request = URLRequest(url: url("api", "library"))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let etag = previous?.etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        let (data, response) = try await session.data(for: request)
        if (response as? HTTPURLResponse)?.statusCode == 304, let previous { return previous }
        try Self.validate(response)
        return LibrarySnapshot(albums: try JSONDecoder().decode([Album].self, from: data),
                               etag: (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "ETag"))
    }

    // CatalogStore keeps its own copies, so a stale HTTP cache entry must never answer after an edit.
    func album(_ id: String) async throws -> Album {
        var request = URLRequest(url: url("api", "album", id))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        try Self.validateServer(response, data: data)
        return try JSONDecoder().decode(Album.self, from: data)
    }

    func savedLibrary() -> LibrarySnapshot? {
        guard let data = try? Data(contentsOf: cacheDirectory.appendingPathComponent("library.json")) else { return nil }
        return try? JSONDecoder().decode(LibrarySnapshot.self, from: data)
    }

    func saveLibrary(_ library: LibrarySnapshot) {
        try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        if let data = try? JSONEncoder().encode(library) {
            try? data.write(to: cacheDirectory.appendingPathComponent("library.json"), options: .atomic)
        }
    }

    func clearCookies() {
        for cookie in HTTPCookieStorage.shared.cookies(for: baseURL) ?? [] where cookie.name == "mihonban_session" {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }

    static func validate(_ response: URLResponse, login: Bool = false) throws {
        guard let response = response as? HTTPURLResponse else { throw ClientError.connection }
        switch response.statusCode {
        case 200..<300: return
        case 401, 403: throw login ? ClientError(key: "mobile.wrongPassword") : ClientError.sessionExpired
        case 429: throw ClientError(key: "mobile.rateLimited")
        default: throw ClientError.connection
        }
    }
}
