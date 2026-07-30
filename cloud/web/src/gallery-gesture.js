/** Return 1 for next, -1 for previous, or 0 to snap back. */
export function gallerySwipeDirection({ dx, dy = 0, elapsed = 1, width = 390 }) {
  const distance = Math.abs(Number(dx) || 0)
  const vertical = Math.abs(Number(dy) || 0)
  if (distance <= vertical * 1.05) return 0
  const threshold = Math.max(44, Math.min(96, (Number(width) || 390) * 0.16))
  const velocity = distance / Math.max(Number(elapsed) || 1, 1)
  if (distance < threshold && !(distance >= 24 && velocity >= 0.45)) return 0
  return dx < 0 ? 1 : -1
}

/** Keep the newly selected image visually empty until that exact image settles. */
export function galleryImageLoadState(currentId, settled) {
  if (!currentId) return 'idle'
  if (settled?.id !== currentId) return 'loading'
  return settled.status === 'error' ? 'error' : 'ready'
}
