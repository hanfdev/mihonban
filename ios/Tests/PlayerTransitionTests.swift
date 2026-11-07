import XCTest
import SwiftUI
@testable import Mihonban

@MainActor
final class PlayerTransitionTests: XCTestCase {
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
