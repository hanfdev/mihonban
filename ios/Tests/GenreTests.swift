import XCTest
@testable import Mihonban

final class GenreTests: XCTestCase {
    func testCaseAndWhitespaceVariantsBecomeOneOption() {
        let options = GenreName.options(["Shibuya-kei", "Shibuya-Kei", " Shibuya-kei\n", "", " \t "])
        XCTAssertEqual(options, [GenreOption(id: "shibuya-kei", title: "Shibuya-kei")])
        XCTAssertEqual(GenreName.key("  City\t  Pop "), GenreName.key("city pop"))
    }

    func testLabelsPreserveAcronymsAndDoNotDependOnServerOrder() {
        let names = ["Shibuya-kei", "Shibuya-Kei", "IDM", "R&B", "MPB", "bossa nova", "Bossa Nova"]
        let expected = GenreName.options(names)
        XCTAssertEqual(expected, GenreName.options(names.reversed()))
        for acronym in ["IDM", "R&B", "MPB"] {
            XCTAssertTrue(expected.contains { $0.title == acronym })
        }
    }

    func testOnlyEquivalentNamesAreMerged() {
        let names = ["Pop", "Pop Rock", "Jazz", "Jazz-Funk", "Samba", "Samba Soul", "Samba-rock",
                     "Samba rock", "Café", "Cafe"]
        XCTAssertEqual(GenreName.options(names).count, names.count)
        XCTAssertEqual(GenreName.key("Caf\u{00E9}"), GenreName.key("Cafe\u{0301}"))
        XCTAssertEqual(GenreName.key("音楽"), "音楽")
    }

    func testAlbumOptionsAndMatchingShareTheSameIdentity() {
        let a = Album(id: "a", title: "A", artist: "Artist A", genres: ["Shibuya-kei"])
        let b = Album(id: "b", title: "B", artist: "Artist B", genres: [" SHIBUYA-KEI "])
        var c = Album(id: "c", title: "C", artist: "Artist C", genres: ["Pop"])
        c.secondaryGenres = ["Shibuya-Kei"]
        var hidden = Album(id: "hidden", title: "Hidden", artist: "Hidden", genres: ["Secret genre"])
        hidden.hidden = true
        let index = CatalogIndex(albums: [a, b, c, hidden], tracks: [], artists: [], includeHidden: false)
        XCTAssertEqual(index.genres.map(\.id), ["pop", "shibuya-kei"])
        XCTAssertEqual(index.artistGenres.map(\.id), ["pop", "shibuya-kei"])
        for spelling in ["Shibuya-kei", "Shibuya-Kei", " SHIBUYA-KEI ", "shibuya-kei"] {
            XCTAssertEqual(Set(index.albums(query: "", filters: AlbumFilters(genre: spelling)).map(\.id)), ["a", "b", "c"])
            XCTAssertEqual(Set(index.artists(query: "", genre: spelling).map(\.id)), ["Artist A", "Artist B"])
        }
        XCTAssertEqual(index.albums[0].genres, a.genres, "filter normalization does not rewrite album metadata")
        XCTAssertEqual(index.albums[1].genres, b.genres)
        let all = CatalogIndex(albums: [hidden], tracks: [], artists: [], includeHidden: true)
        XCTAssertEqual(all.genres.map(\.id), ["secret genre"])
    }
}
