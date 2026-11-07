import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Serve the production Web build with fictional metadata and original artwork.
// No database, credentials, storage provider, or external API is involved.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'cloud/web/dist')
const sampleDate = Date.UTC(2026, 10, 1)
const records = [
  ['midnight-sessions', 'Midnight Sessions', 'The Native Quartet', 1964, 'Jazz', 'Modal Jazz', 4.36, 1428],
  ['evening-signals', 'Evening Signals', 'The Native Quartet', 1970, 'Jazz', 'Soul Jazz', 4.21, 836],
  ['quiet-geometry', 'Quiet Geometry', 'Mira Sol', 1982, 'Ambient', 'Minimalism', 4.18, 694],
  ['northern-lights', 'Northern Lights', 'Sora Ensemble', 1978, 'Jazz', 'Spiritual Jazz', 4.12, 1240],
  ['slow-motion', 'Slow Motion', 'Harborline', 1987, 'City Pop', 'Jazz-Funk', 4.08, 721],
  ['paper-moon', 'Paper Moon', 'June Atlas', 1974, 'Folk', 'Chamber Folk', 4.04, 563],
  ['soft-focus', 'Soft Focus', 'Mira Sol', 1991, 'Ambient', 'New Age', 4.01, 482],
  ['blue-window', 'Blue Window', 'Sora Ensemble', 1980, 'Jazz', 'Fusion', 3.98, 647],
  ['distant-shores', 'Distant Shores', 'Harborline', 1986, 'City Pop', 'Boogie', 3.94, 390],
  ['light-through-leaves', 'Light Through Leaves', 'June Atlas', 1976, 'Folk', 'Acoustic', 3.91, 311],
  ['after-the-rain', 'After the Rain', 'Nocturne Club', 1996, 'Electronic', 'Downtempo', 3.88, 527],
  ['tides-and-echoes', 'Tides & Echoes', 'Mira Sol', 1994, 'Ambient', 'Modern Classical', 3.86, 219],
  ['still-life', 'Still Life', 'The Native Quartet', 1968, 'Jazz', 'Cool Jazz', 3.84, 863],
  ['summer-lines', 'Summer Lines', 'Harborline', 1984, 'City Pop', 'Soft Rock', 3.82, 412],
  ['open-water', 'Open Water', 'Sora Ensemble', 1983, 'Jazz', 'Fusion', 3.79, 318],
  ['velvet-morning', 'Velvet Morning', 'June Atlas', 1979, 'Folk', 'Singer-Songwriter', 3.76, 284],
  ['last-train-home', 'Last Train Home', 'Nocturne Club', 1998, 'Electronic', 'Trip Hop', 3.73, 498],
  ['fields-of-sound', 'Fields of Sound', 'Mira Sol', 1997, 'Ambient', 'Minimalism', 3.71, 173],
]
const trackNames = ['Blue Hour', 'A Room with a View', 'Softly, After Dark', 'Between the Lines',
  'The Long Way Home', 'When the City Sleeps', 'First Light', 'Until Tomorrow']
const palettes = [
  ['#173943', '#e2a34f', '#efdfbc'], ['#704339', '#e4aa8c', '#f4e2bd'],
  ['#b9bca5', '#33544b', '#ece3cc'], ['#303e59', '#a6b3cb', '#e7dfcc'],
  ['#c69c63', '#414b3d', '#f2e5c8'], ['#435d66', '#d9c7a1', '#f1e7d2'],
]
const descriptions = {
  'The Native Quartet': 'A quartet built around open space, close listening and the warmth of a small room. Piano, bass, drums and tenor saxophone find their own quiet conversation.',
  'Mira Sol': 'Patient melodies, soft textures and a sense of wide-open space. Each recording explores the small changes that happen when a sound is allowed to linger.',
  'Sora Ensemble': 'An ensemble drawing together lyrical jazz, luminous harmonies and unhurried grooves. Their records follow the changing light from evening into morning.',
  Harborline: 'Bright guitars, warm electric piano and melodies made for the journey home. The group brings a coastal ease to carefully arranged pop songs.',
  'June Atlas': 'Intimate songs carried by acoustic guitar, small strings and a clear, understated voice. Everyday details become places to return to.',
  'Nocturne Club': 'An after-hours collection of slow rhythms, dusty keys and distant echoes. Music for watching the city move from the other side of the glass.',
}

const albums = records.map(([id, title, artist, year, genre, secondary, rating, votes], index) => ({
  id, title, artist, artistSort: artist, artists: [{ name: artist, sort: artist }], year,
  genres: [genre], secondaryGenres: [secondary], hidden: false, storageId: 'demo-library',
  folder: `Demo/${artist}/${title}`, trackCount: 8,
  duration: trackNames.reduce((total, _, position) => total + 214 + position * 17 + index % 5, 0),
  createdAt: sampleDate - index * 86400_000, updatedAt: sampleDate - index * 86400_000,
  rym: { rating, votes, rank: '', rymUrl: '', genres: [genre], secondaryGenres: [secondary],
    descriptors: ['warm', 'melodic', 'nocturnal', 'introspective'] },
}))
const albumById = new Map(albums.map((album) => [album.id, album]))
const trackRows = albums.flatMap((album, index) => trackNames.map((title, position) => {
  const duration = 214 + position * 17 + index % 5
  return { id: `${album.id}-${position + 1}`, title, track: position + 1, disc: 1,
    albumId: album.id, albumTitle: album.title, artist: album.artist, artists: album.artists,
    artistSort: album.artistSort, year: album.year, hidden: false, addedAt: album.createdAt,
    duration, format: 'WAV', bitrate: 1411, size: 44 + duration * 176400,
    path: `${album.folder}/${String(position + 1).padStart(2, '0')}.wav`,
    hasCustomArtists: false, titleOverride: false }
}))
const trackById = new Map(trackRows.map((track) => [track.id, track]))
const artists = Object.keys(descriptions).map((name) => ({ name, sort: name,
  hasAvatar: true, hasBio: true, note: descriptions[name], aliases: [],
  featuredTrackCount: 0, visibleFeaturedTrackCount: 0 }))
const favorites = {
  albums: [albums[0], albums[2], albums[4], albums[5]].map(({ id }, order) => ({ id, order, ts: sampleDate - order })),
  tracks: [trackRows[0], trackRows[2], trackRows[17]].map(({ id }, order) => ({ id, order, ts: sampleDate - order })),
}

const xml = (text) => String(text).replace(/[&<>"']/g, (value) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[value])

function artwork(album, portrait = false) {
  const index = albums.indexOf(album)
  const [background, accent, paper] = palettes[index % palettes.length]
  const lines = album.title.split(' ')
  const middle = Math.ceil(lines.length / 2)
  const title = [lines.slice(0, middle).join(' '), lines.slice(middle).join(' ')].filter(Boolean)
  const shapes = [
    `<circle cx="515" cy="270" r="204" fill="${accent}"/><path d="M0 400H800V550H0Z" fill="${background}"/><path d="M0 433H800M0 450H800M0 467H800M0 484H800" stroke="${paper}" stroke-width="2" opacity=".3"/>`,
    Array.from({ length: 6 }, (_, i) => `<path d="M${80 + i * 112} ${115 + i * 25}V505" stroke="${accent}" stroke-width="48"/>`).join(''),
    `<circle cx="328" cy="278" r="208" fill="${accent}"/><circle cx="412" cy="230" r="170" fill="${background}"/><path d="M70 510H730" stroke="${accent}" stroke-width="2"/>`,
    `<path d="M0 520L340 100L600 520Z" fill="${accent}"/><path d="M340 520L590 220L800 520Z" fill="${paper}" opacity=".6"/><circle cx="635" cy="115" r="50" fill="${paper}"/>`,
    Array.from({ length: 6 }, (_, i) => `<rect x="${95 + i * 43}" y="${65 + i * 39}" width="${600 - i * 86}" height="${470 - i * 78}" rx="${130 - i * 19}" fill="none" stroke="${i % 2 ? paper : accent}" stroke-width="14"/>`).join(''),
    `<path d="M0 230Q200 80 400 230T800 230V520H0Z" fill="${accent}"/><path d="M0 350Q200 200 400 350T800 350V520H0Z" fill="${paper}" opacity=".65"/><path d="M0 445Q200 295 400 445T800 445V520H0Z" fill="${background}"/>`,
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <rect width="800" height="800" fill="${background}"/>
    <g>${shapes[index % shapes.length]}</g>
    <text x="48" y="52" font-family="Arial,sans-serif" font-size="14" letter-spacing="4" fill="${paper}">STEREO · ARCHIVE ${String(index + 1).padStart(2, '0')}</text>
    <rect y="548" width="800" height="252" fill="${paper}"/>
    <text x="48" y="590" font-family="Arial,sans-serif" font-size="16" letter-spacing="3" fill="${background}">${xml(album.artist.toUpperCase())}</text>
    ${title.map((line, row) => `<text x="44" y="${658 + row * 67}" font-family="Georgia,serif" font-size="${line.length > 16 ? 48 : 61}" fill="${background}">${xml(line)}</text>`).join('')}
    <path d="M48 760H752" stroke="${background}" opacity=".5"/>
    <text x="48" y="786" font-family="Arial,sans-serif" font-size="12" letter-spacing="3" fill="${background}">${album.year} · ${xml(portrait ? 'ARTIST SERIES' : album.genres[0].toUpperCase())}</text>
  </svg>`
}

function albumDetail(album) {
  return { ...album, tracks: trackRows.filter((track) => track.albumId === album.id),
    note: `${descriptions[album.artist]}\n\n**${album.title}** moves between gentle ensemble passages and melodies that leave room to breathe. Listen from beginning to end, or return to a favorite late-night moment.`,
    images: [`${album.id}-sleeve`],
    similar: albums.filter((other) => other.id !== album.id && other.genres[0] === album.genres[0])
      .slice(0, 5).map((other) => ({ id: other.id, title: other.title, artist: other.artist,
        artists: other.artists, year: other.year, rating: other.rym.rating, votes: other.rym.votes })) }
}

function wavHeader(duration) {
  const header = Buffer.alloc(44)
  const size = duration * 176400
  header.write('RIFF'); header.writeUInt32LE(36 + size, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22)
  header.writeUInt32LE(44100, 24); header.writeUInt32LE(176400, 28)
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(size, 40)
  return header
}

function streamSilence(request, response, duration) {
  const header = wavHeader(duration)
  const length = 44 + duration * 176400
  let start = 0, end = length - 1
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range)
    if (!match || (!match[1] && !match[2])) {
      response.writeHead(416, { 'Content-Range': `bytes */${length}` }); response.end(); return
    }
    if (match[1]) {
      start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end
    } else start = Math.max(0, length - Number(match[2]))
    if (start > end || start >= length) {
      response.writeHead(416, { 'Content-Range': `bytes */${length}` }); response.end(); return
    }
  }
  response.writeHead(request.headers.range ? 206 : 200, {
    'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
    ...(request.headers.range ? { 'Content-Range': `bytes ${start}-${end}/${length}` } : {}),
  })
  if (request.method === 'HEAD') { response.end(); return }
  const silence = Buffer.alloc(65536)
  const source = Readable.from((function* () {
    if (start < 44) { yield header.subarray(start, Math.min(44, end + 1)); start = 44 }
    while (start <= end) {
      const count = Math.min(silence.length, end - start + 1)
      yield silence.subarray(0, count); start += count
    }
  })())
  response.once('close', () => source.destroy())
  source.pipe(response)
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
const fontFiles = {
  '/demo-fonts/shippori.ttf': resolve(root, 'desktop/assets/ShipporiMincho-SemiBold.ttf'),
  '/demo-fonts/inter.ttf': resolve(root, 'desktop/assets/Inter-Regular.ttf'),
  '/demo-fonts/inter-semibold.ttf': resolve(root, 'desktop/assets/Inter-SemiBold.ttf'),
}
const localFonts = `<style>
@font-face{font-family:"Shippori Mincho";src:url('/demo-fonts/shippori.ttf') format('truetype');font-weight:600;font-display:swap}
@font-face{font-family:Inter;src:url('/demo-fonts/inter.ttf') format('truetype');font-weight:400;font-display:swap}
@font-face{font-family:Inter;src:url('/demo-fonts/inter-semibold.ttf') format('truetype');font-weight:600;font-display:swap}
</style>`

async function createDemoServer() {
  let html
  try { html = await readFile(resolve(dist, 'index.html'), 'utf8') }
  catch { throw new Error('Build the Web app first: npm --prefix cloud/web run build') }
  // Use the same bundled typefaces locally; leave the application and CSS intact.
  html = html.replace(/<link\b[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '')
    .replace('</head>', `${localFonts}</head>`)
  return createServer(async (request, response) => {
    const send = (status, value, type = 'application/json; charset=utf-8') => {
      const body = typeof value === 'string' ? value : JSON.stringify(value)
      response.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : body)
    }
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return send(405, { error: 'Documentation demo is read-only' })
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
      if (pathname === '/api/me') return send(200, { ok: true, role: 'user', guest: true })
      if (pathname === '/api/health') return send(200, { ok: true, demo: true })
      if (pathname === '/api/library') return send(200, albums)
      if (pathname === '/api/tracks') return send(200, trackRows)
      if (pathname === '/api/artists') return send(200, artists)
      if (pathname === '/api/favorites') return send(200, favorites)
      if (pathname === '/api/admin/settings') return send(200, { guest_enabled: true })
      if (pathname.startsWith('/api/album/')) {
        const album = albumById.get(pathname.slice('/api/album/'.length))
        return album ? send(200, albumDetail(album)) : send(404, { error: 'Unknown demo album' })
      }
      if (/^\/api\/artists\/.+\/tracks$/.test(pathname)) return send(200, [])
      if (pathname.startsWith('/api/artist-bio/')) {
        const name = pathname.slice('/api/artist-bio/'.length)
        return send(200, { bio: descriptions[name] || '' })
      }
      if (pathname.startsWith('/api/art/') || pathname.startsWith('/api/image/')) {
        const id = pathname.split('/').at(-1).replace(/-sleeve$/, '')
        const album = albumById.get(id)
        return album ? send(200, artwork(album), 'image/svg+xml') : send(404, { error: 'Unknown demo artwork' })
      }
      if (pathname.startsWith('/api/artist-art/')) {
        const name = pathname.slice('/api/artist-art/'.length)
        const album = albums.find((item) => item.artist === name)
        return album ? send(200, artwork(album, true), 'image/svg+xml') : send(404, { error: 'Unknown demo artist' })
      }
      if (pathname.startsWith('/api/stream/')) {
        const track = trackById.get(pathname.slice('/api/stream/'.length))
        return track ? streamSilence(request, response, track.duration) : send(404, { error: 'Unknown demo track' })
      }
      if (pathname.startsWith('/api/')) return send(404, { error: 'Endpoint is not part of the documentation demo' })
      if (pathname === '/' || pathname === '/index.html') return send(200, html, 'text/html; charset=utf-8')
      const target = fontFiles[pathname] || resolve(dist, `.${pathname}`)
      if (!fontFiles[pathname] && !target.startsWith(dist + sep)) return send(403, { error: 'Invalid path' })
      const info = await stat(target).catch(() => null)
      if (!info?.isFile()) return send(404, { error: 'File not found' })
      response.writeHead(200, { 'Content-Type': mimeTypes[extname(target)] || 'application/octet-stream',
        'Content-Length': info.size, 'Cache-Control': 'no-cache' })
      if (request.method === 'HEAD') response.end()
      else createReadStream(target).pipe(response)
    } catch {
      if (!response.headersSent) send(500, { error: 'Demo request failed' })
      else response.destroy()
    }
  })
}

const server = await createDemoServer()
if (process.argv.includes('--check')) {
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const library = await (await fetch(`${base}/api/library`)).json()
    assert.equal(library.length, 18)
    const album = await (await fetch(`${base}/api/album/midnight-sessions`)).json()
    assert.equal(album.tracks.length, 8)
    assert.equal((await fetch(`${base}/api/art/midnight-sessions`)).status, 200)
    const audio = await fetch(`${base}/api/stream/midnight-sessions-1`, { headers: { Range: 'bytes=0-43' } })
    assert.equal(audio.status, 206)
    assert.equal(Buffer.from(await audio.arrayBuffer()).subarray(0, 4).toString(), 'RIFF')
    const document = await (await fetch(base)).text()
    assert.ok(document.includes('/assets/index-'))
    assert.ok(!document.includes('href="https://fonts.'))
    assert.equal((await fetch(`${base}/api/album/midnight-sessions`, { method: 'DELETE' })).status, 405)
    console.log('Documentation demo checks passed: 18 albums, 144 tracks, artwork, ranged audio and read-only API.')
  } finally {
    await new Promise((closed) => server.close(closed))
  }
} else {
  const port = Number(process.env.MIHONBAN_DEMO_PORT || 8767)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid MIHONBAN_DEMO_PORT')
  server.listen(port, '127.0.0.1', () => {
    console.log(`Documentation demo: http://127.0.0.1:${port}`)
    console.log(`Featured album: http://127.0.0.1:${port}/#/album/midnight-sessions`)
    console.log('Fictional catalog, original covers, silent audio. Press Ctrl+C to stop.')
  })
}
