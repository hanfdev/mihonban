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
import { seekAudio, updateMediaPosition } from './media.js'
import { installTrackMediaSessionHandlers } from './media-session.js'
import { adjacentQueuePosition } from './player-queue.js'
import { visibleAlbumCount } from './visibility.js'

const parseHash = () => {
  const h = location.hash.replace(/^#\/?/, '')
  const [view, ...rest] = h.split('/')
  const encoded = rest.join('/')
  let arg = encoded
  try { arg = decodeURIComponent(encoded) } catch { /* keep malformed text literal */ }
  return { view: view || 'library', arg }
}

// 设备解码能力判定用：format → MIME（如 iPhone 的 Safari 没有 Vorbis 解码器）
const AUDIO_MIME = {
  mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg; codecs="opus"', m4a: 'audio/mp4', aac: 'audio/aac',
  wav: 'audio/wav', aiff: 'audio/aiff', aif: 'audio/aiff',
}

// 播放顺序：非随机 = 自然顺序从 startIdx 起；随机 = 当前曲优先 + 其余洗牌
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
  const [authed, setAuthed] = useState(null) // null = 检查中
  const [role, setRole] = useState(null)     // 'user' | 'admin'
  const [guest, setGuest] = useState(false)  // 访客免密进入（可再登录成管理员）
  // loginMode: null | 'admin'（升管理员）| 'switch'（换号/登出后再登）
  const [loginMode, setLoginMode] = useState(null)
  const [sessOpen, setSessOpen] = useState(false)  // 顶栏会话菜单
  const sessRef = useRef(null)
  const [route, setRoute] = useState(parseHash())
  const [albums, setAlbums] = useState(null)
  const [tracksAll, setTracksAll] = useState(null) // 懒加载的全曲目
  const [artists, setArtists] = useState([])       // [{name, hasAvatar}]
  const [avatarVer, setAvatarVer] = useState(0)    // 头像换过后破缓存
  const [favs, setFavs] = useState({ albums: [], tracks: [] })
  const favsRef = useRef(favs)
  // 只允许最新的数据请求回写，避免身份切换时旧响应覆盖当前状态。
  const roleRef = useRef(role)
  const authedRef = useRef(authed)
  roleRef.current = role
  authedRef.current = authed
  const libraryRequestRef = useRef(0)
  const tracksRequestRef = useRef(0)
  const artistsRequestRef = useRef(0)
  const favoritesRequestRef = useRef(0)
  const [q, setQ] = useState('')
  // 管理员在专辑页/歌曲页共用同一个「显示已隐藏」状态，默认关闭。
  const [showHidden, setShowHidden] = useState(false)
  const [mSearch, setMSearch] = useState(false)    // 移动端搜索行开关
  const [scrolled, setScrolled] = useState(false)  // 内容滚动后给顶栏加投影
  const mainRef = useRef(null)

  // ---- 播放器状态 ----
  const audioRef = useRef(null)
  // list: 归一化曲目 {id,title,duration,artist,albumId,albumTitle}
  const [queue, setQueue] = useState({ list: [], order: [], pos: -1 })
  const [playing, setPlaying] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState('off') // off | all | one
  const [npOpen, setNpOpen] = useState(false) // 移动端全屏播放页
  const current = queue.pos >= 0 ? queue.list[queue.order[queue.pos]] : null

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash())
      mainRef.current?.scrollTo(0, 0)   // 滚动在内容容器里，不在 window
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const refreshLibrary = useCallback(async (options = {}) => {
    const requestId = ++libraryRequestRef.current
    const requestedRole = role
    try {
      // 管理员带 hidden=1：可在曲库管理隐藏音盤；访客/听众永不看见
      const next = await api.library({ hidden: requestedRole === 'admin' })
      if (requestId !== libraryRequestRef.current
          || roleRef.current !== requestedRole || !authedRef.current) return
      setAlbums(next)
      // 初次登录/切换身份时已经在请求前失效，不能在较慢的 library 请求完成后
      // 再把刚加载好的歌曲覆盖成 null。编辑/隐藏专辑等普通刷新仍默认失效。
      if (options?.invalidateTracks !== false) setTracksAll(null)
    } catch (e) {
      if (requestId === libraryRequestRef.current && e instanceof api.AuthError) {
        setAuthed(false)
      }
    }
  }, [role])

  const ensureTracks = useCallback(async () => {
    const requestId = ++tracksRequestRef.current
    const requestedRole = role
    try {
      const next = await api.tracks({ hidden: requestedRole === 'admin' })
      if (requestId !== tracksRequestRef.current
          || roleRef.current !== requestedRole || !authedRef.current) return
      setTracksAll(next)
    } catch (e) {
      if (requestId === tracksRequestRef.current && e instanceof api.AuthError) {
        setAuthed(false)
      }
    }
  }, [role])

  const refreshArtists = useCallback(async () => {
    const requestId = ++artistsRequestRef.current
    const requestedRole = role
    try {
      const next = await api.artists({ hidden: requestedRole === 'admin' })
      if (requestId !== artistsRequestRef.current
          || roleRef.current !== requestedRole || !authedRef.current) return
      setArtists(next)
    } catch (e) {
      if (requestId === artistsRequestRef.current && e instanceof api.AuthError) {
        setAuthed(false)
      }
    }
  }, [role])

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

  const toggleFav = useCallback(async (kind, id) => {
    if (roleRef.current !== 'admin') return
    favoritesRequestRef.current++
    const key = kind === 'album' ? 'albums' : 'tracks'
    const currentFavs = favsRef.current
    const adding = !currentFavs[key].some((x) => x.id === id)
    applyFavs({
      ...currentFavs,
      [key]: adding ? [...currentFavs[key], { id, ts: Date.now() }]
        : currentFavs[key].filter((x) => x.id !== id),
    })
    try { await (adding ? api.addFavorite(kind, id) : api.removeFavorite(kind, id)) }
    catch { refreshFavorites() } // 失败回滚到服务端真相
  }, [applyFavs, refreshFavorites])

  // 收藏手动拖动重排：乐观更新本地顺序，再持久化到服务端
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

  // ---- 播放控制 ----
  const skipRun = useRef(0) // 连续自动跳过计数：整条队列都不支持时防死循环
  const sourceRef = useRef({ id: null, proxy: false })
  const playAttemptRef = useRef(0)
  const playAudio = useCallback((audio, sourceId = sourceRef.current.id) => {
    const attempt = ++playAttemptRef.current
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
    audio.pause()
    setPlaying(false)
  }, [])

  // index 省略 =「播放全部」：继承播放器当前模式，随机开着时起点也随机；
  // opts.shuffle = 强制随机（歌曲页的随机按钮），顺带把播放器切到随机模式
  const playTracks = useCallback((list, index, opts) => {
    if (!list?.length) return
    const useShuffle = opts?.shuffle ?? shuffle
    if (useShuffle !== shuffle) setShuffle(useShuffle)
    const start = index ?? (useShuffle ? Math.floor(Math.random() * list.length) : 0)
    const { order, pos } = buildOrder(list.length, start, useShuffle)
    setQueue({ list, order, pos })
    // Android Chrome 对首次有声播放严格要求调用仍处在点击手势内。
    // 先在本次事件栈里装载并播放；current 变化后的 effect 只负责兜底和切歌。
    const first = list[order[pos]]
    const audio = audioRef.current
    if (audio && first?.id) {
      playAttemptRef.current++
      sourceRef.current = { id: first.id, proxy: false }
      audio.src = streamUrl(first.id)
      playAudio(audio, first.id)
    }
  }, [playAudio, shuffle])

  // 专辑上下文播放（归一化补上艺人/专辑信息）
  const playFrom = useCallback((album, tracks, index) => {
    playTracks(tracks.map((t) => ({
      id: t.id, title: t.title, duration: t.duration, format: t.format,
      artist: t.artist || album.artist,
      albumId: t.albumId || album.id, albumTitle: t.albumTitle || album.title,
    })), index)
  }, [playTracks])

  useEffect(() => {
    const a = audioRef.current
    if (!a || !current) return
    // 播前先问浏览器能不能解码（iPhone 没有 Vorbis 解码器等），不行就跳过
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
    // 不再整首预取下一曲：它会制造并发大文件请求并触发 OneDrive 503 限流。
    const alreadyStarted = sourceRef.current.id === current.id
    if (!alreadyStarted) {
      playAttemptRef.current++
      sourceRef.current = { id: current.id, proxy: false }
      a.src = streamUrl(current.id)
    }
    const sourceId = current.id
    // playTracks already called play() inside the originating tap/click. Do
    // not issue a second asynchronous play request while that promise is in
    // flight: Android can treat the later call as detached from the gesture.
    if (!alreadyStarted) playAudio(a, sourceId)
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
      if (np === null) return s // 播完即停
      if (np === s.pos) { // 同曲重播（repeat all 单曲队列 / 到头按上一首）
        const a = audioRef.current
        if (a) { a.currentTime = 0; playAudio(a, sourceRef.current.id) }
        return s
      }
      return { ...s, pos: np }
    })
  }, [repeat, playAudio])

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
      seekAudio(a, Number(details.seekTime), current?.duration, !!details.fastSeek)
      sync()
    }
    return installTrackMediaSessionHandlers(ms, {
      play: () => {
        const a = audio()
        if (a) playAudio(a, sourceRef.current.id)
      },
      pause: () => {
        const a = audio()
        if (a) pauseAudio(a)
      },
      previoustrack: () => step(-1),
      nexttrack: () => step(1),
      seekto: seekTo,
    })
  }, [current?.id, current?.duration, pauseAudio, playAudio, step])

  // iOS 不一定采用 <audio> 自己推断的 OGG 时长；主动提供曲库时长和当前位置。
  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return
    const a = audioRef.current
    if (!a) return
    const ms = navigator.mediaSession
    const sync = () => {
      try {
        ms.playbackState = a.paused ? 'paused' : 'playing'
        updateMediaPosition(ms, a, current.duration)
      } catch { /* 老 Safari 只支持部分 Media Session API */ }
    }
    const events = ['loadedmetadata', 'durationchange', 'timeupdate', 'seeking',
      'seeked', 'play', 'pause', 'ratechange']
    events.forEach((event) => a.addEventListener(event, sync))
    sync()
    return () => events.forEach((event) => a.removeEventListener(event, sync))
  }, [current?.id, current?.duration])

  // 会话菜单：点外侧 / Esc 关闭
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

  // 退出：清 cookie + 本地状态，回到登录页
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
    try { await api.logout() } catch { /* ignore */ }
    setAuthed(false)
    setRole(null)
    setGuest(false)
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
  // 仅「升管理员」叠层登录；退出后走完整 Login 页
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

  const nav = navigate
  const openAlbum = (id) => nav(`/album/${id}`)
  const openArtist = (name) => nav(`/artist/${encodeURIComponent(name)}`)
  const openGenre = (g) => nav(`/genre/${encodeURIComponent(g)}`)

  const searchable = ['library', 'tracks', 'genre', 'favs', 'artists'].includes(route.view)
  // 主导航（所有人）与管理员入口分离，避免长文案语言下搜索框盖住选项
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
  // 移动端底栏仍合并为一组
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
          <div className="logo" onClick={() => nav('/')}>
            <Logo /> <span className="logo-t">{t('brand')} <em>{t('brandSub')}</em></span>
          </div>
          <nav className="nav nav-main">
            {NAV_MAIN.map((n) => (
              <a key={n.key} className={n.on ? 'on' : ''}
                 onClick={() => nav(n.hash)}>{n.label}</a>
            ))}
          </nav>
        </div>

        {/* 中间栏始终占位，保证搜索在整条顶栏几何中心（左/右 1fr 对称） */}
        <div className="hdr-center">
          {searchable && (
            <div className="search">
              <I.search size={15} />
              <input placeholder={t('search.placeholder')} value={q}
                     onChange={(e) => setQ(e.target.value)} />
              {q && <I.x size={14} style={{ cursor: 'pointer' }}
                         onClick={() => setQ('')} />}
            </div>
          )}
        </div>

        <div className="hdr-right">
          {searchable && (
            <button className={`icon-btn m-search ${mSearch ? 'on' : ''}`}
                    onClick={() => { setMSearch(!mSearch); if (mSearch) setQ('') }}>
              <I.search size={18} />
            </button>
          )}
          {NAV_ADMIN.length > 0 && (
            <nav className="nav nav-admin">
              {NAV_ADMIN.map((n) => (
                <a key={n.key} className={n.on ? 'on' : ''}
                   onClick={() => nav(n.hash)}>{n.label}</a>
              ))}
            </nav>
          )}
          <span className="hdr-count">
            {headerAlbumCount !== null ? t('count.albums', headerAlbumCount) : ''}
          </span>
          <LangSelect className="hdr-lang" />
          {/* 会话入口：产品只分两档——管理员 / 访客（只读）。
              后端的 user 口令与 guest 免密对用户都是「访客」。 */}
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
                {/* 有会话 cookie 时才显示退出（访客免密无 cookie，退出无意义） */}
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
            {q && <I.x size={14} onClick={() => setQ('')} />}
          </div>
        </div>
      )}

      <main className="main" ref={mainRef}
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
        {route.view === 'library' && <Library {...shared} />}
        {route.view === 'genre' && <Library {...shared} genreFromRoute={route.arg}
                                            key={`g:${route.arg}`} />}
        {route.view === 'tracks' && (
          <TracksPage {...shared} tracks={tracksAll} ensureTracks={ensureTracks} />
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
                         onTabChange={(tab) => nav(`/favs/${tab}`)} />
        )}
        {route.view === 'artist' && (
          <ArtistPage key={route.arg} {...shared} name={route.arg} artists={artists}
                      avatarVer={avatarVer}
                      onAvatarChanged={() => {
                        setAvatarVer((v) => v + 1)
                        refreshArtists()
                      }} />
        )}
        {route.view === 'album' && (
          <AlbumPage key={route.arg} id={route.arg} onPlay={playFrom}
                     playingId={playing ? current?.id : null}
                     currentId={current?.id}
                     currentAlbumId={current?.albumId}
                     onTogglePlayback={toggle}
                     isAdmin={isAdmin}
                     favAlbums={favAlbums} favTracks={favTracks}
                     toggleFav={toggleFav}
                     onChanged={refreshLibrary}
                     onOpen={openAlbum} onOpenArtist={openArtist}
                     onOpenGenre={openGenre} />
        )}
        {route.view === 'import' && isAdmin && (
          <ImportPage albums={albums} onDone={refreshLibrary} onOpen={openAlbum} />
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
          <a key={n.key} className={n.on ? 'on' : ''} onClick={() => nav(n.hash)}>
            <n.icon size={21} /><span>{n.label}</span>
          </a>
        ))}
      </nav>
      <audio ref={audioRef} preload="metadata" playsInline
             onEnded={() => { setPlaying(false); step(1) }}
             onPlay={() => setPlaying(true)}
             onPause={(event) => {
               // A source switch can queue a stale pause event after a new
               // play() call. Only accept it if the element is still paused.
               if (event.currentTarget.paused) setPlaying(false)
             }}
             onError={() => {
               const a = audioRef.current
               const source = sourceRef.current
               if (!current || source.id !== current.id) return
               // 微软直链/CDN 失败时，同一首自动切到本站 Range 代理一次。
               if (a && !source.proxy) {
                  sourceRef.current = { id: current.id, proxy: true }
                  a.src = `${streamUrl(current.id)}?proxy=1`
                  playAudio(a, current.id)
                  return
               }
               setPlaying(false)
               if (current) toast(t('player.playFail', current.title), 'err')
             }} />
    </div>
  )
}
