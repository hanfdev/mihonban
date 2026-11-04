import Foundation

struct RymRating: Codable, Hashable, Sendable {
    var rating: Double?
    var votes: Int?
    var rank: String?
    var rymUrl: String?
    var genres: [String]?
    var secondaryGenres: [String]?
    var descriptors: [String]?

    var validRating: Double? {
        guard let rating, rating.isFinite, (0...5).contains(rating) else { return nil }
        return rating
    }

    var weighted: Double {
        guard let rating = validRating else { return -.infinity }
        if rating <= 3.3 { return rating }
        let count = Double(max(0, votes ?? 0))
        return (rating * count + 3.3 * 50) / (count + 50)
    }
}

struct SimilarAlbum: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var artist: String?
    var title: String
    var year: Int?
    var rating: Double?
    var votes: Int?
}

struct Artist: Codable, Hashable, Identifiable, Sendable {
    var name: String
    var sort: String?
    var note: String?
    var hasAvatar: Bool?
    var hasBio: Bool?
    var aliases: [String]?
    var featuredTrackCount: Int?
    var visibleFeaturedTrackCount: Int?
    var id: String { name }
}

struct FavoriteItem: Codable, Hashable, Identifiable, Sendable {
    let id: String
    var ts: Int?
    var order: Int?
}

struct Favorites: Codable, Sendable {
    var albums: [FavoriteItem]
    var tracks: [FavoriteItem]
    static let empty = Favorites(albums: [], tracks: [])
}

enum FavoriteKind: String, CaseIterable, Codable, Sendable { case album, track }

struct CatalogSnapshot: Codable, Sendable {
    var albums: [Album]
    var tracks: [Track]?
    var artists: [Artist]
    var albumETag: String?
    var trackETag: String?
    var favorites: Favorites
}

enum AlbumSort: String, CaseIterable, Codable, Sendable {
    case rating, ratingRaw, artist, title, yearNew, yearOld, added
    var label: String { "library.sort" + rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}

enum TrackSort: String, CaseIterable, Codable, Sendable {
    case title, artist, album, yearNew, yearOld, added
    var label: String { "tracks.sort" + rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}

enum ArtistSort: String, CaseIterable, Codable, Sendable {
    case count, name, added
    var label: String { "artists.sort" + rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}

struct AlbumFilters: Equatable, Sendable {
    var genre = ""
    var decade: Int?
    var artist = ""
    var minimumRating: Double = 0
    var isActive: Bool { !genre.isEmpty || decade != nil || !artist.isEmpty || minimumRating > 0 }
    var count: Int { [!genre.isEmpty, decade != nil, !artist.isEmpty, minimumRating > 0].filter { $0 }.count }

    func matches(_ album: Album) -> Bool {
        if minimumRating > 0 && (album.rym?.validRating ?? 0) < minimumRating { return false }
        if let decade, (album.year ?? 0) / 10 * 10 != decade { return false }
        if !artist.isEmpty && !album.credits.contains(where: { $0.name == artist }) { return false }
        let genres = (album.genres ?? []) + (album.secondaryGenres ?? [])
        let selected = GenreName.key(genre)
        return selected.isEmpty || genres.contains { GenreName.key($0) == selected }
    }
}

struct ArtistSummary: Identifiable, Sendable {
    var artist: Artist
    var albumCount: Int
    var featuredCount: Int
    var latest: Int
    var genres: Set<String>
    var years: [Int]
    var id: String { artist.id }
}
