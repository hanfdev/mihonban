import Foundation

// Width is the actual padded content width, including sidebar and split-window
// changes. Text accessibility sizes use a single readable column.
struct AlbumHeaderLayout {
    let contentWidth: CGFloat
    let usesColumns: Bool
    let coverSide: CGFloat
    let informationWidth: CGFloat
    let spacing: CGFloat
    let titleSize: CGFloat
    let playDiameter: CGFloat

    init(width: CGFloat, accessibility: Bool = false) {
        contentWidth = max(0, width)
        usesColumns = width >= 700 && !accessibility
        if usesColumns {
            coverSide = min(340, width * 0.36)
            spacing = min(72, width * 0.075)
            informationWidth = min(480, max(0, width - coverSide - spacing))
            titleSize = 34
            playDiameter = 72
        } else {
            coverSide = min(270, max(0, width - 72))
            spacing = 20
            informationWidth = min(520, contentWidth)
            titleSize = 26
            playDiameter = 60
        }
    }

    var width: CGFloat { usesColumns ? coverSide + spacing + informationWidth : contentWidth }
}
