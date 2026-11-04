import XCTest
@testable import Mihonban

final class PlaybackCreditsTests: XCTestCase {
    func testEmptyCreditsDoNotCreateAnAction() {
        XCTAssertTrue(PlaybackCredits(track: nil).isEmpty)
        let track = Track(id: "empty", title: "", artist: " \n", artists: [ArtistCredit(name: " \t")])
        XCTAssertTrue(PlaybackCredits(track: track).isEmpty)
    }

    func testStructuredNamesKeepOrderAndOnlyExactNamesAreDeduplicated() {
        let track = Track(id: "many", title: "", artist: "Fallback", artists: [
            ArtistCredit(name: " 大谷和夫 "), ArtistCredit(name: "Guest Singer"), ArtistCredit(name: ""),
            ArtistCredit(name: "Guest Singer"), ArtistCredit(name: "guest singer"), ArtistCredit(name: "Earth, Wind & Fire")])
        let credits = PlaybackCredits(track: track)
        XCTAssertEqual(credits.names, ["大谷和夫", "Guest Singer", "guest singer", "Earth, Wind & Fire"])
        XCTAssertEqual(credits.additionalCount, 3)
        XCTAssertNil(credits.singleArtist)
        XCTAssertEqual(credits.firstName, "大谷和夫")
        XCTAssertEqual(track.artists?.first?.name, " 大谷和夫 ", "presentation must not rewrite source metadata")
    }

    func testSingleBandNameIsNotSplit() {
        let track = Track(id: "one", title: "", artists: [ArtistCredit(name: "Earth, Wind & Fire")])
        let credits = PlaybackCredits(track: track)
        XCTAssertEqual(credits.singleArtist, "Earth, Wind & Fire")
        XCTAssertEqual(credits.additionalCount, 0)
        XCTAssertEqual(credits.compactText, credits.firstName)
    }

    func testRawCreditIsReadableButNeverInventsArtists() {
        let text = "Earth, Wind & Fire, Guest Singer / Studio Ensemble & Final Contributor"
        let alternatives: [[ArtistCredit]?] = [nil, [], [ArtistCredit(name: " ")]]
        for names in alternatives {
            let credits = PlaybackCredits(track: Track(id: "raw", title: "", artist: text, artists: names))
            XCTAssertEqual(credits.fullText, text)
            XCTAssertEqual(credits.compactText, text)
            XCTAssertTrue(credits.names.isEmpty)
            XCTAssertNil(credits.singleArtist)
            XCTAssertEqual(credits.additionalCount, 0)
        }
    }

    func testUpToThreeArtistsShowEveryNameAndLargerGroupsShowACount() {
        for count in [1, 2, 3, 4, 8] {
            let names = (1...count).map { ArtistCredit(name: "Artist \($0)") }
            let credits = PlaybackCredits(track: Track(id: "t", title: "", artists: names))
            XCTAssertEqual(credits.additionalCount, count - 1)
            XCTAssertEqual(credits.summarizesNames, count > 3)
            let full = names.map(\.name).joined(separator: " · ")
            XCTAssertEqual(credits.displayNames, count > 3 ? "Artist 1" : full)
            XCTAssertEqual(credits.compactText, count > 3 ? "Artist 1 · " + credits.moreText : full)
            XCTAssertFalse(credits.moreText.contains("{0}"))
            XCTAssertEqual(credits.fullText, full)
        }
    }
}
