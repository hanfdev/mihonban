import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Pure image preparation for the native cover editor. Decode at bounded size
// with EXIF orientation applied, then export only pixels (no source metadata).
enum CoverImagePreparation {
    static let decodedPixelLimit = 2400
    static let outputPixels = 1200

    static func decode(_ data: Data) throws -> CGImage {
        guard !data.isEmpty, data.count <= 32 * 1024 * 1024,
              let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: decodedPixelLimit,
                kCGImageSourceShouldCacheImmediately: true
              ] as CFDictionary) else { throw ClientError(key: "crop.loadFail") }
        return image
    }

    // The crop centre is normalized against the upright image, not the screen.
    static func squareCrop(in size: CGSize, centre: CGPoint = CGPoint(x: 0.5, y: 0.5), zoom: CGFloat = 1) -> CGRect? {
        guard size.width.isFinite, size.height.isFinite, size.width >= 1, size.height >= 1,
              centre.x.isFinite, centre.y.isFinite, zoom.isFinite, zoom >= 1, zoom <= 5 else { return nil }
        let side = max(1, floor(min(size.width, size.height) / zoom))
        let x = floor(min(max(0, centre.x * size.width - side / 2), size.width - side))
        let y = floor(min(max(0, centre.y * size.height - side / 2), size.height - side))
        return CGRect(x: x, y: y, width: side, height: side)
    }

    static func jpeg(from image: CGImage, crop: CGRect) throws -> Data {
        let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
        guard !crop.isNull, !crop.isInfinite, crop.width >= 1, crop.width == crop.height,
              crop == crop.integral, bounds.contains(crop),
              let cropped = image.cropping(to: crop),
              let context = CGContext(data: nil, width: outputPixels, height: outputPixels,
                bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw ClientError(key: "crop.loadFail")
        }
        let output = CGRect(x: 0, y: 0, width: outputPixels, height: outputPixels)
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(output)
        context.interpolationQuality = .high
        context.draw(cropped, in: output)
        guard let rendered = context.makeImage() else { throw ClientError(key: "crop.loadFail") }
        let bytes = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(bytes, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw ClientError(key: "crop.loadFail")
        }
        CGImageDestinationAddImage(destination, rendered, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(destination), bytes.length <= AlbumCoverUpload.maximumBytes else {
            throw ClientError(key: "importPage.coverInvalid")
        }
        return bytes as Data
    }
}
