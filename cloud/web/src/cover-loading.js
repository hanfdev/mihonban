export function coverLoadingProfile({ width = Infinity, coarsePointer = false } = {}) {
  if (width <= 720) return { priorityCount: 8, rootMargin: '640px 0px' }
  if (coarsePointer) return { priorityCount: 12, rootMargin: '800px 0px' }
  return { priorityCount: 12, rootMargin: '1200px 0px' }
}

export function currentCoverLoadingProfile(browserWindow = globalThis.window) {
  if (!browserWindow) return coverLoadingProfile()
  return coverLoadingProfile({
    width: browserWindow.innerWidth,
    coarsePointer: browserWindow.matchMedia?.('(pointer: coarse)').matches === true,
  })
}
