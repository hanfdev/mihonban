import SwiftUI

// Measure controls and place the artwork in the same layout pass. Publishing
// a measured height through @State causes a second visible layout at arrival.
struct NowPlayingStage: Layout {
    let viewport: CGSize
    let isTablet: Bool
    var centerY: CGFloat? = nil

    private struct Metrics {
        let cover: CGFloat
        let controls: CGSize
        let gap: CGFloat
        let top: CGFloat
        let columns: Bool
        var width: CGFloat { columns ? cover + gap + controls.width : max(cover, controls.width) }
        var height: CGFloat { columns ? max(cover, controls.height) : cover + gap + controls.height }
    }

    private func measure(_ subviews: Subviews) -> Metrics {
        let columns = NowPlayingLayout.usesColumns(viewport)
        let initialCover = NowPlayingLayout.coverSide(in: viewport, controlsHeight: 0, isTablet: isTablet)
        let width = NowPlayingLayout.controlsWidth(in: viewport, coverSide: initialCover, isTablet: isTablet)
        let controls = subviews[1].sizeThatFits(ProposedViewSize(width: width, height: nil))
        let cover = NowPlayingLayout.coverSide(in: viewport, controlsHeight: controls.height, isTablet: isTablet)
        let gap = columns ? NowPlayingLayout.columnSpacing(in: viewport, isTablet: isTablet)
            : NowPlayingLayout.coverSpacing(in: viewport, isTablet: isTablet)
        return Metrics(cover: cover, controls: CGSize(width: width, height: controls.height), gap: gap,
            top: NowPlayingLayout.stageTop(in: viewport, coverSide: cover,
                controlsHeight: controls.height, isTablet: isTablet, centerY: centerY), columns: columns)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let metrics = measure(subviews)
        return CGSize(width: viewport.width,
            height: max(isTablet ? viewport.height : 0, metrics.top + metrics.height + NowPlayingLayout.bottomInset))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let metrics = measure(subviews)
        let left = bounds.midX - metrics.width / 2
        let top = bounds.minY + metrics.top
        if metrics.columns {
            subviews[0].place(at: CGPoint(x: left, y: top + (isTablet ? (metrics.height - metrics.cover) / 2 : 0)),
                anchor: .topLeading, proposal: ProposedViewSize(width: metrics.cover, height: metrics.cover))
            subviews[1].place(at: CGPoint(x: left + metrics.cover + metrics.gap,
                y: top + (isTablet ? (metrics.height - metrics.controls.height) / 2 : 0)),
                anchor: .topLeading, proposal: ProposedViewSize(metrics.controls))
        } else {
            subviews[0].place(at: CGPoint(x: bounds.midX - metrics.cover / 2, y: top),
                anchor: .topLeading, proposal: ProposedViewSize(width: metrics.cover, height: metrics.cover))
            subviews[1].place(at: CGPoint(x: bounds.midX - metrics.controls.width / 2,
                y: top + metrics.cover + metrics.gap), anchor: .topLeading, proposal: ProposedViewSize(metrics.controls))
        }
    }
}

// Geometry is the safe content area below the player's custom header.
// Do not subtract the header or safe-area insets a second time here.
enum NowPlayingLayout {
    static let horizontalInset: CGFloat = 28
    static let topInset: CGFloat = 12
    static let bottomInset: CGFloat = 20
    static let coverSpacing: CGFloat = 24
    static let controlSpacing: CGFloat = 16
    static let columnSpacing: CGFloat = 40

    enum ControlStyle: Equatable {
        case compact, tablet, tabletPortrait

        var titleSize: CGFloat { self == .compact ? 27 : self == .tabletPortrait ? 36 : 34 }
        var artistSize: CGFloat { self == .compact ? 17 : self == .tabletPortrait ? 20 : 19 }
        var timeSize: CGFloat { self == .compact ? 11 : 13 }
        var playDiameter: CGFloat { self == .compact ? 70 : self == .tabletPortrait ? 96 : 84 }
        var skipSize: CGFloat { self == .compact ? 20 : 25 }
        var spacing: CGFloat { self == .compact ? NowPlayingLayout.controlSpacing : self == .tabletPortrait ? 28 : 24 }
        var transportWidth: CGFloat { self == .compact ? .infinity : self == .tabletPortrait ? 560 : 420 }
    }

    // Window dimensions, rather than the device alone, decide whether tablet
    // typography and spacing fit. Narrow Stage Manager windows stay compact.
    static func controlStyle(in size: CGSize, isTablet: Bool) -> ControlStyle {
        guard isTablet && size.width >= 600 && size.height >= 500 else { return .compact }
        return usesColumns(size) ? .tablet : .tabletPortrait
    }

    static func usesColumns(_ size: CGSize) -> Bool { size.width > 700 && size.width > size.height }

    static func columnSpacing(in size: CGSize, isTablet: Bool) -> CGFloat {
        controlStyle(in: size, isTablet: isTablet) == .tablet ? min(88, max(44, size.width * 0.06)) : columnSpacing
    }

    static func coverSpacing(in size: CGSize, isTablet: Bool) -> CGFloat {
        let style = controlStyle(in: size, isTablet: isTablet)
        return style == .compact ? coverSpacing : style == .tabletPortrait ? 44 : 32
    }

    private static func tabletStageWidth(_ size: CGSize) -> CGFloat {
        // At full width, leave generous outer margins. Smaller windows reclaim
        // that space before narrowing the title and the transport controls.
        min(1120, max(min(720, contentWidth(size)), size.width * 0.78))
    }

    static func contentWidth(_ size: CGSize) -> CGFloat {
        max(0, size.width - 2 * horizontalInset)
    }

    static func stageTop(in size: CGSize, coverSide: CGFloat, controlsHeight: CGFloat,
                         isTablet: Bool, centerY: CGFloat? = nil) -> CGFloat {
        guard isTablet else { return topInset }
        let stageHeight = usesColumns(size) ? max(coverSide, controlsHeight)
            : coverSide + coverSpacing(in: size, isTablet: true) + controlsHeight
        // Center the complete composition on the window, independently of the
        // header's height. Preserve a scrollable top when large text cannot fit.
        let desired = (centerY ?? size.height / 2) - stageHeight / 2
        return max(topInset, min(desired, size.height - stageHeight - bottomInset))
    }

    static func coverSide(in size: CGSize, controlsHeight: CGFloat, isTablet: Bool = false) -> CGFloat {
        let width = contentWidth(size)
        let tablet = controlStyle(in: size, isTablet: isTablet) != .compact
        if usesColumns(size) {
            if tablet {
                let columns = tabletStageWidth(size) - columnSpacing(in: size, isTablet: isTablet)
                return min(columns / 2.35, max(0, size.height - topInset - bottomInset))
            }
            return min(440, max(0, (width - columnSpacing) / 2), max(0, size.height - topInset - bottomInset))
        }
        let room = size.height - max(0, controlsHeight) - topInset - bottomInset - coverSpacing(in: size, isTablet: isTablet)
        // Very large text may scroll, but the cover never grows wider than the
        // content area and remains recognisable above the controls.
        let preferred = tablet ? min(640, size.width * 0.70) : 500
        return min(preferred, width, max(min(160, width), room))
    }

    static func controlsWidth(in size: CGSize, coverSide: CGFloat, isTablet: Bool = false) -> CGFloat {
        if usesColumns(size) {
            if controlStyle(in: size, isTablet: isTablet) == .tablet {
                return max(0, tabletStageWidth(size) - coverSide - columnSpacing(in: size, isTablet: isTablet))
            }
            return min(480, max(0, contentWidth(size) - coverSide - columnSpacing))
        }
        // Portrait has a broad control area below the independently sized cover,
        // rather than stacking every element inside one narrow artwork column.
        let limit: CGFloat = controlStyle(in: size, isTablet: isTablet) == .tabletPortrait ? min(760, size.width * 0.82) : 500
        return min(limit, contentWidth(size))
    }
}
