import Foundation

enum AlbumPlayback {
    static func assemble(albums: [Album], tracks: [Track]) throws -> [Track] {
        let grouped = Dictionary(grouping: tracks, by: { $0.albumId ?? "" })
        return try albums.flatMap { album in
            let songs = grouped[album.id] ?? []
            // Do not silently start a partial queue after a stale/incomplete fetch.
            guard album.trackCount.map({ $0 == songs.count }) ?? !songs.isEmpty else {
                throw ClientError(key: "mobile.incompleteQueue")
            }
            return songs.sorted {
                if ($0.disc ?? 1) != ($1.disc ?? 1) { return ($0.disc ?? 1) < ($1.disc ?? 1) }
                if ($0.track ?? 0) != ($1.track ?? 0) { return ($0.track ?? 0) < ($1.track ?? 0) }
                return CatalogIndex.compare($0, $1, sort: .title)
            }
        }
    }
}
