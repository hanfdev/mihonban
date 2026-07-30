// Parse a manually saved Discogs release page (saved with Ctrl+S).
// The MusicAlbum node in ld+json provides title, year, artist, and genres.
// Styles, the more specific taxonomy we primarily want, live in Relay cache JSON and are most reliably located by regex.
// As with RYM, this parser reads local files only and never requests Discogs pages.

export function parseDiscogsHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let title = ''
  let year = null
  let artist = ''
  let genres = []
  let styles = []

  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const d = JSON.parse(s.textContent)
      for (const n of (d['@graph'] || [d])) {
        if (n['@type'] === 'MusicAlbum' || n['@type'] === 'MusicRelease') {
          title = n.name || title
          year = parseInt(n.datePublished, 10) || year
          artist = n.byArtist?.name || artist
          if (Array.isArray(n.genre)) genres = n.genre
          else if (n.genre) genres = [n.genre]
        }
      }
    } catch { /* Ignore ld+json blocks unrelated to the release. */ }
  }

  const st = html.match(/"styles"\s*:\s*\[([^\]]*)\]/)
  if (st) { try { styles = JSON.parse(`[${st[1]}]`) } catch { /* noop */ } }
  if (!genres.length) {
    const ge = html.match(/"genres"\s*:\s*\[([^\]]*)\]/)
    if (ge) { try { genres = JSON.parse(`[${ge[1]}]`) } catch { /* noop */ } }
  }

  const url = doc.querySelector('link[rel="canonical"]')?.href || ''
  if (!title && !styles.length && !genres.length) {
    throw new Error('这不像 Discogs 发行页——没找到可解析的数据')
  }
  return { title, year, artist, genres, styles, url }
}
