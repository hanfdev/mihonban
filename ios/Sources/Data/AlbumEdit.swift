import Foundation

// The body of PATCH /api/album/:id as the web editor sends it. Every field is
// written, so a cleared year is sent as null rather than left unchanged.
struct AlbumEdit: Encodable, Sendable {
    var title: String
    var year: Int?
    var artists: [ArtistCredit]
    var genres: [String]
    var secondaryGenres: [String]
    var descriptors: [String]
    var note: String

    private enum CodingKeys: String, CodingKey { case title, year, artists, genres, secondaryGenres, descriptors, note }
    private struct Credit: Encodable { var name: String; var sort: String }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(year, forKey: .year)
        try c.encode(artists.map { Credit(name: $0.name, sort: $0.sort ?? "") }, forKey: .artists)
        try c.encode(genres, forKey: .genres)
        try c.encode(secondaryGenres, forKey: .secondaryGenres)
        try c.encode(descriptors, forKey: .descriptors)
        try c.encode(note, forKey: .note)
    }
}

// Form state for the album editor. Validation mirrors the web EditDialog so
// both clients reject the same input before it reaches the service.
struct AlbumDraft: Equatable {
    struct Credit: Identifiable, Equatable {
        let id = UUID()
        var name: String
        var sort: String
        static func == (a: Credit, b: Credit) -> Bool { a.name == b.name && a.sort == b.sort }
    }

    var title: String
    var year: String
    var credits: [Credit]
    var genres: String
    var secondaryGenres: String
    var descriptors: String
    var note: String

    init(_ album: Album) {
        title = album.title
        year = album.year.map(String.init) ?? ""
        credits = album.credits.map { Credit(name: $0.name, sort: $0.sort ?? "") }
        genres = (album.genres ?? album.rym?.genres ?? []).joined(separator: "; ")
        secondaryGenres = (album.secondaryGenres ?? album.rym?.secondaryGenres ?? []).joined(separator: "; ")
        descriptors = (album.rym?.descriptors ?? []).joined(separator: "; ")
        note = album.note ?? ""
    }

    // Lists accept the web separators plus their full-width forms from CJK keyboards.
    static func list(_ text: String) -> [String] {
        text.split(whereSeparator: { ";,；，、".contains($0) })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    // Returns the payload, or the localization key of the first problem.
    func payload() -> Result<AlbumEdit, DraftProblem> {
        let artists = credits.map {
            ArtistCredit(name: $0.name.trimmingCharacters(in: .whitespacesAndNewlines),
                         sort: $0.sort.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let keys = Set(artists.map { $0.name.lowercased() })
        if artists.isEmpty || artists.contains(where: { $0.name.isEmpty }) || keys.count != artists.count || name.isEmpty {
            return .failure(DraftProblem(key: "importPage.needMeta"))
        }
        let yearText = year.trimmingCharacters(in: .whitespacesAndNewlines)
        var value: Int?
        if !yearText.isEmpty {
            guard yearText.count == 4, yearText.allSatisfy({ $0.isASCII && $0.isNumber }), let parsed = Int(yearText), parsed >= 1 else {
                return .failure(DraftProblem(key: "importPage.invalidYear"))
            }
            value = parsed
        }
        let primary = Self.list(genres), secondary = Self.list(secondaryGenres), tags = Self.list(descriptors)
        let creditText = artists.map(\.name).joined(separator: " & ")
        if artists.count > 24 || creditText.count > 500 || artists.contains(where: { $0.name.count > 500 || ($0.sort ?? "").count > 500 })
            || name.count > 1000 || note.count > 200_000 || primary.count > 200 || secondary.count > 200 || tags.count > 500
            || (primary + secondary).contains(where: { $0.count > 200 }) || tags.contains(where: { $0.count > 500 }) {
            return .failure(DraftProblem(key: "importPage.pathTooLong"))
        }
        return .success(AlbumEdit(title: name, year: value, artists: artists, genres: primary,
                                  secondaryGenres: secondary, descriptors: tags, note: note))
    }
}

struct DraftProblem: Error, Equatable {
    let key: String
}

extension APIClient {
    func editAlbum(_ id: String, _ edit: AlbumEdit) async throws {
        let _: SuccessResponse = try await request(["api", "album", id], method: "PATCH", body: JSONEncoder().encode(edit))
    }

    func hideAlbum(_ id: String, hidden: Bool) async throws {
        let _: SuccessResponse = try await request(["api", "album", id, "hide"], method: "POST",
                                                   body: JSONEncoder().encode(["hidden": hidden]))
    }

    // Removes the album from the catalog; `files` also moves its storage folder to the recycle bin.
    func deleteAlbum(_ id: String, files: Bool) async throws {
        let _: SuccessResponse = try await request(["api", "album", id], method: "DELETE",
            query: files ? [URLQueryItem(name: "files", value: "1")] : [])
    }
}
