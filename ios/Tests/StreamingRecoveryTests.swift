import XCTest
import AVFAudio
@preconcurrency import SFBAudioEngine
@testable import Mihonban

private struct StreamingRecoverySnapshot: Decodable {
    struct Attempt: Decodable {
        let start: Int
        let sent: Int
        let finished: Bool
        let drop: Bool
    }
    let attempts: [Attempt]
    let drops: Int
}

// The source synchronizes its own state. Blocking decoder reads belong to a
// worker while the main actor can cancel or inspect the test's player state.
private final class StreamingRecoverySource: @unchecked Sendable {
    let value: MBHTTPInputSource
    init(_ source: MBHTTPInputSource) { value = source }
}

private final class StreamingRecoveryRead: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Result<Data, Error>?
    var result: Result<Data, Error>? { lock.withLock { stored } }

    func run(_ action: @escaping @Sendable () throws -> Data) {
        Task.detached(priority: .userInitiated) {
            let result = Result { try action() }
            self.lock.withLock { self.stored = result }
        }
    }
}

@MainActor
private final class StreamingRecoveryFixture {
    let token = UUID().uuidString
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("stream-recovery-\(UUID().uuidString)")
    let api: APIClient
    let audio: Data
    private var sources: [StreamingRecoverySource] = []
    private var reads: [StreamingRecoveryRead] = []

    init() throws {
        api = try APIClient(address: "http://127.0.0.1:8766")
        let path = try XCTUnwrap(Bundle(for: OfflineLaunchTests.self).url(forResource: "tone", withExtension: "flac"))
        audio = try Data(contentsOf: path)
    }

    var control: URL { api.url("fixture", "stream-recovery", token) }
    var track: Track { Track(id: "network-flac-recovery-\(token)", title: "Recovery fixture", duration: 8, format: "flac") }

    func configure(failures: Int = 1, prefix: Int = 8192, ignoreRange: Bool = false, hold: Bool = false,
                   status: Int = 0, interruptWhenRequested: Bool = false) async throws {
        var request = URLRequest(url: control)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let options: [String: Any] = ["failures": failures, "prefix": prefix, "ignoreRange": ignoreRange,
                                     "hold": hold, "status": status, "interruptWhenRequested": interruptWhenRequested]
        request.httpBody = try JSONSerialization.data(withJSONObject: options)
        let (_, response) = try await api.session.data(for: request)
        try APIClient.validate(response)
    }

    func snapshot() async throws -> StreamingRecoverySnapshot {
        let (data, response) = try await api.session.data(from: control)
        try APIClient.validate(response)
        return try JSONDecoder().decode(StreamingRecoverySnapshot.self, from: data)
    }

    func release() async throws {
        var request = URLRequest(url: control.appendingPathComponent("release"))
        request.httpMethod = "POST"
        let (_, response) = try await api.session.data(for: request)
        try APIClient.validate(response)
    }

    func interrupt() async throws {
        var request = URLRequest(url: control.appendingPathComponent("interrupt"))
        request.httpMethod = "POST"
        let (_, response) = try await api.session.data(for: request)
        try APIClient.validate(response)
    }

    func source() -> StreamingRecoverySource {
        let value = StreamingRecoverySource(MBHTTPInputSource(remoteURL: api.url("recovery", token, "tone.flac"),
                                                               cacheURL: root.appendingPathComponent("tone.flac")))
        sources.append(value)
        return value
    }

    func read(_ action: @escaping @Sendable () throws -> Data) -> StreamingRecoveryRead {
        let read = StreamingRecoveryRead()
        reads.append(read)
        read.run(action)
        return read
    }

    func cleanup() async {
        sources.forEach { $0.value.cancel() }
        try? await release()
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while reads.contains(where: { $0.result == nil }), ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(20))
        }
        sources.forEach { try? $0.value.close() }
        try? FileManager.default.removeItem(at: root)
    }
}

// Both native device suites select OfflineLaunchTests. These regressions use
// real incomplete HTTP bodies and real decoder reads, not mocked URL errors.
extension OfflineLaunchTests {
    func testStreamingConnectionLossResumesFromReceivedBytesWithoutCorruption() async throws {
        let fixture = try StreamingRecoveryFixture()
        addTeardownBlock { await fixture.cleanup() }
        try await fixture.configure(failures: 2, prefix: 8192)
        let source = fixture.source()
        let read = fixture.read {
            try source.value.open()
            return try Self.readRecoverySourceToEnd(source)
        }
        try await waitForStreamingRecovery { read.result != nil }
        XCTAssertEqual(try XCTUnwrap(read.result).get(), fixture.audio)
        let log = try await fixture.snapshot()
        XCTAssertEqual(log.drops, 2)
        XCTAssertEqual(log.attempts.map(\.start), [0, 8192, 8192], "Resume from received bytes without a request storm")
        try await waitForStreamingRecovery { FileManager.default.fileExists(atPath: fixture.root.appendingPathComponent("tone.flac").path) }
        XCTAssertEqual(try Data(contentsOf: fixture.root.appendingPathComponent("tone.flac")), fixture.audio)
    }

    func testStreamingRecoveryRestartsAtZeroWhenServerIgnoresRanges() async throws {
        let fixture = try StreamingRecoveryFixture()
        addTeardownBlock { await fixture.cleanup() }
        try await fixture.configure(failures: 2, prefix: 8192, ignoreRange: true)
        let source = fixture.source()
        let read = fixture.read {
            try source.value.open()
            return try Self.readRecoverySourceToEnd(source)
        }
        try await waitForStreamingRecovery { read.result != nil }
        XCTAssertEqual(try XCTUnwrap(read.result).get(), fixture.audio)
        let log = try await fixture.snapshot()
        XCTAssertEqual(log.drops, 2)
        XCTAssertEqual(log.attempts.map(\.start), [0, 0, 0])
    }

    func testStreamingRecoveryStillExposesBytesAlreadyBuffered() async throws {
        let fixture = try StreamingRecoveryFixture()
        addTeardownBlock { await fixture.cleanup() }
        try await fixture.configure(prefix: 8192, hold: true)
        let source = fixture.source()
        let opening = fixture.read { try source.value.open(); return Data() }
        try await waitForStreamingRecovery { opening.result != nil }
        _ = try XCTUnwrap(opening.result).get()
        try await waitForStreamingRecovery { source.value.isRecovering }
        let buffered = fixture.read { try source.value.read(length: 8192) }
        try await waitForStreamingRecovery { buffered.result != nil }
        XCTAssertEqual(try XCTUnwrap(buffered.result).get(), fixture.audio.prefix(8192))
        XCTAssertTrue(source.value.isRecovering, "Reading cached bytes must not depend on the connection returning")
        source.value.cancel()
    }

    func testCancellingDuringStreamingRecoveryRetiresPendingRetries() async throws {
        let fixture = try StreamingRecoveryFixture()
        addTeardownBlock { await fixture.cleanup() }
        try await fixture.configure(prefix: 8192, hold: true)
        let source = fixture.source()
        let read = fixture.read {
            try source.value.open()
            return try Self.readRecoverySourceToEnd(source)
        }
        try await waitForStreamingRecovery { source.value.isRecovering }
        source.value.cancel()
        try await waitForStreamingRecovery { read.result != nil }
        do {
            _ = try XCTUnwrap(read.result).get()
            XCTFail("Cancellation must wake the decoder's blocked read")
        } catch {
            let error = error as NSError
            XCTAssertEqual(error.domain, NSURLErrorDomain)
            XCTAssertEqual(error.code, URLError.cancelled.rawValue)
        }
        let cancelled = try await fixture.snapshot()
        try await Task.sleep(for: .milliseconds(1100))
        let later = try await fixture.snapshot()
        XCTAssertEqual(later.attempts.count, cancelled.attempts.count, "A retired retry must not issue another request")
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.root.appendingPathComponent("tone.flac").path))
    }

    func testUncachedSeekDuringStreamingRecoveryRetiresTheOldRangeRetry() async throws {
        let fixture = try StreamingRecoveryFixture()
        addTeardownBlock { await fixture.cleanup() }
        try await fixture.configure(prefix: 8192, hold: true)
        let source = fixture.source()
        let opening = fixture.read { try source.value.open(); return Data() }
        try await waitForStreamingRecovery { opening.result != nil }
        _ = try XCTUnwrap(opening.result).get()
        try await waitForStreamingRecovery { source.value.isRecovering }
        let beforeSeek = try await fixture.snapshot()
        let offset = fixture.audio.count - 64
        try source.value.seek(toOffset: offset)
        let tail = fixture.read { try Self.readRecoverySourceToEnd(source) }
        try await waitForStreamingRecovery {
            let log = try await fixture.snapshot()
            return log.attempts.dropFirst(beforeSeek.attempts.count).contains { $0.start == offset }
        }
        try await fixture.release()
        try await waitForStreamingRecovery { tail.result != nil }
        XCTAssertEqual(try XCTUnwrap(tail.result).get(), fixture.audio.suffix(64))
        try await Task.sleep(for: .milliseconds(1100))
        let log = try await fixture.snapshot()
        let afterSeek = Array(log.attempts.dropFirst(beforeSeek.attempts.count))
        let newRangeIndex = try XCTUnwrap(afterSeek.firstIndex { $0.start == offset })
        // An old request already in flight may reach the server just before
        // the seek request. Once the new range arrives, only it may be retried.
        XCTAssertTrue(afterSeek[newRangeIndex...].allSatisfy { $0.start == offset },
                      "The older received-byte retry must not replace the user's new range")
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.root.appendingPathComponent("tone.flac").path),
                       "A successful sparse tail request must not publish an incomplete cache file")
    }

    func testStreaming404RemainsTerminalWithoutRetrying() async throws {
        let fixture = try StreamingRecoveryFixture()
        addTeardownBlock { await fixture.cleanup() }
        try await fixture.configure(failures: 0, status: 404)
        let source = fixture.source()
        let read = fixture.read {
            try source.value.open()
            return try Self.readRecoverySourceToEnd(source)
        }
        try await waitForStreamingRecovery { read.result != nil }
        do {
            _ = try XCTUnwrap(read.result).get()
            XCTFail("A missing track must fail instead of entering transport recovery")
        } catch {
            let error = error as NSError
            XCTAssertEqual(error.domain, "Mihonban.HTTP")
            XCTAssertEqual(error.code, 404)
        }
        try await Task.sleep(for: .milliseconds(1100))
        let log = try await fixture.snapshot()
        XCTAssertEqual(log.attempts.count, 1, "A permanent HTTP error must not consume a retry budget")
    }

    func testMalformedPartialResponseIsNotRetriedAsAConnectionLoss() async throws {
        let fixture = try StreamingRecoveryFixture()
        addTeardownBlock { await fixture.cleanup() }
        // A 206 without Content-Range is a protocol failure, not an outage.
        try await fixture.configure(failures: 0, status: 206)
        let source = fixture.source()
        let read = fixture.read { try source.value.open(); return Data() }
        try await waitForStreamingRecovery { read.result != nil }
        do {
            _ = try XCTUnwrap(read.result).get()
            XCTFail("Malformed range metadata must not become playable audio")
        } catch {
            let error = error as NSError
            XCTAssertEqual(error.domain, "Mihonban.HTTP")
            XCTAssertEqual(error.code, 206)
        }
        XCTAssertFalse(source.value.isRecovering)
        try await Task.sleep(for: .milliseconds(1100))
        let log = try await fixture.snapshot()
        XCTAssertEqual(log.attempts.count, 1)
    }

    func testActualFLACDecoderContinuesAfterInterruptedHTTPBody() async throws {
        let fixture = try StreamingRecoveryFixture()
        addTeardownBlock { await fixture.cleanup() }
        try await fixture.configure(failures: 2, prefix: 16384)
        let source = fixture.source()
        let read = fixture.read {
            let decoder = try AudioDecoder(inputSource: source.value, decoderName: MBDecoderNameForExtension("flac"))
            try decoder.open()
            defer { try? decoder.close() }
            let format = decoder.processingFormat
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096) else {
                throw NSError(domain: "StreamingRecoveryTests", code: 1)
            }
            var frames = 0
            repeat {
                try decoder.decode(into: buffer, length: 4096)
                frames += Int(buffer.frameLength)
            } while buffer.frameLength > 0
            return Data(String(frames).utf8)
        }
        try await waitForStreamingRecovery { read.result != nil }
        let frames = Int(String(decoding: try XCTUnwrap(read.result).get(), as: UTF8.self))
        XCTAssertEqual(frames, 352800, "The eight-second fixture must decode all frames through recovery")
        let log = try await fixture.snapshot()
        XCTAssertEqual(log.drops, 2)
        XCTAssertLessThanOrEqual(log.attempts.count, 5, "Decoder probes must not turn retry waits into a busy loop")
    }

    func testPlayerKeepsPlaybackIntentThroughAStreamingOutage() async throws {
        let (fixture, player) = try await activePlayerWithInterruptedStream()
        XCTAssertNil(player.error, "A temporary transport loss must not become a playback error")
        XCTAssertTrue(player.wantsPlayback, "Recovery preserves the listener's play intent")
        XCTAssertEqual(player.current?.id, fixture.track.id)
        let position = player.elapsed
        try await fixture.release()
        try await waitForStreamingRecovery {
            let log = try await fixture.snapshot()
            return log.attempts.last?.finished == true && log.attempts.last?.drop == false
        }
        try await waitForStreamingRecovery { player.elapsed > position + 0.2 && !player.isLoading }
        XCTAssertNil(player.error)
        XCTAssertTrue(player.wantsPlayback)
        XCTAssertEqual(player.current?.id, fixture.track.id)
        XCTAssertFalse(player.hasEnded)
    }

    func testPausingDuringStreamingOutageDoesNotResumeWhenConnectionReturns() async throws {
        let (fixture, player) = try await activePlayerWithInterruptedStream()
        player.pause()
        let pausedAt = player.elapsed
        XCTAssertFalse(player.wantsPlayback)
        try await fixture.release()
        try await waitForStreamingRecovery {
            let log = try await fixture.snapshot()
            return log.attempts.last?.finished == true && log.attempts.last?.drop == false && log.attempts.count > 2
        }
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertNil(player.error)
        XCTAssertFalse(player.wantsPlayback, "Restoring data must not override an explicit pause")
        XCTAssertEqual(player.elapsed, pausedAt, accuracy: 0.15)
        XCTAssertEqual(player.current?.id, fixture.track.id)
        player.resume()
        try await waitForStreamingRecovery { player.elapsed > pausedAt + 0.2 && !player.isLoading }
        XCTAssertTrue(player.wantsPlayback)
        XCTAssertNil(player.error)
    }

    private func activePlayerWithInterruptedStream() async throws -> (StreamingRecoveryFixture, PlayerModel) {
        let fixture = try StreamingRecoveryFixture()
        addTeardownBlock { await fixture.cleanup() }
        try await fixture.configure(prefix: fixture.audio.count / 2, hold: true, interruptWhenRequested: true)
        _ = try await fixture.api.login(password: "fixture-password")
        let defaultsName = "org.mihonban.stream-recovery.\(fixture.token)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: defaultsName))
        let settings = CacheSettings(defaults: defaults)
        settings.enabled = false
        settings.preloadNext = false
        let player = PlayerModel(monitorNetwork: false)
        player.cache = settings
        player.connect(fixture.api)
        addTeardownBlock {
            await MainActor.run {
                player.stop()
                player.setForeground(false)
                UserDefaults(suiteName: defaultsName)?.removePersistentDomain(forName: defaultsName)
            }
        }
        player.play([fixture.track])
        try await waitForStreamingRecovery { player.elapsed > 0.3 && !player.isLoading }
        let before = try await fixture.snapshot()
        XCTAssertEqual(before.drops, 0, "The stream must still be connected when playback starts")
        XCTAssertNil(player.error)
        XCTAssertTrue(player.wantsPlayback)
        try await fixture.interrupt()
        try await waitForStreamingRecovery {
            let log = try await fixture.snapshot()
            return log.drops >= 2
        }
        return (fixture, player)
    }

    nonisolated private static func readRecoverySourceToEnd(_ source: StreamingRecoverySource) throws -> Data {
        var bytes = Data()
        while true {
            let next = try source.value.read(length: 32768)
            if next.isEmpty { return bytes }
            bytes.append(next)
        }
    }

    private func waitForStreamingRecovery(_ condition: () async throws -> Bool,
                                           file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(20))
        while ContinuousClock.now < deadline {
            if try await condition() { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Streaming recovery did not reach the expected state", file: file, line: line)
        throw NSError(domain: "StreamingRecoveryTests", code: 2)
    }
}
