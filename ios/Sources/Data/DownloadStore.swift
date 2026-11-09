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

// Enqueue on MainActor so snapshots keep their capture order, including when
// one store detaches and another opens the same service. File work stays off it.
@MainActor
final class DownloadManifestStorage {
    static let shared = DownloadManifestStorage()
    private var pending: [URL: (id: UUID, task: Task<Void, Never>)] = [:]
    private let writeManifest: @Sendable (DownloadManifest, URL) -> Void

    init(writeManifest: @escaping @Sendable (DownloadManifest, URL) -> Void = DownloadManifestStorage.persist) {
        self.writeManifest = writeManifest
    }

    func save(_ manifest: DownloadManifest, directory: URL) -> Task<Void, Never> {
        let previous = pending[directory]?.task
        let write = writeManifest
        let id = UUID()
        let work = Task.detached(priority: .utility) {
            await previous?.value
            write(manifest, directory)
        }
        pending[directory] = (id, work)
        Task {
            await work.value
            if pending[directory]?.id == id { pending.removeValue(forKey: directory) }
        }
        return work
    }

    func load(directory: URL) async -> DownloadManifest? {
        // A replaced store's final snapshot must reach disk before reopening it.
        await pending[directory]?.task.value
        return await Task.detached(priority: .userInitiated) {
            let url = directory.appendingPathComponent("manifest.json")
            guard let data = try? Data(contentsOf: url) else { return nil as DownloadManifest? }
            return try? JSONDecoder().decode(DownloadManifest.self, from: data)
        }.value
    }

    nonisolated static func persist(_ manifest: DownloadManifest, _ directory: URL) {
        guard let data = try? JSONEncoder().encode(manifest) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: MediaPaths.protection)
        try? data.write(to: directory.appendingPathComponent("manifest.json"),
                        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
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
    @ObservationIgnored private let storage: DownloadManifestStorage
    @ObservationIgnored private var active = true
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var waiting: [String] = []
    @ObservationIgnored private var resolving = 0
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    private static let parallelResolves = 3

    init(client: APIClient, engine: DownloadEngine = .shared, storage: DownloadManifestStorage = .shared) {
        self.client = client
        self.engine = engine
        self.storage = storage
        service = MediaPaths.service(client.baseURL)
        directory = MediaPaths.downloads(root: engine.root, service: service)
    }

    // Loads the manifest and reconciles it with the transfers the system still
    // holds. A transfer that vanished was cancelled by a force quit or a
    // reboot; it is shown as interrupted, never as failed or finished.
    func load() async {
        guard active else { return }
        let token = generation
        let (engine, service) = (engine, service)
        let saved = await storage.load(directory: directory)
        guard active, token == generation else { return }
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
        guard active, token == generation else { return }
        records = Dictionary(restored.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        albums = saved?.albums ?? [:]
        loaded = true
        engine.attach(DownloadStore.forwarder(self))
        save()
    }

    func detach() {
        guard active else { return }
        active = false
        generation = UUID()
        engine.attach(nil)
        saveTask?.cancel()
        // Preserve edits still inside the debounce interval before a replacement
        // store reads this service. Detached callbacks cannot enqueue stale data.
        if loaded { _ = storage.save(snapshot, directory: directory) }
        waiting.removeAll()
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
        guard active, target.service == service, var record = records[target.track], record.attempt == target.attempt else { return }
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
        guard active else { return }
        albums[album.id] = album
        for track in album.normalizedTracks where trackID == nil || track.id == trackID { enqueue(track, album: album.id) }
        save()
        pump()
        await saveCover(album.id)
    }

    private func enqueue(_ track: Track, album: String) {
        if let existing = records[track.id], existing.state != .failed && existing.state != .interrupted { return }
        let record = DownloadRecord(track: track, albumID: album, file: MediaPaths.audioName(track),
                                    attempt: DownloadKey.newAttempt(), state: .queued, added: Date())
        records[track.id] = record
        engine.prepare(key(record))
        waiting.append(track.id)
    }

    func cancel(_ trackID: String) {
        guard active, let record = records.removeValue(forKey: trackID) else { return }
        waiting.removeAll { $0 == trackID }
        // The delegate may have committed bytes before its finished event is
        // delivered. Retire every removed attempt, including queued or failed.
        engine.cancel(key(record))
        save()
    }

    // Stops unfinished transfers of an album; finished tracks are kept.
    func cancel(album albumID: String) {
        records.values.filter { $0.albumID == albumID && $0.state != .done }.forEach { cancel($0.id) }
        pruneAlbums()
    }

    func retry(_ trackID: String) {
        guard active, var record = records[trackID], record.state == .failed || record.state == .interrupted else { return }
        // A new attempt token makes any late event from the old transfer inert.
        record.attempt = DownloadKey.newAttempt()
        record.state = .queued
        record.written = 0
        record.status = nil
        records[trackID] = record
        engine.prepare(key(record))
        waiting.append(trackID)
        save()
        pump()
    }

    func retryAll() {
        records.values.filter { $0.state == .failed || $0.state == .interrupted }.forEach { retry($0.id) }
    }

    func remove(_ trackID: String) {
        guard active, records[trackID] != nil else { return }
        cancel(trackID)
        pruneAlbums()
    }

    func remove(album albumID: String) {
        guard active else { return }
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
        guard active else { return }
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
                    guard active, records[id]?.attempt == record.attempt, records[id]?.state == .queued else { return }
                    records[id]?.state = .downloading
                    engine.start(request, key: transfer)
                } catch {
                    guard active, records[id]?.attempt == record.attempt else { return }
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
        guard active else { return }
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await write()
        }
    }

    private func write() async {
        guard active, loaded else { return }
        await storage.save(snapshot, directory: directory).value
    }

    private var snapshot: DownloadManifest { DownloadManifest(records: Array(records.values), albums: albums) }
}
