import Foundation

struct ArtistCredit: Codable, Hashable, Sendable {
    var name: String
    var sort: String?
}

struct Album: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var title: String
    var artist: String
    var artistSort: String?
    var artists: [ArtistCredit]?
    var year: Int?
    var trackCount: Int?
    var duration: Double?
    var genres: [String]?
    var updatedAt: Int?
    var tracks: [Track]?
    var note: String?

    var normalizedTracks: [Track] {
        (tracks ?? []).map { track in
            var copy = track
            copy.albumId = id
            copy.albumTitle = title
            if copy.artist?.isEmpty != false { copy.artist = artist }
            return copy
        }
    }
}

struct Track: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var title: String
    var duration: Double?
    var format: String?
    var disc: Int?
    var track: Int?
    var albumId: String?
    var albumTitle: String?
    var artist: String?
    var artists: [ArtistCredit]?

    var fileExtension: String {
        let value = (format ?? "mp3").lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        return ["mp3", "flac", "ogg", "oga", "opus", "m4a", "aac", "alac", "wav", "aif", "aiff"].contains(value) ? value : "audio"
    }
}

struct SessionInfo: Decodable, Sendable {
    let ok: Bool
    let role: String?
    let guest: Bool?
}

struct LibrarySnapshot: Codable, Sendable {
    var albums: [Album]
    var etag: String?
}

func timestamp(_ seconds: Double) -> String {
    let value = seconds.isFinite ? max(0, Int(seconds)) : 0
    return value >= 3600
        ? String(format: "%d:%02d:%02d", value / 3600, value / 60 % 60, value % 60)
        : String(format: "%d:%02d", value / 60, value % 60)
}
