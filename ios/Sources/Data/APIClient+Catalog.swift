import Foundation

struct ServerError: LocalizedError, Sendable {
    let status: Int
    let code: String?
    var errorDescription: String? {
        switch status {
        case 400, 422: L10n.text("mobile.inputRejected")
        case 401: L10n.text("mobile.sessionExpired")
        case 403: L10n.text("mobile.permissionDenied")
        case 404: L10n.text("mobile.itemMissing")
        case 409: L10n.text("mobile.conflict")
        case 429: L10n.text("mobile.rateLimited")
        default: L10n.text("mobile.connectionFailed")
        }
    }
}

struct Versioned<Value: Sendable>: Sendable {
    var value: Value
    var etag: String?
}

struct SuccessResponse: Decodable, Sendable {
    var ok: Bool?
    var id: String?
}

struct ArtistBiography: Decodable, Sendable { var bio: String }

extension APIClient {
    func endpoint(_ components: [String], query: [URLQueryItem] = []) -> URL {
        var parts = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        let path = components.map { $0.addingPercentEncoding(withAllowedCharacters: allowed)! }.joined(separator: "/")
        parts.percentEncodedPath += "/" + path
        parts.queryItems = query.isEmpty ? nil : query
        return parts.url!
    }

    func request<Value: Decodable & Sendable>(_ components: [String], method: String = "GET",
        query: [URLQueryItem] = [], body: Data? = nil, as type: Value.Type = Value.self) async throws -> Value {
        var request = URLRequest(url: endpoint(components, query: query))
        request.httpMethod = method
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        try Self.validateServer(response, data: data)
        return try JSONDecoder().decode(Value.self, from: data)
    }

    func catalog(includeHidden: Bool, previous: Versioned<[Album]>?) async throws -> Versioned<[Album]> {
        try await versioned(["api", "library"], includeHidden: includeHidden, previous: previous)
    }

    func allTracks(includeHidden: Bool, previous: Versioned<[Track]>?) async throws -> Versioned<[Track]> {
        try await versioned(["api", "tracks"], includeHidden: includeHidden, previous: previous)
    }

    private func versioned<Value: Decodable & Sendable>(_ components: [String], includeHidden: Bool,
        previous: Versioned<Value>?) async throws -> Versioned<Value> {
        var request = URLRequest(url: endpoint(components, query: visibilityQuery(includeHidden)))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let tag = previous?.etag { request.setValue(tag, forHTTPHeaderField: "If-None-Match") }
        let (data, response) = try await session.data(for: request)
        if (response as? HTTPURLResponse)?.statusCode == 304, let previous { return previous }
        try Self.validateServer(response, data: data)
        return Versioned(value: try JSONDecoder().decode(Value.self, from: data),
            etag: (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "ETag"))
    }

    func artists(includeHidden: Bool) async throws -> [Artist] {
        try await request(["api", "artists"], query: visibilityQuery(includeHidden))
    }

    func featuredTracks(artist: String, includeHidden: Bool) async throws -> [Track] {
        try await request(["api", "artists", artist, "tracks"], query: visibilityQuery(includeHidden))
    }

    func biography(artist: String) async throws -> String {
        let response: ArtistBiography = try await request(["api", "artist-bio", artist])
        return response.bio
    }

    func artistArtURL(_ name: String, custom: Bool) -> URL {
        endpoint(["api", "artist-art", name], query: custom ? [URLQueryItem(name: "v", value: "c")] : [])
    }

    func imageURL(_ id: String, size: Int = 0) -> URL {
        endpoint(["api", "image", id], query: size > 0 ? [URLQueryItem(name: "s", value: String(size))] : [])
    }

    func favorites() async throws -> Favorites { try await request(["api", "favorites"]) }

    func favorite(_ kind: FavoriteKind, id: String, enabled: Bool) async throws {
        let _: SuccessResponse = try await request(["api", "favorites", kind.rawValue, id], method: enabled ? "PUT" : "DELETE")
    }

    func reorderFavorites(_ kind: FavoriteKind, ids: [String]) async throws {
        let _: SuccessResponse = try await request(["api", "favorites", kind.rawValue, "reorder"], method: "PUT",
            body: JSONEncoder().encode(["ids": ids]))
    }

    func logout() async throws {
        let _: SuccessResponse = try await request(["api", "logout"], method: "POST")
        clearCookies()
    }

    private func visibilityQuery(_ hidden: Bool) -> [URLQueryItem] {
        hidden ? [URLQueryItem(name: "hidden", value: "1")] : []
    }

    static func validateServer(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw ClientError.connection }
        guard (200..<300).contains(http.statusCode) else {
            struct Problem: Decodable { var code: String? }
            let problem = try? JSONDecoder().decode(Problem.self, from: data)
            throw ServerError(status: http.statusCode, code: problem?.code)
        }
    }
}
