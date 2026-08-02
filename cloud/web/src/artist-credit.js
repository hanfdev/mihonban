export const explicitArtistSort = (name, sort) => {
  const artistName = String(name || '').trim()
  const value = String(sort || '').trim()
  return value && value !== artistName ? value : ''
}

export function creditsOf(value) {
  const source = Array.isArray(value?.artists) && value.artists.length
    ? value.artists
    : (value?.artist ? [{ name: value.artist,
      sort: value.artistSort ?? '' }] : [])
  return source.map((artist) => {
    if (typeof artist === 'string') return { name: artist, sort: '' }
    const name = artist.name || ''
    return { name, sort: explicitArtistSort(name, artist.sort) }
  })
    .filter((artist) => artist.name)
}

export const effectiveArtistSort = (artist) =>
  String(artist?.sort || '').trim() || String(artist?.name || '').trim()

export const hasArtist = (album, name) =>
  creditsOf(album).some((artist) => artist.name === name)

export function artistCreditText(value) {
  const names = creditsOf(value).map((artist) => artist.name)
  return names.length === 2 ? names.join(' × ') : names.join(', ')
}

export function artistSearchText(value) {
  return creditsOf(value)
    .flatMap((artist) => [artist.name, effectiveArtistSort(artist)]).join(' ')
}

export function creditsFromTags(metadata) {
  const rawNames = Array.isArray(metadata?.artists) && metadata.artists.length
    ? metadata.artists : (metadata?.artist ? [metadata.artist] : [])
  const rawSorts = Array.isArray(metadata?.artistSorts)
    ? metadata.artistSorts : (metadata?.artistSort ? [metadata.artistSort] : [])
  const seen = new Set()
  return rawNames.map((value, index) => {
    const name = String(value || '').trim()
    return { name, sort: explicitArtistSort(name, rawSorts[index]) }
  }).filter((artist) => {
    const key = artist.name.toLocaleLowerCase()
    if (!artist.name || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const sameArtistNames = (left, right) => {
  const a = creditsOf({ artists: left })
  const b = creditsOf({ artists: right })
  return a.length === b.length
    && a.every((artist, index) => artist.name === b[index]?.name)
}
