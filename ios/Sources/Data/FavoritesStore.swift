import Foundation
import Observation

@MainActor @Observable
final class FavoritesStore {
    private(set) var value = Favorites.empty
    private(set) var busy = false
    var error: String?
    @ObservationIgnored private let session: SessionStore
    @ObservationIgnored private var revision = UUID()

    init(session: SessionStore) { self.session = session }

    func replace(_ value: Favorites) { self.value = value }
    func reset() { revision = UUID(); value = .empty; busy = false; error = nil }
    func contains(_ kind: FavoriteKind, id: String) -> Bool {
        (kind == .album ? value.albums : value.tracks).contains { $0.id == id }
    }

    func refresh() async throws {
        let token = revision
        let next = try await session.perform { try await $0.favorites() }
        guard token == revision else { return }
        value = next
    }

    func toggle(_ kind: FavoriteKind, id: String) async {
        guard session.isAdmin, !busy else { return }
        busy = true
        error = nil
        let token = revision
        let old = value
        let enabled = !contains(kind, id: id)
        var items = kind == .album ? value.albums : value.tracks
        if enabled { items.insert(FavoriteItem(id: id), at: 0) }
        else { items.removeAll { $0.id == id } }
        assign(kind, items: items)
        defer { if token == revision { busy = false } }
        do {
            try await session.perform { try await $0.favorite(kind, id: id, enabled: enabled) }
        } catch {
            if token == revision {
                value = old
                if !isRequestCancellation(error) { self.error = error.localizedDescription }
            }
        }
    }

    func reorder(_ kind: FavoriteKind, ids: [String]) async {
        guard session.isAdmin, !busy else { return }
        let old = value
        let items = kind == .album ? value.albums : value.tracks
        guard Set(ids).count == ids.count, Set(ids) == Set(items.map(\.id)) else { return }
        let byID = Dictionary(items.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        busy = true
        error = nil
        let token = revision
        assign(kind, items: ids.compactMap { byID[$0] })
        defer { if token == revision { busy = false } }
        do { try await session.perform { try await $0.reorderFavorites(kind, ids: ids) } }
        catch {
            if token == revision {
                value = old
                if !isRequestCancellation(error) { self.error = error.localizedDescription }
            }
        }
    }

    private func assign(_ kind: FavoriteKind, items: [FavoriteItem]) {
        if kind == .album { value.albums = items } else { value.tracks = items }
    }
}
