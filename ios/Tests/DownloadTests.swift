import XCTest
@testable import Mihonban

// Runs the real DownloadEngine delegate path against the fixture server. The
// session is a default configuration rather than the background one, because
// background transfers in a test host are scheduled by the system; relaunch
// delivery is therefore not covered here.
@MainActor
final class DownloadTests: XCTestCase {
    private func engine() -> (DownloadEngine, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("downloads-\(UUID().uuidString)")
        let configuration = URLSessionConfiguration.default
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        return (DownloadEngine(configuration: configuration, root: root), root)
    }

    // Track ids drive the fixture's stream routes, so a copy with another id
    // exercises a different route (a remote origin, or a missing file).
    private func renamed(_ album: Album, to id: String) -> Album {
        Album(id: id, title: album.title + " (" + id + ")", artist: album.artist, artistSort: album.artistSort,
              artists: album.artists, year: album.year, trackCount: album.trackCount, duration: album.duration,
              genres: album.genres, updatedAt: album.updatedAt,
              tracks: album.tracks?.map { Track(id: id, title: $0.title, duration: $0.duration, format: $0.format,
                                                disc: $0.disc, track: $0.track) })
    }

    func testDownloadPersistsSurvivesCacheClearAndPlaysWithoutNetwork() async throws {
        let api = try APIClient(address: "http://127.0.0.1:8766")
        api.clearCookies()
        _ = try await api.login(password: "fixture-password")
        let (engine, root) = engine()
        defer { try? FileManager.default.removeItem(at: root) }

        let local = try await api.album("network-mp3")
        // Its stream redirects to a second origin, standing in for a storage host.
        let remote = renamed(try await api.album("network-flac"), to: "network-flac-remote")
        let store = DownloadStore(client: api, engine: engine)
        await store.load()
        await store.download(album: local)
        await store.download(album: remote)
        try await waitUntil(timeout: 30) {
            store.records.count == 2 && store.records.values.allSatisfy { $0.state == .done }
        }
        XCTAssertEqual(store.state(album: local), .complete)
        for track in local.normalizedTracks + remote.normalizedTracks {
            let file = try XCTUnwrap(store.localFile(track), track.id)
            let size = try XCTUnwrap(FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber).int64Value
            XCTAssertGreaterThan(size, 1000)
            XCTAssertEqual(size, store.records[track.id]?.written)
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath:
            MediaPaths.pinnedCover(baseURL: api.baseURL, album: local.id, root: root).path), "the album cover is kept with the download")

        // The session cookie is sent to the service origin only, never to storage.
        let (data, _) = try await api.session.data(from: URL(string: "http://127.0.0.1:8766/fixture/media-cookies")!)
        let log = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: [[String: Any]]])["cookies"] ?? []
        let storage = log.filter { $0["port"] as? Int == 8767 }
        XCTAssertFalse(storage.isEmpty)
        XCTAssertTrue(storage.allSatisfy { $0["cookie"] as? Bool == false })

        // Clearing the streaming cache does not touch downloads.
        let defaultsName = "org.mihonban.download-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: defaultsName))
        defer { defaults.removePersistentDomain(forName: defaultsName) }
        let settings = CacheSettings(defaults: defaults)
        let media = MediaCache(root: root.appendingPathComponent("cache"), settings: settings)
        _ = await media.clear()
        await store.flush()

        // A fresh store restores finished records from the manifest.
        store.detach()
        let reopened = DownloadStore(client: api, engine: engine)
        await reopened.load()
        XCTAssertEqual(reopened.records.count, 2)
        XCTAssertTrue(reopened.records.values.allSatisfy { $0.state == .done })
        XCTAssertEqual(reopened.albums[local.id]?.title, local.title)

        // Playback reads the downloaded file even though the service is unreachable.
        let dead = try APIClient(address: "http://127.0.0.1:9")
        let player = PlayerModel()
        settings.enabled = false
        settings.preloadNext = false
        player.cache = settings
        player.downloads = reopened
        player.connect(dead)
        defer { player.stop(); player.setForeground(false) }
        player.play(remote.normalizedTracks)
        try await waitUntil(timeout: 20) { player.elapsed > 0.5 && !player.isLoading }
        XCTAssertNil(player.error)
        player.stop()

        // Removing an album deletes its files.
        let file = try XCTUnwrap(reopened.localFile(local.normalizedTracks[0]))
        reopened.remove(album: local.id)
        XCTAssertNil(reopened.records[local.id])
        try await waitUntil(timeout: 5) { !FileManager.default.fileExists(atPath: file.path) }
        XCTAssertEqual(reopened.state(album: local), AlbumDownloadState.none)
        reopened.detach()
    }

    func testMissingStreamIsReportedAsFailedAndRetried() async throws {
        let api = try APIClient(address: "http://127.0.0.1:8766")
        api.clearCookies()
        _ = try await api.login(password: "fixture-password")
        let (engine, root) = engine()
        defer { try? FileManager.default.removeItem(at: root) }
        let missing = renamed(try await api.album("network-mp3"), to: "network-wav")
        let store = DownloadStore(client: api, engine: engine)
        await store.load()
        await store.download(album: missing)
        try await waitUntil(timeout: 15) { store.records["network-wav"]?.state == .failed }
        XCTAssertEqual(store.records["network-wav"]?.status, 404)
        XCTAssertEqual(store.state(album: missing), .failed)
        XCTAssertNil(store.localFile(missing.normalizedTracks[0]))
        let attempt = store.records["network-wav"]?.attempt
        store.retry("network-wav")
        XCTAssertNotEqual(store.records["network-wav"]?.attempt, attempt)
        try await waitUntil(timeout: 15) { store.records["network-wav"]?.state == .failed }
        store.cancel("network-wav")
        XCTAssertNil(store.records["network-wav"])
        store.detach()
    }

    private func waitUntil(timeout: Int, _ predicate: () -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(timeout))
        while ContinuousClock.now < deadline {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTFail("Downloads did not reach the expected state", file: file, line: line)
        throw NSError(domain: "DownloadTests", code: 1)
    }
}
