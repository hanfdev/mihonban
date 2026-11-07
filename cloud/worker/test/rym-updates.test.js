import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import worker from '../src/index.js';
import { d1FromSqlite, kvFromSqlite } from '../src/compat.js';
import { sessionCookie } from '../src/auth.js';
import { canonicalRymUrl } from '../src/rym.js';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const url = 'https://rateyourmusic.com/release/album/example/record/';
async function fixture(t, legacy = false) {
  const db = new Database(':memory:'); db.exec(schema);
  if (legacy) db.exec('DROP TABLE album_rym_state; DROP TABLE rym_dismissed;');
  t.after(() => db.close());
  db.prepare(`INSERT INTO storages(id,name,kind,config,is_write,created_at) VALUES ('s','Test','local','{}',1,1)`).run();
  const env = { DB: d1FromSqlite(db), KV: kvFromSqlite(db), COMPANION_KEY: 'fixture-companion',
    SESSION_SECRET: 'test-session-secret-0123456789abcdef', OD_ROOT: 'Music/Library' };
  const cookies = {};
  for (const role of ['admin', 'user']) cookies[role] = (await sessionCookie(env, role)).split(';')[0];
  const call = async (path, body, role = 'admin', method = body ? 'POST' : 'GET', extra = {}) => {
    const headers = { ...(role === 'companion' ? { 'X-Api-Key': env.COMPANION_KEY } : role ? { Cookie: cookies[role] } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra };
    const response = await worker.fetch(new Request(`http://mihonban.test${path}`, { method, headers,
      ...(body ? { body: JSON.stringify(body) } : {}) }), env);
    return { status: response.status, data: await response.json() };
  };
  const registration = { folder: 'Music/Library/Example/Record', artist: 'Example', title: 'Record',
    genres: ['My Jazz'], secondaryGenres: ['City Pop'], descriptors: ['warm'], rymRating: 3.5, rymVotes: 20,
    rymUrl: url, tracks: [{ path: 'Music/Library/Example/Record/01.flac', title: 'Song' }] };
  const registered = await call('/api/albums', registration, 'companion');
  assert.equal(registered.status, 200, JSON.stringify(registered.data));
  const id = registered.data.id;
  const detail = async () => (await call(`/api/admin/rym/${id}`)).data;
  const capture = async (snapshot = {}, version) => call(`/api/admin/rym/${id}`, { action: 'capture',
    version: version || (await detail()).version, confirmSource: true,
    snapshot: { title: 'Record', artist: 'Example', rymUrl: url, rating: 4, votes: 200,
      genres: ['City Pop', 'New genre'], secondaryGenres: ['My Jazz'], descriptors: ['warm', 'new mood'],
      source: 'browser', observedAt: Date.now() - 1000, ...snapshot } });
  return { db, env, call, id, detail, capture, registration };
}

test('RYM URL identity rejects lookalikes and strips query tracking', () => {
  assert.equal(canonicalRymUrl(url + '?x=1#review'), url);
  assert.equal(canonicalRymUrl(url.replace('rateyourmusic.com', 'www.rateyourmusic.com')), url);
  for (const invalid of ['http://rateyourmusic.com/release/album/a/b/', url.replace('rateyourmusic.com', 'rateyourmusic.com.evil.test'),
    url.replace('https://', 'https://user@'), 'https://rateyourmusic.com/artist/example', url.replace('record', '%2fother')]) assert.equal(canonicalRymUrl(invalid), null);
});

test('migration preserves old classifications and refresh separates suggestions from scores', async t => {
  const { detail, capture, db, id } = await fixture(t, true);
  const before = await detail(); assert.equal(before.observedAt, null);
  const { status, data } = await capture(); assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.rating, 4); assert.equal(data.votes, 200); assert.equal(data.confirmed, true);
  assert.deepEqual(data.genres, ['My Jazz']); assert.deepEqual(data.secondaryGenres, ['City Pop']);
  assert.deepEqual(data.descriptors, ['warm']);
  assert.deepEqual(data.suggestions, [{ field: 'genres', value: 'New genre' }, { field: 'descriptors', value: 'new mood' }]);
  assert.ok(data.observedAt); assert.ok(data.receivedAt >= data.observedAt);
  assert.ok(db.prepare('SELECT updated_at FROM albums WHERE id = ?').get(id).updated_at > 1);
});

test('partial, older, duplicate and saved-file captures never clear or rewind fresh fields', async t => {
  const { capture, detail } = await fixture(t);
  const at = Date.now() - 5000;
  assert.equal((await capture({ observedAt: at, rank: '#10' })).status, 200);
  assert.equal((await capture({ observedAt: at + 1000, rating: null, votes: 0, rank: null })).status, 200);
  let record = await detail(); assert.equal(record.rating, 4); assert.equal(record.votes, 0); assert.equal(record.rank, '#10');
  assert.equal(record.fields.rating.observedAt, at); assert.equal(record.fields.votes.observedAt, at + 1000);
  const newerVersion = record.version;
  const old = await capture({ observedAt: at - 1, rating: 2, votes: 3 }); assert.equal(old.data.stale, true);
  await capture({ observedAt: null, source: 'file', rating: 1, votes: 1 });
  record = await detail(); assert.equal(record.rating, 4); assert.equal(record.votes, 0);
  assert.equal((await capture({}, newerVersion)).status, 409);
});

test('ignored and manually removed suggestions stay dismissed; adopting keeps genre placement', async t => {
  const { capture, detail, call, id } = await fixture(t);
  await capture(); let record = await detail();
  let result = await call(`/api/admin/rym/${id}`, { action: 'suggestions', version: record.version,
    items: [{ field: 'genres', value: 'New genre', target: 'secondaryGenres' }, { field: 'descriptors', value: 'new mood', target: 'ignore' }] });
  assert.equal(result.status, 200); assert.deepEqual(result.data.secondaryGenres, ['City Pop', 'New genre']);
  assert.deepEqual(result.data.genres, ['My Jazz']);
  await call(`/api/album/${id}`, { secondaryGenres: [], genres: ['My Jazz'] }, 'admin', 'PATCH');
  await capture({ observedAt: Date.now(), genres: ['City Pop', 'New genre'], descriptors: ['new mood'] });
  record = await detail(); assert.deepEqual(record.suggestions, []); assert.deepEqual(record.secondaryGenres, []);
});

test('companion sync and legacy imports cannot undo curated labels or recent ratings', async t => {
  const { capture, detail, call, id, registration } = await fixture(t);
  await capture();
  assert.equal((await call('/api/albums', { ...registration, rymRating: 1, rymVotes: 2, genres: ['Wrong'] }, 'companion')).status, 200);
  assert.equal((await call(`/api/album/${id}`, { rymRating: 1, genres: ['Wrong'] }, 'companion', 'PATCH')).status, 200);
  assert.equal((await call(`/api/album/${id}/rym`, { rymUrl: url, rating: 1, genres: ['Wrong'] }, 'companion')).status, 200);
  const record = await detail(); assert.equal(record.rating, 4); assert.equal(record.votes, 200); assert.deepEqual(record.genres, ['My Jazz']);
});

test('administrator clearing a score is protected from old files and companion refill', async t => {
  const { capture, detail, call, id, registration } = await fixture(t);
  await capture();
  assert.equal((await call(`/api/album/${id}`, { rymRating: null }, 'admin', 'PATCH')).status, 200);
  await capture({ source: 'file', rating: 1, observedAt: null });
  await call('/api/albums', { ...registration, rymRating: 3 }, 'companion');
  assert.equal((await detail()).rating, null);
  assert.equal((await detail()).fields.rating.value, null);
  assert.equal((await detail()).fields.votes.value, 200);
});

test('a companion fill racing a browser capture cannot replace its newer rating', async t => {
  const { db, env, call, id, capture, detail } = await fixture(t);
  db.prepare('UPDATE albums SET rym_rating = NULL WHERE id = ?').run(id);
  const batch = env.DB.batch;
  let resume, reached;
  const paused = new Promise(resolve => { reached = resolve; });
  const release = new Promise(resolve => { resume = resolve; });
  env.DB.batch = async statements => {
    env.DB.batch = batch;
    reached();
    await release;
    return batch(statements);
  };
  const stale = call(`/api/album/${id}`, { rymRating: 1 }, 'companion', 'PATCH');
  await paused;
  try { assert.equal((await capture()).status, 200); }
  finally { resume(); }
  assert.equal((await stale).status, 200);
  assert.equal((await detail()).rating, 4);
});

test('large suggestion decisions remain in one bounded atomic D1 batch', async t => {
  const { env, call, id, capture, detail } = await fixture(t);
  const genres = Array.from({ length: 200 }, (_, i) => `Genre ${i}`);
  await capture({ genres, descriptors: [] });
  const record = await detail();
  const batch = env.DB.batch;
  env.DB.batch = async statements => {
    assert.ok(statements.length <= 3);
    return batch(statements);
  };
  const result = await call(`/api/admin/rym/${id}`, { action: 'suggestions', version: record.version,
    items: record.suggestions.map(item => ({ ...item, target: 'ignore' })) });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.suggestions, []);
  assert.deepEqual(result.data.genres, ['My Jazz']);
});

test('scores-only batches cannot change curated taxonomy, suggestions or rank even with extra payload fields', async t => {
  const { call, capture, detail, id } = await fixture(t)
  await capture({ rank: '#20' }); const before = await detail()
  const response = await call(`/api/admin/rym/${id}`, { action: 'scores', version: before.version, confirmSource: true,
    snapshot: { rymUrl: url, source: 'browser', observedAt: Date.now(), rating: 0, votes: 0,
      genres: ['Changed'], secondaryGenres: [], descriptors: ['Changed'], rank: '#1' } })
  assert.equal(response.status, 200)
  assert.equal(response.data.rating, 0); assert.equal(response.data.votes, 0)
  for (const key of ['genres', 'secondaryGenres', 'descriptors', 'rank', 'suggestions']) assert.deepEqual(response.data[key], before[key])
  assert.equal((await call(`/api/admin/rym/${id}`, { action: 'scores', version: response.data.version,
    snapshot: { rymUrl: url, source: 'file', rating: 5 } })).status, 400)
})

test('only admin sessions can confirm a source and conflicting sources need explicit rebinding', async t => {
  const { capture, detail, call, id } = await fixture(t);
  for (const role of ['user', 'companion', null]) {
    assert.notEqual((await call('/api/admin/rym', undefined, role)).status, 200);
    assert.notEqual((await call(`/api/admin/rym/${id}`, { action: 'bind', rymUrl: url }, role)).status, 200);
  }
  assert.equal((await call(`/api/admin/rym/${id}`, { action: 'bind', rymUrl: url }, 'admin', 'POST', { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await capture({ rymUrl: url.replace('/record/', '/other/') })).status, 409);
  const bound = await call(`/api/admin/rym/${id}`, { action: 'bind', version: (await detail()).version, rymUrl: url.replace('/record/', '/other/') });
  assert.equal(bound.status, 200); assert.equal(bound.data.rating, null); assert.deepEqual(bound.data.genres, ['My Jazz']);
});

test('malformed input and failed capture keep values and observation time; concurrent writes conflict', async t => {
  const { capture, detail, call, id } = await fixture(t);
  await capture(); const before = await detail();
  for (const snapshot of [{ rating: 6 }, { votes: -1 }, { rating: '4.3' }, { observedAt: Date.now() + 120000 }, { genres: [null] }]) {
    assert.equal((await capture(snapshot)).status, 400);
  }
  const failed = await call(`/api/admin/rym/${id}`, { action: 'failure', version: before.version });
  assert.equal(failed.status, 200); assert.equal(failed.data.observedAt, before.observedAt); assert.equal(failed.data.rating, before.rating);
  const current = await detail();
  const results = await Promise.all([capture({ observedAt: Date.now(), rating: 4.2 }, current.version), capture({ observedAt: Date.now(), rating: 4.1 }, current.version)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const final = await detail(); assert.ok([4.1, 4.2].includes(final.rating));
  assert.equal((await call(`/api/album/${id}`, undefined, 'admin', 'DELETE')).status, 200);
});
