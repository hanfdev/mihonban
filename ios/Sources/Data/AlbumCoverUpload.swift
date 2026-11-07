import Foundation

// Prepared cover writes use unique names inside the album's existing storage
// folder. Uploading a file does not attach it to the album until a separate PATCH.
struct AlbumCoverUpload: Sendable {
    static let maximumBytes = 4 * 1024 * 1024
    let path: String
    let jpeg: Data

    init(folder: String?, jpeg: Data, identifier: UUID = UUID()) throws {
        guard !jpeg.isEmpty, jpeg.count <= Self.maximumBytes,
              jpeg.starts(with: [0xff, 0xd8, 0xff]) else { throw ClientError(key: "importPage.coverInvalid") }
        guard let folder else { throw ClientError(key: "mobile.inputRejected") }
        let normalized = folder.precomposedStringWithCanonicalMapping.replacingOccurrences(of: "\\", with: "/")
        let components = normalized.split(separator: "/", omittingEmptySubsequences: true)
        guard !components.isEmpty,
              !normalized.unicodeScalars.contains(where: { $0.value < 32 }),
              components.allSatisfy({ $0 != "." && $0 != ".." && $0.utf16.count <= 255 }) else {
            throw ClientError(key: "mobile.inputRejected")
        }
        let path = components.joined(separator: "/") + "/cover-" + identifier.uuidString.lowercased() + ".jpg"
        guard path.utf16.count <= 400 else { throw ClientError(key: "importPage.pathTooLong") }
        self.path = path
        self.jpeg = jpeg
    }
}

extension APIClient {
    func uploadCover(_ upload: AlbumCoverUpload) async throws {
        var request = URLRequest(url: endpoint(["api", "upload", "cover"],
                                               query: [URLQueryItem(name: "path", value: upload.path)]))
        request.httpMethod = "POST"
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.httpBody = upload.jpeg
        let (data, response) = try await session.data(for: request)
        try Self.validateServer(response, data: data)
        struct Uploaded: Decodable { let ok: Bool; let path: String }
        let uploaded = try JSONDecoder().decode(Uploaded.self, from: data)
        guard uploaded.ok, uploaded.path == upload.path else { throw ClientError.connection }
    }

    func setAlbumCover(_ id: String, upload: AlbumCoverUpload) async throws {
        let _: SuccessResponse = try await request(["api", "album", id], method: "PATCH",
            body: JSONEncoder().encode(["coverPath": upload.path]))
    }
}
