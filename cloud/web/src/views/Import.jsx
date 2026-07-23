import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, artUrl, uploadFileToOneDrive } from '../api.js'
import { readTags } from '../tags.js'
import { toJa } from '../aliases.js'
import { I, useToast } from '../ui.jsx'
import { useI18n } from '../i18n.jsx'

const clean = (s) => (s || '').replace(/[<>:"/\\|?*]/g, '').replace(/[. ]+$/, '').trim()

const mostCommon = (arr) => {
  const m = new Map()
  arr.filter(Boolean).forEach((v) => m.set(v, (m.get(v) || 0) + 1))
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
}

const coverExt = (blob) => ({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif',
})[String(blob?.type || '').toLowerCase()] || (!blob?.type ? 'jpg' : '')

export default function ImportPage({ albums, onDone, onOpen }) {
  const { t } = useI18n()
  const [items, setItems] = useState([])       // readTags 结果
  const [form, setForm] = useState({ artist: '', title: '', year: '' })
  const [cover, setCover] = useState(null)     // {blob, url}
  const [progress, setProgress] = useState({}) // filename -> {pct, status}
  const [phase, setPhase] = useState('pick')   // pick | edit | uploading | done
  const doneId = useRef(null)
  const uploadInFlight = useRef(false)
  const toast = useToast()

  useEffect(() => () => {
    if (cover?.url) URL.revokeObjectURL(cover.url)
  }, [cover?.url])

  const recent = useMemo(() =>
    (albums || []).slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6),
    [albums])

  const addFiles = async (fileList) => {
    const files = [...fileList].filter((f) =>
      /\.(mp3|flac|m4a|ogg|opus|wav)$/i.test(f.name))
    if (!files.length) { toast(t('importPage.noAudio'), 'err'); return }
    const parsed = []
    let failed = 0
    for (const f of files) {
      try { parsed.push(await readTags(f)) }
      catch { failed++ }
    }
    if (failed) toast(t('importPage.fail', `${failed} file(s) could not be read`), 'err')
    if (!parsed.length) return
    // 已在编辑阶段 = 追加（同名文件跳过），否则全新开始
    const appending = phase === 'edit' && items.length > 0
    const seen = new Set(items.map((i) => i.filename))
    const merged = appending
      ? [...items, ...parsed.filter((p) => !seen.has(p.filename))]
      : parsed
    merged.sort((a, b) => (a.disc - b.disc) || ((a.track ?? 99) - (b.track ?? 99)))
    setItems(merged)
    // 罗马字艺名自动换成原名（别名库命中才换；表单仍可手改）
    const rawArtist = mostCommon(merged.map((p) => p.albumArtist))
      || mostCommon(merged.map((p) => p.artist))
    setForm((f) => ({
      artist: (appending && f.artist) || toJa(rawArtist) || rawArtist,
      title: (appending && f.title) || mostCommon(merged.map((p) => p.album)),
      year: (appending && f.year) || mostCommon(merged.map((p) => p.year)) || '',
    }))
    if (!appending || !cover) {
      const pic = merged.find((p) => p.picture)?.picture
      setCover(pic ? { blob: pic.blob, url: URL.createObjectURL(pic.blob) } : null)
    }
    setPhase('edit')
  }

  const removeItem = (it) => {
    const rest = items.filter((x) => x !== it)
    if (!rest.length) { reset(); return }
    setItems(rest)
  }

  const start = async () => {
    if (uploadInFlight.current || phase !== 'edit') return
    if (!form.artist.trim() || !form.title.trim()) {
      toast(t('importPage.needMeta'), 'err'); return
    }
    const artistDir = clean(form.artist)
    const albumDir = clean(form.title)
    const yearText = String(form.year || '').trim()
    if (!artistDir || !albumDir) {
      toast(t('importPage.needMeta'), 'err'); return
    }
    if (yearText && (!/^\d{4}$/.test(yearText)
        || Number(yearText) < 1 || Number(yearText) > 9999)) {
      toast(t('importPage.fail', t('importPage.invalidYear')), 'err'); return
    }
    const dirName = yearText ? `[${yearText}] ${albumDir}` : albumDir
    const folder = `Music/Library/${artistDir}/${dirName}`.normalize('NFC')
    if (folder.length > 400 || [artistDir, dirName].some((part) => part.length > 255)) {
      toast(t('importPage.fail', t('importPage.pathTooLong')), 'err'); return
    }
    const seenPaths = new Set()
    const planned = []
    for (const it of items) {
      const filename = clean(it.filename)
      if (!filename || filename.length > 255 || !it.file || it.size <= 0) {
        toast(t('importPage.fail', t('importPage.invalidFile', it.filename)), 'err'); return
      }
      const path = `${folder}/${filename}`.normalize('NFC')
      const key = path.toLocaleLowerCase()
      if (seenPaths.has(key)) {
        toast(t('importPage.fail', t('importPage.duplicatePath', filename)), 'err'); return
      }
      seenPaths.add(key)
      planned.push({ it, path })
    }
    const ext = cover ? coverExt(cover.blob) : ''
    if (cover && (!ext || cover.blob.size > 4 * 1024 * 1024)) {
      toast(t('importPage.fail', t('importPage.coverInvalid')), 'err')
      return
    }
    uploadInFlight.current = true
    setPhase('uploading')
    const tracks = []
    try {
      for (const { it, path } of planned) {
        setProgress((p) => ({ ...p, [it.filename]: { pct: 0, status: t('importPage.uploading') } }))
        await uploadFileToOneDrive(path, it.file, (done) =>
          setProgress((p) => ({ ...p,
            [it.filename]: { pct: Math.round(done / it.size * 100), status: t('importPage.uploading') } })))
        setProgress((p) => ({ ...p, [it.filename]: { pct: 100, status: t('importPage.done') } }))
        tracks.push({
          path, title: it.title, track: it.track, disc: it.disc,
          duration: it.duration, format: it.format,
          bitrate: it.bitrate || null, size: it.size,
        })
      }
      let coverPath = ''
      if (cover) {
        coverPath = `${folder}/cover.${ext}`
        await api.uploadCover(coverPath, cover.blob)
      }
      const r = await api.registerAlbum({
        folder, coverPath,
        artist: form.artist.trim(), title: form.title.trim(),
        year: yearText ? Number(yearText) : null,
        tracks,
      })
      doneId.current = r.id
      setPhase('done')
      toast(t('importPage.ok'), 'ok')
      onDone()
    } catch (e) {
      toast(t('importPage.fail', e.message), 'err')
      setPhase('edit')
    } finally {
      uploadInFlight.current = false
    }
  }

  const reset = () => {
    uploadInFlight.current = false
    setItems([]); setCover(null); setPhase('pick'); setProgress({})
  }

  return (
    <div className="import-wrap">
      <div className="panel">
        <h2>{t('importPage.title')}</h2>
        <div className="hint">
          {t('importPage.hint')}
        </div>

        {phase === 'pick' && (
          <label className="dropzone" style={{ display: 'block' }}
                 onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over') }}
                 onDragLeave={(e) => e.currentTarget.classList.remove('over')}
                 onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}>
            <I.upload size={30} />
            <div>{t('importPage.drop')}</div>
            <input type="file" multiple hidden
                   accept=".mp3,.flac,.m4a,.ogg,.opus,.wav"
                   onChange={(e) => addFiles(e.target.files)} />
          </label>
        )}

        {phase !== 'pick' && (
          <>
            <div className="meta-form">
              <label className="cover-pick" title={t('importPage.coverTitle')}>
                {cover ? <img src={cover.url} alt="" /> : (
                  <span style={{ whiteSpace: 'pre-line' }}>{t('importPage.cover')}</span>
                )}
                <input type="file" accept="image/*" hidden
                       onChange={(e) => {
                         const f = e.target.files[0]
                         if (f) setCover({ blob: f, url: URL.createObjectURL(f) })
                       }} />
              </label>
              <div className="fields">
                <div className="frow"><label>{t('common.artist')}</label>
                  <input className="tin" value={form.artist} disabled={phase !== 'edit'}
                         onChange={(e) => setForm({ ...form, artist: e.target.value })} /></div>
                <div className="frow"><label>{t('common.album')}</label>
                  <input className="tin" value={form.title} disabled={phase !== 'edit'}
                         onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
                <div className="frow"><label>{t('common.year')}</label>
                  <input className="tin" value={form.year} disabled={phase !== 'edit'}
                         onChange={(e) => setForm({ ...form, year: e.target.value })} /></div>
              </div>
            </div>

            <div className="upl-list">
              {items.map((it) => (
                <div key={it.filename} className="upl-row">
                  <span style={{ color: 'var(--ink-faint)', textAlign: 'right' }}>
                    {it.track ?? '–'}</span>
                  <input value={it.title} disabled={phase !== 'edit'}
                         onChange={(e) => setItems(items.map((x) =>
                           x === it ? { ...x, title: e.target.value } : x))} />
                  <div className="upl-prog">
                    <i style={{ width: `${progress[it.filename]?.pct || 0}%` }} />
                  </div>
                  <span className={`upl-status ${
                    progress[it.filename]?.status === t('importPage.done') ? 'ok' : ''}`}>
                    {progress[it.filename]?.status ||
                      `${(it.size / 1048576).toFixed(1)} MB`}
                  </span>
                  {phase === 'edit'
                    ? <button className="upl-x" title={t('importPage.removeTrack')}
                              onClick={() => removeItem(it)}><I.x size={13} /></button>
                    : <span />}
                </div>
              ))}
            </div>

            {phase === 'edit' && (
              <label className="dropzone td-add"
                     onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over') }}
                     onDragLeave={(e) => e.currentTarget.classList.remove('over')}
                     onDrop={(e) => {
                       e.preventDefault()
                       e.currentTarget.classList.remove('over')
                       addFiles(e.dataTransfer.files)
                     }}>
                <I.plus size={15} /> {t('importPage.more')}
                <input type="file" multiple hidden
                       accept=".mp3,.flac,.m4a,.ogg,.opus,.wav"
                       onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
              </label>
            )}

            <div className="actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              {phase === 'edit' && <>
                <button className="btn" onClick={reset}>{t('importPage.reset')}</button>
                <button className="btn primary" onClick={start}>
                  <I.upload size={15} /> {t('importPage.start', items.length)}</button>
              </>}
              {phase === 'uploading' &&
                <button className="btn" disabled><I.spin /> {t('importPage.working')}</button>}
              {phase === 'done' && <>
                <button className="btn" onClick={reset}>{t('importPage.again')}</button>
                <button className="btn primary"
                        onClick={() => onOpen(doneId.current)}>{t('importPage.view')}</button>
              </>}
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>{t('importPage.rarTitle')}</h2>
        <div className="hint">
          {t('importPage.rarHint')}
        </div>
        {recent.length > 0 && <>
          <div style={{ fontSize: 13, color: 'var(--ink-dim)', margin: '6px 0 10px' }}>{t('importPage.recent')}</div>
          <div className="recent-list">
            {recent.map((a) => (
              <div key={a.id} className="recent-item" onClick={() => onOpen(a.id)}>
                <img loading="lazy" src={artUrl(a.id, 120)} alt="" />
                <div>
                  <div className="rn">{a.title}</div>
                  <div className="rs">{a.artist}{a.year ? ` · ${a.year}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </>}
      </div>
    </div>
  )
}
