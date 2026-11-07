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
            .clipShape(PlayerSurfaceShape(progress: reduceMotion ? 1 : translation.progress,
                travelHeight: height), style: FillStyle(antialiased: true))
            .offset(y: reduceMotion ? 0 : (1 - translation.progress) * height)
            .opacity(reduceMotion ? translation.progress : 1)
    }
}

// Animate the same progress as translation, deriving the curve at draw time.
// The complete surface, including its background, keeps its existing layout.
struct PlayerSurfaceShape: Shape {
    var progress: CGFloat
    let travelHeight: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let limit = min(32, max(0, min(rect.width, rect.height) / 2))
        let pull = max(0, (1 - progress) * travelHeight)
        // Ease into the maximum radius without a visible saturation kink.
        let fraction = min(1, pull / 96)
        let radius = limit * (1 - pow(1 - fraction, 3))
        return UnevenRoundedRectangle(topLeadingRadius: radius, bottomLeadingRadius: 0,
            bottomTrailingRadius: 0, topTrailingRadius: radius, style: .continuous).path(in: rect)
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

// Recognition has a small dead zone to preserve taps. Begin visual travel at
// the accepted sample, then follow every additional point without acceleration.
struct PlayerDragPickup {
    private var origin: CGFloat?

    mutating func distance(_ translation: CGFloat) -> CGFloat {
        if origin == nil { origin = translation }
        return adjusted(translation)
    }

    func adjusted(_ translation: CGFloat) -> CGFloat {
        max(0, translation - (origin ?? translation))
    }

    mutating func reset() { origin = nil }
}

extension EnvironmentValues {
    @Entry var expandPlayer: PlayerDragActions?
    @Entry var collapsePlayer: PlayerDragActions?
    @Entry var playerTransitionActive = false
    @Entry var playerViewportCenterY: CGFloat? = nil
    @Entry var playerGestureEnabled = true
}

#if DEBUG
@MainActor final class PlayerFrameProbe {
    var cover: [CGRect] = []
    var heading: [CGRect] = []
    var globalCover: [CGRect] = []
    var collapse: PlayerDragActions?
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
    @Environment(\.collapsePlayer) private var collapse
    func body(content: Content) -> some View {
        content.onGeometryChange(for: CGRect.self) { $0.frame(in: .named(space)) } action: {
            probe?.record($0, cover: cover)
        }
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: {
            if cover { probe?.globalCover.append($0) }
        }
        .onAppear { if cover { probe?.collapse = collapse } }
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
                guard model.player.current != nil, !moving || dragging else { return }
                if !mounted { dismissKeyboard() }
                if !opening { opening = true }
                if !mounted { mounted = true }
                beginDrag()
                translation.track(PlayerMotion.progress(distance: distance, height: travelHeight))
            }, ended: { distance, predicted, velocity in
                guard dragging else { return }
                opening = false
                dragging = false
                let expand = PlayerMotion.completes(distance: distance, predicted: predicted, height: travelHeight)
                PlayerMotion.logger.info("Expand ended: distance=\(distance), predicted=\(predicted), completed=\(expand)")
                finishDrag(expand, velocity: velocity)
            }))
            .environment(\.playerGestureEnabled, !moving || dragging)
            .allowsHitTesting(model.player.current == nil || !mounted || opening)
            .accessibilityHidden(model.player.current != nil && mounted && !opening)
            // Keep TabView at the layout root so it owns the library safe areas.
            .overlay {
                GeometryReader { viewport in
                    // Prepare the player when a track is selected, before the first
                    // drag. Retain artwork and layout between presentations.
                    if model.player.current != nil {
                        NowPlayingView(model: model)
                            .environment(\.collapsePlayer, PlayerDragActions(changed: { distance in
                                guard model.player.current != nil, !moving || dragging else { return }
                                beginDrag()
                                translation.track(1 - PlayerMotion.progress(distance: distance, height: travelHeight))
                            }, ended: { distance, predicted, velocity in
                                guard dragging else { return }
                                let collapse = PlayerMotion.completes(distance: distance, predicted: predicted, height: travelHeight)
                                PlayerMotion.logger.info("Collapse ended: distance=\(distance), predicted=\(predicted), completed=\(collapse)")
                                dragging = false
                                finishDrag(!collapse, velocity: -velocity)
                            }))
                            .environment(\.playerTransitionActive, moving || !mounted)
                            .environment(\.playerGestureEnabled, !moving || dragging)
                            .environment(\.playerViewportCenterY,
                                (viewport.size.height + viewport.safeAreaInsets.bottom - viewport.safeAreaInsets.top) / 2)
                            // Give the clipped canvas a fixed full-window origin.
                            // Safe-area expansion during translation can otherwise
                            // add a top inset or expose the landscape leading edge.
                            .padding(viewport.safeAreaInsets)
                            .frame(width: viewport.size.width + viewport.safeAreaInsets.leading + viewport.safeAreaInsets.trailing,
                                   height: viewport.size.height + viewport.safeAreaInsets.top + viewport.safeAreaInsets.bottom)
                            .background(Theme.background, ignoresSafeAreaEdges: [])
                            .modifier(PlayerTranslationEffect(translation: translation,
                                height: travelHeight, reduceMotion: reduceMotion))
                            .offset(x: -viewport.safeAreaInsets.leading, y: -viewport.safeAreaInsets.top)
                            .allowsHitTesting(model.player.isExpanded && !opening && (!moving || dragging))
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
                guard model.player.current != nil else { resetPresentation(); return }
                PlayerMotion.logger.info("Expanded state: \(expanded)")
                if expanded && !mounted {
                    dismissKeyboard()
                    mounted = true
                    translation.progress = 0
                    DispatchQueue.main.async {
                        if model.player.current != nil && model.player.isExpanded { settle(true) }
                    }
                } else { settle(expanded) }
            }
            .onChange(of: model.player.current == nil) { _, empty in
                if empty { resetPresentation() }
            }
            .onChange(of: phase) { _, next in
                if next != .active {
                    // Backgrounding may remove Core Animation completions. Finish
                    // synchronously so foreground content never stays suspended.
                    motionRevision += 1
                    opening = false
                    dragging = false
                    moving = false
                    settlingTo = nil
                    mounted = model.player.current != nil && model.player.isExpanded
                    translation.track(mounted ? 1 : 0)
                    PlayerRenderWork.end()
                }
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
        guard model.player.current != nil else { resetPresentation(); return }
        // Continue in this gesture event, without waiting for another body/onChange
        // cycle. The later onChange sees settlingTo and cannot restart the landing.
        if model.player.isExpanded != expanded { model.player.isExpanded = expanded }
        settle(expanded, velocity: velocity)
    }

    private func resetPresentation() {
        motionRevision += 1
        mounted = false
        opening = false
        moving = false
        dragging = false
        settlingTo = nil
        translation.track(0)
        PlayerRenderWork.end()
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
    @Environment(\.playerGestureEnabled) private var gestureEnabled
    @State private var accepted = false
    @State private var rejected = false
    @State private var pickup = PlayerDragPickup()
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
                        guard enabled, gestureEnabled, y > abs(value.translation.width) * 1.3,
                              acceptsStart(value.startLocation) else {
                            rejected = true
                            return
                        }
                        accepted = true
                    }
                    actions?.changed(pickup.distance(y))
                }
                .onEnded { value in
                    if accepted {
                        let direction: CGFloat = expanding ? -1 : 1
                        actions?.ended(pickup.adjusted(value.translation.height * direction),
                                       pickup.adjusted(value.predictedEndTranslation.height * direction),
                                       value.velocity.height * direction)
                    }
                    accepted = false
                    rejected = false
                    pickup.reset()
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
                    pickup.reset()
                }
            }
        }
    }
}
