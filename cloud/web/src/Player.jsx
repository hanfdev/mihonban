import React, { useEffect, useRef, useState } from 'react'
import { artUrl } from './api.js'
import { I, Heart, Marquee, fmtDur } from './ui.jsx'
import { useI18n } from './i18n.jsx'
import { clampMediaTime, mediaDuration, seekAudio, storedVolume } from './media.js'

/* 进度条：支持点按 + 拖动洗擦（scrub）。拖动中只更新预览，
 * 松手 onSeek 立刻跳到目标位置（UI 同步更新，不等缓冲）。
 * big 版 = 播放页：满宽长条，时间挂在两端下方，右侧显示剩余时间（Spotify 式）。 */
function SeekBar({ t, dur, big, onSeek }) {
  const barRef = useRef(null)
  const [scrub, setScrub] = useState(null) // 拖动中的预览进度 0..1
  const shown = scrub ?? (dur ? Math.min(t / dur, 1) : 0)

  const frac = (e) => {
    const r = barRef.current.getBoundingClientRect()
    return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1)
  }
  const down = (e) => {
    barRef.current.setPointerCapture(e.pointerId)
    setScrub(frac(e))
  }
  const move = (e) => { if (scrub !== null) setScrub(frac(e)) }
  const up = (e) => {
    if (scrub === null) return
    if (dur) onSeek(frac(e) * dur)
    setScrub(null)
  }

  const bar = (
    <div className={`p-bar ${scrub !== null ? 'scrubbing' : ''}`} ref={barRef}
         onPointerDown={down} onPointerMove={move}
         onPointerUp={up} onPointerCancel={() => setScrub(null)}>
      <div className="rail">
        <div className="fill" style={{ width: `${shown * 100}%` }} />
        <div className="dot" style={{ left: `${shown * 100}%` }} />
      </div>
    </div>
  )
  const cur = scrub !== null && dur ? scrub * dur : t

  if (big) {
    return (
      <div className="p-progress big">
        {bar}
        <div className="p-times">
          <span>{fmtDur(cur)}</span>
          <span>{dur ? `-${fmtDur(Math.max(dur - cur, 0))}` : '–:––'}</span>
        </div>
      </div>
    )
  }
  return (
    <div className="p-progress">
      <span className="p-time">{fmtDur(cur)}</span>
      {bar}
      <span className="p-time r">{fmtDur(dur)}</span>
    </div>
  )
}

function Controls({ playing, buffering, shuffle, repeat, onToggle, onStep,
                    onShuffle, onRepeat, big }) {
  const { t } = useI18n()
  return (
    <div className={`p-ctrl ${big ? 'big' : ''}`}>
      <button className={`icon-btn mode ${shuffle ? 'on' : ''}`}
              title={t('player.shuffle')} onClick={onShuffle}>
        <I.shuffle size={big ? 20 : 16} />
      </button>
      <button className="icon-btn" onClick={() => onStep(-1)}>
        <I.prev size={big ? 26 : 18} /></button>
      <button className={`icon-btn main ${playing ? 'on' : ''}`} onClick={onToggle}>
        {buffering ? <I.spin size={big ? 28 : 18} />
          : playing ? <I.pause size={big ? 28 : 18} />
          : <I.play size={big ? 28 : 18} />}
      </button>
      <button className="icon-btn" onClick={() => onStep(1)}>
        <I.next size={big ? 26 : 18} /></button>
      <button className={`icon-btn mode ${repeat !== 'off' ? 'on' : ''}`}
              title={repeat === 'one' ? t('player.repeatOne') : repeat === 'all' ? t('player.repeatAll') : t('player.repeatOff')}
              onClick={onRepeat}>
        {repeat === 'one' ? <I.repeat1 size={big ? 20 : 16} />
          : <I.repeat size={big ? 20 : 16} />}
      </button>
    </div>
  )
}

export default function Player({ audioRef, current, playing, shuffle, repeat,
                                 onToggle, onStep, onShuffle, onRepeat,
                                 npOpen, setNpOpen, isAdmin, fav, onFav,
                                 onOpenAlbum, onOpenArtist }) {
  const { t: __ } = useI18n()
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [buffering, setBuffering] = useState(false)
  const [vol, setVol] = useState(() => {
    let saved = null
    try { saved = localStorage.getItem('mihonban_volume') } catch { /* storage unavailable */ }
    return storedVolume(saved)
  })
  const [closing, setClosing] = useState(false) // 播放页滑出动画中
  const npHistoryRef = useRef(null)
  const pendingSheetNav = useRef(null)
  const retryArtFromOrigin = (event, size) => {
    const image = event.currentTarget
    if (image.dataset.originRetry === '1') return
    image.dataset.originRetry = '1'
    image.src = artUrl(current.albumId, size, true)
  }

  useEffect(() => {
    const a = audioRef.current
    if (a) a.volume = vol
  }, [audioRef, vol])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    // seeking 也在监听里：拖完进度条 UI 立刻跳到目标位置，不等缓冲追上
    const onTime = () => {
      // Safari/iOS 会把部分 OGG 的 duration 估成不断增长的值；曲库解析值优先。
      const stableDuration = mediaDuration(current?.duration, a.duration)
      setT(clampMediaTime(a.currentTime, stableDuration))
      if (stableDuration) setDur(stableDuration)
    }
    const busy = () => setBuffering(true)
    const idle = () => setBuffering(false)
    const timeEvs = ['loadedmetadata', 'timeupdate', 'durationchange', 'seeking']
    const busyEvs = ['loadstart', 'waiting']       // 换源 / 数据不够停住
    const idleEvs = ['playing', 'canplay', 'seeked', 'error'] // 恢复供数/出错收尾
    timeEvs.forEach((e) => a.addEventListener(e, onTime))
    busyEvs.forEach((e) => a.addEventListener(e, busy))
    idleEvs.forEach((e) => a.addEventListener(e, idle))
    return () => {
      timeEvs.forEach((e) => a.removeEventListener(e, onTime))
      busyEvs.forEach((e) => a.removeEventListener(e, busy))
      idleEvs.forEach((e) => a.removeEventListener(e, idle))
    }
  }, [audioRef, current?.duration])

  // 切歌：进度立刻归零、时长先用曲目元数据占位，metadata 到了再校正
  useEffect(() => {
    setT(0)
    setDur(mediaDuration(current?.duration, 0))
  }, [current?.id])

  // seek 统一入口：先把 UI 顶到目标位置再动 audio，绝无回跳
  const doSeek = (sec) => {
    const a = audioRef.current
    if (!a) return
    const target = seekAudio(a, sec, current?.duration)
    setT(target)
  }

  useEffect(() => {
    document.body.classList.toggle('np-lock', npOpen)
    return () => document.body.classList.remove('np-lock')
  }, [npOpen])

  // 收起 = 先播滑出动画，动画结束再卸载（有 400ms 兜底）
  const closeSheet = () => setClosing(true)
  const finishClose = () => { setNpOpen(false); setClosing(false) }
  useEffect(() => {
    if (!closing) return
    const t = setTimeout(finishClose, 400)
    return () => clearTimeout(t)
  }, [closing])

  useEffect(() => {
    if (!npOpen) return
    const h = (e) => e.key === 'Escape' && closeSheet()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [npOpen])

  /* 系统返回键/手势：播放页打开时压入一条历史记录（同 URL，不惊动 hash 路由），
   * 第一次返回只收回播放页。手动收回（下滑/X/Esc）时把这条记录消费掉；
   * 若期间跳去了别的页面（点歌名/艺人），当前记录已不是我们压的那条，就不动历史。 */
  useEffect(() => {
    if (!npOpen) return
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    npHistoryRef.current = token
    const state = history.state && typeof history.state === 'object'
      ? history.state : {}
    history.pushState({ ...state, __mihonbanNowPlaying: token }, '')
    const onPop = () => {
      if (npHistoryRef.current !== token) return
      const action = pendingSheetNav.current
      pendingSheetNav.current = null
      if (action) {
        setClosing(false)
        setNpOpen(false)
        setTimeout(action, 0)
      } else {
        closeSheet()
      }
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (npHistoryRef.current === token) npHistoryRef.current = null
      if (history.state?.__mihonbanNowPlaying === token) history.back()
    }
  }, [npOpen])

  /* 播放页下滑收回（Spotify 式）：任意区域按住下拉，页面跟手；
   * 松手时拉得够远或够快就顺势滑出，否则弹回。只认触屏/笔，不劫持
   * 按钮点按和进度条拖动。 */
  const sheetRef = useRef(null)
  const swipe = useRef(null)
  const barSwipe = useRef(null) // 迷你条上滑手势（hook 必须在下面的 early return 之前）
  const suppressBarClick = useRef(false)
  const spDown = (e) => {
    if (e.pointerType === 'mouse' || !e.isPrimary || closing) return
    if (e.target.closest('button, input, a, .p-bar')) return
    swipe.current = { y0: e.clientY, x0: e.clientX,
                      lastY: e.clientY, lastT: e.timeStamp, vy: 0, on: false }
  }
  const spMove = (e) => {
    const s = swipe.current
    if (!s || !e.isPrimary) return
    const dy = e.clientY - s.y0, dx = e.clientX - s.x0
    if (!s.on) {
      if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return // 触发死区
      if (dy <= 0 || Math.abs(dy) <= Math.abs(dx)) {     // 上滑/横滑不是收回
        swipe.current = null
        return
      }
      s.on = true
    }
    const dt = e.timeStamp - s.lastT
    if (dt > 0) s.vy = (e.clientY - s.lastY) / dt // px/ms，用于甩动判定
    s.lastY = e.clientY; s.lastT = e.timeStamp
    const el = sheetRef.current
    if (el) {
      el.style.transition = 'none'
      el.style.transform = `translateY(${Math.max(dy, 0)}px)`
    }
  }
  const spUp = (e) => {
    const s = swipe.current
    swipe.current = null
    if (!s || !s.on) return
    const el = sheetRef.current
    const dy = e.clientY - s.y0
    const h = el?.offsetHeight || window.innerHeight
    if (dy > h * 0.25 || s.vy > 0.55) {
      closeSheet() // .out 动画从当前位置继续滑出
    } else if (el) {
      el.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1)'
      el.style.transform = ''
      setTimeout(() => { const n = sheetRef.current; if (n) n.style.transition = '' }, 320)
    }
  }

  if (!current) return null
  const frac = dur ? Math.min(t / dur, 1) : 0
  const ctrl = { playing, buffering, shuffle, repeat,
                 onToggle, onStep, onShuffle, onRepeat }

  const setVolume = (v) => {
    setVol(v)
    try { localStorage.setItem('mihonban_volume', String(v)) } catch { /* storage unavailable */ }
  }
  const volSlider = (
    <input type="range" min="0" max="1" step="0.02" value={vol}
           style={{ '--fill': `${vol * 100}%` }}
           onChange={(e) => setVolume(Number(e.target.value))} />
  )
  const leaveSheetFor = (action) => {
    const token = npHistoryRef.current
    if (token && history.state?.__mihonbanNowPlaying === token) {
      pendingSheetNav.current = action
      history.back()
      return
    }
    closeSheet()
    action()
  }
  const goAlbum = () => leaveSheetFor(onOpenAlbum)
  const goArtist = () => leaveSheetFor(() => onOpenArtist(current.artist))

  /* 迷你条上滑 = 展开播放页（与播放页下滑收回互为镜像）。
   * pointer + touch 双通道：iOS Safari 上 pointer 有时被 pan 手势吞掉，
   * touch 作兜底。封面和文字既可短按导航，也可作为上滑起点；只有
   * 进度和音量滑块不参与手势。播放按钮同样支持短按控制、上滑展开。 */
  // 注意：barSwipe ref 已在 early return 前声明
  const startBarSwipe = (x, y) => {
    if (npOpen || window.innerWidth > 900) return
    suppressBarClick.current = false
    barSwipe.current = { y0: y, x0: x }
  }
  const moveBarSwipe = (x, y) => {
    const s = barSwipe.current
    if (!s) return false
    const dy = y - s.y0, dx = x - s.x0
    // 明确向上拖动且纵向主导才展开，避免轻微手抖触发。
    if (dy < -18 && Math.abs(dy) >= Math.abs(dx) * 1.05) {
      barSwipe.current = null
      suppressBarClick.current = true
      setNpOpen(true)
      return true
    } else if (dy > 24 || Math.abs(dx) > 40) {
      barSwipe.current = null
    }
    return false
  }
  const endBarSwipe = () => { barSwipe.current = null }

  const barControl = (t) => t?.closest?.('input, .p-bar, .p-vol')

  const barDown = (e) => {
    if (!e.isPrimary || e.pointerType === 'mouse' || npOpen) return
    suppressBarClick.current = false
    if (barControl(e.target)) return
    startBarSwipe(e.clientX, e.clientY)
  }
  const barMove = (e) => {
    if (!e.isPrimary) return
    if (moveBarSwipe(e.clientX, e.clientY)) e.preventDefault()
  }
  // touch 兜底：短按不拦截 click，确认是上滑后才阻止浏览器默认手势。
  const barTouchStart = (e) => {
    if (npOpen || !e.touches?.[0]) return
    suppressBarClick.current = false
    if (barControl(e.target)) return
    const t = e.touches[0]
    startBarSwipe(t.clientX, t.clientY)
  }
  const barTouchMove = (e) => {
    if (!e.touches?.[0] || !barSwipe.current) return
    const t = e.touches[0]
    const dy = t.clientY - barSwipe.current.y0
    const dx = t.clientX - barSwipe.current.x0
    // 确认是上滑手势后再 preventDefault，避免抢页面滚动
    if (dy < -6 && Math.abs(dy) > Math.abs(dx)) {
      e.preventDefault()
    }
    moveBarSwipe(t.clientX, t.clientY)
  }
  const barClickCapture = (e) => {
    if (!suppressBarClick.current) return
    suppressBarClick.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  // On mobile the compact bar has intentional breathing room beside the
  // title. Tapping that non-control area opens the full player sheet; the
  // title, artist and album buttons keep their existing navigation behavior.
  const blankBarClick = (e) => {
    if (window.innerWidth > 900 || npOpen || e.target.closest('button, input, a, .p-bar, .p-vol')) return
    setNpOpen(true)
  }

  return (
    <>
      <footer className="player"
              onPointerDown={barDown}
              onPointerMove={barMove}
              onPointerUp={endBarSwipe}
              onPointerCancel={endBarSwipe}
              onTouchStart={barTouchStart}
              onTouchMove={barTouchMove}
              onTouchEnd={endBarSwipe}
              onTouchCancel={endBarSwipe}
              onClickCapture={barClickCapture}
              onClick={blankBarClick}>
        {/* 移动端：迷你条顶上的细进度线 */}
        <div className="p-mini-rail"><i style={{ width: `${frac * 100}%` }} /></div>
        <button type="button" className="p-cover-hit"
                aria-label={`${current.title} — ${current.artist}`}
                onClick={() => setNpOpen(true)}>
          <img className="p-cover" src={artUrl(current.albumId, 120)} alt=""
               onError={(event) => retryArtFromOrigin(event, 120)} />
        </button>
        <div className="p-info" onClick={blankBarClick}>
          <button type="button" className="p-title"
                  title={__('player.viewAlbum')} onClick={onOpenAlbum}>
            <Marquee text={current.title} />
          </button>
          <div className="p-sub">
            <button type="button" className="p-sub-link p-artist-link"
                    title={current.artist}
                    disabled={!current.artist}
                    onClick={() => onOpenArtist(current.artist)}>
              {current.artist}
            </button>
            <span className="p-sub-sep" aria-hidden>—</span>
            <button type="button" className="p-sub-link p-album-link"
                    title={current.albumTitle}
                    onClick={onOpenAlbum}>
              {current.albumTitle}
            </button>
          </div>
        </div>
        {isAdmin && <span className="p-heart">
          <Heart on={fav} canEdit onToggle={onFav} size={17} /></span>}
        <Controls {...ctrl} />
        {/* 移动端迷你控制：播放 + 下一首（缓冲转圈，颜色跟随播放状态） */}
        <div className="p-mini-ctrl">
          <button className={`icon-btn mini-play ${playing ? 'on' : ''}`}
                  onClick={onToggle}>
            {buffering ? <I.spin size={22} />
              : playing ? <I.pause size={22} /> : <I.play size={22} />}
          </button>
          <button className="icon-btn" onClick={() => onStep(1)}>
            <I.next size={20} /></button>
        </div>
        <SeekBar t={t} dur={dur} onSeek={doSeek} />
        <div className="p-vol">
          <I.vol size={16} />
          {volSlider}
        </div>
      </footer>

      {npOpen && (
        <div className={`np-sheet ${closing ? 'out' : ''}`} ref={sheetRef}
             onPointerDown={spDown} onPointerMove={spMove}
             onPointerUp={spUp} onPointerCancel={spUp}
             onAnimationEnd={(e) => {
               if (closing && e.target === e.currentTarget) finishClose()
             }}>
          <div className="np-bg"><img src={artUrl(current.albumId, 480)} alt=""
            onError={(event) => retryArtFromOrigin(event, 480)} /></div>
          <div className="np-top">
            <button className="icon-btn" title={__('player.collapse')}
                    onClick={closeSheet}>
              <I.chevDown size={24} /></button>
            <button type="button" className="np-from"
                    onClick={goAlbum}>{current.albumTitle}</button>
            <span className="np-top-pad" />
          </div>
          <div className="np-body">
            <div className="np-cover">
              <img src={artUrl(current.albumId, 1000)} alt=""
                   onError={(event) => retryArtFromOrigin(event, 1000)} />
            </div>
            <div className="np-panel">
              <div className="np-meta">
                <div className="np-names">
                  <button type="button" className="np-title link"
                          title={__('player.viewAlbum')}
                          onClick={goAlbum}><Marquee text={current.title} /></button>
                  <button type="button" className="np-artist"
                          disabled={!current.artist}
                          onClick={goArtist}>{current.artist}</button>
                </div>
                <Heart on={fav} canEdit={isAdmin} onToggle={onFav} size={20} />
              </div>
              <SeekBar t={t} dur={dur} big onSeek={doSeek} />
              <Controls {...ctrl} big />
              <div className="np-vol">
                <I.vol size={15} />
                {volSlider}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
