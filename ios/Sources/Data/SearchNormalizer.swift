import Foundation

// Generated resources share the web client's explicit Han mapping and verified
// aliases. Do not transliterate artist display names or split band names on '&'.
enum SearchNormalizer {
    private struct Alias: Decodable, Sendable { let name: String?; let sort: String? }
    private struct Catalog: Decodable { let aliases: [String: Alias?] }
    private static let aliasMap: [String: String] = {
        guard let url = Bundle.main.url(forResource: "ArtistAliases", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let catalog = try? JSONDecoder().decode(Catalog.self, from: data) else { return [:] }
        var result: [String: String] = [:]
        for (key, value) in catalog.aliases {
            if let name = value?.name { result[name, default: ""] += " " + key + " " + (value?.sort ?? "") }
        }
        return result
    }()
    private static let hanMap: [Unicode.Scalar: String] = {
        guard let url = Bundle.main.url(forResource: "SearchCharacters", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let strings = try? JSONDecoder().decode([String: String].self, from: data),
              let from = strings["from"], let to = strings["to"] else { return [:] }
        return Dictionary(zip(from.unicodeScalars, to.unicodeScalars).map { ($0, String($1)) },
                          uniquingKeysWith: { first, _ in first })
    }()

    static func aliases(for name: String) -> String { aliasMap[name] ?? "" }
    static func credits(_ credits: [ArtistCredit]) -> String {
        credits.map { [$0.name, $0.sort ?? "", aliases(for: $0.name)].joined(separator: " ") }.joined(separator: " ")
    }

    static func text(_ text: String) -> String {
        let folded = text.precomposedStringWithCompatibilityMapping
            .folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        let kana = folded.applyingTransform(.hiraganaToKatakana, reverse: true) ?? folded
        return kana.unicodeScalars.map { hanMap[$0] ?? String($0) }.joined()
            .replacingOccurrences(of: "×", with: "x")
    }
}
