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

    // The shared web catalogs only carry plural counts, so a count of one uses
    // the singular strings added for the app.
    static func count(_ key: String, _ value: Int) -> String {
        if value == 1, let singular = ["count.tracks": "mobile.oneTrack", "count.albums": "mobile.oneAlbum"][key] {
            return text(singular)
        }
        return text(key, String(value))
    }
}
