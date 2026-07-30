// D1 and KV compatibility layer for the Node/VPS runtime, backed by better-sqlite3.
// It implements only the surface this project uses: prepare().bind().first()/all()/run()
// and batch() for D1; get/put(expirationTtl)/delete/list for KV. Business logic
// runs unchanged across runtimes.

export function d1FromSqlite(db) {
  const wrap = (sql, params = []) => ({
    bind: (...args) => wrap(sql, args),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => {
      const info = db.prepare(sql).run(...params);
      return { meta: { changes: info.changes } };
    },
    _exec: () => db.prepare(sql).run(...params),
  });
  return {
    prepare: (sql) => wrap(sql),
    batch: async (stmts) => {
      let infos;
      const tx = db.transaction(() => { infos = stmts.map((s) => s._exec()); });
      tx();
      return infos.map((i) => ({ meta: { changes: i.changes } }));
    },
  };
}

export function kvFromSqlite(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS _kv (
    k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER)`);
  const now = () => Date.now();
  return {
    get: async (k, type) => {
      const row = db.prepare("SELECT v, exp FROM _kv WHERE k = ?").get(k);
      if (!row) return null;
      if (row.exp && row.exp < now()) {
        db.prepare("DELETE FROM _kv WHERE k = ?").run(k);
        return null;
      }
      if (type !== "json") return row.v;
      try {
        return JSON.parse(row.v);
      } catch {
        // A damaged cache entry should behave like a miss, not take down the
        // request that happens to read it.
        db.prepare("DELETE FROM _kv WHERE k = ?").run(k);
        return null;
      }
    },
    put: async (k, v, opts = {}) => {
      const exp = opts.expirationTtl ? now() + opts.expirationTtl * 1000 : null;
      db.prepare(`INSERT INTO _kv (k, v, exp) VALUES (?, ?, ?)
        ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp`)
        .run(k, String(v), exp);
    },
    delete: async (k) => {
      db.prepare("DELETE FROM _kv WHERE k = ?").run(k);
    },
    list: async ({ prefix = "", cursor = "", limit = 1000 } = {}) => {
      // Keyset pagination, where cursor is the previous page's final key. Callers
      // such as graph/gdrive cache cleanup delete returned keys while paging;
      // OFFSET pagination would skip surviving keys in that pattern.
      const rows = db.prepare(
        "SELECT k FROM _kv WHERE (exp IS NULL OR exp >= ?) " +
        "AND substr(k, 1, length(?)) = ? AND k > ? ORDER BY k LIMIT ?")
        .all(now(), prefix, prefix, String(cursor || ""), limit);
      return {
        keys: rows.map((row) => ({ name: row.k })),
        list_complete: rows.length < limit,
        cursor: rows.length < limit ? "" : rows[rows.length - 1].k,
      };
    },
  };
}
