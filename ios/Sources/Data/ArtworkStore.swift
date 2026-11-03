import Foundation
import ImageIO
import UIKit

// Covers are looked up in memory, then in a downloaded album's pinned cover,
// then in the disk cache, and only then fetched. Disk writes never create the
// cache directory, so a request started before "Clear cache" cannot recreate
// the cleared generation.
actor ArtworkStore {
    static let shared = ArtworkStore()
    private let images = NSCache<NSString, UIImage>()
    private var pending: [String: Task<UIImage?, Never>] = [:]
    private var missing: [String: Date] = [:]
    private var disk: URL?

    init() { images.totalCostLimit = 24 * 1024 * 1024; images.countLimit = 120 }

    func configure(disk: URL?) {
        self.disk = disk
        images.removeAllObjects()
        missing.removeAll()
    }

    func image(url: URL, session: URLSession, pixels: Int, pinned: URL? = nil) async -> UIImage? {
        let key = url.absoluteString + ":\(pixels)"
        if let image = images.object(forKey: key as NSString) { return image }
        if let pinned, let data = try? Data(contentsOf: pinned), let image = Self.decode(data, pixels: pixels) {
            store(image, key: key)
            return image
        }
        let file = disk?.appendingPathComponent(digest(url.absoluteString) + ".img")
        if let file, let data = try? Data(contentsOf: file), let image = Self.decode(data, pixels: pixels) {
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path)
            store(image, key: key)
            return image
        }
        if let date = missing[key], Date().timeIntervalSince(date) < 30 { return nil }
        if let task = pending[key] { return await task.value }
        let task = Task<UIImage?, Never> {
            do {
                let (data, response) = try await session.data(from: url)
                try APIClient.validate(response)
                guard data.count < 20 * 1024 * 1024, response.mimeType != "image/svg+xml",
                      let image = Self.decode(data, pixels: pixels) else { return nil }
                if let file { try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
                return image
            } catch { return nil }
        }
        pending[key] = task
        let image = await task.value
        pending.removeValue(forKey: key)
        if let image { store(image, key: key) } else { missing[key] = Date() }
        return image
    }

    private func store(_ image: UIImage, key: String) {
        let bytes = (image.cgImage?.bytesPerRow ?? 0) * (image.cgImage?.height ?? 0)
        images.setObject(image, forKey: key as NSString, cost: bytes)
    }

    private static func decode(_ data: Data, pixels: Int) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: pixels,
                kCGImageSourceShouldCacheImmediately: true
              ] as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }
}
