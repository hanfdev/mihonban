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

    func testUsagePruneAndClear() throws {
        let (_, directory) = scratch()
        defer { try? FileManager.default.removeItem(at: directory) }
        for (index, size) in [1000, 2000, 4000].enumerated() {
            let file = directory.appendingPathComponent("track\(index).mp3")
            try Data(repeating: 0, count: size).write(to: file)
            try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: Double(index) * 60)],
                                                  ofItemAtPath: file.path)
        }
        try Data(repeating: 0, count: 10).write(to: directory.appendingPathComponent("half.uuid.part"))
        XCTAssertEqual(AudioCache.usedBytes(directory), 7010)
        AudioCache.prune(directory, limit: 5000, enabled: true)
        let remaining = try FileManager.default.contentsOfDirectory(atPath: directory.path).sorted()
        XCTAssertEqual(remaining, ["track2.mp3"])
        XCTAssertEqual(AudioCache.usedBytes(directory), 4000)
        AudioCache.prune(directory, limit: 5000, enabled: false)
        XCTAssertEqual(AudioCache.usedBytes(directory), 0)
        AudioCache.remove(directory)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    }
}
