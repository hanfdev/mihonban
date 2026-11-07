import test from 'node:test'
import assert from 'node:assert/strict'
import { BatchRunner, canonicalUrl, counts, createJob, failure, isStale, MIN_INTERVAL, reconcileJob, scoreSnapshot } from '../../../extensions/rym/batch-core.js'
import { batchMessages } from '../../../extensions/rym/batch-translations.js'

const url = 'https://rateyourmusic.com/release/album/example/record/'
const rows = [
  { id: 'a', title: 'A', artist: 'Artist', rymUrl: url, version: 'v1', rating: 3, votes: 10 },
  { id: 'b', title: 'B', artist: 'Artist', rymUrl: url, version: 'v2', rating: 2, votes: 20 },
  { id: 'c', title: 'C', artist: 'Artist', rymUrl: url.replace('/record/', '/other/'), version: 'v3', rating: 1, votes: 30 },
  { id: 'd', title: 'D', artist: 'Artist', rymUrl: null },
]
const snapshot = (u = url, now = 1000) => ({ title: 'Record', artist: 'Artist', rymUrl: u, source: 'browser', observedAt: now, rating: 0, votes: 0, genres: ['Unwanted'], descriptors: ['Unwanted'], rank: '#1' })
const fixture = () => {
  let now = 1000
  const calls = { reads: [], writes: [], saves: [] }
  const job = createJob(rows, rows.map(r => r.id), 'https://music.example.com', 1)
  const io = { now: () => now, wait: async ms => { now += ms },
    save: async j => { calls.saves.push(structuredClone(j)) },
    read: async item => { calls.reads.push({ url: item.url, at: now }); return snapshot(item.url, now) },
    write: async (target, data) => { calls.writes.push({ id: target.id, data }); return { rating: data.rating, votes: data.votes } } }
  return { job, io, calls }
}

test('rating batches group canonical sources, skip unlinked albums and strip all taxonomy and ranks', async () => {
  const { job, io, calls } = fixture()
  assert.equal(job.items.length, 2)
  assert.equal(job.interval, MIN_INTERVAL)
  await new BatchRunner(job, io).run()
  assert.equal(calls.reads.length, 2); assert.equal(calls.writes.length, 3)
  assert.ok(calls.reads[1].at - calls.reads[0].at >= MIN_INTERVAL)
  for (const { data } of calls.writes) {
    assert.equal(data.rating, 0); assert.equal(data.votes, 0)
    assert.equal(data.genres, undefined); assert.equal(data.descriptors, undefined); assert.equal(data.rank, undefined)
  }
  assert.equal(counts(job).done, 3); assert.equal(job.phase, 'complete')
  assert.equal(canonicalUrl(url.replace('rateyourmusic.com', 'www.rateyourmusic.com') + '?x=1'), url)
  assert.throws(() => scoreSnapshot(snapshot('https://evil.test/'), url))
})

test('challenges stop navigation and resume the same item without losing completed editions', async () => {
  const { job, io, calls } = fixture()
  const read = io.read; let challenge = true
  io.read = async item => { if (challenge) throw failure('challenge'); return read(item) }
  const runner = new BatchRunner(job, io)
  await runner.run()
  assert.equal(job.phase, 'paused'); assert.equal(job.reason, 'challenge'); assert.equal(calls.writes.length, 0)
  assert.equal(job.items[0].resumePage, true)
  challenge = false; await runner.run()
  assert.equal(counts(job).done, 3)
})

test('throttling enforces a five minute cooldown and never skips ahead automatically', async () => {
  const { job, io, calls } = fixture(); const read = io.read
  io.read = async () => { throw failure('throttled') }
  await new BatchRunner(job, io).run()
  assert.equal(job.reason, 'throttled'); assert.ok(job.nextAt >= 301000)
  assert.equal(calls.writes.length, 0)
  io.read = read; await new BatchRunner(job, io).run()
  assert.ok(calls.reads[0].at >= 301000)
})

test('pausing and reloading resumes pending work without recapturing saved pages', async () => {
  const { job, io, calls } = fixture(); let runner
  const write = io.write
  io.write = async (...args) => { const result = await write(...args); runner.pause(); return result }
  runner = new BatchRunner(job, io); await runner.run()
  assert.equal(counts(job).done, 1); assert.equal(job.phase, 'paused')
  const saved = structuredClone(job)
  io.write = write
  reconcileJob(saved, rows.map(r => ({ ...r, version: 'latest' })))
  await new BatchRunner(saved, io).run()
  assert.deepEqual(calls.writes.map(v => v.id), ['a', 'b', 'c'])
  assert.equal(calls.reads.length, 2)
})

test('source rebinding is not followed and failed writes can be retried independently', async () => {
  const { job, io, calls } = fixture(); const write = io.write
  io.write = async (target, data) => { if (target.id === 'b') throw failure('conflict'); return write(target, data) }
  await new BatchRunner(job, io).run()
  assert.equal(counts(job).failed, 1)
  reconcileJob(job, rows, true); io.write = write
  await new BatchRunner(job, io).run()
  assert.equal(calls.reads.length, 2); assert.equal(counts(job).done, 3)
  const other = createJob(rows, ['a'], 'https://music.example.com')
  reconcileJob(other, [{ ...rows[0], rymUrl: rows[2].rymUrl }])
  assert.equal(other.items[0].targets[0].error, 'sourceConflict')
})

test('loss of admin access pauses writes and three invalid pages stop the whole queue', async () => {
  const { job, io, calls } = fixture(); io.write = async () => { throw failure('auth') }
  await new BatchRunner(job, io).run()
  assert.equal(job.reason, 'auth'); assert.equal(calls.reads.length, 1); assert.equal(counts(job).pending, 3)
  const many = createJob(Array.from({ length: 5 }, (_, i) => ({ ...rows[0], id: String(i), rymUrl: url.replace('/record/', `/record-${i}/`) })), ['0', '1', '2', '3', '4'], job.origin)
  let reads = 0; io.read = async () => { reads++; throw failure('invalidPage') }
  await new BatchRunner(many, io).run()
  assert.equal(reads, 3); assert.equal(many.reason, 'repeatedFailures'); assert.equal(counts(many).pending, 2)
})

test('overdue selection requires fresh observations for both score fields and all batch languages are complete', () => {
  assert.equal(isStale({ fields: { rating: { observedAt: 1000 } } }, 2000), true)
  assert.equal(isStale({ fields: { rating: { observedAt: 1000 }, votes: { observedAt: 1000 } } }, 2000), false)
  for (const [lang, dict] of Object.entries(batchMessages)) {
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(batchMessages.en).sort(), lang)
    for (const value of Object.values(dict)) assert.ok(typeof value === 'function' ? value(1, 2, 3, 4) : value)
  }
})
