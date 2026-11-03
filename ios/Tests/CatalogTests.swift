import XCTest
@testable import Mihonban

final class CatalogTests: XCTestCase {
    func testWeightedRatingsMatchWebPrior() {
        XCTAssertEqual(RymRating(rating: 4, votes: 50).weighted, 3.65, accuracy: 0.0001)
        XCTAssertEqual(RymRating(rating: 3, votes: 1).weighted, 3)
        XCTAssertEqual(RymRating(rating: 5, votes: 0).weighted, 3.3)
        XCTAssertEqual(RymRating(rating: 8, votes: 100).weighted, -.infinity)
    }

    func testRatingOrderingPrefersConsensusToOneVote() {
        var consensus = Album(id: "a", title: "A", artist: "Ensemble")
        consensus.rym = RymRating(rating: 4, votes: 500)
        var single = Album(id: "b", title: "B", artist: "Ensemble")
        single.rym = RymRating(rating: 5, votes: 1)
        let index = CatalogIndex(albums: [single, consensus], tracks: [], artists: [], includeHidden: false)
        XCTAssertEqual(index.albums(query: "", sort: .rating).map(\.id), ["a", "b"])
        XCTAssertEqual(index.albums(query: "", sort: .ratingRaw).map(\.id), ["b", "a"])
    }

    func testHiddenCatalogCannotLeakIntoSearchOrArtists() {
        var hidden = Album(id: "secret", title: "Hidden", artist: "Private Artist")
        hidden.hidden = true
        let visible = Album(id: "public", title: "Public", artist: "Public Artist")
        let index = CatalogIndex(albums: [hidden, visible], tracks: [], artists: [], includeHidden: false)
        XCTAssertEqual(index.albums(query: "").map(\.id), ["public"])
        XCTAssertTrue(index.artists(query: "Private").isEmpty)
        XCTAssertEqual(index.artists.count, 1)
    }

    func testMultipleCreditsAreNotSplitOnAmpersands() {
        var album = Album(id: "a", title: "Album", artist: "Earth, Wind & Fire & Guest")
        album.artists = [ArtistCredit(name: "Earth, Wind & Fire"), ArtistCredit(name: "Guest")]
        let index = CatalogIndex(albums: [album], tracks: [], artists: [], includeHidden: false)
        XCTAssertEqual(Set(index.artists.map(\.id)), Set(["Earth, Wind & Fire", "Guest"]))
    }

    func testArtistWithOnlyFeaturedTracksIsVisible() {
        let artist = Artist(name: "Guest", visibleFeaturedTrackCount: 2)
        let index = CatalogIndex(albums: [], tracks: [], artists: [artist], includeHidden: false)
        XCTAssertEqual(index.artists.first?.featuredCount, 2)
        XCTAssertEqual(index.artists.first?.albumCount, 0)
    }

    func testFiltersAndDiscTrackOrdering() {
        let album = Album(id: "a", title: "A", artist: "Ensemble", year: 1984, genres: ["City Pop"])
        XCTAssertTrue(AlbumFilters(genre: "city pop", decade: 1980).matches(album))
        XCTAssertFalse(AlbumFilters(decade: 1990).matches(album))
        let tracks = [Track(id: "2", title: "Z", disc: 2, track: 1, albumTitle: "Album"),
                      Track(id: "1", title: "A", disc: 1, track: 9, albumTitle: "Album")]
        let index = CatalogIndex(albums: [], tracks: tracks, artists: [], includeHidden: false)
        XCTAssertEqual(index.tracks(query: "", sort: .album).map(\.id), ["1", "2"])
    }

    func testSearchAliasesHanAndKana() {
        let album = Album(id: "a", title: "夜の余白", artist: "中森明菜")
        let index = CatalogIndex(albums: [album], tracks: [], artists: [], includeHidden: false)
        XCTAssertEqual(index.albums(query: "akina nakamori").count, 1)
        XCTAssertEqual(SearchNormalizer.text("音乐"), SearchNormalizer.text("音樂"))
        XCTAssertEqual(SearchNormalizer.text("カタカナ"), SearchNormalizer.text("かたかな"))
        XCTAssertEqual(SearchNormalizer.text("ＭＵＳＩＣ"), "music")
    }
}
