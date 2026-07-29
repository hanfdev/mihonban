const pendingLocates = new WeakMap()

function selectorEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}

/** Correct any layout shift left behind by a long programmatic scroll. */
export function centerTrackInScroller(row, scroller) {
  if (!row || !scroller) return 0
  const rowRect = row.getBoundingClientRect()
  const scrollerRect = scroller.getBoundingClientRect()
  const delta = rowRect.top + rowRect.height / 2
    - (scrollerRect.top + scrollerRect.height / 2)
  if (Math.abs(delta) <= 1) return 0
  if (typeof scroller.scrollBy === 'function') {
    scroller.scrollBy({ top: delta, left: 0, behavior: 'auto' })
  } else {
    scroller.scrollTop += delta
  }
  return delta
}

/**
 * Reveal the current track and compensate once smooth scrolling has settled.
 *
 * `content-visibility: auto` deliberately estimates off-screen row geometry.
 * A distant smooth scroll can materialise rows on the way and shift its target;
 * the scroll-end correction makes the first locate click definitive.
 */
export function locateTrackRow(currentId, root = globalThis.document) {
  if (!currentId || !root?.querySelector) return false
  const id = selectorEscape(String(currentId))
  const row = root.querySelector(`.trow[data-tid="${id}"]`)
  if (!row) return false

  const scroller = row.closest?.('.main')
  const pendingKey = scroller || row
  pendingLocates.get(pendingKey)?.()

  let finished = false
  let settleTimer
  const cancel = () => {
    if (settleTimer) clearTimeout(settleTimer)
    scroller?.removeEventListener?.('scrollend', settle)
    if (pendingLocates.get(pendingKey) === cancel) pendingLocates.delete(pendingKey)
  }
  const settle = () => {
    if (finished) return
    finished = true
    cancel()
    if (row.isConnected === false) return
    if (scroller) centerTrackInScroller(row, scroller)
    else row.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
  }

  pendingLocates.set(pendingKey, cancel)
  scroller?.addEventListener?.('scrollend', settle, { once: true })
  // `scrollend` is not available in older Safari; it is also not emitted when
  // the requested destination already equals the current scroll position.
  settleTimer = setTimeout(settle, 900)
  row.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })

  row.classList.remove('flash')
  void row.offsetWidth
  row.classList.add('flash')
  setTimeout(() => row.classList.remove('flash'), 1700)
  return true
}
