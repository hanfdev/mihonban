// 共用 UI：SVG 图标、Toast、对话框、封面组件
import React, { createContext, useCallback, useContext, useEffect,
                useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from './i18n.jsx'
import { fmtDur, fmtTotal } from './format.js'

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

/* 超长文字跑马灯：溢出才循环滚动，不溢出就静态显示（省略号兜底）。
   用于正在播放的歌名（列表行 / 迷你条 / 播放页）。
   量宽必须量外层 block 容器（inline 元素 scrollWidth 恒为 0），
   且先复位成单份内容再量，与 FilterSel 同一套路。 */
export function Marquee({ text }) {
  const box = useRef(null)
  const [roll, setRoll] = useState(false)
  useLayoutEffect(() => { setRoll(false) }, [text]) // 先按单份内容量宽
  useLayoutEffect(() => {
    const b = box.current
    if (!roll && b && b.scrollWidth > b.clientWidth + 1) setRoll(true)
  }, [roll, text])
  useEffect(() => { // 转屏/改窗后复位重量
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

/* 指针拖拽重排（手柄驱动，跨鼠标/触屏统一）。
   只有从带 data-drag-handle 的元素按下才起拖——其余区域完全自由：可点击播放、
   可竖向滚动、图片正常（不再长按误触系统图片菜单/桌面禁止光标）。
   重排时 active 跟随被拖项移动，高亮始终落在正确的行/卡。
   onMove(from,to) 实时重排，onCommit 落库。 */
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
      if (!e.target.closest('[data-drag-handle]')) return // 只认手柄
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
      if (j >= 0 && j !== s.i) { onMove(s.i, j); s.i = j; setActive(j) } // 高亮跟随
    },
    onPointerUp: end,
    onPointerCancel: end,
    onDragStart: (e) => e.preventDefault(), // 阻断原生图片拖拽（桌面禁止光标根因）
  } : {}

  return { active, dragProps }
}

export const Logo = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 96 96">
    <rect width="96" height="96" rx="22" fill="#1a1611"/>
    <circle cx="48" cy="48" r="30" fill="none" stroke="#4a4132" strokeWidth="2.5"/>
    <circle cx="48" cy="48" r="21" fill="none" stroke="#332d24" strokeWidth="1.5"/>
    {/* 見本盤 = 白标宣传盘：米白唱标 + 一枚盖歪了的橙色「見本」章 */}
    <circle cx="48" cy="48" r="10" fill="#ece3d0"/>
    <circle cx="48" cy="48" r="2.6" fill="#0d0b09"/>
    <rect x="46.5" y="39.8" width="10" height="5.2" rx="1.2" fill="#e8542f"
          transform="rotate(-12 51.5 42.4)"/>
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
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------- dialog ---------- */

/* 所有全屏弹层都 portal 到 body：
 * 若渲染在 .main 滚动容器里，iOS 会把 position:fixed 降级成绝对定位
 * （被困在容器里、跟着内容滚、被壳的栏盖住）。挂到 body 一劳永逸。 */
export function Dialog({ title, onClose, children }) {
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <h3>{title}</h3>
        {children}
      </div>
    </div>,
    document.body
  )
}

/* ---------- 统一筛选药丸 ----------
 * 等宽药丸 + 透明的原生 select 盖在上面（保留系统选单交互）。
 * 选中项文字放不下时循环滚动展示。 */
export function FilterSel({ value, onChange, on, children }) {
  const tRef = useRef(null)
  const selRef = useRef(null)
  const [label, setLabel] = useState('')
  const [roll, setRoll] = useState(false)

  useEffect(() => {   // 同步选中项文字（setState 同值时 React 自动跳过）
    const s = selRef.current
    if (s) setLabel(s.options[s.selectedIndex]?.text || '')
  })
  useLayoutEffect(() => { setRoll(false) }, [label]) // 先按单份内容量宽
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

/* 每次页面加载建立独立的站内历史链。用 history.state 记录真实深度，
   前进/后退会自然恢复对应值，不会像单调计数器那样最终误判并退出站点。 */
const NAV_SESSION = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const NAV_STATE = '__mihonbanNav'
const initialHistoryState = history.state && typeof history.state === 'object'
  ? history.state : {}
history.replaceState({ ...initialHistoryState,
  [NAV_STATE]: { session: NAV_SESSION, depth: 0 } }, '')

const hashOf = (value) => {
  const path = String(value || '/').replace(/^#/, '')
  return `#${path.startsWith('/') ? path : `/${path}`}`
}

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
  // pushState/replaceState 不触发 hashchange；App 只需要重新解析当前 hash。
  window.dispatchEvent(new Event('hashchange'))
}

/* 智能返回：深链直进时 depth=0，回首页而不是离开网站。 */
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

/** 收藏心形：管理员可点，普通用户只在已收藏时显示为标记。 */
export function Heart({ on, canEdit, onToggle, size = 16, labels }) {
  if (!on && !canEdit) return null
  const L = labels || {}
  return (
    <button className={`heart-btn ${on ? 'on' : ''} ${canEdit ? '' : 'ro'}`}
            title={canEdit ? (on ? (L.unfav || 'Unfavorite') : (L.fav || 'Favorite'))
              : (L.faved || 'Favorited')}
            onClick={(e) => { e.stopPropagation(); if (canEdit) onToggle() }}>
      {on ? <I.heartFill size={size} /> : <I.heart size={size} />}
    </button>
  )
}

/* ---------- Markdown（零依赖迷你渲染器） ----------
 * 先整体 HTML 转义再做替换，产出的标签只可能是我们自己写的，天然防注入。
 * 支持：标题 #~####、**粗**、*斜*、`code`、代码块、[链接](http…)、
 * 引用、有序/无序列表、分隔线、简单表格。够用于 AI 生成的艺人简介。 */

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
      const lv = h[1].length + 2 // # → h3，避免正文里出现巨大标题
      out.push(`<h${lv}>${mdInline(h[2])}</h${lv}>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushAll(); out.push("<hr/>"); continue }
    const tb = line.trim().match(/^\|(.+)\|$/)
    if (tb) {
      flushP(); flushL(); flushQ()
      const cells = tb[1].split("|").map((s) => s.trim())
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        if (table) table.hasHead = true // 表头分隔行
      } else {
        if (!table) table = { rows: [], hasHead: false }
        table.rows.push(cells)
      }
      continue
    }
    flushT()
    const q = line.match(/^&gt;\s?(.*)/) // 转义后的 ">"
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

/* ---------- Reader：长文阅读弹层（艺人完整简介等） ----------
 * 桌面居中卡片、移动端全屏上滑；开合都是合成器动画。 */

export function Reader({ kicker, title, avatar, square, onClose, children }) {
  const [closing, setClosing] = useState(false)
  const close = useCallback(() => setClosing(true), [])

  useEffect(() => {
    if (!closing) return
    const t = setTimeout(onClose, 420) // 动画结束事件的兜底
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
          <button className="icon-btn" title="Close (Esc)" onClick={close}>
            <I.x size={20} />
          </button>
        </header>
        <div className="reader-body">{children}</div>
      </article>
    </div>,
    document.body
  )
}

/** 简介正文：Markdown 渲染，长文截断。
 *  传 onMore = 点「阅读全文」打开弹层（Reader）；不传 = 旧式原地展开。 */
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

/** 图片裁剪：拖动取景 + 滚轮/滑杆缩放，round=true 时圆形遮罩预览。
 *  输出 out×out 的 JPEG blob（onDone）。无第三方依赖。 */
export function CropDialog({ file, title, round = false,
                             out = 640, onClose, onDone }) {
  const { t } = useI18n()
  const [img, setImg] = useState(null)     // HTMLImageElement
  const [zoom, setZoom] = useState(1)      // 相对 cover-fit 的倍数
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const drag = useRef(null)
  const VP = 300                           // 视口 CSS 像素（正方形）

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const i = new Image()
    i.onload = () => setImg(i)
    i.src = url
    return () => URL.revokeObjectURL(url)
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
  const onWheel = (e) => {
    e.preventDefault()
    setZoomKeep(zoom * (1 - e.deltaY * 0.0012))
  }

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
        <div className={`crop-vp ${round ? 'round' : ''}`}
             onPointerDown={onPointerDown} onPointerMove={onPointerMove}
             onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
             onWheel={onWheel}>
          {img && (
            <img src={img.src} alt="" draggable={false} style={{
              width: w, height: h,
              left: VP / 2 - w / 2 + pos.x,
              top: VP / 2 - h / 2 + pos.y,
            }} />
          )}
          {round && <div className="crop-mask" />}
        </div>
        <div className="crop-zoom">
          <I.img size={13} />
          <input type="range" min="1" max="5" step="0.01" value={zoom}
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
