import XCTest
import SwiftUI
@testable import Mihonban

@MainActor
final class PlayerTransitionTests: XCTestCase {
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
}
