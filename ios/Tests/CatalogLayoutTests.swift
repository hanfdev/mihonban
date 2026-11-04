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
        XCTAssertEqual(short, wrapped, accuracy: 0.5, "spare space below the title/artist pair keeps footers aligned")
        XCTAssertEqual(short, long, accuracy: 0.5, "titles beyond two lines are truncated, not taller")
        XCTAssertEqual(short, unrated, accuracy: 0.5, "a missing rating does not change the height")
        var undated = album("Ok", rating: nil)
        undated.year = nil
        XCTAssertEqual(short, size(AlbumCaption(album: undated), width: 170).height, accuracy: 0.5)
        for textSize in [DynamicTypeSize.large, .accessibility3] {
            let small = size(AlbumCaption(album: album("Ok", rating: 4)).environment(\.dynamicTypeSize, textSize), width: 170)
            let tall = size(AlbumCaption(album: album(String(repeating: "Long Title ", count: 10), rating: nil))
                .environment(\.dynamicTypeSize, textSize), width: 170)
            XCTAssertEqual(small.height, tall.height, accuracy: 0.5, "text=\(textSize): rating must stay on one line")
            XCTAssertLessThanOrEqual(tall.width, 170.5)
        }
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

    func testArtistRowStaysCompactWithLongAndMultipleCredits() {
        let short = PlaybackCredits(track: Track(id: "s", title: "", artists: [ArtistCredit(name: "Solo")]))
        let many = PlaybackCredits(track: Track(id: "m", title: "", artists:
            (0..<8).map { ArtistCredit(name: String(repeating: "Long artist name ", count: 8) + String($0)) }))
        let raw = PlaybackCredits(track: Track(id: "r", title: "", artist: String(repeating: "Artist, Guest & Ensemble; ", count: 30)))
        for width in [CGFloat(264), 346, 480, 700] {
            for textSize in [DynamicTypeSize.large, .accessibility3] {
                let baseline = size(PlaybackCreditsButton(credits: short) {}.environment(\.dynamicTypeSize, textSize), width: width)
                for credits in [many, raw] {
                    let measured = size(PlaybackCreditsButton(credits: credits) {}.environment(\.dynamicTypeSize, textSize), width: width)
                    XCTAssertEqual(measured.height, baseline.height, accuracy: 0.5)
                    XCTAssertGreaterThanOrEqual(measured.height, 44)
                    XCTAssertLessThanOrEqual(measured.width, width + 0.5)
                }
            }
        }
    }

    func testHeadingStopsGrowingAfterTwoTitleLines() {
        func heading(_ repetitions: Int) -> some View {
            NowPlayingHeading(track: Track(id: "title", title: String(repeating: "Long song title ", count: repetitions),
                                          artist: "Solo"), openAlbum: {}, openArtists: {})
        }
        XCTAssertEqual(size(heading(10), width: 264).height, size(heading(40), width: 264).height, accuracy: 0.5)
    }

    func testDescriptorsOnlyUseSpaceWhenExpanded() {
        let words = (1...100).map { "descriptor \($0)" }
        for width in [CGFloat(264), 346, 700] {
            for textSize in [DynamicTypeSize.large, .accessibility3] {
                let baseline = size(AlbumDescriptors(descriptors: ["calm"], isExpanded: .constant(false))
                    .environment(\.dynamicTypeSize, textSize), width: width)
                for count in [23, 100] {
                    let closed = size(AlbumDescriptors(descriptors: Array(words.prefix(count)), isExpanded: .constant(false))
                        .environment(\.dynamicTypeSize, textSize), width: width)
                    let opened = size(AlbumDescriptors(descriptors: Array(words.prefix(count)), isExpanded: .constant(true))
                        .environment(\.dynamicTypeSize, textSize), width: width)
                    XCTAssertEqual(closed.height, baseline.height, accuracy: 0.5, "count=\(count), width=\(width), text=\(textSize)")
                    XCTAssertGreaterThanOrEqual(closed.height, 44)
                    XCTAssertLessThanOrEqual(closed.width, width + 0.5)
                    XCTAssertGreaterThan(opened.height, closed.height + 20)
                    XCTAssertLessThanOrEqual(opened.width, width + 0.5)
                }
            }
        }
        let empty = size(AlbumDescriptors(descriptors: ["", " \n"], isExpanded: .constant(false)), width: 346)
        XCTAssertEqual(empty.height, 0, accuracy: 0.5)
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
