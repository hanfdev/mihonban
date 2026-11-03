import Foundation
import Observation

// Persisted local-cache preferences, shared by the settings screen and the
// player. Kept out of the player so the UI can read and change them directly.
@MainActor @Observable
final class CacheSettings {
    static let limits = [256 << 20, 512 << 20, 1 << 30, 2 << 30, 4 << 30]

    var enabled: Bool { didSet { defaults.set(enabled, forKey: key("enabled")) } }
    var limitBytes: Int { didSet { defaults.set(limitBytes, forKey: key("limit")) } }
    var preloadNext: Bool { didSet { defaults.set(preloadNext, forKey: key("preload")) } }

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let prefix: String

    init(defaults: UserDefaults = .standard, prefix: String = "cache") {
        self.defaults = defaults
        self.prefix = prefix
        // A local function keeps the stored keys reachable before every
        // property is initialized, where an instance method may not be used.
        let stored = { (name: String) -> String in "\(prefix).\(name)" }
        let limit = defaults.object(forKey: stored("limit")) as? Int ?? 0
        enabled = defaults.object(forKey: stored("enabled")) as? Bool ?? true
        limitBytes = CacheSettings.limits.contains(limit) ? limit : 1 << 30
        preloadNext = defaults.object(forKey: stored("preload")) as? Bool ?? true
    }

    private func key(_ name: String) -> String { "\(prefix).\(name)" }

    static func label(_ bytes: Int) -> String {
        guard bytes >= 1 << 20 else { return "0 MB" }
        return bytes % (1 << 30) == 0 ? "\(bytes >> 30) GB" : "\(bytes >> 20) MB"
    }

    static func size(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}