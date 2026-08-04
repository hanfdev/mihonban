import { isIOSDevice } from './media.js'

const pendingLocates = new WeakMap()
const SETTLE_TOLERANCE = 1

function selectorEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}

export function trackScrollTop(row, scroller) {
  if (!row || !scroller) return 0
  const rowRect = row.getBoundingClientRect()
  const scrollerRect = scroller.getBoundingClientRect()
  const desired = scroller.scrollTop + rowRect.top + rowRect.height / 2
    - (scrollerRect.top + scrollerRect.height / 2)
  const maximum = Math.max(0, Number(scroller.scrollHeight || 0)
    - Number(scroller.clientHeight || 0))
  return Math.min(maximum, Math.max(0, desired))
}

/** Correct any layout shift left behind by a long programmatic scroll. */
export function centerTrackInScroller(row, scroller) {
  if (!row || !scroller) return 0
  const rowRect = row.getBoundingClientRect()
  const scrollerRect = scroller.getBoundingClientRect()
  const delta = rowRect.top + rowRect.height / 2
    - (scrollerRect.top + scrollerRect.height / 2)
  if (Math.abs(delta) <= SETTLE_TOLERANCE) return 0
  if (typeof scroller.scrollBy === 'function') {
    scroller.scrollBy({ top: delta, left: 0, behavior: 'auto' })
  } else {
    scroller.scrollTop += delta
  }
  return delta
}

/**
 * WebKit can leave a content-visibility list unpainted after a distant scripted
 * scroll. Materialize the current list before locating and keep it materialized
 * until the page unmounts; other pages retain the normal list optimization.
 */
export function materializeTrackListForIOS(row,
                                            browserNavigator = globalThis.navigator) {
  if (!isIOSDevice(browserNavigator)) return false
  const list = row?.closest?.('.flat-list')
  if (!list?.classList) return false
  list.classList.add('track-locate-materialized')
  void list.offsetHeight
  return true
}

/** Reveal the current track, then correct its final position after scrolling settles. */
export function locateTrackRow(currentId, root = globalThis.document,
                               browserNavigator = globalThis.navigator) {
  if (!currentId || !root?.querySelector) return false
  const id = selectorEscape(String(currentId))
  const row = root.querySelector(`.trow[data-tid="${id}"]`)
  if (!row) return false

  const scroller = row.closest?.('.main')
  const pendingKey = scroller || row
  pendingLocates.get(pendingKey)?.()

  const scheduleFrame = globalThis.requestAnimationFrame
    ? (callback) => globalThis.requestAnimationFrame(callback)
    : (callback) => setTimeout(callback, 16)
  const cancelFrame = globalThis.cancelAnimationFrame
    ? (handle) => globalThis.cancelAnimationFrame(handle)
    : (handle) => clearTimeout(handle)
  const materialized = materializeTrackListForIOS(row, browserNavigator)
  let finished = false
  let settling = false
  let idleTimer
  let fallbackTimer
  let startFrame
  let correctionFrame
  let flashTimer

  const removeScrollListeners = () => {
    scroller?.removeEventListener?.('scroll', noteScroll)
    scroller?.removeEventListener?.('scrollend', settle)
  }
  const clearPendingWork = () => {
    if (idleTimer) clearTimeout(idleTimer)
    if (fallbackTimer) clearTimeout(fallbackTimer)
    if (startFrame) cancelFrame(startFrame)
    if (correctionFrame) cancelFrame(correctionFrame)
  }
  const cancel = () => {
    if (finished) return
    finished = true
    removeScrollListeners()
    clearPendingWork()
    if (flashTimer) clearTimeout(flashTimer)
    if (pendingLocates.get(pendingKey) === cancel) pendingLocates.delete(pendingKey)
  }
  const finish = () => {
    if (finished) return
    finished = true
    removeScrollListeners()
    clearPendingWork()
    if (row.isConnected !== false) {
      row.classList.remove('flash')
      void row.offsetWidth
      row.classList.add('flash')
      flashTimer = setTimeout(() => row.classList.remove('flash'), 1700)
      flashTimer?.unref?.()
    }
    if (pendingLocates.get(pendingKey) === cancel) pendingLocates.delete(pendingKey)
  }
  const settle = () => {
    if (finished || settling) return
    settling = true
    removeScrollListeners()
    if (idleTimer) clearTimeout(idleTimer)
    if (fallbackTimer) clearTimeout(fallbackTimer)
    if (row.isConnected === false) { finish(); return }
    if (scroller) centerTrackInScroller(row, scroller)
    else row.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
    correctionFrame = scheduleFrame(() => {
      correctionFrame = null
      if (row.isConnected !== false && scroller) centerTrackInScroller(row, scroller)
      finish()
    })
  }
  const noteScroll = () => {
    if (settling || finished) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(settle, 180)
  }
  const start = () => {
    startFrame = null
    if (finished || row.isConnected === false) { cancel(); return }
    scroller?.addEventListener?.('scroll', noteScroll, { passive: true })
    scroller?.addEventListener?.('scrollend', settle, { once: true })
    fallbackTimer = setTimeout(settle, 2400)
    if (scroller?.scrollTo) {
      scroller.scrollTo({ top: trackScrollTop(row, scroller), left: 0,
        behavior: 'smooth' })
    } else {
      row.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    }
    noteScroll()
  }

  pendingLocates.set(pendingKey, cancel)
  if (materialized) {
    // Give WebKit one complete paint after removing content-visibility before
    // calculating a distant target; a single frame can still use stale geometry.
    startFrame = scheduleFrame(() => {
      startFrame = scheduleFrame(start)
    })
  } else {
    start()
  }
  return true
}
