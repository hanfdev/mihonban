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

export const artistIdentityKey = (name) =>
  String(name || '').trim().normalize('NFC').toLocaleLowerCase()

export function findArtistByName(artists, name) {
  const key = artistIdentityKey(name)
  return (artists || []).find((artist) => artist.name === name)
    || (artists || []).find((artist) => artistIdentityKey(artist.name) === key)
    || (artists || []).find((artist) =>
      (artist.aliases || []).some((alias) => artistIdentityKey(alias) === key))
}

export function renameArtistRecord(artist, renames) {
  const change = (renames || []).find(({ from }) =>
    artistIdentityKey(from) === artistIdentityKey(artist.name))
  if (!change || change.to === artist.name) return artist
  const names = [...(artist.aliases || []), artist.name,
    ...renames.filter(({ to }) => to === change.to).map(({ from }) => from)]
  const aliases = [...new Map(names
    .filter((name) => artistIdentityKey(name) !== artistIdentityKey(change.to))
    .map((name) => [artistIdentityKey(name), name])).values()]
  return { ...artist, name: change.to, aliases,
    sort: explicitArtistSort(change.to, explicitArtistSort(artist.name, artist.sort)) }
}

export function artistCasingChanges(previous, next) {
  const names = new Map((previous || []).map((artist) =>
    [artistIdentityKey(artist.name), artist.name.trim().normalize('NFC')]))
  return (next || []).flatMap((artist) => {
    const to = artist.name.trim().normalize('NFC')
    const from = names.get(artistIdentityKey(to))
    return from && from !== to ? [{ from, to }] : []
  })
}

export function renameArtistCredits(value, renames) {
  if (!renames?.length) return value
  const byName = new Map(renames.map((change) =>
    [artistIdentityKey(change.from), change.to]))
  let changed = false
  const artists = creditsOf(value).map((artist) => {
    const name = byName.get(artistIdentityKey(artist.name))
    if (!name || name === artist.name) return artist
    changed = true
    return { ...artist, name, sort: explicitArtistSort(name, artist.sort) }
  })
  if (!changed) return value
  return { ...value, artists, artist: artistCreditText({ artists }),
    artistSort: artists[0]?.sort || '' }
}

const featureSeparator = /\s+(?:feat(?:uring)?|ft)\.?\s+/i
const listSeparator = /\s*(?:,|&)\s*|\s+(?:feat(?:uring)?|ft)\.?\s+/i
const compoundSort = /(?:&|\bfeat(?:uring)?\.?\b|\bft\.?\b)/i

const ampersandSeparator = /\s+&\s+/
// "Kool & the Gang", "Bob Marley & His Wailers": the part after & names the band.
const bandContinuation = /^(?:the|his|her|their)\b/i

const commaListSeparator = /\s*,\s*|\s+&\s+/
const cjkName = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
// A comma list is split only when every entry reads as a full personal name.
// Single-word entries mark band names such as "Earth, Wind & Fire" or sort
// names such as "Yamashita, Tatsuro".
const fullName = (part) => /\s/.test(part) || cjkName.test(part)

/** Split "A & B" or "A B, C D, E F" without identity data unless it looks like one band. */
function splitAmpersandCredit(text) {
  const hasComma = text.includes(',')
  const parts = text.split(hasComma ? commaListSeparator : ampersandSeparator)
    .map((part) => part.trim())
  if (parts.length < 2 || parts.some((part) => !part)) return [text]
  if (parts.slice(1).some((part) => bandContinuation.test(part))) return [text]
  if (hasComma && !parts.every(fullName)) return [text]
  return parts
}

export function splitArtistCreditText(value, identityCount = 0,
                                      { allowExplicit = true } = {}) {
  const text = String(value || '').trim().normalize('NFC')
  if (!text) return []
  const count = Number(identityCount) || 0
  const explicit = allowExplicit && featureSeparator.test(text)
  if (explicit || count > 1) {
    const parts = text.split(listSeparator).map((part) => part.trim()).filter(Boolean)
    if (parts.length > 1 && (count <= 1 || parts.length === count)) return parts
    return [text]
  }
  // One MusicBrainz identity confirms a single artist such as "Neil & Iraiza".
  if (count === 1) return [text]
  return splitAmpersandCredit(text)
}

export const hasArtist = (album, name) =>
  creditsOf(album).some((artist) =>
    artistIdentityKey(artist.name) === artistIdentityKey(name))

export function artistCreditText(value) {
  const names = creditsOf(value).map((artist) => artist.name)
  return names.length === 2 ? names.join(' × ') : names.join(', ')
}

export function artistSearchText(value) {
  return creditsOf(value)
    .flatMap((artist) => [artist.name, effectiveArtistSort(artist)]).join(' ')
}

const identityCountOf = (ids) =>
  Array.isArray(ids) ? ids.filter(Boolean).length : 0

/** Album-level credits from the most common album artist text of an import. */
export function albumCreditsFromText(value, identityCount = 0) {
  return splitArtistCreditText(value, identityCount, { allowExplicit: false })
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
    if (rawNames.length === 1) {
      rawNames = splitArtistCreditText(rawNames[0],
        identityCountOf(metadata?.albumArtistIds), { allowExplicit: false })
    }
  } else if (rawNames.length === 1 && !structured) {
    rawNames = splitArtistCreditText(rawNames[0], identityCountOf(metadata?.artistIds))
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
