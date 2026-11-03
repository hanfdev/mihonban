import Foundation
import Observation

// Composes the service session with the catalog, favorites and player stores.
// Domain rules live in those stores; this type only wires connection state.
@MainActor @Observable
final class AppModel {
    var connecting = false
    var error: String?
    var address = UserDefaults.standard.string(forKey: "serviceAddress") ?? ""
    var password = ""
    var rememberPassword = true
    var demo = false
    // A route requested outside a navigation stack, such as from Now Playing.
    var pendingRoute: CatalogRoute?
    var cache = CacheSettings()
    let sessionStore: SessionStore
    let favorites: FavoritesStore
    let catalog: CatalogStore
    let player = PlayerModel()
    @ObservationIgnored private var generation = UUID()

    init() {
        let session = SessionStore()
        let favorites = FavoritesStore(session: session)
        sessionStore = session
        self.favorites = favorites
        catalog = CatalogStore(session: session, favorites: favorites)
        player.cache = cache
    }

    var client: APIClient? { sessionStore.client }
    var session: SessionInfo? { sessionStore.info }
    // Image requests are skipped in demo mode, whose service address is fake.
    var imageClient: APIClient? { demo ? nil : sessionStore.client }
    var signedIn: Bool { sessionStore.info?.ok == true && !sessionStore.needsSignIn }

    var cacheUsage: Int { AudioCache.usedBytes(audioCacheDirectory) }

    private var audioCacheDirectory: URL {
        (client?.cacheDirectory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0])
            .appendingPathComponent("audio", isDirectory: true)
    }

    func clearCache() { AudioCache.remove(audioCacheDirectory) }

    func bootstrap() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--demo"), let api = try? APIClient(address: "https://example.invalid") {
            demo = true
            sessionStore.connect(api, info: SessionInfo(ok: true, role: "user", guest: true))
            let albums = DemoLibrary.albums
            catalog.seed(albums: albums, artists: [], tracks: albums.flatMap(\.normalizedTracks))
            player.connect(api, demoURL: try? DemoLibrary.tone())
            return
        }
        #endif
        guard !address.isEmpty else { return }
        await connect(automatic: true)
    }

    func connect(automatic: Bool = false) async {
        guard !connecting else { return }
        connecting = true
        error = nil
        let token = generation
        defer { if token == generation { connecting = false } }
        do {
            let api = try APIClient(address: address)
            let saved = CredentialStore.read(for: api.baseURL.absoluteString)
            let supplied = automatic ? (saved ?? "") : password
            let state: SessionInfo
            if !supplied.isEmpty { state = try await api.login(password: supplied) }
            else { state = try await api.me() }
            guard token == generation else { return }
            guard state.ok else { throw ClientError.sessionExpired }
            if !automatic {
                if !CredentialStore.save(rememberPassword ? supplied : nil, for: api.baseURL.absoluteString) {
                    error = L10n.text("mobile.keychainFailed")
                }
            }
            password = ""
            address = api.baseURL.absoluteString
            UserDefaults.standard.set(address, forKey: "serviceAddress")
            favorites.reset()
            // Metadata is shown only after authorization, never while signed out.
            sessionStore.connect(api, info: state)
            AudioCache.prune(audioCacheDirectory, limit: cache.limitBytes, enabled: cache.enabled)
            player.connect(api)
            await catalog.connect()
        } catch {
            guard token == generation else { return }
            self.error = (error as? ClientError)?.errorDescription ?? L10n.text("mobile.connectionFailed")
        }
    }

    func refresh() async {
        guard signedIn, !demo else { return }
        await catalog.refresh()
    }

    func album(_ id: String) async throws -> Album {
        try await catalog.album(id)
    }

    func playAlbum(_ id: String, shuffle: Bool = false) async {
        do {
            let tracks = try await catalog.album(id).normalizedTracks
            guard !tracks.isEmpty else { return }
            player.play(tracks, shuffle: shuffle)
        } catch { player.error = error.localizedDescription }
    }

    func enqueueAlbum(_ id: String, next: Bool) async {
        do { player.enqueue(try await catalog.album(id).normalizedTracks, next: next) }
        catch { player.error = error.localizedDescription }
    }

    // Matches the web artist page: owned albums in catalog order, then guest appearances.
    func playArtist(_ name: String, shuffle: Bool = false) async {
        do {
            var tracks: [Track] = []
            let owned = catalog.index.albums.filter { $0.credits.contains { $0.name == name } }
                .sorted { ($0.year ?? 0, $0.title) < ($1.year ?? 0, $1.title) }
            for album in owned { tracks += try await catalog.album(album.id).normalizedTracks }
            tracks += try await catalog.artistTracks(name)
            guard !tracks.isEmpty else { return }
            player.play(tracks, shuffle: shuffle)
        } catch { player.error = error.localizedDescription }
    }

    func disconnect() {
        generation = UUID()
        player.stop()
        if let client {
            client.clearCookies()
            _ = CredentialStore.save(nil, for: client.baseURL.absoluteString)
        }
        sessionStore.invalidate()
        catalog.reset()
        favorites.reset()
        pendingRoute = nil
        password = ""
        error = nil
        connecting = false
        demo = false
    }
}

enum AudioCache {
    static func usedBytes(_ directory: URL) -> Int {
        let manager = FileManager.default
        guard let files = try? manager.contentsOfDirectory(at: directory,
            includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
        return files.reduce(0) { $0 + ((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
    }

    static func remove(_ directory: URL) {
        try? FileManager.default.removeItem(at: directory)
    }

    // Incomplete transfers are always discarded; finished files are dropped
    // oldest first until the limit holds. Disabling the cache clears it.
    static func prune(_ directory: URL, limit: Int, enabled: Bool) {
        let manager = FileManager.default
        guard let files = try? manager.contentsOfDirectory(at: directory,
            includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]) else { return }
        var complete: [(URL, Int, Date)] = []
        for file in files {
            if file.pathExtension == "part" { try? manager.removeItem(at: file); continue }
            let values = try? file.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            complete.append((file, values?.fileSize ?? 0, values?.contentModificationDate ?? .distantPast))
        }
        var size = complete.reduce(0) { $0 + $1.1 }
        let ceiling = enabled ? max(0, limit) : 0
        for (file, bytes, _) in complete.sorted(by: { $0.2 < $1.2 }) {
            if enabled && size <= ceiling { break }
            if (try? manager.removeItem(at: file)) != nil { size -= bytes }
        }
    }
}
