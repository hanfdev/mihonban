import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, streamUrl, artUrl } from './api.js'
import { I, Logo, navigate, useToast } from './ui.jsx'
import { useI18n, LangSelect } from './i18n.jsx'
import Library from './views/Library.jsx'
import TracksPage from './views/Tracks.jsx'
import ArtistsPage from './views/Artists.jsx'
import FavoritesPage from './views/Favorites.jsx'
import ArtistPage from './views/Artist.jsx'
import AlbumPage from './views/Album.jsx'
import ImportPage from './views/Import.jsx'
import AdminPage from './views/Admin.jsx'
import Player from './Player.jsx'
import Login from './views/Login.jsx'
import { freezeMediaSession, isStandaloneWebApp, loadAudioUntilPlayable,
         mediaSessionPlaybackState, resolvePendingMediaSeek, seekAudio,
         shouldDeferLockScreenPlayback, shouldPauseForIOSBuffering,
         updateMediaPosition } from './media.js'
import { installTrackMediaSessionHandlers } from './media-session.js'
import { adjacentQueuePosition } from './player-queue.js'
import { sessionAfterLogout } from './session.js'
import { visibleAlbumCount } from './visibility.js'
import { isCurrentHash, scrollToTop } from './navigation.js'
import { addFavoriteToFront } from './favorites.js'

const parseHash = () => {
  const h = location.hash.replace(/^#\/?/, '')
  const [view, ...rest] = h.split('/')
  const encoded = rest.join('/')
  let arg = encoded
  try { arg = decodeURIComponent(encoded) } catch { /* keep malformed text literal */ }
  return { view: view || 'library', arg }
}

// Used to determine device decoding support: format → MIME (for example, iPhone Safari lacks Vorbis decoding).
const AUDIO_MIME = {
  mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg; codecs="opus"', m4a: 'audio/mp4', aac: 'audio/aac',
  wav: 'audio/wav', aiff: 'audio/aiff', aif: 'audio/aiff',
}

// Navigation links use the in-app router for an ordinary left click while preserving custom history depth.
// Modified clicks stay with the browser: Ctrl/Cmd opens a tab, Shift opens a window, and Alt downloads.
// Calling preventDefault unconditionally would make the real href we added effectively useless.
const navClick = (hash, onNavigate) => (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return
  e.preventDefault()
  onNavigate(hash)
}

// Fallback view for initial data failures other than 401, using the same visual language as the album error state.
// An endlessly spinning skeleton that can only be cleared by a full refresh is worse than an error message.
function LoadFailed({ message, onRetry }) {
  const { t } = useI18n()
  return (
    <div className="empty" style={{ paddingTop: 60 }}>
      <div>{message}</div>
      <button className="btn" onClick={onRetry}>{t('common.retry')}</button>
    </div>
  )
}

// Playback order: sequential mode starts at startIdx; shuffle mode keeps the current track first and shuffles the rest.
const buildOrder = (n, startIdx, shuffled) => {
  if (!shuffled) return { order: [...Array(n).keys()], pos: startIdx }
  const rest = [...Array(n).keys()].filter((i) => i !== startIdx)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return { order: [startIdx, ...rest], pos: 0 }
}

export default function App() {
  const toast = useToast()
  const { t } = useI18n()
  const [authed, setAuthed] = useState(null) // null = checking
  const [role, setRole] = useState(null)     // 'user' | 'admin'
  const [guest, setGuest] = useState(false)  // Passwordless guest access; the user can still sign in as admin.
  // loginMode: null | 'admin' (elevate to admin) | 'switch' (switch account or sign in after logout)
  const [loginMode, setLoginMode] = useState(null)
  const [sessOpen, setSessOpen] = useState(false)  // Header session menu
  const sessRef = useRef(null)
  const [route, setRoute] = useState(parseHash())
  const [albums, setAlbums] = useState(null)
  const [tracksAll, setTracksAll] = useState(null) // Lazily loaded complete track list
  const [artists, setArtists] = useState([])       // [{name, hasAvatar}]
  // Error copy for an initial data failure other than 401; without it the view renders a skeleton.
  // Otherwise a brief network wobble would leave the library or tracks page stuck with no retry path.
  const [loadErrors, setLoadErrors] = useState({})
  const noteLoadError = useCallback((key, message) =>
    setLoadErrors((prev) => ({ ...prev, [key]: message || 'load failed' })), [])
  const clearLoadError = useCallback((key) =>
    setLoadErrors((prev) => (prev[key] ? { ...prev, [key]: '' } : prev)), [])
  const [avatarVer, setAvatarVer] = useState(0)    // Cache-busting revision after an avatar changes
  const [favs, setFavs] = useState({ albums: [], tracks: [] })
  const favsRef = useRef(favs)
  // Allow only the latest data request to commit, so a stale response cannot overwrite a switched identity.
  const roleRef = useRef(role)
  const authedRef = useRef(authed)
  roleRef.current = role
  authedRef.current = authed
  const libraryRequestRef = useRef(0)
  const tracksRequestRef = useRef(0)
  const artistsRequestRef = useRef(0)
  const favoritesRequestRef = useRef(0)
  const [q, setQ] = useState('')
  // The album and tracks pages share one "show hidden" state for administrators; it is off by default.
  const [showHidden, setShowHidden] = useState(false)
  const [mSearch, setMSearch] = useState(false)    // Mobile search row toggle
  const [scrolled, setScrolled] = useState(false)  // Add a header shadow after content scrolls
  const scrolledRef = useRef(false)
  const mainRef = useRef(null)
  const navScrollRef = useRef('auto')

  // ---- Player state ----
  const audioRef = useRef(null)
  // list: normalized tracks {id, title, duration, artist, albumId, albumTitle}
  const [queue, setQueue] = useState({ list: [], order: [], pos: -1 })
  const [playing, setPlaying] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState('off') // off | all | one
  const [npOpen, setNpOpen] = useState(false) // Full-screen mobile player
  const current = queue.pos >= 0 ? queue.list[queue.order[queue.pos]] : null
  const currentRef = useRef(current)
  const queueRef = useRef(queue)
  currentRef.current = current
  queueRef.current = queue

  const handleMainScroll = useCallback((event) => {
    const next = event.currentTarget.scrollTop > 4
    if (next === scrolledRef.current) return
    scrolledRef.current = next
    setScrolled(next)
  }, [])

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash())
      const behavior = navScrollRef.current
      navScrollRef.current = 'auto'
      // Wait for the destination view to render before moving its scroll container.
      requestAnimationFrame(() => scrollToTop(mainRef.current, behavior))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const refreshLibrary = useCallback(async (options = {}) => {
    const requestId = ++libraryRequestRef.current
    const requestedRole = role
    try {
      // Administrators request hidden=1 to manage hidden albums; guests and listeners never receive them.
      const next = await api.library({ hidden: requestedRole === 'admin' })
      if (requestId !== libraryRequestRef.current
          || roleRef.current !== requestedRole || !authedRef.current) return
      setAlbums(next)
      clearLoadError('library')
      // Initial sign-in or identity switches already invalidate this before the request starts.
      // Do not let a slow library response replace newly loaded tracks with null; ordinary edits still invalidate normally.
      if (options?.invalidateTracks !== false) setTracksAll(null)
    } catch (e) {
      if (requestId !== libraryRequestRef.current) return
      if (e instanceof api.AuthError) setAuthed(false)
      else noteLoadError('library', e.message)
    }
  }, [role, clearLoadError, noteLoadError])

  const ensureTracks = useCallback(async () => {
    const requestId = ++tracksRequestRef.current
    const requestedRole = role
    try {
      const next = await api.tracks({ hidden: requestedRole === 'admin' })
      if (requestId !== tracksRequestRef.current
          || roleRef.current !== requestedRole || !authedRef.current) return
      setTracksAll(next)
      clearLoadError('tracks')
    } catch (e) {
      if (requestId !== tracksRequestRef.current) return
      if (e instanceof api.AuthError) setAuthed(false)
      else noteLoadError('tracks', e.message)
    }
  }, [role, clearLoadError, noteLoadError])

  const refreshArtists = useCallback(async () => {
    const requestId = ++artistsRequestRef.current
    const requestedRole = role
    try {
      const next = await api.artists({ hidden: requestedRole === 'admin' })
      if (requestId !== artistsRequestRef.current
          || roleRef.current !== requestedRole || !authedRef.current) return
      setArtists(next)
      clearLoadError('artists')
    } catch (e) {
      if (requestId !== artistsRequestRef.current) return
      if (e instanceof api.AuthError) setAuthed(false)
      else noteLoadError('artists', e.message)
    }
  }, [role, clearLoadError, noteLoadError])

  useEffect(() => { favsRef.current = favs }, [favs])
  const applyFavs = useCallback((next) => {
    favsRef.current = next
    setFavs(next)
  }, [])

  const refreshFavorites = useCallback(async () => {
    const requestId = ++favoritesRequestRef.current
    try {
      const next = await api.favorites()
      if (requestId !== favoritesRequestRef.current || !authedRef.current) return
      applyFavs(next)
    } catch (e) {
      if (requestId === favoritesRequestRef.current && e instanceof api.AuthError) {
        setAuthed(false)
      }
    }
  }, [applyFavs])

  useEffect(() => {
    let active = true
    api.me().then((r) => {
      if (!active) return
      setRole(r.role); setAuthed(r.ok); setGuest(!!r.guest)
    }).catch(() => { if (active) setAuthed(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!authed) {
      libraryRequestRef.current++
      tracksRequestRef.current++
      artistsRequestRef.current++
      favoritesRequestRef.current++
      return
    }
    setTracksAll(null)
    refreshLibrary({ invalidateTracks: false })
    refreshFavorites()
    refreshArtists()
  }, [authed, refreshLibrary, refreshArtists, refreshFavorites])

  const isAdmin = role === 'admin'
  const headerAlbumCount = useMemo(() => visibleAlbumCount(albums, {
    isAdmin, showHidden,
  }), [albums, isAdmin, showHidden])
  useEffect(() => {
    if (!isAdmin) setShowHidden(false)
  }, [isAdmin])
  const favAlbums = useMemo(() => new Set(favs.albums.map((f) => f.id)), [favs])
  const favTracks = useMemo(() => new Set(favs.tracks.map((f) => f.id)), [favs])

  // Keep stable references (navigate is a module constant). Otherwise every App render, including track changes or pauses,
  // would create new closures, defeat TrackRow's React.memo comparison, and force a needless full-list reconciliation.
  const openAlbum = useCallback((id) => navigate(`/album/${id}`), [])
  const openArtist = useCallback(
    (name) => navigate(`/artist/${encodeURIComponent(name)}`), [])
  const openGenre = useCallback(
    (g) => navigate(`/genre/${encodeURIComponent(g)}`), [])

  const toggleFav = useCallback(async (kind, id) => {
    if (roleRef.current !== 'admin') return
    favoritesRequestRef.current++
    const key = kind === 'album' ? 'albums' : 'tracks'
    const currentFavs = favsRef.current
    const adding = !currentFavs[key].some((x) => x.id === id)
    applyFavs({
      ...currentFavs,
      [key]: adding ? addFavoriteToFront(currentFavs[key], id, Date.now())
        : currentFavs[key].filter((x) => x.id !== id),
    })
    try { await (adding ? api.addFavorite(kind, id) : api.removeFavorite(kind, id)) }
    catch { refreshFavorites() } // Roll back to the server's source of truth on failure.
  }, [applyFavs, refreshFavorites])

  // Reorder favorites by drag: update the local order optimistically, then persist it on the server.
  const reorderFavs = useCallback(async (kind, orderedIds) => {
    if (roleRef.current !== 'admin') return
    favoritesRequestRef.current++
    const key = kind === 'album' ? 'albums' : 'tracks'
    const currentFavs = favsRef.current
    const byId = new Map(currentFavs[key].map((x) => [x.id, x]))
    const next = orderedIds.map((id, i) => ({ ...byId.get(id), order: i }))
    applyFavs({ ...currentFavs, [key]: next })
    try { await api.reorderFavorites(kind, orderedIds) }
    catch { refreshFavorites() }
  }, [applyFavs, refreshFavorites])

  // ---- Playback controls ----
  const skipRun = useRef(0) // Consecutive auto-skip count; prevents a loop when no track in the queue is playable.
  // iOS can suspend a home-screen app before a redirected media request has
  // established native playback. Keep installed-app audio on one origin so
  // the media process can continue the same Range request while UI JavaScript sleeps.
  const standalonePlaybackRef = useRef(isStandaloneWebApp())
  const deferLockScreenPlaybackRef = useRef(shouldDeferLockScreenPlayback())
  const sourceRef = useRef({ id: null, proxy: false })
  const playAttemptRef = useRef(0)
  const deferSystemStartRef = useRef(false)
  const pendingStartRef = useRef(null)
  const pendingBufferResumeRef = useRef(null)
  const pendingSystemSeekRef = useRef(null)
  const playAudio = useCallback((audio, sourceId = sourceRef.current.id) => {
    const attempt = ++playAttemptRef.current
    if (pendingStartRef.current === sourceId) pendingStartRef.current = null
    if (pendingBufferResumeRef.current === sourceId) {
      pendingBufferResumeRef.current = null
    }
    // Playback controls represent the user's intent immediately. The promise
    // may remain pending while a remote source buffers.
    setPlaying(true)
    return audio.play().then(() => {
      if (playAttemptRef.current === attempt
          && sourceRef.current.id === sourceId && !audio.paused) {
        setPlaying(true)
      }
      return true
    }).catch(() => {
      if (playAttemptRef.current === attempt
          && sourceRef.current.id === sourceId) setPlaying(false)
      return false
    })
  }, [])
  const pauseAudio = useCallback((audio) => {
    playAttemptRef.current++
    deferSystemStartRef.current = false
    pendingStartRef.current = null
    pendingBufferResumeRef.current = null
    audio.pause()
    setPlaying(false)
  }, [])

  // An omitted index means "play all": inherit the player's current mode, including a random start when shuffle is on.
  // opts.shuffle forces shuffle (the tracks-page random button) and switches the player into that mode.
  const playTracks = useCallback((list, index, opts) => {
    if (!list?.length) return
    const useShuffle = opts?.shuffle ?? shuffle
    if (useShuffle !== shuffle) setShuffle(useShuffle)
    const start = index ?? (useShuffle ? Math.floor(Math.random() * list.length) : 0)
    const { order, pos } = buildOrder(list.length, start, useShuffle)
    setQueue({ list, order, pos })
    // Android Chrome requires the first audible play call to remain inside the click gesture.
    // Load and play on this event stack; the effect after current changes is only a fallback and track-switch path.
    const first = list[order[pos]]
    const audio = audioRef.current
    if (audio && first?.id) {
      const proxy = standalonePlaybackRef.current
      playAttemptRef.current++
      deferSystemStartRef.current = false
      pendingStartRef.current = null
      pendingBufferResumeRef.current = null
      pendingSystemSeekRef.current = null
      sourceRef.current = { id: first.id, proxy }
      if (proxy) audio.preload = 'auto'
      audio.src = streamUrl(first.id, { proxy })
      playAudio(audio, first.id)
    }
  }, [playAudio, shuffle])

  // Play an album context, filling in normalized artist and album metadata.
  const playFrom = useCallback((album, tracks, index) => {
    playTracks(tracks.map((t) => ({
      id: t.id, title: t.title, duration: t.duration, format: t.format,
      artist: t.artist || album.artist,
      artists: t.artists || album.artists,
      albumId: t.albumId || album.id, albumTitle: t.albumTitle || album.title,
    })), index)
  }, [playTracks])

  useEffect(() => {
    const a = audioRef.current
    if (!a || !current) return
    // Ask the browser whether it can decode the source first (some iPhones lack Vorbis support); skip it if not.
    const mime = AUDIO_MIME[(current.format || '').toLowerCase()]
    if (mime && a.canPlayType(mime) === '') {
      playAttemptRef.current++
      a.pause()
      a.removeAttribute('src')
      a.load()
      sourceRef.current = { id: current.id, proxy: false }
      setPlaying(false)
      if (skipRun.current < queue.list.length) {
        skipRun.current++
        toast(t('player.skipFormat', current.format.toUpperCase(), current.title), 'err')
        step(1)
      } else {
        toast(t('player.noPlayable'), 'err')
      }
      return
    }
    skipRun.current = 0
    // Do not prefetch the entire next track: concurrent large requests can trigger OneDrive 503 throttling.
    const alreadyStarted = sourceRef.current.id === current.id
    const sourceId = current.id
    let cancelWarmStart = null
    if (!alreadyStarted) {
      const proxy = standalonePlaybackRef.current
      playAttemptRef.current++
      const deferSystemStart = deferSystemStartRef.current
      deferSystemStartRef.current = false
      pendingBufferResumeRef.current = null
      pendingSystemSeekRef.current = null
      sourceRef.current = { id: current.id, proxy }
      if (deferSystemStart) {
        pendingStartRef.current = sourceId
        a.pause()
        cancelWarmStart = loadAudioUntilPlayable(
          a,
          streamUrl(current.id, { proxy }),
          () => {
            if (sourceRef.current.id !== sourceId
                || pendingStartRef.current !== sourceId) return
            playAudio(a, sourceId)
          },
        )
        setPlaying(true)
      } else {
        pendingStartRef.current = null
        if (proxy) a.preload = 'auto'
        a.src = streamUrl(current.id, { proxy })
      }
    }
    // playTracks already called play() inside the originating tap/click. Do
    // not issue a second asynchronous play request while that promise is in
    // flight: Android can treat the later call as detached from the gesture.
    if (!alreadyStarted && !cancelWarmStart) playAudio(a, sourceId)
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: current.title,
          artist: current.artist,
          album: current.albumTitle,
          artwork: [{ src: artUrl(current.albumId, 480), sizes: '480x480' }],
        })
      } catch { /* partial Media Session implementations */ }
    }
    return () => cancelWarmStart?.()
  }, [current?.id, playAudio])

  useEffect(() => {
    const a = audioRef.current
    if (a) a.loop = repeat === 'one'
  }, [repeat, current?.id])

  const toggle = useCallback(() => {
    const a = audioRef.current
    if (!a || !current) return
    if (playing) pauseAudio(a)
    else playAudio(a, current.id)
  }, [current, pauseAudio, playAudio, playing])

  const step = useCallback((d) => {
    setQueue((s) => {
      if (!s.list.length) return s
      const np = adjacentQueuePosition(s.pos, s.order.length, d, repeat)
      if (np === null) return s // Stop after playback.
      if (np === s.pos) { // Replay the same track (repeat-all single-track queue or previous at the boundary).
        const a = audioRef.current
        if (a) { a.currentTime = 0; playAudio(a, sourceRef.current.id) }
        return s
      }
      return { ...s, pos: np }
    })
  }, [repeat, playAudio])

  const deferAdjacentSource = useCallback((delta) => {
    const snapshot = queueRef.current
    const next = adjacentQueuePosition(
      snapshot.pos, snapshot.order.length, delta, repeat,
    )
    if (next === null || next === snapshot.pos) return false
    if (deferLockScreenPlaybackRef.current) {
      deferSystemStartRef.current = true
      pendingBufferResumeRef.current = null
      playAttemptRef.current++
      audioRef.current?.pause()
    }
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      freezeMediaSession(navigator.mediaSession)
    }
    return true
  }, [repeat])

  const toggleShuffle = useCallback(() => {
    setShuffle((on) => {
      const next = !on
      setQueue((s) => {
        if (s.pos < 0) return s
        const cur = s.order[s.pos]
        const { order, pos } = buildOrder(s.list.length, cur, next)
        return { ...s, order, pos }
      })
      return next
    })
  }, [])

  const cycleRepeat = useCallback(() =>
    setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')), [])

  const pauseSilentIOSClock = useCallback((audio) => {
    const systemSeekPending = pendingSystemSeekRef.current?.sourceId
      === sourceRef.current.id
    if (!audio || !shouldPauseForIOSBuffering(
      deferLockScreenPlaybackRef.current,
      audio.paused,
      audio.ended,
      systemSeekPending,
    )) return false
    const sourceId = sourceRef.current.id
    if (!sourceId) return false
    pendingBufferResumeRef.current = sourceId
    playAttemptRef.current++
    audio.preload = 'auto'
    audio.pause()
    setPlaying(true)
    if ('mediaSession' in navigator) {
      freezeMediaSession(navigator.mediaSession)
    }
    return true
  }, [])

  const resumeBufferedBackgroundAudio = useCallback((audio) => {
    const sourceId = pendingBufferResumeRef.current
    if (!audio || !sourceId || sourceRef.current.id !== sourceId) return false
    pendingBufferResumeRef.current = null
    playAudio(audio, sourceId)
    return true
  }, [playAudio])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const audio = () => audioRef.current
    const sync = () => {
      try { updateMediaPosition(ms, audio(), current?.duration) } catch { /* ignore */ }
    }
    const seekTo = (details = {}) => {
      const a = audio()
      if (!a || !Number.isFinite(Number(details.seekTime))) return
      // A system progress slider supplies an exact destination. fastSeek may
      // complete asynchronously on Safari, so publishing the old currentTime
      // immediately afterwards makes the lock-screen thumb snap back.
      const target = seekAudio(a, Number(details.seekTime), current?.duration)
      pendingSystemSeekRef.current = {
        sourceId: sourceRef.current.id,
        target,
        requestedAt: Date.now(),
      }
      try { updateMediaPosition(ms, a, current?.duration, target) } catch { /* ignore */ }
    }
    const stepFromSystem = (delta) => {
      deferAdjacentSource(delta)
      step(delta)
    }
    const handlers = {
      previoustrack: () => stepFromSystem(-1),
      nexttrack: () => stepFromSystem(1),
      seekto: seekTo,
    }
    // Installed web apps keep native play/pause because iOS may suspend page
    // JavaScript. Browser tabs use explicit handlers so Safari reserves the
    // side transport slots for previous/next instead of native +/-10 seconds.
    if (!standalonePlaybackRef.current) {
      handlers.play = () => {
        const a = audio()
        if (a) playAudio(a, sourceRef.current.id)
      }
      handlers.pause = () => {
        const a = audio()
        if (a) pauseAudio(a)
      }
    }
    return installTrackMediaSessionHandlers(ms, handlers)
  }, [current?.id, current?.duration, deferAdjacentSource, pauseAudio,
    playAudio, step])

  // iOS may not trust the duration inferred by <audio> for OGG; provide the catalog duration and current position explicitly.
  // `play` represents intent only; remote audio is audible at `playing`. Marking Media Session as playing while buffering
  // makes lock-screen progress run ahead and prevents timely correction from background timeupdate events.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return
    const a = audioRef.current
    if (!a) return
    const ms = navigator.mediaSession
    let playbackState = 'paused'
    const sync = (event) => {
      try {
        playbackState = mediaSessionPlaybackState(
          event?.type, a.paused, playbackState,
        )
        ms.playbackState = playbackState
        const seekState = resolvePendingMediaSeek(
          pendingSystemSeekRef.current,
          current.id,
          a.currentTime,
          a.seeking,
        )
        pendingSystemSeekRef.current = seekState.pending
        updateMediaPosition(ms, a, current.duration, seekState.position)
      } catch { /* Older Safari supports only part of the Media Session API. */ }
    }
    const events = ['loadstart', 'loadedmetadata', 'durationchange', 'play',
      'playing', 'waiting', 'stalled', 'timeupdate', 'seeking', 'seeked',
      'pause', 'ended', 'emptied', 'abort', 'error', 'ratechange']
    events.forEach((event) => a.addEventListener(event, sync))
    document.addEventListener('visibilitychange', sync)
    // A source effect may already have called play(); start frozen regardless
    // of audio.paused and wait for the actual `playing` event.
    sync({ type: 'loadstart' })
    return () => {
      events.forEach((event) => a.removeEventListener(event, sync))
      document.removeEventListener('visibilitychange', sync)
    }
  }, [current?.id, current?.duration])

  // Session menu: close on outside click or Escape.
  useEffect(() => {
    if (!sessOpen) return
    const onDoc = (e) => {
      if (sessRef.current && !sessRef.current.contains(e.target)) setSessOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setSessOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [sessOpen])

  // Sign out: clear the cookie and local state, then return to the login page.
  const doLogout = useCallback(async () => {
    libraryRequestRef.current++
    tracksRequestRef.current++
    artistsRequestRef.current++
    favoritesRequestRef.current++
    setSessOpen(false)
    const audio = audioRef.current
    if (audio) {
      playAttemptRef.current++
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    sourceRef.current = { id: null, proxy: false }
    // Re-read the server access policy after clearing the admin cookie. With guests enabled, downgrade directly
    // to a read-only guest instead of briefly or permanently landing on the password login page.
    const nextSession = await sessionAfterLogout(api)
    setAuthed(nextSession.ok)
    setRole(nextSession.role)
    setGuest(nextSession.guest)
    setAlbums(null)
    setTracksAll(null)
    setArtists([])
    applyFavs({ albums: [], tracks: [] })
    setQueue({ list: [], order: [], pos: -1 })
    setPlaying(false)
    setLoginMode(null)
    if (location.hash && location.hash !== '#/' && location.hash !== '#') {
      navigate('/', { replace: true })
    }
  }, [applyFavs])

  if (authed === null) return null
  if (!authed) return <Login onOk={(r) => { setRole(r); setAuthed(true); setGuest(false) }} />
  // Use the overlay only to elevate to admin; logout uses the full Login page.
  if (loginMode === 'admin') {
    return (
      <Login
        guestReturn
        onOk={(r) => {
          libraryRequestRef.current++
          tracksRequestRef.current++
          artistsRequestRef.current++
          favoritesRequestRef.current++
          setRole(r)
          setGuest(false)
          setLoginMode(null)
        }}
        onCancel={() => setLoginMode(null)}
      />
    )
  }

  const navigateToTop = (hash) => {
    if (isCurrentHash(hash, location.hash)) {
      scrollToTop(mainRef.current)
      return
    }
    navScrollRef.current = 'smooth'
    navigate(hash)
  }

  const searchable = ['library', 'tracks', 'genre', 'favs', 'artists'].includes(route.view)
  // Separate the primary navigation from the admin entry so long translations cannot cover the search field.
  const NAV_MAIN = [
    { key: 'library', hash: '/', label: t('nav.library'), icon: I.disc,
      on: ['library', 'genre', 'album'].includes(route.view) },
    { key: 'tracks', hash: '/tracks', label: t('nav.tracks'), icon: I.note,
      on: route.view === 'tracks' },
    { key: 'artists', hash: '/artists', label: t('nav.artists'), icon: I.user,
      on: ['artists', 'artist'].includes(route.view) },
    { key: 'favs', hash: '/favs/albums', label: t('nav.favs'), icon: I.heart,
      on: route.view === 'favs' },
  ]
  const NAV_ADMIN = isAdmin ? [
    { key: 'import', hash: '/import', label: t('nav.import'), icon: I.upload,
      on: route.view === 'import' },
    { key: 'admin', hash: '/admin', label: t('nav.admin'), icon: I.gear,
      on: route.view === 'admin' },
  ] : []
  // Keep the mobile bottom bar as one group.
  const NAV = [...NAV_MAIN, ...NAV_ADMIN]

  const shared = {
    albums, q, isAdmin, showHidden, setShowHidden,
    onClearQuery: () => setQ(''),
    favAlbums, favTracks, toggleFav,
    onOpen: openAlbum, onOpenArtist: openArtist, onOpenGenre: openGenre,
    onPlay: playFrom, onPlayTracks: playTracks,
    currentId: current?.id, playingId: playing ? current?.id : null,
    currentAlbumId: current?.albumId, onTogglePlayback: toggle,
    playerShuffle: shuffle,
  }

  return (
    <div className={`app ${current ? 'has-player' : ''}`}>
      <header className={`hdr ${scrolled ? 'on-scroll' : ''}`}>
        <div className="hdr-left">
          <a className="logo" href="#/" aria-label={t('brand')}
             onClick={navClick('/', navigateToTop)}>
            <Logo /> <span className="logo-t">{t('brand')} <em>{t('brandSub')}</em></span>
          </a>
          <nav className="nav nav-main">
            {NAV_MAIN.map((n) => (
              <a key={n.key} className={n.on ? 'on' : ''} href={`#${n.hash}`}
                 aria-current={n.on ? 'page' : undefined}
                 onClick={navClick(n.hash, navigateToTop)}>{n.label}</a>
            ))}
          </nav>
        </div>

         {/* Keep the middle column occupied so search stays geometrically centered (symmetric left/right 1fr). */}
        <div className="hdr-center">
          {searchable && (
            <div className="search">
              <I.search size={15} />
              <input placeholder={t('search.placeholder')} value={q}
                     onChange={(e) => setQ(e.target.value)} />
              {q && <button type="button" className="search-clear"
                            aria-label={t('common.clearFilters')}
                            onClick={() => setQ('')}><I.x size={14} /></button>}
            </div>
          )}
        </div>

        <div className="hdr-right">
          {searchable && (
            <button className={`icon-btn m-search ${mSearch ? 'on' : ''}`}
                    aria-label={t('search.placeholder')} aria-expanded={mSearch}
                    onClick={() => { setMSearch(!mSearch); if (mSearch) setQ('') }}>
              <I.search size={18} />
            </button>
          )}
          {NAV_ADMIN.length > 0 && (
            <nav className="nav nav-admin">
              {NAV_ADMIN.map((n) => (
                <a key={n.key} className={n.on ? 'on' : ''} href={`#${n.hash}`}
                   aria-current={n.on ? 'page' : undefined}
                   onClick={navClick(n.hash, navigateToTop)}>{n.label}</a>
              ))}
            </nav>
          )}
          <span className="hdr-count">
            {headerAlbumCount !== null ? t('count.albums', headerAlbumCount) : ''}
          </span>
          <LangSelect className="hdr-lang" />
          {/* Session entry: the product has two roles, administrator and read-only guest.
              The backend user password and passwordless guest mode are both guest access to users. */}
          <div className={`sess ${sessOpen ? 'open' : ''}`} ref={sessRef}>
            <button type="button" className="sess-btn"
                    title={t('login.menuTitle')}
                    aria-haspopup="menu"
                    aria-expanded={sessOpen}
                    onClick={() => setSessOpen((o) => !o)}>
              <I.user size={15} />
              <span className="sess-label">
                {isAdmin ? t('login.roleAdmin') : t('login.roleGuest')}
              </span>
              <I.chevDown size={12} className="sess-chev" />
            </button>
            {sessOpen && (
              <div className="sess-menu" role="menu">
                <div className="sess-meta">
                  {isAdmin ? t('login.roleAdmin') : t('login.roleGuest')}
                </div>
                {!isAdmin && (
                  <button type="button" role="menuitem"
                          onClick={() => { setSessOpen(false); setLoginMode('admin') }}>
                    <I.gear size={14} /> {t('login.adminLogin')}
                  </button>
                )}
                {/* Show sign out only when a session cookie exists; passwordless guests have nothing to sign out from. */}
                {!guest && (
                  <button type="button" role="menuitem" className="danger"
                          onClick={doLogout}>
                    <I.x size={14} /> {t('login.signOut')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      {searchable && mSearch && (
        <div className="m-search-row">
          <div className="search">
            <I.search size={15} />
            <input autoFocus placeholder={t('search.placeholder')} value={q}
                   onChange={(e) => setQ(e.target.value)} />
            {q && <button type="button" className="search-clear"
                          aria-label={t('common.clearFilters')}
                          onClick={() => setQ('')}><I.x size={14} /></button>}
          </div>
        </div>
      )}

      <main className="main" ref={mainRef}
            onScroll={handleMainScroll}>
        {['library', 'genre'].includes(route.view) && !albums
          && loadErrors.library && (
          <LoadFailed message={loadErrors.library}
                      onRetry={() => { clearLoadError('library'); refreshLibrary() }} />
        )}
        {route.view === 'library' && (albums || !loadErrors.library)
          && <Library {...shared} />}
        {route.view === 'genre' && (albums || !loadErrors.library)
          && <Library {...shared} genreFromRoute={route.arg}
                      key={`g:${route.arg}`} />}
        {route.view === 'tracks' && (
          !tracksAll && loadErrors.tracks
            ? <LoadFailed message={loadErrors.tracks}
                          onRetry={() => { clearLoadError('tracks'); ensureTracks() }} />
            : <TracksPage {...shared} tracks={tracksAll} ensureTracks={ensureTracks} />
        )}
        {route.view === 'artists' && (
          <ArtistsPage albums={albums} artists={artists} q={q}
                        avatarVer={avatarVer} onOpenArtist={openArtist}
                        isAdmin={isAdmin} showHidden={showHidden}
                        setShowHidden={setShowHidden}
                        onClearQuery={() => setQ('')} />
        )}
        {route.view === 'favs' && (
          <FavoritesPage {...shared} favs={favs} onReorder={reorderFavs}
                         tracks={tracksAll} ensureTracks={ensureTracks}
                         tab={route.arg === 'tracks' ? 'tracks' : 'albums'}
                         onTabChange={(tab) => navigateToTop(`/favs/${tab}`)} />
        )}
        {route.view === 'artist' && (
          <ArtistPage key={route.arg} {...shared} name={route.arg} artists={artists}
                      avatarVer={avatarVer}
                      onAvatarChanged={() => {
                        setAvatarVer((v) => v + 1)
                        refreshArtists()
                      }}
                      onArtistChanged={() => Promise.all([
                        refreshArtists(),
                        refreshLibrary({ invalidateTracks: false }),
                      ])} />
        )}
        {route.view === 'album' && (
          <AlbumPage key={route.arg} id={route.arg} onPlay={playFrom}
                     onAuthError={() => setAuthed(false)}
                     playingId={playing ? current?.id : null}
                     currentId={current?.id}
                     currentAlbumId={current?.albumId}
                     onTogglePlayback={toggle}
                     isAdmin={isAdmin}
                     favAlbums={favAlbums} favTracks={favTracks}
                     toggleFav={toggleFav}
                     onChanged={refreshLibrary}
                     artistOptions={artists}
                     onOpen={openAlbum} onOpenArtist={openArtist}
                     onOpenGenre={openGenre} />
        )}
        {route.view === 'import' && isAdmin && (
          <ImportPage albums={albums} artistOptions={artists}
                      onDone={refreshLibrary} onOpen={openAlbum} />
        )}
        {route.view === 'admin' && isAdmin && (
          <AdminPage onOpen={openAlbum} />
        )}
      </main>

      <Player audioRef={audioRef} current={current} playing={playing}
              shuffle={shuffle} repeat={repeat}
              onToggle={toggle} onStep={step}
              onShuffle={toggleShuffle} onRepeat={cycleRepeat}
              npOpen={npOpen} setNpOpen={setNpOpen}
              isAdmin={isAdmin}
              fav={current ? favTracks.has(current.id) : false}
              onFav={() => current && toggleFav('track', current.id)}
              onOpenAlbum={() => current && openAlbum(current.albumId)}
              onOpenArtist={openArtist} />
      <nav className="tabbar">
        {NAV.map((n) => (
          <a key={n.key} className={n.on ? 'on' : ''} href={`#${n.hash}`}
             aria-label={n.label} aria-current={n.on ? 'page' : undefined}
             onClick={navClick(n.hash, navigateToTop)}>
            <n.icon size={21} /><span>{n.label}</span>
          </a>
        ))}
      </nav>
      <audio ref={audioRef} preload="metadata" playsInline
             onEnded={() => {
               pendingBufferResumeRef.current = null
               pendingSystemSeekRef.current = null
               setPlaying(false)
               deferAdjacentSource(1)
               step(1)
             }}
               onPlay={() => setPlaying(true)}
               onPlaying={() => {
                 pendingBufferResumeRef.current = null
                 setPlaying(true)
               }}
               onWaiting={(event) => {
                 pauseSilentIOSClock(event.currentTarget)
               }}
               onCanPlay={(event) => {
                 resumeBufferedBackgroundAudio(event.currentTarget)
               }}
               onPause={(event) => {
                 const warming = deferSystemStartRef.current
                   || pendingStartRef.current === sourceRef.current.id
                   || pendingBufferResumeRef.current === sourceRef.current.id
                 if (event.currentTarget.paused && !warming) setPlaying(false)
               }}
             onError={() => {
               const a = audioRef.current
               const source = sourceRef.current
               if (!current || source.id !== current.id) return
                // If the Microsoft direct/CDN link fails, retry this track once through the local Range proxy.
                if (a && !source.proxy) {
                  const keepWarming = pendingStartRef.current === current.id
                  sourceRef.current = { id: current.id, proxy: true }
                  a.src = streamUrl(current.id, { proxy: true })
                  if (keepWarming) {
                    a.preload = 'auto'
                    a.load()
                    setPlaying(true)
                  } else {
                    playAudio(a, current.id)
                  }
                  return
                }
                deferSystemStartRef.current = false
                pendingStartRef.current = null
                pendingBufferResumeRef.current = null
                pendingSystemSeekRef.current = null
                setPlaying(false)
               if (current) toast(t('player.playFail', current.title), 'err')
             }} />
    </div>
  )
}
