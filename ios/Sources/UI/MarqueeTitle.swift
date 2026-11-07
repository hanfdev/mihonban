import SwiftUI
import UIKit

// Animation changes only the drawing offset, never the title's layout height.
struct MarqueeMotion {
    let overflow: CGFloat
    let distance: CGFloat
    let travel: Double
    let wrap: Double
    let startPause: Double = 2
    let endPause: Double = 1.5
    var duration: Double { startPause + travel + endPause + wrap }
    var keyTimes: [NSNumber] {
        [0, startPause / duration, (startPause + travel) / duration,
         (startPause + travel + endPause) / duration, 1].map { NSNumber(value: $0) }
    }

    init?(textWidth: CGFloat, viewport: CGFloat, gap: CGFloat = 40) {
        guard viewport > 0, textWidth.isFinite, viewport.isFinite, textWidth > viewport + 1 else { return nil }
        overflow = textWidth - viewport
        distance = textWidth + gap
        travel = Double(overflow / 28)
        wrap = Double((viewport + gap) / 28)
    }
}

private struct MarqueeSuspendedKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var marqueeSuspended: Bool {
        get { self[MarqueeSuspendedKey.self] }
        set { self[MarqueeSuspendedKey.self] = newValue }
    }
}

struct PlaybackTitleButton: View {
    let track: Track?
    let openAlbum: () -> Void
    var fontSize: CGFloat = 27
    @State private var showingFullTitle = false
    @Environment(\.marqueeSuspended) private var suspended

    var body: some View {
        MarqueeTitle(text: track?.title ?? "", identity: track?.id ?? "", canOpenAlbum: track?.albumId != nil,
                     openAlbum: openAlbum, showFullTitle: { showingFullTitle = true }, fontSize: fontSize)
            .environment(\.marqueeSuspended, suspended || showingFullTitle)
            .frame(maxWidth: .infinity, alignment: .leading)
            .sheet(isPresented: $showingFullTitle) {
                NavigationStack {
                    ScrollView {
                        Text(track?.title ?? "").displayFont(22, relativeTo: .title2).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(24)
                            .accessibilityIdentifier("player.fullTitle")
                    }.background(Theme.background)
                        .navigationTitle(L10n.text("mobile.fullTitle")).navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button(L10n.text("common.done")) { showingFullTitle = false }
                            }
                        }
                }.presentationDragIndicator(.visible)
            }
            .onChange(of: track?.id) { _, _ in showingFullTitle = false }
    }
}

struct MarqueeTitle: UIViewRepresentable {
    let text: String
    let identity: String
    let canOpenAlbum: Bool
    let openAlbum: () -> Void
    let showFullTitle: () -> Void
    var fontSize: CGFloat = 27
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.marqueeSuspended) private var suspended
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.layoutDirection) private var direction

    func makeUIView(context: Context) -> MarqueeTitleControl { MarqueeTitleControl(frame: .zero) }
    private var font: UIFont {
        UIFontMetrics(forTextStyle: .title1).scaledFont(
            for: Typography.display(fontSize),
            compatibleWith: UITraitCollection(preferredContentSizeCategory: Typography.category(textSize)))
    }

    func updateUIView(_ view: MarqueeTitleControl, context: Context) {
        view.openAlbum = openAlbum
        view.showFullTitle = showFullTitle
        view.isEnabled = canOpenAlbum
        view.titleDisplay.setSuspended(suspended || scenePhase != .active)
        view.configure(text: text, identity: identity, font: font,
                       animated: !reduceMotion && !voiceOver && direction == .leftToRight)
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: MarqueeTitleControl, context: Context) -> CGSize? {
        // SwiftUI may measure before updateUIView configures the UIKit font.
        // Derive both dimensions from this value, never the previous UIKit configuration.
        CGSize(width: proposal.width ?? ceil((text as NSString).size(withAttributes: [.font: font]).width),
               height: max(44, ceil(font.lineHeight)))
    }
    static func dismantleUIView(_ uiView: MarqueeTitleControl, coordinator: ()) {
        uiView.titleDisplay.stop()
        uiView.openAlbum = nil
        uiView.showFullTitle = nil
    }
}

// A single UIKit control owns the touch target, long-press menu and accessible
// title. Its drawing-only child can be hidden from accessibility without
// suppressing the control, unlike a hidden label inside a SwiftUI Button.
final class MarqueeTitleControl: UIButton {
    let titleDisplay = MarqueeTitleView()
    var openAlbum: (() -> Void)?
    var showFullTitle: (() -> Void)?
    var titleHeight: CGFloat { max(44, titleDisplay.lineHeight) }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityIdentifier = "player.title"
        accessibilityHint = L10n.text("player.viewAlbum")
        titleDisplay.accessibilityElementsHidden = true
        addSubview(titleDisplay)
        addTarget(self, action: #selector(openAlbumFromTouch), for: .touchUpInside)
        showsMenuAsPrimaryAction = false
        menu = UIMenu(children: [UIAction(title: L10n.text("mobile.fullTitle")) { [weak self] _ in
            _ = self?.readFullTitle()
        }])
        accessibilityCustomActions = [UIAccessibilityCustomAction(name: L10n.text("mobile.fullTitle"),
            target: self, selector: #selector(readFullTitle))]
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(text: String, identity: String, font: UIFont, animated: Bool) {
        accessibilityLabel = text
        let previousHeight = titleHeight
        titleDisplay.configure(text: text, identity: identity, font: font, animated: animated)
        if titleHeight != previousHeight { invalidateIntrinsicContentSize() }
        setNeedsLayout()
    }

    override var intrinsicContentSize: CGSize { CGSize(width: UIView.noIntrinsicMetric, height: titleHeight) }
    override func layoutSubviews() {
        super.layoutSubviews()
        // System sheet transitions must not interpolate the glyph container's
        // frame. The marquee animates translation only, never scale or bounds.
        UIView.performWithoutAnimation { titleDisplay.frame = bounds }
    }
    override func accessibilityActivate() -> Bool {
        guard isEnabled, let openAlbum else { return false }
        openAlbum()
        return true
    }
    @objc private func openAlbumFromTouch() {
        guard isEnabled else { return }
        openAlbum?()
    }
    @objc func readFullTitle() -> Bool {
        guard isEnabled, let showFullTitle else { return false }
        showFullTitle()
        return true
    }
}

// UIKit's accessibility snapshot can still enumerate hidden UILabel children.
// Draw these two visual copies without text elements; the UIButton above is the
// only semantic title and continues to expose the complete string.
private final class MarqueeGlyphView: UIView {
    var text = "" { didSet { if text != oldValue { setNeedsDisplay() } } }
    var font = UIFont.systemFont(ofSize: 27) { didSet { if font != oldValue { setNeedsDisplay() } } }
    var lineBreakMode = NSLineBreakMode.byClipping { didSet { if lineBreakMode != oldValue { setNeedsDisplay() } } }
    var naturalWidth: CGFloat { (text as NSString).size(withAttributes: [.font: font]).width }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        accessibilityElementsHidden = true
        contentMode = .redraw
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ rect: CGRect) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = lineBreakMode
        let area = CGRect(x: 0, y: max(0, (bounds.height - font.lineHeight) / 2),
                          width: bounds.width, height: font.lineHeight)
        (text as NSString).draw(in: area, withAttributes: [
            .font: font, .foregroundColor: UIColor(Theme.ink), .paragraphStyle: paragraph
        ])
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection) { setNeedsDisplay() }
    }
}

final class MarqueeTitleView: UIView {
    private let strip = UIView()
    private let first = MarqueeGlyphView(frame: .zero)
    private let second = MarqueeGlyphView(frame: .zero)
    private var identity = ""
    private var animated = false
    private var suspended = false
    private var sceneInactive = false
    private var scrollExpected = false
    private var lastSize = CGSize.zero
    private(set) var animationGeneration = 0
    var naturalWidth: CGFloat { first.naturalWidth }
    var lineHeight: CGFloat { ceil(first.font.lineHeight) }
    var hasScrollAnimation: Bool { strip.layer.animation(forKey: "title.scroll") != nil }
    var isAnimating: Bool { hasScrollAnimation && strip.layer.speed != 0 && window != nil }
    var isScrollPaused: Bool { hasScrollAnimation && strip.layer.speed == 0 }
    var scrollTime: CFTimeInterval { strip.layer.convertTime(CACurrentMediaTime(), from: nil) }

    init() {
        super.init(frame: .zero)
        clipsToBounds = true
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        accessibilityElementsHidden = true
        addSubview(strip)
        strip.accessibilityElementsHidden = true
        for drawing in [first, second] { strip.addSubview(drawing) }
        NotificationCenter.default.addObserver(self, selector: #selector(sceneWillDeactivate(_:)),
            name: UIScene.willDeactivateNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(sceneDidActivate(_:)),
            name: UIScene.didActivateNotification, object: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit { NotificationCenter.default.removeObserver(self) }

    func configure(text: String, identity: String, font: UIFont, animated: Bool) {
        guard first.text != text || self.identity != identity || first.font != font || self.animated != animated else { return }
        self.identity = identity
        self.animated = animated
        for label in [first, second] { label.text = text; label.font = font }
        stop()
        lastSize = .zero
        invalidateIntrinsicContentSize()
        setNeedsLayout()
    }

    func setSuspended(_ value: Bool) {
        guard suspended != value else {
            if !value { restoreMissingAnimation() }
            return
        }
        suspended = value
        updatePlaybackState()
        if !value { restoreMissingAnimation(); setNeedsLayout() }
    }

    @objc private func sceneWillDeactivate(_ notification: Notification) {
        guard let scene = notification.object as? UIWindowScene, window?.windowScene === scene else { return }
        sceneInactive = true
        updatePlaybackState()
    }

    @objc private func sceneDidActivate(_ notification: Notification) {
        guard let scene = notification.object as? UIWindowScene, window?.windowScene === scene else { return }
        sceneInactive = false
        updatePlaybackState()
        restoreMissingAnimation()
    }

    private func restoreMissingAnimation() {
        // Backgrounding can discard a layer animation without changing text or
        // layout. Resume the existing clock when possible, rebuilding only a
        // missing scroll animation after both the scene and player are active.
        guard scrollExpected, !hasScrollAnimation, !suspended, !sceneInactive,
              window != nil, bounds.width > 0, bounds.height > 0 else { return }
        restart()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Suspension freezes the animation clock, not layout. Prepare glyphs
        // at their final size before the player moves into view.
        guard bounds.width > 0, bounds.height > 0, window != nil || !hasScrollAnimation else { return }
        guard bounds.size != lastSize else { return }
        lastSize = bounds.size
        restart()
    }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        if let scene = window?.windowScene { sceneInactive = scene.activationState != .foregroundActive }
        else { sceneInactive = false }
        if window != nil {
            setNeedsLayout()
            layoutIfNeeded()
            if animated && !hasScrollAnimation && bounds.width > 0 { restart() }
        }
        updatePlaybackState()
    }
    func stop() {
        scrollExpected = false
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        strip.layer.removeAnimation(forKey: "title.scroll")
        strip.layer.speed = 1
        strip.layer.timeOffset = 0
        strip.layer.beginTime = 0
        strip.layer.transform = CATransform3DIdentity
        CATransaction.commit()
    }

    private func updatePlaybackState() {
        guard hasScrollAnimation else { return }
        let pause = suspended || sceneInactive || window == nil
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if pause && strip.layer.speed != 0 {
            let elapsed = strip.layer.convertTime(CACurrentMediaTime(), from: nil)
            strip.layer.speed = 0
            strip.layer.timeOffset = elapsed
        } else if !pause && strip.layer.speed == 0 {
            let elapsed = strip.layer.timeOffset
            strip.layer.speed = 1
            strip.layer.timeOffset = 0
            strip.layer.beginTime = 0
            strip.layer.beginTime = strip.layer.convertTime(CACurrentMediaTime(), from: nil) - elapsed
        }
        CATransaction.commit()
    }

    private func restart() {
        stop()
        let width = ceil(naturalWidth)
        let motion = animated && window != nil ? MarqueeMotion(textWidth: width, viewport: bounds.width) : nil
        scrollExpected = motion != nil
        UIView.performWithoutAnimation {
            strip.bounds = CGRect(x: 0, y: 0, width: max(width, bounds.width) * 2 + 40, height: bounds.height)
            strip.center = CGPoint(x: strip.bounds.width / 2, y: bounds.height / 2)
            first.lineBreakMode = motion == nil ? .byTruncatingTail : .byClipping
            first.frame = CGRect(x: 0, y: 0, width: motion == nil ? bounds.width : width, height: bounds.height)
            second.frame = CGRect(x: width + 40, y: 0, width: width, height: bounds.height)
            second.isHidden = motion == nil
        }
        guard let motion else { return }
        // Keep an explicit local start time so suspend/resume preserves the
        // same cycle, including its initial and trailing reading pauses.
        let animation = CAKeyframeAnimation(keyPath: "transform.translation.x")
        animation.values = [0, 0, -motion.overflow, -motion.overflow, -motion.distance]
        animation.keyTimes = motion.keyTimes
        animation.duration = motion.duration
        animation.beginTime = strip.layer.convertTime(CACurrentMediaTime(), from: nil)
        animation.calculationMode = .linear
        animation.repeatCount = .infinity
        strip.layer.add(animation, forKey: "title.scroll")
        animationGeneration += 1
        updatePlaybackState()
    }
}
