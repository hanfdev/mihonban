import SwiftUI

enum Appearance: String, CaseIterable {
    case system, light, dark
    var label: String { "mobile.appearance" + rawValue.capitalized }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

// Apply at presentation boundaries too: a presented controller owns its traits.
struct AppAppearance: ViewModifier {
    @AppStorage("appearance") private var appearance = Appearance.system.rawValue
    func body(content: Content) -> some View {
        content.preferredColorScheme((Appearance(rawValue: appearance) ?? .system).colorScheme)
    }
}
