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
    var secondaryGenres: [String]?
    var rym: RymRating?
    var hidden: Bool?
    var createdAt: Int?
    var folder: String?
    var storageId: String?
    var images: [String]?
    var similar: [SimilarAlbum]?

    // Match the web catalog: unknown import dates sort last, never by edit time.
    var addedTime: Int { max(0, createdAt ?? 0) }

    var credits: [ArtistCredit] {
        if let artists, !artists.isEmpty { return artists }
        return [ArtistCredit(name: artist, sort: artistSort)]
    }

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
    var artistSort: String?
    var year: Int?
    var addedAt: Int?
    var hidden: Bool?
    var bitrate: Double?
    var size: Int64?
    var path: String?
    var hasCustomArtists: Bool?

    var credits: [ArtistCredit] {
        if let artists, !artists.isEmpty { return artists }
        return [ArtistCredit(name: artist ?? "", sort: artistSort)]
    }

    var fileExtension: String {
        let value = (format ?? "mp3").lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        return ["mp3", "flac", "ogg", "oga", "opus", "m4a", "aac", "alac", "wav", "aif", "aiff"].contains(value) ? value : "audio"
    }
}

// Track lists come straight from SQLite rows, where `hidden` is 0 or 1 rather
// than a JSON boolean. Decode both, so a numeric flag never fails a whole list.
extension Track {
    enum CodingKeys: String, CodingKey {
        case id, title, duration, format, disc, track, albumId, albumTitle, artist, artists
        case artistSort, year, addedAt, hidden, bitrate, size, path, hasCustomArtists
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        duration = try? c.decodeIfPresent(Double.self, forKey: .duration)
        format = try? c.decodeIfPresent(String.self, forKey: .format)
        disc = try? c.decodeIfPresent(Int.self, forKey: .disc)
        track = try? c.decodeIfPresent(Int.self, forKey: .track)
        albumId = try? c.decodeIfPresent(String.self, forKey: .albumId)
        albumTitle = try? c.decodeIfPresent(String.self, forKey: .albumTitle)
        artist = try? c.decodeIfPresent(String.self, forKey: .artist)
        artists = try? c.decodeIfPresent([ArtistCredit].self, forKey: .artists)
        artistSort = try? c.decodeIfPresent(String.self, forKey: .artistSort)
        year = try? c.decodeIfPresent(Int.self, forKey: .year)
        addedAt = try? c.decodeIfPresent(Int.self, forKey: .addedAt)
        hidden = Self.flag(c, .hidden)
        bitrate = try? c.decodeIfPresent(Double.self, forKey: .bitrate)
        size = try? c.decodeIfPresent(Int64.self, forKey: .size)
        path = try? c.decodeIfPresent(String.self, forKey: .path)
        hasCustomArtists = Self.flag(c, .hasCustomArtists)
    }

    private static func flag(_ c: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> Bool? {
        if let value = try? c.decodeIfPresent(Bool.self, forKey: key) { return value }
        if let value = try? c.decodeIfPresent(Int.self, forKey: key) { return value != 0 }
        return nil
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
