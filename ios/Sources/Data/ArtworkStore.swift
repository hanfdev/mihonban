import Foundation
import ImageIO
import UIKit

actor ArtworkStore {
    static let shared = ArtworkStore()
    private let images = NSCache<NSString, UIImage>()
    private var pending: [String: Task<UIImage?, Never>] = [:]
    private var missing: [String: Date] = [:]

    init() { images.totalCostLimit = 24 * 1024 * 1024; images.countLimit = 120 }

    func image(url: URL, session: URLSession, pixels: Int) async -> UIImage? {
        let key = url.absoluteString + ":\(pixels)"
        if let image = images.object(forKey: key as NSString) { return image }
        if let date = missing[key], Date().timeIntervalSince(date) < 30 { return nil }
        if let task = pending[key] { return await task.value }
        let task = Task<UIImage?, Never> {
            do {
                let (data, response) = try await session.data(from: url)
                try APIClient.validate(response)
                guard data.count < 20 * 1024 * 1024, response.mimeType != "image/svg+xml",
                      let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: pixels,
                        kCGImageSourceShouldCacheImmediately: true
                      ] as CFDictionary) else { return nil }
                return UIImage(cgImage: cg)
            } catch { return nil }
        }
        pending[key] = task
        let image = await task.value
        pending.removeValue(forKey: key)
        if let image {
            let bytes = (image.cgImage?.bytesPerRow ?? 0) * (image.cgImage?.height ?? 0)
            images.setObject(image, forKey: key as NSString, cost: bytes)
        } else { missing[key] = Date() }
        return image
    }
}
