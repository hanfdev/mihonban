import Foundation

struct GenreOption: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
}

// Filter identity is independent of capitalization and incidental whitespace.
// Do not fold accents, punctuation or synonyms: those may identify other genres.
enum GenreName {
    static func key(_ value: String) -> String {
        cleaned(value).folding(options: .caseInsensitive, locale: Locale(identifier: "en_US_POSIX"))
    }

    static func options<S: Sequence>(_ values: S) -> [GenreOption] where S.Element == String {
        var groups: [String: [String: Int]] = [:]
        for value in values {
            let title = cleaned(value)
            guard !title.isEmpty else { continue }
            groups[key(title), default: [:]][title, default: 0] += 1
        }
        return groups.map { id, spellings in
            // Keep the most common original spelling, including acronyms. Ties
            // use a fixed order so server ordering never changes the menu label.
            let title = spellings.keys.sorted {
                let a = spellings[$0, default: 0], b = spellings[$1, default: 0]
                return a == b ? $0 < $1 : a > b
            }.first ?? id
            return GenreOption(id: id, title: title)
        }.sorted { CatalogIndex.less($0.title, $1.title) }
    }

    private static func cleaned(_ value: String) -> String {
        value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            .precomposedStringWithCanonicalMapping
    }
}
