import Foundation
import Observation

struct SearchListingRequest: Equatable, Sendable {
    let revision: UUID
    let query: String

    init(revision: UUID, query: String) {
        self.revision = revision
        self.query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct SearchListingResult: Sendable {
    static let previewLimit = 8
    var artists: [ArtistSummary] = []
    var albums: [Album] = []
    var tracks: [Track] = []
    var artistCount = 0
    var albumCount = 0
    var trackCount = 0
    var recentAlbums: [Album] = []
    #if DEBUG
    let buildID = UUID()
    let builtOnMainThread = Thread.isMainThread
    var buildDuration = Duration.zero
    #endif

    var isEmpty: Bool { artistCount == 0 && albumCount == 0 && trackCount == 0 }

    nonisolated static func build(index: CatalogIndex, request: SearchListingRequest) throws -> Self {
        #if DEBUG
        let start = ContinuousClock.now
        #endif
        try Task.checkCancellation()
        var result = Self()
        if request.query.isEmpty {
            result.recentAlbums = Array(index.albums(query: "", sort: .added).prefix(12))
        } else {
            let artists = index.artists(query: request.query, sort: .count)
            result.artistCount = artists.count
            result.artists = Array(artists.prefix(previewLimit))
            try Task.checkCancellation()
            let albums = index.albums(query: request.query, sort: .rating)
            result.albumCount = albums.count
            result.albums = Array(albums.prefix(previewLimit))
            try Task.checkCancellation()
            let tracks = index.tracks(query: request.query, sort: .title)
            result.trackCount = tracks.count
            result.tracks = Array(tracks.prefix(previewLimit))
        }
        try Task.checkCancellation()
        #if DEBUG
        result.buildDuration = start.duration(to: .now)
        #endif
        return result
    }
}

// Search and recent-album sorting share an immutable catalog snapshot. Only
// bounded previews return to the UI; all filtering and sorting runs off-main.
@MainActor @Observable
final class SearchListing {
    private(set) var result = SearchListingResult()
    private(set) var ready = false
    private(set) var loading = false
    private(set) var completed: SearchListingRequest?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var worker: Task<SearchListingResult, Error>?
    #if DEBUG
    @ObservationIgnored var beforeBuildForTesting: (@Sendable (SearchListingRequest) async -> Void)?
    #endif

    func matches(_ request: SearchListingRequest) -> Bool { completed == request }

    func update(index: CatalogIndex, request: SearchListingRequest) async {
        guard !Task.isCancelled else { return }
        let token = UUID()
        generation = token
        worker?.cancel()
        worker = nil
        guard completed != request else { loading = false; return }
        loading = true
        defer {
            if generation == token { loading = false; worker = nil }
        }
        do {
            if !request.query.isEmpty { try await Task.sleep(for: .milliseconds(150)) }
            try Task.checkCancellation()
            guard generation == token else { return }
            #if DEBUG
            let beforeBuild = beforeBuildForTesting
            #endif
            let work = Task.detached(priority: .userInitiated) {
                #if DEBUG
                await beforeBuild?(request)
                #endif
                return try SearchListingResult.build(index: index, request: request)
            }
            worker = work
            let next = try await withTaskCancellationHandler { try await work.value } onCancel: { work.cancel() }
            try Task.checkCancellation()
            guard generation == token else { return }
            result = next
            completed = request
            ready = true
        } catch {
            // A superseded query or catalog revision cannot publish old hits.
        }
    }
}
