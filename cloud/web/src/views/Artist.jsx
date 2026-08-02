import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, artUrl, artistArtUrl, discogsImageProxyUrl } from '../api.js'
import { CropDialog, Dialog, I, Md, Reader, VisibilityToggle,
         fmtTotal, goBack, useToast } from '../ui.jsx'
import { useI18n } from '../i18n.jsx'
import { AlbumCard, isPriorityCover } from './Library.jsx'
import { TrackRow } from './Tracks.jsx'
import { preferredArtistSort } from '../aliases.js'
import { hasArtist } from '../artist-credit.jsx'

function BioDialog({ name, initialNote, onClose, onSaved }) {
  const { t } = useI18n()
  const [note, setNote] = useState(initialNote || '')
  const [bio, setBio] = useState(null)
  const [bioLoadFailed, setBioLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    let active = true
    setBioLoadFailed(false)
    // Never replace bio with '' after a load failure: saving an empty string means an explicit clear on the backend
    // (DELETE the artistbio row), so a brief network failure could silently erase a long biography.
    // Keep null on failure, leave Save disabled, and report the error.
    api.artistBio(name).then((r) => { if (active) setBio(r.bio) })
      .catch((e) => {
        if (!active) return
        setBioLoadFailed(true)
        toast(e.message, 'err')
      })
    return () => { active = false }
  }, [name, toast])

  const save = async () => {
    setBusy(true)
    try {
      await api.putArtist(name, { note, bio: bio ?? '' })
      toast(note.trim() || (bio || '').trim()
        ? t('artistPage.bioSaved') : t('artistPage.bioCleared'), 'ok')
      onSaved()
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy(false) }
  }

  return (
    <Dialog title={t('artistPage.bioDialog', name)} onClose={onClose}>
      <div className="bio-form">
        <label>{t('artistPage.shortBio')} <span>{t('artistPage.shortBioHint')}</span></label>
        <textarea className="tin" rows={3} value={note} autoFocus
                  placeholder={t('artistPage.shortBioPh')}
                  onChange={(e) => setNote(e.target.value)} />
        <label>{t('artistPage.longBio')} <span>{t('artistPage.longBioHint')}</span></label>
        {bio === null
          ? <div className="bio-form-loading">
              {bioLoadFailed ? t('common.loadFailed') : <I.spin size={16} />}
            </div>
          : <textarea className="tin bio-long" rows={12} value={bio}
                      placeholder={t('artistPage.longBioPh')}
                      onChange={(e) => setBio(e.target.value)} />}
      </div>
      <div className="actions">
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={busy || bio === null} onClick={save}>
          {busy ? <I.spin /> : t('common.save')}
        </button>
      </div>
    </Dialog>
  )
}

function ArtistSortDialog({ name, initialSort, onClose, onSaved }) {
  const { t } = useI18n()
  const [value, setValue] = useState(initialSort === name ? '' : initialSort || '')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const save = async () => {
    setBusy(true)
    try {
      await api.putArtist(name, { artistSort: value })
      toast(t('artistPage.sortSaved'), 'ok')
      onSaved()
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy(false) }
  }

  return (
    <Dialog title={t('artistPage.sortDialog', name)} onClose={onClose}>
      <div className="bio-form artist-sort-form">
        <label>{t('artistPage.sortLabel')}</label>
        <input className="tin" value={value} autoFocus
               placeholder={t('artistPage.sortPh')}
               onChange={(e) => setValue(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && !busy) save() }} />
        <div className="field-hint">{t('artistPage.sortHint')}</div>
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

function DiscogsArtistThumb({ candidate }) {
  const initial = candidate.thumb || ''
  const [uri, setUri] = useState(initial)
  const [phase, setPhase] = useState(initial ? 'candidate' : 'detail')

  useEffect(() => {
    setUri(initial)
    setPhase(initial ? 'candidate' : 'detail')
  }, [candidate.id, initial])

  useEffect(() => {
    if (phase !== 'detail' || !candidate.id) return undefined
    let live = true
    api.artistDiscogsDetail(String(candidate.id))
      .then((result) => {
        if (!live) return
        const image = result.images?.[0]
        const next = image?.thumb || image?.uri || ''
        setUri(next)
        setPhase(next ? 'detail-ready' : 'empty')
      })
      .catch(() => { if (live) setPhase('empty') })
    return () => { live = false }
  }, [candidate.id, phase])

  if (uri) {
    return <img src={discogsImageProxyUrl(uri)} alt="" loading="lazy"
                onError={() => {
                  setUri('')
                  setPhase(phase === 'candidate' ? 'detail' : 'empty')
                }} />
  }
  const loading = phase === 'detail'
  return (
    <span className={`dg-noimg ${loading ? 'loading' : ''}`}>
      {loading ? <I.spin size={16} /> : <I.user size={18} />}
    </span>
  )
}

function ArtistDiscogsDialog({ name, onClose, onImported }) {
  const { t } = useI18n()
  const [cands, setCands] = useState(null)
  const [detail, setDetail] = useState(null)
  const [err, setErr] = useState('')
  const [avatarUri, setAvatarUri] = useState('')
  const [useBio, setUseBio] = useState(true)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)
  const detailRequestSeq = useRef(0)
  const urlInFlight = useRef(false)
  const toast = useToast()

  useEffect(() => {
    let active = true
    api.artistDiscogsSearch(name)
      .then((r) => {
        if (!active) return
        setCands(r.candidates)
        if (!r.candidates.length) setErr(t('discogsArtist.none'))
      })
      .catch((e) => { if (active) { setCands([]); setErr(e.message) } })
    return () => { active = false }
  }, [name, t])

  useEffect(() => () => {
    detailRequestSeq.current++
    urlInFlight.current = false
  }, [])

  const showDetail = (d) => {
    setDetail(d)
    setAvatarUri(d.images?.[0]?.uri || '')
    setUseBio(!!d.profile)
  }

  const pick = async (c) => {
    const seq = ++detailRequestSeq.current
    urlInFlight.current = false
    setUrlBusy(false)
    setErr(''); setDetail('loading')
    try {
      const d = await api.artistDiscogsDetail(c.id)
      if (seq === detailRequestSeq.current) showDetail(d)
    } catch (e) {
      if (seq === detailRequestSeq.current) { setErr(e.message); setDetail(null) }
    }
  }

  const fetchUrl = async () => {
    const value = url.trim()
    if (!value || urlInFlight.current) return
    const seq = ++detailRequestSeq.current
    urlInFlight.current = true
    setErr(''); setUrlBusy(true)
    try {
      const d = await api.artistDiscogsDetail(value)
      if (seq === detailRequestSeq.current) showDetail(d)
    } catch (e) {
      if (seq === detailRequestSeq.current) setErr(e.message)
    } finally {
      if (seq === detailRequestSeq.current) {
        urlInFlight.current = false
        setUrlBusy(false)
      }
    }
  }

  const doImport = async () => {
    setBusy(true)
    try {
      const wantAvatar = !!avatarUri
      const r = await api.artistDiscogsImport(name, {
        avatarUri: avatarUri || '', profile: detail.profile || '',
        setAvatar: wantAvatar, setBio: useBio && !!detail.profile,
      })
      const parts = []
      if (r.avatarSet) parts.push(t('discogsArtist.avatar'))
      if (r.bioSet) parts.push(t('discogsArtist.bio'))
      // Older backends may save only the biography while the avatar fails silently, or return avatarError.
      if (wantAvatar && !r.avatarSet) {
        toast(r.avatarError
          ? t('discogsArtist.fail', r.avatarError)
          : t('discogsArtist.fail', t('discogsArtist.avatar')), 'err')
      } else if (parts.length) {
        toast(t('discogsArtist.imported', parts.join(' + ')), 'ok')
      } else {
        toast(t('discogsArtist.nothing'), 'err')
      }
      // Refresh when either item succeeds; an avatar success makes the parent bump avatarVer to bust caches.
      if (r.avatarSet || r.bioSet) onImported()
    } catch (e) { toast(t('discogsArtist.fail', e.message), 'err') }
    finally { setBusy(false) }
  }

  return (
    <Dialog title={t('discogsArtist.title')} onClose={onClose}>
      {!detail && (
        <>
          {cands === null && (
            <div style={{ display: 'grid', placeItems: 'center', padding: 26,
                          color: 'var(--ink-faint)' }}>
              <I.spin size={18} /> {t('discogsArtist.searching')}
            </div>
          )}
          {cands?.length > 0 && (
            <div className="dg-cands">
              {cands.map((c) => (
                <div key={c.id} className="dg-cand" onClick={() => pick(c)}>
                  <DiscogsArtistThumb candidate={c} />
                  <span className="dg-main">
                    <span className="dg-title">{c.title}</span>
                  </span>
                  <I.chevR size={16} />
                </div>
              ))}
            </div>
          )}
          {cands !== null && (
            <div className="dg-url">
              <input className="tin" value={url}
                     placeholder={t('discogsArtist.paste')}
                     onChange={(e) => setUrl(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') fetchUrl() }} />
              <button className="btn" disabled={urlBusy || !url.trim()}
                      onClick={fetchUrl}>
                {urlBusy ? <I.spin size={14} /> : t('discogsArtist.read')}
              </button>
            </div>
          )}
          {err && <div style={{ color: '#ff8b7a', marginTop: 12, fontSize: 13 }}>{err}</div>}
        </>
      )}
      {detail === 'loading' && (
        <div style={{ display: 'grid', placeItems: 'center', padding: 26 }}>
          <I.spin size={18} /></div>
      )}
      {detail && detail !== 'loading' && (
        <>
          {detail.images?.length > 0 && (
            <>
              <div className="dg-group" style={{ marginBottom: 8 }}>
                {t('discogsArtist.pickAvatar')}
              </div>
              <div className="ava-pick-grid">
                {detail.images.map((im) => (
                  <img key={im.uri}
                       src={discogsImageProxyUrl(im.thumb || im.uri)}
                       alt="" loading="lazy"
                       className={avatarUri === im.uri ? 'sel' : ''}
                       onClick={() => setAvatarUri(avatarUri === im.uri ? '' : im.uri)} />
                ))}
              </div>
            </>
          )}
          {detail.profile && (
            <label className="dg-cover-opt" style={{ marginTop: 14 }}>
              <input type="checkbox" checked={useBio}
                     onChange={(e) => setUseBio(e.target.checked)} />
              {t('discogsArtist.importBio')}
            </label>
          )}
          {detail.profile && useBio && (
            <div className="dg-bio-preview">{detail.profile.slice(0, 400)}
              {detail.profile.length > 400 ? '…' : ''}</div>
          )}
          {!detail.images?.length && !detail.profile && (
            <div style={{ color: 'var(--ink-faint)', fontSize: 13 }}>
              {t('discogsArtist.noData')}
            </div>
          )}
          <div className="actions">
            <button className="btn" onClick={() => setDetail(null)}>{t('common.back')}</button>
            <button className="btn primary"
                    disabled={busy || (!avatarUri && !(useBio && detail.profile))}
                    onClick={doImport}>
              {busy ? <I.spin /> : t('common.import')}
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}

export default function ArtistPage({ name, albums, artists, avatarVer,
                                     onAvatarChanged, onArtistChanged, isAdmin,
                                     onOpen, onOpenArtist, onOpenGenre, onPlay,
                                     onPlayTracks, favTracks, toggleFav, currentId,
                                     showHidden, setShowHidden,
                                     currentAlbumId, playingId, onTogglePlayback }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [bioDlg, setBioDlg] = useState(false)
  const [sortDlg, setSortDlg] = useState(false)
  const [reader, setReader] = useState(false)
  const [bio, setBio] = useState(null)
  const [cropFile, setCropFile] = useState(null)
  const [avaDlg, setAvaDlg] = useState(false)
  const [dgDlg, setDgDlg] = useState(false)
  const fileRef = useRef(null)
  const toast = useToast()

  const meta = useMemo(() =>
    (artists || []).find((a) => a.name === name) || {}, [artists, name])
  const [featured, setFeatured] = useState(null)

  useEffect(() => {
    let active = true
    api.artistTracks(name, { hidden: isAdmin && showHidden })
      .then((tracks) => { if (active) setFeatured(tracks) })
      .catch(() => { if (active) setFeatured([]) })
    return () => { active = false }
  }, [name, isAdmin, showHidden])

  const allMine = useMemo(() =>
    (albums || []).filter((a) => hasArtist(a, name)), [albums, name])
  const mine = useMemo(() => allMine.filter((a) =>
    !a.hidden || (isAdmin && showHidden)), [allMine, isAdmin, showHidden])
  const hiddenCount = useMemo(() => allMine.filter((a) => a.hidden).length
    + Math.max(0, (meta.featuredTrackCount || 0)
      - (meta.visibleFeaturedTrackCount || 0)), [allMine, meta])
  const totalDur = useMemo(() =>
    mine.reduce((s, a) => s + (a.duration || 0), 0)
      + (featured || []).reduce((s, track) => s + (track.duration || 0), 0),
  [mine, featured])
  const genres = useMemo(() => {
    const primary = new Map()
    const secondary = new Map()
    mine.forEach((a) => {
      ;(a.genres || []).forEach((genre) => {
        const value = genre.trim()
        if (!value) return
        const key = value.toLowerCase()
        if (!primary.has(key)) primary.set(key, value)
        secondary.delete(key)
      })
      ;(a.secondaryGenres || []).forEach((genre) => {
        const value = genre.trim()
        if (!value) return
        const key = value.toLowerCase()
        if (!primary.has(key) && !secondary.has(key)) secondary.set(key, value)
      })
    })
    return { primary: [...primary.values()], secondary: [...secondary.values()] }
  }, [mine])
  const note = meta.note || ''
  const hasBio = !!meta.hasBio
  const artistSort = preferredArtistSort(name, meta.sort)

  const openReader = async () => {
    if (bio === null) {
      try { setBio((await api.artistBio(name)).bio || '') }
      catch { setBio('') }
    }
    setReader(true)
  }

  const pickCover = async (a) => {
    try {
      // proxy=1 makes the Worker return bytes instead of redirecting to R2/Graph, avoiding cross-origin fetch failures.
      const r = await fetch(`${artUrl(a.id, 1000)}&proxy=1`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const blob = await r.blob()
      setCropFile(new File([blob], 'cover.jpg', { type: blob.type || 'image/jpeg' }))
      setAvaDlg(false)
    } catch (e) { toast(t('artistPage.coverFail', e.message), 'err') }
  }

  const uploadAvatar = async (blob) => {
    setBusy(true)
    try {
      const folder = allMine[0]?.folder || featured?.[0]?.folder
      const artistDir = folder ? folder.split('/').slice(0, -1).join('/') : ''
      if (!artistDir) throw new Error('no album folder')
      // Use a unique filename so overwriting the same path cannot confuse caches or storage reads.
      const stamp = Date.now().toString(36)
      const path = `${artistDir}/avatar-${stamp}.jpg`
       const uploaded = await api.uploadCover(path, blob)
       await api.putArtist(name, {
         avatarPath: path,
         avatarStorageId: uploaded.storageId || null,
       })
      toast(t('artistPage.avatarUpdated'), 'ok')
      onAvatarChanged()
    } catch (e) { toast(t('artistPage.avatarFail', e.message), 'err') }
    finally { setBusy(false) }
  }

  const playAlbum = useCallback(async (a) => {
    try {
      const detail = await api.album(a.id)
      if (detail.tracks?.length) onPlay(detail, detail.tracks)
    } catch (e) { toast(e.message, 'err') }
  }, [onPlay, toast])

  const playAll = async () => {
    try {
      const details = await Promise.all(mine.map((a) => api.album(a.id)))
      const all = details.flatMap((d) => (d.tracks || []).map((tr) => ({
        id: tr.id, title: tr.title, duration: tr.duration, format: tr.format,
        artist: tr.artist || d.artist, artists: tr.artists || d.artists,
        albumId: d.id, albumTitle: d.title,
      })))
      const combined = [...all, ...(featured || [])]
      if (combined.length) onPlay({ artist: name,
        artists: [{ name, sort: artistSort }] }, combined)
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <div className="artist-page">
      <button className="back-btn" onClick={goBack}>
        <I.back size={15} /> {t('common.back')}
      </button>
      <div className="artist-hero">
        <div className={`avatar ${isAdmin ? 'editable' : ''}`}
             onClick={() => isAdmin && setAvaDlg(true)}
             title={isAdmin ? t('artistPage.changeAvatar') : ''}>
          <img src={artistArtUrl(name,
            meta.hasAvatar ? `c${avatarVer || ''}` : avatarVer)} alt="" />
          {isAdmin && <span className="avatar-edit">
            {busy ? <I.spin size={16} /> : <I.edit size={16} />}</span>}
          <input ref={fileRef} type="file" accept="image/*" hidden
                 onChange={(e) => {
                   if (e.target.files[0]) setCropFile(e.target.files[0])
                   e.target.value = ''
                 }} />
        </div>
        <div className="artist-info">
          <div className="hero-artist">{t('artistPage.kicker')}</div>
          <h1 className="hero-title">{name}</h1>
          {(artistSort || isAdmin) && (
            <div className="artist-sort-row">
              {artistSort && <span className="artist-sort-name">{artistSort}</span>}
              {isAdmin && (
                <button className={`artist-sort-edit${artistSort ? '' : ' ghost'}`}
                        title={t('artistPage.editSort')}
                        onClick={() => setSortDlg(true)}>
                  {artistSort ? <I.edit size={11} /> : <I.plus size={11} />}
                  {artistSort ? t('common.edit') : t('artistPage.addSort')}
                </button>
              )}
            </div>
          )}
          <div className="hero-meta">
            {mine.length > 0 && <span>{t('count.albums', mine.length)}</span>}
            {mine.length > 0 && featured?.length > 0 && <span>·</span>}
            {featured?.length > 0 && <span>{t('count.tracks', featured.length)}</span>}
            {totalDur ? <><span>·</span><span>{fmtTotal(totalDur, t)}</span></> : null}
          </div>
          {(genres.primary.length > 0 || genres.secondary.length > 0) && (
            <div className="genre-row">
              {genres.primary.map((g) => (
                <span key={g} className="gtag link" onClick={() => onOpenGenre(g)}>
                  {g}</span>
              ))}
              {genres.secondary.map((g) => (
                <span key={g} className="gtag sec link" onClick={() => onOpenGenre(g)}>
                  {g}</span>
              ))}
            </div>
          )}
          {(note || hasBio || isAdmin) && (
            <div className="bio">
              {note && <Md text={note} className="bio-short" />}
              <div className="bio-actions">
                {hasBio && (
                  <button className="bio-read" onClick={openReader}>
                    {t('artistPage.readBio')} <I.chevR size={13} />
                  </button>
                )}
                {isAdmin && (
                  (note || hasBio)
                    ? <button className="note-edit" title={t('artistPage.editBio')}
                              onClick={() => setBioDlg(true)}>
                        <I.edit size={12} /> {t('common.edit')}
                      </button>
                    : <button className="note-edit ghost"
                              onClick={() => setBioDlg(true)}>
                        <I.plus size={12} /> {t('artistPage.addBio')}
                      </button>
                )}
              </div>
            </div>
          )}
          {(mine.length > 0 || featured?.length > 0) && (
            <div className="hero-actions">
              <button className="btn primary" onClick={playAll}>
                <I.play size={15} /> {t('common.playAll')}
              </button>
              {isAdmin && hiddenCount > 0 && (
                <VisibilityToggle compact on={showHidden}
                                  onToggle={() => setShowHidden((value) => !value)}
                                  label={t('library.showHidden')}
                                  count={hiddenCount} />
              )}
            </div>
          )}
          {mine.length === 0 && featured?.length === 0
              && isAdmin && hiddenCount > 0 && (
            <div className="hero-actions">
              <VisibilityToggle compact on={showHidden}
                                onToggle={() => setShowHidden((value) => !value)}
                                label={t('library.showHidden')}
                                count={hiddenCount} />
            </div>
          )}
        </div>
      </div>

      <div className="grid">
        {mine.length === 0 && featured?.length === 0 && (
          <div className="empty">
            <div className="big">{t('artistPage.emptyAlbums')}</div>
          </div>
        )}
        {mine.map((a, index) => (
          <AlbumCard key={a.id} a={a} onOpen={onOpen}
                     onOpenArtist={onOpenArtist} onPlay={playAlbum}
                     priority={isPriorityCover(index)}
                     currentAlbumId={currentAlbumId} playingId={playingId}
                     onTogglePlayback={onTogglePlayback} />
        ))}
      </div>

      {featured?.length > 0 && (
        <section className="artist-featured">
          <h2>{t('artistPage.featuredTracks')}</h2>
          <div className="flat-list">
            {featured.map((track, index) => (
              <TrackRow key={track.id} t={track} i={index}
                        currentId={currentId} playingId={playingId}
                        isAdmin={isAdmin} fav={favTracks?.has(track.id) || false}
                        onToggleFav={() => toggleFav?.('track', track.id)}
                        onPlay={(start) => onPlayTracks(featured, start)}
                        onOpen={onOpen} onOpenArtist={onOpenArtist} />
            ))}
          </div>
        </section>
      )}

      {bioDlg && (
        <BioDialog name={name} initialNote={note}
                   onClose={() => setBioDlg(false)}
                   onSaved={() => {
                     setBioDlg(false)
                     setBio(null)
                     onAvatarChanged()
                   }} />
      )}
      {sortDlg && (
        <ArtistSortDialog name={name} initialSort={meta.sort || ''}
                          onClose={() => setSortDlg(false)}
                          onSaved={() => {
                            setSortDlg(false)
                            onArtistChanged?.()
                          }} />
      )}
      {reader && (
        <Reader kicker={t('artistPage.kicker')} title={name}
                onClose={() => setReader(false)}>
          <Md text={bio || ''} />
        </Reader>
      )}
      {avaDlg && (
        <Dialog title={t('artistPage.changeAvatarTitle')} onClose={() => setAvaDlg(false)}>
          <button className="btn primary" style={{ width: '100%' }}
                  onClick={() => { setAvaDlg(false); fileRef.current?.click() }}>
            <I.upload size={15} /> {t('artistPage.uploadImage')}
          </button>
          <button className="btn" style={{ width: '100%', marginTop: 8 }}
                  onClick={() => { setAvaDlg(false); setDgDlg(true) }}>
            <I.disc size={15} /> {t('artistPage.fromDiscogs')}
          </button>
          {mine.length > 0 && (
            <>
              <div className="ava-src-label">{t('artistPage.pickFromAlbums')}</div>
              <div className="ava-pick-grid">
                {mine.map((a) => (
                  <img key={a.id} src={artUrl(a.id, 400)} alt={a.title}
                       title={a.title} loading="lazy"
                       onClick={() => pickCover(a)} />
                ))}
              </div>
            </>
          )}
        </Dialog>
      )}
      {dgDlg && (
        <ArtistDiscogsDialog name={name}
          onClose={() => setDgDlg(false)}
          onImported={() => { setDgDlg(false); onAvatarChanged() }} />
      )}
      {cropFile && (
        <CropDialog file={cropFile} title={t('artistPage.cropTitle')} round
                    onClose={() => setCropFile(null)}
                    onDone={(blob) => { setCropFile(null); uploadAvatar(blob) }} />
      )}
    </div>
  )
}
