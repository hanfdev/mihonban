import XCTest
import UIKit
@testable import Mihonban

final class MarqueeTests: XCTestCase {
    func testShortTitlesNeverAnimate() {
        XCTAssertNil(MarqueeMotion(textWidth: 100, viewport: 200))
        XCTAssertNil(MarqueeMotion(textWidth: 200, viewport: 200))
        XCTAssertNil(MarqueeMotion(textWidth: 400, viewport: 0))
        XCTAssertNil(MarqueeMotion(textWidth: .nan, viewport: 200))
    }

    func testLongTitlePausesAndWrapsWithoutMovingItsLayout() throws {
        let motion = try XCTUnwrap(MarqueeMotion(textWidth: 600, viewport: 300))
        XCTAssertEqual(motion.startPause, 2)
        XCTAssertEqual(motion.overflow, 300)
        XCTAssertEqual(motion.distance, 640)
        XCTAssertEqual(motion.endPause, 1.5)
        XCTAssertEqual(motion.travel, 300.0 / 28, accuracy: 0.0001)
        XCTAssertEqual(motion.keyTimes.first?.doubleValue, 0)
        XCTAssertEqual(motion.keyTimes.last?.doubleValue, 1)
        XCTAssertEqual(motion.keyTimes.map(\.doubleValue), motion.keyTimes.map(\.doubleValue).sorted())
    }

    @MainActor
    func testAnimationStopsForMotionPreferencesAndLeavingTheWindow() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        let view = MarqueeTitleView()
        let text = String(repeating: "Long Title ", count: 10)
        view.configure(text: text, identity: "a", font: .systemFont(ofSize: 27), animated: true)
        view.frame = CGRect(x: 0, y: 0, width: 250, height: view.lineHeight)
        window.addSubview(view)
        view.layoutIfNeeded()
        XCTAssertTrue(view.isAnimating)
        view.configure(text: text, identity: "a", font: .systemFont(ofSize: 27), animated: false)
        view.layoutIfNeeded()
        XCTAssertFalse(view.isAnimating, "Reduce Motion, VoiceOver and an inactive scene stop automatic scrolling")
        view.configure(text: text, identity: "b", font: .systemFont(ofSize: 27), animated: true)
        view.layoutIfNeeded()
        XCTAssertTrue(view.isAnimating)
        view.removeFromSuperview()
        XCTAssertFalse(view.isAnimating)
    }

    @MainActor
    func testTitleKeepsOneLineAndStopsOffscreen() {
        let view = MarqueeTitleView()
        view.configure(text: String(repeating: "Long Title ", count: 20), identity: "a", font: .systemFont(ofSize: 27), animated: true)
        view.frame = CGRect(x: 0, y: 0, width: 300, height: view.lineHeight)
        view.layoutIfNeeded()
        let height = view.lineHeight
        XCTAssertGreaterThan(view.naturalWidth, 300)
        XCTAssertTrue(view.accessibilityElementsHidden, "only the containing button reads the full title once")
        view.configure(text: "Short", identity: "b", font: .systemFont(ofSize: 27), animated: false)
        view.layoutIfNeeded()
        XCTAssertEqual(view.lineHeight, height)
        XCTAssertLessThan(view.naturalWidth, 300)
        view.stop()
        XCTAssertTrue(view.subviews.allSatisfy { ($0.layer.animationKeys() ?? []).isEmpty })
    }
}
