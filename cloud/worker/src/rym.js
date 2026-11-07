// RYM snapshots are submitted by an administrator; this module never fetches RYM.
export const RYM_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS album_rym_state (
    album_id TEXT PRIMARY KEY REFERENCES albums(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS rym_dismissed (
    album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(album_id, kind, value))`,
];

export async function installRymSchema(db) {
  for (const sql of RYM_SCHEMA) await db.prepare(sql).run();
  // Remember removals even when another client edits the album directly.
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_rym_removed_tags
    AFTER UPDATE OF genres, sec_genres, descriptors ON albums BEGIN
      INSERT OR IGNORE INTO rym_dismissed SELECT old.id, 'genre', lower(value)
        FROM json_each(CASE WHEN json_valid(old.genres) THEN old.genres ELSE '[]' END) WHERE type = 'text' AND lower(value) NOT IN
        (SELECT lower(value) FROM json_each(CASE WHEN json_valid(new.genres) THEN new.genres ELSE '[]' END) WHERE type = 'text'
         UNION SELECT lower(value) FROM json_each(CASE WHEN json_valid(new.sec_genres) THEN new.sec_genres ELSE '[]' END) WHERE type = 'text');
      INSERT OR IGNORE INTO rym_dismissed SELECT old.id, 'genre', lower(value)
        FROM json_each(CASE WHEN json_valid(old.sec_genres) THEN old.sec_genres ELSE '[]' END) WHERE type = 'text' AND lower(value) NOT IN
        (SELECT lower(value) FROM json_each(CASE WHEN json_valid(new.genres) THEN new.genres ELSE '[]' END) WHERE type = 'text'
         UNION SELECT lower(value) FROM json_each(CASE WHEN json_valid(new.sec_genres) THEN new.sec_genres ELSE '[]' END) WHERE type = 'text');
      INSERT OR IGNORE INTO rym_dismissed SELECT old.id, 'descriptor', lower(value)
        FROM json_each(CASE WHEN json_valid(old.descriptors) THEN old.descriptors ELSE '[]' END) WHERE type = 'text' AND lower(value) NOT IN
        (SELECT lower(value) FROM json_each(CASE WHEN json_valid(new.descriptors) THEN new.descriptors ELSE '[]' END) WHERE type = 'text');
    END`).run();
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_rym_delete
    AFTER DELETE ON albums BEGIN
      DELETE FROM album_rym_state WHERE album_id = old.id;
      DELETE FROM rym_dismissed WHERE album_id = old.id;
    END`).run();
}

const decode = (s, fallback = {}) => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };
const key = (s) => s.normalize('NFC').toLowerCase();
const fail = (code, status = 400) => Object.assign(new Error(code), { status });
export function canonicalRymUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['rateyourmusic.com', 'www.rateyourmusic.com'].includes(u.hostname)
      || u.port || u.username || u.password || /%2f|%5c/i.test(u.pathname)) return null;
    if (!/^\/release\/[a-z-]+\/[^/]+\/[^/]+(?:\/[^/]+)*\/?$/i.test(u.pathname)) return null;
    return `https://rateyourmusic.com${u.pathname.replace(/\/+$/, '')}/`;
  } catch { return null; }
}

export function validateSnapshot(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('invalidSnapshot');
  const rymUrl = canonicalRymUrl(body.rymUrl);
  if (!rymUrl) throw fail('invalidUrl');
  const out = { rymUrl };
  for (const [name, max] of [['title', 1000], ['artist', 1000], ['rank', 500]]) {
    if (body[name] == null || body[name] === '') continue;
    if (typeof body[name] !== 'string' || body[name].length > max) throw fail('invalidSnapshot');
    if (body[name].trim()) out[name] = body[name].trim();
  }
  for (const [name, max, integer] of [['rating', 5, false], ['votes', Number.MAX_SAFE_INTEGER, true]]) {
    if (body[name] == null || body[name] === '') continue;
    const v = body[name];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max || (integer && !Number.isSafeInteger(v))) throw fail('invalidSnapshot');
    out[name] = v;
  }
  for (const name of ['genres', 'secondaryGenres', 'descriptors']) {
    if (body[name] == null) continue;
    if (!Array.isArray(body[name]) || body[name].length > 200 || body[name].some(v => typeof v !== 'string' || v.length > 200)) throw fail('invalidSnapshot');
    out[name] = [...new Map(body[name].map(v => v.trim()).filter(Boolean).map(v => [key(v), v])).values()];
  }
  out.source = body.source === 'browser' ? 'browser' : 'file';
  out.observedAt = null;
  if (out.source === 'browser') {
    if (!Number.isSafeInteger(body.observedAt) || body.observedAt < 1 || body.observedAt > now + 60_000) throw fail('invalidTime');
    out.observedAt = Math.min(body.observedAt, now);
  }
  if (!['rating', 'votes', 'rank'].some(k => k in out) && !['genres', 'secondaryGenres', 'descriptors'].some(k => out[k]?.length)) throw fail('emptySnapshot');
  return out;
}

const columns = ['rym_rating', 'rym_votes', 'rym_rank', 'rym_url', 'genres', 'sec_genres', 'descriptors', 'updated_at'];
async function versionOf(album, row) {
  const bytes = new TextEncoder().encode(JSON.stringify([row?.revision || 0, ...columns.map(k => album[k])]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
}
async function load(db, id) {
  const [album, row, dismissed] = await Promise.all([
    db.prepare('SELECT * FROM albums WHERE id = ?').bind(id).first(),
    db.prepare('SELECT * FROM album_rym_state WHERE album_id = ?').bind(id).first(),
    db.prepare('SELECT kind, value FROM rym_dismissed WHERE album_id = ?').bind(id).all(),
  ]);
  if (!album) throw fail('notFound', 404);
  return { album, row, state: decode(row?.data), dismissed: dismissed.results, version: await versionOf(album, row) };
}

function suggestions(record) {
  const { album, state, dismissed } = record;
  const seen = new Set([...decode(album.genres, []), ...decode(album.sec_genres, [])].map(key));
  const descriptors = new Set(decode(album.descriptors, []).map(key));
  const ignored = new Set(dismissed.map(v => `${v.kind}:${key(v.value)}`));
  const result = [];
  for (const field of ['genres', 'secondaryGenres', 'descriptors']) {
    const kind = field === 'descriptors' ? 'descriptor' : 'genre';
    for (const value of state.snapshot?.[field] || []) {
      const target = kind === 'genre' ? seen : descriptors;
      if (target.has(key(value)) || ignored.has(`${kind}:${key(value)}`)) continue;
      target.add(key(value));
      result.push({ field, value });
    }
  }
  return result;
}

function publicRecord(record) {
  const { album: a, state, version } = record;
  const confirmed = state.confirmed && state.url === canonicalRymUrl(a.rym_url);
  return { id: a.id, title: a.title, artist: a.artist, year: a.year, hidden: !!a.hidden,
    rating: a.rym_rating, votes: a.rym_votes, rank: a.rym_rank,
    rymUrl: canonicalRymUrl(a.rym_url), confirmed: !!confirmed,
    genres: decode(a.genres, []), secondaryGenres: decode(a.sec_genres, []), descriptors: decode(a.descriptors, []),
    observedAt: state.observedAt || null, receivedAt: state.receivedAt || null,
    source: state.source || null, status: state.status || 'unknown',
    error: state.error || null, fields: state.fields || {}, suggestions: suggestions(record), version };
}

// The state CAS checks the album fields too, so a concurrent manual edit cannot
// be overwritten. The second statement only runs for this operation's unique ID.
async function save(db, record, state, changes = {}, dismiss = []) {
  const { album, row } = record;
  const operation = crypto.randomUUID();
  state.operation = operation;
  const old = columns.map(k => album[k]);
  const condition = columns.map(k => `${k} IS ?`).join(' AND ');
  const stateWrite = db.prepare(`INSERT INTO album_rym_state(album_id, revision, data)
    SELECT ?, 1, ? WHERE EXISTS (SELECT 1 FROM albums WHERE id = ? AND ${condition})
    ON CONFLICT(album_id) DO UPDATE SET revision = revision + 1, data = excluded.data
    WHERE album_rym_state.revision = ?`)
    .bind(album.id, JSON.stringify(state), album.id, ...old, row?.revision || 0);
  const guard = `EXISTS (SELECT 1 FROM album_rym_state WHERE album_id = ? AND json_extract(data, '$.operation') = ?)`;
  const entries = Object.entries(changes);
  const statements = [stateWrite];
  if (entries.length) statements.push(db.prepare(`UPDATE albums SET ${entries.map(([k]) => `${k} = ?`).join(', ')},
    updated_at = MAX(updated_at + 1, ?) WHERE id = ? AND ${guard}`)
    .bind(...entries.map(([, v]) => v), Date.now(), album.id, album.id, operation));
  if (dismiss.length) statements.push(db.prepare(`INSERT OR IGNORE INTO rym_dismissed(album_id, kind, value)
    SELECT ?, json_extract(value, '$.kind'), json_extract(value, '$.value') FROM json_each(?) WHERE ${guard}`)
    .bind(album.id, JSON.stringify(dismiss.map(item => ({ kind: item.kind, value: key(item.value) }))), album.id, operation));
  const result = await db.batch(statements);
  if (!result[0].meta.changes) throw fail('conflict', 409);
  return publicRecord(await load(db, album.id));
}

async function capture(db, record, body, legacy = false, companion = false) {
  const snapshot = validateSnapshot({ ...body.snapshot, ...(legacy ? body : {}), ...(legacy ? { source: 'file' } : {}) });
  const { album, state } = record;
  const oldUrl = canonicalRymUrl(album.rym_url);
  if (oldUrl && oldUrl !== snapshot.rymUrl) throw fail('sourceConflict', 409);
  if (!legacy && !state.confirmed && body.confirmSource !== true) throw fail('confirmSource', 409);
  const next = { ...state, url: snapshot.rymUrl, confirmed: legacy ? !!state.confirmed : true,
    fields: { ...state.fields } };
  const changes = {};
  let updated = 0;
  for (const [name, column] of [['rating', 'rym_rating'], ['votes', 'rym_votes'], ['rank', 'rym_rank']]) {
    if (!(name in snapshot)) continue;
    if (companion && (record.row || (album[column] != null && album[column] !== ''))) continue;
    const field = state.fields?.[name];
    // A changed value since our last snapshot is a deliberate edit by another client.
    const manual = field && album[column] !== field.value;
    const older = field?.observedAt && (!snapshot.observedAt || snapshot.observedAt <= field.observedAt);
    if (older || (manual && (!snapshot.observedAt || snapshot.observedAt <= album.updated_at))) continue;
    if (legacy && state.confirmed && !field && album[column] != null && album[column] !== '') continue;
    if (field && field.value === snapshot[name] && field.observedAt === snapshot.observedAt) continue;
    changes[column] = snapshot[name]; updated++;
    next.fields[name] = { value: snapshot[name], observedAt: snapshot.observedAt, receivedAt: Date.now(), source: snapshot.source };
  }
  const fresh = !state.observedAt || (snapshot.observedAt && snapshot.observedAt > state.observedAt);
  if (fresh) {
    next.snapshot = { ...state.snapshot, ...snapshot };
    next.observedAt = snapshot.observedAt;
    next.receivedAt = Date.now(); next.source = snapshot.source;
    next.status = snapshot.rating == null || snapshot.votes == null ? 'partial' : 'ok';
    next.error = null;
  }
  if (!oldUrl) changes.rym_url = snapshot.rymUrl;
  const result = await save(db, record, next, changes);
  return { ...result, updated, stale: !fresh && !updated };
}

function guarded(handler) {
  return async c => {
    try { return await handler(c); }
    catch (e) { if (e.status) return c.json({ error: e.message, code: e.message }, e.status); throw e; }
  };
}
export const legacyRymImport = guarded(async c => {
  const body = await c.req.json().catch(() => null);
  if (!body) throw fail('invalidSnapshot');
  const record = await load(c.env.DB, c.req.param('id'));
  const result = await capture(c.env.DB, record, body, true, c.get('role') === 'companion');
  return c.json({ ok: true, ...result });
});

export function registerRymRoutes(app) {
  const gate = async (c, next) => {
    if (c.get('role') !== 'admin') return c.json({ error: 'forbidden' }, 403);
    if (c.req.method !== 'GET') {
      const origin = c.req.header('Origin');
      if ((origin && origin !== new URL(c.req.url).origin) || !c.req.header('Content-Type')?.startsWith('application/json')) return c.json({ error: 'forbidden' }, 403);
    }
    c.header('Cache-Control', 'private, no-store');
    return next();
  };
  app.use('/api/admin/rym', gate);
  app.use('/api/admin/rym/*', gate);
  app.get('/api/admin/rym', guarded(async c => {
    const { results: albums } = await c.env.DB.prepare('SELECT * FROM albums ORDER BY artist, title').all();
    const [{ results: states }, { results: dismissed }] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM album_rym_state').all(), c.env.DB.prepare('SELECT * FROM rym_dismissed').all(),
    ]);
    const map = new Map(states.map(s => [s.album_id, s]));
    const records = await Promise.all(albums.map(async album => {
      const row = map.get(album.id);
      return publicRecord({ album, row, state: decode(row?.data), dismissed: dismissed.filter(d => d.album_id === album.id), version: await versionOf(album, row) });
    }));
    return c.json(records);
  }));
  app.get('/api/admin/rym/:id', guarded(async c => c.json(publicRecord(await load(c.env.DB, c.req.param('id'))))));
  app.post('/api/admin/rym/:id', guarded(async c => {
    const body = await c.req.json().catch(() => null);
    if (!body || JSON.stringify(body).length > 100_000) throw fail('invalidSnapshot');
    const record = await load(c.env.DB, c.req.param('id'));
    if (body.version !== record.version) throw fail('conflict', 409);
    if (body.action === 'scores') {
      const input = body.snapshot || {};
      if (input.source !== 'browser' || (input.rating == null && input.votes == null)) throw fail('invalidSnapshot');
      // Batch refreshes cannot modify ranks, classifications, or classification suggestions.
      const snapshot = Object.fromEntries(['title', 'artist', 'rymUrl', 'source', 'observedAt', 'rating', 'votes']
        .filter(key => key in input).map(key => [key, input[key]]));
      return c.json(await capture(c.env.DB, record, { ...body, snapshot }));
    }
    if (body.action === 'capture') return c.json(await capture(c.env.DB, record, body));
    if (body.action === 'bind') {
      const url = canonicalRymUrl(body.rymUrl);
      if (!url) throw fail('invalidUrl');
      const same = url === canonicalRymUrl(record.album.rym_url);
      return c.json(await save(c.env.DB, record, same ? { ...record.state, url, confirmed: true }
        : { url, confirmed: true, status: 'unknown' }, same ? {} : { rym_url: url, rym_rating: null, rym_votes: null, rym_rank: '' }));
    }
    if (body.action === 'failure') {
      return c.json(await save(c.env.DB, record, { ...record.state, status: 'error', error: 'captureFailed', attemptedAt: Date.now() }));
    }
    if (body.action !== 'suggestions' || !Array.isArray(body.items) || body.items.length > 200) throw fail('invalidSnapshot');
    const available = suggestions(record);
    const lists = { genres: decode(record.album.genres, []), secondaryGenres: decode(record.album.sec_genres, []), descriptors: decode(record.album.descriptors, []) };
    const dismiss = [];
    for (const item of body.items) {
      if (!available.some(s => s.field === item.field && s.value === item.value)) throw fail('conflict', 409);
      const kind = item.field === 'descriptors' ? 'descriptor' : 'genre';
      if (item.target !== 'ignore' && !(kind === 'descriptor' ? item.target === 'descriptors' : ['genres', 'secondaryGenres'].includes(item.target))) throw fail('invalidSnapshot');
      dismiss.push({ kind, value: item.value });
      if (item.target !== 'ignore') {
        const taken = kind === 'genre' ? [...lists.genres, ...lists.secondaryGenres] : lists.descriptors;
        if (!taken.some(v => key(v) === key(item.value))) lists[item.target].push(item.value);
      }
    }
    return c.json(await save(c.env.DB, record, record.state,
      { genres: JSON.stringify(lists.genres), sec_genres: JSON.stringify(lists.secondaryGenres), descriptors: JSON.stringify(lists.descriptors) }, dismiss));
  }));
}
