import Foundation
import Observation

struct TrackListingRequest: Equatable, Sendable {
    let revision: UUID
    let query: String
    let filters: AlbumFilters
    let sort: TrackSort
}

struct TrackListingResult: Sendable {
    let tracks: [Track]
    let positions: [String: Int]
    #if DEBUG
    let buildID = UUID()
    let builtOnMainThread = Thread.isMainThread
    #endif

    nonisolated static func build(index: CatalogIndex, request: TrackListingRequest) -> Self {
        let tracks = index.tracks(query: request.query, filters: request.filters, sort: request.sort)
        return Self(tracks: tracks, positions: Dictionary(tracks.enumerated().lazy.map { ($0.element.id, $0.offset) },
            uniquingKeysWith: { first, _ in first }))
    }
}

// Keep the last list visible while work runs away from the UI executor. A
// revision/query key avoids re-sorting when returning to the same tab.
@MainActor @Observable
final class TrackListing {
    private(set) var result = TrackListingResult(tracks: [], positions: [:])
    private(set) var ready = false
    private(set) var loading = false
    @ObservationIgnored private var completed: TrackListingRequest?
    @ObservationIgnored private var generation = UUID()

    func update(index: CatalogIndex, request: TrackListingRequest) async {
        let token = UUID()
        generation = token
        guard completed != request else { loading = false; return }
        loading = true
        defer { if generation == token { loading = false } }
        do {
            // Debounce typing without delaying a first empty-query tab opening.
            if !request.query.isEmpty { try await Task.sleep(for: .milliseconds(120)) }
            try Task.checkCancellation()
            let work = Task.detached(priority: .userInitiated) {
                try Task.checkCancellation()
                let result = TrackListingResult.build(index: index, request: request)
                try Task.checkCancellation()
                return result
            }
            let next = try await withTaskCancellationHandler { try await work.value } onCancel: { work.cancel() }
            try Task.checkCancellation()
            guard generation == token else { return }
            result = next
            completed = request
            ready = true
        } catch {
            // Cancellation keeps the previous list and cannot publish stale work.
        }
    }
}
