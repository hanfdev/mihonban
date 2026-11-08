import Foundation

struct PlaybackQueue: Sendable {
    enum RepeatMode: Int, CaseIterable, Sendable { case off, all, one }
    private(set) var tracks: [Track] = []
    private(set) var order: [Int] = []
    private(set) var cursor = 0
    private(set) var shuffled = false
    var repeatMode = RepeatMode.off
    private var identity = UUID()
    private var shuffleRandom: ShuffleRandom

    init(shuffleSeed: UInt64 = UInt64.random(in: UInt64.min...UInt64.max)) {
        shuffleRandom = ShuffleRandom(state: shuffleSeed)
    }

    // Copies must plan the same next cycle without consuming the live queue's
    // random state. Advancing or adopting a snapshot then carries that state
    // forward, so later cycles still receive a fresh shuffle. SplitMix64 keeps
    // the generator value-semantic with only one word of state.
    private struct ShuffleRandom: RandomNumberGenerator, Sendable {
        var state: UInt64

        mutating func next() -> UInt64 {
            state &+= 0x9E3779B97F4A7C15
            var value = state
            value = (value ^ (value >> 30)) &* 0xBF58476D1CE4E5B9
            value = (value ^ (value >> 27)) &* 0x94D049BB133111EB
            return value ^ (value >> 31)
        }
    }

    struct Entry: Identifiable, Sendable {
        struct ID: Hashable, Sendable {
            let queue: UUID
            let slot: Int
        }
        let id: ID
        let track: Track
    }

    // Storage slots survive moves and distinguish repeated copies of a song.
    // A new queue gets a new identity so stale drag actions cannot edit it.
    var upcomingEntries: [Entry] {
        order.dropFirst(cursor + 1).map { Entry(id: Entry.ID(queue: identity, slot: $0), track: tracks[$0]) }
    }

    func upcomingOffset(for id: Entry.ID) -> Int? {
        guard id.queue == identity else { return nil }
        return order.dropFirst(cursor + 1).firstIndex(of: id.slot).map { $0 - cursor - 1 }
    }

    var currentIndex: Int? { order.indices.contains(cursor) ? order[cursor] : nil }
    var current: Track? { currentIndex.map { tracks[$0] } }
    var upcoming: [Track] { order.dropFirst(cursor + 1).map { tracks[$0] } }

    // Shuffle is a mode that outlives the queue, as in the system music app:
    // nil keeps the current mode. A shuffled queue starts at the chosen track
    // and plays every other track afterwards, including earlier ones.
    mutating func replace(_ tracks: [Track], startingAt index: Int, shuffle: Bool? = nil) {
        self.tracks = tracks
        identity = UUID()
        let start = tracks.indices.contains(index) ? index : 0
        shuffled = shuffle ?? shuffled
        if shuffled {
            order = tracks.isEmpty ? [] : [start] + tracks.indices.filter { $0 != start }.shuffled(using: &shuffleRandom)
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
            order = prefix + order.dropFirst(cursor + 1).shuffled(using: &shuffleRandom)
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
        let previous = current?.id
        cursor = 0
        if shuffled {
            order.shuffle(using: &shuffleRandom)
            if tracks[order[0]].id == previous,
               let different = order.firstIndex(where: { tracks[$0].id != previous }) {
                order.swapAt(0, different)
            }
        }
        return true
    }

    @discardableResult
    mutating func previous() -> Bool {
        guard cursor > 0 else { return false }
        cursor -= 1
        return true
    }

    // An explicit next command at the end reuses the edited playback order.
    // This does not turn on repeat or reshuffle the queue behind the user's back.
    @discardableResult
    mutating func restart() -> Bool {
        guard !order.isEmpty else { return false }
        cursor = 0
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

    // Resolve UI identities at the time of the drop, not against stale offsets
    // from before an automatic track transition.
    mutating func moveUpcoming(entries ids: [Entry.ID], before anchor: Entry.ID?) {
        guard !ids.isEmpty, Set(ids).count == ids.count,
              ids.allSatisfy({ upcomingOffset(for: $0) != nil }) else { return }
        if let anchor, upcomingOffset(for: anchor) == nil { return }
        let moving = Set(ids.map(\.slot))
        let upcoming = Array(order.dropFirst(cursor + 1))
        let selected = upcoming.filter { moving.contains($0) }
        var rest = upcoming.filter { !moving.contains($0) }
        let insertion: Int
        if let anchor {
            // If the destination is itself moving, use the next remaining slot.
            let following = upcoming.drop { $0 != anchor.slot }.first { !moving.contains($0) }
            insertion = following.flatMap { rest.firstIndex(of: $0) } ?? rest.count
        } else { insertion = rest.count }
        rest.insert(contentsOf: selected, at: insertion)
        order = Array(order.prefix(cursor + 1)) + rest
    }

    mutating func removeUpcoming(entries ids: [Entry.ID]) {
        removeUpcoming(at: IndexSet(ids.compactMap { upcomingOffset(for: $0) }))
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
