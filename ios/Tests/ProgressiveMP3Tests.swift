import XCTest
import AVFAudio
@preconcurrency import SFBAudioEngine
@testable import Mihonban

// Blocking reads stay off the main actor while the test releases HTTP bodies.
private final class MP3ReadOperation: @unchecked Sendable {
    let source: MBHTTPInputSource
    private let lock = NSLock()
    private var stored: Result<Data, Error>?
    var result: Result<Data, Error>? { lock.withLock { stored } }

    init(_ source: MBHTTPInputSource) { self.source = source }

    func start(_ action: @escaping @Sendable (MBHTTPInputSource) throws -> Data) {
        Task.detached(priority: .userInitiated) {
            let result = Result { try action(self.source) }
            self.lock.withLock { self.stored = result }
        }
    }
}

// OfflineLaunchTests is selected by both the iPhone and iPad CI suites.
extension OfflineLaunchTests {
    private func fragmentedMP3() throws -> (MP3ReadOperation, String, URL) {
        let token = UUID().uuidString
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("mp3-\(token)")
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:8766/fragmented-mp3/\(token)/tone.mp3"))
        let read = MP3ReadOperation(MBHTTPInputSource(remoteURL: url,
                                                    cacheURL: root.appendingPathComponent("tone.mp3"),
                                                    persistent: false))
        addTeardownBlock {
            read.source.cancel()
            try? await Self.releaseMP3Body(token)
            try? read.source.close()
            try? FileManager.default.removeItem(at: root)
        }
        return (read, token, url)
    }

    private static func releaseMP3Body(_ token: String) async throws {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8766/fixture/stream-gate/\(token)/release")!)
        request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    }

    private func waitForMP3(_ predicate: () -> Bool,
                           file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while !predicate(), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(predicate(), file: file, line: line)
    }

    func testProgressiveReadFillsRequestAcrossHTTPChunksAndReturnsShortOnlyAtEOF() async throws {
        let (read, token, url) = try fragmentedMP3()
        read.start { source in
            try source.open()
            return try source.read(length: 64 * 1024)
        }
        // Both implementations consume the first fragment. Only a complete
        // read waits for the rest instead of returning an incomplete read.
        try await waitForMP3 { (try? read.source.offset) == 1024 }
        try await Self.releaseMP3Body(token)
        try await waitForMP3 { read.result != nil }
        let actual = try XCTUnwrap(read.result).get()
        let (expected, response) = try await URLSession.shared.data(from: url)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual(actual, expected.prefix(64 * 1024))

        let tail = MP3ReadOperation(read.source)
        tail.start { source in
            try source.seek(toOffset: source.length - 19)
            return try source.read(length: 4096)
        }
        try await waitForMP3 { tail.result != nil }
        XCTAssertEqual(try XCTUnwrap(tail.result).get(), expected.suffix(19))
        XCTAssertTrue(read.source.atEOF)
        XCTAssertTrue(try read.source.read(length: 1).isEmpty)
    }

    func testCancellingAReadWaitingForTheRestOfAnHTTPChunkUnblocksIt() async throws {
        let (read, _, _) = try fragmentedMP3()
        read.start { source in
            try source.open()
            return try source.read(length: 64 * 1024)
        }
        try await waitForMP3 { (try? read.source.offset) == 1024 }
        read.source.cancel()
        try await waitForMP3 { read.result != nil }
        XCTAssertThrowsError(try XCTUnwrap(read.result).get())
    }

    func testCoreAudioDecodesAndSeeksMP3WithLargeID3OverFragmentedHTTP() async throws {
        let (read, token, _) = try fragmentedMP3()
        read.start { source in
            let decoder = try AudioDecoder(inputSource: source, decoderName: MBDecoderNameForExtension("mp3"))
            try decoder.open()
            defer { try? decoder.close() }
            let format = decoder.processingFormat
            let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096))
            try decoder.decode(into: buffer, length: 4096)
            XCTAssertGreaterThan(buffer.frameLength, 0)
            try decoder.seek(to: AVAudioFramePosition(format.sampleRate * 2))
            try decoder.decode(into: buffer, length: 4096)
            XCTAssertGreaterThan(buffer.frameLength, 0)
            return Data()
        }
        try await waitForMP3 { read.source.downloadedFraction > 0 }
        try await Self.releaseMP3Body(token)
        try await waitForMP3 { read.result != nil }
        _ = try XCTUnwrap(read.result).get()
    }
}
