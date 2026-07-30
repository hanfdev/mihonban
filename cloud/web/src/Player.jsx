import React, { useEffect, useRef, useState } from 'react'
import { artUrl } from './api.js'
import { I, Heart, Marquee, fmtDur } from './ui.jsx'
import { useI18n } from './i18n.jsx'
import { clampMediaTime, mediaDuration, seekAudio, storedVolume } from './media.js'
import { playbackControlState } from './player-control.js'
import { ArtistCredit } from './artist-credit.jsx'

/* Progress bar with click and drag scrubbing. While dragging, update only the preview;
 * on release, onSeek jumps immediately and the UI updates without waiting for buffering.
 * The large Now Playing variant spans the width, with elapsed and remaining time below its ends. */
function SeekBar({ t, dur, big, onSeek }) {
  const { t: __ } = useI18n()
  const barRef = useRef(null)
  const [scrub, setScrub] = useState(null) // Preview progress during a drag, from 0 to 1
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

  const cur = scrub !== null && dur ? scrub * dur : t
  // Keyboard seeking: Left/Right move five seconds, Home/End jump to the boundaries, all through onSeek.
  const onKeyDown = (e) => {
    if (!dur) return
    const step = e.shiftKey ? 30 : 5
    let next = null
    if (e.key === 'ArrowRight') next = Math.min(cur + step, dur)
    else if (e.key === 'ArrowLeft') next = Math.max(cur - step, 0)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = dur
    if (next === null) return
    e.preventDefault()
    onSeek(next)
  }
  const bar = (
    <div className={`p-bar ${scrub !== null ? 'scrubbing' : ''}`} ref={barRef}
         role="slider" tabIndex={0} aria-label={__('player.seek')}
         aria-valuemin={0} aria-valuemax={Math.round(dur || 0)}
         aria-valuenow={Math.round(cur || 0)} aria-valuetext={fmtDur(cur || 0)}
         onKeyDown={onKeyDown}
         onPointerDown={down} onPointerMove={move}
         onPointerUp={up} onPointerCancel={() => setScrub(null)}>
      <div className="rail">
        <div className="fill" style={{ width: `${shown * 100}%` }} />
        <div className="dot" style={{ left: `${shown * 100}%` }} />
      </div>
    </div>
  )

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
  const control = playbackControlState(playing, buffering)
  return (
    <div className={`p-ctrl ${big ? 'big' : ''}`}>
      <button className={`icon-btn mode ${shuffle ? 'on' : ''}`}
              title={t('player.shuffle')} onClick={onShuffle}>
        <I.shuffle size={big ? 20 : 16} />
      </button>
      <button className="icon-btn" title={t('player.prev')}
              aria-label={t('player.prev')} onClick={() => onStep(-1)}>
        <I.prev size={big ? 26 : 18} /></button>
      <button className={`icon-btn main ${playing ? 'on' : ''}`}
              title={t(`common.${control.action}`)}
              aria-label={t(`common.${control.action}`)}
              aria-pressed={playing} aria-busy={control.buffering}
              onClick={onToggle}>
        {control.action === 'pause'
          ? <I.pause size={big ? 28 : 18} />
          : <I.play size={big ? 28 : 18} />}
      </button>
      <button className="icon-btn" title={t('player.next')}
              aria-label={t('player.next')} onClick={() => onStep(1)}>
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
  const [closing, setClosing] = useState(false) // Now Playing is running its slide-out animation.
  const npHistoryRef = useRef(null)
  const pendingSheetNav = useRef(null)
  const retryArtFromOrigin = (event, size) => {
    const image = event.currentTarget
    // Track the one-time origin fallback per album. The mini-player <img> is a persistent DOM node and React changes only src;
    // without resetting this marker per album, every cover failure after the first fallback would be skipped and stay broken.
    const key = String(current.albumId)
    if (image.dataset.originRetry === key) return
    image.dataset.originRetry = key
    image.src = artUrl(current.albumId, size, true)
  }

  useEffect(() => {
    const a = audioRef.current
    if (a) a.volume = vol
  }, [audioRef, vol])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    // Listen for seeking as well so the UI jumps to the target immediately instead of waiting for buffering.
    const onTime = () => {
      // Safari/iOS can report an ever-growing duration for some OGG files; prefer the catalog's parsed value.
      const stableDuration = mediaDuration(current?.duration, a.duration)
      setT(clampMediaTime(a.currentTime, stableDuration))
      if (stableDuration) setDur(stableDuration)
    }
    const busy = () => setBuffering(true)
    const idle = () => setBuffering(false)
    const timeEvs = ['loadedmetadata', 'timeupdate', 'durationchange', 'seeking']
    const busyEvs = ['loadstart', 'waiting', 'stalled']
    const idleEvs = ['playing', 'canplay', 'seeked', 'pause', 'abort', 'emptied', 'error']
    timeEvs.forEach((e) => a.addEventListener(e, onTime))
    busyEvs.forEach((e) => a.addEventListener(e, busy))
    idleEvs.forEach((e) => a.addEventListener(e, idle))
    return () => {
      timeEvs.forEach((e) => a.removeEventListener(e, onTime))
      busyEvs.forEach((e) => a.removeEventListener(e, busy))
      idleEvs.forEach((e) => a.removeEventListener(e, idle))
    }
  }, [audioRef, current?.duration])

  // On track change, reset progress immediately and use track metadata as the provisional duration until media metadata arrives.
  useEffect(() => {
    setT(0)
    setDur(mediaDuration(current?.duration, 0))
  }, [current?.id])

  // Single seek entry point: move the UI to the target before touching audio so it never snaps backward.
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

  // Dismiss by playing the slide-out animation first, then unmount; a 400 ms timer is the fallback.
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

  /* System back button/gesture: when Now Playing opens, push a same-URL history entry without disturbing hash routing.
   * The first Back dismisses only Now Playing. A manual dismissal (swipe, X, or Escape) consumes that entry.
   * If navigation occurred meanwhile, the current entry is no longer ours, so leave history untouched. */
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

  /* Swipe down to dismiss Now Playing: dragging anywhere follows the pointer.
   * Release far or fast enough to continue off-screen; otherwise snap back. Accept touch or pen only,
   * and never steal button taps or progress-bar drags. */
  const sheetRef = useRef(null)
  const swipe = useRef(null)
  const barSwipe = useRef(null) // Mini-player swipe-up state; the hook must precede the early return below.
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
      if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return // Gesture dead zone
      if (dy <= 0 || Math.abs(dy) <= Math.abs(dx)) {     // Upward or horizontal motion is not a dismissal.
        swipe.current = null
        return
      }
      s.on = true
    }
    const dt = e.timeStamp - s.lastT
    if (dt > 0) s.vy = (e.clientY - s.lastY) / dt // px/ms for flick detection
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
      closeSheet() // Continue the .out animation from the current drag position.
    } else if (el) {
      el.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1)'
      el.style.transform = ''
      setTimeout(() => { const n = sheetRef.current; if (n) n.style.transition = '' }, 320)
    }
  }

  if (!current) return null
  const frac = dur ? Math.min(t / dur, 1) : 0
  const miniControl = playbackControlState(playing, buffering)
  const ctrl = { playing, buffering, shuffle, repeat,
                 onToggle, onStep, onShuffle, onRepeat }

  const setVolume = (v) => {
    setVol(v)
    try { localStorage.setItem('mihonban_volume', String(v)) } catch { /* storage unavailable */ }
  }
  const volSlider = (
    <input type="range" min="0" max="1" step="0.02" value={vol}
           aria-label={__('player.volume')}
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

  /* Swipe up on the mini-player to open Now Playing, mirroring swipe-down dismissal.
   * Use both pointer and touch paths because iOS Safari sometimes consumes pointer events as a pan gesture.
   * The cover and text retain tap navigation while serving as swipe origins; progress and volume sliders opt out.
   * The play button likewise supports a tap action and swipe-up expansion. */
  // barSwipe is intentionally declared before the early return.
  const startBarSwipe = (x, y) => {
    if (npOpen || window.innerWidth > 900) return
    suppressBarClick.current = false
    barSwipe.current = { y0: y, x0: x }
  }
  const moveBarSwipe = (x, y) => {
    const s = barSwipe.current
    if (!s) return false
    const dy = y - s.y0, dx = x - s.x0
    // Expand only for a clear, vertically dominant upward drag to ignore minor finger movement.
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
  // Touch fallback: preserve click for a short tap and prevent the browser gesture only after confirming a swipe up.
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
    // Call preventDefault only after confirming a swipe up so ordinary page scrolling remains available.
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
        {/* Mobile: thin progress line along the top of the mini-player. */}
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
          {/* Show only the artist on the secondary line: an album title can crowd out long artist names,
              while the cover and track title already link to the album, making another album label redundant. */}
          <div className="p-sub">
            <ArtistCredit value={current} onOpen={onOpenArtist}
                          className="p-artist-credit"
                          linkClassName="p-sub-link p-artist-link" />
          </div>
        </div>
        {isAdmin && <span className="p-heart">
          <Heart on={fav} canEdit onToggle={onFav} size={17} /></span>}
        <Controls {...ctrl} />
        {/* Mobile mini controls preserve previous, current action, and next in full. */}
        <div className="p-mini-ctrl">
          <button className="icon-btn" title={__('player.prev')}
                  aria-label={__('player.prev')} onClick={() => onStep(-1)}>
            <I.prev size={20} /></button>
          <button className={`icon-btn mini-play ${playing ? 'on' : ''}`}
                  title={__(`common.${miniControl.action}`)}
                  aria-label={__(`common.${miniControl.action}`)}
                  aria-pressed={playing} aria-busy={miniControl.buffering}
                  onClick={onToggle}>
            {miniControl.action === 'pause'
              ? <I.pause size={22} /> : <I.play size={22} />}
          </button>
          <button className="icon-btn" title={__('player.next')}
                  aria-label={__('player.next')} onClick={() => onStep(1)}>
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
                  <ArtistCredit value={current}
                                onOpen={(name) => leaveSheetFor(() => onOpenArtist(name))}
                                className="np-artist-credit"
                                linkClassName="np-artist" />
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
