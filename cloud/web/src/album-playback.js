export function albumPlaybackState(albumId, currentAlbumId, playingId) {
  const current = Boolean(albumId) && albumId === currentAlbumId
  return { current, playing: current && Boolean(playingId) }
}
