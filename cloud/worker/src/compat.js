// Node/VPS 运行时的 D1 与 KV 兼容层（better-sqlite3 后端）。
// 只实现本项目用到的 D1 方法面：prepare().bind().first()/all()/run() 与
// batch()；KV 的 get/put(expirationTtl)/delete/list。业务代码零改动跨运行时。

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
      // 键集分页（cursor = 上一页最后一个键）。调用方（graph/gdrive 的缓存清理）
      // 会边翻页边删除已返回的键；OFFSET 分页在这种用法下会跳过存活的键。
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
