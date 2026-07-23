import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, artUrl, imgUrl, uploadFileToOneDrive } from '../api.js'
import { parseRymHtml } from '../rym.js'
import { parseDiscogsHtml } from '../discogs.js'
import { readTags } from '../tags.js'
import { I, Dialog, Heart, Md, NoteText, Rating, Reader,
         fmtDur, fmtTotal, goBack, navigate, usePointerReorder, useToast } from '../ui.jsx'
import { useI18n } from '../i18n.jsx'
import { galleryImageLoadState, gallerySwipeDirection } from '../gallery-gesture.js'

const cleanName = (s) =>
  (s || '').replace(/[<>:"/\\|?*]/g, '').replace(/[. ]+$/, '').trim()

const IMAGE_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif',
}
const imageExt = (file) => IMAGE_EXT[String(file?.type || '').toLowerCase()]
  || (/\.(jpe?g|png|webp|gif|avif)$/i.exec(file?.name || '')?.[1]
    || '').toLowerCase().replace('jpeg', 'jpg')

function EditDialog({ album, onClose, onSaved }) {
  const { t } = useI18n()
  const [f, setF] = useState({
    artist: album.artist, title: album.title, year: album.year || '',
    genres: (album.genres || []).join('; '),
    secGenres: (album.secondaryGenres || []).join('; '),
    descriptors: (album.rym?.descriptors || []).join('; '),
    note: album.note || '',
  })
  const [cover, setCover] = useState(null)
  const [busy, setBusy] = useState(false)
  const saveInFlight = useRef(false)
  const toast = useToast()
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const splitList = (s) => s.split(/;|,/).map((x) => x.trim()).filter(Boolean)
  const coverUrl = useMemo(() => cover ? URL.createObjectURL(cover) : '', [cover])
  useEffect(() => () => { if (coverUrl) URL.revokeObjectURL(coverUrl) }, [coverUrl])

  const save = async () => {
    if (saveInFlight.current) return
    const artist = f.artist.trim()
    const title = f.title.trim()
    const yearText = String(f.year || '').trim()
    if (!artist || !title) {
      toast(t('albumPage.saveFail', t('importPage.needMeta')), 'err')
      return
    }
    const year = yearText ? Number(yearText) : null
    const genres = splitList(f.genres)
    const secondaryGenres = splitList(f.secGenres)
    const descriptors = splitList(f.descriptors)
    if ((yearText && (!/^\d{4}$/.test(yearText) || year < 1 || year > 9999))) {
      toast(t('albumPage.saveFail', t('importPage.invalidYear')), 'err')
      return
    }
    if (artist.length > 500 || title.length > 1000 || f.note.length > 200_000
        || genres.length > 200 || secondaryGenres.length > 200
        || descriptors.length > 500
        || [...genres, ...secondaryGenres].some((value) => value.length > 200)
        || descriptors.some((value) => value.length > 500)) {
      toast(t('albumPage.saveFail', t('importPage.pathTooLong')), 'err')
      return
    }
    const ext = cover ? imageExt(cover) : ''
    if (cover && (!ext || cover.size > 4 * 1024 * 1024)) {
      toast(t('albumPage.saveFail', t('importPage.coverInvalid')), 'err')
      return
    }
    saveInFlight.current = true
    setBusy(true)
    try {
      let coverPath
      if (cover) {
        coverPath = `${album.folder}/cover.${ext}`
        await api.uploadCover(coverPath, cover)
      }
      await api.patchAlbum(album.id, {
        artist, title,
        year,
        genres,
        secondaryGenres,
        descriptors,
        note: f.note,
        ...(coverPath ? { coverPath } : {}),
      })
      toast(t('albumPage.saved'), 'ok')
      onSaved()
    } catch (e) { toast(t('albumPage.saveFail', e.message), 'err') }
    finally { saveInFlight.current = false; setBusy(false) }
  }

  return (
    <Dialog title={t('albumPage.edit')} onClose={onClose}>
      <div className="meta-form">
        <label className="cover-pick">
          {cover
            ? <img src={coverUrl} alt="" />
            : <img src={artUrl(album.id, 400)} alt="" />}
          <input type="file" accept="image/*" hidden
                 onChange={(e) => setCover(e.target.files[0] || null)} />
        </label>
        <div className="fields">
          <div className="frow"><label>{t('albumPage.artist')}</label>
            <input className="tin" value={f.artist} onChange={set('artist')} /></div>
          <div className="frow"><label>{t('albumPage.title')}</label>
            <input className="tin" value={f.title} onChange={set('title')} /></div>
          <div className="frow"><label>{t('albumPage.year')}</label>
            <input className="tin" value={f.year} onChange={set('year')} /></div>
          <div className="frow"><label>{t('albumPage.primaryGenres')}</label>
            <input className="tin" value={f.genres} onChange={set('genres')}
                   placeholder={t('albumPage.genresPh')} /></div>
          <div className="frow"><label>{t('albumPage.secondaryGenres')}</label>
            <input className="tin" value={f.secGenres} onChange={set('secGenres')}
                   placeholder={t('albumPage.secGenresPh')} /></div>
          <div className="frow"><label>{t('albumPage.descriptors')}</label>
            <input className="tin" value={f.descriptors} onChange={set('descriptors')}
                   placeholder={t('albumPage.descPh')} /></div>
          <div className="frow" style={{ alignItems: 'start' }}>
            <label style={{ paddingTop: 9 }}>{t('albumPage.note')}</label>
            <textarea className="tin" rows={6} value={f.note} onChange={set('note')}
                      placeholder={t('albumPage.notePh')} /></div>
          <div style={{ color: 'var(--ink-faint)', fontSize: 12 }}>
            {t('albumPage.coverHint')}
          </div>
        </div>
      </div>
      <div className="actions">
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={busy} onClick={save}>
          {busy ? <I.spin /> : t('common.save')}
        </button>
      </div>
    </Dialog>
  )
}

function RymDialog({ album, onClose, onSaved }) {
  const { t } = useI18n()
  const [parsed, setParsed] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const fileReadSeq = useRef(0)
  const applyInFlight = useRef(false)
  const toast = useToast()

  useEffect(() => () => { fileReadSeq.current++ }, [])

  const handleFile = async (file) => {
    if (!file) return
    const seq = ++fileReadSeq.current
    setErr('')
    try {
      const next = parseRymHtml(await file.text())
      if (seq === fileReadSeq.current) setParsed(next)
    } catch (e) {
      if (seq === fileReadSeq.current) setErr(e.message)
    }
  }

  const apply = async () => {
    if (applyInFlight.current || !parsed) return
    applyInFlight.current = true
    setBusy(true)
    try {
      await api.postRym(album.id, parsed)
      toast(t('rym.imported'), 'ok')
      onSaved()
    } catch (e) { toast(t('rym.fail', e.message), 'err') }
    finally { applyInFlight.current = false; setBusy(false) }
  }

  return (
    <Dialog title={t('rym.title')} onClose={onClose}>
      {!parsed && (
        <>
          <div className="hint" style={{ color: 'var(--ink-faint)', marginBottom: 14 }}>
            {t('rym.dropHint')}
          </div>
          <label className="dropzone" style={{ display: 'block' }}
                 onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over') }}
                 onDragLeave={(e) => e.currentTarget.classList.remove('over')}
                 onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}>
            <I.html size={28} />
            <div>{t('rym.drop')}</div>
            <input type="file" accept=".html,.htm,.mhtml" hidden
                   onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])} />
          </label>
          {err && <div style={{ color: '#ff8b7a', marginTop: 12, fontSize: 13 }}>{err}</div>}
        </>
      )}
      {parsed && (
        <>
          <div style={{ display: 'grid', gap: 8, fontSize: 14 }}>
            <div><b style={{ color: 'var(--gold)', fontSize: 24 }}>★ {parsed.rating?.toFixed(2) ?? '—'}</b>
              <span style={{ color: 'var(--ink-faint)', marginLeft: 8 }}>
                {t('rym.votes', parsed.votes || 0)} {parsed.rank && `· ${parsed.rank}`}</span></div>
            <div>{parsed.title} — {parsed.artist} {parsed.year && `(${parsed.year})`}</div>
            <div className="genre-row">
              {parsed.genres.map((g) => <span key={g} className="gtag">{g}</span>)}
              {parsed.secondaryGenres.map((g) => <span key={g} className="gtag sec">{g}</span>)}
            </div>
            <div className="descriptors">{parsed.descriptors.join(' · ')}</div>
            {parsed.title && album.title &&
              parsed.title.toLowerCase().replace(/\W/g, '') !==
              album.title.toLowerCase().replace(/\W/g, '') && (
              <div style={{ color: 'var(--gold)', fontSize: 12.5 }}>
                {t('rym.titleMismatch', parsed.title, album.title)}
              </div>
            )}
          </div>
          <div className="actions">
            <button className="btn" onClick={() => {
              fileReadSeq.current++
              setParsed(null)
            }}>{t('rym.reselect')}</button>
            <button className="btn primary" disabled={busy} onClick={apply}>
              {busy ? <I.spin /> : t('rym.confirm')}
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}

/* Discogs 导入：自动匹配（服务器调官方 API）或手动拖入保存的发行页 HTML。
 * 只取风格数据：Discogs Style（细）→ 主风格，Genre（粗）→ 次风格，
 * 与现有值大小写不敏感去重后合并。 */
function DiscogsDialog({ album, onClose, onSaved }) {
  const { t } = useI18n()
  const [cands, setCands] = useState(null)  // null = 匹配中
  const [err, setErr] = useState('')
  const [picked, setPicked] = useState(null)
  const [selS, setSelS] = useState(new Set()) // 勾选的 styles → 主风格
  const [selG, setSelG] = useState(new Set()) // 勾选的 genres → 次风格
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)
  // 图片导入（可选）：拉取该发行的图片列表，勾选后一并导入
  const [imgs, setImgs] = useState(null)      // null=未拉取 / []=无图 / [...]
  const [imgSel, setImgSel] = useState(new Set())
  const [imgAsCover, setImgAsCover] = useState(false)
  const [imgBusy, setImgBusy] = useState(false)
  const searchSeq = useRef(0)
  const fileReadSeq = useRef(0)
  const urlRequestSeq = useRef(0)
  const urlInFlight = useRef(false)
  const imageRequestSeq = useRef(0)
  const imageInFlight = useRef(false)
  const applyInFlight = useRef(false)
  const toast = useToast()

  useEffect(() => {
    const seq = ++searchSeq.current
    api.discogsSearch(album.id)
      .then((r) => {
        if (seq !== searchSeq.current) return
        setCands(r.candidates)
        if (!r.candidates.length) setErr(t('discogsAlbum.noCandidates'))
      })
      .catch((e) => {
        if (seq !== searchSeq.current) return
        setCands([]); setErr(e.message)
      })
    return () => {
      searchSeq.current++
      fileReadSeq.current++
      urlRequestSeq.current++
      imageRequestSeq.current++
      urlInFlight.current = false
      imageInFlight.current = false
    }
  }, [album.id, t])

  const pick = (c) => {
    if (!c || applyInFlight.current) return
    fileReadSeq.current++
    urlRequestSeq.current++
    imageRequestSeq.current++
    urlInFlight.current = false
    imageInFlight.current = false
    setUrlBusy(false)
    setImgBusy(false)
    setPicked(c)
    setSelS(new Set(c.styles || []))
    setSelG(new Set(c.genres || []))
    setImgs(null); setImgSel(new Set()); setImgAsCover(false)
  }

  // 从 picked 里拿 Discogs 引用（候选有 id，链接/HTML 有 url）
  const pickedRef = () => (picked?.id ? String(picked.id) : picked?.url || '')

  const loadImages = async () => {
    if (imageInFlight.current || !picked) return
    const ref = pickedRef()
    const seq = ++imageRequestSeq.current
    imageInFlight.current = true
    setErr(''); setImgBusy(true)
    try {
      const r = await api.discogsImageList(album.id, ref)
      if (seq !== imageRequestSeq.current) return
      setImgs(r.images || [])
      if (!r.images?.length) toast(t('discogsAlbum.noImages'), 'err')
    } catch (e) {
      if (seq !== imageRequestSeq.current) return
      toast(t('discogsAlbum.imgFail', e.message), 'err'); setImgs([])
    } finally {
      if (seq === imageRequestSeq.current) {
        imageInFlight.current = false
        setImgBusy(false)
      }
    }
  }

  const toggleImg = (uri) => {
    const n = new Set(imgSel)
    if (n.has(uri)) n.delete(uri); else n.add(uri)
    setImgSel(n)
  }

  const handleFile = async (file) => {
    if (!file || applyInFlight.current) return
    const seq = ++fileReadSeq.current
    setErr('')
    try {
      const next = parseDiscogsHtml(await file.text())
      if (seq === fileReadSeq.current) pick(next)
    } catch (e) {
      if (seq === fileReadSeq.current) setErr(e.message)
    }
  }

  // 粘贴 release / master 链接 → 服务器走官方 API 取详情
  const fetchUrl = async () => {
    const value = url.trim()
    if (!value || urlInFlight.current || applyInFlight.current) return
    const seq = ++urlRequestSeq.current
    urlInFlight.current = true
    setErr(''); setUrlBusy(true)
    try {
      const next = await api.discogsLookup(value)
      if (seq === urlRequestSeq.current) pick(next)
    } catch (e) {
      if (seq === urlRequestSeq.current) setErr(e.message)
    } finally {
      if (seq === urlRequestSeq.current) {
        urlInFlight.current = false
        setUrlBusy(false)
      }
    }
  }

  const toggle = (set, setter, v) => {
    const n = new Set(set)
    if (n.has(v)) n.delete(v); else n.add(v)
    setter(n)
  }

  const apply = async () => {
    if (applyInFlight.current || !picked) return
    applyInFlight.current = true
    setBusy(true)
    try {
      const low = (arr) => new Set((arr || []).map((g) => g.toLowerCase()))
      const cur = low(album.genres)
      const curSec = low(album.secondaryGenres)
      const genres = [...(album.genres || [])]
      for (const s of picked.styles || []) {
        if (selS.has(s) && !cur.has(s.toLowerCase())) genres.push(s)
      }
      const sec = [...(album.secondaryGenres || [])]
      for (const g of picked.genres || []) {
        if (selG.has(g) && !curSec.has(g.toLowerCase())
            && !low(genres).has(g.toLowerCase())) sec.push(g)
      }
      const hasGenres = (picked.styles || []).length || (picked.genres || []).length
      if (hasGenres) await api.patchAlbum(album.id, { genres, secondaryGenres: sec })
      // 顺带导入勾选的图片
      let imgMsg = ''
      if (imgSel.size) {
        const r = await api.discogsImportImages(
          album.id, pickedRef(), [...imgSel], imgAsCover)
        imgMsg = t('discogsAlbum.images', r.imported, r.coverSet)
      }
      toast((hasGenres ? t('discogsAlbum.stylesDone') : t('discogsAlbum.done')) + imgMsg, 'ok')
      onSaved()
    } catch (e) { toast(t('discogsAlbum.fail', e.message), 'err') }
    finally { applyInFlight.current = false; setBusy(false) }
  }

  const resetPick = () => {
    if (applyInFlight.current) return
    fileReadSeq.current++
    urlRequestSeq.current++
    imageRequestSeq.current++
    urlInFlight.current = false
    imageInFlight.current = false
    setUrlBusy(false)
    setImgBusy(false)
    setPicked(null)
    setImgs(null)
    setImgSel(new Set())
    setImgAsCover(false)
  }

  return (
    <Dialog title={t('discogsAlbum.title')} onClose={onClose}>
      {!picked && (
        <>
          {cands === null && (
            <div style={{ display: 'grid', placeItems: 'center', padding: 26,
                          color: 'var(--ink-faint)' }}>
              <I.spin size={18} /> {t('discogsAlbum.matching')}
            </div>
          )}
          {cands?.length > 0 && (
            <div className="dg-cands">
              {cands.map((c) => (
                <div key={c.id} className="dg-cand" onClick={() => pick(c)}>
                  {c.thumb
                    ? <img src={c.thumb} alt="" loading="lazy" />
                    : <span className="dg-noimg"><I.disc size={18} /></span>}
                  <span className="dg-main">
                    <span className="dg-title">{c.title}</span>
                    <span className="dg-sub">
                      {[c.year, c.country, c.format, c.label]
                        .filter(Boolean).join(' · ')}</span>
                    <span className="dg-tags">
                      {[...(c.styles || []), ...(c.genres || [])].slice(0, 5)
                        .map((g) => <i key={g}>{g}</i>)}
                    </span>
                  </span>
                  <I.chevR size={16} />
                </div>
              ))}
            </div>
          )}
          {cands !== null && (
            <>
              <div className="dg-url">
                <input className="tin" value={url}
                       placeholder={t('discogsAlbum.paste')}
                       onChange={(e) => setUrl(e.target.value)}
                       onKeyDown={(e) => { if (e.key === 'Enter') fetchUrl() }} />
                <button className="btn" disabled={urlBusy || !url.trim()}
                        onClick={fetchUrl}>
                  {urlBusy ? <I.spin size={14} /> : t('discogsAlbum.read')}
                </button>
              </div>
              <label className="dropzone slim" style={{ display: 'block', marginTop: 10 }}
                     onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over') }}
                     onDragLeave={(e) => e.currentTarget.classList.remove('over')}
                     onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}>
                <div>{t('discogsAlbum.dropHtml')}</div>
                <input type="file" accept=".html,.htm" hidden
                       onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])} />
              </label>
            </>
          )}
          {err && <div style={{ color: '#ff8b7a', marginTop: 12, fontSize: 13 }}>{err}</div>}
        </>
      )}
      {picked && (
        <>
          <div style={{ display: 'grid', gap: 12, fontSize: 14 }}>
            <div>
              {picked.title} {picked.year ? `(${picked.year})` : ''}
              {picked.url && <a href={picked.url} target="_blank" rel="noreferrer"
                 style={{ color: 'var(--gold)', marginLeft: 8, fontSize: 12.5 }}>
                {t('discogsAlbum.pageLink')} <I.ext size={10} /></a>}
            </div>
            {(picked.styles || []).length > 0 && (
              <div>
                <div className="dg-group">{t('discogsAlbum.styleToPrimary')}</div>
                <div className="genre-row">
                  {picked.styles.map((s) => (
                    <span key={s} className={`gtag pick ${selS.has(s) ? 'on' : ''}`}
                          onClick={() => toggle(selS, setSelS, s)}>{s}</span>
                  ))}
                </div>
              </div>
            )}
            {(picked.genres || []).length > 0 && (
              <div>
                <div className="dg-group">{t('discogsAlbum.genreToSecondary')}</div>
                <div className="genre-row">
                  {picked.genres.map((g) => (
                    <span key={g} className={`gtag sec pick ${selG.has(g) ? 'on' : ''}`}
                          onClick={() => toggle(selG, setSelG, g)}>{g}</span>
                  ))}
                </div>
              </div>
            )}
            <div style={{ color: 'var(--ink-faint)', fontSize: 12.5 }}>
              {t('discogsAlbum.pickHint')}
            </div>

            {/* 图片导入（可选）：拉取该发行的图片，勾选后随「并入」一起导入 */}
            <div className="dg-imgblock">
              <div className="dg-group" style={{ marginBottom: 8 }}>{t('discogsAlbum.imagesOptional')}</div>
              {imgs === null && (
                <button className="btn sm" disabled={imgBusy} onClick={loadImages}>
                  {imgBusy ? <I.spin size={13} /> : <><I.img size={13} /> {t('discogsAlbum.loadImages')}</>}
                </button>
              )}
              {imgs !== null && imgs.length === 0 && (
                <div style={{ color: 'var(--ink-faint)', fontSize: 12.5 }}>
                  {t('discogsAlbum.noImages')}
                </div>
              )}
              {imgs && imgs.length > 0 && (
                <>
                  <div className="dg-imggrid">
                    {imgs.map((im) => (
                      <button key={im.uri} type="button"
                              className={`dg-img ${imgSel.has(im.uri) ? 'on' : ''}`}
                              onClick={() => toggleImg(im.uri)}>
                        <img src={im.thumb} alt="" loading="lazy" />
                        {im.type === 'primary' && <span className="dg-img-tag">{t('discogsAlbum.coverTag')}</span>}
                        {imgSel.has(im.uri) && <span className="dg-img-check"><I.check size={13} /></span>}
                      </button>
                    ))}
                  </div>
                  <label className="dg-cover-opt">
                    <input type="checkbox" checked={imgAsCover}
                           onChange={(e) => setImgAsCover(e.target.checked)} />
                    {t('discogsAlbum.asCover')}
                  </label>
                </>
              )}
            </div>
          </div>
          <div className="actions">
            <button className="btn" disabled={busy} onClick={resetPick}>
              {t('discogsAlbum.back')}</button>
            <button className="btn primary" disabled={busy} onClick={apply}>
              {busy ? <I.spin /> : imgSel.size
                ? t('discogsAlbum.applyWithImg', imgSel.size) : t('discogsAlbum.apply')}
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}

/* 内页/写真画廊：有图才对所有人展示；管理员多一个「添加」入口、删除、拖动排序。 */
function Gallery({ album, isAdmin, onChanged }) {
  const { t } = useI18n()
  const [lightbox, setLightbox] = useState(-1) // 打开的图片下标
  const [uploading, setUploading] = useState(0) // 剩余上传数
  const [order, setOrder] = useState(null)      // 拖动中的临时 id 序
  const [swipeX, setSwipeX] = useState(0)
  const [swipeAnimating, setSwipeAnimating] = useState(false)
  const [settledImage, setSettledImage] = useState(null)
  const fileRef = useRef(null)
  const uploadInFlight = useRef(false)
  const deleteInFlight = useRef(new Set())
  const lightboxRef = useRef(null)
  const swipeRef = useRef(null)
  const swipeTimer = useRef(null)
  const suppressClick = useRef(false)
  const toast = useToast()
  const baseImages = album.images || []
  // 拖动时用临时序，否则用服务端序
  const images = order || baseImages
  const currentImageId = lightbox >= 0 ? images[lightbox] : null
  const imageLoadState = galleryImageLoadState(currentImageId, settledImage)
  // 服务端序变了（刷新/增删）→ 清临时序，跟随服务端
  useEffect(() => { setOrder(null) }, [album.images])

  const canDrag = isAdmin && images.length > 1
  const orderRef = useRef(null)
  const listRef = useRef(images)
  listRef.current = images

  const moveImg = (from, to) => {
    setOrder((cur) => {
      const base = cur || listRef.current.slice()
      if (from < 0 || to < 0 || from >= base.length || to >= base.length) return base
      const n = base.slice()
      const [m] = n.splice(from, 1)
      n.splice(to, 0, m)
      orderRef.current = n
      return n
    })
  }
  const commitOrder = async () => {
    const ids = orderRef.current
    orderRef.current = null
    if (!ids) return
    try { await api.reorderAlbumImages(album.id, ids); onChanged() }
    catch (e) { toast(t('gallery.orderFail', e.message), 'err'); setOrder(null) }
  }
  const galDrag = usePointerReorder({
    itemSelector: '.gal-thumb', enabled: canDrag,
    onMove: moveImg, onCommit: commitOrder,
  })

  const nav = (d) => {
    if (!images.length) return
    setLightbox((i) => (i + d + images.length) % images.length)
  }

  const closeLightbox = () => {
    clearTimeout(swipeTimer.current)
    swipeRef.current = null
    setSwipeAnimating(false)
    setSwipeX(0)
    setSettledImage(null)
    setLightbox(-1)
  }

  useEffect(() => {
    if (lightbox < 0) return
    document.body.classList.add('lb-lock')
    lightboxRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') closeLightbox()
      else if (e.key === 'ArrowLeft') nav(-1)
      else if (e.key === 'ArrowRight') nav(1)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('lb-lock')
      window.removeEventListener('keydown', onKey)
    }
  }, [lightbox, images.length])

  useEffect(() => () => clearTimeout(swipeTimer.current), [])

  const touchStart = (e) => {
    if (e.touches.length !== 1) {
      swipeRef.current = null
      setSwipeX(0)
      return
    }
    if (swipeAnimating || e.target.closest('button, a, .lb-bar')) return
    const p = e.touches[0]
    swipeRef.current = {
      x0: p.clientX, y0: p.clientY, x: p.clientX, y: p.clientY,
      t0: e.timeStamp, axis: '',
    }
    suppressClick.current = false
  }

  const touchMove = (e) => {
    const s = swipeRef.current
    if (!s) return
    if (e.touches.length !== 1) {
      swipeRef.current = null
      setSwipeX(0)
      return
    }
    const p = e.touches[0]
    const dx = p.clientX - s.x0, dy = p.clientY - s.y0
    s.x = p.clientX; s.y = p.clientY
    if (!s.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      s.axis = Math.abs(dx) > Math.abs(dy) * 1.05 ? 'x' : 'y'
    }
    if (s.axis !== 'x') return
    suppressClick.current = true
    e.preventDefault()
    setSwipeX(dx)
  }

  const finishTouch = (e, cancelled = false) => {
    const s = swipeRef.current
    swipeRef.current = null
    if (!s || s.axis !== 'x') return
    const p = e.changedTouches?.[0]
    const dx = (p?.clientX ?? s.x) - s.x0
    const dy = (p?.clientY ?? s.y) - s.y0
    const direction = cancelled ? 0 : gallerySwipeDirection({
      dx, dy, elapsed: e.timeStamp - s.t0, width: window.innerWidth,
    })
    setSwipeAnimating(true)
    setSwipeX(direction
      ? (direction > 0 ? -window.innerWidth : window.innerWidth)
      : 0)
    clearTimeout(swipeTimer.current)
    swipeTimer.current = setTimeout(() => {
      if (direction) nav(direction)
      setSwipeAnimating(false)
      setSwipeX(0)
      suppressClick.current = false
    }, direction ? 180 : 160)
  }

  if (!baseImages.length && !isAdmin) return null

  const upload = async (files) => {
    if (uploadInFlight.current) return
    const list = [...files].filter((f) => imageExt(f))
    if (!list.length) return
    uploadInFlight.current = true
    setUploading(list.length)
    let succeeded = 0
    try {
      for (const [index, f] of list.entries()) {
        try {
          if (!f.size || f.size > 16 * 1024 * 1024) {
            throw new Error('image must be between 1 byte and 16 MB')
          }
          const ext = imageExt(f)
          const stem = cleanName(f.name.replace(/\.[^.]+$/, '')) || 'scan'
          const path = `${album.folder}/artwork/${Date.now()}-${index}-${stem}.${ext}`
            .normalize('NFC')
          if (stem.length > 220 || path.length > 400) throw new Error('image path is too long')
          await uploadFileToOneDrive(path, f)
          await api.addAlbumImage(album.id, path)
          succeeded++
        } catch (e) {
          toast(t('gallery.uploadFail', `${f.name}: ${e.message}`), 'err')
        } finally {
          setUploading((n) => Math.max(0, n - 1))
        }
      }
      if (succeeded) {
        toast(t('gallery.uploaded'), 'ok')
        onChanged()
      }
    } finally {
      uploadInFlight.current = false
      setUploading(0)
    }
  }

  const remove = async (imgId) => {
    if (deleteInFlight.current.has(imgId)) return
    deleteInFlight.current.add(imgId)
    try {
      await api.deleteAlbumImage(album.id, imgId, true)
      setLightbox(-1)
      setOrder(null)
      onChanged()
      toast(t('gallery.deleted'), 'ok')
    } catch (e) { toast(t('albumPage.deleteFail', e.message), 'err') }
    finally { deleteInFlight.current.delete(imgId) }
  }

  return (
    <div className="gallery">
      {baseImages.length > 0 && (
        <h3>{t('albumPage.gallery')}
          {canDrag && <span className="gal-hint"><I.grip size={11} /> {t('albumPage.galleryHint')}</span>}
        </h3>
      )}
      <div className="gal-row">
        {images.map((imgId, i) => (
          <div key={imgId}
               className={`gal-thumb ${canDrag ? 'draggable' : ''} ${galDrag.active === i ? 'dragging' : ''}`}
               {...galDrag.dragProps(i)}
               onClick={() => { setSettledImage(null); setLightbox(i) }}>
            <img loading="lazy" src={imgUrl(imgId, 480)} alt="" />
            {canDrag && (
              <span className="gal-grip" data-drag-handle
                    onClick={(e) => e.stopPropagation()}>
                <I.grip size={14} />
              </span>
            )}
          </div>
        ))}
        {isAdmin && (
          <button className={`gal-add ${baseImages.length ? '' : 'lonely'}`}
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading > 0}>
            {uploading > 0 ? <><I.spin size={16} /> {t('gallery.remaining', uploading)}</>
              : <><I.plus size={16} /> {baseImages.length ? t('gallery.add') : t('gallery.uploadFirst')}</>}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden
               onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
      </div>

      {lightbox >= 0 && createPortal(
        <div className="lightbox" ref={lightboxRef} role="dialog" aria-modal="true"
             tabIndex={-1}
             onTouchStart={touchStart} onTouchMove={touchMove}
             onTouchEnd={finishTouch}
             onTouchCancel={(e) => finishTouch(e, true)}
             onClickCapture={(e) => {
               if (!suppressClick.current) return
               suppressClick.current = false
               e.preventDefault(); e.stopPropagation()
             }}
             onClick={closeLightbox}>
          {imageLoadState !== 'ready' && (
            <div className={`lb-image-state ${imageLoadState}`} role="status"
                 aria-label={imageLoadState === 'error'
                   ? t('gallery.loadFail') : t('common.loading')}>
              {imageLoadState === 'error'
                ? <><I.img size={24} /><span>{t('gallery.loadFail')}</span></>
                : <I.spin size={26} aria-hidden="true" />}
            </div>
          )}
          <img key={currentImageId}
               className={`lb-image ${swipeAnimating ? 'animating' : ''}`}
               src={imgUrl(currentImageId, 1000)}
               alt={`${lightbox + 1} / ${images.length}`}
               draggable="false"
               style={{
                 transform: `translate3d(${swipeX}px, 0, 0)`,
                 opacity: imageLoadState === 'ready'
                   ? Math.max(0.35, 1 - Math.abs(swipeX) / 420) : 0,
               }}
               onLoad={() => setSettledImage({ id: currentImageId, status: 'ready' })}
               onError={() => setSettledImage({ id: currentImageId, status: 'error' })}
               onClick={(e) => e.stopPropagation()} />
          <button className="lb-close icon-btn" onClick={closeLightbox}>
            <I.x size={22} /></button>
          {images.length > 1 && <>
            <button className="lb-nav l icon-btn"
                    aria-label={t('player.prev')}
                    onClick={(e) => { e.stopPropagation(); nav(-1) }}>
              <I.chevL size={26} /></button>
            <button className="lb-nav r icon-btn"
                    aria-label={t('player.next')}
                    onClick={(e) => { e.stopPropagation(); nav(1) }}>
              <I.chevR size={26} /></button>
          </>}
          <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
            <span>{lightbox + 1} / {images.length}</span>
            <a href={imgUrl(images[lightbox])} target="_blank" rel="noreferrer">
              {t('gallery.original')} <I.ext size={11} /></a>
            {isAdmin && (
              <button className="btn sm danger" onClick={() => remove(images[lightbox])}>
                <I.trash size={12} /> {t('common.delete')}</button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

/* 曲目管理：拖拽排序 / 改名 / 删除 / 补传音频（管理员） */
function TracksDialog({ album, onClose, onChanged }) {
  const { t } = useI18n()
  const [rows, setRows] = useState(album.tracks)
  const [orderDirty, setOrderDirty] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [delFiles, setDelFiles] = useState(false)
  const [armed, setArmed] = useState('')   // 待二次确认删除的曲目 id
  const [adding, setAdding] = useState([]) // [{name, pct}]
  const [rescanning, setRescanning] = useState(false)
  const dragIdx = useRef(-1)
  const saveOrderInFlight = useRef(false)
  const addFilesInFlight = useRef(false)
  const rescanInFlight = useRef(false)
  const deleteInFlight = useRef(new Set())
  const toast = useToast()

  const refresh = async () => {
    const d = await api.album(album.id)
    setRows(d.tracks)
    setOrderDirty(false)
    onChanged()
  }

  const move = (from, to) => {
    if (to < 0 || to >= rows.length || from === to || from < 0) return
    const next = [...rows]
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    setRows(next)
    setOrderDirty(true)
  }

  const saveOrder = async () => {
    if (saveOrderInFlight.current) return
    saveOrderInFlight.current = true
    setSavingOrder(true)
    try {
      await api.orderTracks(album.id, rows.map((r) => r.id))
      toast(t('tracksManage.orderSaved'), 'ok')
      await refresh()
    } catch (e) { toast(e.message, 'err') }
    finally { saveOrderInFlight.current = false; setSavingOrder(false) }
  }

  const del = async (tr) => {
    if (armed !== tr.id) {
      setArmed(tr.id)
      setTimeout(() => setArmed((a) => (a === tr.id ? '' : a)), 2600)
      return
    }
    setArmed('')
    if (deleteInFlight.current.has(tr.id)) return
    deleteInFlight.current.add(tr.id)
    try {
      await api.deleteTrack(album.id, tr.id, delFiles)
      setRows((rs) => rs.filter((r) => r.id !== tr.id))
      onChanged()
      toast(delFiles ? t('tracksManage.removedFiles') : t('tracksManage.removed'), 'ok')
    } catch (e) { toast(e.message, 'err') }
    finally { deleteInFlight.current.delete(tr.id) }
  }

  const rename = async (t, title) => {
    const v = title.trim()
    if (!v || v === t.title) return
    try {
      await api.patchTrack(album.id, t.id, { title: v })
      setRows((rs) => rs.map((r) => (r.id === t.id ? { ...r, title: v } : r)))
      onChanged()
    } catch (e) { toast(e.message, 'err') }
  }

  const addFiles = async (fileList) => {
    if (addFilesInFlight.current) return
    const files = [...fileList].filter((f) =>
      /\.(mp3|flac|m4a|ogg|opus|wav)$/i.test(f.name))
    if (!files.length) { toast(t('tracksManage.noAudio'), 'err'); return }
    addFilesInFlight.current = true
    const seen = new Set()
    try {
      for (const f of files) {
        try {
          const meta = await readTags(f)
          const filename = cleanName(meta.filename)
          const path = `${album.folder}/${filename}`.normalize('NFC')
          const key = path.toLocaleLowerCase()
          if (!filename || filename.length > 255 || path.length > 400
              || !f.size || seen.has(key)) {
            throw new Error('invalid or duplicate path')
          }
          seen.add(key)
          setAdding((a) => [...a, { name: f.name, pct: 0 }])
          await uploadFileToOneDrive(path, f, (done) =>
            setAdding((a) => a.map((x) =>
              x.name === f.name ? { ...x, pct: Math.round(done / f.size * 100) } : x)))
          await api.addTrack(album.id, {
            path, title: meta.title, track: meta.track, disc: meta.disc,
            duration: meta.duration, format: meta.format,
            bitrate: meta.bitrate || null, size: meta.size,
          })
        } catch (e) {
          toast(t('tracksManage.uploadFail', f.name, e.message), 'err')
        } finally {
          setAdding((a) => a.filter((x) => x.name !== f.name))
        }
      }
      try { await refresh() }
      catch (e) { toast(e.message, 'err') }
    } finally {
      addFilesInFlight.current = false
    }
  }

  // 曲库自愈：按 OneDrive 目录里的真实文件重建曲目表（找回误删的歌、
  // 收编手动丢进网盘的文件）。艺人/专辑名/年份沿用当前值不被覆盖。
  const rescan = async () => {
    if (rescanInFlight.current) return
    rescanInFlight.current = true
    setRescanning(true)
    try {
      await api.scanFolder(album.folder, {
        artist: album.artist, title: album.title, year: album.year,
      })
      toast(t('tracksManage.rescanned'), 'ok')
      await refresh()
    } catch (e) { toast(t('tracksManage.rescanFail', e.message), 'err') }
    finally { rescanInFlight.current = false; setRescanning(false) }
  }

  return (
    <Dialog title={t('tracksManage.title')} onClose={onClose}>
      <div className="hint" style={{ color: 'var(--ink-faint)', marginBottom: 12 }}>
        {t('tracksManage.hint')}
      </div>

      <div className="td-list">
        {rows.map((tr, i) => (
          <div key={tr.id} className="td-row" draggable
               onDragStart={(e) => {
                 dragIdx.current = i
                 e.dataTransfer.effectAllowed = 'move'
               }}
               onDragOver={(e) => {
                 e.preventDefault()
                 if (dragIdx.current !== i) { move(dragIdx.current, i); dragIdx.current = i }
               }}
               onDragEnd={() => { dragIdx.current = -1 }}>
            <span className="td-grip"><I.grip size={14} /></span>
            <span className="td-no">{i + 1}</span>
            <input className="td-title" defaultValue={tr.title} key={tr.id + tr.title}
                   onBlur={(e) => rename(tr, e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
            <span className="td-dur">{fmtDur(tr.duration)}</span>
            <span className="td-updown">
              <button className="icon-btn xs" disabled={i === 0}
                      onClick={() => move(i, i - 1)}><I.chevUp size={14} /></button>
              <button className="icon-btn xs" disabled={i === rows.length - 1}
                      onClick={() => move(i, i + 1)}><I.chevDown size={14} /></button>
            </span>
            <button className={`btn sm ${armed === tr.id ? 'danger arm' : ''}`}
                    onClick={() => del(tr)}>
              {armed === tr.id ? t('tracksManage.confirmDel') : <I.trash size={13} />}
            </button>
          </div>
        ))}
        {adding.map((a) => (
          <div key={a.name} className="td-row adding">
            <span className="td-grip"><I.spin size={13} /></span>
            <span className="td-no">＋</span>
            <span className="td-title" style={{ color: 'var(--ink-faint)' }}>{a.name}</span>
            <span className="td-dur">{a.pct}%</span>
            <span className="td-updown" />
            <span />
          </div>
        ))}
      </div>

      <label className="dropzone td-add"
             onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over') }}
             onDragLeave={(e) => e.currentTarget.classList.remove('over')}
             onDrop={(e) => {
               e.preventDefault()
               e.currentTarget.classList.remove('over')
               addFiles(e.dataTransfer.files)
             }}>
        <I.plus size={15} /> {t('tracksManage.add')}
        <input type="file" multiple hidden accept=".mp3,.flac,.m4a,.ogg,.opus,.wav"
               onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
      </label>

      <div className="actions" style={{ alignItems: 'center' }}>
        <label className="td-delfiles">
          <input type="checkbox" checked={delFiles}
                 onChange={(e) => setDelFiles(e.target.checked)} />
          {t('tracksManage.delWithFiles')}
        </label>
        <span style={{ flex: 1 }} />
        <button className="btn sm" onClick={rescan} disabled={rescanning}
                title={t('tracksManage.rescanTitle')}>
          {rescanning ? <I.spin size={13} /> : <><I.cloud size={13} /> {t('tracksManage.rescan')}</>}
        </button>
        <button className="btn" onClick={onClose}>{t('common.close')}</button>
        {orderDirty && (
          <button className="btn primary" disabled={savingOrder} onClick={saveOrder}>
            {savingOrder ? <I.spin /> : t('tracksManage.saveOrder')}
          </button>
        )}
      </div>
    </Dialog>
  )
}

export default function AlbumPage({ id, onPlay, playingId, currentId,
                                    isAdmin, favAlbums, favTracks, toggleFav,
                                    onChanged, onOpen, onOpenArtist, onOpenGenre }) {
  const { t } = useI18n()
  const [al, setAl] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [dlg, setDlg] = useState('') // '' | 'edit' | 'rym' | 'tracks' | 'del'
  const [noteReader, setNoteReader] = useState(false) // 简介全文弹层
  const loadSeq = useRef(0)
  const toast = useToast()

  const load = async () => {
    const seq = ++loadSeq.current
    try {
      const next = await api.album(id)
      if (seq !== loadSeq.current) return
      setAl(next)
      setLoadError('')
    } catch (e) {
      if (seq !== loadSeq.current) return
      setLoadError(e.message || 'load failed')
    }
  }
  useEffect(() => {
    setAl(null)
    setLoadError('')
    load()
    return () => { loadSeq.current++ }
  }, [id])

  if (loadError && !al) {
    return <div className="empty" style={{ paddingTop: 60 }}>
      <div className="big">{t('empty.noMatch')}</div>
      <div>{loadError}</div>
      <button className="btn" onClick={load}>{t('common.retry')}</button>
    </div>
  }

  if (!al) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--ink-faint)' }}>
      {t('common.loading')}</div>
  }
  const rym = al.rym
  const retryCoverFromOrigin = (event, size) => {
    const image = event.currentTarget
    if (image.dataset.originRetry === '1') return
    image.dataset.originRetry = '1'
    image.src = artUrl(al.id, size, true)
  }

  const del = async (files) => {
    try {
      await api.deleteAlbum(al.id, files)
      toast(files ? t('albumPage.deletedFiles') : t('albumPage.deleted'), 'ok')
      onChanged()
      navigate('/')
    } catch (e) { toast(t('albumPage.deleteFail', e.message), 'err') }
  }

  const toggleHide = async () => {
    try {
      const next = !al.hidden
      await api.hideAlbum(al.id, next)
      toast(next ? t('albumPage.hiddenOk') : t('albumPage.shownOk'), 'ok')
      setAl({ ...al, hidden: next })
      onChanged()
      // 隐藏后回曲库，避免访客态误入；管理员仍可从「显示隐藏」进
      if (next) navigate('/')
    } catch (e) { toast(t('albumPage.hideFail', e.message), 'err') }
  }

  return (
    <div className={`album-page ${al.hidden ? 'is-hidden' : ''}`}>
      <div className="backdrop"><img src={artUrl(al.id, 480)} alt=""
        onError={(event) => retryCoverFromOrigin(event, 480)} /></div>
      <button className="back-btn" onClick={goBack}>
        <I.back size={15} /> {t('common.back')}
      </button>

      <div className="hero">
        <div className="hero-cover">
          <img src={artUrl(al.id, 1000)} alt=""
               onError={(event) => retryCoverFromOrigin(event, 1000)} />
          {al.hidden && <span className="badge-hidden">{t('albumPage.hiddenBadge')}</span>}
        </div>
        <div className="hero-info">
          <div className="hero-artist link" onClick={() => onOpenArtist(al.artist)}>
            {al.artist}</div>
          <h1 className="hero-title">{al.title}</h1>
          <div className="hero-meta">
            {al.year && <span>{al.year}</span>}
            <span>·</span><span>{t('count.tracks', al.tracks.length)}</span>
            {al.duration ? <><span>·</span><span>{fmtTotal(al.duration, t)}</span></> : null}
            {al.tracks[0]?.format &&
              <><span>·</span><span style={{ textTransform: 'uppercase' }}>
                {[...new Set(al.tracks.map((t) => t.format))].join(' / ')}</span></>}
          </div>

          {rym ? (
            <div className="rym-box">
              <div className="rym-score">
                <span className="num">{rym.rating?.toFixed(2) ?? '—'}</span>
                <span className="outof">/ 5.00</span>
              </div>
              <div className="rym-side">
                {rym.votes && <div>{t('rym.votes', rym.votes)}</div>}
                {rym.rank && <div>{rym.rank}</div>}
                {rym.rymUrl &&
                  <a href={rym.rymUrl} target="_blank" rel="noreferrer">
                    {t('rym.page')} <I.ext size={11} /></a>}
              </div>
            </div>
          ) : (
            <div className="rym-box">
              <span style={{ color: 'var(--ink-faint)', fontSize: 13 }}>
                {isAdmin
                  ? t('rym.noDataAdmin')
                  : t('rym.noDataUser')}
              </span>
            </div>
          )}

          {(al.genres.length > 0 || rym) && (
            <div className="genre-row">
              {al.genres.map((g) => (
                <span key={g} className="gtag link" title={t('albumPage.viewGenre', g)}
                      onClick={() => onOpenGenre(g)}>{g}</span>
              ))}
              {(al.secondaryGenres || []).map((g) => (
                <span key={g} className="gtag sec link" onClick={() => onOpenGenre(g)}>
                  {g}</span>
              ))}
            </div>
          )}
          {rym?.descriptors?.length > 0 && (
            <div className="descriptors">{rym.descriptors.join(' · ')}</div>
          )}

          <div className="hero-actions">
            <button className="btn primary"
                    onClick={() => onPlay(al, al.tracks)}>
              <I.play size={15} /> {t('common.play')}</button>
            <span className="hero-heart">
              <Heart on={favAlbums.has(al.id)} canEdit={isAdmin} size={18}
                     onToggle={() => toggleFav('album', al.id)} />
            </span>
            {isAdmin && <>
              <button className="btn" onClick={() => setDlg('edit')}>
                <I.edit size={14} /> {t('common.edit')}</button>
              <button className="btn" onClick={() => setDlg('tracks')}>
                <I.list size={14} /> {t('albumPage.tracks')}</button>
              <button className="btn" onClick={() => setDlg('rym')}>
                <I.html size={14} /> RYM</button>
              <button className="btn" onClick={() => setDlg('discogs')}>
                <I.disc size={14} /> Discogs</button>
              <button className="btn" onClick={toggleHide}
                      title={al.hidden ? t('albumPage.unhide') : t('albumPage.hide')}>
                {al.hidden ? t('albumPage.unhide') : t('albumPage.hide')}
              </button>
              <button className="btn danger" onClick={() => setDlg('del')}>
                <I.trash size={14} /></button>
            </>}
          </div>
        </div>
      </div>

      {al.note && (
        <div className="album-note">
          <h3>{t('albumPage.note')}</h3>
          <NoteText text={al.note} clampLines={5}
                    onMore={() => setNoteReader(true)} />
        </div>
      )}
      {noteReader && (
        <Reader kicker={t('albumPage.kicker')} title={al.title}
                avatar={artUrl(al.id, 120)} square
                onClose={() => setNoteReader(false)}>
          <Md text={al.note} />
        </Reader>
      )}

      <div className="tracks">
        {al.tracks.map((t, i) => (
          <div key={t.id}
               className={`trow ${currentId === t.id ? 'playing' : ''}`}
               onClick={() => onPlay(al, al.tracks, i)}>
            <span className="num">
              {currentId === t.id && playingId
                ? <span className="eq"><i /><i /><i /></span>
                : t.track ?? i + 1}
            </span>
            <span className="t-title">{t.title}</span>
            <span className="t-fmt">
              {t.format}{t.bitrate ? ` · ${t.bitrate}k` : ''}</span>
            <span className="t-dur">{fmtDur(t.duration)}</span>
            <span className="t-heart">
              <Heart on={favTracks.has(t.id)} canEdit={isAdmin}
                     onToggle={() => toggleFav('track', t.id)} />
            </span>
          </div>
        ))}
      </div>

      <Gallery album={al} isAdmin={isAdmin} onChanged={load} />

      {al.similar.length > 0 && (
        <div className="similar">
          <h3>{t('albumPage.similar')}</h3>
          <div className="sim-row">
            {al.similar.map((s) => (
              <div key={s.id} className="sim-card" onClick={() => onOpen(s.id)}>
                <img loading="lazy" src={artUrl(s.id, 300)} alt="" />
                <div className="n">{s.title}</div>
                <Rating value={s.rating} />
              </div>
            ))}
          </div>
        </div>
      )}

      {dlg === 'edit' &&
        <EditDialog album={al} onClose={() => setDlg('')}
                    onSaved={() => { setDlg(''); load(); onChanged() }} />}
      {dlg === 'tracks' &&
        <TracksDialog album={al} onClose={() => { setDlg(''); load() }}
                      onChanged={() => { load(); onChanged() }} />}
      {dlg === 'rym' &&
        <RymDialog album={al} onClose={() => setDlg('')}
                   onSaved={() => { setDlg(''); load(); onChanged() }} />}
      {dlg === 'discogs' &&
        <DiscogsDialog album={al} onClose={() => setDlg('')}
                       onSaved={() => { setDlg(''); load(); onChanged() }} />}
      {dlg === 'del' && (
        <Dialog title={t('albumPage.deleteTitle')} onClose={() => setDlg('')}>
          <div style={{ color: 'var(--ink-dim)', fontSize: 14 }}>
            「{al.artist} — {al.title}」
          </div>
          <p style={{ color: 'var(--ink-faint)', fontSize: 13, margin: '10px 0 0' }}>
            {t('albumPage.deleteBody')}
          </p>
          <div className="actions">
            <button className="btn" onClick={() => setDlg('')}>{t('common.cancel')}</button>
            <button className="btn" onClick={() => del(false)}>{t('albumPage.deleteKeep')}</button>
            <button className="btn danger" onClick={() => del(true)}>
              {t('albumPage.deleteFiles')}</button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
