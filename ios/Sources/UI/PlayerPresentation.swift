import OSLog
import SwiftUI

// Only the outer drawing modifier observes per-frame progress. The library,
// hosting hierarchy, and player layout observe transition boundaries instead.
@MainActor @Observable
final class PlayerTranslation {
    var progress: CGFloat = 0

    func track(_ value: CGFloat) {
        var transaction = Transaction(animation: nil)
        transaction.isContinuous = true
        withTransaction(transaction) { progress = value }
    }
}

struct PlayerTranslationEffect: ViewModifier {
    let translation: PlayerTranslation
    let height: CGFloat
    let reduceMotion: Bool

    func body(content: Content) -> some View {
        content
            .offset(y: reduceMotion ? 0 : (1 - translation.progress) * height)
            .opacity(reduceMotion ? translation.progress : 1)
    }
}

// Geometry caches are intentionally unobserved: gesture hit testing reads
// them on touch-down without publishing layout changes back into SwiftUI.
final class PlayerHitRegions {
    var origin: CGPoint = .zero
    var seek: CGRect = .zero
    var transport: CGRect = .zero
    var footer: CGRect = .zero

    func accepts(_ point: CGPoint) -> Bool {
        let local = CGPoint(x: point.x - origin.x, y: point.y - origin.y)
        return ![seek, transport, footer].contains { $0.contains(local) }
    }
}

@MainActor enum PlayerRenderWork {
    static var shell = 0
    static var content = 0
    private static var start: (Int, Int)?
    static func begin() {
        #if DEBUG
        if start == nil { start = (shell, content) }
        #endif
    }
    static func end() {
        #if DEBUG
        if let start {
            PlayerMotion.logger.info("Transition render work: shell=\(shell - start.0), content=\(content - start.1)")
        }
        start = nil
        #endif
    }
}

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

// A finite, monotonic landing with a release velocity and zero terminal speed.
// Unlike a fixed spring, a short remaining distance has no long settling tail.
struct PlayerSettleAnimation: CustomAnimation {
    let duration: TimeInterval
    let initialSlope: Double

    init(distance: CGFloat, height: CGFloat, velocity: CGFloat) {
        let remaining = max(1, abs(distance))
        let speed = max(0, velocity * (distance >= 0 ? 1 : -1))
        let base = 0.16 + 0.18 * min(1, Double(remaining / max(1, height)))
        duration = speed > 0 ? min(base, max(0.12, Double(2 * remaining / speed))) : base
        initialSlope = min(3, Double(speed / remaining) * duration)
    }

    func fraction(at time: TimeInterval) -> Double {
        let t = min(1, max(0, time / duration))
        return (initialSlope - 2) * t * t * t + (3 - 2 * initialSlope) * t * t + initialSlope * t
    }

    func animate<V: VectorArithmetic>(value: V, time: TimeInterval, context: inout AnimationContext<V>) -> V? {
        guard time < duration else { return nil }
        return value.scaled(by: fraction(at: time))
    }
}

struct PlayerDragActions {
    var changed: (CGFloat) -> Void
    var ended: (CGFloat, CGFloat, CGFloat) -> Void
}

extension EnvironmentValues {
    @Entry var expandPlayer: PlayerDragActions?
    @Entry var collapsePlayer: PlayerDragActions?
    @Entry var playerTransitionActive = false
    @Entry var playerViewportCenterY: CGFloat? = nil
}

#if DEBUG
@MainActor final class PlayerFrameProbe {
    var cover: [CGRect] = []
    var heading: [CGRect] = []
    func record(_ frame: CGRect, cover: Bool) {
        if cover { self.cover.append(frame) } else { heading.append(frame) }
    }
}

extension EnvironmentValues {
    @Entry var playerFrameProbe: PlayerFrameProbe?
}

private struct PlayerFrameMeasurement: ViewModifier {
    let cover: Bool
    let space: AnyHashable
    @Environment(\.playerFrameProbe) private var probe
    func body(content: Content) -> some View {
        content.onGeometryChange(for: CGRect.self) { $0.frame(in: .named(space)) } action: {
            probe?.record($0, cover: cover)
        }
    }
}
#endif

extension View {
    @ViewBuilder func measurePlayerFrame(cover: Bool, in space: AnyHashable) -> some View {
        #if DEBUG
        modifier(PlayerFrameMeasurement(cover: cover, space: space))
        #else
        self
        #endif
    }
}

// One surface for both idioms keeps a finger-driven transition continuous;
// nested queue/credits sheets retain their own native presentation and gestures.
struct PlayerPresentation<Library: View>: View {
    let model: AppModel
    @ViewBuilder var library: () -> Library
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var phase
    @State private var mounted = false
    @State private var translation = PlayerTranslation()
    @State private var opening = false
    @State private var moving = false
    @State private var dragging = false
    @State private var settlingTo: Bool?
    @State private var motionRevision = 0

    @State private var travelHeight: CGFloat = 900

    var body: some View {
        #if DEBUG
        let _ = { PlayerRenderWork.shell += 1 }()
        #endif
        library()
            .environment(\.expandPlayer, PlayerDragActions(changed: { distance in
                if !mounted { dismissKeyboard() }
                if !opening { opening = true }
                if !mounted { mounted = true }
                beginDrag()
                translation.track(PlayerMotion.progress(distance: distance, height: travelHeight))
            }, ended: { distance, predicted, velocity in
                opening = false
                dragging = false
                let expand = PlayerMotion.completes(distance: distance, predicted: predicted, height: travelHeight)
                PlayerMotion.logger.info("Expand ended: distance=\(distance), predicted=\(predicted), completed=\(expand)")
                finishDrag(expand, velocity: velocity)
            }))
            .allowsHitTesting(!mounted || opening)
            .accessibilityHidden(mounted && !opening)
            // Keep TabView at the layout root so it owns the library safe areas.
            .overlay {
                GeometryReader { viewport in
                    // Prepare the player when a track is selected, before the first
                    // drag. Retain artwork and layout between presentations.
                    if model.player.current != nil {
                        NowPlayingView(model: model)
                            .environment(\.collapsePlayer, PlayerDragActions(changed: { distance in
                                beginDrag()
                                translation.track(1 - PlayerMotion.progress(distance: distance, height: travelHeight))
                            }, ended: { distance, predicted, velocity in
                                let collapse = PlayerMotion.completes(distance: distance, predicted: predicted, height: travelHeight)
                                PlayerMotion.logger.info("Collapse ended: distance=\(distance), predicted=\(predicted), completed=\(collapse)")
                                dragging = false
                                finishDrag(!collapse, velocity: -velocity)
                            }))
                            .environment(\.playerTransitionActive, moving || !mounted)
                            .environment(\.playerViewportCenterY,
                                (viewport.size.height + viewport.safeAreaInsets.bottom - viewport.safeAreaInsets.top) / 2)
                            // Reconstruct the full canvas before padding it. The
                            // stationary viewport's size already excludes system
                            // insets; padding that size would deduct them twice.
                            .padding(viewport.safeAreaInsets)
                            .frame(width: viewport.size.width + viewport.safeAreaInsets.leading + viewport.safeAreaInsets.trailing,
                                   height: viewport.size.height + viewport.safeAreaInsets.top + viewport.safeAreaInsets.bottom)
                            .ignoresSafeArea(.container)
                            .background(Theme.background.ignoresSafeArea())
                            .modifier(PlayerTranslationEffect(translation: translation,
                                height: travelHeight, reduceMotion: reduceMotion))
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
                if mounted && !dragging { settle(model.player.isExpanded) }
            }
            .onChange(of: model.player.isExpanded) { _, expanded in
                PlayerMotion.logger.info("Expanded state: \(expanded)")
                if expanded && !mounted {
                    dismissKeyboard()
                    mounted = true
                    translation.progress = 0
                    DispatchQueue.main.async { if model.player.isExpanded { settle(true) } }
                } else { settle(expanded) }
            }
            .onChange(of: phase) { _, next in
                if next != .active { opening = false; dragging = false; settle(model.player.isExpanded) }
            }
    }

    private func beginDrag() {
        guard !dragging else { return }
        dragging = true
        settlingTo = nil
        motionRevision += 1
        PlayerRenderWork.begin()
        moving = true
    }

    private func finishDrag(_ expanded: Bool, velocity: CGFloat) {
        // Continue in this gesture event, without waiting for another body/onChange
        // cycle. The later onChange sees settlingTo and cannot restart the landing.
        if model.player.isExpanded != expanded { model.player.isExpanded = expanded }
        settle(expanded, velocity: velocity)
    }

    private func settle(_ expanded: Bool, velocity: CGFloat? = nil) {
        guard settlingTo != expanded else { return }
        let target: CGFloat = expanded ? 1 : 0
        guard moving || translation.progress != target else { return }
        settlingTo = expanded
        motionRevision += 1
        let revision = motionRevision
        moving = true
        let animation: Animation
        if reduceMotion { animation = .easeOut(duration: 0.18) }
        else if let velocity {
            animation = Animation(PlayerSettleAnimation(distance: (target - translation.progress) * travelHeight,
                height: travelHeight, velocity: velocity))
        } else { animation = .timingCurve(0.25, 0.1, 0.25, 1, duration: 0.32) }
        withAnimation(animation,
                      completionCriteria: .removed) {
            translation.progress = target
        } completion: {
            guard revision == motionRevision, !dragging, model.player.isExpanded == expanded else { return }
            if !expanded && translation.progress == 0 { mounted = false }
            moving = false
            settlingTo = nil
            PlayerRenderWork.end()
        }
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

struct PlayerSwipe: ViewModifier {
    var expanding = false
    var enabled = true
    var acceptsStart: (CGPoint) -> Bool = { _ in true }
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
                              acceptsStart(value.startLocation) else {
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
                                       max(0, value.predictedEndTranslation.height * direction),
                                       value.velocity.height * direction)
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
                        actions?.ended(0, 0, 0)
                    }
                    accepted = false
                    rejected = false
                }
            }
        }
    }
}
