import Foundation
import Observation

// File locations shared by the cache, the download engine and the player.
// Everything is scoped by a digest of the service address, so two services
// never share audio, covers or download manifests.
nonisolated enum MediaPaths {
    static let supportRoot = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Mihonban", isDirectory: true)

    static func service(_ baseURL: URL) -> String { digest(baseURL.absoluteString) }

    static func downloads(root: URL = supportRoot, service: String) -> URL {
        root.appendingPathComponent(service, isDirectory: true).appendingPathComponent("downloads", isDirectory: true)
    }

    static func audioName(_ track: Track) -> String { digest(track.id) + "." + track.fileExtension }

    static func pinnedCover(baseURL: URL, album: String, root: URL = supportRoot) -> URL {
        downloads(root: root, service: service(baseURL)).appendingPathComponent("covers", isDirectory: true)
            .appendingPathComponent(digest(album) + ".img")
    }

    static var protection: [FileAttributeKey: Any] { [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication] }
}

struct CacheUsage: Equatable, Sendable {
    var audio = 0
    var artwork = 0
    var buffering = 0
    var cached: Int { audio + artwork }
}

// Blocking file work. Called only from detached tasks, never on the main actor.
nonisolated enum CacheFiles {
    // A partial file this old cannot belong to a live transfer (the resource timeout is 30 minutes).
    static let stalePart: TimeInterval = 45 * 60

    static func usage(_ generation: URL) -> CacheUsage {
        var usage = CacheUsage()
        for (folder, isArtwork) in [("audio", false), ("artwork", true)] {
            for (file, bytes, _) in entries(generation.appendingPathComponent(folder, isDirectory: true)) {
                if file.pathExtension == "part" { usage.buffering += bytes }
                else if isArtwork { usage.artwork += bytes }
                else { usage.audio += bytes }
            }
        }
        return usage
    }

    // Drops other generations and stale partial files, then removes the least
    // recently used complete files until the limit holds. Protected names are
    // the tracks playing or predecoded right now.
    static func prune(root: URL, generation: String, limit: Int, enabled: Bool, protected: Set<String>) -> Bool {
        let manager = FileManager.default
        var ok = true
        for other in (try? manager.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])) ?? []
        where (try? other.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true && other.lastPathComponent != generation {
            if (try? manager.removeItem(at: other)) == nil { ok = false }
        }
        let current = root.appendingPathComponent(generation, isDirectory: true)
        var complete: [(URL, Int, Date)] = []
        for folder in ["audio", "artwork"] {
            for entry in entries(current.appendingPathComponent(folder, isDirectory: true)) {
                if entry.0.pathExtension == "part" {
                    if Date().timeIntervalSince(entry.2) > stalePart { try? manager.removeItem(at: entry.0) }
                } else { complete.append(entry) }
            }
        }
        var size = complete.reduce(0) { $0 + $1.1 }
        let ceiling = enabled ? max(0, limit) : 0
        for (file, bytes, _) in complete.sorted(by: { $0.2 < $1.2 }) {
            if size <= ceiling { break }
            if protected.contains(file.lastPathComponent) { continue }
            if (try? manager.removeItem(at: file)) != nil { size -= bytes } else { ok = false }
        }
        return ok
    }

    static func entries(_ directory: URL) -> [(URL, Int, Date)] {
        let keys: [URLResourceKey] = [.fileSizeKey, .totalFileAllocatedSizeKey, .contentModificationDateKey]
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys) else { return [] }
        return files.map { file in
            let values = try? file.resourceValues(forKeys: Set(keys))
            // Partial files are sparse, so their allocated size is the honest figure.
            let bytes = file.pathExtension == "part" ? values?.totalFileAllocatedSize : values?.fileSize
            return (file, bytes ?? 0, values?.contentModificationDate ?? .distantPast)
        }
    }

    static func touch(_ file: URL) {
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path)
    }

    static func size(_ directory: URL) -> Int {
        guard let walker = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
        var total = 0
        for case let file as URL in walker { total += (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0 }
        return total
    }
}

// Streaming cache for one service. Clearing switches to a new generation
// directory, so a transfer started before the clear can never write its file
// back into the cleared cache: its rename targets a directory that is gone.
@MainActor @Observable
final class MediaCache {
    private(set) var usage = CacheUsage()

    @ObservationIgnored let root: URL
    @ObservationIgnored private(set) var generation: String
    @ObservationIgnored private let settings: CacheSettings
    @ObservationIgnored private var pruning = false
    @ObservationIgnored private var pruneAgain = false
    @ObservationIgnored private var lastProtected: Set<String> = []

    init(root: URL, settings: CacheSettings) {
        self.root = root
        self.settings = settings
        let marker = root.appendingPathComponent("generation")
        if let saved = try? String(contentsOf: marker, encoding: .utf8),
           saved.range(of: "^g[0-9a-f]{8}$", options: .regularExpression) != nil {
            generation = saved
        } else {
            generation = MediaCache.newGeneration()
            MediaCache.write(generation, to: root)
        }
    }

    var audioDirectory: URL { root.appendingPathComponent(generation, isDirectory: true).appendingPathComponent("audio", isDirectory: true) }
    var artworkDirectory: URL { root.appendingPathComponent(generation, isDirectory: true).appendingPathComponent("artwork", isDirectory: true) }

    func touch(_ file: URL) {
        Task.detached(priority: .utility) { CacheFiles.touch(file) }
    }

    // Coalesces requests: at most one scan runs, and a request made meanwhile
    // runs once more afterwards with the latest protected set.
    func prune(protecting protected: Set<String> = []) {
        lastProtected = protected
        guard !pruning else { pruneAgain = true; return }
        pruning = true
        let (root, generation) = (root, generation)
        let (limit, enabled) = (settings.limitBytes, settings.enabled)
        Task {
            let usage = await Task.detached(priority: .utility) { () -> CacheUsage in
                _ = CacheFiles.prune(root: root, generation: generation, limit: limit, enabled: enabled, protected: protected)
                return CacheFiles.usage(root.appendingPathComponent(generation, isDirectory: true))
            }.value
            if generation == self.generation { self.usage = usage }
            pruning = false
            if pruneAgain { pruneAgain = false; prune(protecting: lastProtected) }
        }
    }

    func refreshUsage() async {
        let current = root.appendingPathComponent(generation, isDirectory: true)
        let generation = generation
        let usage = await Task.detached(priority: .userInitiated) { CacheFiles.usage(current) }.value
        if generation == self.generation { self.usage = usage }
    }

    // Returns false when some files could not be removed; the usage shown
    // afterwards is measured again rather than assumed to be zero.
    func clear() async -> Bool {
        generation = MediaCache.newGeneration()
        let (root, generation) = (root, generation)
        let ok = await Task.detached(priority: .userInitiated) { () -> Bool in
            MediaCache.write(generation, to: root)
            return CacheFiles.prune(root: root, generation: generation, limit: 0, enabled: false, protected: [])
        }.value
        await refreshUsage()
        return ok
    }

    private static func newGeneration() -> String {
        "g" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(8).lowercased()
    }

    nonisolated private static func write(_ generation: String, to root: URL) {
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: MediaPaths.protection)
        try? Data(generation.utf8).write(to: root.appendingPathComponent("generation"), options: .atomic)
    }
}
