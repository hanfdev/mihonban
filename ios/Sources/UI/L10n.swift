import Foundation

enum L10n {
    private static let catalogs: [String: [String: String]] = {
        guard let url = Bundle.main.url(forResource: "Localizations", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let catalogs = try? JSONDecoder().decode([String: [String: String]].self, from: data) else { return [:] }
        return catalogs
    }()

    static let language: String = {
        Bundle.preferredLocalizations(from: ["en", "ja", "ko", "fr", "es", "zh-Hans", "zh-Hant"]).first ?? "en"
    }()

    static func text(_ key: String, _ values: String...) -> String {
        var value = catalogs[language]?[key] ?? catalogs["en"]?[key] ?? key
        for (index, replacement) in values.enumerated() { value = value.replacingOccurrences(of: "{\(index)}", with: replacement) }
        return value
    }
}
