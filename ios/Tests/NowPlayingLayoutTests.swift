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

    func testTabletLandscapeLeavesRoomAroundAsymmetricColumns() {
        for size in [CGSize(width: 1024, height: 680), CGSize(width: 1194, height: 750),
                     CGSize(width: 1376, height: 940), CGSize(width: 1600, height: 1000)] {
            let cover = NowPlayingLayout.coverSide(in: size, controlsHeight: 360, isTablet: true)
            let controls = NowPlayingLayout.controlsWidth(in: size, coverSide: cover, isTablet: true)
            let gap = NowPlayingLayout.columnSpacing(in: size, isTablet: true)
            let margin = (size.width - cover - controls - gap) / 2
            XCTAssertEqual(controls / cover, 1.35, accuracy: 0.01)
            XCTAssertGreaterThanOrEqual(margin, size.width * 0.09)
            XCTAssertGreaterThanOrEqual(gap, 60)
            XCTAssertGreaterThanOrEqual(cover, 300)
            XCTAssertLessThanOrEqual(cover, 480)
            XCTAssertLessThanOrEqual(controls, 600)
            XCTAssertLessThanOrEqual(cover + NowPlayingLayout.topInset + NowPlayingLayout.bottomInset, size.height)
        }
    }

    func testTabletWindowsAndLargeTextRemainReachable() {
        for size in [CGSize(width: 320, height: 800), CGSize(width: 507, height: 900),
                     CGSize(width: 600, height: 500), CGSize(width: 744, height: 960),
                     CGSize(width: 834, height: 1100), CGSize(width: 800, height: 600)] {
            for height in [CGFloat(360), 750] {
                let cover = NowPlayingLayout.coverSide(in: size, controlsHeight: height, isTablet: true)
                let controls = NowPlayingLayout.controlsWidth(in: size, coverSide: cover, isTablet: true)
                XCTAssertGreaterThanOrEqual(cover, 160)
                XCTAssertLessThanOrEqual(cover, NowPlayingLayout.contentWidth(size))
                XCTAssertLessThanOrEqual(controls, NowPlayingLayout.contentWidth(size))
                // Five controls must fit even when Dynamic Type forces vertical scrolling.
                let style = NowPlayingLayout.controlStyle(in: size, isTablet: true)
                XCTAssertGreaterThanOrEqual(min(controls, style.transportWidth), style.playDiameter + 4 * 44 + 16)
                if NowPlayingLayout.usesColumns(size) {
                    XCTAssertLessThanOrEqual(cover + controls + NowPlayingLayout.columnSpacing(in: size, isTablet: true),
                                             NowPlayingLayout.contentWidth(size))
                }
            }
        }
        XCTAssertEqual(NowPlayingLayout.controlStyle(in: CGSize(width: 507, height: 900), isTablet: true), .compact)
        XCTAssertEqual(NowPlayingLayout.controlStyle(in: CGSize(width: 844, height: 390), isTablet: true), .compact)
        XCTAssertEqual(NowPlayingLayout.controlStyle(in: CGSize(width: 1024, height: 700), isTablet: false), .compact)
    }

    func testPortraitUsesTheTabletWidthInsteadOfANarrowPhoneColumn() {
        for size in [CGSize(width: 744, height: 1000), CGSize(width: 834, height: 1100), CGSize(width: 1032, height: 1300)] {
            let cover = NowPlayingLayout.coverSide(in: size, controlsHeight: 380, isTablet: true)
            let controls = NowPlayingLayout.controlsWidth(in: size, coverSide: cover, isTablet: true)
            XCTAssertGreaterThanOrEqual(cover, size.width * 0.60)
            XCTAssertGreaterThanOrEqual(controls, size.width * 0.73)
            XCTAssertGreaterThan(controls, cover + 60)
            XCTAssertLessThanOrEqual(controls, size.width * 0.84)
            XCTAssertLessThanOrEqual(cover + 380 + NowPlayingLayout.coverSpacing(in: size, isTablet: true)
                + NowPlayingLayout.topInset + NowPlayingLayout.bottomInset, size.height)
            XCTAssertEqual(NowPlayingLayout.controlStyle(in: size, isTablet: true), .tabletPortrait)
        }
    }
}
