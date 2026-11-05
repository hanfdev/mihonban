import OSLog
import SwiftUI

enum PlayerMotion {
    static let logger = Logger(subsystem: "org.mihonban.ios", category: "PlayerPresentation")

    static func completes(distance: CGFloat, predicted: CGFloat, height: CGFloat) -> Bool {
        distance >= min(140, height * 0.20)
            || (distance >= 24 && predicted >= min(240, height * 0.34))
    }

    static func progress(distance: CGFloat, height: CGFloat) -> CGFloat {
        min(1, max(0, distance / max(1, height)))
    }
}

struct PlayerDragActions {
    var changed: (CGFloat) -> Void
    var ended: (CGFloat, CGFloat) -> Void
}

extension EnvironmentValues {
    @Entry var expandPlayer: PlayerDragActions?
    @Entry var collapsePlayer: PlayerDragActions?
}

// One surface for both idioms keeps a finger-driven transition continuous;
// nested queue/credits sheets retain their own native presentation and gestures.
struct PlayerPresentation<Library: View>: View {
    let model: AppModel
    @ViewBuilder var library: () -> Library
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var phase
    @State private var mounted = false
    @State private var progress: CGFloat = 0
    @State private var opening = false

    @State private var travelHeight: CGFloat = 900

    var body: some View {
        library()
            .environment(\.expandPlayer, PlayerDragActions(changed: { distance in
                if !mounted { dismissKeyboard() }
                opening = true
                mounted = true
                progress = PlayerMotion.progress(distance: distance, height: travelHeight)
            }, ended: { distance, predicted in
                opening = false
                let expand = PlayerMotion.completes(distance: distance, predicted: predicted, height: travelHeight)
                PlayerMotion.logger.info("Expand ended: distance=\(distance), predicted=\(predicted), completed=\(expand)")
                model.player.isExpanded = expand
                settle(expand)
            }))
            .allowsHitTesting(!mounted || opening)
            .accessibilityHidden(mounted && !opening)
            // Keep TabView at the layout root so it owns the library safe areas.
            .overlay {
                if mounted {
                    GeometryReader { geometry in
                        NowPlayingView(model: model)
                            .environment(\.collapsePlayer, PlayerDragActions(changed: { distance in
                                progress = 1 - PlayerMotion.progress(distance: distance, height: travelHeight)
                            }, ended: { distance, predicted in
                                let collapse = PlayerMotion.completes(distance: distance, predicted: predicted, height: travelHeight)
                                PlayerMotion.logger.info("Collapse ended: distance=\(distance), predicted=\(predicted), completed=\(collapse)")
                                model.player.isExpanded = !collapse
                                settle(!collapse)
                            }))
                            .background(Theme.background.ignoresSafeArea())
                            .offset(y: reduceMotion ? 0 : (1 - progress) * travelHeight)
                            .opacity(reduceMotion ? progress : 1)
                            .allowsHitTesting(model.player.isExpanded && !opening)
                            .accessibilityHidden(!model.player.isExpanded || opening)
                            .accessibilityAddTraits(.isModal)
                    }
                }
            }
            .onGeometryChange(for: CGFloat.self) {
                $0.size.height + $0.safeAreaInsets.top + $0.safeAreaInsets.bottom
            } action: { height in
                travelHeight = max(1, height)
                if mounted && !opening { settle(model.player.isExpanded) }
            }
            .onChange(of: model.player.isExpanded) { _, expanded in
                PlayerMotion.logger.info("Expanded state: \(expanded)")
                if expanded && !mounted {
                    dismissKeyboard()
                    mounted = true
                    progress = 0
                    DispatchQueue.main.async { if model.player.isExpanded { settle(true) } }
                } else { settle(expanded) }
            }
            .onChange(of: phase) { _, next in
                if next != .active { opening = false; settle(model.player.isExpanded) }
            }
    }

    private func settle(_ expanded: Bool) {
        withAnimation(reduceMotion ? .easeOut(duration: 0.18) : .spring(duration: 0.42, bounce: 0.06)) {
            progress = expanded ? 1 : 0
        } completion: {
            if !model.player.isExpanded && !opening && progress == 0 { mounted = false }
        }
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

struct PlayerSwipe: ViewModifier {
    var expanding = false
    var enabled = true
    var excluded: [CGRect] = []
    @Environment(\.expandPlayer) private var expand
    @Environment(\.collapsePlayer) private var collapse
    @State private var accepted = false
    @State private var rejected = false
    @GestureState private var touching = false

    private var actions: PlayerDragActions? { expanding ? expand : collapse }

    func body(content: Content) -> some View {
        content.simultaneousGesture(
            DragGesture(minimumDistance: 12, coordinateSpace: .global)
                .updating($touching) { _, state, _ in state = true }
                .onChanged { value in
                    guard !rejected, actions != nil else { return }
                    let y = value.translation.height * (expanding ? -1 : 1)
                    if !accepted {
                        guard enabled, y > abs(value.translation.width) * 1.3,
                              !excluded.contains(where: { $0.contains(value.startLocation) }) else {
                            rejected = true
                            return
                        }
                        accepted = true
                    }
                    actions?.changed(max(0, y))
                }
                .onEnded { value in
                    if accepted {
                        let direction: CGFloat = expanding ? -1 : 1
                        actions?.ended(max(0, value.translation.height * direction),
                                       max(0, value.predictedEndTranslation.height * direction))
                    }
                    accepted = false
                    rejected = false
                }
        )
        .onChange(of: touching) { _, value in
            if !value {
                // GestureState can reset before onEnded. Let that callback finish
                // before treating a remaining accepted gesture as interrupted.
                DispatchQueue.main.async {
                    guard !touching else { return }
                    if accepted {
                        PlayerMotion.logger.info("Swipe cancelled: expanding=\(expanding)")
                        actions?.ended(0, 0)
                    }
                    accepted = false
                    rejected = false
                }
            }
        }
    }
}
