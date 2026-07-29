import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { ClearFilters, FilterSel, I, usePointerReorder, useToast } from '../ui.jsx'
import { useI18n } from '../i18n.jsx'
import { zhNorm } from '../zh.js'
import { romajiOf } from '../aliases.js'
import { AlbumCard } from './Library.jsx'
import { TrackRow } from './Tracks.jsx'
import { defaultCollator, jaCollator } from '../format.js'
import { locateTrackRow } from '../track-locate.js'

const decadeOf = (y) => (y ? `${Math.floor(y / 10) * 10}s` : null)
const storedSort = (key, allowed) => {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value) ? value : 'fav'
  } catch { return 'fav' }
}
const saveSort = (key, value) => {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}

// 收藏专用排序：不含评分（歌曲没有评分；音盤也统一不按评分排，避免与曲库重复）
const cmpArtist = (a, b) =>
  defaultCollator.compare(a.artistSort || a.artist || '',
    b.artistSort || b.artist || '') ||
  (a.year ?? 0) - (b.year ?? 0)

export default function FavoritesPage({ albums, tracks, ensureTracks, favs, q,
                                        isAdmin, favTracks, toggleFav, onReorder,
                                        onOpen, onOpenArtist, onPlay,
                                        onPlayTracks, currentId, playingId,
                                        currentAlbumId, onTogglePlayback,
                                        playerShuffle, onClearQuery,
                                        tab = 'albums', onTabChange }) {
  const { t } = useI18n()
  const toast = useToast()
  // 排序偏好持久化：用户挑的顺序下次进来还在（含「默认顺序自己调」的诉求）
  const [aSort, setASort] = useState(() => storedSort(
    'mihonban_favorite_album_sort', ['fav', 'artist', 'title', 'yearNew', 'yearOld']))
  const [tSort, setTSort] = useState(() => storedSort(
    'mihonban_favorite_track_sort', ['fav', 'title', 'artist', 'album', 'yearNew', 'yearOld']))
  const [fArtist, setFArtist] = useState('')
  const [fDecade, setFDecade] = useState('')
  const [fGenre, setFGenre] = useState('')
  const [shuf, setShuf] = useState(playerShuffle) // 歌曲 tab 的随机开关（只切状态，不触发播放）
  useEffect(() => setShuf(playerShuffle), [playerShuffle])
  useEffect(() => { saveSort('mihonban_favorite_album_sort', aSort) }, [aSort])
  useEffect(() => { saveSort('mihonban_favorite_track_sort', tSort) }, [tSort])

  const ALBUM_SORTS = useMemo(() => ({
    fav: { label: t('favs.sortOrder'), fn: null },
    artist: { label: t('library.sortArtist'), fn: cmpArtist },
    title: { label: t('library.sortTitle'),
      fn: (a, b) => jaCollator.compare(a.title, b.title) },
    yearNew: { label: t('library.sortYearNew'),
      fn: (a, b) => (b.year ?? 0) - (a.year ?? 0) },
    yearOld: { label: t('library.sortYearOld'),
      fn: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) },
  }), [t])
  const TRACK_SORTS = useMemo(() => ({
    fav: { label: t('favs.sortOrder'), fn: null },
    title: { label: t('tracks.sortTitle'),
      fn: (a, b) => jaCollator.compare(a.title, b.title) },
    artist: { label: t('library.sortArtist'),
      fn: (a, b) => cmpArtist(a, b)
        || defaultCollator.compare(a.albumTitle || '', b.albumTitle || '') },
    album: { label: t('tracks.sortAlbum'),
      fn: (a, b) => jaCollator.compare(a.albumTitle || '', b.albumTitle || '')
        || (a.track ?? 0) - (b.track ?? 0) },
    yearNew: { label: t('library.sortYearNew'),
      fn: (a, b) => (b.year ?? 0) - (a.year ?? 0) },
    yearOld: { label: t('library.sortYearOld'),
      fn: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) },
  }), [t])

  useEffect(() => {
    if (tab === 'tracks' && tracks === null) ensureTracks()
  }, [tab, tracks, ensureTracks])

  const needle = zhNorm(q.trim())
  const hasAlbumFilter = !!(fArtist || fDecade || fGenre || needle)

  // 收藏音盤：按 favs.albums 的后端顺序（sort_order）取，保证「收藏顺序」可手动排
  const favAlbumsRaw = useMemo(() => {
    if (!albums) return null
    const byId = new Map(albums.map((a) => [a.id, a]))
    return favs.albums.map((f) => byId.get(f.id)).filter(Boolean)
  }, [albums, favs])

  const aArtists = useMemo(() => {
    const m = new Map()
    favAlbumsRaw?.forEach((a) => m.set(a.artist, (m.get(a.artist) || 0) + 1))
    return [...m.entries()].sort((x, y) => y[1] - x[1])
  }, [favAlbumsRaw])
  const aDecades = useMemo(() => {
    const s = new Set()
    favAlbumsRaw?.forEach((a) => { const d = decadeOf(a.year); if (d) s.add(d) })
    return [...s].sort()
  }, [favAlbumsRaw])
  const aGenres = useMemo(() => {
    const m = new Map()
    favAlbumsRaw?.forEach((a) => [...(a.genres || []), ...(a.secondaryGenres || [])]
      .forEach((g) => {
        const k = g.toLowerCase()
        const e = m.get(k) || { n: 0, forms: new Map() }
        e.n++; e.forms.set(g, (e.forms.get(g) || 0) + 1); m.set(k, e)
      }))
    return [...m.values()].sort((a, b) => b.n - a.n)
      .map((e) => [...e.forms.entries()].sort((x, y) => y[1] - x[1])[0][0])
  }, [favAlbumsRaw])

  const favAlbumList = useMemo(() => {
    if (!favAlbumsRaw) return null
    const wantG = fGenre.toLowerCase()
    const out = favAlbumsRaw.filter((a) => {
      if (needle && !zhNorm(`${a.title} ${a.artist} ${a.artistSort || ''} ${romajiOf(a.artist)}`)
        .includes(needle)) return false
      if (fArtist && a.artist !== fArtist) return false
      if (fDecade && decadeOf(a.year) !== fDecade) return false
      if (wantG && ![...(a.genres || []), ...(a.secondaryGenres || [])]
        .some((g) => g.toLowerCase() === wantG)) return false
      return true
    })
    const fn = ALBUM_SORTS[aSort].fn
    return fn ? [...out].sort(fn) : out // fav 模式 = 后端顺序，不再排
  }, [favAlbumsRaw, needle, fArtist, fDecade, fGenre, aSort])

  const favTrackList = useMemo(() => {
    if (!tracks) return null
    const byId = new Map(tracks.map((t) => [t.id, t]))
    const out = favs.tracks.map((f) => byId.get(f.id)).filter(Boolean)
      .filter((t) => !needle ||
        zhNorm(`${t.title} ${t.artist} ${romajiOf(t.artist)} ${t.albumTitle}`).includes(needle))
    const fn = TRACK_SORTS[tSort].fn
    return fn ? [...out].sort(fn) : out // fav 模式 = 后端顺序
  }, [tracks, favs, needle, tSort])

  // ---- 手动拖动排序（仅收藏顺序 + 管理员 + 无筛选/搜索时可拖）----
  const canDragA = isAdmin && aSort === 'fav' && !hasAlbumFilter
  const canDragT = isAdmin && tSort === 'fav' && !needle
  const [drag, setDrag] = useState(null)   // 拖动中的临时 id 序
  const dragRef = useRef(null)             // 最新 id 序（避开 onCommit 闭包读到旧 state）
  const setDragOrder = (ids) => { dragRef.current = ids; setDrag(ids) }

  // 应用拖动中的临时顺序到显示列表
  const orderBy = (list, ids) => {
    if (!ids || !list) return list
    const byId = new Map(list.map((x) => [x.id, x]))
    return ids.map((id) => byId.get(id)).filter(Boolean)
  }
  const shownAlbums = drag && canDragA ? orderBy(favAlbumList, drag) : favAlbumList
  const shownTracks = drag && canDragT ? orderBy(favTrackList, drag) : favTrackList

  // onMove 用 ref 读当前显示序（避开闭包旧值）；起手时以当前序为基准
  const listRef = useRef({ a: null, t: null })
  listRef.current = { a: shownAlbums, t: shownTracks }
  const moveIn = (which, from, to) => {
    const cur = dragRef.current || (listRef.current[which] || []).map((x) => x.id)
    if (from < 0 || to < 0 || from >= cur.length || to >= cur.length) return
    const n = [...cur]
    const [m] = n.splice(from, 1)
    n.splice(to, 0, m)
    setDragOrder(n)
  }
  const commit = (kind) => {
    const ids = dragRef.current
    dragRef.current = null
    if (ids) onReorder(kind, ids)
    setDrag(null)
  }

  const albumDrag = usePointerReorder({
    itemSelector: '.fav-card', enabled: canDragA,
    onMove: (from, to) => moveIn('a', from, to),
    onCommit: () => commit('album'),
  })
  const trackDrag = usePointerReorder({
    itemSelector: '.fav-trow', enabled: canDragT,
    onMove: (from, to) => moveIn('t', from, to),
    onCommit: () => commit('track'),
  })

  // 定位正在播放的歌
  const hasCurrent = useMemo(() =>
    !!currentId && !!shownTracks?.some((t) => t.id === currentId), [shownTracks, currentId])
  const filterRailRef = useRef(null)
  useLayoutEffect(() => {
    const rail = filterRailRef.current
    if (tab !== 'tracks' || !rail
        || !window.matchMedia('(max-width: 720px)').matches) return undefined

    // Android Chrome can preserve a control near the right as the horizontal
    // scroll anchor while tracks load or the locate action mounts. Reveal the
    // primary play action before paint and once again after layout settles.
    const revealStart = () => { rail.scrollLeft = 0 }
    revealStart()
    const frame = requestAnimationFrame(revealStart)
    return () => cancelAnimationFrame(frame)
  }, [tab, hasCurrent, shownTracks?.length])

  const locate = () => {
    locateTrackRow(currentId)
  }

  const playAlbum = async (a) => {
    try {
      const detail = await api.album(a.id)
      if (detail.tracks?.length) onPlay(detail, detail.tracks) // 起点交给播放器状态
    } catch (e) { toast(e.message, 'err') }
  }

  const empty = (what) => (
    <div className="empty">
      <div className="big">{what === 'albums' ? t('favs.emptyAlbums') : t('favs.emptyTracks')}</div>
      <div>{isAdmin ? t('favs.emptyHintAdmin') : t('favs.emptyHintUser')}</div>
    </div>
  )

  const activeFilterCount = Number(!!q.trim()) + (tab === 'albums'
    ? Number(!!fArtist) + Number(!!fDecade) + Number(!!fGenre)
    : 0)
  const clearFilters = () => {
    onClearQuery?.()
    if (tab === 'albums') {
      setFArtist('')
      setFDecade('')
      setFGenre('')
    }
  }

  return (
    <div className="favs-page">
      <div ref={filterRailRef}
           className={`filters ${tab === 'tracks' ? 'pin center' : ''}`}>
        {tab === 'tracks' && shownTracks?.length > 0 && (
          <>
            <button className="play-big"
                    title={shuf ? t('common.shuffleOn') : t('common.playAll')}
                    onClick={() => onPlayTracks(shownTracks, undefined, { shuffle: shuf })}>
              <I.play size={20} />
            </button>
            <button className={`icon-round ${shuf ? 'on' : ''}`}
                    title={shuf ? t('common.shuffleOn') : t('common.shuffleOff')}
                    onClick={() => setShuf(!shuf)}>
              <I.shuffle size={15} />
            </button>
            {hasCurrent && (
              <button className="icon-round" title={t('common.locate')} onClick={locate}>
                <I.locate size={15} />
              </button>
            )}
          </>
        )}

        <div className="seg">
          <button className={tab === 'albums' ? 'on' : ''}
                  onClick={() => onTabChange?.('albums')}>
            {t('favs.albums')}{favs.albums.length ? ` ${favs.albums.length}` : ''}</button>
          <button className={tab === 'tracks' ? 'on' : ''}
                  onClick={() => onTabChange?.('tracks')}>
            {t('favs.tracks')}{favs.tracks.length ? ` ${favs.tracks.length}` : ''}</button>
        </div>

        {tab === 'albums' && (
          <>
            <FilterSel on={!!fArtist} value={fArtist}
                       onChange={(e) => setFArtist(e.target.value)}>
              <option value="">{t('library.filterArtist')}</option>
              {aArtists.map(([name, n]) =>
                <option key={name} value={name}>{name}（{n}）</option>)}
            </FilterSel>
            <FilterSel on={!!fDecade} value={fDecade}
                       onChange={(e) => setFDecade(e.target.value)}>
              <option value="">{t('library.filterDecade')}</option>
              {aDecades.map((d) => <option key={d} value={d}>{d}</option>)}
            </FilterSel>
            <FilterSel on={!!fGenre} value={fGenre}
                       onChange={(e) => setFGenre(e.target.value)}>
              <option value="">{t('library.filterGenre')}</option>
              {aGenres.map((g) => <option key={g} value={g}>{g}</option>)}
            </FilterSel>
          </>
        )}

        <div className="filter-tail">
          <ClearFilters count={activeFilterCount} onClear={clearFilters}
                        label={t('common.clearFilters')} />
          <select className="sort-sel ghost"
                  value={tab === 'albums' ? aSort : tSort}
                  onChange={(e) => (tab === 'albums' ? setASort : setTSort)(e.target.value)}>
            {Object.entries(tab === 'albums' ? ALBUM_SORTS : TRACK_SORTS).map(([k, v]) =>
              <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      {tab === 'albums' && canDragA && shownAlbums?.length > 0 && (
        <div className="fav-drag-hint"><I.grip size={12} /> {t('favs.dragHint')}</div>
      )}

      {tab === 'albums' && (
        <div className="grid">
          {shownAlbums && shownAlbums.length === 0 && empty('albums')}
          {shownAlbums && shownAlbums.map((a, i) => (
            <div key={a.id}
                 className={`fav-card ${canDragA ? 'draggable' : ''} ${albumDrag.active === i ? 'dragging' : ''}`}
                 {...albumDrag.dragProps(i)}>
              {canDragA && (
                <span className="fav-card-grip" data-drag-handle title={t('favs.dragHint')}>
                  <I.grip size={16} />
                </span>
              )}
              <AlbumCard a={a} onOpen={onOpen}
                         onOpenArtist={onOpenArtist} onPlay={playAlbum}
                         currentAlbumId={currentAlbumId} playingId={playingId}
                         onTogglePlayback={onTogglePlayback} />
            </div>
          ))}
        </div>
      )}
      {tab === 'tracks' && (
        <div className="tracks flat-list">
          {!shownTracks && favs.tracks.length > 0 &&
            [...Array(Math.min(favs.tracks.length, 8))].map((_, i) =>
              <div key={i} className="sk" style={{ height: 52, marginBottom: 6 }} />)}
          {shownTracks && shownTracks.length === 0 && empty('tracks')}
          {shownTracks && shownTracks.map((tr, i) => (
            <div key={tr.id}
                 className={`fav-trow ${canDragT ? 'draggable' : ''} ${trackDrag.active === i ? 'dragging' : ''}`}
                 {...trackDrag.dragProps(i)}>
              {canDragT && <span className="fav-grip" data-drag-handle><I.grip size={16} /></span>}
              <TrackRow t={tr} i={i}
                        currentId={currentId} playingId={playingId}
                        isAdmin={isAdmin} fav={favTracks.has(tr.id)}
                        onToggleFav={(id) => toggleFav('track', id)}
                        onPlay={(idx) => onPlayTracks(shownTracks, idx)}
                        onOpen={onOpen} onOpenArtist={onOpenArtist} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
