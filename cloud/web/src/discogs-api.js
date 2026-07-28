// Browser-side Discogs API client. Discogs permits CORS for its public API,
// while requests from Cloudflare Workers can share a rate-limited egress IP.
// Public JSON is cached locally; no personal token is exposed to the browser.

const API_ROOT = 'https://api.discogs.com/'
const DAY = 24 * 60 * 60
const CACHE_NAME = 'mihonban-discogs-v1'
const memory = new Map()

async function cachedEntry(url) {
  const inMemory = memory.get(url)
  if (inMemory) return inMemory
  if (!globalThis.caches?.open) return null
  try {
    const cache = await globalThis.caches.open(CACHE_NAME)
    const response = await cache.match(url)
    if (!response) return null
    const fetchedAt = Number(response.headers.get('X-Mihonban-Fetched-At'))
    const data = await response.json()
    if (!Number.isFinite(fetchedAt) || !data) return null
    const entry = { fetchedAt, data }
    memory.set(url, entry)
    return entry
  } catch { return null }
}

async function storeEntry(url, entry) {
  memory.set(url, entry)
  if (!globalThis.caches?.open) return
  try {
    const cache = await globalThis.caches.open(CACHE_NAME)
    await cache.put(url, new Response(JSON.stringify(entry.data), {
      headers: {
        'Content-Type': 'application/json',
        'X-Mihonban-Fetched-At': String(entry.fetchedAt),
      },
    }))
  } catch { /* browser cache is an optimization */ }
}

async function json(path, query = {}, {
  freshSeconds = 7 * DAY, staleSeconds = 30 * DAY,
} = {}) {
  const url = new URL(path, API_ROOT)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  const cacheKey = url.toString()
  const cached = await cachedEntry(cacheKey)
  const age = cached ? Date.now() - cached.fetchedAt : Infinity
  if (cached && age <= freshSeconds * 1000) return cached.data

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' }, signal: controller.signal,
    })
    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500)
          && cached && age <= staleSeconds * 1000) return cached.data
      throw new Error(`Discogs ${response.status}`)
    }
    const data = await response.json()
    await storeEntry(cacheKey, { fetchedAt: Date.now(), data })
    return data
  } catch (error) {
    if (cached && age <= staleSeconds * 1000) return cached.data
    throw error
  } finally { clearTimeout(timer) }
}

const ID_RE = /^\d{1,12}$/
export function discogsRef(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (ID_RE.test(text)) return { kind: 'releases', id: text }
  let url
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`) }
  catch { return null }
  if (!['discogs.com', 'www.discogs.com'].includes(url.hostname.toLowerCase())) return null
  const match = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(release|master)s?\/(\d+)(?:[-/]|$)/i
    .exec(url.pathname)
  if (!match || !ID_RE.test(match[2])) return null
  return { kind: match[1].toLowerCase() === 'master' ? 'masters' : 'releases',
    id: match[2] }
}

function imagesOf(data) {
  const images = (data.images || []).map((image, index) => ({
    idx: index, type: image.type || 'secondary',
    uri: image.uri || image.resource_url || '',
    thumb: image.uri150 || image.uri || '',
    w: image.width || 0, h: image.height || 0,
  })).filter((image) => image.uri)
  images.sort((a, b) => (a.type === 'primary' ? -1 : 0)
    - (b.type === 'primary' ? -1 : 0))
  return images
}

export async function releaseSearch(album) {
  const search = async (artist) => {
    const data = await json('database/search', {
      release_title: album.title, artist, type: 'release', per_page: 8,
    }, { freshSeconds: 60 * 60, staleSeconds: 7 * DAY })
    return data.results || []
  }
  let results = await search(album.artist)
  if (!results.length && album.artistSort && album.artistSort !== album.artist) {
    const natural = album.artistSort.includes(',')
      ? album.artistSort.split(',').reverse().map((part) => part.trim()).join(' ')
      : album.artistSort
    results = await search(natural)
  }
  if (!results.length) results = await search('')
  return { candidates: results.slice(0, 8).map((result) => ({
    id: result.id, title: result.title || '', year: result.year || '',
    country: result.country || '', format: (result.format || []).slice(0, 3).join(' · '),
    label: (result.label || [])[0] || '', genres: result.genre || [],
    styles: result.style || [], thumb: result.thumb || '',
    url: result.id ? `https://www.discogs.com/release/${result.id}` : '',
  })) }
}

export async function releaseLookup(value) {
  const ref = discogsRef(value)
  if (!ref) throw new Error('Invalid Discogs release / master URL')
  const data = await json(`${ref.kind}/${ref.id}`)
  const artist = (data.artists || [])
    .map((item) => (item.name || '').replace(/ \(\d+\)$/, '')).join(', ')
  return {
    title: [artist, data.title].filter(Boolean).join(' – '),
    year: data.year || '', genres: data.genres || [], styles: data.styles || [],
    url: data.uri || value,
  }
}

export async function releaseImages(value) {
  const ref = discogsRef(value)
  if (!ref) throw new Error('Invalid Discogs release / master URL')
  return { images: imagesOf(await json(`${ref.kind}/${ref.id}`)) }
}

export async function artistSearch(name) {
  const data = await json('database/search', {
    q: name, type: 'artist', per_page: 6,
  }, { freshSeconds: 60 * 60, staleSeconds: 7 * DAY })
  return { candidates: (data.results || []).slice(0, 6).map((item) => ({
    id: item.id, title: item.title || '', thumb: item.thumb || '',
    url: item.id ? `https://www.discogs.com/artist/${item.id}` : '',
  })) }
}

export async function artistDetail(artistId) {
  const id = String(artistId || '').trim()
  if (!ID_RE.test(id)) throw new Error('Invalid Discogs artist id')
  const data = await json(`artists/${id}`)
  const profile = (data.profile || '')
    .replace(/\[\/?[abiu](=[^\]]+)?\]/gi, '')
    .replace(/\[url=[^\]]+\]|\[\/url\]/gi, '')
    .trim()
  return { name: data.name || '', images: imagesOf(data), profile }
}

export function resetDiscogsCacheForTest() { memory.clear() }
