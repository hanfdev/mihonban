// Shared UI primitives: SVG icons, toasts, dialogs, and artwork components.
import React, { createContext, useCallback, useContext, useEffect,
                useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from './i18n.jsx'
import { fmtDur, fmtTotal } from './format.js'
import { hashOf } from './navigation.js'

export { fmtDur, fmtTotal }

const P = (d, extra = {}) => (props) => (
  <svg width={props.size || 18} height={props.size || 18} viewBox="0 0 24 24"
       fill={extra.fill ? 'currentColor' : 'none'}
       stroke={extra.fill ? 'none' : 'currentColor'}
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {d}
  </svg>
)

export const I = {
  play: P(<path d="M6 4.5v15l13-7.5z" />, { fill: true }),
  pause: P(<><rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/></>, { fill: true }),
  prev: P(<><path d="M19 5v14l-9-7z" /><rect x="5" y="5" width="3" height="14" rx="1"/></>, { fill: true }),
  next: P(<><path d="M5 5v14l9-7z" /><rect x="16" y="5" width="3" height="14" rx="1"/></>, { fill: true }),
  search: P(<><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></>),
  vol: P(<><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></>),
  upload: P(<><path d="M12 16V4m0 0 -4 4m4-4 4 4"/><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/></>),
  edit: P(<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>),
  trash: P(<><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></>),
  ext: P(<><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>),
  back: P(<path d="m15 18-6-6 6-6"/>),
  disc: P(<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/></>),
  check: P(<path d="m4 12.5 5 5L20 6.5"/>),
  x: P(<path d="M18 6 6 18M6 6l12 12"/>),
  html: P(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></>),
  spin: ({ size = 18, ...rest }) => (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </svg>
  ),
  heart: P(<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/>),
  heartFill: P(<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/>, { fill: true }),
  shuffle: P(<><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></>),
  repeat: P(<><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></>),
  repeat1: P(<><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1.5v4.5" strokeWidth="2.2"/></>),
  note: P(<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>),
  gear: P(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>),
  img: P(<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></>),
  plus: P(<path d="M12 5v14M5 12h14"/>),
  chevDown: P(<path d="m6 9 6 6 6-6"/>),
  chevL: P(<path d="m15 18-6-6 6-6"/>),
  chevR: P(<path d="m9 18 6-6-6-6"/>),
  user: P(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>),
  cloud: P(<path d="M17.5 19a4.5 4.5 0 0 0 .42-8.98 7 7 0 0 0-13.42 1.98A4 4 0 0 0 6 19.9z"/>),
  list: P(<><path d="M9 6h12"/><path d="M9 12h12"/><path d="M9 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></>),
  grip: P(<><circle cx="9" cy="5.5" r="1.4"/><circle cx="15" cy="5.5" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18.5" r="1.4"/><circle cx="15" cy="18.5" r="1.4"/></>, { fill: true }),
  chevUp: P(<path d="m18 15-6-6-6 6"/>),
  locate: P(<><path d="M2 12h3"/><path d="M19 12h3"/><path d="M12 2v3"/><path d="M12 19v3"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></>),
  eye: P(<><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.7"/></>),
  filterX: P(<><path d="M3 4h18l-7 8v6l-4 2v-8z"/><path d="m17 16 4 4m0-4-4 4"/></>),
}

export function VisibilityToggle({ on, onToggle, label, count = 0, compact = false }) {
  return (
    <button type="button"
            className={`visibility-toggle ${on ? 'on' : ''} ${compact ? 'compact' : ''}`}
            title={label} aria-label={label} aria-pressed={on}
            onClick={onToggle}>
      <span className="vis-orb"><I.eye size={compact ? 14 : 15} /></span>
      <span className="vis-label">{label}</span>
      {count > 0 && <span className="vis-count">{count}</span>}
    </button>
  )
}

export function ClearFilters({ count = 0, onClear, label }) {
  const buttonRef = useRef(null)

  useLayoutEffect(() => {
    const button = buttonRef.current
    const rail = button?.closest('.filters')
    if (!rail || !window.matchMedia('(max-width: 720px)').matches) return undefined

    // Android Chrome preserves the previously focused select as the scroll
    // anchor when this leading action mounts. Reset twice: once before paint,
    // then after the browser has finished native-select focus restoration.
    const revealStart = () => { rail.scrollLeft = 0 }
    revealStart()
    const frame = requestAnimationFrame(revealStart)
    return () => cancelAnimationFrame(frame)
  }, [count])

  if (!count) return null
  return (
    <button ref={buttonRef} type="button" className="clear-filters"
            title={label} aria-label={label} onClick={onClear}>
      <span className="clear-filters-icon"><I.filterX size={15} /></span>
      <span className="clear-filters-label">{label}</span>
      <span className="clear-filters-count" aria-hidden="true">{count}</span>
    </button>
  )
}

/* Marquee for long text: scroll only on overflow; otherwise remain static with an ellipsis fallback.
   Used for the playing title in list rows, the mini-player, and the full player.
   Measure the outer block container because an inline element's scrollWidth is
   always zero. Reset to one copy before measuring, following FilterSel's pattern. */
export function Marquee({ text }) {
  const box = useRef(null)
  const [roll, setRoll] = useState(false)
  useLayoutEffect(() => { setRoll(false) }, [text]) // Measure one copy before enabling the loop.
  useLayoutEffect(() => {
    const b = box.current
    if (!roll && b && b.scrollWidth > b.clientWidth + 1) setRoll(true)
  }, [roll, text])
  useEffect(() => { // Recalculate after rotation or resizing.
    const onResize = () => {
      setRoll(false)
      requestAnimationFrame(() => {
        const b = box.current
        if (b) setRoll(b.scrollWidth > b.clientWidth + 1)
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return (
    <span ref={box} className={`mq ${roll ? 'roll' : ''}`}>
      {roll
        ? <i style={{ animationDuration: `${Math.max(8, text.length * 0.5)}s` }}>
            <span>{text}</span><span aria-hidden>{text}</span>
          </i>
        : <i>{text}</i>}
    </span>
  )
}

/* Handle-driven pointer reordering shared by mouse and touch input.
   A drag starts only from an element carrying data-drag-handle. The remaining
   area stays free for playback clicks, vertical scrolling, and normal image
   behavior without long-press menus or the desktop no-drop cursor. During a
   reorder, active follows the dragged item so highlighting stays on the correct
   row or card. onMove(from,to) reorders live; onCommit persists it. */
export function usePointerReorder({ itemSelector, onMove, onCommit, enabled }) {
  const [active, setActive] = useState(-1)
  const st = useRef(null)

  useEffect(() => {
    if (!enabled) {
      st.current = null
      if (active >= 0) setActive(-1)
      document.body.classList.remove('reordering')
    }
  }, [enabled, active])
  useEffect(() => () => {
    st.current = null
    document.body.classList.remove('reordering')
  }, [])

  const idxAt = (x, y) => {
    const el = document.elementFromPoint(x, y)
    const item = el?.closest(itemSelector)
    if (!item?.parentElement) return -1
    return [...item.parentElement.querySelectorAll(`:scope > ${itemSelector}`)]
      .indexOf(item)
  }

  const end = () => {
    if (!st.current) return
    st.current = null
    onCommit()
    setActive(-1)
    document.body.classList.remove('reordering')
  }

  const dragProps = (i) => enabled ? {
    onPointerDown: (e) => {
      if (e.button != null && e.button !== 0) return
      if (!e.target.closest('[data-drag-handle]')) return // Start only from the handle.
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
      st.current = { i }
      setActive(i)
      document.body.classList.add('reordering')
      if (navigator.vibrate) navigator.vibrate(10)
      e.preventDefault()
    },
    onPointerMove: (e) => {
      const s = st.current
      if (!s) return
      e.preventDefault()
      const j = idxAt(e.clientX, e.clientY)
      if (j >= 0 && j !== s.i) { onMove(s.i, j); s.i = j; setActive(j) } // Keep highlighting aligned with the moved item.
    },
    onPointerUp: end,
    onPointerCancel: end,
    onDragStart: (e) => e.preventDefault(), // Block native image dragging, which causes the desktop forbidden cursor.
  } : {}

  return { active, dragProps }
}

export const Logo = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 96 96">
    <rect width="96" height="96" rx="22" fill="#1a1611"/>
    <circle cx="48" cy="48" r="31" fill="#12100d" stroke="#4a4132" strokeWidth="2.5"/>
    <circle cx="48" cy="48" r="23" fill="none" stroke="#2b251d" strokeWidth="1.5"/>
    {/* A sample record: an enlarged off-white label with a slightly skewed orange-red sample stamp. */}
    <circle cx="48" cy="48" r="12" fill="#ece3d0"/>
    <circle cx="48" cy="48" r="3" fill="#0d0b09"/>
    <g transform="rotate(-13 55 39)">
      <rect x="47" y="35.5" width="17" height="7" rx="2" fill="#e8542f"/>
      <path d="M51 38.9h9" stroke="#fff4e8" strokeWidth="1.2"
            strokeLinecap="round" opacity=".7"/>
    </g>
  </svg>
)

/* ---------- toast ---------- */

const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastHost({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((msg, kind = '') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* aria-live: toasts are the only feedback for many outcomes such as playback failure, format skips, and saves.
          Screen-reader users would otherwise receive no feedback. The persistent container announces new children. */}
      <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}
               role={t.kind === 'err' ? 'alert' : undefined}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------- dialog ---------- */

/* Portal every full-screen overlay to body. Rendering inside the .main scroll container makes iOS treat
 * position:fixed like absolute positioning, trapping the overlay in the container, scrolling it with content,
 * and placing shell bars above it. The body portal avoids all three.
 * For semantics and keyboard access, use role=dialog with aria-modal, move focus inside on open,
 * close with Escape, and restore focus afterward. */
let dialogTitleSeq = 0
// Dialog stack: a crop dialog can nest inside an edit dialog, and both are portaled to body.
// Independent window Escape listeners would close both at once and discard unsaved parent-form content.
// A shared stack lets only the top dialog respond. onClose stays current through a ref while the listener mounts once.
const dialogStack = []
export function Dialog({ title, onClose, children, className = '' }) {
  const boxRef = useRef(null)
  const [titleId] = useState(() => `dlg-t-${++dialogTitleSeq}`)
  // Capture the opener during render. Child autoFocus runs during commit, so reading document.activeElement in an effect
  // would capture the newly focused input instead and prevent correct focus restoration to the trigger.
  const [opener] = useState(() => document.activeElement)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const token = {}
    dialogStack.push(token)
    // Respect an existing autoFocus target; otherwise focus the dialog container.
    if (!boxRef.current?.contains(document.activeElement)) {
      boxRef.current?.focus()
    }
    const h = (e) => {
      if (e.key !== 'Escape') return
      if (dialogStack[dialogStack.length - 1] !== token) return // Only the top dialog responds.
      onCloseRef.current()
    }
    window.addEventListener('keydown', h)
    return () => {
      window.removeEventListener('keydown', h)
      const i = dialogStack.indexOf(token)
      if (i !== -1) dialogStack.splice(i, 1)
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
    // Run once on mount and unmount; onClose uses a ref and the opener is already fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${className}`.trim()} role="dialog" aria-modal="true"
           aria-labelledby={titleId} tabIndex={-1} ref={boxRef}>
        <h3 id={titleId}>{title}</h3>
        {children}
      </div>
    </div>,
    document.body
  )
}

/* ---------- Unified filter pill ----------
 * Equal-width pill with a transparent native select overlay, preserving system menu behavior.
 * The selected label scrolls only when it does not fit. */
export function FilterSel({ value, onChange, on, children }) {
  const tRef = useRef(null)
  const selRef = useRef(null)
  const [label, setLabel] = useState('')
  const [roll, setRoll] = useState(false)

  useEffect(() => {   // Synchronize the selected label; React skips an unchanged state value.
    const s = selRef.current
    if (s) setLabel(s.options[s.selectedIndex]?.text || '')
  })
  useLayoutEffect(() => { setRoll(false) }, [label]) // Measure one copy first.
  useLayoutEffect(() => {
    const el = tRef.current
    if (!roll && el && el.scrollWidth > el.clientWidth + 1) setRoll(true)
  }, [roll, label])

  return (
    <span className={`fsel ${on ? 'on' : ''}`} title={label}>
      <span className={`fsel-t ${roll ? 'roll' : ''}`} ref={tRef}>
        {roll
          ? <i><span>{label}</span><span>{label}</span></i>
          : <i>{label}</i>}
      </span>
      <select ref={selRef} value={value} onChange={onChange}>{children}</select>
    </span>
  )
}

/* Build an independent in-app history chain for each page load and store the actual depth in history.state.
   Back and forward navigation restore the corresponding value naturally, unlike
   a monotonic counter that eventually misclassifies the state and exits the site. */
const NAV_SESSION = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const NAV_STATE = '__mihonbanNav'
const initialHistoryState = history.state && typeof history.state === 'object'
  ? history.state : {}
history.replaceState({ ...initialHistoryState,
  [NAV_STATE]: { session: NAV_SESSION, depth: 0 } }, '')

export const navigate = (value, { replace = false } = {}) => {
  const hash = hashOf(value)
  if (location.hash === hash) return
  const state = history.state && typeof history.state === 'object'
    ? history.state : {}
  const current = state[NAV_STATE]
  const depth = current?.session === NAV_SESSION
    ? Math.max(0, Number(current.depth) || 0) : 0
  const nextState = { ...state,
    [NAV_STATE]: { session: NAV_SESSION, depth: replace ? depth : depth + 1 } }
  if (replace) history.replaceState(nextState, '', hash)
  else history.pushState(nextState, '', hash)
  // pushState/replaceState do not emit hashchange; App only needs to reparse the current hash.
  window.dispatchEvent(new Event('hashchange'))
}

/* Smart Back: a direct deep link has depth=0, so return home instead of leaving the site. */
export const goBack = () => {
  const current = history.state?.[NAV_STATE]
  if (current?.session === NAV_SESSION && Number(current.depth) > 0) {
    history.back()
  } else {
    navigate('/', { replace: true })
  }
}

export function Rating({ value, na, unratedLabel }) {
  if (value == null) {
    return na ? <span className="rating-pill na">{unratedLabel || '—'}</span> : null
  }
  return <span className="rating-pill">{value.toFixed(2)}</span>
}

/** Favorite heart: administrators can toggle it; listeners see it only as a marker when active. */
export function Heart({ on, canEdit, onToggle, size = 16, labels }) {
  const { t } = useI18n()
  if (!on && !canEdit) return null
  const L = labels || {}
  const label = canEdit
    ? (on ? (L.unfav || t('common.unfav')) : (L.fav || t('common.fav')))
    : (L.faved || t('common.faved'))
  return (
    <button className={`heart-btn ${on ? 'on' : ''} ${canEdit ? '' : 'ro'}`}
            title={label} aria-label={label}
            onClick={(e) => { e.stopPropagation(); if (canEdit) onToggle() }}>
      {on ? <I.heartFill size={size} /> : <I.heart size={size} />}
    </button>
  )
}

/* ---------- Markdown (zero-dependency compact renderer) ----------
 * Escape all HTML before replacements, so every emitted tag is ours and injection is excluded by construction.
 * Supports headings, bold, italics, inline/fenced code, HTTP links, quotes, ordered/unordered lists,
 * horizontal rules, and simple tables, which is sufficient for generated artist biographies. */

const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const mdInline = (s) => s
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

export const mdToHtml = (src) => {
  const lines = escHtml(String(src || "").replace(/\r\n?/g, "\n")).split("\n")
  const out = []
  let para = [], list = null, quote = [], code = null, table = null
  const flushP = () => {
    if (para.length) out.push(`<p>${para.map(mdInline).join("<br/>")}</p>`)
    para = []
  }
  const flushL = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) =>
      `<li>${mdInline(i)}</li>`).join("")}</${list.tag}>`)
    list = null
  }
  const flushQ = () => {
    if (quote.length) out.push(
      `<blockquote>${quote.map(mdInline).join("<br/>")}</blockquote>`)
    quote = []
  }
  const flushT = () => {
    if (table && table.rows.length) {
      const [head, ...rest] = table.rows
      const tr = (cells, tag) =>
        `<tr>${cells.map((c) => `<${tag}>${mdInline(c)}</${tag}>`).join("")}</tr>`
      out.push(`<table>${table.hasHead
        ? `<thead>${tr(head, "th")}</thead><tbody>${rest.map((r) => tr(r, "td")).join("")}</tbody>`
        : `<tbody>${table.rows.map((r) => tr(r, "td")).join("")}</tbody>`}</table>`)
    }
    table = null
  }
  const flushAll = () => { flushP(); flushL(); flushQ(); flushT() }

  for (const raw of lines) {
    if (code !== null) {
      if (/^```/.test(raw)) { out.push(`<pre><code>${code.join("\n")}</code></pre>`); code = null }
      else code.push(raw)
      continue
    }
    const line = raw.trimEnd()
    if (/^```/.test(line.trim())) { flushAll(); code = []; continue }
    if (!line.trim()) { flushAll(); continue }
    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) {
      flushAll()
      const lv = h[1].length + 2 // Map # to h3 so body content cannot introduce oversized headings.
      out.push(`<h${lv}>${mdInline(h[2])}</h${lv}>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushAll(); out.push("<hr/>"); continue }
    const tb = line.trim().match(/^\|(.+)\|$/)
    if (tb) {
      flushP(); flushL(); flushQ()
      const cells = tb[1].split("|").map((s) => s.trim())
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        if (table) table.hasHead = true // Table-header separator row
      } else {
        if (!table) table = { rows: [], hasHead: false }
        table.rows.push(cells)
      }
      continue
    }
    flushT()
    const q = line.match(/^&gt;\s?(.*)/) // Escaped ">"
    if (q) { flushP(); flushL(); quote.push(q[1]); continue }
    const ul = line.match(/^\s*[-*•]\s+(.*)/)
    if (ul) {
      flushP(); flushQ()
      if (!list || list.tag !== "ul") { flushL(); list = { tag: "ul", items: [] } }
      list.items.push(ul[1]); continue
    }
    const ol = line.match(/^\s*\d+[.、)]\s+(.*)/)
    if (ol) {
      flushP(); flushQ()
      if (!list || list.tag !== "ol") { flushL(); list = { tag: "ol", items: [] } }
      list.items.push(ol[1]); continue
    }
    flushL(); flushQ(); para.push(line)
  }
  if (code) out.push(`<pre><code>${code.join("\n")}</code></pre>`)
  flushAll()
  return out.join("")
}

export const Md = ({ text, className = "" }) => (
  <div className={`md ${className}`}
       dangerouslySetInnerHTML={{ __html: mdToHtml(text) }} />
)

/* ---------- Reader for long-form content such as full artist biographies ----------
 * Centered card on desktop, upward full-screen sheet on mobile, with compositor-only open/close animations. */

export function Reader({ kicker, title, avatar, square, onClose, children }) {
  const { t } = useI18n()
  const [closing, setClosing] = useState(false)
  const close = useCallback(() => setClosing(true), [])

  useEffect(() => {
    if (!closing) return
    const t = setTimeout(onClose, 420) // Fallback if the animation-end event is missed.
    return () => clearTimeout(t)
  }, [closing, onClose])

  useEffect(() => {
    const h = (e) => e.key === "Escape" && close()
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [close])

  return createPortal(
    <div className={`reader ${closing ? "out" : ""}`}
         onMouseDown={(e) => e.target === e.currentTarget && close()}
         onAnimationEnd={(e) => {
           if (closing && e.target === e.currentTarget) onClose()
         }}>
      <article className="reader-card">
        <header className="reader-head">
          {avatar && <img className={`reader-ava ${square ? "sq" : ""}`}
                          src={avatar} alt="" />}
          <div className="reader-id">
            {kicker && <div className="reader-kicker">{kicker}</div>}
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" title={t('reader.close')} onClick={close}>
            <I.x size={20} />
          </button>
        </header>
        <div className="reader-body">{children}</div>
      </article>
    </div>,
    document.body
  )
}

/** Biography body with Markdown rendering and long-text truncation.
 *  With onMore, the full text opens in Reader; without it, use the legacy inline expansion. */
export function NoteText({ text, clampLines = 5, onMore }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  if (!text) return null
  const long = text.length > 180 || text.split('\n').length > clampLines
  return (
    <div className="note-text">
      <div className={`note-body ${!open && long ? 'clamp' : ''}`}
           style={{ '--clamp': clampLines }}><Md text={text} /></div>
      {long && (onMore
        ? <button className="bio-read" onClick={onMore}>
            {t('md.more')} <I.chevR size={13} />
          </button>
        : <button className="note-more" onClick={() => setOpen(!open)}>
            {open ? t('md.collapse') : t('md.expand')}
          </button>)}
    </div>
  )
}

/** Image cropper with drag positioning and wheel/slider zoom; round=true previews a circular mask.
 *  Emits an out×out JPEG blob through onDone with no third-party dependency. */
export function CropDialog({ file, title, round = false,
                             out = 640, onClose, onDone }) {
  const { t } = useI18n()
  const [img, setImg] = useState(null)     // HTMLImageElement
  const [zoom, setZoom] = useState(1)      // Multiplier relative to cover-fit
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const drag = useRef(null)
  const vpRef = useRef(null)
  const VP = 300                           // Square viewport size in CSS pixels

  useEffect(() => {
    let active = true
    setImg(null)
    setLoadError(false)
    setZoom(1)
    setPos({ x: 0, y: 0 })
    const url = URL.createObjectURL(file)
    const i = new Image()
    i.onload = () => { if (active) setImg(i) }
    i.onerror = () => { if (active) setLoadError(true) }
    i.src = url
    return () => { active = false; URL.revokeObjectURL(url) }
  }, [file])

  const base = img ? Math.max(VP / img.width, VP / img.height) : 1
  const scale = base * zoom

  const clampPos = (p, z = zoom) => {
    if (!img) return p
    const s = base * z
    const maxX = Math.max(0, (img.width * s - VP) / 2)
    const maxY = Math.max(0, (img.height * s - VP) / 2)
    return { x: Math.min(maxX, Math.max(-maxX, p.x)),
             y: Math.min(maxY, Math.max(-maxY, p.y)) }
  }

  const setZoomKeep = (z) => {
    const nz = Math.min(5, Math.max(1, z))
    setZoom(nz)
    setPos((p) => clampPos({ x: p.x * (nz / zoom), y: p.y * (nz / zoom) }, nz))
  }

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
  }
  const onPointerMove = (e) => {
    if (!drag.current) return
    setPos(clampPos({
      x: drag.current.px + (e.clientX - drag.current.x),
      y: drag.current.py + (e.clientY - drag.current.y),
    }))
  }
  const onPointerUp = () => { drag.current = null }
  // React 18 delegates onWheel at the root with a passive listener, so preventDefault has no effect and wheel zoom
  // also scrolls the dialog/page. Use a native non-passive listener; a ref keeps the handler current while mounting once.
  const wheelZoom = useRef(null)
  wheelZoom.current = (delta) => setZoomKeep(zoom * (1 - delta * 0.0012))
  useEffect(() => {
    const el = vpRef.current
    if (!el) return
    const handler = (e) => {
      e.preventDefault()
      wheelZoom.current?.(e.deltaY)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const done = async () => {
    if (!img) return
    setBusy(true)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = out
    const ctx = canvas.getContext('2d')
    const left = VP / 2 - (img.width * scale) / 2 + pos.x
    const top = VP / 2 - (img.height * scale) / 2 + pos.y
    ctx.drawImage(img, -left / scale, -top / scale, VP / scale, VP / scale,
                  0, 0, out, out)
    canvas.toBlob((b) => {
      setBusy(false)
      if (b) onDone(b)
    }, 'image/jpeg', 0.92)
  }

  const w = img ? img.width * scale : 0
  const h = img ? img.height * scale : 0

  return (
    <Dialog title={title || t('crop.title')} onClose={onClose}>
      <div className="crop-wrap">
        <div className={`crop-vp ${round ? 'round' : ''}`} ref={vpRef}
             onPointerDown={onPointerDown} onPointerMove={onPointerMove}
             onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          {img && (
            <img src={img.src} alt="" draggable={false} style={{
              width: w, height: h,
              left: VP / 2 - w / 2 + pos.x,
              top: VP / 2 - h / 2 + pos.y,
            }} />
          )}
          {!img && !loadError && <span className="crop-loading"><I.spin size={22} /></span>}
          {loadError && <span className="crop-loading error">{t('crop.loadFail')}</span>}
          {round && <div className="crop-mask" />}
        </div>
        <div className="crop-zoom">
          <I.img size={13} />
          <input type="range" min="1" max="5" step="0.01" value={zoom}
                 aria-label={t('common.zoom')}
                 style={{ '--fill': `${(zoom - 1) / 4 * 100}%` }}
                 onChange={(e) => setZoomKeep(Number(e.target.value))} />
          <I.img size={19} />
        </div>
        <div className="hint" style={{ color: 'var(--ink-faint)', fontSize: 12, textAlign: 'center' }}>
          {t('crop.hint')}
        </div>
      </div>
      <div className="actions">
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!img || busy} onClick={done}>
          {busy ? <I.spin /> : t('crop.apply')}
        </button>
      </div>
    </Dialog>
  )
}
