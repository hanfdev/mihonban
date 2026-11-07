import ImageIO
import UIKit
import UniformTypeIdentifiers
import XCTest
@testable import Mihonban

@MainActor
final class CoverPreparationTests: XCTestCase {
    private func image(size: CGSize = CGSize(width: 160, height: 80), transparent: Bool = false) throws -> CGImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            guard !transparent else { return }
            UIColor.red.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIColor.blue.setFill()
            context.fill(CGRect(x: size.width / 2, y: 0, width: size.width / 2, height: size.height))
        }
        return try XCTUnwrap(image.cgImage)
    }

    private func encoded(_ image: CGImage, type: UTType = .png, properties: [CFString: Any] = [:]) throws -> Data {
        let bytes = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(bytes, type.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return bytes as Data
    }

    private func sample(_ image: CGImage) throws -> [UInt8] {
        var pixel = [UInt8](repeating: 0, count: 4)
        try pixel.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: 1, height: 1,
                bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(image, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        return pixel
    }

    func testCropGeometryClampsBothEdgesAndZoom() throws {
        let wide = CGSize(width: 1600, height: 800)
        XCTAssertEqual(CoverImagePreparation.squareCrop(in: wide), CGRect(x: 400, y: 0, width: 800, height: 800))
        XCTAssertEqual(CoverImagePreparation.squareCrop(in: wide, centre: .zero), CGRect(x: 0, y: 0, width: 800, height: 800))
        XCTAssertEqual(CoverImagePreparation.squareCrop(in: wide, centre: CGPoint(x: 2, y: 2), zoom: 2),
                       CGRect(x: 1200, y: 400, width: 400, height: 400))
        XCTAssertEqual(CoverImagePreparation.squareCrop(in: CGSize(width: 800, height: 1600)),
                       CGRect(x: 0, y: 400, width: 800, height: 800))
        XCTAssertNil(CoverImagePreparation.squareCrop(in: .zero))
        XCTAssertNil(CoverImagePreparation.squareCrop(in: wide, centre: CGPoint(x: CGFloat.nan, y: 0)))
        XCTAssertNil(CoverImagePreparation.squareCrop(in: wide, zoom: 0))
        XCTAssertNil(CoverImagePreparation.squareCrop(in: wide, zoom: 6))
        XCTAssertNil(CoverImagePreparation.squareCrop(in: wide, zoom: .infinity))
    }

    func testDecodeAppliesOrientationBeforeCropping() throws {
        let data = try encoded(image(), type: .jpeg, properties: [kCGImagePropertyOrientation: 6])
        let upright = try CoverImagePreparation.decode(data)
        XCTAssertEqual(upright.width, 80)
        XCTAssertEqual(upright.height, 160)
        let crop = try XCTUnwrap(CoverImagePreparation.squareCrop(in: CGSize(width: upright.width, height: upright.height)))
        XCTAssertEqual(crop, CGRect(x: 0, y: 40, width: 80, height: 80))
        XCTAssertThrowsError(try CoverImagePreparation.decode(Data("not an image".utf8)))
    }

    func testDecodeBoundsLargeSourceDimensions() throws {
        let source = try encoded(image(size: CGSize(width: 3000, height: 1500)))
        let decoded = try CoverImagePreparation.decode(source)
        XCTAssertEqual(decoded.width, 2400)
        XCTAssertEqual(decoded.height, 1200)
    }

    func testCroppedExportUsesRequestedRegionAndFitsUploadLimit() throws {
        let source = try image()
        let red = try CoverImagePreparation.jpeg(from: source, crop: CGRect(x: 0, y: 0, width: 80, height: 80))
        let blue = try CoverImagePreparation.jpeg(from: source, crop: CGRect(x: 80, y: 0, width: 80, height: 80))
        for data in [red, blue] {
            XCTAssertTrue(data.starts(with: [0xff, 0xd8, 0xff]))
            XCTAssertLessThanOrEqual(data.count, AlbumCoverUpload.maximumBytes)
            let decoded = try CoverImagePreparation.decode(data)
            XCTAssertEqual(decoded.width, 1200)
            XCTAssertEqual(decoded.height, 1200)
            let container = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
            let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(container, 0, nil) as? [String: Any])
            XCTAssertNil(properties[kCGImagePropertyGPSDictionary as String])
        }
        let redPixel = try sample(CoverImagePreparation.decode(red))
        let bluePixel = try sample(CoverImagePreparation.decode(blue))
        XCTAssertGreaterThan(redPixel[0], 230)
        XCTAssertLessThan(redPixel[2], 20)
        XCTAssertGreaterThan(bluePixel[2], 230)
        XCTAssertLessThan(bluePixel[0], 20)
        XCTAssertThrowsError(try CoverImagePreparation.jpeg(from: source, crop: CGRect(x: -1, y: 0, width: 80, height: 80)))
        XCTAssertThrowsError(try CoverImagePreparation.jpeg(from: source, crop: CGRect(x: 0, y: 0, width: 80, height: 40)))
    }

    func testTransparentInputExportsOnWhiteNotBlack() throws {
        let source = try image(size: CGSize(width: 80, height: 80), transparent: true)
        let data = try CoverImagePreparation.jpeg(from: source, crop: CGRect(x: 0, y: 0, width: 80, height: 80))
        let pixel = try sample(CoverImagePreparation.decode(data))
        for component in pixel.prefix(3) { XCTAssertGreaterThan(component, 245) }
    }

    func testUploadPathIsUniqueInsideOriginalAlbumFolder() throws {
        let jpeg = try CoverImagePreparation.jpeg(from: image(), crop: CGRect(x: 0, y: 0, width: 80, height: 80))
        let folder = "Music/Ensemble & Guest/Album #1"
        let first = try AlbumCoverUpload(folder: folder, jpeg: jpeg)
        let second = try AlbumCoverUpload(folder: folder, jpeg: jpeg)
        XCTAssertNotEqual(first.path, second.path)
        XCTAssertTrue(first.path.hasPrefix(folder + "/cover-"))
        XCTAssertTrue(first.path.hasSuffix(".jpg"))
        XCTAssertEqual(first.jpeg, jpeg)
        XCTAssertThrowsError(try AlbumCoverUpload(folder: nil, jpeg: jpeg))
        for bad in ["", "/", "Music/../secret", "Music/./Album", "Music/Album\n", String(repeating: "x", count: 256)] {
            XCTAssertThrowsError(try AlbumCoverUpload(folder: bad, jpeg: jpeg), bad)
        }
        XCTAssertThrowsError(try AlbumCoverUpload(folder: folder, jpeg: Data()))
        XCTAssertThrowsError(try AlbumCoverUpload(folder: folder, jpeg: Data("not jpeg".utf8)))
        var tooLarge = Data([0xff, 0xd8, 0xff])
        tooLarge.append(Data(repeating: 0, count: AlbumCoverUpload.maximumBytes))
        XCTAssertThrowsError(try AlbumCoverUpload(folder: folder, jpeg: tooLarge))
    }
}
