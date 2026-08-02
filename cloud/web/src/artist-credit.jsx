import React, { useId } from 'react'
import { I } from './ui.jsx'
import { creditsOf } from './artist-credit.js'

export * from './artist-credit.js'

export function ArtistCredit({ value, artists, artist, artistSort, onOpen,
                               className = '', linkClassName = '', stopPropagation = true }) {
  const credits = creditsOf(value || { artists, artist, artistSort })
  const separator = credits.length === 2 ? ' × ' : ', '
  const title = credits.map((credit) => credit.name).join(separator)
  return (
    <span className={`artist-credit ${className}`.trim()} title={title}>
      {credits.map((credit, index) => (
        <React.Fragment key={credit.name}>
          {index > 0 && <span className="artist-credit-sep" aria-hidden="true">
            {separator}</span>}
          {onOpen ? (
            <button type="button" className={`artist-credit-link ${linkClassName}`.trim()}
                    onClick={(event) => {
                      if (stopPropagation) event.stopPropagation()
                      onOpen(credit.name)
                    }}>
              {credit.name}
            </button>
          ) : <span>{credit.name}</span>}
        </React.Fragment>
      ))}
    </span>
  )
}

export function ArtistEditor({ value, onChange, disabled = false,
                               suggestions = [], t }) {
  const listId = useId().replaceAll(':', '')
  const rows = value?.length ? value : [{ name: '', sort: '' }]
  const options = new Map((suggestions || []).map((item) => [item.name, item]))
  const update = (index, patch) => onChange(rows.map((row, rowIndex) =>
    rowIndex === index ? { ...row, ...patch } : row))
  const move = (index, offset) => {
    const target = index + offset
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div className="artist-editor">
      <div className="artist-editor-head" aria-hidden="true">
        <span>{t('albumPage.artistName')}</span>
        <span>{t('albumPage.artistSort')}</span>
        <span />
      </div>
      {rows.map((row, index) => (
        <div className="artist-editor-row" key={index}>
          <span className="artist-editor-order">{index + 1}</span>
          <input className="tin" value={row.name} disabled={disabled}
                 list={`${listId}-names`}
                 placeholder={t('albumPage.artistNamePh')}
                 onChange={(event) => {
                   const name = event.target.value
                   const match = options.get(name)
                   update(index, { name,
                     sort: match ? (match.sort || '')
                       : (!row.sort || row.sort === row.name ? '' : row.sort) })
                 }} />
          <input className="tin" value={row.sort || ''} disabled={disabled}
                 placeholder={t('albumPage.artistSortPh')}
                 onChange={(event) => update(index, { sort: event.target.value })} />
          <div className="artist-editor-actions">
            <button type="button" className="icon-btn" disabled={disabled || index === 0}
                    title={t('albumPage.moveArtistUp')}
                    aria-label={t('albumPage.moveArtistUp')}
                    onClick={() => move(index, -1)}><I.chevUp size={15} /></button>
            <button type="button" className="icon-btn"
                    disabled={disabled || index === rows.length - 1}
                    title={t('albumPage.moveArtistDown')}
                    aria-label={t('albumPage.moveArtistDown')}
                    onClick={() => move(index, 1)}><I.chevDown size={15} /></button>
            <button type="button" className="icon-btn artist-editor-remove"
                    disabled={disabled || rows.length === 1}
                    title={t('albumPage.removeArtist')}
                    aria-label={t('albumPage.removeArtist')}
                    onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>
              <I.x size={14} />
            </button>
          </div>
        </div>
      ))}
      <datalist id={`${listId}-names`}>
        {(suggestions || []).map((item) => <option key={item.name} value={item.name} />)}
      </datalist>
      <button type="button" className="artist-editor-add" disabled={disabled}
              onClick={() => onChange([...rows, { name: '', sort: '' }])}>
        <I.plus size={14} /> {t('albumPage.addArtist')}
      </button>
    </div>
  )
}
