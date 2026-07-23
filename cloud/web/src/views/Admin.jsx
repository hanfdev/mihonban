import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { I, useToast } from '../ui.jsx'
import { useI18n } from '../i18n.jsx'

const fmtAgo = (ts, t) => {
  if (!ts) return t('admin.never')
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 2) return t('admin.justNow')
  if (m < 60) return t('admin.minutesAgo', m)
  if (m < 2880) return t('admin.hoursAgo', Math.round(m / 60))
  return t('admin.daysAgo', Math.round(m / 1440))
}

function PasswordCard() {
  const { t } = useI18n()
  const [target, setTarget] = useState('user')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.changePassword(target, current, next)
      toast(t('admin.passwordUpdated', target === 'user' ? t('admin.user') : t('admin.adminRole')), 'ok')
      setCurrent(''); setNext('')
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy(false) }
  }

  return (
    <div className="panel">
      <h2>{t('admin.passwords')}</h2>
      <div className="hint">
        {t('admin.passwordsHint')}
      </div>
      <form onSubmit={submit} className="fields" style={{ maxWidth: 420 }}>
        <div className="frow"><label>{t('admin.whichPassword')}</label>
          <select className="tin" value={target}
                  onChange={(e) => setTarget(e.target.value)}>
            <option value="user">{t('admin.userPassword')}</option>
            <option value="admin">{t('admin.adminPassword')}</option>
          </select></div>
        <div className="frow"><label>{t('admin.adminPassword')}</label>
          <input className="tin" type="password" value={current} required
                 placeholder={t('admin.currentAdmin')}
                 onChange={(e) => setCurrent(e.target.value)} /></div>
        <div className="frow"><label>{t('admin.newPassword')}</label>
          <input className="tin" type="password" value={next} required
                 minLength={4} placeholder={t('admin.minChars')}
                 onChange={(e) => setNext(e.target.value)} /></div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn primary" disabled={busy}>
            {busy ? <I.spin /> : t('admin.updatePassword')}</button>
        </div>
      </form>
    </div>
  )
}

/* 云盘（OneDrive / Microsoft Graph）凭据：token 过期、换应用、换账号
   都在这里粘贴新值，立即生效。留空的项保持原值不变。 */
/* {t('admin.guest')}策略：普通用户是否需要口令。关 = 陌生人打开链接直接只读浏览。 */
function AccessCard() {
  const { t } = useI18n()
  const [open, setOpen] = useState(null) // null = 加载中
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    api.getSettings().then((st) => setOpen(!!st.guestOpen)).catch(() => setOpen(false))
  }, [])

  const toggle = async () => {
    const next = !open
    setBusy(true)
    try {
      await api.putSettings({ guestOpen: next })
      setOpen(next)
      toast(next ? t('admin.guestOn') : t('admin.guestOff'), 'ok')
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy(false) }
  }

  return (
    <div className="panel">
      <h2>{t('admin.guest')}</h2>
      <div className="hint">
        {t('admin.guestHint')}
      </div>
      <label className="switch-row">
        <span>
          <b>{open ? t('admin.guestOpen') : t('admin.guestClosed')}</b>
          <em>{open ? t('admin.guestOpenDesc') : t('admin.guestClosedDesc')}</em>
        </span>
        <button className={`toggle ${open ? 'on' : ''}`} disabled={open === null || busy}
                onClick={toggle} role="switch" aria-checked={!!open}>
          <i />
        </button>
      </label>
    </div>
  )
}

const PAGE = 50

/* Discogs：官方 API token，用于专辑页「Discogs」自动匹配风格 */
function DiscogsCard() {
  const { t } = useI18n()
  const [tok, setTok] = useState('')
  const [current, setCurrent] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => {
    let active = true
    api.getSettings().then((st) => {
      if (active) setCurrent(st.discogsToken || '')
    }).catch((e) => { if (active) toast(e.message, 'err') })
    return () => { active = false }
  }, [toast])

  const save = async () => {
    if (!tok.trim()) return
    setSaving(true)
    try {
      await api.putSettings({ discogsToken: tok.trim() })
      const st = await api.getSettings()
      setCurrent(st.discogsToken || '')
      setTok('')
      toast(t('admin.discogsSaved'), 'ok')
    } catch (e) { toast(e.message, 'err') }
    finally { setSaving(false) }
  }

  return (
    <div className="panel">
      <h2>{t('admin.discogs')}</h2>
      <div className="hint" style={{ marginBottom: 10 }}>
        {t('admin.discogsHint')}{current ? t('admin.discogsCurrent', current) : t('admin.discogsNone')}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <input className="tin" style={{ flex: 1 }} value={tok}
               placeholder={current ? t('admin.discogsPhNew') : t('admin.discogsPh')}
               onChange={(e) => setTok(e.target.value)} />
        <button className="btn primary" disabled={saving || !tok.trim()} onClick={save}>
          {saving ? <I.spin /> : t('common.save')}
        </button>
      </div>
    </div>
  )
}

function SourceCard() {
  const { t } = useI18n()
  const [s, setS] = useState(null)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState('') // '' | 'quick' | 'deep'
  // 帖子列表：状态 tab + 搜索 + 分页
  const [tab, setTab] = useState('new')
  const [pq, setPq] = useState('')
  const [posts, setPosts] = useState([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(false)
  const postsRequest = useRef(0)
  const toast = useToast()

  const loadPosts = useCallback(async (reset = true, offset = 0) => {
    const requestId = ++postsRequest.current
    setLoading(true)
    try {
      const r = await api.sourcePosts({
        status: tab === 'all' ? '' : tab, q: pq, limit: PAGE, offset,
      })
      if (requestId !== postsRequest.current) return
      setTotal(r.total); setCounts(r.counts || {})
      setPosts((old) => reset ? r.posts : [...old, ...r.posts])
    } catch (e) {
      if (requestId === postsRequest.current) toast(e.message, 'err')
    } finally {
      if (requestId === postsRequest.current) setLoading(false)
    }
  }, [tab, pq, toast])

  useEffect(() => {
    api.getSettings().then((st) => setS({
      sourceUrl: st.sourceUrl,
      passwords: (st.archivePasswords || []).join('\n'),
    })).catch((e) => {
      setS({ sourceUrl: '', passwords: '' })
      toast(e.message, 'err')
    })
  }, [toast])
  useEffect(() => {
    const timer = setTimeout(() => loadPosts(true, 0), pq ? 250 : 0)
    return () => {
      clearTimeout(timer)
      postsRequest.current++
    }
  }, [loadPosts, pq])

  if (!s) return <div className="panel"><h2>{t('admin.source')}</h2><div className="hint">{t('common.loading')}</div></div>

  const save = async () => {
    setSaving(true)
    try {
      await api.putSettings({
        sourceUrl: s.sourceUrl,
        archivePasswords: s.passwords.split('\n').map((x) => x.trim()).filter(Boolean),
      })
      toast(t('admin.settingsSaved'), 'ok')
    } catch (e) { toast(e.message, 'err') }
    finally { setSaving(false) }
  }

  const scan = async (deep) => {
    setScanning(deep ? 'deep' : 'quick')
    try {
      const r = await api.scanSource(deep)
      if (r.error) toast(t('admin.scanFail', r.error), 'err')
      else toast(deep
        ? t('admin.scanDeepDone', r.total, r.feedTotal, r.added)
        : t('admin.scanQuickDone', r.total, r.added), 'ok')
      await loadPosts(true, 0)
    } catch (e) {
      toast(t('admin.scanFail', e.message), 'err')
    } finally { setScanning('') }
  }

  const mark = async (id, status) => {
    const prev = posts.find((p) => p.id === id)?.status
    try {
      await api.setPostStatus(id, status)
      setPosts((current) => current.map((p) => p.id === id ? { ...p, status } : p))
      if (prev && prev !== status) {
        setCounts((c) => ({ ...c,
          [prev]: Math.max((c[prev] || 1) - 1, 0),
          [status]: (c[status] || 0) + 1 }))
      }
    } catch (e) { toast(e.message, 'err') }
  }

  const TABS = [
    ['new', t('admin.tabNew', counts.new ?? 0)],
    ['done', t('admin.tabDone', counts.done ?? 0)],
    ['ignored', t('admin.tabIgnored', counts.ignored ?? 0)],
    ['all', t('admin.tabAll')],
  ]

  return (
    <div className="panel">
      <h2>{t('admin.source')}</h2>
      <div className="hint">
        {t('admin.sourceHint')}
      </div>
      <div className="fields" style={{ maxWidth: 640 }}>
        <div className="frow"><label>{t('admin.sourceUrl')}</label>
          <input className="tin" value={s.sourceUrl}
                 placeholder={t('admin.sourceUrlPh')}
                 onChange={(e) => setS({ ...s, sourceUrl: e.target.value })} /></div>
        <div className="frow" style={{ alignItems: 'start' }}>
          <label style={{ paddingTop: 9 }}>{t('admin.archivePasswords')}</label>
          <textarea className="tin" rows={3} value={s.passwords}
                    placeholder={t('admin.archivePasswordsPh')}
                    onChange={(e) => setS({ ...s, passwords: e.target.value })} /></div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => scan(true)} disabled={!!scanning}
                  title={t('admin.deepScanTitle')}>
            {scanning === 'deep' ? <><I.spin /> {t('admin.deepScanning')}</> : t('admin.deepScan')}</button>
          <button className="btn" onClick={() => scan(false)} disabled={!!scanning}>
            {scanning === 'quick' ? <I.spin /> : t('admin.quickScan')}</button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? <I.spin /> : t('admin.saveSettings')}</button>
        </div>
      </div>

      <div className="post-tools">
        <div className="seg">
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''}
                    onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <div className="search sm">
          <I.search size={13} />
          <input placeholder={t('admin.searchPosts')} value={pq}
                 onChange={(e) => setPq(e.target.value)} />
          {pq && <I.x size={12} style={{ cursor: 'pointer' }} onClick={() => setPq('')} />}
        </div>
      </div>

      <div className={`post-list ${tab !== 'new' && tab !== 'all' ? 'dim' : ''}`}>
        {posts.map((p) => (
          <div key={p.id} className="post-row">
            <a href={p.url} target="_blank" rel="noreferrer" className="post-title">
              {p.title} <I.ext size={11} /></a>
            <span className="post-date">{p.published}</span>
            {p.status === 'new' ? <>
              <button className="btn sm" onClick={() => mark(p.id, 'done')}>{t('admin.markDone')}</button>
              <button className="btn sm" onClick={() => mark(p.id, 'ignored')}>{t('admin.markIgnore')}</button>
            </> : <>
              <span className="post-date">{p.status === 'done' ? t('admin.statusDone') : t('admin.statusIgnored')}</span>
              <button className="btn sm" onClick={() => mark(p.id, 'new')}>{t('admin.markRestore')}</button>
            </>}
          </div>
        ))}
        {!loading && posts.length === 0 && (
          <div className="hint" style={{ padding: '14px 10px' }}>
            {pq ? t('admin.noPostsQ') : t('admin.noPosts')}
          </div>
        )}
      </div>
      {posts.length < total && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button className="btn sm" disabled={loading}
                  onClick={() => loadPosts(false, posts.length)}>
            {loading ? <I.spin size={13} /> : t('admin.loadMore', posts.length, total)}
          </button>
        </div>
      )}
    </div>
  )
}

/* 可插拔模块开关：Cloudflare 资源站扫描 / 音源代理等可选工作流。 */
function ModulesCard({ modSource, streamProxy, streamProxyUrl, onChange }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [proxyUrl, setProxyUrl] = useState(streamProxyUrl || '')
  const toast = useToast()

  useEffect(() => { setProxyUrl(streamProxyUrl || '') }, [streamProxyUrl])

  const toggle = async (key, val) => {
    setBusy(true)
    try {
      await api.putSettings({ [key]: val })
      onChange(key, val)
      toast(val ? t('admin.moduleOn') : t('admin.moduleOff'), 'ok')
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy(false) }
  }

  const saveProxyUrl = async () => {
    setBusy(true)
    try {
      await api.putSettings({ streamProxyUrl: proxyUrl.trim() })
      onChange('streamProxyUrl', proxyUrl.trim())
      toast(t('admin.proxyUrlSaved'), 'ok')
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy(false) }
  }

  return (
    <div className="panel">
      <h2>{t('admin.modules')}</h2>
      <div className="hint">
        {t('admin.modulesHint')}
      </div>
      <label className="switch-row">
        <span>
          <b>{t('admin.moduleSource')}</b>
          <em>{t('admin.moduleSourceDesc')}</em>
        </span>
        <button className={`toggle ${modSource ? 'on' : ''}`} disabled={busy}
                onClick={() => toggle('moduleSource', !modSource)}
                role="switch" aria-checked={modSource}>
          <i />
        </button>
      </label>
      <label className="switch-row">
        <span>
          <b>{t('admin.streamProxy')}</b>
          <em>{t('admin.streamProxyDesc')}</em>
        </span>
        <button className={`toggle ${streamProxy ? 'on' : ''}`} disabled={busy}
                onClick={() => toggle('streamProxy', !streamProxy)}
                role="switch" aria-checked={streamProxy}>
          <i />
        </button>
      </label>
      {streamProxy && (
        <div className="fields" style={{ maxWidth: 640, marginTop: 10 }}>
          <div className="hint" style={{ marginBottom: 8 }}>{t('admin.streamProxyUrlHint')}</div>
          <div className="frow">
            <label>{t('admin.streamProxyUrl')}</label>
            <input className="tin mono" value={proxyUrl}
                   placeholder={t('admin.streamProxyUrlPh')}
                   onChange={(e) => setProxyUrl(e.target.value)} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn primary" disabled={busy} onClick={saveProxyUrl}>
              {busy ? <I.spin /> : t('common.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* R2 图床（Cloudflare）：封面/图片优先走 CDN，回退 OneDrive。凭据后台可改。
   预热按钮把存量封面批量镜像到 R2。 */
function R2Card() {
  const { t } = useI18n()
  const [cur, setCur] = useState(null)
  const [f, setF] = useState({ accessKey: '', secretKey: '', endpoint: '', bucket: '', publicUrl: '' })
  const [busy, setBusy] = useState('')
  const [test, setTest] = useState(null)
  const [warm, setWarm] = useState(null) // { processed, total, done } 或 null
  const toast = useToast()

  const load = () => api.getR2().then(setCur).catch(() => {})
  useEffect(() => { load() }, [])

  const save = async () => {
    setBusy('save')
    try {
      // 空字符串的密钥项不提交（保持不变）；其余（含 endpoint/bucket/url）照传
      const payload = {}
      for (const k of ['accessKey', 'secretKey']) if (f[k].trim()) payload[k] = f[k].trim()
      for (const k of ['endpoint', 'bucket', 'publicUrl']) payload[k] = f[k]
      await api.putR2(payload)
      setF({ accessKey: '', secretKey: '', endpoint: '', bucket: '', publicUrl: '' })
      await load()
      toast(t('admin.r2Saved'), 'ok')
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy('') }
  }

  const toggleEnabled = async () => {
    setBusy('toggle')
    try { await api.putR2({ enabled: !cur.enabled }); await load() }
    catch (e) { toast(e.message, 'err') }
    finally { setBusy('') }
  }

  const runTest = async () => {
    setBusy('test'); setTest(null)
    try { setTest(await api.testR2()) }
    catch (e) { setTest({ ok: false, error: e.message }) }
    finally { setBusy('') }
  }

  const prewarm = async () => {
    setBusy('warm'); setWarm({ processed: 0, total: 0, done: 0 })
    try {
      let offset = 0, total = 0, done = 0, skipped = 0
      for (;;) {
        const r = await api.prewarmR2(offset, 6)
        total = r.total; done += r.done; skipped += (r.skipped || 0); offset = r.processed
        setWarm({ processed: offset, total, done })
        if (r.finished) break
      }
      await load()
      toast(t('admin.r2WarmDone', done, skipped), 'ok')
    } catch (e) { toast(t('admin.r2WarmFail', e.message), 'err') }
    finally { setBusy(''); setWarm(null) }
  }

  // 用 f 有值就显示 f，否则显示当前脱敏值作 placeholder
  const F = [
    ['accessKey', t('admin.accessKey'), true],
    ['secretKey', t('admin.secretKey'), true],
    ['endpoint', t('admin.endpoint'), false],
    ['bucket', t('admin.bucket'), false],
    ['publicUrl', t('admin.publicUrl'), false],
  ]

  return (
    <div className="panel">
      <h2>{t('admin.r2')}</h2>
      <div className="hint">
        {t('admin.r2Hint')}
      </div>

      {cur && (
        <label className="switch-row" style={{ marginBottom: 8 }}>
          <span>
            <b>{cur.enabled ? (cur.ready ? t('admin.r2On') : t('admin.r2OnPartial')) : t('admin.r2Off')}</b>
            <em>{cur.ready ? t('admin.r2Mirrored', cur.mirrored) : t('admin.r2NeedConfig')}</em>
          </span>
          <button className={`toggle ${cur.enabled ? 'on' : ''}`} disabled={!!busy}
                  onClick={toggleEnabled} role="switch" aria-checked={cur.enabled}>
            <i />
          </button>
        </label>
      )}

      <div className="fields" style={{ maxWidth: 640 }}>
        {F.map(([k, label, secret]) => (
          <div className="frow" key={k}>
            <label>{label}</label>
            <input className="tin mono" value={f[k]}
                   placeholder={cur ? (secret ? (cur[k] || t('admin.emptyKeep'))
                     : (cur[k] || t('admin.emptyKeep'))) : ''}
                   onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          {test && (test.ok
            ? <span style={{ color: '#7fbf7f', fontSize: 13 }}>✓ {t('admin.testOk')}</span>
            : <span style={{ color: '#ff8b7a', fontSize: 13 }}>✗ {test.error}</span>)}
          <button className="btn" onClick={runTest} disabled={!!busy}>
            {busy === 'test' ? <I.spin /> : t('admin.testConn')}</button>
          <button className="btn primary" onClick={save} disabled={!!busy}>
            {busy === 'save' ? <I.spin /> : t('admin.saveConfig')}</button>
        </div>
        {cur?.ready && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', marginTop: 4 }}>
            {warm && <span style={{ color: 'var(--ink-faint)', fontSize: 12.5 }}>
              {t('admin.r2Warming', warm.processed, warm.total)}</span>}
            <button className="btn" onClick={prewarm} disabled={!!busy}>
              {busy === 'warm' ? <I.spin /> : t('admin.r2Warm')}</button>
          </div>
        )}
      </div>
    </div>
  )
}

/* 通用存储后端：OneDrive / WebDAV / Google Drive / Node 本地盘一律是命名后端。 */
const emptyOd = () => ({ clientId: '', clientSecret: '', refreshToken: '', driveId: '' })
const emptyWd = () => ({ baseUrl: '', username: '', password: '' })
const emptyGd = () => ({ clientId: '', clientSecret: '', refreshToken: '', rootId: 'root' })
const emptyLocal = () => ({ root: '', odRoot: 'Music/Library' })
const emptyCfg = (kind) =>
  kind === 'webdav' ? emptyWd()
    : kind === 'gdrive' ? emptyGd()
    : kind === 'local' ? emptyLocal()
    : emptyOd()

function StorageBackendsCard() {
  const { t } = useI18n()
  const KIND_LABEL = {
    onedrive: t('admin.kindOd'), webdav: t('admin.kindWd'),
    gdrive: t('admin.kindGd'), local: t('admin.kindLocal'),
  }
  const [data, setData] = useState(null) // { storages }
  const [busy, setBusy] = useState('')
  const [test, setTest] = useState(null)
  const [addKind, setAddKind] = useState('') // '' | 'onedrive' | 'webdav' | 'gdrive' | 'local'
  const [name, setName] = useState('')
  const [cfg, setCfg] = useState(emptyOd())
  const [gdCode, setGdCode] = useState('')
  const [gdAuthUrl, setGdAuthUrl] = useState('')
  const [mig, setMig] = useState(null) // 单张 or 整库进度
  const [albums, setAlbums] = useState(null)
  const [bulkTarget, setBulkTarget] = useState('')
  const [editId, setEditId] = useState(null)
  const [editCfg, setEditCfg] = useState({})
  const toast = useToast()

  const load = useCallback(() => {
    api.listStorages().then(setData).catch(() => setData({ storages: [] }))
  }, [])
  useEffect(() => { load() }, [load])

  const writeId = data?.storages?.find((s) => s.isWrite)?.id || null

  const fieldsFor = (kind) => {
    if (kind === 'webdav') return [
      ['baseUrl', t('admin.fieldBaseUrl'), t('admin.phBaseUrl')],
      ['username', t('admin.fieldUsername'), ''],
      ['password', t('admin.fieldPassword'), t('admin.emptyKeep')],
    ]
    if (kind === 'gdrive') return [
      ['clientId', t('admin.fieldClientId'), t('admin.phClientIdGoogle')],
      ['clientSecret', t('admin.fieldClientSecret'), t('admin.emptyKeep')],
      ['refreshToken', t('admin.fieldRefreshToken'), t('admin.emptyKeep')],
      ['rootId', t('admin.fieldRootId'), t('admin.phRootId')],
    ]
    if (kind === 'local') return [
      ['root', t('admin.fieldLocalRoot'), t('admin.phLocalRoot')],
      ['odRoot', t('admin.fieldOdRoot'), 'Music/Library'],
    ]
    return [
      ['clientId', t('admin.fieldClientId'), t('admin.phClientIdAzure')],
      ['clientSecret', t('admin.fieldClientSecret'), t('admin.emptyKeep')],
      ['refreshToken', t('admin.fieldRefreshToken'), t('admin.emptyKeep')],
      ['driveId', t('admin.fieldDriveId'), t('admin.phDriveId')],
    ]
  }

  const openEditStorage = (s) => {
    setEditId(s.id)
    const next = emptyCfg(s.kind)
    if (s.kind === 'webdav') {
      next.baseUrl = s.config?.baseUrl || ''
      next.username = s.config?.username || ''
    } else if (s.kind === 'local') {
      next.root = s.config?.root || ''
      next.odRoot = s.config?.odRoot || 'Music/Library'
    } else if (s.kind === 'onedrive') {
      next.driveId = s.config?.driveId || ''
    } else if (s.kind === 'gdrive') {
      next.clientId = s.config?.clientId || ''
      next.rootId = s.config?.rootId || 'root'
    }
    setEditCfg(next)
    setAddKind('')
  }
  const saveEdit = async () => {
    setBusy('edit')
    try {
      const payload = {}
      for (const [k, v] of Object.entries(editCfg)) {
        if (typeof v === 'string' && v.trim()) payload[k] = v.trim()
      }
      if (!Object.keys(payload).length) {
        toast(t('admin.noUpdate'), 'err'); setBusy(''); return
      }
      await api.putStorageBackend(editId, { config: payload })
      toast(t('admin.backendUpdated'), 'ok')
      setEditId(null)
      load()
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy('') }
  }
  const saveNew = async () => {
    if (!name.trim()) { toast(t('admin.needName'), 'err'); return }
    if (addKind === 'gdrive' && !cfg.refreshToken) {
      toast(t('admin.needGdriveToken'), 'err'); return
    }
    setBusy('add')
    try {
      const res = await api.testStorageBackend({ kind: addKind, config: cfg })
      if (!res.ok) { toast(t('admin.connectFail', res.error), 'err'); setBusy(''); return }
      await api.addStorage({ name: name.trim(), kind: addKind, config: cfg })
      setAddKind(''); setName(''); setCfg(emptyOd())
      setGdCode(''); setGdAuthUrl(''); setTest(null)
      load()
      toast(t('admin.backendAdded'), 'ok')
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy('') }
  }

  const setWrite = async (id) => {
    setBusy('write')
    try {
      await api.setWriteTarget(id)
      load()
      toast(t('admin.writeSet'), 'ok')
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy('') }
  }

  const remove = async (s) => {
    if (!confirm(t('admin.deleteConfirm', s.name))) return
    setBusy('del')
    try {
      await api.deleteStorageBackend(s.id)
      load(); toast(t('admin.deleted'), 'ok')
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy('') }
  }

  const runTest = async (s) => {
    setBusy(`t:${s.id}`); setTest(null)
    try {
      const r = await api.testStorageBackend({ id: s.id })
      setTest({ id: s.id, ...r })
    } catch (e) { setTest({ id: s.id, ok: false, error: e.message }) }
    finally { setBusy('') }
  }

  const startMigrate = async (albumId, targetId) => {
    setBusy('mig'); setMig({ mode: 'one', albumId, targetId, fileIndex: 0, total: 0, file: '' })
    try {
      let fileIndex = 0
      for (;;) {
        const r = await api.migrateAlbum(albumId, targetId, fileIndex)
        if (r.finished) {
          toast(t('admin.migrateDone'), 'ok')
          setMig(null); load()
          if (albums) setAlbums(await api.library())
          break
        }
        fileIndex = r.fileIndex
        setMig({ mode: 'one', albumId, targetId, fileIndex, total: r.total, file: r.file || '' })
      }
    } catch (e) {
      toast(t('admin.migrateFail', e.message), 'err')
      setMig(null)
    } finally { setBusy('') }
  }

  const startBulkMigrate = async (targetId) => {
    const label = data?.storages?.find((s) => s.id === targetId)?.name || targetId
    if (!confirm(t('admin.bulkConfirm', label))) return
    setBusy('bulk')
    setMig({ mode: 'bulk', albumOffset: 0, fileIndex: 0, totalAlbums: 0,
             doneAlbums: 0, artist: '', title: '', file: '', total: 0 })
    try {
      let albumOffset = 0, fileIndex = 0
      for (;;) {
        const r = await api.migrateAll(targetId, albumOffset, fileIndex)
        if (r.finished) {
          toast(t('admin.bulkDone', r.doneAlbums ?? r.totalAlbums), 'ok')
          setMig(null); load()
          if (albums) setAlbums(await api.library())
          break
        }
        if (r.albumFinished) {
          albumOffset = r.albumOffset
          fileIndex = 0
        } else {
          albumOffset = r.albumOffset
          fileIndex = r.fileIndex
        }
        setMig({
          mode: 'bulk',
          albumOffset, fileIndex,
          totalAlbums: r.totalAlbums,
          doneAlbums: r.doneAlbums,
          artist: r.artist || '', title: r.title || '',
          file: r.file || '', total: r.total || 0,
        })
      }
    } catch (e) {
      toast(t('admin.bulkFail', e.message), 'err')
      setMig(null)
    } finally { setBusy('') }
  }

  const openMigrate = async () => {
    if (!albums) {
      try { setAlbums(await api.library()) }
      catch (e) { toast(e.message, 'err') }
    }
  }

  const genGdAuth = async () => {
    if (!cfg.clientId) { toast(t('admin.fieldClientId'), 'err'); return }
    setBusy('gdauth')
    try {
      const r = await api.gdriveAuthUrl(cfg.clientId)
      setGdAuthUrl(r.url)
      toast(t('admin.authLinkReady'), 'ok')
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy('') }
  }

  const exchangeGd = async () => {
    if (!cfg.clientId || !cfg.clientSecret || !gdCode.trim()) {
      toast(t('admin.needGdriveToken'), 'err'); return
    }
    setBusy('gdex')
    try {
      const r = await api.gdriveExchange({
        clientId: cfg.clientId, clientSecret: cfg.clientSecret, code: gdCode.trim(),
      })
      setCfg({ ...cfg, refreshToken: r.refreshToken })
      toast(t('admin.tokenGot', (r.refreshToken || '').slice(0, 8)), 'ok')
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy('') }
  }

  const editForm = (kind, title) => (
    <div className="fields stor-edit" style={{ maxWidth: 640, margin: '0 0 12px',
      padding: '12px 14px', background: 'var(--bg0)', borderRadius: 10,
      border: '1px solid var(--line-soft)' }}>
      <div className="dg-group" style={{ marginBottom: 6 }}>{title}</div>
      <div className="hint" style={{ marginBottom: 8 }}>{t('admin.editHint')}</div>
      {fieldsFor(kind).map(([k, label, ph]) => (
        <div className="frow" key={k}>
          <label>{label}</label>
          <input className="tin mono" value={editCfg[k] || ''}
                 placeholder={ph || t('admin.emptyKeep')}
                 onChange={(e) => setEditCfg({ ...editCfg, [k]: e.target.value })} />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => setEditId(null)}>{t('admin.cancel')}</button>
        <button className="btn primary" disabled={!!busy} onClick={saveEdit}>
          {busy === 'edit' ? <I.spin /> : t('common.save')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="panel">
      <h2>{t('admin.storageBackends')}</h2>
      <div className="hint">
        {t('admin.storageBackendsHint')}
      </div>

      {!data ? <div className="hint">{t('common.loading')}</div> : (
        <div className="stor-list">
          {data.storages.map((s) => (
            <div key={s.id}>
              <div className={`stor-row ${s.isWrite ? 'write' : ''}`}>
                <div className="stor-main">
                  <b>{s.name}</b>
                  <span className="stor-meta">
                    {KIND_LABEL[s.kind] || s.kind} · {t('admin.albumsN', s.albums)}
                    {s.isWrite && ` · ${t('admin.writeTarget')}`}
                  </span>
                  {test?.id === s.id && (
                    <span style={{ fontSize: 12.5, color: test.ok ? '#7fbf7f' : '#ff8b7a' }}>
                      {test.ok
                        ? `✓ ${t('admin.testOk')}${test.owner ? ` · ${test.owner}` : ''}${test.total
                          ? ` · ${(test.used / 1073741824).toFixed(0)}G / ${(test.total / 1073741824).toFixed(0)}G`
                          : ''}`
                        : `✗ ${test.error}`}
                    </span>
                  )}
                </div>
                <div className="stor-actions">
                  <button className="btn sm" disabled={!!busy}
                          onClick={() => runTest(s)}>
                    {busy === `t:${s.id}` ? <I.spin size={13} /> : t('admin.test')}</button>
                  <button className="btn sm" disabled={!!busy}
                          onClick={() => openEditStorage(s)}>{t('common.edit')}</button>
                  {!s.isWrite && (
                    <button className="btn sm" disabled={!!busy}
                            onClick={() => setWrite(s.id)}>{t('admin.setWrite')}</button>
                  )}
                  {s.isWrite && <span className="stor-badge">{t('admin.writing')}</span>}
                  <button className="btn sm danger" disabled={!!busy || s.albums > 0}
                          title={s.albums > 0 ? t('admin.deleteBackendNeedMove') : t('admin.deleteBackend')}
                          onClick={() => remove(s)}>{t('admin.deleteBackend')}</button>
                </div>
              </div>
              {editId === s.id && editForm(s.kind, t('admin.editBackend', s.name))}
            </div>
          ))}
        </div>
      )}

      {!addKind ? (
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => { setAddKind('local'); setCfg(emptyLocal()); setName(t('admin.kindLocal')); setEditId(null) }}>
            {t('admin.addLocal')}</button>
          <button className="btn" onClick={() => { setAddKind('onedrive'); setCfg(emptyOd()); setName(''); setEditId(null) }}>
            {t('admin.addOneDrive')}</button>
          <button className="btn" onClick={() => { setAddKind('webdav'); setCfg(emptyWd()); setName(''); setEditId(null) }}>
            {t('admin.addWebDAV')}</button>
          <button className="btn" onClick={() => { setAddKind('gdrive'); setCfg(emptyGd()); setName(''); setGdCode(''); setGdAuthUrl(''); setEditId(null) }}>
            {t('admin.addGDrive')}</button>
          <button className="btn" onClick={openMigrate}>{t('admin.migrateAlbums')}</button>
        </div>
      ) : (
        <div className="fields" style={{ maxWidth: 640, marginTop: 14 }}>
          <div className="hint" style={{ marginBottom: 8 }}>
            {t('admin.addKind', KIND_LABEL[addKind])}
            {addKind === 'onedrive' && t('admin.odHint')}
            {addKind === 'webdav' && t('admin.wdHint')}
            {addKind === 'gdrive' && t('admin.gdHint')}
            {addKind === 'local' && t('admin.localHint')}
            {!data?.storages?.length && (
              <div style={{ marginTop: 6, color: 'var(--gold)' }}>{t('admin.firstBackendHint')}</div>
            )}
          </div>
          <div className="frow"><label>{t('admin.displayName')}</label>
            <input className="tin" value={name} placeholder={t('admin.displayNamePh')}
                   onChange={(e) => setName(e.target.value)} /></div>
          {fieldsFor(addKind).map(([k, label, ph]) => (
            <div className="frow" key={k}>
              <label>{label}</label>
              <input className="tin mono" value={cfg[k] || ''}
                     placeholder={ph}
                     onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
            </div>
          ))}
          {addKind === 'gdrive' && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn sm" disabled={!!busy || !cfg.clientId} onClick={genGdAuth}>
                  {busy === 'gdauth' ? <I.spin size={13} /> : t('admin.genAuth')}
                </button>
                {gdAuthUrl && (
                  <a className="btn sm" href={gdAuthUrl} target="_blank" rel="noreferrer">
                    {t('admin.openAuth')} <I.ext size={11} /></a>
                )}
              </div>
              <div className="frow"><label>{t('admin.authCode')}</label>
                <input className="tin mono" value={gdCode}
                       placeholder={t('admin.authCodePh')}
                       onChange={(e) => setGdCode(e.target.value)} /></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn sm" disabled={!!busy || !gdCode.trim()}
                        onClick={exchangeGd}>
                  {busy === 'gdex' ? <I.spin size={13} /> : t('admin.exchangeToken')}
                </button>
                {cfg.refreshToken && (
                  <span style={{ color: '#7fbf7f', fontSize: 12.5, alignSelf: 'center' }}>
                    {t('admin.tokenGot', cfg.refreshToken.slice(0, 8))}
                  </span>
                )}
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setAddKind('')}>{t('admin.cancel')}</button>
            <button className="btn primary" disabled={!!busy} onClick={saveNew}>
              {busy === 'add' ? <I.spin /> : t('admin.testAndAdd')}</button>
          </div>
        </div>
      )}

      {/* 整库一键迁移 */}
      {data && data.storages.length > 0 && (
        <div className="stor-bulk" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          <div className="dg-group" style={{ marginBottom: 8 }}>{t('admin.bulkTitle')}</div>
          <div className="hint" style={{ marginBottom: 10 }}>
            {t('admin.bulkHint')}
            {mig?.mode === 'bulk' && (
              <> {t('admin.bulkProgress', mig.doneAlbums, mig.totalAlbums,
                mig.title ? `${mig.artist} — ${mig.title}` : '',
                mig.file ? `${mig.fileIndex}/${mig.total} ${mig.file}` : '')}</>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="tin" style={{ width: 200 }} value={bulkTarget}
                    onChange={(e) => setBulkTarget(e.target.value)}
                    disabled={!!busy}>
              <option value="">{t('admin.pickTarget')}</option>
              {data.storages.map((s) =>
                <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn primary" disabled={!!busy || !bulkTarget}
                    onClick={() => startBulkMigrate(bulkTarget)}>
              {busy === 'bulk' ? <I.spin /> : t('admin.startBulk')}
            </button>
          </div>
        </div>
      )}

      {/* {t('admin.oneMigrate')}面板 */}
      {albums && (
        <div className="stor-migrate">
          <div className="dg-group" style={{ marginBottom: 8 }}>
            {t('admin.oneMigrate')}
            <button className="btn sm" style={{ marginLeft: 10 }}
                    onClick={() => setAlbums(null)}>{t('admin.collapse')}</button>
          </div>
          <div className="hint" style={{ marginBottom: 10 }}>
            {t('admin.oneHint')}
            {mig?.mode === 'one' && ` ${t('admin.oneProgress', mig.fileIndex, mig.total, mig.file || '')}`}
          </div>
          <div className="stor-mig-list">
            {albums.map((a) => {
              const cur = a.storageId || null
              const label = data?.storages?.find((s) => s.id === cur)?.name
                || cur || t('admin.unassignedStorage')
              return (
                <div key={a.id} className="stor-mig-row">
                  <span className="stor-mig-title">{a.artist} — {a.title}</span>
                  <span className="stor-mig-cur">{label}</span>
                  <select className="tin" style={{ width: 160 }}
                          defaultValue=""
                          disabled={!!busy}
                          onChange={(e) => {
                            const v = e.target.value
                            if (!v) return
                            const target = v
                            if ((cur || null) === target) return
                            startMigrate(a.id, target)
                            e.target.value = ''
                          }}>
                    <option value="">{t('admin.migrateTo')}</option>
                    {data?.storages?.filter((s) => s.id !== cur).map((s) =>
                      <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* 配置备份：导出 / 导入 OneDrive + R2 + 存储后端等设置，便于重新部署后一键还原。 */
function ConfigBackupCard() {
  const { t } = useI18n()
  const [busy, setBusy] = useState('')
  const toast = useToast()
  const fileRef = useRef(null)

  const doExport = async () => {
    setBusy('export')
    try {
      const data = await api.exportConfig()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      const href = URL.createObjectURL(blob)
      a.href = href
      a.download = `mihonban-config-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 0)
      toast(t('admin.configExportOk'), 'ok')
    } catch (e) { toast(e.message, 'err') }
    finally { setBusy('') }
  }

  const doImport = async (file) => {
    if (!file) return
    setBusy('import')
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      if (!confirm(t('admin.configImportConfirm'))) { setBusy(''); return }
      const r = await api.importConfig(json)
      toast(t('admin.configImportOk', r.importedSettings, r.importedStorages), 'ok')
    } catch (e) { toast(e.message || t('admin.configImportFail'), 'err') }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div className="panel">
      <h2>{t('admin.configBackup')}</h2>
      <div className="hint">{t('admin.configBackupHint')}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
        <button className="btn primary" disabled={!!busy} onClick={doExport}>
          {busy === 'export' ? <I.spin /> : t('admin.configExport')}
        </button>
        <button className="btn" disabled={!!busy} onClick={() => fileRef.current?.click()}>
          {busy === 'import' ? <I.spin /> : t('admin.configImport')}
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden
               onChange={(e) => doImport(e.target.files?.[0])} />
      </div>
    </div>
  )
}

export default function AdminPage({ onOpen }) {
  const { t } = useI18n()
  const [ov, setOv] = useState(null)
  const [ovError, setOvError] = useState('')
  const [mods, setMods] = useState(null) // { moduleSource, streamProxy }
  useEffect(() => {
    let active = true
    api.adminOverview().then((next) => { if (active) setOv(next) })
      .catch((e) => { if (active) setOvError(e.message) })
    api.getSettings().then((s) => {
      if (!active) return
      setMods({
        moduleSource: !!s.moduleSource,
        streamProxy: !!s.streamProxy,
        streamProxyUrl: s.streamProxyUrl || '',
      })
    }).catch(() => {
      if (active) setMods({ moduleSource: false, streamProxy: false, streamProxyUrl: '' })
    })
    return () => { active = false }
  }, [])

  const modSource = !!mods?.moduleSource
  const streamProxy = !!mods?.streamProxy
  const streamProxyUrl = mods?.streamProxyUrl || ''
  const setMod = (key, val) => setMods((m) => ({ ...m, [key]: val }))

  return (
    <div className="import-wrap">
      <div className="panel">
        <h2>{t('admin.status')}</h2>
        {ov ? (
          <div className="stat-row">
            <div className="stat"><b>{ov.albums}</b><span>{t('admin.albums')}</span></div>
            <div className="stat"><b>{ov.tracks}</b><span>{t('admin.tracks')}</span></div>
            <div className="stat"><b>{(ov.bytes / 1073741824).toFixed(1)}G</b><span>{t('admin.storageUsed')}</span></div>
            <div className="stat"><b>{fmtAgo(ov.companionLastSeen, t)}</b><span>{t('admin.companion')}</span></div>
            {modSource && <>
              <div className="stat"><b>{ov.newPosts}</b><span>{t('admin.newPosts')}</span></div>
              <div className="stat"><b>{fmtAgo(ov.sourceLastScan, t)}</b><span>{t('admin.lastScan')}</span></div>
            </>}
          </div>
        ) : <div className="hint">{ovError || t('common.loading')}</div>}
        {modSource && ov?.sourceLastError &&
          <div style={{ color: '#ff8b7a', fontSize: 13, marginTop: 10 }}>
            {ov.sourceLastError}</div>}
        <div className="hint" style={{ marginTop: 12 }}>
          {modSource ? t('admin.statusHintSource') : t('admin.statusHint')}
        </div>
      </div>
      <PasswordCard />
      <AccessCard />
      <ConfigBackupCard />
      <StorageBackendsCard />
      <R2Card />
      <DiscogsCard />
      {mods && <ModulesCard modSource={modSource} streamProxy={streamProxy}
        streamProxyUrl={streamProxyUrl} onChange={setMod} />}
      {modSource && <SourceCard />}
    </div>
  )
}
