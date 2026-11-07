import XCTest
@testable import Mihonban

final class RymYearRankTests: XCTestCase {
    func testKeepsOnlyExplicitYearRank() {
        XCTAssertEqual(RymYearRank.text("#1,584 for 1993, #10,001 overall"), "#1,584 for 1993")
        XCTAssertEqual(RymYearRank.text("#18 overall / # 2 FOR 1976"), "#2 for 1976")
        XCTAssertEqual(RymYearRank.text("#21\u{00a0}for\u{00a0}2001"), "#21 for 2001")
        XCTAssertEqual(RymYearRank.text("#1 for 2026"), "#1 for 2026")
    }

    func testDoesNotInventAYearOrShowOverall() {
        for value in [nil, "", "#13 overall", "Overall #13", "unknown", "#0 for 1993", "#12 for 19931"] {
            XCTAssertNil(RymYearRank.text(value))
        }
    }
}
