/** Number represented by the global library count in the current visibility mode. */
export function visibleAlbumCount(albums, { isAdmin = false, showHidden = false } = {}) {
  if (!Array.isArray(albums)) return null
  if (isAdmin && showHidden) return albums.length
  return albums.reduce((count, album) => count + (album?.hidden ? 0 : 1), 0)
}
