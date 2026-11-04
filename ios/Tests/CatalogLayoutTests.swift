import SwiftUI
import XCTest
@testable import Mihonban

// Measures catalog views as laid out, so alignment rules are checked without screenshots.
@MainActor
final class CatalogLayoutTests: XCTestCase {
    private func size<V: View>(_ view: V, width: CGFloat) -> CGSize {
        let host = UIHostingController(rootView: view)
        return host.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude))
    }

    private func album(_ title: String, rating: Double?) -> Album {
        var album = Album(id: "a", title: title, artist: "Fishmans", year: 1999)
        if let rating { album.rym = RymRating(rating: rating, votes: 10) }
        return album
    }

    func testTileCaptionsLineUpAcrossARow() {
        let short = size(AlbumCaption(album: album("Ok", rating: 4.4)), width: 170).height
        let wrapped = size(AlbumCaption(album: album("Songs in the Key of Life", rating: 4.32)), width: 170).height
        let long = size(AlbumCaption(album: album(String(repeating: "Long Season ", count: 12), rating: nil)), width: 170).height
        let unrated = size(AlbumCaption(album: album("Ok", rating: nil)), width: 170).height
        XCTAssertGreaterThan(short, 0)
        XCTAssertEqual(short, wrapped, accuracy: 0.5, "a one-line title reserves the second line")
        XCTAssertEqual(short, long, accuracy: 0.5, "titles beyond two lines are truncated, not taller")
        XCTAssertEqual(short, unrated, accuracy: 0.5, "a missing rating does not change the height")
    }

    func testCoverStaysSquareForWideArtwork() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let wide = UIGraphicsImageRenderer(size: CGSize(width: 400, height: 200), format: format).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 400, height: 200))
        }
        let measured = size(CoverFrame(image: wide), width: 170)
        XCTAssertEqual(measured.width, 170, accuracy: 0.5, "wide artwork must not widen the tile")
        XCTAssertEqual(measured.height, 170, accuracy: 0.5)
        let empty = size(CoverFrame(image: nil), width: 170)
        XCTAssertEqual(empty.width, measured.width, accuracy: 0.5)
        XCTAssertEqual(empty.height, measured.height, accuracy: 0.5)
    }

    func testShuffleControlHasAStableTouchTarget() {
        let off = size(IconButton(symbol: "shuffle", label: "Shuffle", selected: false) {}, width: 100)
        let on = size(IconButton(symbol: "shuffle", label: "Shuffle", selected: true) {}, width: 100)
        XCTAssertEqual(off.width, 44, accuracy: 0.5)
        XCTAssertEqual(off.height, 44, accuracy: 0.5)
        XCTAssertEqual(on.width, off.width, accuracy: 0.5)
        XCTAssertEqual(on.height, off.height, accuracy: 0.5)
    }

    func testCountsUseTheSingularForOne() {
        XCTAssertEqual(L10n.count("count.tracks", 1), L10n.text("mobile.oneTrack"))
        XCTAssertEqual(L10n.count("count.albums", 1), L10n.text("mobile.oneAlbum"))
        XCTAssertEqual(L10n.count("count.tracks", 3), L10n.text("count.tracks", "3"))
        XCTAssertFalse(L10n.count("count.tracks", 1).contains("{0}"))
        if L10n.language == "en" {
            XCTAssertEqual(L10n.count("count.tracks", 1), "1 track")
            XCTAssertEqual(L10n.count("count.tracks", 2), "2 tracks")
        }
    }
}
