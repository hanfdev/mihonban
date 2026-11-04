import SwiftUI

// RYM sends rank as display text, sometimes containing both year and overall
// rankings. Only a positively identified year ranking belongs in this line.
enum RymYearRank {
    static func text(_ source: String?) -> String? {
        guard let source,
              let expression = try? NSRegularExpression(pattern: #"#\s*([0-9][0-9,]*)\s+for\s+([12][0-9]{3})\b"#, options: .caseInsensitive),
              let match = expression.firstMatch(in: source, range: NSRange(source.startIndex..., in: source)),
              let numberRange = Range(match.range(at: 1), in: source),
              let yearRange = Range(match.range(at: 2), in: source) else { return nil }
        let number = String(source[numberRange])
        guard let rank = Int(number.replacingOccurrences(of: ",", with: "")), rank > 0 else { return nil }
        return "#\(number) for \(source[yearRange])"
    }
}

struct AlbumRatingLine: View {
    let rym: RymRating
    let rating: Double
    var centered = false

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { facts; rank }.fixedSize(horizontal: true, vertical: false)
            VStack(alignment: centered ? .center : .leading, spacing: 6) {
                ViewThatFits(in: .horizontal) {
                    facts.fixedSize(horizontal: true, vertical: false)
                    VStack(alignment: centered ? .center : .leading, spacing: 4) { score; votes }
                }
                rank
            }
        }.font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
    }

    private var facts: some View { HStack(spacing: 10) { score; votes } }
    private var score: some View { RatingText(rating: rating).foregroundStyle(Theme.ink).fixedSize() }
    @ViewBuilder private var votes: some View {
        if let count = rym.votes, count > 0 {
            Text(L10n.text("rym.votes", String(count))).fixedSize(horizontal: false, vertical: true)
        }
    }
    @ViewBuilder private var rank: some View {
        if let text = RymYearRank.text(rym.rank) {
            Group {
                if let url = rym.rymUrl.flatMap({ URL(string: $0) }), url.scheme == "https" {
                    Link(text, destination: url).accessibilityHint(L10n.text("rym.page"))
                        .foregroundStyle(.secondary)
                } else { Text(text) }
            }.fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("album.yearRank")
        }
    }
}
