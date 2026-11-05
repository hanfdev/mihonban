import SwiftUI

// Geometry is the safe content area supplied by NavigationStack. Do not
// subtract navigation bars or safe-area insets a second time here.
enum NowPlayingLayout {
    static let horizontalInset: CGFloat = 28
    static let topInset: CGFloat = 12
    static let bottomInset: CGFloat = 20
    static let coverSpacing: CGFloat = 24
    static let controlSpacing: CGFloat = 16
    static let columnSpacing: CGFloat = 40

    enum ControlStyle: Equatable {
        case compact, tablet

        var titleSize: CGFloat { self == .tablet ? 34 : 27 }
        var artistSize: CGFloat { self == .tablet ? 19 : 17 }
        var timeSize: CGFloat { self == .tablet ? 13 : 11 }
        var playDiameter: CGFloat { self == .tablet ? 84 : 70 }
        var skipSize: CGFloat { self == .tablet ? 25 : 20 }
        var spacing: CGFloat { self == .tablet ? 24 : NowPlayingLayout.controlSpacing }
        var transportWidth: CGFloat { self == .tablet ? 420 : .infinity }
    }

    // Window dimensions, rather than the device alone, decide whether tablet
    // typography and spacing fit. Narrow Stage Manager windows stay compact.
    static func controlStyle(in size: CGSize, isTablet: Bool) -> ControlStyle {
        isTablet && size.width >= 600 && size.height >= 500 ? .tablet : .compact
    }

    static func usesColumns(_ size: CGSize) -> Bool { size.width > 700 && size.width > size.height }

    static func columnSpacing(in size: CGSize, isTablet: Bool) -> CGFloat {
        controlStyle(in: size, isTablet: isTablet) == .tablet ? min(88, max(44, size.width * 0.06)) : columnSpacing
    }

    static func coverSpacing(in size: CGSize, isTablet: Bool) -> CGFloat {
        controlStyle(in: size, isTablet: isTablet) == .tablet ? 32 : coverSpacing
    }

    private static func tabletStageWidth(_ size: CGSize) -> CGFloat {
        // At full width, leave generous outer margins. Smaller windows reclaim
        // that space before narrowing the title and the transport controls.
        min(1120, max(min(720, contentWidth(size)), size.width * 0.78))
    }

    static func contentWidth(_ size: CGSize) -> CGFloat {
        max(0, size.width - 2 * horizontalInset)
    }

    static func coverSide(in size: CGSize, controlsHeight: CGFloat, isTablet: Bool = false) -> CGFloat {
        let width = contentWidth(size)
        let tablet = controlStyle(in: size, isTablet: isTablet) == .tablet
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
        return min(tablet ? 460 : 500, width, max(min(160, width), room))
    }

    static func controlsWidth(in size: CGSize, coverSide: CGFloat, isTablet: Bool = false) -> CGFloat {
        if usesColumns(size) {
            if controlStyle(in: size, isTablet: isTablet) == .tablet {
                return max(0, tabletStageWidth(size) - coverSide - columnSpacing(in: size, isTablet: isTablet))
            }
            return min(480, max(0, contentWidth(size) - coverSide - columnSpacing))
        }
        let limit: CGFloat = controlStyle(in: size, isTablet: isTablet) == .tablet ? 460 : 500
        return min(limit, contentWidth(size))
    }
}
