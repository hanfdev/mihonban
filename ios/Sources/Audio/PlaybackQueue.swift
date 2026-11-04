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

    // Shuffle is a mode that outlives the queue, as in the system music app:
    // nil keeps the current mode. A shuffled queue starts at the chosen track
    // and plays every other track afterwards, including earlier ones.
    mutating func replace(_ tracks: [Track], startingAt index: Int, shuffle: Bool? = nil) {
        self.tracks = tracks
        let start = tracks.indices.contains(index) ? index : 0
        shuffled = shuffle ?? shuffled
        if shuffled {
            order = tracks.isEmpty ? [] : [start] + tracks.indices.filter { $0 != start }.shuffled()
            cursor = 0
        } else {
            order = Array(tracks.indices)
            cursor = start
        }
    }

    mutating func setShuffle(_ enabled: Bool) {
        guard enabled != shuffled else { return }
        // With nothing queued only the mode changes; the next queue uses it.
        guard let currentIndex else { shuffled = enabled; return }
        shuffled = enabled
        if enabled {
            // Preserve actual playback history; only shuffle what has not played.
            let prefix = Array(order.prefix(cursor + 1))
            order = prefix + order.dropFirst(cursor + 1).shuffled()
        } else {
            // Restore album order for what is still queued, keeping user edits.
            let history = Array(order.prefix(cursor))
            let remaining = Set(order.dropFirst(cursor + 1))
            order = history + [currentIndex] + tracks.indices.filter { remaining.contains($0) }
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

    // Queue edits address upcoming entries by position, since one track may be
    // queued more than once. Offsets are relative to `upcoming`.
    mutating func enqueue(_ items: [Track], next: Bool) {
        guard !items.isEmpty else { return }
        let start = tracks.count
        tracks += items
        let added = Array(start..<tracks.count)
        if order.isEmpty { order = added; cursor = 0; return }
        if next { order.insert(contentsOf: added, at: min(cursor + 1, order.count)) }
        else { order += added }
    }

    mutating func removeUpcoming(at offsets: IndexSet) {
        let positions = offsets.map { cursor + 1 + $0 }.filter { order.indices.contains($0) }
        for position in positions.sorted(by: >) { order.remove(at: position) }
    }

    mutating func moveUpcoming(from source: IndexSet, to destination: Int) {
        let upcoming = Array(order.dropFirst(cursor + 1))
        let moving = source.sorted().filter { upcoming.indices.contains($0) }.map { upcoming[$0] }
        var rest = upcoming.enumerated().filter { !source.contains($0.offset) }.map(\.element)
        let insertion = destination - source.filter { $0 < destination }.count
        rest.insert(contentsOf: moving, at: min(max(0, insertion), rest.count))
        order = Array(order.prefix(cursor + 1)) + rest
    }

    // Jumping skips the entries in between, as other players do.
    mutating func jumpToUpcoming(_ offset: Int) -> Bool {
        let position = cursor + 1 + offset
        guard order.indices.contains(position) else { return false }
        order.removeSubrange((cursor + 1)..<position)
        cursor += 1
        return true
    }

    func nextSnapshot() -> PlaybackQueue? {
        var next = self
        return next.advance(automatic: true) ? next : nil
    }
}
