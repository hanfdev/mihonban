import Foundation

struct PlaybackQueue: Sendable {
    enum RepeatMode: Int, CaseIterable, Sendable { case off, all, one }
    private(set) var tracks: [Track] = []
    private(set) var order: [Int] = []
    private(set) var cursor = 0
    private(set) var shuffled = false
    var repeatMode = RepeatMode.off

    var currentIndex: Int? { order.indices.contains(cursor) ? order[cursor] : nil }
    var current: Track? { currentIndex.map { tracks[$0] } }
    var upcoming: [Track] { order.dropFirst(cursor + 1).map { tracks[$0] } }

    mutating func replace(_ tracks: [Track], startingAt index: Int, shuffle: Bool = false) {
        self.tracks = tracks
        order = Array(tracks.indices)
        cursor = tracks.indices.contains(index) ? index : 0
        shuffled = false
        if shuffle { setShuffle(true) }
    }

    mutating func setShuffle(_ enabled: Bool) {
        guard enabled != shuffled, let currentIndex else { return }
        shuffled = enabled
        if enabled {
            // Preserve actual playback history; only shuffle what has not played.
            let prefix = Array(order.prefix(cursor + 1))
            order = prefix + order.dropFirst(cursor + 1).shuffled()
        } else {
            let history = Array(order.prefix(cursor))
            let visited = Set(history + [currentIndex])
            order = history + [currentIndex] + tracks.indices.filter { !visited.contains($0) }
        }
    }

    @discardableResult
    mutating func advance(automatic: Bool = false) -> Bool {
        guard !order.isEmpty else { return false }
        if automatic && repeatMode == .one { return true }
        if cursor + 1 < order.count { cursor += 1; return true }
        guard repeatMode == .all else { return false }
        let previous = currentIndex
        cursor = 0
        if shuffled {
            order.shuffle()
            if order.count > 1 && order.first == previous { order.swapAt(0, 1) }
        }
        return true
    }

    @discardableResult
    mutating func previous() -> Bool {
        guard cursor > 0 else { return false }
        cursor -= 1
        return true
    }

    func nextSnapshot() -> PlaybackQueue? {
        var next = self
        return next.advance(automatic: true) ? next : nil
    }
}
