import XCTest
import CoreText
import SwiftUI
@testable import Mihonban

@MainActor
final class TypographyTests: XCTestCase {
    func testLocalizedHeadingsNeverFallBackToSystemSansGlyphs() throws {
        for text in ["播放队列 设置 随机播放 精选歌曲", "播放佇列 設定 隨機播放", "再生キュー 設定", "재생 대기열 설정"] {
            let value = NSAttributedString(string: text, attributes: [.font: Typography.display(30)])
            let line = CTLineCreateWithAttributedString(value)
            let runs = CTLineGetGlyphRuns(line) as! [CTRun]
            XCTAssertFalse(runs.isEmpty)
            for run in runs {
                let attributes = CTRunGetAttributes(run) as NSDictionary
                let font = try XCTUnwrap(attributes[kCTFontAttributeName]) as! CTFont
                let name = CTFontCopyPostScriptName(font) as String
                XCTAssertTrue([Typography.displayName, Typography.fallbackName].contains(name), "Unexpected font \(name) in \(text)")
            }
        }
    }

    func testDisplayFontKeepsItsCascadeWhenScaledForAccessibility() {
        let base = Typography.display(30)
        let large = UIFontMetrics(forTextStyle: .title1).scaledFont(for: base,
            compatibleWith: UITraitCollection(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge))
        XCTAssertGreaterThan(large.pointSize, base.pointSize)
        XCTAssertNotNil(large.fontDescriptor.object(forKey: .cascadeList))
    }
}
