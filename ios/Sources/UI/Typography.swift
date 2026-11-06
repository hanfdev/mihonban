import SwiftUI
import UIKit

// Display text always uses the bundled Mincho cascade, including simplified
// Han and Hangul. Registering a font alone does not put it in Core Text's cascade.
enum Typography {
    static let displayName = "ShipporiMincho-SemiBold"
    static let fallbackName = "GenRyuMin2PJP-SB"

    static func display(_ size: CGFloat) -> UIFont {
        let descriptor = UIFontDescriptor(name: displayName, size: size).addingAttributes([
            .cascadeList: [UIFontDescriptor(name: fallbackName, size: size)]
        ])
        return UIFont(descriptor: descriptor, size: size)
    }

    static func category(_ size: DynamicTypeSize) -> UIContentSizeCategory {
        switch size {
        case .xSmall: .extraSmall
        case .small: .small
        case .medium: .medium
        case .large: .large
        case .xLarge: .extraLarge
        case .xxLarge: .extraExtraLarge
        case .xxxLarge: .extraExtraExtraLarge
        case .accessibility1: .accessibilityMedium
        case .accessibility2: .accessibilityLarge
        case .accessibility3: .accessibilityExtraLarge
        case .accessibility4: .accessibilityExtraExtraLarge
        case .accessibility5: .accessibilityExtraExtraExtraLarge
        @unknown default: .large
        }
    }
}

private struct DisplayFont: ViewModifier {
    let size: CGFloat
    let style: UIFont.TextStyle
    @Environment(\.dynamicTypeSize) private var textSize

    func body(content: Content) -> some View {
        let font = UIFontMetrics(forTextStyle: style).scaledFont(for: Typography.display(size),
            compatibleWith: UITraitCollection(preferredContentSizeCategory: Typography.category(textSize)))
        content.font(Font(font))
    }
}

extension View {
    func displayFont(_ size: CGFloat, relativeTo style: UIFont.TextStyle = .title1) -> some View {
        modifier(DisplayFont(size: size, style: style))
    }
}
