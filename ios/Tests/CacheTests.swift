import XCTest
@testable import Mihonban

@MainActor
final class CacheTests: XCTestCase {
    private func scratch() -> (UserDefaults, URL) {
        let defaults = UserDefaults(suiteName: "org.mihonban.tests.\(UUID().uuidString)")!
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return (defaults, directory)
    }

    func testDefaultsAndPersistence() {
        let (defaults, _) = scratch()
        let settings = CacheSettings(defaults: defaults, prefix: "test")
        XCTAssertTrue(settings.enabled)
        XCTAssertTrue(settings.preloadNext)
        XCTAssertEqual(settings.limitBytes, 1 << 30)
        settings.enabled = false
        settings.limitBytes = 256 << 20
        settings.preloadNext = false
        let reread = CacheSettings(defaults: defaults, prefix: "test")
        XCTAssertFalse(reread.enabled)
        XCTAssertFalse(reread.preloadNext)
        XCTAssertEqual(reread.limitBytes, 256 << 20)
    }

    func testUnsupportedStoredLimitFallsBack() {
        let (defaults, _) = scratch()
        defaults.set(3, forKey: "test.limit")
        XCTAssertEqual(CacheSettings(defaults: defaults, prefix: "test").limitBytes, 1 << 30)
    }

    func testLabels() {
        XCTAssertEqual(CacheSettings.label(256 << 20), "256 MB")
        XCTAssertEqual(CacheSettings.label(2 << 30), "2 GB")
        XCTAssertEqual(CacheSettings.label(0), "0 MB")
    }

    private func write(_ size: Int, to file: URL, age minutes: Double) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(repeating: 1, count: size).write(to: file)
        try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSinceNow: -minutes * 60)], ofItemAtPath: file.path)
    }

    func testPruneIsLeastRecentlyUsedAndKeepsProtectedFiles() throws {
        let (_, root) = scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let generation = root.appendingPathComponent("gaaaaaaaa")
        let audio = generation.appendingPathComponent("audio")
        let artwork = generation.appendingPathComponent("artwork")
        try write(1000, to: audio.appendingPathComponent("old.mp3"), age: 50)
        try write(2000, to: audio.appendingPathComponent("playing.mp3"), age: 40)
        try write(3000, to: audio.appendingPathComponent("recent.mp3"), age: 1)
        try write(500, to: artwork.appendingPathComponent("cover.img"), age: 30)
        try write(10, to: audio.appendingPathComponent("live.mp3.A.part"), age: 2)
        try write(10, to: audio.appendingPathComponent("stale.mp3.B.part"), age: 120)
        try write(10, to: root.appendingPathComponent("gbbbbbbbb/audio/other.mp3"), age: 1)
        XCTAssertEqual(CacheFiles.usage(generation).audio, 6000)
        XCTAssertEqual(CacheFiles.usage(generation).artwork, 500)

        XCTAssertTrue(CacheFiles.prune(root: root, generation: "gaaaaaaaa", limit: 5000, enabled: true, protected: ["playing.mp3"]))
        let names = Set(CacheFiles.entries(audio).map { $0.0.lastPathComponent } + CacheFiles.entries(artwork).map { $0.0.lastPathComponent })
        // Oldest first: old.mp3 goes (5500 left), playing.mp3 is protected, the cover then reaches the 5000 limit.
        XCTAssertEqual(names, ["playing.mp3", "recent.mp3", "live.mp3.A.part"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("gbbbbbbbb").path), "other generations are removed")

        XCTAssertTrue(CacheFiles.prune(root: root, generation: "gaaaaaaaa", limit: 5600, enabled: false, protected: []))
        XCTAssertEqual(CacheFiles.usage(generation).cached, 0)
    }

    func testClearSwitchesGenerationSoOldTransfersCannotWriteBack() async throws {
        let (defaults, root) = scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let media = MediaCache(root: root, settings: CacheSettings(defaults: defaults, prefix: "test"))
        let oldAudio = media.audioDirectory
        let partial = oldAudio.appendingPathComponent("song.mp3.X.part")
        try write(4000, to: oldAudio.appendingPathComponent("done.mp3"), age: 5)
        try write(4000, to: partial, age: 0)
        try write(700, to: media.artworkDirectory.appendingPathComponent("a.img"), age: 5)
        await media.refreshUsage()
        XCTAssertEqual(media.usage.audio, 4000)
        XCTAssertEqual(media.usage.artwork, 700)
        XCTAssertGreaterThanOrEqual(media.usage.buffering, 4000, "partial files count as playback buffer")

        let before = media.generation
        let cleared = await media.clear()
        XCTAssertTrue(cleared)
        XCTAssertNotEqual(media.generation, before)
        XCTAssertEqual(media.usage, CacheUsage())
        // A transfer that finishes after the clear renames into a directory that no longer exists.
        XCTAssertFalse(FileManager.default.fileExists(atPath: oldAudio.path))
        XCTAssertNotEqual(rename(partial.path, oldAudio.appendingPathComponent("song.mp3").path), 0)
        // The generation survives a relaunch.
        XCTAssertEqual(MediaCache(root: root, settings: CacheSettings(defaults: defaults, prefix: "test")).generation, media.generation)
    }

    func testDownloadKeysRejectUnsafeValues() {
        let service = String(repeating: "a", count: 64)
        let key = DownloadKey(service: service, file: String(repeating: "b", count: 64) + ".flac", attempt: "0123abcd", track: "id|with|bars")
        XCTAssertEqual(DownloadKey(key.text), key)
        XCTAssertNil(DownloadKey("v1|\(service)|../../escape.mp3|0123abcd|t"))
        XCTAssertNil(DownloadKey("v1|short|" + String(repeating: "b", count: 64) + ".mp3|0123abcd|t"))
        XCTAssertNil(DownloadKey(nil))
    }
}

// Hold filesystem mutations on their worker thread while the main actor stays
// free to request a clear, switch generations, or queue another prune.
private final class CacheMutationGate: @unchecked Sendable {
    private let condition = NSCondition()
    private let heldCalls: Set<Int>
    private var released: Set<Int> = []
    private var releaseEverything = false
    private var started = 0
    private var completed = 0
    private var active = 0
    private var peakActive = 0
    private var timedOut = false

    init(holding calls: Set<Int>) { heldCalls = calls }

    var state: (started: Int, completed: Int, peakActive: Int, timedOut: Bool) {
        condition.lock()
        defer { condition.unlock() }
        return (started, completed, peakActive, timedOut)
    }

    func release(_ call: Int? = nil) {
        condition.lock()
        if let call { released.insert(call) } else { releaseEverything = true }
        condition.broadcast()
        condition.unlock()
    }

    func prune(_ root: URL, _ generation: String, _ limit: Int, _ enabled: Bool,
               _ protected: Set<String>) -> Bool {
        condition.lock()
        started += 1
        let call = started
        active += 1
        peakActive = max(peakActive, active)
        let deadline = Date(timeIntervalSinceNow: 10)
        while heldCalls.contains(call) && !released.contains(call) && !releaseEverything {
            if !condition.wait(until: deadline) { timedOut = true; break }
        }
        condition.unlock()
        let result = CacheFiles.prune(root: root, generation: generation, limit: limit,
                                      enabled: enabled, protected: protected)
        condition.lock()
        active -= 1
        completed += 1
        condition.broadcast()
        condition.unlock()
        return result
    }
}

// The offline suite is selected by both iPhone and iPad native validation.
extension OfflineLaunchTests {
    func testCacheClearWaitsForExistingPruneBeforePublishingGeneration() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite = "org.mihonban.cache-order.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let settings = CacheSettings(defaults: defaults)
        let gate = CacheMutationGate(holding: [1, 2])
        let media = MediaCache(root: root, settings: settings, pruneFiles: { root, generation, limit, enabled, protected in
            gate.prune(root, generation, limit, enabled, protected)
        })
        defer {
            gate.release()
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: root)
        }
        let oldGeneration = media.generation
        let oldAudio = media.audioDirectory
        let playing = oldAudio.appendingPathComponent("playing.flac")
        try writeCacheBytes(2000, to: playing)
        let openAudio = try FileHandle(forReadingFrom: playing)
        defer { try? openAudio.close() }

        media.prune(protecting: ["playing.flac"])
        try await waitForCacheMutation { gate.state.started == 1 }
        var clearStarted = false
        let clear = Task { @MainActor in
            clearStarted = true
            return await media.clear()
        }
        try await waitForCacheMutation { clearStarted }
        XCTAssertEqual(media.generation, oldGeneration, "A live old-generation mutation must finish before publishing its replacement")
        XCTAssertEqual(gate.state.started, 1)
        media.prune(protecting: ["fresh.flac"])

        gate.release(1)
        try await waitForCacheMutation { gate.state.started == 2 }
        let freshGeneration = media.generation
        XCTAssertNotEqual(freshGeneration, oldGeneration)
        let freshAudio = media.audioDirectory.appendingPathComponent("fresh.flac")
        let freshArtwork = media.artworkDirectory.appendingPathComponent("fresh.img")
        let freshPartial = media.audioDirectory.appendingPathComponent("fresh.flac.live.part")
        try writeCacheBytes(3000, to: freshAudio)
        try writeCacheBytes(700, to: freshArtwork)
        try writeCacheBytes(500, to: freshPartial)
        gate.release(2)
        let cleared = await clear.value
        XCTAssertTrue(cleared)
        try await waitForCacheMutation { gate.state.completed >= 3 }
        await media.refreshUsage()

        XCTAssertEqual(gate.state.peakActive, 1, "Clear and prune may never delete generations concurrently")
        XCTAssertFalse(gate.state.timedOut)
        XCTAssertEqual(media.generation, freshGeneration)
        XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("generation"), encoding: .utf8), freshGeneration)
        XCTAssertFalse(FileManager.default.fileExists(atPath: oldAudio.path))
        XCTAssertEqual(try Data(contentsOf: freshAudio).count, 3000)
        XCTAssertEqual(try Data(contentsOf: freshArtwork).count, 700)
        XCTAssertEqual(try Data(contentsOf: freshPartial).count, 500)
        XCTAssertEqual(media.usage.audio, 3000)
        XCTAssertEqual(media.usage.artwork, 700)
        XCTAssertEqual(try openAudio.readToEnd()?.count, 2000, "Already-open playback remains readable after cache retirement")
    }

    func testConcurrentCacheClearsShareOneGenerationAndKeepNewFiles() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite = "org.mihonban.cache-clear.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let gate = CacheMutationGate(holding: [1])
        let media = MediaCache(root: root, settings: CacheSettings(defaults: defaults),
                               pruneFiles: { root, generation, limit, enabled, protected in
            gate.prune(root, generation, limit, enabled, protected)
        })
        defer {
            gate.release()
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: root)
        }
        let before = media.generation
        let first = Task { @MainActor in await media.clear() }
        try await waitForCacheMutation { gate.state.started == 1 }
        let freshGeneration = media.generation
        XCTAssertNotEqual(freshGeneration, before)
        var secondStarted = false
        let second = Task { @MainActor in
            secondStarted = true
            return await media.clear()
        }
        try await waitForCacheMutation { secondStarted }
        XCTAssertEqual(media.generation, freshGeneration)
        XCTAssertEqual(gate.state.started, 1)
        let fresh = media.audioDirectory.appendingPathComponent("new.flac")
        try writeCacheBytes(1234, to: fresh)
        gate.release()
        let firstResult = await first.value
        let secondResult = await second.value
        XCTAssertTrue(firstResult)
        XCTAssertTrue(secondResult)
        XCTAssertEqual(gate.state.started, 1, "Overlapping clears share the same filesystem operation")
        XCTAssertEqual(gate.state.peakActive, 1)
        XCTAssertFalse(gate.state.timedOut)
        XCTAssertEqual(media.generation, freshGeneration)
        XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("generation"), encoding: .utf8), freshGeneration)
        XCTAssertEqual(try Data(contentsOf: fresh).count, 1234)
        XCTAssertEqual(media.usage.audio, 1234)
    }

    private func writeCacheBytes(_ count: Int, to file: URL) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(repeating: 7, count: count).write(to: file)
    }

    private func waitForCacheMutation(_ condition: () -> Bool,
                                      file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while ContinuousClock.now < deadline {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Cache mutation did not reach the expected ordering boundary", file: file, line: line)
        throw NSError(domain: "CacheMutationOrderingTests", code: 1)
    }
}
