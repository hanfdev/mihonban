export function albumAddedAt(album) {
  const value = album?.createdAt
  // Unknown import dates sort last; edit times never stand in for added times.
  return Number.isFinite(value) && value >= 0 ? value : 0
}

export function compareRecentlyAdded(a, b) {
  const time = albumAddedAt(b) - albumAddedAt(a)
  if (time) return time
  // Batch imports can share a timestamp. Keep their order stable across edits
  // and catalog refreshes, including changes to titles or artist credits.
  const aId = String(a.id ?? '')
  const bId = String(b.id ?? '')
  return aId < bId ? -1 : aId > bId ? 1 : 0
}
