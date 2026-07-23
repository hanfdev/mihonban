// 解析手存的 Discogs 发行页 HTML（Ctrl+S 保存）。
// 结构：ld+json 的 MusicAlbum 节点带 标题/年份/艺人/genres；
// styles（更细的风格，主要目标）藏在页面的 Relay 缓存 JSON 里，正则扫最稳。
// 与 RYM 同一红线：只解析本地文件，绝不请求 Discogs 网页。

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
    } catch { /* 有些 ld+json 块与发行无关，忽略 */ }
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
