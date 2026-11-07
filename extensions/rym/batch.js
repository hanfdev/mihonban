import { BatchRunner, canonicalUrl, counts, createJob, failure, isStale, JOB_KEY, reconcileJob } from './batch-core.js'
import { batchMessages } from './batch-translations.js'

const locale = navigator.language.toLowerCase()
const lang = locale.startsWith('zh') ? /tw|hk|hant/.test(locale) ? 'zh-Hant' : 'zh-Hans' : locale.split('-')[0]
const t = batchMessages[lang] || batchMessages.en
const $ = id => document.getElementById(id)
document.documentElement.lang = lang
for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = t[e.dataset.i18n]
$('query').placeholder = t.search; $('query').setAttribute('aria-label', t.search)
$('scope').setAttribute('aria-label', t.scope)
const hosts = { origins: ['https://rateyourmusic.com/*', 'https://www.rateyourmusic.com/*'] }
let libraryTab = Number(new URL(location.href).searchParams.get('libraryTab'))
let origin = '', rows = [], selected = new Set(), job = null, runner = null, sourceTab = null, working = false
const fmt = n => n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })
const elem = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e }
const note = code => { $('notice').textContent = t[code] || t.problem }
const validOrigin = value => {
  const u = new URL(value)
  if (u.username || u.password || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) throw failure('library')
  return u.origin
}

async function api(method, path, body) {
  let results
  try {
    results = await chrome.scripting.executeScript({ target: { tabId: libraryTab },
      func: async (expected, method, path, body) => {
        if (location.origin !== expected) return { ok: false, code: 'library' }
        try {
          const r = await fetch(path, { method, credentials: 'same-origin', redirect: 'error',
            headers: body ? { 'Content-Type': 'application/json' } : {},
            ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) })
          const data = await r.json().catch(() => ({}))
          return { ok: r.ok, data, code: [401, 403].includes(r.status) ? 'auth' : data.code || 'problem' }
        } catch { return { ok: false, code: 'problem' } }
      }, args: [origin, method, path, body || null] })
  } catch { throw failure('library') }
  const result = results?.[0]?.result
  if (!result?.ok) throw failure(result?.code || 'library')
  return result.data
}

function drawChoices() {
  const query = $('query').value.trim().toLocaleLowerCase()
  const visible = rows.filter(row => canonicalUrl(row.rymUrl) && ($('scope').value === 'all' || isStale(row))
    && `${row.title} ${row.artist}`.toLocaleLowerCase().includes(query))
  $('choices').replaceChildren(...visible.map(row => {
    const label = elem('label', 'record'), box = document.createElement('input')
    box.type = 'checkbox'; box.checked = selected.has(row.id)
    box.onchange = () => { box.checked ? selected.add(row.id) : selected.delete(row.id); updateSelection() }
    const name = elem('span', 'name'); name.append(elem('b', '', row.title), elem('small', '', `${row.artist} · ${row.confirmed ? t.confirmed : t.unconfirmed}`))
    label.append(box, name, elem('span', 'value', `${fmt(row.rating)} · ${fmt(row.votes)}`)); return label
  }))
  $('select-all').onchange = e => { for (const row of visible) e.target.checked ? selected.add(row.id) : selected.delete(row.id); drawChoices() }
  $('select-all').checked = visible.length > 0 && visible.every(row => selected.has(row.id))
  $('select-all').indeterminate = visible.some(row => selected.has(row.id)) && !visible.every(row => selected.has(row.id))
  updateSelection()
}

function updateSelection() {
  const chosen = rows.filter(row => selected.has(row.id))
  const pages = new Set(chosen.map(row => canonicalUrl(row.rymUrl))).size
  $('workload').textContent = t.workload(chosen.length, pages, Math.ceil(Math.max(0, pages - 1) / 2), rows.filter(row => !canonicalUrl(row.rymUrl)).length)
  $('start').disabled = working || !selected.size || !$('consent').checked
}

function drawJob() {
  if (!job) return
  const c = counts(job)
  $('prepare').hidden = true; $('progress-panel').hidden = false
  $('summary').textContent = t.progress(c.done, c.total, c.failed)
  $('phase').textContent = t[job.phase] || ''
  $('progress').max = c.total || 1; $('progress').value = c.done + c.failed
  $('pause').hidden = !runner?.running; $('resume').hidden = !!runner?.running || !c.pending
  $('retry').hidden = !!runner?.running || !c.failed
  $('new').disabled = !!runner?.running || working
  $('resume').disabled = working; $('retry').disabled = working
  $('source').hidden = sourceTab == null
  $('results').replaceChildren(...job.items.flatMap(item => item.targets.map(target => {
    const row = elem('div', 'record'), name = elem('span', 'name')
    name.append(elem('b', '', target.title), elem('small', '', target.artist))
    const result = ['done', 'partial', 'kept'].includes(target.status)
      ? `${fmt(target.rating)} → ${fmt(target.newRating)} · ${fmt(target.votes)} → ${fmt(target.newVotes)}`
      : `${fmt(target.rating)} · ${fmt(target.votes)}`
    row.append(name, elem('span', 'value', result), elem('span', `outcome ${target.status}`, t[target.error || target.status] || t.problem))
    return row
  })))
  $('notice').textContent = job.phase === 'paused' ? t[job.reason] || t.paused : job.phase === 'complete' ? t.completeHint : t.runningHint
}

async function save(current) {
  current.sourceTab = sourceTab
  try { await chrome.storage.local.set({ [JOB_KEY]: current }) } catch { throw failure('storage') }
  drawJob()
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const finish = () => { signal.removeEventListener('abort', abort); resolve() }
  const timer = setTimeout(finish, ms)
  const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Paused', 'AbortError')) }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
})

async function waitForPage(id, signal) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    let tab
    try { tab = await chrome.tabs.get(id) } catch { throw failure('sourceClosed') }
    if (tab.status === 'complete') return
    await wait(500, signal)
  }
  throw failure('timeout')
}

async function read(item, signal) {
  if (!await chrome.permissions.contains(hosts)) throw failure('permission')
  let tab = sourceTab == null ? null : await chrome.tabs.get(sourceTab).catch(() => null)
  // Never repurpose a tab that the user has navigated away from the source site.
  if (tab && !canonicalUrl(tab.url) && !['https://rateyourmusic.com/', 'https://www.rateyourmusic.com/'].some(base => tab.url?.startsWith(base))) throw failure('sourceClosed')
  if (!tab) {
    tab = await chrome.tabs.create({ url: item.url, active: false }); sourceTab = tab.id
    await save(job)
  } else if (!item.resumePage || canonicalUrl(tab.url) !== item.url) {
    // Updating a tab to the same URL does not reliably cause a new navigation.
    if (canonicalUrl(tab.url) === item.url) await chrome.tabs.reload(tab.id)
    else await chrome.tabs.update(tab.id, { url: item.url })
  }
  await waitForPage(sourceTab, signal)
  await wait(1500, signal)
  let result
  try { result = (await chrome.scripting.executeScript({ target: { tabId: sourceTab }, files: ['batch-reader.js'] }))?.[0]?.result }
  catch { throw failure('permission') }
  if (result?.captureError) {
    if (['challenge', 'throttled'].includes(result.captureError)) await chrome.tabs.update(sourceTab, { active: true })
    throw failure(result.captureError)
  }
  return result
}

async function notifyLibrary() {
  try { await chrome.scripting.executeScript({ target: { tabId: libraryTab }, func: expected => {
    if (location.origin === expected) window.dispatchEvent(new Event('mihonban-rym-updated'))
  }, args: [origin] }) } catch { /* Progress remains available if the library tab was closed. */ }
}

async function launch(retry = false) {
  if (working || runner?.running) return
  working = true
  try {
    // Request optional site access only from an explicit Start/Continue click.
    if (!await chrome.permissions.request(hosts)) throw failure('permission')
    // A duplicated queue tab must not start a second navigator or overwrite progress.
    await navigator.locks.request('mihonban-rym-batch', { ifAvailable: true }, async lock => {
      if (!lock) throw failure('busy')
      rows = await api('GET', '/api/admin/rym')
      if (!job) job = createJob(rows, [...selected], origin)
      else reconcileJob(job, rows, retry)
      runner = new BatchRunner(job, { save, read, wait, now: Date.now,
        write: (target, snapshot) => api('POST', `/api/admin/rym/${encodeURIComponent(target.id)}`,
          { action: 'scores', version: target.version, confirmSource: true, snapshot }) })
      working = false
      await runner.run()
      await notifyLibrary()
    })
  } catch (e) {
    if (job) { job.phase = 'paused'; job.reason = e.code || 'problem' }
    note(e.code || 'problem')
  }
  finally { working = false; updateSelection(); if (job) drawJob() }
}

async function connect() {
  if (!Number.isSafeInteger(libraryTab) || libraryTab < 1) throw failure('library')
  const tab = await chrome.tabs.get(libraryTab).catch(() => null)
  if (!tab?.url) throw failure('library')
  origin = validOrigin(tab.url); $('origin').textContent = origin
  rows = await api('GET', '/api/admin/rym')
  const stored = (await chrome.storage.local.get(JOB_KEY))[JOB_KEY]
  if (stored?.schema === 1 && stored.origin === origin && Array.isArray(stored.items)) {
    job = stored; sourceTab = stored.sourceTab ?? null
    if (job.phase === 'running') { job.phase = 'paused'; job.reason = 'paused' }
    drawJob()
  } else {
    job = null; selected = new Set(rows.filter(row => canonicalUrl(row.rymUrl) && isStale(row)).map(row => row.id))
    $('prepare').hidden = false; $('progress-panel').hidden = true; $('notice').textContent = ''; drawChoices()
  }
}

$('query').oninput = drawChoices; $('scope').onchange = drawChoices; $('consent').onchange = updateSelection
$('start').onclick = () => launch(); $('resume').onclick = () => launch(); $('retry').onclick = () => launch(true)
$('pause').onclick = () => { runner?.pause(); note('pausing') }
$('new').onclick = async () => {
  if (runner?.running || working) return
  try { await chrome.storage.local.remove(JOB_KEY); job = null; await connect() } catch (e) { note(e.code || 'problem') }
}
$('library').onclick = () => chrome.tabs.update(libraryTab, { active: true }).catch(() => note('library'))
$('source').onclick = () => chrome.tabs.update(sourceTab, { active: true }).catch(() => note('sourceClosed'))
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'connectBatch' || !Number.isSafeInteger(message.libraryTab)) return
  if (runner?.running || working) { reply({ busy: true }); return }
  libraryTab = message.libraryTab
  connect().then(() => reply({ ok: true })).catch(e => { note(e.code || 'problem'); reply({ ok: false }) })
  return true
})
connect().catch(e => note(e.code || 'library'))
