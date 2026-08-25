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

const featureSeparator = /\s+(?:feat(?:uring)?|ft)\.?\s+/i
const listSeparator = /\s*(?:,|&)\s*|\s+(?:feat(?:uring)?|ft)\.?\s+/i
const compoundSort = /(?:&|\bfeat(?:uring)?\.?\b|\bft\.?\b)/i

export function splitArtistCreditText(value, identityCount = 0) {
  const text = String(value || '').trim().normalize('NFC')
  if (!text) return []
  if (!featureSeparator.test(text) && Number(identityCount) <= 1) return [text]
  const parts = text.split(listSeparator).map((part) => part.trim()).filter(Boolean)
  return parts.length > 1 && (Number(identityCount) <= 1
    || parts.length === Number(identityCount)) ? parts : [text]
}

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
  const structured = metadata?.hasStructuredArtists === true
    || (metadata?.hasStructuredArtists === undefined
      && Array.isArray(metadata?.artists) && metadata.artists.length > 1)
  let rawNames = Array.isArray(metadata?.artists) && metadata.artists.length
    ? metadata.artists : (metadata?.artist ? [metadata.artist] : [])
  const sameAsAlbum = !structured && rawNames.length === 1
    && String(metadata?.albumArtist || '').trim().toLocaleLowerCase()
      === String(rawNames[0] || '').trim().toLocaleLowerCase()
  if (sameAsAlbum) {
    rawNames = Array.isArray(metadata?.albumArtists) && metadata.albumArtists.length
      ? metadata.albumArtists : [metadata.albumArtist]
  } else if (rawNames.length === 1 && !structured) {
    const identityCount = Array.isArray(metadata?.artistIds)
      ? metadata.artistIds.filter(Boolean).length : 0
    rawNames = splitArtistCreditText(rawNames[0], identityCount)
  }
  const rawSorts = Array.isArray(metadata?.artistSorts)
    ? metadata.artistSorts : (metadata?.artistSort ? [metadata.artistSort] : [])
  const alignedSorts = rawSorts.length === rawNames.length ? rawSorts : []
  const seen = new Set()
  return rawNames.map((value, index) => {
    const name = String(value || '').trim()
    let sort = String(alignedSorts[index] || '').trim()
    if (sort && compoundSort.test(sort) && !compoundSort.test(name)) sort = ''
    return { name, sort: explicitArtistSort(name, sort) }
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
