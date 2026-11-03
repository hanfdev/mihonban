import XCTest
import AVFAudio
@preconcurrency import SFBAudioEngine
@testable import Mihonban

final class AudioTests: XCTestCase {
    func testMP3FLACAndVorbisDecodeAndSeek() throws {
        for ext in ["mp3", "flac", "ogg"] {
            let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "tone", withExtension: ext))
            let decoder = try AudioDecoder(url: url, decoderName: MBDecoderNameForExtension(ext))
            try decoder.open()
            let format = decoder.processingFormat
            let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096))
            try decoder.decode(into: buffer, length: 4096)
            XCTAssertGreaterThan(buffer.frameLength, 0, ext)
            XCTAssertTrue(decoder.supportsSeeking, ext)
            try decoder.seek(to: AVAudioFramePosition(format.sampleRate))
            try decoder.decode(into: buffer, length: 4096)
            XCTAssertGreaterThan(buffer.frameLength, 0, ext)
            try decoder.close()
        }
    }

    func testProgressiveSourceReadsSeeksAndCommits() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = directory.appendingPathComponent("tone.flac")
        let source = MBHTTPInputSource(remoteURL: URL(string: "http://127.0.0.1:8766/tone.flac")!, cacheURL: cache)
        defer { source.cancel() }
        try source.open()
        let length = try source.length
        XCTAssertGreaterThan(length, 100)
        var bytes = [UInt8](repeating: 0, count: 4)
        let count = try bytes.withUnsafeMutableBytes { try source.read($0.baseAddress!, length: 4) }
        XCTAssertEqual(count, 4)
        XCTAssertEqual(String(bytes: bytes, encoding: .ascii), "fLaC")
        try source.seek(toOffset: length - 16)
        let tail = try source.read(length: 16)
        XCTAssertEqual(tail.count, 16)
        try source.seek(toOffset: 0)
        let decoder = try AudioDecoder(inputSource: source, decoderName: MBDecoderNameForExtension("flac"))
        try decoder.open()
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: decoder.processingFormat, frameCapacity: 4096))
        var frames = 0
        repeat {
            try decoder.decode(into: buffer, length: 4096)
            frames += Int(buffer.frameLength)
        } while buffer.frameLength > 0
        XCTAssertGreaterThan(frames, 300000)
        try decoder.close()
    }

    func testCancelledSourceNeverBlocksOpen() {
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let source = MBHTTPInputSource(remoteURL: URL(string: "http://127.0.0.1:8766/stall")!, cacheURL: cache)
        source.cancel()
        XCTAssertThrowsError(try source.open())
    }

    func testRangeIgnoredIsNotMistakenForTailBytes() throws {
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: cache) }
        let source = MBHTTPInputSource(remoteURL: URL(string: "http://127.0.0.1:8766/no-range/tone.flac")!, cacheURL: cache)
        defer { source.cancel() }
        try source.open()
        let length = try source.length
        try source.seek(toOffset: length - 16)
        let actual = try source.read(length: 16)
        let fixture = try Data(contentsOf: XCTUnwrap(Bundle(for: Self.self).url(forResource: "tone", withExtension: "flac")))
        XCTAssertEqual(actual, fixture.suffix(16))
    }
}
