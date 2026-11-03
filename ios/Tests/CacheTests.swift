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
