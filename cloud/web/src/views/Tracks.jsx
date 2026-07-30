import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { artUrl } from '../api.js'
import { ClearFilters, I, Heart, Marquee, fmtDur } from '../ui.jsx'
import { useI18n } from '../i18n.jsx'
import { zhNorm } from '../zh.js'
import { romajiOf } from '../aliases.js'
import { defaultCollator, jaCollator } from '../format.js'
import { locateTrackRow } from '../track-locate.js'
import { ArtistCredit, artistSearchText, creditsOf } from '../artist-credit.jsx'

function TrackRowInner({ t, i, currentId, playingId, isAdmin, fav,
                         onToggleFav, onPlay, onOpen, onOpenArtist, showAlbum = true }) {
  return (
    <div className={`trow flat ${t.hidden ? 'is-hidden' : ''} ${currentId === t.id ? 'playing' : ''}`}
         data-tid={t.id} role="button" tabIndex={0}
         aria-label={`${t.title} — ${t.artist}`}
         onClick={() => onPlay(i)}
         onKeyDown={(e) => {
           // Handle keys only when the row itself owns focus. Let nested favorite and artist controls receive their keys;
           // otherwise Enter would play the track instead of activating the focused control.
           if (e.target !== e.currentTarget) return
           if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(i) }
         }}>
      <img className="t-art" loading="lazy" src={artUrl(t.albumId, 120)} alt=""
           onClick={(e) => { e.stopPropagation(); onOpen(t.albumId) }} />
      <span className="t-main">
        <span className="t-title">
          {currentId === t.id && playingId
            ? <span className="eq" style={{ marginRight: 7 }}><i /><i /><i /></span>
            : null}
          {currentId === t.id
            ? <Marquee text={t.title} />
            : <span className="t-name">{t.title}</span>}
        </span>
        <span className="t-sub">
          <ArtistCredit value={t} onOpen={onOpenArtist} />
        </span>
      </span>
      {showAlbum && (
        <span className="t-album"
              onClick={(e) => { e.stopPropagation(); onOpen(t.albumId) }}>
          {t.albumTitle}{t.year ? ` · ${t.year}` : ''}
        </span>
      )}
      <span className="t-dur">{fmtDur(t.duration)}</span>
      {isAdmin && (
        <span className="t-heart" onClick={(e) => e.stopPropagation()}>
          <Heart on={fav} canEdit onToggle={() => onToggleFav(t.id)} size={16} />
        </span>
      )}
    </div>
  )
}

// A playback-state change must not reconcile thousands of rows. Re-render only when this row's data changes or
// it is/was the current track. Fall back to normal behavior when callback references are unstable.
export const TrackRow = React.memo(TrackRowInner, (prev, next) =>
  prev.t === next.t && prev.i === next.i && prev.fav === next.fav
  && prev.isAdmin === next.isAdmin && prev.showAlbum === next.showAlbum
  && prev.onToggleFav === next.onToggleFav && prev.onPlay === next.onPlay
  && prev.onOpen === next.onOpen && prev.onOpenArtist === next.onOpenArtist
  && (prev.currentId === next.currentId
    || (prev.currentId !== prev.t.id && next.currentId !== next.t.id))
  && (prev.playingId === next.playingId
    || (prev.playingId !== prev.t.id && next.playingId !== next.t.id)))

export default function TracksPage({ tracks, ensureTracks, q, isAdmin,
                                     favTracks, toggleFav, onOpen, onOpenArtist,
                                     onPlayTracks, currentId, playingId, playerShuffle,
                                     albums, showHidden, setShowHidden, onClearQuery }) {
  const { t } = useI18n()
  const [sort, setSort] = useState('title')
  const [shuf, setShuf] = useState(playerShuffle)
  useEffect(() => setShuf(playerShuffle), [playerShuffle])

  const SORTS = useMemo(() => ({
    title: { label: t('tracks.sortTitle'),
      fn: (a, b) => jaCollator.compare(a.title, b.title) },
    artist: { label: t('tracks.sortArtist'),
      fn: (a, b) => defaultCollator.compare(
        a.artistSort || a.artist, b.artistSort || b.artist)
        || defaultCollator.compare(a.albumTitle || '', b.albumTitle || '')
        || (a.track ?? 0) - (b.track ?? 0) },
    album: { label: t('tracks.sortAlbum'),
      fn: (a, b) => jaCollator.compare(a.albumTitle || '', b.albumTitle || '')
        || (a.disc ?? 1) - (b.disc ?? 1) || (a.track ?? 0) - (b.track ?? 0) },
    yearNew: { label: t('tracks.sortYearNew'),
      fn: (a, b) => (b.year ?? 0) - (a.year ?? 0) },
    yearOld: { label: t('tracks.sortYearOld'),
      fn: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) },
    added: { label: t('tracks.sortAdded'),
      fn: (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) },
  }), [t])

  useEffect(() => { if (tracks === null) ensureTracks() }, [tracks, ensureTracks])

  // Split search, sorting, and filtering into three memoized stages. Query changes trigger only the final cheap includes pass;
  // the zhNorm haystack (a 4,000-entry lookup per character) rebuilds only with the track list, and sorting only with its key
  // or visibility. The output remains byte-for-byte identical to the former single-memo implementation.
  const withHay = useMemo(() => tracks && tracks.map((tr) => ({
    tr,
    hay: zhNorm(`${tr.title} ${artistSearchText(tr)} ${creditsOf(tr)
      .map((credit) => romajiOf(credit.name)).join(' ')} ${tr.albumTitle}`),
  })), [tracks])

  const sorted = useMemo(() => {
    if (!withHay) return null
    const fn = SORTS[sort].fn
    return withHay
      .filter(({ tr }) => !tr.hidden || (isAdmin && showHidden))
      .sort((x, y) => fn(x.tr, y.tr))
  }, [withHay, sort, SORTS, isAdmin, showHidden])

  const shown = useMemo(() => {
    if (!sorted) return null
    const needle = zhNorm(q.trim())
    const out = needle ? sorted.filter(({ hay }) => hay.includes(needle)) : sorted
    return out.map(({ tr }) => tr)
  }, [sorted, q])

  const handleToggleFav = useCallback((id) => toggleFav('track', id), [toggleFav])
  const handlePlay = useCallback((idx) => onPlayTracks(shown, idx),
    [onPlayTracks, shown])

  const hasHidden = isAdmin && (tracks?.some((tr) => tr.hidden)
    || albums?.some((album) => album.hidden))

  const hasCurrent = useMemo(() =>
    !!currentId && !!shown?.some((tr) => tr.id === currentId), [shown, currentId])

  const locate = () => {
    locateTrackRow(currentId)
  }

  return (
    <div className="tracks-page">
      <div className="filters pin">
        <button className="play-big"
                title={shuf ? t('common.shuffleOn') : t('common.playAll')}
                disabled={!shown?.length}
                onClick={() => onPlayTracks(shown, undefined, { shuffle: shuf })}>
          <I.play size={20} />
        </button>
        <button className={`icon-round ${shuf ? 'on' : ''}`}
                title={shuf ? t('common.shuffleOn') : t('common.shuffleOff')}
                onClick={() => setShuf(!shuf)}>
          <I.shuffle size={15} />
        </button>
        {hasHidden && (
          <button className={`icon-round ${showHidden ? 'on' : ''}`}
                  title={t('library.showHidden')}
                  aria-label={t('library.showHidden')}
                  aria-pressed={showHidden}
                  onClick={() => setShowHidden((value) => !value)}>
            <I.eye size={16} />
          </button>
        )}
        {hasCurrent && (
          <button className="icon-round" title={t('common.locate')} onClick={locate}>
            <I.locate size={15} />
          </button>
        )}
        <span className="ctx-sub">
          {shown ? t('count.tracks', shown.length) : '…'}
        </span>
        <div className="filter-tail">
          <ClearFilters count={Number(!!q.trim())} onClear={onClearQuery}
                        label={t('common.clearFilters')} />
          <select className="sort-sel ghost" value={sort}
                  onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([k, v]) =>
              <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>
      <div className="tracks flat-list">
        {!shown && [...Array(10)].map((_, i) =>
          <div key={i} className="sk" style={{ height: 52, marginBottom: 6 }} />)}
        {shown && shown.length === 0 && (
          <div className="empty">
            <div className="big">{t('empty.noMatch')}</div>
            <div>{t('empty.tryOther')}</div>
          </div>
        )}
        {shown && shown.map((tr, i) => (
          <TrackRow key={tr.id} t={tr} i={i}
                    currentId={currentId} playingId={playingId}
                    isAdmin={isAdmin} fav={favTracks.has(tr.id)}
                    onToggleFav={handleToggleFav}
                    onPlay={handlePlay}
                    onOpen={onOpen} onOpenArtist={onOpenArtist} />
        ))}
      </div>
    </div>
  )
}
