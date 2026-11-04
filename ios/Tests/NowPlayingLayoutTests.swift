import XCTest
@testable import Mihonban

final class NowPlayingLayoutTests: XCTestCase {
    func testShortTitleUsesAvailablePhoneWidth() {
        let available = CGSize(width: 402, height: 700)
        let side = NowPlayingLayout.coverSide(in: available, controlsHeight: 285)
        XCTAssertEqual(side, 346, accuracy: 0.5)
        XCTAssertGreaterThanOrEqual(side / available.width, 0.8)
        XCTAssertEqual(NowPlayingLayout.controlsWidth(in: available, coverSide: side), side)
        XCTAssertLessThanOrEqual(side + 285 + NowPlayingLayout.coverSpacing
            + NowPlayingLayout.topInset + NowPlayingLayout.bottomInset, available.height)
    }

    func testLongerControlsBorrowSpaceFromTheCover() {
        let available = CGSize(width: 402, height: 700)
        let short = NowPlayingLayout.coverSide(in: available, controlsHeight: 285)
        let long = NowPlayingLayout.coverSide(in: available, controlsHeight: 350)
        XCTAssertLessThan(long, short)
        XCTAssertEqual(long + 350 + NowPlayingLayout.coverSpacing
            + NowPlayingLayout.topInset + NowPlayingLayout.bottomInset, available.height, accuracy: 0.5)
        XCTAssertGreaterThanOrEqual(NowPlayingLayout.coverSide(in: CGSize(width: 402, height: 800), controlsHeight: 350), long)
    }

    func testNarrowAndAccessibilityLayoutsStayWithinContentWidth() {
        for width in [CGFloat(0), 40, 264, 320, 375, 402] {
            let available = CGSize(width: width, height: 500)
            let side = NowPlayingLayout.coverSide(in: available, controlsHeight: 750)
            XCTAssertGreaterThanOrEqual(side, 0)
            XCTAssertLessThanOrEqual(side, NowPlayingLayout.contentWidth(available))
            XCTAssertLessThanOrEqual(side, 160, "very tall controls use the scroll fallback")
        }
        XCTAssertEqual(NowPlayingLayout.coverSide(in: .zero, controlsHeight: 0), 0)
    }

    func testTabletAndLandscapeRespectBothAxes() {
        let portrait = CGSize(width: 900, height: 1200)
        XCTAssertEqual(NowPlayingLayout.coverSide(in: portrait, controlsHeight: 300), 500)
        for available in [CGSize(width: 874, height: 300), CGSize(width: 1024, height: 700), CGSize(width: 1400, height: 900)] {
            XCTAssertTrue(NowPlayingLayout.usesColumns(available))
            let side = NowPlayingLayout.coverSide(in: available, controlsHeight: 600)
            let controls = NowPlayingLayout.controlsWidth(in: available, coverSide: side)
            XCTAssertLessThanOrEqual(side, 440)
            XCTAssertLessThanOrEqual(side + NowPlayingLayout.topInset + NowPlayingLayout.bottomInset, available.height)
            XCTAssertLessThanOrEqual(side + NowPlayingLayout.columnSpacing + controls, NowPlayingLayout.contentWidth(available))
            XCTAssertLessThanOrEqual(controls, 480)
        }
    }
}
