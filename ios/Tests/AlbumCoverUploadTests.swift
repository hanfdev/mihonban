import XCTest
@testable import Mihonban

// Isolated transport fixture; nothing in this suite reaches a storage backend.
private final class CoverUploadProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        if url.host == "refused.invalid" { reply(403, ["ok": false]); return }
        let body = requestBody()
        if url.path == "/music/api/upload/cover" {
            guard request.httpMethod == "POST", request.value(forHTTPHeaderField: "Content-Type") == "image/jpeg",
                  body.starts(with: [0xff, 0xd8, 0xff]),
                  let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "path" })?.value,
                  path.hasPrefix("Music/Ensemble & Guest/Album #1/cover-"), path.hasSuffix(".jpg") else {
                reply(400, ["ok": false]); return
            }
            if url.host == "mismatched.invalid" { reply(200, ["ok": true, "path": "another/cover.jpg"]); return }
            reply(200, ["ok": true, "path": path])
        } else if url.path == "/music/api/album/album-id" {
            guard request.httpMethod == "PATCH",
                  let json = try? JSONSerialization.jsonObject(with: body) as? [String: String],
                  Set(json.keys) == ["coverPath"],
                  json["coverPath"]?.hasPrefix("Music/Ensemble & Guest/Album #1/cover-") == true else {
                reply(400, ["ok": false]); return
            }
            reply(200, ["ok": true])
        } else { reply(404, ["ok": false]) }
    }
    override func stopLoading() {}

    private func requestBody() -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var result = Data()
        var bytes = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = stream.read(&bytes, maxLength: bytes.count)
            if count <= 0 { return result }
            result.append(contentsOf: bytes.prefix(count))
        }
    }

    private func reply(_ status: Int, _ json: [String: Any]) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: (try? JSONSerialization.data(withJSONObject: json)) ?? Data())
        client?.urlProtocolDidFinishLoading(self)
    }
}

@MainActor
final class AlbumCoverUploadTests: XCTestCase {
    private func api(_ host: String = "covers.invalid") throws -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CoverUploadProtocol.self]
        let transport = URLSession(configuration: configuration)
        addTeardownBlock { transport.invalidateAndCancel() }
        return try APIClient(address: "https://" + host + "/music", session: transport)
    }

    func testUploadUsesBinaryBodyAndAttachesWithMinimalPatch() async throws {
        let client = try api()
        // Signature bytes suffice for testing transport; image validity is
        // covered separately by CoverPreparationTests and by the service.
        let upload = try AlbumCoverUpload(folder: "Music/Ensemble & Guest/Album #1", jpeg: Data([0xff, 0xd8, 0xff, 0xd9]))
        try await client.uploadCover(upload)
        try await client.setAlbumCover("album-id", upload: upload)
    }

    func testUploadRefusalPreservesServerStatus() async throws {
        let client = try api("refused.invalid")
        let upload = try AlbumCoverUpload(folder: "Music/Ensemble & Guest/Album #1", jpeg: Data([0xff, 0xd8, 0xff]))
        do {
            try await client.uploadCover(upload)
            XCTFail("a refused upload must fail rather than provide a path to save")
        } catch {
            XCTAssertEqual((error as? ServerError)?.status, 403)
        }
    }

    func testUnexpectedAcknowledgementPathCannotBeAttached() async throws {
        let client = try api("mismatched.invalid")
        let upload = try AlbumCoverUpload(folder: "Music/Ensemble & Guest/Album #1", jpeg: Data([0xff, 0xd8, 0xff]))
        do {
            try await client.uploadCover(upload)
            XCTFail("a different returned path is not this upload's acknowledgement")
        } catch {
            XCTAssertEqual((error as? ClientError)?.key, "mobile.connectionFailed")
        }
    }
}
