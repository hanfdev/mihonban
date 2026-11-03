export const hashOf = (value) => {
  const path = String(value || '/').replace(/^#/, '')
  return `#${path.startsWith('/') ? path : `/${path}`}`
}

export const isCurrentHash = (value, currentHash) => {
  const current = !currentHash || currentHash === '#' ? '#/' : currentHash
  return current === hashOf(value)
}

export const scrollToTop = (container, behavior = 'smooth') => {
  if (!container) return false
  container.scrollTo({ top: 0, left: 0, behavior })
  return true
}

// Top-level browsing pages keep their own scroll position for the session.
// Detail pages (album, artist) and admin tools always open at the top.
const REMEMBERED_VIEWS = new Set(['library', 'genre', 'tracks', 'artists', 'favs'])

export const scrollMemoryKey = (hash) => {
  const normalized = !hash || hash === '#' ? '#/' : hashOf(hash)
  const view = normalized.replace(/^#\/?/, '').split('/')[0] || 'library'
  return REMEMBERED_VIEWS.has(view) ? normalized : null
}

/**
 * Jump to a saved position once the destination page is tall enough to reach
 * it. Lists render after their data arrives, so keep retrying for a short
 * window; the returned function stops early, e.g. when the user scrolls.
 */
export const restoreScroll = (container, top, {
  timeout = 1500,
  frame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (id) => cancelAnimationFrame(id),
  now = () => performance.now(),
} = {}) => {
  if (!container) return () => {}
  const deadline = now() + timeout
  let id = null
  const attempt = () => {
    id = null
    container.scrollTop = top
    const reachable = container.scrollHeight - container.clientHeight >= top - 1
    if (!reachable && now() < deadline) id = frame(attempt)
  }
  id = frame(attempt)
  return () => { if (id !== null) cancelFrame(id); id = null }
}
