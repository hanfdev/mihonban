// Artist alias catalog (romaji ↔ original name). artist-aliases.json is shared with the pipeline and beets.
import DATA from './artist-aliases.json' with { type: 'json' }

const strip = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** Normalize alias keys: lowercase, strip accents, collapse whitespace, and map × to x, matching pipeline norm_alias_key. */
export const normKey = (s) =>
  strip(String(s)).replace(/×/g, 'x').toLowerCase().split(/\s+/).join(' ').trim()

let M = null // normKey → entry|null
let R = null // Original name → every romaji key for reverse search
const build = () => {
  if (M) return
  M = new Map()
  R = new Map()
  for (const [k, v] of Object.entries(DATA.aliases || {})) {
    M.set(normKey(k), v)
    if (v?.name) R.set(v.name, [...(R.get(v.name) || []), k])
  }
}

/** Map a romaji/English name to its Japanese original, accepting either given/family name order; null when unknown. */
export function toJa(name) {
  build()
  const k = normKey(name)
  let v = M.get(k)
  if (v === undefined) {
    const p = k.split(' ')
    if (p.length === 2) v = M.get(`${p[1]} ${p[0]}`)
  }
  return v?.name || null
}

/** Return every known romaji alias for an original name, for inclusion in the searchable haystack. */
export function romajiOf(jaName) {
  build()
  return (R.get(jaName) || []).join(' ')
}

/** Return the preferred romaji sort name, persisted by web uploads and edits for later search. */
export function sortOf(jaName) {
  build()
  const keys = R.get(jaName) || []
  for (const key of keys) {
    const sort = M.get(normKey(key))?.sort
    if (typeof sort === 'string' && sort.trim()) return sort.trim()
  }
  return ''
}

/** Prefer catalog metadata, then fall back to the bundled verified alias. */
export function preferredArtistSort(name, stored = '') {
  const value = typeof stored === 'string' ? stored.trim() : ''
  if (value && value !== name) return value
  return sortOf(name)
}
