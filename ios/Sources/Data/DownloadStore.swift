import Foundation
import Observation

nonisolated struct DownloadRecord: Codable, Identifiable, Hashable, Sendable {
    enum State: String, Codable, Sendable { case queued, downloading, done, failed, interrupted }
    var track: Track
    var albumID: String
    var file: String
    var attempt: String
    var state: State
    var written: Int64 = 0
    var expected: Int64 = 0
    var status: Int?
    var added: Date
    var id: String { track.id }
    var fraction: Double { state == .done ? 1 : expected > 0 ? min(1, Double(written) / Double(expected)) : 0 }
}

nonisolated struct DownloadManifest: Codable, Sendable {
    var version = 1
    var records: [DownloadRecord] = []
    var albums: [String: Album] = [:]
}

enum AlbumDownloadState: Equatable {
    case none, partial, downloading(Double), failed, complete
}

// Explicit downloads for one service. They live outside the Caches directory,
// are never touched by cache limits or "Clear cache", and are removed only by
// the user. The manifest is written atomically after every state change.
@MainActor @Observable
final class DownloadStore {
    private(set) var records: [String: DownloadRecord] = [:]
    private(set) var albums: [String: Album] = [:]
    private(set) var loaded = false

    @ObservationIgnored let service: String
    @ObservationIgnored let directory: URL
    @ObservationIgnored private let engine: DownloadEngine
    @ObservationIgnored private let client: APIClient
    @ObservationIgnored private var waiting: [String] = []
    @ObservationIgnored private var resolving = 0
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    private static let parallelResolves = 3

    init(client: APIClient, engine: DownloadEngine = .shared) {
        self.client = client
        self.engine = engine
        service = MediaPaths.service(client.baseURL)
        directory = MediaPaths.downloads(root: engine.root, service: service)
    }

    private var manifestURL: URL { directory.appendingPathComponent("manifest.json") }

    // Loads the manifest and reconciles it with the transfers the system still
    // holds. A transfer that vanished was cancelled by a force quit or a
    // reboot; it is shown as interrupted, never as failed or finished.
    func load() async {
        let (url, engine, service) = (manifestURL, engine, service)
        let saved = await Task.detached(priority: .userInitiated) { () -> DownloadManifest? in
            guard let data = try? Data(contentsOf: url) else { return nil }
            return try? JSONDecoder().decode(DownloadManifest.self, from: data)
        }.value
        let live = await engine.liveKeys()
        let restored = await Task.detached(priority: .userInitiated) { () -> [DownloadRecord] in
            (saved?.records ?? []).map { original in
                var record = original
                let key = DownloadKey(service: service, file: record.file, attempt: record.attempt, track: record.track.id)
                let path = engine.destination(key).path
                let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? NSNumber)?.int64Value
                switch record.state {
                case .done:
                    if size == nil { record.state = .interrupted; record.written = 0 }
                case .queued, .downloading:
                    if live.contains(key) { record.state = .downloading }
                    else if let size, size > 0 { record.state = .done; record.written = size; record.expected = size }
                    else { record.state = .interrupted }
                case .failed, .interrupted: break
                }
                return record
            }
        }.value
        records = Dictionary(restored.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        albums = saved?.albums ?? [:]
        loaded = true
        engine.attach(DownloadStore.forwarder(self))
        save()
    }

    func detach() {
        engine.attach(nil)
        saveTask?.cancel()
    }

    nonisolated private static func forwarder(_ store: DownloadStore) -> @Sendable (DownloadEvent) -> Void {
        { [weak store] event in
            guard let target = store else { return }
            Task { @MainActor in target.apply(event) }
        }
    }

    private func key(_ record: DownloadRecord) -> DownloadKey {
        DownloadKey(service: service, file: record.file, attempt: record.attempt, track: record.track.id)
    }

    private func apply(_ event: DownloadEvent) {
        let target = event.key
        guard target.service == service, var record = records[target.track], record.attempt == target.attempt else { return }
        switch event {
        case .progress(_, let written, let expected):
            guard record.state != .done else { return }
            record.state = .downloading
            record.written = written
            record.expected = max(expected, record.expected)
            records[target.track] = record
            return
        case .finished(_, let bytes):
            record.state = .done
            record.written = bytes
            record.expected = bytes
            record.status = nil
        case .failed(_, let status):
            record.state = .failed
            record.status = status
        case .cancelled:
            records.removeValue(forKey: target.track)
            save()
            return
        }
        records[target.track] = record
        save()
    }

    // MARK: Requests

    // Downloads a whole album, or one of its tracks when `only` is set. The
    // album is kept with the records so it can be browsed without a network.
    func download(album: Album, only trackID: String? = nil) async {
        albums[album.id] = album
        for track in album.normalizedTracks where trackID == nil || track.id == trackID { enqueue(track, album: album.id) }
        save()
        pump()
        await saveCover(album.id)
    }

    private func enqueue(_ track: Track, album: String) {
        if let existing = records[track.id], existing.state != .failed && existing.state != .interrupted { return }
        records[track.id] = DownloadRecord(track: track, albumID: album, file: MediaPaths.audioName(track),
                                           attempt: DownloadKey.newAttempt(), state: .queued, added: Date())
        waiting.append(track.id)
    }

    func cancel(_ trackID: String) {
        guard let record = records.removeValue(forKey: trackID) else { return }
        waiting.removeAll { $0 == trackID }
        if record.state == .downloading { engine.cancel(key(record)) }
        save()
    }

    // Stops unfinished transfers of an album; finished tracks are kept.
    func cancel(album albumID: String) {
        records.values.filter { $0.albumID == albumID && $0.state != .done }.forEach { cancel($0.id) }
        pruneAlbums()
    }

    func retry(_ trackID: String) {
        guard var record = records[trackID], record.state == .failed || record.state == .interrupted else { return }
        // A new attempt token makes any late event from the old transfer inert.
        record.attempt = DownloadKey.newAttempt()
        record.state = .queued
        record.written = 0
        record.status = nil
        records[trackID] = record
        waiting.append(trackID)
        save()
        pump()
    }

    func retryAll() {
        records.values.filter { $0.state == .failed || $0.state == .interrupted }.forEach { retry($0.id) }
    }

    func remove(_ trackID: String) {
        guard let record = records[trackID] else { return }
        cancel(trackID)
        let file = engine.destination(key(record))
        Task.detached(priority: .utility) { try? FileManager.default.removeItem(at: file) }
        pruneAlbums()
    }

    func remove(album albumID: String) {
        records.values.filter { $0.albumID == albumID }.forEach { remove($0.id) }
        albums.removeValue(forKey: albumID)
        let cover = MediaPaths.pinnedCover(baseURL: client.baseURL, album: albumID, root: engine.root)
        Task.detached(priority: .utility) { try? FileManager.default.removeItem(at: cover) }
        save()
    }

    func removeAll() {
        Array(albums.keys).forEach { remove(album: $0) }
        Array(records.keys).forEach { remove($0) }
    }

    func flush() async { saveTask?.cancel(); await write() }

    // MARK: Queries

    func localFile(_ track: Track) -> URL? {
        guard let record = records[track.id], record.state == .done else { return nil }
        return engine.destination(key(record))
    }

    func state(album: Album) -> AlbumDownloadState {
        let ids = (album.tracks ?? []).map(\.id)
        let owned = ids.compactMap { records[$0] }
        guard !owned.isEmpty else { return .none }
        if owned.contains(where: { $0.state == .queued || $0.state == .downloading }) {
            return .downloading(owned.reduce(0) { $0 + $1.fraction } / Double(max(ids.count, owned.count)))
        }
        if owned.contains(where: { $0.state == .failed || $0.state == .interrupted }) { return .failed }
        return owned.count >= ids.count ? .complete : .partial
    }

    var totalBytes: Int64 { records.values.filter { $0.state == .done }.reduce(0) { $0 + $1.written } }
    var activeCount: Int { records.values.filter { $0.state == .queued || $0.state == .downloading }.count }
    var problemCount: Int { records.values.filter { $0.state == .failed || $0.state == .interrupted }.count }

    struct AlbumGroup: Identifiable {
        let id: String
        let album: Album?
        let records: [DownloadRecord]
    }

    var groups: [AlbumGroup] {
        Dictionary(grouping: records.values, by: \.albumID).map { id, items in
            AlbumGroup(id: id, album: albums[id], records: items.sorted {
                ($0.track.disc ?? 1, $0.track.track ?? 0, $0.track.title) < ($1.track.disc ?? 1, $1.track.track ?? 0, $1.track.title)
            })
        }.sorted { ($0.album?.title ?? $0.id).localizedStandardCompare($1.album?.title ?? $1.id) == .orderedAscending }
    }

    // MARK: Work

    // Each stream address is resolved just before its transfer starts, since
    // storage redirects are short-lived signed URLs.
    private func pump() {
        while resolving < Self.parallelResolves, !waiting.isEmpty {
            let id = waiting.removeFirst()
            guard let record = records[id], record.state == .queued else { continue }
            resolving += 1
            let client = client
            let url = client.url("api", "stream", record.track.id)
            let transfer = key(record)
            Task {
                defer { resolving -= 1; pump() }
                do {
                    let request = try await DownloadEngine.resolve(url, client: client)
                    guard records[id]?.attempt == record.attempt, records[id]?.state == .queued else { return }
                    records[id]?.state = .downloading
                    engine.start(request, key: transfer)
                } catch {
                    guard records[id]?.attempt == record.attempt else { return }
                    records[id]?.state = .failed
                    let status = (error as? ServerError)?.status ?? (error as? URLError)?.code.rawValue ?? -1
                    records[id]?.status = status
                    DownloadEngine.log.error("resolve failed: \(status, privacy: .public)")
                    save()
                }
            }
        }
    }

    private func pruneAlbums() {
        let used = Set(records.values.map(\.albumID))
        for id in albums.keys where !used.contains(id) { albums.removeValue(forKey: id) }
    }

    private func saveCover(_ albumID: String) async {
        let target = MediaPaths.pinnedCover(baseURL: client.baseURL, album: albumID, root: engine.root)
        let source = client.artworkURL(albumID, size: 1200)
        let session = client.session
        await Task.detached(priority: .utility) {
            guard !FileManager.default.fileExists(atPath: target.path),
                  let result = try? await session.data(from: source),
                  (try? APIClient.validate(result.1)) != nil else { return }
            let data = result.0
            guard !data.isEmpty, data.count < 20 * 1024 * 1024 else { return }
            try? FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                     attributes: MediaPaths.protection)
            try? data.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }.value
    }

    private func save() {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await write()
        }
    }

    private func write() async {
        let manifest = DownloadManifest(records: Array(records.values), albums: albums)
        let (directory, url) = (directory, manifestURL)
        await Task.detached(priority: .utility) {
            guard let data = try? JSONEncoder().encode(manifest) else { return }
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: MediaPaths.protection)
            try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }.value
    }
}
