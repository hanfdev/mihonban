import XCTest
@testable import Mihonban

final class ContractTests: XCTestCase {
    func testMinimalAlbumAndOptionalFields() throws {
        let data = Data(#"{"id":"a","title":"Sample","artist":"Ensemble","newServerField":42}"#.utf8)
        let album = try JSONDecoder().decode(Album.self, from: data)
        XCTAssertEqual(album.id, "a")
        XCTAssertNil(album.year)
        XCTAssertTrue(album.normalizedTracks.isEmpty)
    }

    func testAlbumHydratesTrackMetadataAndRetainsOwnCredit() throws {
        let data = Data(#"{"id":"a","title":"Sample","artist":"Ensemble","tracks":[{"id":"t1","title":"One","format":"FLAC"},{"id":"t2","title":"Two","artist":"Guest"}]}"#.utf8)
        let album = try JSONDecoder().decode(Album.self, from: data)
        let tracks = album.normalizedTracks
        XCTAssertEqual(tracks[0].artist, "Ensemble")
        XCTAssertEqual(tracks[1].artist, "Guest")
        XCTAssertEqual(tracks[0].albumId, "a")
        XCTAssertEqual(tracks[0].fileExtension, "flac")
    }

    func testURLValidationAndPrefix() throws {
        for address in ["file:///tmp/secret", "javascript:alert(1)", "https://user:pass@example.com", "example.com", ""] {
            XCTAssertThrowsError(try APIClient(address: address))
        }
        let api = try APIClient(address: " https://example.com/music///?secret=ignored#section ")
        XCTAssertEqual(api.baseURL.absoluteString, "https://example.com/music")
        XCTAssertEqual(api.url("api", "album", "a b").absoluteString, "https://example.com/music/api/album/a%20b")
        XCTAssertFalse(api.artworkURL("a", size: 480).absoluteString.contains("secret"))
    }

    func testStatusMappingDoesNotExposeServerMessages() throws {
        for (status, key) in [(401, "mobile.wrongPassword"), (429, "mobile.rateLimited"), (500, "mobile.connectionFailed")] {
            let response = HTTPURLResponse(url: URL(string: "https://example.invalid")!, statusCode: status, httpVersion: nil, headerFields: nil)!
            XCTAssertThrowsError(try APIClient.validate(response, login: true)) { error in
                XCTAssertEqual((error as? ClientError)?.key, key)
            }
        }
    }

    func testDurationFormattingIsDefensive() {
        XCTAssertEqual(timestamp(.nan), "0:00")
        XCTAssertEqual(timestamp(-8), "0:00")
        XCTAssertEqual(timestamp(67), "1:07")
        XCTAssertEqual(timestamp(3723), "1:02:03")
    }

    func testLocalizedStringsArePresent() {
        XCTAssertNotEqual(L10n.text("mobile.connect"), "mobile.connect")
        XCTAssertNotEqual(L10n.text("mobile.seekFailed"), "mobile.seekFailed")
    }

    func testComputedLabelKeysResolve() {
        // Sort labels are built at runtime, so the source scan cannot see them.
        let keys = AlbumSort.allCases.map(\.label) + TrackSort.allCases.map(\.label)
            + ArtistSort.allCases.map(\.label) + FavoriteSort.allCases.map(\.label)
            + PreloadPolicy.allCases.map(\.label) + Appearance.allCases.map(\.label)
            + ["player.repeatOff", "player.repeatAll", "player.repeatOne"]
        for key in keys { XCTAssertNotEqual(L10n.text(key), key, "missing localization for \(key)") }
    }
}
