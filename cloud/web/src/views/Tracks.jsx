import React, { useEffect, useMemo, useState } from 'react'
import { artUrl } from '../api.js'
import { ClearFilters, I, Heart, Marquee, fmtDur } from '../ui.jsx'
import { useI18n } from '../i18n.jsx'
import { zhNorm } from '../zh.js'
import { romajiOf } from '../aliases.js'

export function TrackRow({ t, i, currentId, playingId, isAdmin, fav,
                           onToggleFav, onPlay, onOpen, onOpenArtist, showAlbum = true }) {
  return (
    <div className={`trow flat ${t.hidden ? 'is-hidden' : ''} ${currentId === t.id ? 'playing' : ''}`}
         data-tid={t.id} onClick={() => onPlay(i)}>
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
          <a onClick={(e) => { e.stopPropagation(); onOpenArtist(t.artist) }}>
            {t.artist}</a>
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
      fn: (a, b) => a.title.localeCompare(b.title, 'ja') },
    artist: { label: t('tracks.sortArtist'),
      fn: (a, b) => (a.artistSort || a.artist).localeCompare(b.artistSort || b.artist)
        || (a.albumTitle || '').localeCompare(b.albumTitle || '')
        || (a.track ?? 0) - (b.track ?? 0) },
    album: { label: t('tracks.sortAlbum'),
      fn: (a, b) => (a.albumTitle || '').localeCompare(b.albumTitle || '', 'ja')
        || (a.disc ?? 1) - (b.disc ?? 1) || (a.track ?? 0) - (b.track ?? 0) },
    yearNew: { label: t('tracks.sortYearNew'),
      fn: (a, b) => (b.year ?? 0) - (a.year ?? 0) },
    yearOld: { label: t('tracks.sortYearOld'),
      fn: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) },
    added: { label: t('tracks.sortAdded'),
      fn: (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) },
  }), [t])

  useEffect(() => { if (tracks === null) ensureTracks() }, [tracks, ensureTracks])

  const shown = useMemo(() => {
    if (!tracks) return null
    const needle = zhNorm(q.trim())
    const visible = tracks.filter((tr) =>
      !tr.hidden || (isAdmin && showHidden))
    const out = needle
      ? visible.filter((tr) =>
          zhNorm(`${tr.title} ${tr.artist} ${tr.artistSort || ''} ` +
            `${romajiOf(tr.artist)} ${tr.albumTitle}`)
            .includes(needle))
      : visible
    return out.sort(SORTS[sort].fn)
  }, [tracks, q, sort, SORTS, isAdmin, showHidden])

  const hasHidden = isAdmin && (tracks?.some((tr) => tr.hidden)
    || albums?.some((album) => album.hidden))

  const hasCurrent = useMemo(() =>
    !!currentId && !!shown?.some((tr) => tr.id === currentId), [shown, currentId])

  const locate = () => {
    const el = document.querySelector(`.trow[data-tid="${currentId}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.remove('flash'); void el.offsetWidth
    el.classList.add('flash')
    setTimeout(() => el.classList.remove('flash'), 1700)
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
                    onToggleFav={(id) => toggleFav('track', id)}
                    onPlay={(idx) => onPlayTracks(shown, idx)}
                    onOpen={onOpen} onOpenArtist={onOpenArtist} />
        ))}
      </div>
    </div>
  )
}
