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

struct PlaybackTitleButton: View {
    let track: Track?
    let openAlbum: () -> Void
    @State private var showingFullTitle = false

    var body: some View {
        Button(action: openAlbum) {
            MarqueeTitle(text: track?.title ?? "", identity: track?.id ?? "")
                .frame(maxWidth: .infinity, alignment: .leading)
        }.buttonStyle(.plain).disabled(track?.albumId == nil)
            .accessibilityLabel(track?.title ?? "")
            .accessibilityHint(L10n.text("player.viewAlbum")).accessibilityIdentifier("player.title")
            .contextMenu { Button(L10n.text("mobile.fullTitle")) { showingFullTitle = true } }
            .accessibilityAction(named: Text(L10n.text("mobile.fullTitle"))) { showingFullTitle = true }
            .sheet(isPresented: $showingFullTitle) {
                NavigationStack {
                    ScrollView {
                        Text(track?.title ?? "").font(.title2).textSelection(.enabled)
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
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.layoutDirection) private var direction

    func makeUIView(context: Context) -> MarqueeTitleView { MarqueeTitleView() }
    func updateUIView(_ view: MarqueeTitleView, context: Context) {
        let categories: [DynamicTypeSize: UIContentSizeCategory] = [
            .xSmall: .extraSmall, .small: .small, .medium: .medium, .large: .large,
            .xLarge: .extraLarge, .xxLarge: .extraExtraLarge, .xxxLarge: .extraExtraExtraLarge,
            .accessibility1: .accessibilityMedium, .accessibility2: .accessibilityLarge,
            .accessibility3: .accessibilityExtraLarge, .accessibility4: .accessibilityExtraExtraLarge,
            .accessibility5: .accessibilityExtraExtraExtraLarge]
        let font = UIFontMetrics(forTextStyle: .title1).scaledFont(
            for: UIFont(name: "ShipporiMincho-SemiBold", size: 27) ?? .systemFont(ofSize: 27),
            compatibleWith: UITraitCollection(preferredContentSizeCategory: categories[textSize] ?? .large))
        view.configure(text: text, identity: identity, font: font,
                       animated: scenePhase == .active && !reduceMotion && !voiceOver && direction == .leftToRight)
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: MarqueeTitleView, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? uiView.naturalWidth, height: uiView.lineHeight)
    }
    static func dismantleUIView(_ uiView: MarqueeTitleView, coordinator: ()) { uiView.stop() }
}

final class MarqueeTitleView: UIView {
    private let strip = UIView()
    private let first = UILabel()
    private let second = UILabel()
    private var identity = ""
    private var animated = false
    private var lastSize = CGSize.zero
    var naturalWidth: CGFloat {
        first.sizeThatFits(CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)).width
    }
    var lineHeight: CGFloat { ceil(first.font.lineHeight) }
    var isAnimating: Bool { strip.layer.animation(forKey: "title.scroll") != nil }

    init() {
        super.init(frame: .zero)
        clipsToBounds = true
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        accessibilityElementsHidden = true
        addSubview(strip)
        for label in [first, second] {
            label.numberOfLines = 1
            label.textColor = UIColor(Theme.ink)
            label.isAccessibilityElement = false
            strip.addSubview(label)
        }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

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

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != lastSize else { return }
        lastSize = bounds.size
        restart()
    }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { stop() } else { restart() }
    }
    func stop() { strip.layer.removeAnimation(forKey: "title.scroll"); strip.transform = .identity }

    private func restart() {
        stop()
        let width = ceil(naturalWidth)
        strip.frame = CGRect(x: 0, y: 0, width: max(width, bounds.width) * 2 + 40, height: bounds.height)
        let motion = animated && window != nil ? MarqueeMotion(textWidth: width, viewport: bounds.width) : nil
        first.lineBreakMode = motion == nil ? .byTruncatingTail : .byClipping
        first.frame = CGRect(x: 0, y: 0, width: motion == nil ? bounds.width : width, height: bounds.height)
        second.frame = CGRect(x: width + 40, y: 0, width: width, height: bounds.height)
        second.isHidden = motion == nil
        guard let motion else { return }
        let animation = CAKeyframeAnimation(keyPath: "transform.translation.x")
        animation.values = [0, 0, -motion.overflow, -motion.overflow, -motion.distance]
        animation.keyTimes = motion.keyTimes
        animation.duration = motion.duration
        animation.calculationMode = .linear
        animation.repeatCount = .infinity
        strip.layer.add(animation, forKey: "title.scroll")
    }
}
