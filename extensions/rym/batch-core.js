export const MIN_INTERVAL = 30_000
export const JOB_KEY = 'rymRatingBatch'
const blockedReasons = new Set(['challenge', 'throttled', 'permission', 'library', 'auth', 'sourceClosed', 'storage'])
export const failure = code => Object.assign(new Error(code), { code })

export function canonicalUrl(value) {
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || !['rateyourmusic.com', 'www.rateyourmusic.com'].includes(u.hostname)
      || u.port || u.username || u.password || /%2f|%5c/i.test(u.pathname)
      || !/^\/release\/[a-z-]+\/[^/]+\/[^/]+(?:\/[^/]+)*\/?$/i.test(u.pathname)) return null
    return `https://rateyourmusic.com${u.pathname.replace(/\/+$/, '')}/`
  } catch { return null }
}

export function scoreSnapshot(input, expectedUrl, now = Date.now()) {
  if (!input || canonicalUrl(input.rymUrl) !== canonicalUrl(expectedUrl) || !canonicalUrl(expectedUrl)) throw failure('sourceConflict')
  if (input.source !== 'browser' || !Number.isSafeInteger(input.observedAt) || input.observedAt < 1 || input.observedAt > now + 60_000) throw failure('invalidPage')
  const out = { rymUrl: canonicalUrl(expectedUrl), source: 'browser', observedAt: input.observedAt }
  for (const field of ['title', 'artist']) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 1000) throw failure('invalidPage')
    out[field] = input[field]
  }
  if (typeof input.rating === 'number' && Number.isFinite(input.rating) && input.rating >= 0 && input.rating <= 5) out.rating = input.rating
  if (Number.isSafeInteger(input.votes) && input.votes >= 0) out.votes = input.votes
  if (!('rating' in out) && !('votes' in out)) throw failure('invalidPage')
  return out
}

export const isStale = (row, now = Date.now()) => !row.fields?.rating?.observedAt || !row.fields?.votes?.observedAt
  || now - Math.min(row.fields.rating.observedAt, row.fields.votes.observedAt) > 30 * 86400_000

export function createJob(rows, ids, origin, interval = MIN_INTERVAL) {
  const chosen = new Set(ids), grouped = new Map()
  for (const row of rows) {
    const url = canonicalUrl(row.rymUrl)
    if (!chosen.has(row.id) || !url) continue
    if (!grouped.has(url)) grouped.set(url, { url, targets: [], snapshot: null, resumePage: false })
    grouped.get(url).targets.push({ id: row.id, title: row.title, artist: row.artist, version: row.version,
      rating: row.rating, votes: row.votes, status: 'pending', error: null })
  }
  return { schema: 1, origin, items: [...grouped.values()], phase: 'paused', reason: 'ready',
    interval: Math.max(MIN_INTERVAL, Number(interval) || MIN_INTERVAL), nextAt: 0, failures: 0 }
}

export function reconcileJob(job, rows, retry = false) {
  const latest = new Map(rows.map(row => [row.id, row]))
  for (const item of job.items) for (const target of item.targets) {
    if (target.status !== 'pending' && !(retry && target.status === 'failed')) continue
    const row = latest.get(target.id)
    if (!row || canonicalUrl(row.rymUrl) !== item.url) {
      target.status = 'failed'; target.error = 'sourceConflict'; continue
    }
    target.version = row.version; target.status = 'pending'; target.error = null
  }
  return job
}

export function counts(job) {
  const all = job?.items.flatMap(item => item.targets) || []
  return { total: all.length, pending: all.filter(t => t.status === 'pending').length,
    failed: all.filter(t => t.status === 'failed').length,
    done: all.filter(t => ['done', 'partial', 'kept'].includes(t.status)).length }
}

export class BatchRunner {
  constructor(job, io) { this.job = job; this.io = io; this.running = false; this.stopped = false }
  pause() { this.stopped = true; this.abort?.abort() }
  async run() {
    if (this.running) return
    this.running = true; this.stopped = false; this.abort = new AbortController()
    const j = this.job, io = this.io
    j.phase = 'running'; j.reason = ''
    try {
      await io.save(j)
      for (const item of j.items) {
        if (!item.targets.some(t => t.status === 'pending')) continue
        if (this.stopped) break
        if (!item.snapshot) {
          const remaining = Math.max(0, j.nextAt - io.now())
          if (remaining) await io.wait(remaining, this.abort.signal)
          if (this.stopped) break
          // Reserve the next navigation before reading, including across restarts.
          j.nextAt = io.now() + Math.max(MIN_INTERVAL, j.interval)
          await io.save(j)
          try {
            item.snapshot = scoreSnapshot(await io.read(item, this.abort.signal), item.url, io.now())
            item.resumePage = false; j.failures = 0
            await io.save(j)
          } catch (e) {
            if (this.stopped || e.name === 'AbortError') break
            const reason = e.code || 'invalidPage'
            if (blockedReasons.has(reason)) {
              item.resumePage = ['challenge', 'throttled'].includes(reason)
              if (reason === 'throttled') j.nextAt = Math.max(j.nextAt, io.now() + 300_000)
              j.reason = reason; break
            }
            for (const t of item.targets) if (t.status === 'pending') { t.status = 'failed'; t.error = reason }
            j.failures++; await io.save(j)
            if (j.failures >= 3) { j.reason = 'repeatedFailures'; break }
            continue
          }
        }
        for (const target of item.targets) {
          if (target.status !== 'pending' || this.stopped) continue
          try {
            const result = await io.write(target, item.snapshot)
            target.status = result.stale ? 'kept' : (item.snapshot.rating == null || item.snapshot.votes == null) ? 'partial' : 'done'
            target.newRating = result.rating; target.newVotes = result.votes; target.error = null
          } catch (e) {
            const reason = e.code || 'problem'
            if (blockedReasons.has(reason)) { j.reason = reason; break }
            target.status = 'failed'; target.error = reason
          }
          await io.save(j)
        }
        if (j.reason || this.stopped) break
      }
    } catch (e) {
      if (e.name !== 'AbortError') j.reason = e.code || 'problem'
    } finally {
      j.phase = counts(j).pending ? 'paused' : 'complete'
      if (j.phase === 'paused' && !j.reason) j.reason = 'paused'
      this.running = false
      await io.save(j)
    }
  }
}
