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

// Set the window's native override and clear every presented controller's old
// override. SwiftUI's preferredColorScheme(nil) can leave a sheet's previous
// trait override alive until the sheet is presented again.
struct AppAppearance: ViewModifier {
    @AppStorage("appearance") private var appearance = Appearance.system.rawValue
    func body(content: Content) -> some View {
        content.background(WindowAppearance(appearance: Appearance(rawValue: appearance) ?? .system)
            .frame(width: 0, height: 0))
    }
}

private struct WindowAppearance: UIViewRepresentable {
    let appearance: Appearance
    func makeUIView(context: Context) -> Probe { Probe() }
    func updateUIView(_ view: Probe, context: Context) {
        view.style = switch appearance {
        case .system: .unspecified
        case .light: .light
        case .dark: .dark
        }
        view.apply()
    }

    final class Probe: UIView {
        var style = UIUserInterfaceStyle.unspecified
        override func didMoveToWindow() { super.didMoveToWindow(); apply() }
        func apply() {
            guard let window else { return }
            if window.overrideUserInterfaceStyle != style { window.overrideUserInterfaceStyle = style }
            func update(_ controller: UIViewController) {
                if controller.overrideUserInterfaceStyle != style { controller.overrideUserInterfaceStyle = style }
                controller.children.forEach(update)
                if let presented = controller.presentedViewController { update(presented) }
            }
            if let root = window.rootViewController { update(root) }
        }
    }
}
