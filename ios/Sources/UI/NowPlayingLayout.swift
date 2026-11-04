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

    static func usesColumns(_ size: CGSize) -> Bool { size.width > 700 && size.width > size.height }

    static func contentWidth(_ size: CGSize) -> CGFloat {
        max(0, size.width - 2 * horizontalInset)
    }

    static func coverSide(in size: CGSize, controlsHeight: CGFloat) -> CGFloat {
        let width = contentWidth(size)
        if usesColumns(size) {
            return min(440, max(0, (width - columnSpacing) / 2), max(0, size.height - topInset - bottomInset))
        }
        let room = size.height - max(0, controlsHeight) - topInset - bottomInset - coverSpacing
        // Very large text may scroll, but the cover never grows wider than the
        // content area and remains recognisable above the controls.
        return min(500, width, max(min(160, width), room))
    }

    static func controlsWidth(in size: CGSize, coverSide: CGFloat) -> CGFloat {
        usesColumns(size) ? min(480, max(0, contentWidth(size) - coverSide - columnSpacing))
                          : min(500, contentWidth(size))
    }
}
