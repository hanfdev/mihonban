import XCTest
import UIKit
import AVKit
@testable import Mihonban

final class MarqueeTests: XCTestCase {
    @MainActor
    func testSuspendedTitlePreparesGlyphFramesBeforeResuming() throws {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        let view = MarqueeTitleView()
        view.setSuspended(true)
        view.configure(text: String(repeating: "Prepared title ", count: 10), identity: "first",
                       font: Typography.display(27), animated: true)
        view.frame = CGRect(x: 0, y: 0, width: 250, height: 44)
        window.addSubview(view)
        view.layoutIfNeeded()
        // A track or Dynamic Type change while collapsed must be completely
        // measured and drawn before opening, even though scrolling is paused.
        view.configure(text: String(repeating: "Changed title ", count: 12), identity: "second",
                       font: Typography.display(40), animated: true)
        view.frame.size = CGSize(width: 300, height: 75)
        view.layoutIfNeeded()
        let strip = try XCTUnwrap(view.subviews.first)
        let glyphs = try XCTUnwrap(strip.subviews.first)
        XCTAssertEqual(glyphs.bounds.height, 75)
        XCTAssertGreaterThan(glyphs.bounds.width, 300)
        XCTAssertTrue(view.isScrollPaused)
        let frame = glyphs.frame
        let generation = view.animationGeneration
        view.setSuspended(false)
        view.layoutIfNeeded()
        XCTAssertEqual(glyphs.frame, frame)
        XCTAssertEqual(view.animationGeneration, generation, "resuming must not rebuild the glyph layout")
        XCTAssertTrue(view.isAnimating)
    }

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
    func testAirPlayPresentationPausesTheSameAnimationClock() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previousKeyWindow = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        let host = UIViewController()
        window.rootViewController = host
        window.makeKeyAndVisible()
        // Keep a visible render tree alive across suspension points. Core Animation
        // can discard animations on an unshown, unretained test window at commit.
        defer {
            window.isHidden = true
            window.rootViewController = nil
            previousKeyWindow?.makeKey()
        }
        let view = MarqueeTitleView()
        view.configure(text: String(repeating: "Long Title ", count: 20), identity: "a",
                       font: .systemFont(ofSize: 27), animated: true)
        view.frame = CGRect(x: 0, y: 0, width: 250, height: 44)
        host.view.addSubview(view)
        view.layoutIfNeeded()
        CATransaction.flush()
        await Task.yield()
        XCTAssertTrue(view.hasScrollAnimation, "the visible test host must retain the animation after a render commit")
        XCTAssertTrue(view.window === window)
        let generation = view.animationGeneration
        let didPause = expectation(description: "route presentation paused on the main actor")
        let didResume = expectation(description: "route dismissal resumed on the main actor")
        let coordinator = RoutePicker.Coordinator { suspended in
            XCTAssertTrue(Thread.isMainThread)
            view.setSuspended(suspended)
            if suspended { didPause.fulfill() } else { didResume.fulfill() }
        }
        let picker = AVRoutePickerView()
        let beforePause = view.scrollTime
        coordinator.routePickerViewWillBeginPresentingRoutes(picker)
        await fulfillment(of: [didPause], timeout: 5)
        XCTAssertTrue(view.isScrollPaused)
        XCTAssertFalse(view.isAnimating)
        let pausedTime = view.scrollTime
        XCTAssertGreaterThanOrEqual(pausedTime, beforePause)
        // Deliberately wait while suspended to prove the clock is frozen, not
        // merely recreated at zero when the route picker closes.
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(view.scrollTime, pausedTime, accuracy: 0.001)
        let resumedAt = CACurrentMediaTime()
        coordinator.routePickerViewDidEndPresentingRoutes(picker)
        await fulfillment(of: [didResume], timeout: 5)
        XCTAssertTrue(view.isAnimating)
        XCTAssertFalse(view.isScrollPaused)
        XCTAssertEqual(view.animationGeneration, generation)
        XCTAssertGreaterThanOrEqual(view.scrollTime, pausedTime)
        let timeAfterResume = view.scrollTime
        XCTAssertLessThanOrEqual(timeAfterResume - pausedTime, CACurrentMediaTime() - resumedAt + 0.005)
        view.removeFromSuperview()
    }

    @MainActor
    func testNativeSheetPreservesTheMarqueeAcrossPresentationAndDismissal() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previousKeyWindow = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        let host = UIViewController()
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            window.rootViewController = nil
            previousKeyWindow?.makeKey()
        }
        let control = MarqueeTitleControl(frame: CGRect(x: 28, y: 100, width: 250, height: 44))
        control.configure(text: String(repeating: "Long Title ", count: 20), identity: "sheet",
                          font: .systemFont(ofSize: 27), animated: true)
        host.view.addSubview(control)
        host.view.layoutIfNeeded()
        control.layoutIfNeeded()
        control.titleDisplay.layoutIfNeeded()
        CATransaction.flush()
        let display = control.titleDisplay
        let generation = display.animationGeneration
        let frame = control.frame
        XCTAssertTrue(display.isAnimating)

        for _ in 0..<2 {
            display.setSuspended(true)
            let pausedTime = display.scrollTime
            let sheet = UIViewController()
            sheet.view.backgroundColor = .systemBackground
            sheet.modalPresentationStyle = .pageSheet
            sheet.sheetPresentationController?.detents = [.medium()]
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                host.present(sheet, animated: true) { continuation.resume() }
            }
            XCTAssertTrue(host.presentedViewController === sheet)
            XCTAssertTrue(display.isScrollPaused)
            XCTAssertEqual(display.scrollTime, pausedTime, accuracy: 0.001)
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                host.dismiss(animated: true) { continuation.resume() }
            }
            XCTAssertNil(host.presentedViewController)
            XCTAssertEqual(display.scrollTime, pausedTime, accuracy: 0.001)
            let resumedAt = CACurrentMediaTime()
            display.setSuspended(false)
            host.view.layoutIfNeeded()
            XCTAssertTrue(display.isAnimating)
            XCTAssertEqual(display.animationGeneration, generation)
            XCTAssertEqual(control.frame, frame)
            XCTAssertEqual(display.frame, control.bounds)
            XCTAssertGreaterThanOrEqual(display.scrollTime, pausedTime)
            XCTAssertLessThanOrEqual(display.scrollTime - pausedTime, CACurrentMediaTime() - resumedAt + 0.005)
        }
    }

    @MainActor
    func testRepeatedInactivityAndTemporaryDetachmentDoNotRestart() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        let view = MarqueeTitleView()
        let title = String(repeating: "Long Title ", count: 20)
        let font = UIFont.systemFont(ofSize: 27)
        view.configure(text: title, identity: "a", font: font, animated: true)
        view.frame = CGRect(x: 0, y: 0, width: 250, height: 44)
        window.addSubview(view)
        view.layoutIfNeeded()
        let generation = view.animationGeneration
        view.setSuspended(true)
        let paused = view.scrollTime
        view.setSuspended(true)
        view.configure(text: title, identity: "a", font: font, animated: true)
        view.setNeedsLayout()
        view.layoutIfNeeded()
        XCTAssertEqual(view.scrollTime, paused, accuracy: 0.001)
        view.removeFromSuperview()
        XCTAssertTrue(view.hasScrollAnimation)
        XCTAssertTrue(view.isScrollPaused)
        window.addSubview(view)
        view.layoutIfNeeded()
        XCTAssertTrue(view.isScrollPaused, "reattaching behind AirPlay must not resume prematurely")
        view.setSuspended(false)
        view.layoutIfNeeded()
        XCTAssertEqual(view.animationGeneration, generation)
        XCTAssertTrue(view.isAnimating)
        view.removeFromSuperview()
    }

    @MainActor
    func testOnlyRealLayoutOrTrackChangesRestartTheCycle() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        let view = MarqueeTitleView()
        let title = String(repeating: "Long Title ", count: 20)
        let font = UIFont.systemFont(ofSize: 27)
        view.configure(text: title, identity: "a", font: font, animated: true)
        view.frame = CGRect(x: 0, y: 0, width: 250, height: 44)
        window.addSubview(view)
        view.layoutIfNeeded()
        let generation = view.animationGeneration
        view.setSuspended(true)
        view.frame.size = .zero
        view.layoutIfNeeded()
        view.frame.size = CGSize(width: 250, height: 44)
        view.layoutIfNeeded()
        view.setSuspended(false)
        view.layoutIfNeeded()
        XCTAssertEqual(view.animationGeneration, generation, "transient presentation geometry is not a resize")
        view.frame.size.width = 280
        view.setNeedsLayout()
        view.layoutIfNeeded()
        XCTAssertEqual(view.animationGeneration, generation + 1)
        view.setSuspended(true)
        view.configure(text: title, identity: "b", font: font, animated: true)
        XCTAssertFalse(view.hasScrollAnimation, "a new track must not inherit the previous track's phase")
        view.setSuspended(false)
        view.layoutIfNeeded()
        XCTAssertEqual(view.animationGeneration, generation + 2)
        view.removeFromSuperview()
    }

    @MainActor
    func testPresentationUpdatesNeverAddStretchAnimations() {
        let control = MarqueeTitleControl(frame: CGRect(x: 0, y: 0, width: 250, height: 44))
        control.configure(text: "A long title repeated for animation", identity: "a",
                          font: .systemFont(ofSize: 27), animated: true)
        control.layoutIfNeeded()
        control.titleDisplay.layoutIfNeeded()
        UIView.animate(withDuration: 0.4) {
            control.bounds.size.width = 280
            control.setNeedsLayout()
            control.layoutIfNeeded()
            control.titleDisplay.layoutIfNeeded()
        }
        var nodes = [control.titleDisplay as UIView]
        var index = 0
        while index < nodes.count {
            let node = nodes[index]
            XCTAssertFalse((node.layer.animationKeys() ?? []).contains { $0 != "title.scroll" },
                           "only marquee translation may animate, not glyph bounds or scale")
            nodes += node.subviews
            index += 1
        }
        XCTAssertEqual(control.titleDisplay.frame, control.bounds)
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
    func testVisualCopiesHaveNoUILabelsToDuplicateInAccessibility() {
        let control = MarqueeTitleControl(frame: CGRect(x: 0, y: 0, width: 250, height: 44))
        let title = String(repeating: "Long title ", count: 20)
        control.configure(text: title, identity: "a", font: .systemFont(ofSize: 27), animated: true)
        control.layoutIfNeeded()
        control.titleDisplay.layoutIfNeeded()
        var descendants = control.titleDisplay.subviews
        var cursor = 0
        while cursor < descendants.count {
            let child = descendants[cursor]
            XCTAssertFalse(child is UILabel, "visual copies must not create static-text accessibility nodes")
            XCTAssertFalse(child.isAccessibilityElement)
            XCTAssertTrue(child.accessibilityElementsHidden)
            descendants.append(contentsOf: child.subviews)
            cursor += 1
        }
        XCTAssertGreaterThan(descendants.count, 0)
        XCTAssertTrue(control.isAccessibilityElement)
        XCTAssertEqual(control.accessibilityLabel, title)
        XCTAssertTrue(control.accessibilityTraits.contains(.button))
    }

    @MainActor
    func testDrawingOnlyTitleActuallyRendersGlyphs() throws {
        let view = MarqueeTitleView()
        view.frame = CGRect(x: 0, y: 0, width: 250, height: 44)
        let font = UIFont.systemFont(ofSize: 27)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        func pixels(_ title: String) throws -> Data {
            view.configure(text: title, identity: "a", font: font, animated: false)
            view.layoutIfNeeded()
            let drawing = try XCTUnwrap(view.subviews.first?.subviews.first)
            drawing.layer.displayIfNeeded()
            let image = UIGraphicsImageRenderer(size: view.bounds.size, format: format).image { context in
                drawing.layer.render(in: context.cgContext)
            }
            let cg = try XCTUnwrap(image.cgImage)
            return try XCTUnwrap(cg.dataProvider?.data) as Data
        }
        let text = try pixels("Visible title")
        let blank = try pixels("")
        XCTAssertNotEqual(text, blank, "removing accessibility text copies must not erase visible glyphs")
        XCTAssertTrue(text.contains { $0 != 0 })
        XCTAssertEqual(view.lineHeight, ceil(font.lineHeight))
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
