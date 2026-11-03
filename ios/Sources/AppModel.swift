import Foundation
import Observation

@MainActor @Observable
final class AppModel {
    var client: APIClient?
    var session: SessionInfo?
    var albums: [Album] = []
    var connecting = false
    var refreshing = false
    var error: String?
    var query = ""
    var address = UserDefaults.standard.string(forKey: "serviceAddress") ?? ""
    var password = ""
    var rememberPassword = true
    var demo = false
    let player = PlayerModel()
    @ObservationIgnored private var snapshot: LibrarySnapshot?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var details: [String: Album] = [:]

    var visibleAlbums: [Album] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return albums }
        return albums.filter { album in
            [album.title, album.artist, album.artistSort ?? "", (album.genres ?? []).joined(separator: " ")]
                .contains { $0.localizedStandardContains(query) }
        }
    }

    func bootstrap() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--demo") {
            demo = true
            client = try? APIClient(address: "https://example.invalid")
            albums = DemoLibrary.albums
            session = SessionInfo(ok: true, role: "user", guest: true)
            if let client { player.connect(client, demoURL: try? DemoLibrary.tone()) }
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
            client = api
            session = state
            // Metadata is shown only after authorization, never while signed out.
            snapshot = api.savedLibrary()
            albums = snapshot?.albums ?? []
            details.removeAll()
            AudioCache.prune(api.cacheDirectory.appendingPathComponent("audio"))
            player.connect(api)
            await refresh()
        } catch {
            guard token == generation else { return }
            self.error = (error as? ClientError)?.errorDescription ?? L10n.text("mobile.connectionFailed")
        }
    }

    func refresh() async {
        guard let client, !demo, !refreshing else { return }
        refreshing = true
        let token = generation
        defer { if token == generation { refreshing = false } }
        do {
            let updated: LibrarySnapshot
            do { updated = try await client.library(previous: snapshot) }
            catch let error as ClientError where error.key == "mobile.sessionExpired" {
                guard let password = CredentialStore.read(for: client.baseURL.absoluteString) else { throw error }
                let state = try await client.login(password: password)
                guard token == generation else { return }
                session = state
                updated = try await client.library(previous: snapshot)
            }
            guard token == generation else { return }
            snapshot = updated
            albums = updated.albums
            client.saveLibrary(updated)
        } catch {
            guard token == generation else { return }
            self.error = (error as? ClientError)?.errorDescription ?? L10n.text("mobile.connectionFailed")
        }
    }

    func album(_ id: String) async throws -> Album {
        #if DEBUG
        if demo, let album = albums.first(where: { $0.id == id }) { return album }
        #endif
        if let value = details[id] { return value }
        guard let client else { throw ClientError.connection }
        let token = generation
        let album = try await client.album(id)
        guard token == generation else { throw CancellationError() }
        details[id] = album
        return album
    }

    func disconnect() {
        generation = UUID()
        player.stop()
        client?.clearCookies()
        if let client { CredentialStore.save(nil, for: client.baseURL.absoluteString) }
        client = nil
        session = nil
        snapshot = nil
        albums = []
        details.removeAll()
        query = ""
        password = ""
        error = nil
        connecting = false
        refreshing = false
        demo = false
    }
}

enum AudioCache {
    static func prune(_ directory: URL) {
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
        for (file, bytes, _) in complete.sorted(by: { $0.2 < $1.2 }) where size > 1024 * 1024 * 1024 {
            if (try? manager.removeItem(at: file)) != nil { size -= bytes }
        }
    }
}
