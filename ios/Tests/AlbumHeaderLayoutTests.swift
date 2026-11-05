import XCTest
@testable import Mihonban

final class AlbumHeaderLayoutTests: XCTestCase {
    func testWideHeadersBalanceArtworkAndInformationWithinThePage() {
        for width in [CGFloat(700), 744, 794, 960] {
            let layout = AlbumHeaderLayout(width: width)
            XCTAssertTrue(layout.usesColumns)
            XCTAssertLessThanOrEqual(layout.width, width)
            XCTAssertGreaterThan(layout.informationWidth, layout.coverSide)
            XCTAssertGreaterThanOrEqual(layout.coverSide, 250)
            XCTAssertGreaterThanOrEqual(layout.spacing, 50)
            let informationCenter = (width - layout.width) / 2 + layout.coverSide + layout.spacing + layout.informationWidth / 2
            XCTAssertGreaterThan(informationCenter, width * 0.65,
                                 "the title and play button must occupy the right half of the page")
            XCTAssertLessThan(informationCenter, width * 0.8)
            XCTAssertGreaterThanOrEqual(layout.informationWidth, layout.playDiameter + 2 * 44 + 2 * 36)
        }
    }

    func testSmallWindowsAndAccessibilityTextUseOneColumn() {
        for width in [CGFloat(0), 40, 280, 335, 362, 507, 699, 794, 960] {
            for accessibility in [false, true] {
                let layout = AlbumHeaderLayout(width: width, accessibility: accessibility)
                XCTAssertGreaterThanOrEqual(layout.coverSide, 0)
                XCTAssertLessThanOrEqual(layout.coverSide, width)
                XCTAssertLessThanOrEqual(layout.informationWidth, width)
                if width < 700 || accessibility {
                    XCTAssertFalse(layout.usesColumns)
                    XCTAssertLessThanOrEqual(layout.coverSide, 270)
                    XCTAssertLessThanOrEqual(layout.informationWidth, 520)
                }
            }
        }
    }
}
