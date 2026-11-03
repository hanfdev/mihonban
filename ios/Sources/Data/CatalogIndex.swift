import Foundation

// Precompute searchable text when the catalog changes, not on every keystroke.
struct CatalogIndex: Sendable {
    private(set) var albums: [Album]
    private(set) var tracks: [Track]
    private(set) var artists: [ArtistSummary]
    private var albumText: [String: String]
    private var trackText: [String: String]
    private var artistText: [String: String]

    init(albums: [Album], tracks: [Track], artists: [Artist], includeHidden: Bool) {
        self.albums = albums.filter { includeHidden || $0.hidden != true }
        self.tracks = tracks.filter { includeHidden || $0.hidden != true }
        var metadata: [String: Artist] = [:]
        artists.forEach { metadata[$0.name] = $0 }
        var summaries: [String: ArtistSummary] = [:]
        for album in self.albums {
            for credit in album.credits {
                var summary = summaries[credit.name] ?? ArtistSummary(
                    artist: metadata[credit.name] ?? Artist(name: credit.name, sort: credit.sort),
                    albumCount: 0, featuredCount: 0, latest: 0, genres: [], years: [])
                summary.albumCount += 1
                summary.latest = max(summary.latest, album.updatedAt ?? 0)
                summary.genres.formUnion(album.genres ?? [])
                if let year = album.year, year > 0 { summary.years.append(year) }
                summaries[credit.name] = summary
            }
        }
        for artist in artists {
            let count = includeHidden ? artist.featuredTrackCount ?? 0 : artist.visibleFeaturedTrackCount ?? 0
            if var summary = summaries[artist.name] {
                summary.featuredCount = count
                summaries[artist.name] = summary
            } else if count > 0 {
                summaries[artist.name] = ArtistSummary(artist: artist, albumCount: 0, featuredCount: count,
                    latest: 0, genres: [], years: [])
            }
        }
        self.artists = Array(summaries.values)
        albumText = [:]; trackText = [:]; artistText = [:]
        for album in self.albums {
            let text = [album.title, SearchNormalizer.credits(album.credits),
                        ((album.genres ?? []) + (album.secondaryGenres ?? [])).joined(separator: " ")].joined(separator: " ")
            albumText[album.id] = SearchNormalizer.text(text)
        }
        for track in self.tracks {
            trackText[track.id] = SearchNormalizer.text([track.title, track.albumTitle ?? "",
                SearchNormalizer.credits(track.credits)].joined(separator: " "))
        }
        for summary in self.artists {
            let artist = summary.artist
            artistText[artist.id] = SearchNormalizer.text([artist.name, artist.sort ?? "",
                (artist.aliases ?? []).joined(separator: " "), SearchNormalizer.aliases(for: artist.name)].joined(separator: " "))
        }
    }

    func albums(query: String, filters: AlbumFilters = .init(), sort: AlbumSort = .rating) -> [Album] {
        let needle = SearchNormalizer.text(query.trimmingCharacters(in: .whitespacesAndNewlines))
        return albums.filter { filters.matches($0) && (needle.isEmpty || albumText[$0.id]?.contains(needle) == true) }
            .sorted { Self.compare($0, $1, sort: sort) }
    }

    func tracks(query: String, sort: TrackSort = .title) -> [Track] {
        let needle = SearchNormalizer.text(query.trimmingCharacters(in: .whitespacesAndNewlines))
        return tracks.filter { needle.isEmpty || trackText[$0.id]?.contains(needle) == true }
            .sorted { Self.compare($0, $1, sort: sort) }
    }

    func artists(query: String, genre: String = "", sort: ArtistSort = .count) -> [ArtistSummary] {
        let needle = SearchNormalizer.text(query.trimmingCharacters(in: .whitespacesAndNewlines))
        return artists.filter {
            (needle.isEmpty || artistText[$0.id]?.contains(needle) == true) &&
            (genre.isEmpty || $0.genres.contains { $0.caseInsensitiveCompare(genre) == .orderedSame })
        }.sorted { a, b in
            switch sort {
            case .count:
                if a.albumCount != b.albumCount { return a.albumCount > b.albumCount }
                if a.featuredCount != b.featuredCount { return a.featuredCount > b.featuredCount }
            case .added:
                if a.latest != b.latest { return a.latest > b.latest }
            case .name: break
            }
            return Self.less(a.artist.sort?.nonEmpty ?? a.artist.name, b.artist.sort?.nonEmpty ?? b.artist.name)
        }
    }

    static func compare(_ a: Album, _ b: Album, sort: AlbumSort) -> Bool {
        switch sort {
        case .rating:
            let x = a.rym?.weighted ?? -.infinity, y = b.rym?.weighted ?? -.infinity
            if x != y { return x > y }
            if (a.rym?.votes ?? 0) != (b.rym?.votes ?? 0) { return (a.rym?.votes ?? 0) > (b.rym?.votes ?? 0) }
            if (a.rym?.validRating ?? -1) != (b.rym?.validRating ?? -1) { return (a.rym?.validRating ?? -1) > (b.rym?.validRating ?? -1) }
        case .ratingRaw:
            if (a.rym?.validRating ?? -1) != (b.rym?.validRating ?? -1) { return (a.rym?.validRating ?? -1) > (b.rym?.validRating ?? -1) }
            if (a.rym?.votes ?? 0) != (b.rym?.votes ?? 0) { return (a.rym?.votes ?? 0) > (b.rym?.votes ?? 0) }
        case .artist:
            let x = a.artistSort?.nonEmpty ?? a.artist, y = b.artistSort?.nonEmpty ?? b.artist
            if x != y { return less(x, y) }
            if a.year != b.year { return (a.year ?? 0) < (b.year ?? 0) }
        case .yearNew:
            if a.year != b.year { return (a.year ?? 0) > (b.year ?? 0) }
        case .yearOld:
            if a.year != b.year { return (a.year ?? 9999) < (b.year ?? 9999) }
        case .added:
            if a.updatedAt != b.updatedAt { return (a.updatedAt ?? 0) > (b.updatedAt ?? 0) }
        case .title: break
        }
        return a.title == b.title ? a.id < b.id : less(a.title, b.title)
    }

    static func compare(_ a: Track, _ b: Track, sort: TrackSort) -> Bool {
        switch sort {
        case .artist:
            let x = a.artistSort?.nonEmpty ?? a.artist ?? "", y = b.artistSort?.nonEmpty ?? b.artist ?? ""
            if x != y { return less(x, y) }
            if a.albumTitle != b.albumTitle { return less(a.albumTitle ?? "", b.albumTitle ?? "") }
            if a.track != b.track { return (a.track ?? 0) < (b.track ?? 0) }
        case .album:
            if a.albumTitle != b.albumTitle { return less(a.albumTitle ?? "", b.albumTitle ?? "") }
            if a.disc != b.disc { return (a.disc ?? 1) < (b.disc ?? 1) }
            if a.track != b.track { return (a.track ?? 0) < (b.track ?? 0) }
        case .yearNew:
            if a.year != b.year { return (a.year ?? 0) > (b.year ?? 0) }
        case .yearOld:
            if a.year != b.year { return (a.year ?? 9999) < (b.year ?? 9999) }
        case .added:
            if a.addedAt != b.addedAt { return (a.addedAt ?? 0) > (b.addedAt ?? 0) }
        case .title: break
        }
        return a.title == b.title ? a.id < b.id : less(a.title, b.title)
    }

    static func less(_ a: String, _ b: String) -> Bool {
        a.compare(b, options: [.caseInsensitive, .numeric], locale: Locale(identifier: "ja_JP")) == .orderedAscending
    }
}

extension String {
    var nonEmpty: String? { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self }
}
