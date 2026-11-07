import XCTest
@testable import Mihonban

final class CatalogTests: XCTestCase {
    func testRecentlyAddedUsesFirstImportTimeAcrossEditsAndRefreshes() throws {
        let payload = Data("""
        [
          {"id":"old","title":"Original","artist":"Old Artist","createdAt":100,"updatedAt":100},
          {"id":"newer","title":"Newer","artist":"New Artist","createdAt":200,"updatedAt":200}
        ]
        """.utf8)
        var albums = try JSONDecoder().decode([Album].self, from: payload)
        func ordered(_ values: [Album]) -> [String] {
            CatalogIndex(albums: values, tracks: [], artists: [], includeHidden: false)
                .albums(query: "", sort: .added).map(\.id)
        }
        XCTAssertEqual(ordered(albums), ["newer", "old"])
        albums[0].updatedAt = 900
        albums[0].title = "Renamed"
        albums[0].rym = RymRating(rating: 5, votes: 1000)
        XCTAssertEqual(ordered(Array(albums.reversed())), ["newer", "old"], "Metadata edits must not look like new imports")
        albums.append(Album(id: "imported", title: "Imported", artist: "Third Artist", createdAt: 300))
        let snapshot = CatalogSnapshot(albums: albums, artists: [], favorites: .empty)
        let restored = try JSONDecoder().decode(CatalogSnapshot.self, from: JSONEncoder().encode(snapshot))
        XCTAssertEqual(ordered(restored.albums), ["imported", "newer", "old"],
                       "A restored cache must use the same first-import order as a fresh response")
        let legacy = try JSONDecoder().decode(Album.self, from:
            Data(#"{"id":"legacy","title":"Cached","artist":"Band","updatedAt":9999}"#.utf8))
        XCTAssertNil(legacy.createdAt)
        XCTAssertEqual(ordered(restored.albums + [legacy]), ["imported", "newer", "old", "legacy"])
    }

    func testBatchImportsAndUnknownDatesMatchWebOrder() {
        var first = Album(id: "a", title: "Z", artist: "Band", updatedAt: 500, createdAt: 100)
        var second = Album(id: "b", title: "A", artist: "Band", updatedAt: 200, createdAt: 100)
        let missing = Album(id: "unknown", title: "0", artist: "Band", updatedAt: 1000)
        let negative = Album(id: "invalid", title: "1", artist: "Band", updatedAt: 2000, createdAt: -1)
        func ordered(_ values: [Album]) -> [String] {
            CatalogIndex(albums: values, tracks: [], artists: [], includeHidden: false)
                .albums(query: "", sort: .added).map(\.id)
        }
        XCTAssertEqual(ordered([missing, second, negative, first]), ["a", "b", "invalid", "unknown"])
        first.title = "A renamed title"
        second.updatedAt = 3000
        XCTAssertEqual(ordered([second, first, missing, negative]), ["a", "b", "invalid", "unknown"])
    }

    func testArtistRecencyUsesNewestFirstImportAndRespectsVisibility() {
        let old = Album(id: "old", title: "Old", artist: "A", updatedAt: 900, createdAt: 100)
        let newer = Album(id: "newer", title: "Newer", artist: "B", updatedAt: 200, createdAt: 200)
        let hidden = Album(id: "hidden", title: "Hidden", artist: "A", hidden: true, createdAt: 300)
        let albums = [old, newer, hidden]
        let visible = CatalogIndex(albums: albums, tracks: [], artists: [], includeHidden: false)
        XCTAssertEqual(visible.artists(query: "", sort: .added).map(\.id), ["B", "A"])
        let all = CatalogIndex(albums: albums, tracks: [], artists: [], includeHidden: true)
        XCTAssertEqual(all.artists(query: "", sort: .added).map(\.id), ["A", "B"])
        XCTAssertEqual(visible.albums(query: "", sort: .added).prefix(12).map(\.id), ["newer", "old"],
                       "Search's recent albums must share the library ordering")
    }

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
