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
    @State private var systemScheme: ColorScheme?
    func body(content: Content) -> some View {
        content
            .background(SystemAppearanceReader { systemScheme = $0 }.frame(width: 0, height: 0))
            .preferredColorScheme((Appearance(rawValue: appearance) ?? .system).colorScheme ?? systemScheme)
    }
}

// The scene reports the actual system appearance, even when a presented
// hosting controller still carries the app's previous light/dark override.
private struct SystemAppearanceReader: UIViewRepresentable {
    var changed: (ColorScheme) -> Void
    func makeUIView(context: Context) -> Probe { Probe(changed: changed) }
    func updateUIView(_ view: Probe, context: Context) {
        view.changed = changed
        view.report()
    }

    final class Probe: UIView {
        var changed: (ColorScheme) -> Void
        private var reported: ColorScheme?
        private weak var observedScene: UIWindowScene?
        private var registration: (any UITraitChangeRegistration)?
        init(changed: @escaping (ColorScheme) -> Void) {
            self.changed = changed
            super.init(frame: .zero)
            isUserInteractionEnabled = false
            registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: Probe, _: UITraitCollection) in
                view.report()
            }
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if let registration { observedScene?.unregisterForTraitChanges(registration) }
            observedScene = window?.windowScene
            registration = observedScene?.registerForTraitChanges([UITraitUserInterfaceStyle.self]) { [weak self] (_: UIWindowScene, _: UITraitCollection) in
                self?.report()
            }
            report()
        }
        func report() {
            guard let scene = window?.windowScene else { return }
            let next: ColorScheme = scene.traitCollection.userInterfaceStyle == .dark ? .dark : .light
            guard next != reported else { return }
            reported = next
            DispatchQueue.main.async { [weak self] in self?.changed(next) }
        }
    }
}
