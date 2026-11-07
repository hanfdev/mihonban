import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { Dialog, I, navigate, useToast } from '../ui.jsx'
import { CAPTURE_KEY, validateIncoming } from '../rym-capture.js'
import { parseRymHtml } from '../rym.js'

const safeUrl = value => {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'rateyourmusic.com' && u.pathname.startsWith('/release/') && !u.username && !u.password && !u.port ? u.href : null } catch { return null }
}
const score = value => value == null ? '—' : Number(value).toFixed(2)
const scoreTime = row => row.fields?.rating?.observedAt && row.fields?.votes?.observedAt
  ? Math.min(row.fields.rating.observedAt, row.fields.votes.observedAt) : null
const readPending = () => { try { return validateIncoming(JSON.parse(sessionStorage.getItem(CAPTURE_KEY))) } catch { return null } }

export default function RymUpdates({ onChanged, onOpen, initialId = '' }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(initialId)
  const [pending, setPending] = useState(readPending)
  const [targets, setTargets] = useState([])
  const [targetQuery, setTargetQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [tools, setTools] = useState(false)
  const [url, setUrl] = useState('')
  const [choices, setChoices] = useState({})
  const inFlight = useRef(false)
  const fileSeq = useRef(0)
  const date = ts => ts ? new Date(ts).toLocaleString(lang) : t('rymUpdate.unknown')
  const reload = async () => {
    try { const next = await api.rymUpdates(); setRows(next); setError(''); return next }
    catch (e) { setError(e.message); return null }
  }
  useEffect(() => { reload(); return () => { fileSeq.current++ } }, [])
  useEffect(() => {
    const refreshed = () => { reload(); onChanged() }
    window.addEventListener('mihonban-rym-updated', refreshed)
    return () => window.removeEventListener('mihonban-rym-updated', refreshed)
  }, [onChanged])
  useEffect(() => {
    if (!rows || !pending) return
    setTargets(rows.filter(r => r.rymUrl === pending.rymUrl).map(r => r.id))
  }, [!!rows, pending])
  const detail = rows?.find(r => r.id === selected)
  useEffect(() => { setUrl(detail?.rymUrl || ''); setChoices({}) }, [selected, detail?.version])
  const problem = e => toast(t(e.code === 'conflict' ? 'rymUpdate.conflict' : e.code === 'sourceConflict' ? 'rymUpdate.sourceConflict' : 'rymUpdate.problem'), 'err')
  const action = async (row, payload) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true)
    try {
      const next = await api.updateRym(row.id, { ...payload, version: row.version })
      setRows(previous => previous.map(r => r.id === next.id ? next : r))
      onChanged(); toast(t('albumPage.saved'), 'ok')
    } catch (e) { problem(e); await reload() }
    finally { inFlight.current = false; setBusy(false) }
  }
  const clearPending = () => { sessionStorage.removeItem(CAPTURE_KEY); setPending(null); setTargets([]) }
  const apply = async () => {
    if (inFlight.current || !targets.length) return
    inFlight.current = true; setBusy(true)
    const completed = []; const failed = []; let stale = 0
    try {
      for (const id of targets) {
        const row = rows.find(r => r.id === id)
        try {
          const result = await api.updateRym(id, { action: 'capture', version: row.version, snapshot: pending, confirmSource: true })
          if (result.stale) stale++
          completed.push(id)
        } catch (e) { failed.push(id); problem(e) }
      }
      await reload(); onChanged()
      toast(t('rymUpdate.result', completed.length, failed.length, stale), failed.length ? 'err' : 'ok')
      if (!failed.length) clearPending()
      else setTargets(failed)
    } finally { inFlight.current = false; setBusy(false) }
  }
  const loadFile = async file => {
    if (!file) return
    const seq = ++fileSeq.current
    try {
      if (file.size > 15_000_000) throw new Error('size')
      const snapshot = parseRymHtml(await file.text())
      if (seq !== fileSeq.current) return
      sessionStorage.setItem(CAPTURE_KEY, JSON.stringify(snapshot)); setPending(snapshot); setSelected('')
    } catch { toast(t('rymUpdate.invalidPage'), 'err') }
  }
  const isOld = row => !scoreTime(row) || Date.now() - scoreTime(row) > 30 * 86400_000
  const shown = (rows || []).filter(row => `${row.artist} ${row.title}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    && (filter === 'all' || (filter === 'unlinked' && !row.rymUrl) || (filter === 'old' && isOld(row))
      || (filter === 'suggestions' && row.suggestions.length) || (filter === 'error' && row.status === 'error')))
  const candidates = (rows || []).filter(r => !r.rymUrl || r.rymUrl === pending?.rymUrl)
    .filter(r => `${r.artist} ${r.title}`.toLocaleLowerCase().includes(targetQuery.toLocaleLowerCase()))
    .sort((a, b) => Number(b.rymUrl === pending?.rymUrl) - Number(a.rymUrl === pending?.rymUrl))
  const sourceLink = value => safeUrl(value) && <a className="btn sm" href={safeUrl(value)} target="_blank" rel="noreferrer">{t('rymUpdate.open')} <I.ext size={12} /></a>
  return <div className="rym-updates">
    <header className="rym-heading"><div><button className="btn sm" onClick={() => navigate('/admin')}><I.back size={13} />{t('nav.admin')}</button><h1>{t('rymUpdate.title')}</h1><p>{t('rymUpdate.protected')}</p></div>
      <button className="btn primary" onClick={() => setTools(true)}><I.html size={15} />{t('rymUpdate.batch')}</button></header>
    {pending && <section className="panel rym-inbox">
      <div className="rym-section-heading"><h2>{t('rymUpdate.incoming')}</h2><button className="btn sm" disabled={busy} onClick={clearPending}>{t('common.cancel')}</button></div>
      <strong>{pending.title} · {pending.artist}</strong>
      <div className="rym-incoming-score">{score(pending.rating)} <span>{t('rym.votes', pending.votes ?? '—')}</span></div>
      <p className="hint">{pending.source === 'browser' ? `${t('rymUpdate.observed')} · ${date(pending.observedAt)}` : t('rymUpdate.fileTime')}</p>
      {sourceLink(pending.rymUrl)}
      <p>{t('rymUpdate.choose')}</p>
      <input className="tin" aria-label={t('rymUpdate.choose')} placeholder={t('rymUpdate.search')} value={targetQuery} onChange={e => setTargetQuery(e.target.value)} />
      <div className="rym-targets">{candidates.map(row => <label key={row.id}><input type="checkbox" disabled={busy} checked={targets.includes(row.id)} onChange={e => setTargets(ids => e.target.checked ? [...ids, row.id] : ids.filter(id => id !== row.id))} /><span><b>{row.title}</b><small>{row.artist} · {score(row.rating)} → {score(pending.rating ?? row.rating)} · {row.votes ?? '—'} → {pending.votes ?? row.votes ?? '—'}</small></span></label>)}</div>
      {!candidates.length && <p className="hint">{t('rymUpdate.noTarget')}</p>}
      <p className="hint">{t('rymUpdate.confirmMatch')}</p>
      <button className="btn primary" disabled={busy || !targets.length} onClick={apply}>{busy ? <I.spin size={14} /> : t('rymUpdate.apply')}</button>
    </section>}
    <div className="rym-toolbar"><input className="tin" aria-label={t('rymUpdate.search')} placeholder={t('rymUpdate.search')} value={query} onChange={e => setQuery(e.target.value)} />
      <select className="tin" aria-label={t('rymUpdate.filter')} value={filter} onChange={e => setFilter(e.target.value)}>{['all', 'unlinked', 'old', 'suggestions', 'error'].map(k => <option key={k} value={k}>{t(`rymUpdate.${k}`)}</option>)}</select>
      <label className="btn sm">{t('rymUpdate.file')}<input type="file" hidden accept=".html,.htm" onChange={e => { loadFile(e.target.files[0]); e.target.value = '' }} /></label>
      <button className="btn sm" onClick={reload}>{t('common.retry')}</button></div>
    {error && <p role="alert">{t('rymUpdate.problem')}</p>}
    {!rows && !error && <p>{t('common.loading')}</p>}
    <div className="rym-list">{shown.map(row => <article key={row.id} className="rym-record">
      <button className="rym-record-name" onClick={() => setSelected(row.id)}><b>{row.title}</b><span>{row.artist} {row.year ? `· ${row.year}` : ''}</span></button>
      <div className="rym-record-score"><b>{score(row.rating)}</b><span>{t('rym.votes', row.votes ?? '—')}</span></div>
      <div className="rym-record-time"><span>{date(scoreTime(row))}</span><small>{row.status === 'error' ? t('rymUpdate.error') : row.status === 'partial' ? t('rymUpdate.partial') : !row.confirmed ? t('rymUpdate.unconfirmed') : row.suggestions.length ? t('rymUpdate.suggestionCount', row.suggestions.length) : t('rymUpdate.confirmed')}</small></div>
      <div className="rym-record-actions">{sourceLink(row.rymUrl)}<button className="btn sm" onClick={() => setSelected(row.id)}>{t('rymUpdate.details')}</button></div>
    </article>)}</div>
    {rows && !shown.length && <p className="empty">{t('empty.noMatch')}</p>}
    {detail && <Dialog className="rym-dialog" title={detail.title} onClose={() => { if (!busy) setSelected('') }}>
      <p className="hint">{detail.artist} · {t('rymUpdate.protected')}</p>
      <div className="rym-section-heading"><b>{score(detail.rating)} · {t('rym.votes', detail.votes ?? '—')}</b><button className="btn sm" onClick={() => onOpen(detail.id)}>{t('rymUpdate.album')}</button></div>
      <p className="hint">{t('rymUpdate.observed')}: {date(detail.observedAt)}<br />{t('rymUpdate.received')}: {date(detail.receivedAt)}</p>
      <dl className="rym-field-times">{['rating', 'votes', 'rank'].map(field => <div key={field}><dt>{t(`rymUpdate.${field}`)}</dt><dd>{field === 'rating' ? score(detail[field]) : detail[field] ?? '—'}<small>{date(detail.fields?.[field]?.observedAt)}</small></dd></div>)}</dl>
      <p className="hint">{t('rymUpdate.fieldTimeHint')}</p>
      <label className="rym-source-label">{t('rymUpdate.source')}<input className="tin" type="url" value={url} onChange={e => setUrl(e.target.value)} /></label>
      <p className="hint">{t('rymUpdate.bindHint')}</p>
      <div className="rym-inline-actions"><button className="btn sm" disabled={busy || !safeUrl(url)} onClick={() => action(detail, { action: 'bind', rymUrl: url })}>{t('rymUpdate.bind')}</button>{sourceLink(detail.rymUrl)}<button className="btn sm" disabled={busy} onClick={() => action(detail, { action: 'failure' })}>{t('rymUpdate.failed')}</button></div>
      <h4>{t('rymUpdate.mine')}</h4><div className="genre-row">{detail.genres.map(v => <span className="gtag" key={v}>{v}</span>)}{detail.secondaryGenres.map(v => <span className="gtag sec" key={v}>{v}</span>)}</div><p className="descriptors">{detail.descriptors.join(' · ')}</p>
      <h4>{t('rymUpdate.suggestions')}</h4><p className="hint">{t('rymUpdate.suggestionHint')}</p>
      {detail.suggestions.map((item, i) => <label className="rym-suggestion" key={`${item.field}:${item.value}`}><span>{item.value}<small>{t(item.field === 'descriptors' ? 'albumPage.descriptors' : item.field === 'genres' ? 'albumPage.primaryGenres' : 'albumPage.secondaryGenres')}</small></span>
        <select className="tin" value={choices[i] || ''} onChange={e => setChoices(v => ({ ...v, [i]: e.target.value }))}><option value="">{t('rymUpdate.later')}</option>{item.field === 'descriptors' ? <option value="descriptors">{t('rymUpdate.accept')}</option> : <><option value="genres">{t('albumPage.primaryGenres')}</option><option value="secondaryGenres">{t('albumPage.secondaryGenres')}</option></>}<option value="ignore">{t('rymUpdate.ignore')}</option></select></label>)}
      {!detail.suggestions.length && <p className="hint">{t('rymUpdate.noSuggestions')}</p>}
      <div className="actions"><button className="btn" disabled={busy} onClick={() => setSelected('')}>{t('common.close')}</button><button className="btn primary" disabled={busy || !Object.values(choices).some(Boolean)} onClick={() => action(detail, { action: 'suggestions', items: detail.suggestions.flatMap((s, i) => choices[i] ? [{ ...s, target: choices[i] }] : []) })}>{t('common.save')}</button></div>
    </Dialog>}
    {tools && <Dialog className="rym-dialog" title={t('rymUpdate.batch')} onClose={() => setTools(false)}><p>{t('rymUpdate.batchHelp')}</p><p>{t('rymUpdate.install')}</p><p className="hint">{t('rymUpdate.toolPrivacy')}</p><p className="hint">{t('rymUpdate.freshHint')}</p><a className="btn primary" href="/rym-browser-tool.zip" download>{t('rymUpdate.download')}</a><div className="actions"><button className="btn" onClick={() => setTools(false)}>{t('common.close')}</button></div></Dialog>}
  </div>
}
