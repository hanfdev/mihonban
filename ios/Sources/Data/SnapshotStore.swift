import Foundation

actor SnapshotStore {
    private let root: URL

    init(root: URL) { self.root = root }

    func load<Value: Decodable & Sendable>(_ key: String, as type: Value.Type = Value.self) -> Value? {
        guard let data = try? Data(contentsOf: url(key)) else { return nil }
        return try? JSONDecoder().decode(Value.self, from: data)
    }

    func save<Value: Encodable & Sendable>(_ key: String, value: Value) throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let data = try JSONEncoder().encode(value)
        try data.write(to: url(key), options: .atomic)
    }

    func remove(_ key: String) throws {
        let path = url(key)
        if FileManager.default.fileExists(atPath: path.path) { try FileManager.default.removeItem(at: path) }
    }

    private func url(_ key: String) -> URL { root.appendingPathComponent(digest(key) + ".json") }
}
