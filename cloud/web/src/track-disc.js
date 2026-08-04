export function trackDisc(track) {
  const disc = Number(track?.disc)
  return Number.isInteger(disc) && disc > 0 ? disc : 1
}

export function groupTracksByDisc(tracks = []) {
  const byDisc = new Map()

  tracks.forEach((track, index) => {
    const disc = trackDisc(track)
    if (!byDisc.has(disc)) byDisc.set(disc, [])
    byDisc.get(disc).push({ track, index })
  })

  const multiDisc = byDisc.size > 1
  return [...byDisc.entries()]
    .sort(([left], [right]) => left - right)
    .map(([disc, entries]) => ({
      disc,
      multiDisc,
      items: entries.map((entry, position) => ({ ...entry, position: position + 1 })),
    }))
}

export function canMoveTrackWithinDisc(tracks, from, to) {
  if (!Array.isArray(tracks) || from < 0 || to < 0
      || from >= tracks.length || to >= tracks.length || from === to) return false
  return trackDisc(tracks[from]) === trackDisc(tracks[to])
}
