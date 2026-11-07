import XCTest
import SwiftUI
@testable import Mihonban

@MainActor
final class PlayerTransitionTests: XCTestCase {
    func testSmallPullMovesTheWholeCanvasWithoutAddingSafeAreaInsets() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        let model = AppModel()
        model.demo = true
        let audio = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "tone", withExtension: "flac"))
        model.player.connect(try APIClient(address: "https://example.invalid"), demoURL: audio)
        model.player.play([Track(id: "small-pull", title: "Small pull geometry", duration: 8)])
        model.player.pause()
        model.player.setForeground(false)
        let frames = PlayerFrameProbe()
        let content = PlayerPresentation(model: model) { Color(red: 1, green: 0, blue: 1) }
            .environment(\.playerFrameProbe, frames)
        let host = UIHostingController(rootView: content.environment(\.scenePhase, .active))
        // Exercise asymmetric horizontal insets even on the portrait test host.
        // Native UI tests separately rotate the actual phone both ways.
        host.additionalSafeAreaInsets = UIEdgeInsets(top: 17, left: 47, bottom: 9, right: 19)
        host.overrideUserInterfaceStyle = .dark
        host.view.backgroundColor = .magenta
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer {
            model.player.stop()
            window.isHidden = true
            window.rootViewController = nil
            previous?.makeKey()
        }
        try await Task.sleep(for: .milliseconds(400))
        model.player.isExpanded = true
        try await Task.sleep(for: .milliseconds(700))
        let before = try XCTUnwrap(frames.globalCover.last)
        let collapse = try XCTUnwrap(frames.collapse)
        let settled = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        for x in [CGFloat(2), window.bounds.width - 3] {
            assertBackground(settled, at: CGPoint(x: x, y: window.bounds.height * 0.4))
        }
        for pull: CGFloat in [0, 1, 4, 12, 24] {
            collapse.changed(pull)
            try await Task.sleep(for: .milliseconds(60))
            let after = try XCTUnwrap(frames.globalCover.last)
            XCTAssertEqual(after.minY - before.minY, pull, accuracy: 1,
                "A tiny pull must never acquire an extra system top inset")
            XCTAssertEqual(after.minX, before.minX, accuracy: 1)
            XCTAssertEqual(after.size.width, before.size.width, accuracy: 1)
            XCTAssertEqual(after.size.height, before.size.height, accuracy: 1)
        }
        let held = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: held)
        attachment.name = "70-player-small-pull"
        attachment.lifetime = .keepAlways
        add(attachment)
        collapse.ended(24, 24, 0)
        try await Task.sleep(for: .milliseconds(500))
        XCTAssertEqual(try XCTUnwrap(frames.globalCover.last).minY, before.minY, accuracy: 1)
        collapse.changed(12)
        host.rootView = content.environment(\.scenePhase, .inactive)
        try await Task.sleep(for: .milliseconds(100))
        collapse.ended(200, 240, 600)
        host.rootView = content.environment(\.scenePhase, .active)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertTrue(model.player.isExpanded, "A cancelled touch from before locking cannot dismiss the resumed player")
        XCTAssertEqual(try XCTUnwrap(frames.globalCover.last).minY, before.minY, accuracy: 1)
        collapse.changed(4)
        try await Task.sleep(for: .milliseconds(60))
        XCTAssertEqual(try XCTUnwrap(frames.globalCover.last).minY - before.minY, 4, accuracy: 1,
            "Foregrounding must restore interactive movement")
        // A disappearing surface must not strand the library or revive itself
        // through a delayed cancellation callback from its removed gesture.
        model.player.stop()
        collapse.ended(0, 0, 0)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertFalse(model.player.isExpanded)
    }

    func testGesturePickupStartsAtZeroAndThenTracksOneToOne() {
        for first: CGFloat in [12, 20, 40] {
            var pickup = PlayerDragPickup()
            XCTAssertEqual(pickup.distance(first), 0)
            XCTAssertEqual(pickup.distance(first + 1), 1)
            XCTAssertEqual(pickup.distance(first + 5), 5)
            XCTAssertEqual(pickup.distance(first - 3), 0)
            XCTAssertEqual(pickup.adjusted(first + 120), 120)
            pickup.reset()
            XCTAssertEqual(pickup.distance(18), 0)
        }
    }

    private func assertBackground(_ image: UIImage, at point: CGPoint,
                                  file: StaticString = #filePath, line: UInt = #line) {
        guard let source = image.cgImage,
              let patch = source.cropping(to: CGRect(x: point.x * image.scale, y: point.y * image.scale,
                                                    width: 2 * image.scale, height: 2 * image.scale)) else {
            XCTFail("Missing rendered surface", file: file, line: line)
            return
        }
        var pixel = [UInt8](repeating: 0, count: 4)
        pixel.withUnsafeMutableBytes { bytes in
            let context = CGContext(data: bytes.baseAddress, width: 1, height: 1, bitsPerComponent: 8,
                bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            context?.draw(patch, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        }
        XCTAssertLessThan(pixel[0], 25, "The clipped player must cover the contrasting library at both edges", file: file, line: line)
        XCTAssertLessThan(pixel[2], 25, file: file, line: line)
        XCTAssertEqual(pixel[3], 255, file: file, line: line)
    }

    func testTapAndSwipeKeepArtworkAndHeadingFixedThroughSettlement() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        let model = AppModel()
        model.demo = true
        let audio = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "tone", withExtension: "flac"))
        model.player.connect(try APIClient(address: "https://example.invalid"), demoURL: audio)
        model.player.play([Track(id: "settlement", title: String(repeating: "A long title ", count: 8), duration: 8)])
        model.player.pause()
        model.player.setForeground(false)
        let frames = PlayerFrameProbe()
        let gesture = GestureDriver()
        let content = PlayerPresentation(model: model) { GestureLibrary(driver: gesture) }
            .environment(\.playerFrameProbe, frames)
        let host = UIHostingController(rootView: content)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer {
            model.player.stop()
            window.isHidden = true
            window.rootViewController = nil
            previous?.makeKey()
        }
        try await Task.sleep(for: .milliseconds(700))
        let cover = try XCTUnwrap(frames.cover.last)
        let heading = try XCTUnwrap(frames.heading.last)
        XCTAssertGreaterThan(cover.width, 100)
        XCTAssertGreaterThanOrEqual(heading.height, 44)
        if window.bounds.width < 600 && window.bounds.height > 800 {
            XCTAssertGreaterThanOrEqual(cover.width, window.bounds.width * 0.8,
                "The safe viewport must not deduct system insets a second time")
        }
        frames.cover = [cover]
        frames.heading = [heading]
        // Tap uses the same model state as the mini-player button. Sampling
        // continues past animation completion and the marquee's resume.
        model.player.isExpanded = true
        try await Task.sleep(for: .milliseconds(900))
        model.player.isExpanded = false
        try await Task.sleep(for: .milliseconds(900))
        let actions = try XCTUnwrap(gesture.expand)
        for distance in stride(from: CGFloat(20), through: 220, by: 20) {
            actions.changed(distance)
            try await Task.sleep(for: .milliseconds(16))
        }
        let previewDistance = window.bounds.height * 0.88
        actions.changed(previewDistance)
        try await Task.sleep(for: .milliseconds(50))
        let preview = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: preview)
        attachment.name = "64-player-rounded-pull"
        attachment.lifetime = .keepAlways
        add(attachment)
        actions.ended(previewDistance, previewDistance + 60, 600)
        try await Task.sleep(for: .milliseconds(900))
        XCTAssertTrue(model.player.isExpanded)
        for (name, values, expected) in [("cover", frames.cover, cover), ("heading", frames.heading, heading)] {
            let drift = values.map { frame in
                max(abs(frame.minX - expected.minX), abs(frame.minY - expected.minY),
                    abs(frame.width - expected.width), abs(frame.height - expected.height))
            }.max() ?? 0
            print("Player settlement: \(name) maximum local frame drift = \(drift) pt")
            if drift > 1 { print("Player settlement frames: \(name) expected=\(expected), samples=\(values)") }
            XCTAssertLessThanOrEqual(drift, 1, "\(name) must keep the same size and local position through tap, swipe and completion")
        }
    }

    func testFrameUpdatesDoNotRebuildPlayerContent() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        let model = AppModel()
        model.demo = true
        let audio = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "tone", withExtension: "flac"))
        model.player.connect(try APIClient(address: "https://example.invalid"), demoURL: audio)
        model.player.play([Track(id: "motion", title: "A long player title for layout", duration: 8)])
        model.player.setForeground(true)
        let translation = PlayerTranslation()
        let position = Position()
        let content = NowPlayingView(model: model)
            .environment(\.playerTransitionActive, true)
            .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: { position.y = $0 }
            .modifier(PlayerTranslationEffect(translation: translation, height: 800, reduceMotion: false))
        let host = UIHostingController(rootView: content)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer {
            model.player.stop()
            window.isHidden = true
            window.rootViewController = nil
            previous?.makeKey()
        }
        for _ in 0..<100 where model.player.elapsed < 0.1 {
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertGreaterThan(model.player.elapsed, 0.1, "Measure actual playing audio, including foreground clock updates")
        let start = position.y
        let elapsed = model.player.elapsed
        let count = PlayerRenderWork.content
        for frame in 1...120 {
            translation.track(CGFloat(frame) / 120)
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(16))
        }
        try await Task.sleep(for: .milliseconds(100))
        print("Player transition: 120 progress updates, \(PlayerRenderWork.content - count) content evaluations")
        XCTAssertEqual(start - position.y, 800, accuracy: 1, "the visual surface must actually move")
        XCTAssertGreaterThan(model.player.elapsed, elapsed + 1, "The audio clock must keep updating during the gesture")
        XCTAssertLessThanOrEqual(PlayerRenderWork.content - count, 2,
                                "120 progress changes must not re-evaluate the player content each frame")
    }

    func testHitRegionsStayCorrectWhenTheSurfaceMoves() {
        let regions = PlayerHitRegions()
        regions.seek = CGRect(x: 20, y: 300, width: 350, height: 44)
        regions.transport = CGRect(x: 20, y: 370, width: 350, height: 90)
        regions.footer = CGRect(x: 20, y: 490, width: 350, height: 44)
        for offset in [CGFloat(0), 40, 300] {
            regions.origin = CGPoint(x: 0, y: offset)
            XCTAssertFalse(regions.accepts(CGPoint(x: 100, y: offset + 320)))
            XCTAssertFalse(regions.accepts(CGPoint(x: 100, y: offset + 400)))
            XCTAssertFalse(regions.accepts(CGPoint(x: 100, y: offset + 510)))
            XCTAssertTrue(regions.accepts(CGPoint(x: 100, y: offset + 180)))
        }
    }

    func testPlayerSurfaceRoundsOnlyItsTopCornersWhileAwayFromFullScreen() {
        for size in [CGSize(width: 402, height: 874), CGSize(width: 1194, height: 834)] {
            let bounds = CGRect(origin: .zero, size: size)
            let top = CGPoint(x: 1, y: 1)
            let bottom = CGPoint(x: 1, y: size.height - 1)
            let expanded = PlayerSurfaceShape(progress: 1, travelHeight: size.height).path(in: bounds)
            XCTAssertTrue(expanded.contains(top), "Full-screen corners must fill the canvas")
            for pull: CGFloat in [8, 48, 120, 300] {
                let shape = PlayerSurfaceShape(progress: 1 - pull / size.height, travelHeight: size.height)
                let path = shape.path(in: bounds)
                XCTAssertFalse(path.contains(top))
                XCTAssertFalse(path.contains(CGPoint(x: size.width - 1, y: 1)))
                XCTAssertTrue(path.contains(bottom), "Bottom corners remain square during travel")
                XCTAssertTrue(path.contains(CGPoint(x: 1, y: 40)), "The radius must stay restrained")
                XCTAssertTrue(path.contains(CGPoint(x: size.width / 2, y: 1)))
                XCTAssertEqual(path.boundingRect, bounds)
            }
        }
    }

    private final class Position { var y: CGFloat = 0 }

    private final class GestureDriver { var expand: PlayerDragActions? }
    private struct GestureLibrary: View {
        let driver: GestureDriver
        @Environment(\.expandPlayer) private var expand
        var body: some View {
            TabView {
                Theme.raised.safeAreaInset(edge: .bottom) { Color.clear.frame(height: 68) }
                    .tabItem { Label("Library", systemImage: "music.note") }
            }.onAppear { driver.expand = expand }
        }
    }
}
