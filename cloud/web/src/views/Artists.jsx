import React, { useEffect, useMemo, useState } from 'react'
import { artistArtUrl } from '../api.js'
import { ClearFilters, FilterSel, I, VisibilityToggle } from '../ui.jsx'
import { useI18n } from '../i18n.jsx'
import { zhNorm } from '../zh.js'
import { romajiOf } from '../aliases.js'
import { jaCollator } from '../format.js'
import { creditsOf } from '../artist-credit.jsx'
import { compareArtistActivity } from '../artist-ranking.js'

export default function ArtistsPage({ albums, artists, q, avatarVer,
                                      onOpenArtist, isAdmin,
                                      showHidden, setShowHidden, onClearQuery }) {
  const { t } = useI18n()
  const [sort, setSort] = useState('count')
  const [genre, setGenre] = useState('')

  const SORTS = useMemo(() => ({
    count: { label: t('artists.sortCount'),
      fn: compareArtistActivity },
    name: { label: t('artists.sortName'),
      fn: (a, b) => jaCollator.compare(a.sort, b.sort) },
    added: { label: t('artists.sortAdded'),
      fn: (a, b) => b.latest - a.latest
        || jaCollator.compare(a.sort, b.sort) },
  }), [t])

  const noteBy = useMemo(() =>
    new Map((artists || []).map((a) => [a.name, a.note])), [artists])
  const sortBy = useMemo(() =>
    new Map((artists || []).map((a) => [a.name, a.sort || a.name])), [artists])
  // Add 'c' for a custom avatar so the browser cannot reuse a cached no-avatar 302 cover as the avatar.
  const avatarFlagBy = useMemo(() =>
    new Map((artists || []).map((a) => [a.name, !!a.hasAvatar])), [artists])

  const data = useMemo(() => {
    const m = new Map()
    for (const a of albums || []) {
      if (a.hidden && !(isAdmin && showHidden)) continue
      for (const credit of creditsOf(a)) {
        const e = m.get(credit.name) || {
          name: credit.name, sort: sortBy.get(credit.name) || credit.sort || credit.name,
          count: 0, trackCount: 0, hiddenCount: 0,
          genres: new Set(), latest: 0, years: [],
        }
        e.count++
        if (a.hidden) e.hiddenCount++
        ;(a.genres || []).forEach((g) => e.genres.add(g))
        e.latest = Math.max(e.latest, a.updatedAt || 0)
        if (a.year) e.years.push(a.year)
        m.set(credit.name, e)
      }
    }
    for (const artist of artists || []) {
      const trackCount = isAdmin && showHidden
        ? artist.featuredTrackCount : artist.visibleFeaturedTrackCount
      const e = m.get(artist.name) || {
        name: artist.name, sort: artist.sort || artist.name,
        count: 0, trackCount: 0, hiddenCount: 0,
        genres: new Set(), latest: 0, years: [],
      }
      e.trackCount = trackCount || 0
      if (e.count || e.trackCount) m.set(artist.name, e)
    }
    return [...m.values()]
  }, [albums, artists, isAdmin, showHidden, sortBy])

  const hiddenAlbumCount = useMemo(() =>
    (albums || []).filter((album) => album.hidden).length, [albums])

  const genres = useMemo(() => {
    const m = new Map()
    data.forEach((e) => e.genres.forEach((g) => {
      const k = g.toLowerCase()
      let x = m.get(k)
      if (!x) { x = { n: 0, forms: new Map() }; m.set(k, x) }
      x.n++
      x.forms.set(g, (x.forms.get(g) || 0) + 1)
    }))
    return [...m.values()].sort((a, b) => b.n - a.n).map((x) =>
      [...x.forms.entries()].sort((p, q2) => q2[1] - p[1])[0][0])
  }, [data])

  useEffect(() => {
    if (genre && !genres.some((g) =>
      g.toLowerCase() === genre.toLowerCase())) setGenre('')
  }, [genre, genres])

  // Rebuild the search haystack only with the artist collection; query keystrokes perform a cheap includes check.
  const searchHay = useMemo(() => {
    const m = new Map()
    for (const e of data) {
      m.set(e.name, zhNorm(`${e.name} ${e.sort} ${romajiOf(e.name)}`))
    }
    return m
  }, [data])

  const shown = useMemo(() => {
    const needle = zhNorm(q.trim())
    const wantGenre = genre.toLowerCase()
    return data.filter((e) => {
      if (needle && !searchHay.get(e.name).includes(needle)) return false
      if (wantGenre && ![...e.genres]
        .some((g) => g.toLowerCase() === wantGenre)) return false
      return true
    }).sort(SORTS[sort].fn)
  }, [data, searchHay, q, genre, sort, SORTS])

  const yearsOf = (e) => {
    if (!e.years.length) return ''
    const lo = Math.min(...e.years), hi = Math.max(...e.years)
    return lo === hi ? `${lo}` : `${lo}–${hi}`
  }

  const activeFilterCount = Number(!!q.trim()) + Number(!!genre)
  const clearFilters = () => {
    onClearQuery?.()
    setGenre('')
  }

  return (
    <>
      <div className="filters">
        <FilterSel on={!!genre} value={genre}
                   onChange={(e) => setGenre(e.target.value)}>
          <option value="">{t('artists.filterGenre')}</option>
          {genres.map((g) => <option key={g} value={g}>{g}</option>)}
        </FilterSel>
        {isAdmin && hiddenAlbumCount > 0 && (
          <VisibilityToggle on={showHidden}
                            onToggle={() => setShowHidden((value) => !value)}
                            label={t('library.showHidden')}
                            count={hiddenAlbumCount} />
        )}
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

      <div className="agrid">
        {!albums && [...Array(8)].map((_, i) => (
          <div key={i} className="acard">
            <div className="sk" style={{ width: 128, height: 128, borderRadius: '50%' }} />
            <div className="sk" style={{ height: 14, marginTop: 12, width: 90 }} />
          </div>
        ))}
        {albums && shown.length === 0 && (
          <div className="empty">
            <div className="big">{t('artists.empty')}</div>
          </div>
        )}
        {albums && shown.map((e) => {
          const year = yearsOf(e)
          const featured = e.trackCount
            ? t('artists.featuredTracks', e.trackCount) : ''
          const primary = e.count
            ? [t('artists.albums', e.count), year].filter(Boolean).join(' · ')
            : featured
          const secondary = e.count ? featured : ''
          return (
            <div key={e.name}
                 className={`acard ${e.count > 0 && !e.trackCount
                   && e.hiddenCount === e.count ? 'is-hidden' : ''}`}
                 onClick={() => onOpenArtist(e.name)}>
              <div className="acard-avatar">
                <img loading="lazy" decoding="async"
                     src={artistArtUrl(e.name,
                       avatarFlagBy.get(e.name)
                         ? `c${avatarVer || ''}`
                         : avatarVer)}
                     alt="" />
              </div>
              {e.hiddenCount > 0 && (
                <span className="acard-hidden-mark" title={t('library.showHidden')}>
                  <I.eye size={11} /><b>{e.hiddenCount}</b>
                </span>
              )}
              <div className="acard-name" title={e.name}>{e.name}</div>
              <div className="acard-meta">
                <div className="acard-sub" title={primary}>
                  <span>{primary}</span>
                  {noteBy.get(e.name)
                    ? <I.list size={10} aria-hidden="true" />
                    : null}
                </div>
                {secondary && (
                  <div className="acard-featured" title={secondary}>{secondary}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
