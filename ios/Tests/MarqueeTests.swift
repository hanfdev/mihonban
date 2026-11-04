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
    func testNativeTitleControlKeepsOneAccessibleButtonAndSeparateActions() throws {
        let control = MarqueeTitleControl(frame: CGRect(x: 0, y: 0, width: 300, height: 44))
        var opened = 0
        var read = 0
        control.openAlbum = { opened += 1 }
        control.showFullTitle = { read += 1 }
        let title = "A complete title that is much longer than the visible title region"
        control.configure(text: title, identity: "a", font: .systemFont(ofSize: 27), animated: true)
        control.layoutIfNeeded()
        XCTAssertTrue(control.isAccessibilityElement)
        XCTAssertFalse(control.accessibilityElementsHidden)
        XCTAssertTrue(control.accessibilityTraits.contains(.button))
        XCTAssertEqual(control.accessibilityIdentifier, "player.title")
        XCTAssertEqual(control.accessibilityLabel, title)
        XCTAssertTrue(control.titleDisplay.accessibilityElementsHidden)
        XCTAssertFalse(control.titleDisplay.isUserInteractionEnabled)
        XCTAssertTrue(control.hitTest(CGPoint(x: 150, y: 22), with: nil) === control)
        XCTAssertTrue(control.hitTest(CGPoint(x: 299, y: 43), with: nil) === control)
        control.sendActions(for: .touchUpInside)
        XCTAssertEqual(opened, 1)
        XCTAssertEqual(read, 0)
        XCTAssertTrue(control.accessibilityActivate())
        XCTAssertEqual(opened, 2)
        XCTAssertFalse(control.showsMenuAsPrimaryAction, "a tap navigates; only a long press opens the menu")
        let action = try XCTUnwrap(control.menu?.children.first as? UIAction)
        XCTAssertEqual(action.title, L10n.text("mobile.fullTitle"))
        XCTAssertEqual(control.accessibilityCustomActions?.count, 1)
        XCTAssertTrue(control.readFullTitle())
        XCTAssertEqual(read, 1)
        XCTAssertEqual(opened, 2, "reading the title must not navigate or start playback")
        control.isEnabled = false
        control.sendActions(for: .touchUpInside)
        XCTAssertFalse(control.accessibilityActivate())
        XCTAssertFalse(control.readFullTitle())
        XCTAssertEqual(opened, 2)
        XCTAssertEqual(read, 1)
    }

    @MainActor
    func testNativeTitleControlUpdatesWithoutLosingItsHitTarget() {
        let control = MarqueeTitleControl(frame: CGRect(x: 0, y: 0, width: 250, height: 44))
        control.configure(text: String(repeating: "Long title ", count: 20), identity: "a",
                          font: .systemFont(ofSize: 27), animated: true)
        control.layoutIfNeeded()
        let height = control.titleHeight
        control.configure(text: "Short", identity: "b", font: .systemFont(ofSize: 27), animated: false)
        control.layoutIfNeeded()
        XCTAssertEqual(control.titleHeight, height)
        XCTAssertEqual(control.accessibilityLabel, "Short")
        XCTAssertTrue(control.hitTest(CGPoint(x: 125, y: 22), with: nil) === control)
        XCTAssertFalse(control.titleDisplay.isAnimating)
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
