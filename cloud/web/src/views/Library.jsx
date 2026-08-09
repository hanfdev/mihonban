import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, artUrl } from '../api.js'
import { ClearFilters, FilterSel, I, Rating, VisibilityToggle, goBack, useToast } from '../ui.jsx'
import { useI18n } from '../i18n.jsx'
import { zhNorm } from '../zh.js'
import { romajiOf } from '../aliases.js'
import { albumPlaybackState } from '../album-playback.js'
import { defaultCollator, jaCollator } from '../format.js'
import { currentCoverLoadingProfile } from '../cover-loading.js'
import { ArtistCredit, artistCreditText, artistSearchText, creditsOf,
         hasArtist } from '../artist-credit.jsx'
import { contentLanguage } from '../content-language.js'
import { compareRawRym, compareWeightedRym } from '../rating-ranking.js'

const decadeOf = (y) => (y ? `${Math.floor(y / 10) * 10}s` : null)

const coverPreloadCallbacks = new WeakMap()
let coverPreloadObserver = null
const coverLoading = currentCoverLoadingProfile()
const COVER_RETRY_LIMIT = 3

const retryUrl = (src, attempt) => {
  if (!attempt) return src
  const separator = src.includes('?') ? '&' : '?'
  return `${src}${separator}retry=${attempt}`
}

const retryDelay = (attempt) => 700 + attempt * 1100

export const isPriorityCover = (index) => index < coverLoading.priorityCount

function observeCoverAhead(element, onEnter) {
  if (typeof IntersectionObserver === 'undefined') {
    onEnter()
    return () => {}
  }
  if (!coverPreloadObserver) {
    coverPreloadObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const callback = coverPreloadCallbacks.get(entry.target)
        if (callback) callback()
        coverPreloadObserver.unobserve(entry.target)
        coverPreloadCallbacks.delete(entry.target)
      })
    }, { rootMargin: coverLoading.rootMargin })
  }
  coverPreloadCallbacks.set(element, onEnter)
  coverPreloadObserver.observe(element)
  return () => {
    coverPreloadObserver.unobserve(element)
    coverPreloadCallbacks.delete(element)
  }
}

function AheadCoverImage({ src, alt, priority = false }) {
  const imageRef = useRef(null)
  const retryTimer = useRef(null)
  const currentSrc = useRef(src)
  const [shouldLoad, setShouldLoad] = useState(priority)
  const [ready, setReady] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // Keep a successfully loaded cover across filtering and sorting changes.
    // The card keeps its stable album key, so priority can change without
    // requiring the same image to be fetched and decoded again.
    const sourceChanged = currentSrc.current !== src
    if (sourceChanged) {
      currentSrc.current = src
      setReady(false)
      setAttempt(0)
      setShouldLoad(priority)
    } else if (priority) {
      setShouldLoad(true)
    }
    if (retryTimer.current) {
      clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
    const stopObserving = priority ? () => {} : observeCoverAhead(
      imageRef.current, () => setShouldLoad(true))
    return () => {
      stopObserving()
      if (retryTimer.current) clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
  }, [priority, src])

  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current)
  }, [])

  const onLoad = () => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
    setReady(true)
  }

  const onError = () => {
    setReady(false)
    if (!shouldLoad || attempt >= COVER_RETRY_LIMIT || retryTimer.current) return
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null
      setAttempt((value) => value + 1)
    }, retryDelay(attempt))
  }

  return (
    <>
      <span className="cover-placeholder" aria-hidden="true"><I.disc size={26} /></span>
      <img ref={imageRef} className={`cover-img ${ready ? 'is-ready' : ''}`}
           loading="eager" decoding="async"
           fetchPriority="auto"
           src={shouldLoad ? retryUrl(src, attempt) : undefined} alt={alt}
           onLoad={onLoad} onError={onError} />
    </>
  )
}

function AlbumCardInner({ a, onOpen, onOpenArtist, onPlay,
                          currentAlbumId, playingId, onTogglePlayback,
                          priority = false }) {
  const { t } = useI18n()
  const toast = useToast()
  const playback = albumPlaybackState(a.id, currentAlbumId, playingId)
  const openAlbumWithKey = (event) => {
    // Ignore keys from the nested play button; otherwise Enter would both start playback and open the album.
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(a.id)
    }
  }
  return (
    <div className={`card ${a.hidden ? 'is-hidden' : ''} ${
              playback.current ? 'is-current' : ''}`}>
      <div className="cover" role="button" tabIndex={0}
           aria-label={`${a.title} · ${artistCreditText(a)}`}
           onKeyDown={openAlbumWithKey} onClick={() => onOpen(a.id)}>
        <AheadCoverImage src={artUrl(a.id, 400)} priority={priority}
                         alt={`${a.title} · ${artistCreditText(a)}`} />
        {a.hidden && <span className="badge-hidden">{t('albumPage.hiddenBadge')}</span>}
        <button className={`play-fab ${playback.current ? 'is-current' : ''} ${
                  playback.playing ? 'is-playing' : ''}`}
                title={t(playback.playing ? 'common.pause' : 'common.play')}
                aria-label={`${t(playback.playing
                  ? 'common.pause' : 'common.play')} ${a.title}`}
                aria-pressed={playback.playing}
                onClick={(e) => {
                  e.stopPropagation()
                  if (playback.current && onTogglePlayback) onTogglePlayback()
                  else onPlay(a)
                }}>
          {playback.playing ? <I.pause size={17} /> : <I.play size={18} />}
        </button>
      </div>
      <div className="card-meta">
        <div className="card-title" role="button" tabIndex={0}
             lang={contentLanguage(a.title)}
             onKeyDown={openAlbumWithKey}
             onClick={() => onOpen(a.id)} title={a.title}>{a.title}</div>
        <div className="card-sub">
          <span className="card-byline">
            <ArtistCredit value={a} onOpen={onOpenArtist}
                          className="card-artist" />
            {a.year ? <span className="card-year">· {a.year}</span> : null}
          </span>
          <Rating value={a.rym?.rating} />
        </div>
      </div>
    </div>
  )
}

function sameAlbumCard(prev, next) {
  if (prev.a !== next.a || prev.priority !== next.priority
      || prev.onOpen !== next.onOpen || prev.onOpenArtist !== next.onOpenArtist
      || prev.onPlay !== next.onPlay
      || prev.onTogglePlayback !== next.onTogglePlayback) return false
  const previous = albumPlaybackState(
    prev.a.id, prev.currentAlbumId, prev.playingId)
  const current = albumPlaybackState(
    next.a.id, next.currentAlbumId, next.playingId)
  return previous.current === current.current
    && previous.playing === current.playing
}

export const AlbumCard = React.memo(AlbumCardInner, sameAlbumCard)

export default function Library({ albums, q, onOpen, onOpenArtist, onPlay,
                                  genreFromRoute, isAdmin,
                                  showHidden, setShowHidden, onClearQuery,
                                  currentAlbumId, playingId, onTogglePlayback }) {
  const { t } = useI18n()
  const toast = useToast()
  const [minR, setMinR] = useState(0)
  const [genre, setGenre] = useState(genreFromRoute || '')
  const [decade, setDecade] = useState('')
  const [artist, setArtist] = useState('')
  const [sort, setSort] = useState('rating')
  const hiddenAlbumCount = useMemo(() =>
    albums?.filter((album) => album.hidden).length || 0, [albums])
  const SORTS = useMemo(() => ({
    rating: { label: t('library.sortRating'),
      fn: compareWeightedRym },
    ratingRaw: { label: t('library.sortRatingRaw'), fn: compareRawRym },
    artist: { label: t('library.sortArtist'),
      fn: (a, b) => defaultCollator.compare(
        a.artistSort || a.artist, b.artistSort || b.artist)
        || (a.year ?? 0) - (b.year ?? 0) },
    title: { label: t('library.sortTitle'),
      fn: (a, b) => jaCollator.compare(a.title, b.title) },
    yearNew: { label: t('library.sortYearNew'),
      fn: (a, b) => (b.year ?? 0) - (a.year ?? 0) },
    yearOld: { label: t('library.sortYearOld'),
      fn: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) },
    added: { label: t('library.sortAdded'),
      fn: (a, b) => b.updatedAt - a.updatedAt },
  }), [t])

  // Filter choices must describe the collection the user can currently see.
  // Hidden-only genres/artists/decades appear only while "show hidden" is on.
  const optionAlbums = useMemo(() => (albums || []).filter((album) =>
    !album.hidden || (isAdmin && showHidden)), [albums, isAdmin, showHidden])

  const genres = useMemo(() => {
    const m = new Map()
    optionAlbums.forEach((a) => [...(a.genres || []), ...(a.secondaryGenres || [])]
      .forEach((g) => {
        const k = g.toLowerCase()
        const e = m.get(k) || { n: 0, forms: new Map() }
        e.n++; e.forms.set(g, (e.forms.get(g) || 0) + 1); m.set(k, e)
      }))
    return [...m.values()].sort((a, b) => b.n - a.n)
      .map((e) => [...e.forms.entries()].sort((x, y) => y[1] - x[1])[0][0])
  }, [optionAlbums])

  const decades = useMemo(() => {
    const s = new Set()
    optionAlbums.forEach((a) => { const d = decadeOf(a.year); if (d) s.add(d) })
    return [...s].sort()
  }, [optionAlbums])

  const artistList = useMemo(() => {
    const m = new Map()
    optionAlbums.forEach((a) => creditsOf(a).forEach((credit) =>
      m.set(credit.name, (m.get(credit.name) || 0) + 1)))
    return [...m.entries()].sort((x, y) => y[1] - x[1])
  }, [optionAlbums])

  // Turning "show hidden" off can remove the selected option. Clear only that
  // now-invalid filter instead of leaving an invisible condition behind.
  useEffect(() => {
    if (!genreFromRoute && genre && !genres.some((g) =>
      g.toLowerCase() === genre.toLowerCase())) setGenre('')
  }, [genre, genreFromRoute, genres])
  useEffect(() => {
    if (artist && !artistList.some(([name]) => name === artist)) setArtist('')
  }, [artist, artistList])
  useEffect(() => {
    if (decade && !decades.includes(decade)) setDecade('')
  }, [decade, decades])

  // Building the zhNorm haystack consults a 4,000-entry map for every character, so rebuild it only with the album list.
  // Each keystroke then performs only a cheap includes filter instead of renormalizing the entire collection.
  const searchHay = useMemo(() => {
    const m = new Map()
    for (const a of albums || []) {
      m.set(a.id, zhNorm(
        `${a.title} ${artistSearchText(a)} ${creditsOf(a)
          .map((credit) => romajiOf(credit.name)).join(' ')} ` +
        `${(a.genres || []).join(' ')} ${(a.secondaryGenres || []).join(' ')}`))
    }
    return m
  }, [albums])

  const shown = useMemo(() => {
    if (!albums) return null
    const needle = zhNorm(q.trim())
    const wantG = genre.toLowerCase()
    const out = albums.filter((a) => {
      // Hidden albums stay out of the administrator's default view until the visibility toggle is enabled.
      if (a.hidden && !(isAdmin && showHidden)) return false
      if (needle && !searchHay.get(a.id).includes(needle)) return false
      if (minR && (a.rym?.rating ?? 0) < minR) return false
      if (decade && decadeOf(a.year) !== decade) return false
      if (artist && !hasArtist(a, artist)) return false
      if (wantG && ![...(a.genres || []), ...(a.secondaryGenres || [])]
        .some((g) => g.toLowerCase() === wantG)) return false
      return true
    })
    return out.sort(SORTS[sort].fn)
  }, [albums, searchHay, q, minR, genre, decade, artist, sort, SORTS, isAdmin,
      showHidden])

  const playAlbum = useCallback(async (a) => {
    try {
      const detail = await api.album(a.id)
      if (detail.tracks?.length) onPlay(detail, detail.tracks)
    } catch (e) { toast(e.message, 'err') }
  }, [onPlay, toast])

  const activeFilterCount = Number(!!q.trim()) + Number(minR > 0)
    + Number(!!decade) + Number(!!artist)
    + Number(!genreFromRoute && !!genre)
  const clearFilters = () => {
    onClearQuery?.()
    setMinR(0)
    setDecade('')
    setArtist('')
    setGenre(genreFromRoute || '')
  }

  return (
    <>
      {genreFromRoute && (
        <div className="ctx-head">
          <button className="back-btn" onClick={goBack}>
            <I.back size={15} /> {t('common.back')}</button>
          <h2 className="ctx-title">{genreFromRoute}</h2>
          {shown && <span className="ctx-sub">{t('count.albums', shown.length)}</span>}
        </div>
      )}
      <div className="filters library-filters">
        <div className="library-filter-main">
          <FilterSel on={minR > 0} value={String(minR)}
                     onChange={(e) => setMinR(Number(e.target.value))}>
            <option value="0">{t('library.filterRating')}</option>
            {![0, 2.5, 3, 3.2, 3.4, 3.5, 3.6, 3.8, 4, 4.2].includes(minR) &&
              <option value={String(minR)}>{minR.toFixed(1)}+</option>}
            <option value="2.5">2.5+</option>
            <option value="3">3.0+</option>
            <option value="3.2">3.2+</option>
            <option value="3.4">3.4+</option>
            <option value="3.5">3.5+</option>
            <option value="3.6">3.6+</option>
            <option value="3.8">3.8+</option>
            <option value="4">4.0+</option>
            <option value="4.2">4.2+</option>
          </FilterSel>
          <FilterSel on={!!decade} value={decade}
                     onChange={(e) => setDecade(e.target.value)}>
            <option value="">{t('library.filterDecade')}</option>
            {decades.map((d) => <option key={d} value={d}>{d}</option>)}
          </FilterSel>
          <FilterSel on={!!artist} value={artist}
                     onChange={(e) => setArtist(e.target.value)}>
            <option value="">{t('library.filterArtist')}</option>
            {artistList.map(([name, n]) =>
              <option key={name} value={name}>{name}（{n}）</option>)}
          </FilterSel>
          {!genreFromRoute && (
            <FilterSel on={!!genre} value={genre}
                       onChange={(e) => setGenre(e.target.value)}>
              <option value="">{t('library.filterGenre')}</option>
              {genres.map((g) => <option key={g} value={g}>{g}</option>)}
            </FilterSel>
          )}
          {isAdmin && hiddenAlbumCount > 0 && (
            <VisibilityToggle on={showHidden}
                              onToggle={() => setShowHidden((value) => !value)}
                              label={t('library.showHidden')}
                              count={hiddenAlbumCount} />
          )}
        </div>
        <div className="filter-tail">
          <ClearFilters count={activeFilterCount} onClear={clearFilters}
                        label={t('common.clearFilters')} />
          <select className="sort-sel ghost" value={sort}
                  onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([k, v]) =>
              <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid library-grid">
        {!shown && [...Array(12)].map((_, i) =>
          <div key={i}><div className="sk" style={{ aspectRatio: 1 }} />
            <div className="sk" style={{ height: 14, marginTop: 11, width: '80%' }} />
          </div>)}
        {shown && shown.length === 0 && (
          <div className="empty">
            <div className="big">{t('empty.noMatch')}</div>
            <div>{t('empty.tryOther')}</div>
          </div>
        )}
        {shown && shown.map((a, index) =>
          <AlbumCard key={a.id} a={a} onOpen={onOpen}
                     onOpenArtist={onOpenArtist} onPlay={playAlbum}
                     priority={isPriorityCover(index)}
                     currentAlbumId={currentAlbumId} playingId={playingId}
                     onTogglePlayback={onTogglePlayback} />)}
      </div>
    </>
  )
}
