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
