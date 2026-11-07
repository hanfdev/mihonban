import XCTest
@testable import Mihonban

// Album edit, hide and delete against tools/fixture-server.py, whose routes
// follow the worker's validation. Each test restores the fixture afterwards.
@MainActor
final class AlbumAdminTests: XCTestCase {
    private static func resetFixture() async throws {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8766/fixture/reset")!)
        request.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    }

    private func connect(password: String) async throws -> CatalogStore {
        try await Self.resetFixture()
        addTeardownBlock { try? await Self.resetFixture() }
        let api = try APIClient(address: "http://127.0.0.1:8766")
        api.clearCookies()
        let info = try await api.login(password: password)
        let session = SessionStore()
        session.connect(api, info: info)
        let catalog = CatalogStore(session: session, favorites: FavoritesStore(session: session))
        await catalog.connect()
        XCTAssertNil(catalog.error)
        XCTAssertEqual(catalog.albums.count, 3)
        return catalog
    }

    func testAdminEditRoundTripsThroughTheService() async throws {
        let catalog = try await connect(password: "fixture-admin")
        let original = try await catalog.album("network-ogg")
        var draft = AlbumDraft(original)
        draft.title = "  Edited OGG  "
        draft.year = "2001"
        draft.credits.append(.init(name: "Guest Singer", sort: ""))
        draft.genres = "Ambient；Dub"
        draft.secondaryGenres = "dub, Drone"
        draft.descriptors = "calm"
        draft.note = "Edited **note**"
        XCTAssertNotEqual(draft, AlbumDraft(original))
        let edit = try draft.payload().get()
        XCTAssertEqual(edit.genres, ["Ambient", "Dub"], "full-width separators split too")

        try await catalog.save("network-ogg", edit: edit)
        let saved = try await catalog.album("network-ogg")
        XCTAssertEqual(saved.title, "Edited OGG")
        XCTAssertEqual(saved.year, 2001)
        XCTAssertEqual(saved.credits.map(\.name), ["Test Ensemble", "Guest Singer"])
        XCTAssertEqual(saved.genres, ["Ambient", "Dub"])
        XCTAssertEqual(saved.secondaryGenres, ["Drone"], "the service drops a secondary genre already listed as primary")
        XCTAssertEqual(saved.note, "Edited **note**")
        // The library list and its index pick up the edit, not a cached copy.
        XCTAssertEqual(catalog.albums.first { $0.id == "network-ogg" }?.title, "Edited OGG")
        XCTAssertEqual(catalog.index.albums(query: "edited", sort: .title).map(\.id), ["network-ogg"])

        // A cleared year is sent as null and clears the stored value.
        var cleared = AlbumDraft(saved)
        cleared.year = ""
        try await catalog.save("network-ogg", edit: try cleared.payload().get())
        let reloaded = try await catalog.album("network-ogg")
        XCTAssertNil(reloaded.year)
        XCTAssertEqual(reloaded.title, "Edited OGG", "unchanged fields keep their values")
    }

    func testRejectedEditLeavesLocalCopiesUnchanged() async throws {
        let catalog = try await connect(password: "fixture-admin")
        let original = try await catalog.album("network-ogg")
        var edit = try AlbumDraft(original).payload().get()
        edit.title = " "
        do {
            try await catalog.save("network-ogg", edit: edit)
            XCTFail("an empty title must be refused")
        } catch {
            XCTAssertEqual((error as? ServerError)?.status, 400)
            XCTAssertEqual(error.localizedDescription, L10n.text("mobile.inputRejected"))
        }
        XCTAssertEqual(catalog.cachedAlbum("network-ogg")?.title, original.title)
        let fresh = try await catalog.album("network-ogg", refresh: true)
        XCTAssertEqual(fresh.title, original.title)
    }

    func testListenersCannotWrite() async throws {
        let catalog = try await connect(password: "fixture-password")
        let album = try await catalog.album("network-ogg")
        let edit = try AlbumDraft(album).payload().get()
        do {
            try await catalog.save("network-ogg", edit: edit)
            XCTFail("listeners cannot edit")
        } catch { XCTAssertEqual((error as? ServerError)?.status, 403) }
        do {
            try await catalog.delete("network-ogg", files: false)
            XCTFail("listeners cannot delete")
        } catch { XCTAssertEqual((error as? ServerError)?.status, 403) }
        XCTAssertEqual(catalog.albums.count, 3, "a refused delete removes nothing locally")
    }

    func testHideAndDelete() async throws {
        let catalog = try await connect(password: "fixture-admin")
        try await catalog.setHidden("network-ogg", hidden: true)
        XCTAssertFalse(catalog.albums.contains { $0.id == "network-ogg" }, "hidden albums leave the default library")
        await catalog.setShowHidden(true)
        XCTAssertEqual(catalog.albums.first { $0.id == "network-ogg" }?.hidden, true)
        let hidden = try await catalog.album("network-ogg")
        XCTAssertEqual(hidden.hidden, true, "administrators still open hidden albums")
        try await catalog.setHidden("network-ogg", hidden: false)
        XCTAssertEqual(catalog.albums.first { $0.id == "network-ogg" }?.hidden, false)
        await catalog.setShowHidden(false)
        XCTAssertEqual(catalog.albums.count, 3)

        _ = try await catalog.album("network-flac")
        try await catalog.delete("network-flac", files: true)
        XCTAssertEqual(Set(catalog.albums.map(\.id)), ["network-mp3", "network-ogg"])
        XCTAssertNil(catalog.cachedAlbum("network-flac"))
        do {
            _ = try await catalog.album("network-flac")
            XCTFail("a deleted album is gone from the service")
        } catch { XCTAssertEqual((error as? ServerError)?.status, 404) }
    }

    func testDraftValidationMatchesTheWebEditor() throws {
        let album = Album(id: "a", title: "Title", artist: "One", artists: [ArtistCredit(name: "One", sort: nil)], year: 1999)
        var draft = AlbumDraft(album)
        XCTAssertEqual(draft.year, "1999")
        draft.year = "99"
        XCTAssertEqual(draft.payload().problem, DraftProblem(key: "importPage.invalidYear"))
        draft.year = "１９９９"
        XCTAssertEqual(draft.payload().problem, DraftProblem(key: "importPage.invalidYear"), "full-width digits are refused")
        draft.year = "1999"
        draft.credits.append(.init(name: " one ", sort: ""))
        XCTAssertEqual(draft.payload().problem, DraftProblem(key: "importPage.needMeta"), "duplicate artists ignore case")
        draft.credits.removeLast()
        draft.title = "   "
        XCTAssertEqual(draft.payload().problem, DraftProblem(key: "importPage.needMeta"))
        draft.title = String(repeating: "x", count: 1001)
        XCTAssertEqual(draft.payload().problem, DraftProblem(key: "importPage.pathTooLong"))

        draft.title = "Title"
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(try draft.payload().get())) as? [String: Any]
        XCTAssertEqual((body?["artists"] as? [[String: String]])?.first?["sort"], "", "a missing sort is sent as empty text")
        draft.year = ""
        let cleared = try JSONSerialization.jsonObject(with: JSONEncoder().encode(try draft.payload().get())) as? [String: Any]
        XCTAssertTrue(cleared?["year"] is NSNull, "a cleared year is sent as null")
    }
}

private extension Result {
    var problem: Failure? {
        if case .failure(let value) = self { return value }
        return nil
    }
}
