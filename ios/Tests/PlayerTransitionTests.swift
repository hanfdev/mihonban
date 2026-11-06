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
        XCTAssertGreaterThan(heading.height, 44)
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
        actions.ended(220, 280)
        try await Task.sleep(for: .milliseconds(900))
        XCTAssertTrue(model.player.isExpanded)
        for (name, values, expected) in [("cover", frames.cover, cover), ("heading", frames.heading, heading)] {
            let drift = values.map { frame in
                max(abs(frame.minX - expected.minX), abs(frame.minY - expected.minY),
                    abs(frame.width - expected.width), abs(frame.height - expected.height))
            }.max() ?? 0
            print("Player settlement: \(name) maximum local frame drift = \(drift) pt")
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
        model.player.pause()
        model.player.setForeground(false)
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
        try await Task.sleep(for: .milliseconds(500))
        let start = position.y
        let count = PlayerRenderWork.content
        for frame in 1...120 {
            translation.progress = CGFloat(frame) / 120
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(3))
        }
        try await Task.sleep(for: .milliseconds(100))
        print("Player transition: 120 progress updates, \(PlayerRenderWork.content - count) content evaluations")
        XCTAssertEqual(start - position.y, 800, accuracy: 1, "the visual surface must actually move")
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

    private final class Position { var y: CGFloat = 0 }

    private final class GestureDriver { var expand: PlayerDragActions? }
    private struct GestureLibrary: View {
        let driver: GestureDriver
        @Environment(\.expandPlayer) private var expand
        var body: some View {
            TabView {
                Color.clear.safeAreaInset(edge: .bottom) { Color.clear.frame(height: 68) }
                    .tabItem { Label("Library", systemImage: "music.note") }
            }.onAppear { driver.expand = expand }
        }
    }
}
