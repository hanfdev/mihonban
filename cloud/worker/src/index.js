// mihonban cloud — API Worker
// 浏览/元数据: D1 · 音频: OneDrive Graph 直链 302（字节不经过 Worker）
// 认证: 密码登录 → HMAC cookie；本地伴侣用 X-Api-Key。

import { Hono } from "hono";
import * as graph from "./graph.js";
import * as r2 from "./r2.js";
import * as storage from "./storage.js";
import { requireAuth, requireAdmin, sessionCookie, sessionRole,
         checkPassword, hashPassword, getSetting, setSetting,
         isThrottled, noteLoginFailure, clearLoginFailures,
         loginDelay, bumpSessionEpochStatement } from "./auth.js";
import { scanSource } from "./source.js";
import { signProxyTarget } from "./proxy-sign.js";
import { discardResponse, fetchWithTimeout } from "./net.js";
import { CONFIG_BACKUP_SETTING_KEYS } from "./config-backup.js";

const app = new Hono();

/* ---------- helpers ---------- */

const norm = (p) => String(p || "").normalize("NFC").replaceAll("\\", "/")
  .replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
const MAX_STORAGE_PATH = 400; // OneDrive/Graph 的完整路径上限
const settingStatement = (env, key, value) => env.DB.prepare(`
  INSERT INTO settings (k, v) VALUES (?, ?)
  ON CONFLICT(k) DO UPDATE SET v = excluded.v`).bind(key, String(value));

async function sha16(s) {
  const d = await crypto.subtle.digest("SHA-1",
    new TextEncoder().encode(s.normalize("NFC")));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0"))
    .join("").slice(0, 16);
}

function safePath(env, p) {
  if (typeof p !== "string") return null;
  const n = norm(p);
  if (n.length > MAX_STORAGE_PATH || /[\u0000-\u001f]/.test(n)) return null;
  const parts = n.split("/");
  if (parts.some((part) => part.length > 255 || part === "." || part === "..")) {
    return null;
  }
  if (!n.startsWith(norm(env.OD_ROOT) + "/")) return null;
  return n;
}

const J = (s, fb = []) => { try { return JSON.parse(s); } catch { return fb; } };
const configJson = (raw) => {
  const value = J(raw, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};

const stringList = (value) => Array.isArray(value)
  ? value.map((v) => String(v).trim()).filter(Boolean)
  : [];
const strictStringList = (value) => Array.isArray(value)
  ? value.filter((v) => typeof v === "string")
    .map((v) => v.trim()).filter(Boolean)
  : [];
const settingStringList = (raw) => strictStringList(J(raw, []));

function finiteNumber(value, { integer = false, min = -Infinity,
  max = Infinity } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max
      || (integer && !Number.isInteger(n))) return null;
  return n;
}

// JSON inputs are allowed to carry numeric strings (the local companion has
// historically sent a few values that way), but objects, arrays, booleans,
// NaN, and Infinity must never reach SQLite.  Returning a sentinel lets each
// endpoint distinguish an omitted nullable field from a malformed one.
const INVALID_INPUT = Symbol("invalid-input");
function finiteInput(value, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") {
    return INVALID_INPUT;
  }
  const n = finiteNumber(value, options);
  return n === null ? INVALID_INPUT : n;
}

function boundedText(value, max, { allowEmpty = true } = {}) {
  if (value === null || value === undefined) return allowEmpty ? "" : INVALID_INPUT;
  if (typeof value !== "string") return INVALID_INPUT;
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > max) return INVALID_INPUT;
  return text;
}

function strictTextList(value, { maxItems = 200, maxItemLength = 200 } = {}) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) return INVALID_INPUT;
  const out = [];
  for (const item of value) {
    if (typeof item !== "string") return INVALID_INPUT;
    const text = item.trim();
    if (!text || text.length > maxItemLength) return INVALID_INPUT;
    out.push(text);
  }
  return out;
}

function validHttpUrl(value, max = 2048) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length > max) return INVALID_INPUT;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return INVALID_INPUT;
    if (url.username || url.password) return INVALID_INPUT;
    return url.toString();
  } catch {
    return INVALID_INPUT;
  }
}

function imageSizeParam(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return INVALID_INPUT;
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0 || size > 10_000) {
    return INVALID_INPUT;
  }
  return size;
}

function temporaryRedirect(url) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

// Public image redirects are versioned by the R2 mirror timestamp. Cache the
// short-lived API redirect so a page refresh does not invoke the Worker for
// every cover while still allowing a changed cover to roll out promptly.
function publicImageRedirect(url) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function imageMimeFromBytes(buffer) {
  const b = new Uint8Array(buffer);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    .every((value, index) => b[index] === value)) return "image/png";
  const ascii = (start, length) => String.fromCharCode(
    ...b.slice(start, start + length));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    return "image/webp";
  }
  if (b.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) {
    return "image/gif";
  }
  if (b.length >= 16 && ascii(4, 4) === "ftyp"
      && /(?:avif|avis)/.test(ascii(8, Math.min(24, b.length - 8)))) {
    return "image/avif";
  }
  return null;
}

function imageMimeFromPath(path) {
  const ext = String(path || "").split(".").pop().toLowerCase();
  return {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    webp: "image/webp", gif: "image/gif", avif: "image/avif",
  }[ext] || "application/octet-stream";
}

function genreLists(primary, secondary) {
  const seen = new Set();
  const unique = (values) => {
    const out = [];
    for (const value of stringList(values)) {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
    return out;
  };
  return { primary: unique(primary), secondary: unique(secondary) };
}

async function ensureSingleWriteTarget(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, is_write FROM storages ORDER BY created_at, id").all();
  if (!results.length) return null;
  const writes = results.filter((row) => !!row.is_write);
  if (writes.length === 1) return writes[0].id;
  const selected = writes[0] || results[0];
  await env.DB.batch([
    env.DB.prepare("UPDATE storages SET is_write = 0"),
    env.DB.prepare("UPDATE storages SET is_write = 1 WHERE id = ?")
      .bind(selected.id),
  ]);
  return selected.id;
}

// Cloudflare D1 limits a single batch size. Keep a margin below the platform
// cap so large box sets and long favorite/image reorder lists do not turn into
// opaque 500 errors. (Node's SQLite compatibility layer accepts all sizes.)
const D1_BATCH_SIZE = 80;
async function runD1Batches(db, statements, size = D1_BATCH_SIZE) {
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size));
  }
}

function albumOut(row) {
  return {
    id: row.id, artist: row.artist, artistSort: row.artist_sort,
    title: row.title, year: row.year, folder: row.folder,
    storageId: row.storage_id || null,
    hidden: !!row.hidden,
    rym: row.rym_rating == null && !row.rym_url ? null : {
      rating: row.rym_rating, votes: row.rym_votes,
      rank: row.rym_rank || null, rymUrl: row.rym_url || null,
      genres: J(row.genres), secondaryGenres: J(row.sec_genres),
      descriptors: J(row.descriptors),
    },
    genres: J(row.genres), secondaryGenres: J(row.sec_genres),
    trackCount: row.track_count, duration: row.total_duration,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const canSeeHidden = (c) => ["admin", "companion"].includes(c.get("role"));

/* ---------- auth ---------- */

app.post("/api/login", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") || "local";
  if (await isThrottled(c.env, ip)) {
    return c.json({ error: "尝试太频繁，请 15 分钟后再试" }, 429);
  }
  const body = await requestObject(c);
  const password = body?.password;
  if (typeof password !== "string" || password.length > 4096) {
    await loginDelay();
    await noteLoginFailure(c.env, ip);
    return c.json({ error: "密码格式无效" }, 400);
  }
  const role = await checkPassword(c.env, password);
  await loginDelay(); // 均衡延迟：拖慢暴破 + 抹平响应时间差
  if (!role) {
    await noteLoginFailure(c.env, ip);
    return c.json({ error: "密码不对" }, 401);
  }
  await clearLoginFailures(c.env, ip);
  try {
    c.header("Set-Cookie", await sessionCookie(c.env, role));
  } catch (error) {
    return c.json({ error: String(error.message || error) }, 503);
  }
  return c.json({ ok: true, role });
});

app.post("/api/logout", (c) => {
  c.header("Set-Cookie", "mihonban_session=; Path=/; Max-Age=0");
  return c.json({ ok: true });
});

app.get("/api/me", async (c) => {
  const role = await sessionRole(c.env, c.req);
  if (role) return c.json({ ok: true, role, guest: false });
  // 未登录：开启访客免密时以只读 user 身份放行（前端据此跳过登录页）
  if ((await getSetting(c.env, "guest_open")) === "1") {
    return c.json({ ok: true, role: "user", guest: true });
  }
  return c.json({ ok: false, role: null, guest: false });
});

app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

// 轻量启动迁移：给旧库补上后加的列（列已存在时 ALTER 报错，吞掉即可）。
// 每个隔离实例只跑一次；D1 无 IF NOT EXISTS COLUMN，靠 try/catch 幂等。
const migratedDbs = new WeakSet();
const migrationPromises = new WeakMap();
async function ensureMigrations(env) {
  if (migratedDbs.has(env.DB)) return;
  if (migrationPromises.has(env.DB)) return migrationPromises.get(env.DB);
  const migration = (async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS artists (
      name TEXT PRIMARY KEY,
      avatar_path TEXT NOT NULL DEFAULT '',
      storage_id TEXT
    )`).run();
    const alters = [
      "ALTER TABLE favorites ADD COLUMN sort_order INTEGER",
      "ALTER TABLE albums ADD COLUMN storage_id TEXT",
      "ALTER TABLE albums ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE artists ADD COLUMN storage_id TEXT",
    ];
    for (const sql of alters) {
      try {
        await env.DB.prepare(sql).run();
      } catch (e) {
        if (!/duplicate column|already exists/i.test(String(e?.message || e))) {
          throw e;
        }
      }
    }
    // Older multi-storage builds inferred avatar storage from the first album
    // of the artist. Persist that same association once so future reads and
    // migrations are deterministic even when the artist spans several disks.
    try {
      await env.DB.prepare(`UPDATE artists SET storage_id = (
        SELECT storage_id FROM albums
        WHERE albums.artist = artists.name
        ORDER BY albums.created_at LIMIT 1
      ) WHERE avatar_path != '' AND storage_id IS NULL`).run();
    } catch (e) {
      if (!/no such column|no such table/i.test(String(e?.message || e))) {
        throw e;
      }
    }
    try {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS r2_cache (
        cache_key TEXT PRIMARY KEY, r2_key TEXT NOT NULL, created_at INTEGER NOT NULL,
        cache_policy INTEGER NOT NULL DEFAULT 0
      )`).run();
    } catch (e) {
      if (!/already exists/i.test(String(e?.message || e))) throw e;
    }
    try {
      await env.DB.prepare(
        "ALTER TABLE r2_cache ADD COLUMN cache_policy INTEGER NOT NULL DEFAULT 0").run();
    } catch (e) {
      if (!/duplicate column|already exists/i.test(String(e?.message || e))) {
        throw e;
      }
    }
    try {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS storages (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}', is_write INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`).run();
    } catch (e) {
      if (!/already exists/i.test(String(e?.message || e))) throw e;
    }
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS track_imports (
      import_id TEXT NOT NULL,
      id TEXT NOT NULL,
      album_id TEXT NOT NULL,
      disc INTEGER NOT NULL DEFAULT 1,
      track INTEGER,
      title TEXT NOT NULL,
      duration REAL,
      format TEXT NOT NULL DEFAULT '',
      bitrate INTEGER,
      size INTEGER,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (import_id, id),
      UNIQUE (import_id, path)
    )`).run();
    await env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_track_imports_created ON track_imports(created_at)")
      .run();
    await env.DB.prepare("DELETE FROM track_imports WHERE created_at < ?")
      .bind(Date.now() - 24 * 60 * 60 * 1000).run();

    // Convert the former global OneDrive slot into an ordinary named backend.
    // No files are copied: existing catalog rows are bound to the backend that
    // already contains them, then every runtime path uses the same dispatcher.
    const [{ n: storageCount = 0 } = {}, { n: unboundAlbums = 0 } = {}] =
      await Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS n FROM storages").first(),
        env.DB.prepare(
          "SELECT COUNT(*) AS n FROM albums WHERE storage_id IS NULL").first(),
      ]);
    const legacy = await graph.storageConf(env);
    const rotatedRefresh = await env.KV.get("ms:refresh").catch(() => null);
    if (rotatedRefresh) legacy.refreshToken = rotatedRefresh;
    const legacyReady = [legacy.clientId, legacy.clientSecret,
      legacy.refreshToken, legacy.driveId].every((value) =>
      typeof value === "string" && value.length > 0);
    let migratedStorageId = null;
    if (legacyReady && (unboundAlbums > 0 || storageCount === 0)) {
      const { results: oneDrives } = await env.DB.prepare(
        "SELECT id, config FROM storages WHERE kind = 'onedrive'").all();
      for (const row of oneDrives) {
        try {
          if (JSON.parse(row.config || "{}").driveId === legacy.driveId) {
            migratedStorageId = row.id;
            break;
          }
        } catch { /* inspect the next backend */ }
      }
      if (!migratedStorageId) {
        const suffix = String(legacy.driveId).replace(/[^a-zA-Z0-9]/g, "").slice(-8)
          || "default";
        const baseId = `onedrive-${suffix}`.slice(0, 64);
        migratedStorageId = baseId;
        for (let attempt = 1; ; attempt += 1) {
          const conflict = await env.DB.prepare(
            "SELECT kind, config FROM storages WHERE id = ?")
            .bind(migratedStorageId).first();
          if (!conflict) break;
          let sameDrive = false;
          try {
            sameDrive = conflict.kind === "onedrive"
              && JSON.parse(conflict.config || "{}").driveId === legacy.driveId;
          } catch { /* treat malformed/foreign rows as a collision */ }
          if (sameDrive) break;
          const suffixText = `-${attempt}`;
          migratedStorageId = `${baseId.slice(0, 64 - suffixText.length)}${suffixText}`;
        }
        const existingNamed = await env.DB.prepare(
          "SELECT kind, config FROM storages WHERE id = ?")
          .bind(migratedStorageId).first();
        const write = await env.DB.prepare(
          "SELECT 1 FROM storages WHERE is_write = 1").first();
        if (!existingNamed) {
          await env.DB.prepare(`
            INSERT INTO storages (id, name, kind, config, is_write, created_at)
            VALUES (?, ?, 'onedrive', ?, ?, ?)`)
            .bind(migratedStorageId, "OneDrive", JSON.stringify(legacy),
              write ? 0 : 1, Date.now()).run();
        }
      }
      await env.DB.prepare(
        "UPDATE albums SET storage_id = ? WHERE storage_id IS NULL")
        .bind(migratedStorageId).run();
      await env.DB.prepare(`UPDATE artists SET storage_id = COALESCE((
        SELECT storage_id FROM albums WHERE albums.artist = artists.name
        ORDER BY albums.created_at LIMIT 1
      ), ?) WHERE avatar_path != '' AND storage_id IS NULL`)
        .bind(migratedStorageId).run();
      await env.DB.prepare(
        "DELETE FROM settings WHERE k IN ('ms_client_id','ms_client_secret','ms_refresh_token','ms_drive_id')")
        .run();
      await env.KV.delete("ms:token").catch(() => null);
      await env.KV.delete("ms:refresh").catch(() => null);
      storage.clearStorageCache();
    }
    if (unboundAlbums > 0 && !migratedStorageId) {
      throw new Error(
        "Unbound albums require a named storage backend; legacy OneDrive credentials are incomplete");
    }
    await ensureSingleWriteTarget(env);
    try {
      await env.DB.prepare(
        "CREATE INDEX IF NOT EXISTS idx_albums_hidden ON albums(hidden)").run();
    } catch (e) {
      if (!/already exists/i.test(String(e?.message || e))) throw e;
    }
    migratedDbs.add(env.DB);
  })().finally(() => { migrationPromises.delete(env.DB); });
  migrationPromises.set(env.DB, migration);
  return migration;
}

app.use("/api/*", requireAuth());
app.use("/api/*", async (c, next) => { await ensureMigrations(c.env); await next(); });

// 普通用户只读：一切写操作（上传/编辑/删除/登记/扫描/后台）要管理员或伴侣 key
const adminGate = requireAdmin();
app.use("/api/albums", adminGate);
app.use("/api/album/*", (c, next) =>
  c.req.method === "GET" ? next() : adminGate(c, next));
app.use("/api/upload/*", adminGate);
app.use("/api/scan", adminGate);
app.use("/api/admin/*", adminGate);
app.use("/api/companion/*", adminGate);
app.use("/api/discogs-lookup", adminGate);
app.use("/api/artist-discogs-search", adminGate);
app.use("/api/artist-discogs-detail", adminGate);
app.use("/api/artists/*", (c, next) =>
  c.req.method === "GET" ? next() : adminGate(c, next));
app.use("/api/favorites/*", (c, next) =>
  c.req.method === "GET" ? next() : adminGate(c, next));
app.use("/api/artists", (c, next) =>
  c.req.method === "GET" ? next() : adminGate(c, next));

/* ---------- library ---------- */

app.get("/api/library", async (c) => {
  // includeHidden=1：管理员看隐藏音盤（精选/后台用）；默认对所有人隐藏
  const showHidden = c.req.query("hidden") === "1" && canSeeHidden(c);
  const { results } = await c.env.DB.prepare(`
    SELECT a.*, COUNT(t.id) AS track_count,
           SUM(t.duration) AS total_duration
    FROM albums a LEFT JOIN tracks t ON t.album_id = a.id
    WHERE ${showHidden ? "1=1" : "COALESCE(a.hidden,0)=0"}
    GROUP BY a.id
    ORDER BY a.artist_sort, a.artist, a.year, a.title`).all();
  return c.json(results.map(albumOut));
});

app.get("/api/album/:id", async (c) => {
  const id = c.req.param("id");
  const album = await c.env.DB.prepare(`
    SELECT a.*, COUNT(t.id) AS track_count, SUM(t.duration) AS total_duration
    FROM albums a LEFT JOIN tracks t ON t.album_id = a.id
    WHERE a.id = ? GROUP BY a.id`).bind(id).first();
  if (!album || !album.id) return c.json({ error: "not found" }, 404);
  // 隐藏音盤：仅管理员可读详情（直接 hash 打开也不给访客）
  if (album.hidden && !canSeeHidden(c)) {
    return c.json({ error: "not found" }, 404);
  }
  const { results: tracks } = await c.env.DB.prepare(`
    SELECT id, disc, track, title, duration, format, bitrate, size, path
    FROM tracks WHERE album_id = ? ORDER BY disc, track, title`)
    .bind(id).all();
  const out = albumOut(album);
  out.tracks = tracks;
  const noteRow = await c.env.DB.prepare(
    "SELECT text FROM notes WHERE kind = 'album' AND id = ?").bind(id).first();
  out.note = noteRow?.text || "";
  const { results: images } = await c.env.DB.prepare(`
    SELECT id FROM album_images WHERE album_id = ?
    ORDER BY sort, created_at`).bind(id).all();
  out.images = images.map((i) => i.id);
  // 同 genre 推荐：主 genre 重合的其他专辑，按评分降序（不含隐藏）
  out.similar = [];
  const main = out.genres[0];
  if (main) {
    const { results: sim } = await c.env.DB.prepare(`
      SELECT id, artist, title, year, rym_rating FROM albums
      WHERE id != ? AND COALESCE(hidden,0)=0 AND (
        EXISTS (SELECT 1 FROM json_each(
          CASE WHEN json_valid(albums.genres) THEN albums.genres ELSE '[]' END
        ) g WHERE lower(CAST(g.value AS TEXT)) = lower(?))
        OR EXISTS (SELECT 1 FROM json_each(
          CASE WHEN json_valid(albums.sec_genres) THEN albums.sec_genres ELSE '[]' END
        ) g WHERE lower(CAST(g.value AS TEXT)) = lower(?))
      )
      ORDER BY rym_rating IS NULL, rym_rating DESC LIMIT 12`)
      .bind(id, main, main).all();
    out.similar = sim.map((s) => ({
      id: s.id, artist: s.artist, title: s.title, year: s.year,
      rating: s.rym_rating,
    }));
  }
  return c.json(out);
});

/* ---------- 曲库全曲目（「歌曲」视图；个人库规模一次拉全，客户端排序） ---------- */

app.get("/api/tracks", async (c) => {
  const showHidden = c.req.query("hidden") === "1" && canSeeHidden(c);
  const { results } = await c.env.DB.prepare(`
    SELECT t.id, t.title, t.duration, t.format, t.track, t.disc,
           a.id AS albumId, a.title AS albumTitle, a.artist,
           a.artist_sort AS artistSort, a.year, a.created_at AS addedAt,
           COALESCE(a.hidden,0) AS hidden
    FROM tracks t JOIN albums a ON a.id = t.album_id
    WHERE ${showHidden ? "1=1" : "COALESCE(a.hidden,0)=0"}`).all();
  return c.json(results);
});

/* ---------- 收藏（管理员标记，所有人可看） ---------- */

app.get("/api/favorites", async (c) => {
  // sort_order 有值就按它升序（手动拖动的顺序）；NULL 兜底用 created_at 倒序（最近在前）
  const visible = canSeeHidden(c) ? "1=1" : `(
    (kind = 'album' AND EXISTS (
      SELECT 1 FROM albums a WHERE a.id = item_id AND COALESCE(a.hidden,0)=0
    )) OR
    (kind = 'track' AND EXISTS (
      SELECT 1 FROM tracks t JOIN albums a ON a.id = t.album_id
      WHERE t.id = item_id AND COALESCE(a.hidden,0)=0
    )))`;
  const { results } = await c.env.DB.prepare(
    `SELECT kind, item_id, created_at, sort_order FROM favorites
     WHERE ${visible}
     ORDER BY sort_order IS NULL, sort_order, created_at DESC`).all();
  const pick = (k) => results.filter((r) => r.kind === k)
    .map((r) => ({ id: r.item_id, ts: r.created_at, order: r.sort_order }));
  return c.json({ albums: pick("album"), tracks: pick("track") });
});

// 手动拖动重排：前端传该 kind 的完整有序 id 列表，落成 sort_order = 0..n-1
app.put("/api/favorites/:kind/reorder", async (c) => {
  const kind = c.req.param("kind");
  if (!["album", "track"].includes(kind)) {
    return c.json({ error: "kind 非法" }, 400);
  }
  const { ids } = await c.req.json().catch(() => ({}));
  if (!Array.isArray(ids) || ids.some((id) =>
    typeof id !== "string" || id.length > 128)) {
    return c.json({ error: "ids 必须是字符串数组" }, 400);
  }
  const { results: current } = await c.env.DB.prepare(
    "SELECT item_id FROM favorites WHERE kind = ?").bind(kind).all();
  const existing = new Set(current.map((r) => r.item_id));
  if (ids.length !== existing.size || new Set(ids).size !== ids.length
      || ids.some((id) => !existing.has(id))) {
    return c.json({ error: "ids 与当前收藏不一致（先刷新页面）" }, 400);
  }
  if (ids.length) {
    await c.env.DB.prepare(`WITH ordered(id, position) AS (
      SELECT CAST(value AS TEXT), CAST(key AS INTEGER) FROM json_each(?)
    )
    UPDATE favorites SET sort_order = (
      SELECT position FROM ordered WHERE ordered.id = favorites.item_id
    )
    WHERE kind = ? AND item_id IN (SELECT id FROM ordered)`)
      .bind(JSON.stringify(ids), kind).run();
  }
  return c.json({ ok: true });
});

app.put("/api/favorites/:kind/:id", async (c) => {
  const kind = c.req.param("kind");
  if (!["album", "track"].includes(kind)) {
    return c.json({ error: "kind 非法" }, 400);
  }
  const id = c.req.param("id");
  const table = kind === "album" ? "albums" : "tracks";
  const exists = await c.env.DB.prepare(
    `SELECT 1 FROM ${table} WHERE id = ?`).bind(id).first();
  if (!exists) return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare(`
    INSERT INTO favorites (kind, item_id, created_at) VALUES (?, ?, ?)
    ON CONFLICT DO NOTHING`)
    .bind(kind, id, Date.now()).run();
  return c.json({ ok: true });
});

app.delete("/api/favorites/:kind/:id", async (c) => {
  const kind = c.req.param("kind");
  if (!["album", "track"].includes(kind)) {
    return c.json({ error: "kind 非法" }, 400);
  }
  await c.env.DB.prepare(
    "DELETE FROM favorites WHERE kind = ? AND item_id = ?")
    .bind(kind, c.req.param("id")).run();
  return c.json({ ok: true });
});

/* ---------- 艺术家（头像+简介；专辑列表由客户端按 artist 过滤） ---------- */

app.get("/api/artists", async (c) => {
  // 仅出现在「至少有一张未隐藏音盤」的艺人；附加信息表里的孤儿行不展示
  const showHidden = c.req.query("hidden") === "1" && canSeeHidden(c);
  const vis = showHidden ? "1=1" : "COALESCE(hidden,0)=0";
  const { results } = await c.env.DB.prepare(`
    SELECT names.name AS name, ar.avatar_path AS avatar_path, n.text AS note,
           (b.id IS NOT NULL) AS has_bio
    FROM (
      SELECT DISTINCT artist AS name FROM albums WHERE ${vis}
    ) names
    LEFT JOIN artists ar ON ar.name = names.name
    LEFT JOIN notes n ON n.kind = 'artist' AND n.id = names.name
    LEFT JOIN notes b ON b.kind = 'artistbio' AND b.id = names.name
    ORDER BY names.name COLLATE NOCASE`).all();
  return c.json(results.map((r) => ({
    name: r.name, hasAvatar: !!r.avatar_path, note: r.note || "",
    hasBio: !!r.has_bio,
  })));
});

// 完整简介单独拉取：可能很长（Markdown），不塞进列表接口
app.get("/api/artist-bio/:name", async (c) => {
  const name = artistNameParam(c);
  if (!canSeeHidden(c)) {
    const visible = await c.env.DB.prepare(
      "SELECT 1 FROM albums WHERE artist = ? AND COALESCE(hidden,0)=0 LIMIT 1")
      .bind(name).first();
    if (!visible) return c.json({ error: "not found" }, 404);
  }
  const row = await c.env.DB.prepare(
    "SELECT text FROM notes WHERE kind = 'artistbio' AND id = ?")
    .bind(name).first();
  return c.json({ bio: row?.text || "" });
});

app.put("/api/artists", async (c) => {
  const b = await requestObject(c);
  if (!b) return c.json({ error: "请求 JSON 无效" }, 400);
  const rawName = boundedText(b.name, 500, { allowEmpty: false });
  if (rawName === INVALID_INPUT) return c.json({ error: "name 格式无效" }, 400);
  const name = rawName.normalize("NFC");
  if ((b.note !== undefined &&
       (typeof b.note !== "string" || b.note.length > 20_000))
      || (b.bio !== undefined &&
        (typeof b.bio !== "string" || b.bio.length > 200_000))) {
    return c.json({ error: "艺人简介格式无效" }, 400);
  }
  let avatarChange = null;
  if (b.avatarPath !== undefined) {   // 只在明确传入时更新，避免改简介误清头像
    if ((typeof b.avatarPath !== "string" && b.avatarPath !== null)
        || (b.avatarStorageId !== undefined && b.avatarStorageId !== null
          && (typeof b.avatarStorageId !== "string"
            || !STORAGE_ID_RE.test(b.avatarStorageId)))) {
      return c.json({ error: "头像路径或存储后端格式无效" }, 400);
    }
    const p = b.avatarPath ? safePath(c.env, b.avatarPath) : "";
    if (b.avatarPath && !p) return c.json({ error: "avatarPath 非法" }, 400);
    const prev = await c.env.DB.prepare(
      "SELECT avatar_path, storage_id FROM artists WHERE name = ?").bind(name).first();
    let sid = b.avatarStorageId === undefined
      ? (prev?.storage_id || null)
      : (b.avatarStorageId || null);
    if (!p) sid = null;
    if (p && !sid) {
      return c.json({ error: "设置头像时必须指定命名存储后端" }, 400);
    }
    if (sid) {
      const backend = await c.env.DB.prepare(
        "SELECT 1 FROM storages WHERE id = ?").bind(sid).first();
      if (!backend) return c.json({ error: "头像存储后端不存在" }, 400);
      const { results: artistAlbums } = await c.env.DB.prepare(
        "SELECT folder, storage_id FROM albums WHERE artist = ?")
        .bind(name).all();
      const belongsToArtist = artistAlbums.some((album) => {
        const parent = String(album.folder || "").split("/").slice(0, -1).join("/");
        return parent && (album.storage_id || null) === sid
          && p.startsWith(`${parent}/`);
      });
      if (!belongsToArtist) {
        return c.json({ error: "头像必须位于该艺人的存储目录中" }, 400);
      }
    }
    avatarChange = { p, sid, prev };
  }
  await c.env.DB.prepare(
    "INSERT INTO artists (name, avatar_path) VALUES (?, '') " +
    "ON CONFLICT(name) DO NOTHING").bind(name).run();
  if (avatarChange) {
    const { p, sid, prev } = avatarChange;
    if (prev?.avatar_path) {
      await invalidateR2(c.env, `artist:${await sha16(prev.avatar_path)}:`);
    }
    await c.env.DB.prepare(
      "UPDATE artists SET avatar_path = ?, storage_id = ? WHERE name = ?")
      .bind(p || "", sid, name).run();
    // 换头像清 R2 镜像（同名文件覆盖时 key 不变，必须显式失效）
    if (p) await invalidateR2(c.env, `artist:${await sha16(p)}:`);
  }
  if (b.note !== undefined) {
    const text = b.note.trim();
    if (text) {
      await c.env.DB.prepare(`
        INSERT INTO notes (kind, id, text, updated_at) VALUES ('artist', ?, ?, ?)
        ON CONFLICT(kind, id) DO UPDATE SET text = excluded.text,
          updated_at = excluded.updated_at`)
        .bind(name, text, Date.now()).run();
    } else {
      await c.env.DB.prepare(
        "DELETE FROM notes WHERE kind = 'artist' AND id = ?").bind(name).run();
    }
  }
  if (b.bio !== undefined) {   // 完整简介（Markdown 长文），与短简介分开存
    const text = b.bio.trim();
    if (text) {
      await c.env.DB.prepare(`
        INSERT INTO notes (kind, id, text, updated_at) VALUES ('artistbio', ?, ?, ?)
        ON CONFLICT(kind, id) DO UPDATE SET text = excluded.text,
          updated_at = excluded.updated_at`)
        .bind(name, text, Date.now()).run();
    } else {
      await c.env.DB.prepare(
        "DELETE FROM notes WHERE kind = 'artistbio' AND id = ?")
        .bind(name).run();
    }
  }
  return c.json({ ok: true });
});

function artistNameParam(c) {
  let name = c.req.param("name") || "";
  try { name = decodeURIComponent(name); } catch { /* keep */ }
  return name.normalize("NFC");
}

app.get("/api/artist-art/:name", async (c) => {
  const name = artistNameParam(c);
  const publiclyVisible = await c.env.DB.prepare(
    "SELECT 1 FROM albums WHERE artist = ? AND COALESCE(hidden,0)=0 LIMIT 1")
    .bind(name).first();
  if (!canSeeHidden(c) && !publiclyVisible) {
    return c.json({ error: "not found" }, 404);
  }
  const row = await c.env.DB.prepare(
    "SELECT avatar_path, storage_id FROM artists WHERE name = ?").bind(name).first();
  if (row?.avatar_path) {
    const logicalKey = `artist:${await sha16(row.avatar_path)}:480`;
    const sid = row.storage_id || null;
    const res = await serveImageR2(c, logicalKey, row.avatar_path, "c480x480",
      publiclyVisible ? "public, max-age=604800" : "private, no-store",
      sid, !!publiclyVisible);
    if (res) return res;
    // 有自定义头像却读失败：502，绝不 302 到专辑封面（会掩盖故障 + 毒缓存）
    return c.json({ error: "avatar unavailable" }, 502, {
      "Cache-Control": "no-store",
    });
  }
  const ch = [...name][0]?.toUpperCase() || "♪";
  // 无自定义头像时复用最早可见专辑的原始封面镜像。公开回退必须始终
  // 选择可见专辑；否则管理员可能把隐藏专辑封面写入公共 R2 缓存。
  const albumVisibility = publiclyVisible
    ? "COALESCE(hidden,0)=0" : "1=1";
  const alb = await c.env.DB.prepare(`
    SELECT id, folder, cover_path, storage_id FROM albums WHERE artist = ?
      AND ${albumVisibility}
    ORDER BY year IS NULL, year, created_at LIMIT 1`).bind(name).first();
  if (alb) {
    const cover = await resolveCover(c.env, alb);
    if (cover) {
      const res = await serveImageR2(c, `art:${alb.id}:original`, cover, null,
        publiclyVisible
          ? "public, max-age=300, stale-while-revalidate=86400"
          : "private, no-store",
        alb.storage_id || null, !!publiclyVisible);
      if (res) return res;
    }
  }
  return c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
<rect width="200" height="200" fill="#1e1a15"/>
<text x="100" y="100" text-anchor="middle" dominant-baseline="central"
 font-family="serif" font-size="84" fill="#4a4132">${ch
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`, 200,
    { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
});

/* ---------- Discogs 自动匹配（服务器端调官方 API，浏览器侧无 CORS 问题） ---------- */

app.post("/api/album/:id/discogs-search", async (c) => {
  const token = await getSetting(c.env, "discogs_token");
  if (!token) {
    return c.json({ error: "未配置 Discogs token（管理后台 → Discogs）" }, 400);
  }
  const al = await c.env.DB.prepare(
    "SELECT artist, artist_sort, title, year FROM albums WHERE id = ?")
    .bind(c.req.param("id")).first();
  if (!al) return c.json({ error: "not found" }, 404);

  const search = async (artist) => {
    const u = new URL("https://api.discogs.com/database/search");
    u.searchParams.set("release_title", al.title);
    if (artist) u.searchParams.set("artist", artist);
    u.searchParams.set("type", "release");
    u.searchParams.set("per_page", "8");
    u.searchParams.set("token", token);
    const r = await fetchWithTimeout(u,
      { headers: { "User-Agent": "mihonban/1.0 +private-library" } });
    if (r.status === 401) throw new Error("Discogs token 无效");
    if (!r.ok) throw new Error(`Discogs ${r.status}`);
    return (await r.json()).results || [];
  };

  try {
    // 原名 → 罗马字 sort（自然词序）→ 只按碟名，三轮兜底
    let results = await search(al.artist);
    if (!results.length && al.artist_sort && al.artist_sort !== al.artist) {
      const nat = al.artist_sort.includes(",")
        ? al.artist_sort.split(",").reverse().map((s) => s.trim()).join(" ")
        : al.artist_sort;
      results = await search(nat);
    }
    if (!results.length) results = await search("");
    return c.json({
      candidates: results.slice(0, 8).map((r) => ({
        id: r.id, title: r.title || "", year: r.year || "",
        country: r.country || "",
        format: (r.format || []).slice(0, 3).join(" · "),
        label: (r.label || [])[0] || "",
        genres: r.genre || [], styles: r.style || [],
        thumb: r.thumb || "",
        url: r.id ? `https://www.discogs.com/release/${r.id}` : "",
      })),
    });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

/* 直接粘贴 Discogs 链接（release / master 页均可）→ 官方 API 取详情。
   只走 api.discogs.com，不抓取网页。 */
app.post("/api/discogs-lookup", async (c) => {
  const token = await getSetting(c.env, "discogs_token");
  if (!token) {
    return c.json({ error: "未配置 Discogs token（管理后台 → Discogs）" }, 400);
  }
  const body = await requestObject(c);
  const ref = discogsIdFrom(body?.url);
  if (!ref) {
    return c.json({ error: "认不出这个链接——要 discogs.com 的 release 或 master 页地址" }, 400);
  }
  try {
    const r = await fetchWithTimeout(
      `https://api.discogs.com/${ref.kind}/${ref.id}?token=${token}`,
      { headers: { "User-Agent": "mihonban/1.0 +private-library" } });
    if (r.status === 401) throw new Error("Discogs token 无效");
    if (r.status === 404) throw new Error("Discogs 上没有这个编号");
    if (!r.ok) throw new Error(`Discogs ${r.status}`);
    const d = await r.json();
    // "Artist (2)" 的消歧编号去掉
    const artist = (d.artists || [])
      .map((a) => (a.name || "").replace(/ \(\d+\)$/, "")).join(", ");
    return c.json({
      title: [artist, d.title].filter(Boolean).join(" – ") || "",
      year: d.year || "",
      genres: d.genres || [], styles: d.styles || [],
      url: d.uri || body.url,
    });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

/* ---------- Discogs 图片导入（专辑图 / 歌手头像+简介） ----------
   服务器直接从 Discogs 拉图上传到云盘，浏览器不经手。只走官方 API。 */

// 拉一个 Discogs release/master 的图片清单（primary 在前）
async function discogsImages(token, kind, id) {
  const r = await fetchWithTimeout(
    `https://api.discogs.com/${kind}/${id}?token=${token}`,
    { headers: { "User-Agent": "mihonban/1.0 +private-library" } });
  if (r.status === 401) throw new Error("Discogs token 无效");
  if (r.status === 404) throw new Error("Discogs 上没有这个编号");
  if (!r.ok) throw new Error(`Discogs ${r.status}`);
  const d = await r.json();
  const imgs = (d.images || []).map((im, i) => ({
    idx: i,
    type: im.type || "secondary",
    uri: im.uri || im.resource_url || "",
    thumb: im.uri150 || im.uri || "",
    w: im.width || 0, h: im.height || 0,
  })).filter((im) => im.uri);
  imgs.sort((a, b) => (a.type === "primary" ? -1 : 0) - (b.type === "primary" ? -1 : 0));
  return { images: imgs, profile: d.profile || "" };
}

// Discogs 图片受防盗链保护，必须带 Referer/User-Agent 才能取到字节
async function fetchDiscogsBytes(uri) {
  if (!isDiscogsImageUrl(uri)) {
    throw new Error("Discogs 图片地址无效");
  }
  const r = await fetchWithTimeout(uri, {
    headers: {
      "User-Agent": "mihonban/1.0 +private-library",
      "Referer": "https://www.discogs.com/",
    },
  });
  if (!r.ok) throw new Error(`图片下载失败 ${r.status}`);
  const bytes = await readResponseLimited(r, 12 * 1024 * 1024);
  const ct = imageMimeFromBytes(bytes);
  if (!ct) throw new Error("Discogs 返回的内容不是受支持的图片");
  return { bytes, ct };
}

const DISCOGS_ID_RE = /^\d{1,12}$/;
function discogsIdFrom(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 2048) return null;
  if (DISCOGS_ID_RE.test(text)) return { kind: "releases", id: text };
  let url;
  try {
    // Keep accepting the old host/path form, but never let a substring such
    // as evil-discogs.com pass the host check.
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "discogs.com" && host !== "www.discogs.com") return null;
  const m = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(release|master)s?\/(\d+)(?:\/|$)/i
    .exec(url.pathname);
  if (!m || !DISCOGS_ID_RE.test(m[2])) return null;
  return { kind: m[1].toLowerCase() === "master" ? "masters" : "releases", id: m[2] };
}

function isDiscogsImageUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      (host === "discogs.com" || host.endsWith(".discogs.com"));
  } catch {
    return false;
  }
}

// 列出某 Discogs release/master 的可选图片（前端预览勾选）
app.post("/api/album/:id/discogs-image-list", async (c) => {
  const token = await getSetting(c.env, "discogs_token");
  if (!token) return c.json({ error: "未配置 Discogs token" }, 400);
  const body = await requestObject(c);
  const d = discogsIdFrom(body?.ref);
  if (!d) return c.json({ error: "认不出 Discogs 编号/链接" }, 400);
  try {
    const { images } = await discogsImages(token, d.kind, d.id);
    return c.json({ images });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

// Return a verified Discogs image through the authenticated same-origin API so
// the browser can load it into canvas without depending on Discogs CORS rules.
app.post("/api/album/:id/discogs-image-source", async (c) => {
  const token = await getSetting(c.env, "discogs_token");
  if (!token) return c.json({ error: "未配置 Discogs token" }, 400);
  const album = await c.env.DB.prepare(
    "SELECT 1 FROM albums WHERE id = ?").bind(c.req.param("id")).first();
  if (!album) return c.json({ error: "not found" }, 404);
  const body = await requestObject(c);
  const d = discogsIdFrom(body?.ref);
  if (!d || !isDiscogsImageUrl(body?.uri)) {
    return c.json({ error: "Discogs 图片参数无效" }, 400);
  }
  try {
    const { images } = await discogsImages(token, d.kind, d.id);
    if (!images.some((image) => image.uri === body.uri)) {
      return c.json({ error: "选择的图片不属于该发行" }, 400);
    }
    const { bytes, ct } = await fetchDiscogsBytes(body.uri);
    return new Response(bytes, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

// 导入选中的专辑图片：下载 → 传到 <folder>/artwork/ → 登记 album_images；
// asCover=true 时把第一张设为封面
app.post("/api/album/:id/discogs-import-images", async (c) => {
  const token = await getSetting(c.env, "discogs_token");
  if (!token) return c.json({ error: "未配置 Discogs token" }, 400);
  const id = c.req.param("id");
  const album = await c.env.DB.prepare(
    "SELECT folder, cover_path, storage_id FROM albums WHERE id = ?").bind(id).first();
  if (!album) return c.json({ error: "not found" }, 404);
  const body = await requestObject(c);
  const { ref, uris, asCover } = body || {};
  const d = discogsIdFrom(ref);
  if (!d) return c.json({ error: "认不出 Discogs 编号/链接" }, 400);
  if (!Array.isArray(uris) || !uris.length || uris.length > 50
      || uris.some((uri) => !isDiscogsImageUrl(uri))) {
    return c.json({ error: "没有选择图片" }, 400);
  }
  if (asCover !== undefined && typeof asCover !== "boolean") {
    return c.json({ error: "asCover 必须是布尔值" }, 400);
  }
  try {
    // 校验 uris 确实属于该 release（不接受任意外链）
    const { images } = await discogsImages(token, d.kind, d.id);
    const allowed = new Set(images.map((im) => im.uri));
    const picked = [...new Set(uris)].filter((u) => allowed.has(u));
    if (!picked.length) return c.json({ error: "选择的图片不属于该发行" }, 400);

    const imported = [];
    let failed = 0;
    let coverSet = false;
    const sid = album.storage_id || null;
    for (let i = 0; i < picked.length; i++) {
      let bytes, ct;
      try {
        const image = await fetchDiscogsBytes(picked[i]);
        bytes = image.bytes; ct = image.ct;
      } catch { failed++; continue; }
      if (bytes.byteLength > 12 * 1024 * 1024) { failed++; continue; }
      const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
      const stamp = `${Date.now().toString(36)}${i}`;
      const path = `${album.folder}/artwork/discogs-${stamp}.${ext}`;
      const ok = await storage.putSmallFile(c.env, path, bytes, ct, sid);
      if (!ok) { failed++; continue; }
      // asCover：第一张顶替封面
      if (asCover && !coverSet) {
        const coverPath = `${album.folder}/cover.${ext}`;
        const coverOk = await storage.putSmallFile(c.env, coverPath, bytes, ct, sid);
        if (coverOk) {
          await c.env.DB.prepare("UPDATE albums SET cover_path = ? WHERE id = ?")
            .bind(coverPath, id).run();
          await invalidateR2(c.env, `art:${id}:`); // 封面变了，清 R2 镜像
          coverSet = true;
        }
      }
      const imgId = await sha16(path);
      await c.env.DB.prepare(`
        INSERT INTO album_images (id, album_id, path, sort, created_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
        .bind(imgId, id, path, i, Date.now()).run();
      imported.push(imgId);
    }
    if (imported.length || coverSet) {
      await c.env.DB.prepare("UPDATE albums SET updated_at = ? WHERE id = ?")
        .bind(Date.now(), id).run();
    }
    return c.json({
      ok: true, imported: imported.length, failed, coverSet,
      coverFailed: !!asCover && imported.length > 0 && !coverSet,
    });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

// 歌手：从 Discogs 搜同名艺人，取头像+简介预览（前端确认后再导入）
app.post("/api/artist-discogs-search", async (c) => {
  const token = await getSetting(c.env, "discogs_token");
  if (!token) return c.json({ error: "未配置 Discogs token" }, 400);
  const body = await requestObject(c);
  const name = boundedText(body?.name, 300, { allowEmpty: false });
  if (name === INVALID_INPUT) return c.json({ error: "name 格式无效" }, 400);
  try {
    const u = new URL("https://api.discogs.com/database/search");
    u.searchParams.set("q", name);
    u.searchParams.set("type", "artist");
    u.searchParams.set("per_page", "6");
    u.searchParams.set("token", token);
    const r = await fetchWithTimeout(u,
      { headers: { "User-Agent": "mihonban/1.0 +private-library" } });
    if (!r.ok) throw new Error(`Discogs ${r.status}`);
    const results = (await r.json()).results || [];
    return c.json({
      candidates: results.slice(0, 6).map((x) => ({
        id: x.id, title: x.title || "", thumb: x.thumb || "",
        url: x.id ? `https://www.discogs.com/artist/${x.id}` : "",
      })),
    });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

// 取某 Discogs 艺人的头像+简介（预览用）
app.post("/api/artist-discogs-detail", async (c) => {
  const token = await getSetting(c.env, "discogs_token");
  if (!token) return c.json({ error: "未配置 Discogs token" }, 400);
  const body = await requestObject(c);
  const artistId = typeof body?.artistId === "string"
    ? body.artistId.trim()
    : (Number.isSafeInteger(body?.artistId) ? String(body.artistId) : "");
  if (!DISCOGS_ID_RE.test(artistId)) {
    return c.json({ error: "artistId 格式无效" }, 400);
  }
  try {
    const r = await fetchWithTimeout(
      `https://api.discogs.com/artists/${artistId}?token=${token}`,
      { headers: { "User-Agent": "mihonban/1.0 +private-library" } });
    if (!r.ok) throw new Error(`Discogs ${r.status}`);
    const d = await r.json();
    const imgs = (d.images || []).map((im) => ({
      uri: im.uri || "", thumb: im.uri150 || im.uri || "",
      type: im.type || "secondary",
    })).filter((im) => im.uri);
    imgs.sort((a, b) => (a.type === "primary" ? -1 : 0) - (b.type === "primary" ? -1 : 0));
    // Discogs profile 用 [b]…[/b] BBCode + [a=名] 艺人链接，简单清洗成纯文本
    const profile = (d.profile || "")
      .replace(/\[\/?[abiu](=[^\]]+)?\]/gi, "")
      .replace(/\[url=[^\]]+\]|\[\/url\]/gi, "")
      .trim();
    return c.json({ name: d.name || "", images: imgs, profile });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

// 导入歌手头像/简介：下载头像传到艺人目录（唯一文件名）+ 写简介
app.post("/api/artists/:name/discogs-import", async (c) => {
  const token = await getSetting(c.env, "discogs_token");
  if (!token) return c.json({ error: "未配置 Discogs token" }, 400);
  const name = artistNameParam(c);
  const body = await requestObject(c);
  const { avatarUri, profile, setAvatar, setBio } = body || {};
  if ((avatarUri !== undefined &&
       (typeof avatarUri !== "string"
        || (avatarUri !== "" && !isDiscogsImageUrl(avatarUri))))
      || (profile !== undefined &&
        (typeof profile !== "string" || profile.length > 100_000))
      || (setAvatar !== undefined && typeof setAvatar !== "boolean")
      || (setBio !== undefined && typeof setBio !== "boolean")) {
    return c.json({ error: "Discogs 导入参数无效" }, 400);
  }
  // 找该艺人任一专辑目录，头像放其上一级（与专辑同 storage）
  const alb = await c.env.DB.prepare(
    "SELECT folder, storage_id FROM albums WHERE artist = ? LIMIT 1").bind(name).first();
  try {
    let avatarSet = false;
    let avatarPath = "";
    let avatarError = "";
    if (setAvatar && avatarUri) {
      if (!alb) {
        avatarError = "曲库里还没有该艺人的音盤，无法确定头像存放目录";
      } else {
        const artistDir = alb.folder.split("/").slice(0, -1).join("/");
        if (!artistDir) {
          avatarError = "音盤路径异常，无法推导艺人目录";
        } else {
          const { bytes, ct } = await fetchDiscogsBytes(avatarUri);
          if (bytes.byteLength > 12 * 1024 * 1024) {
            avatarError = "图片超过 12MB";
          } else {
            // 唯一文件名：每次导入新路径 → R2 key 变，彻底避开「同路径覆盖」缓存
            const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
            const stamp = `${Date.now().toString(36)}-${(await sha16(
              String.fromCharCode(...new Uint8Array(bytes.slice(0, 64))))).slice(0, 8)}`;
            const path = `${artistDir}/avatar-${stamp}.${ext}`;
            const prev = await c.env.DB.prepare(
              "SELECT avatar_path FROM artists WHERE name = ?").bind(name).first();
            if (prev?.avatar_path) {
              await invalidateR2(c.env, `artist:${await sha16(prev.avatar_path)}:`);
            }
            const ok = await storage.putSmallFile(
              c.env, path, bytes, ct, alb.storage_id || null);
            if (ok) {
              await c.env.DB.prepare(`
                INSERT INTO artists (name, avatar_path, storage_id) VALUES (?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET
                  avatar_path = excluded.avatar_path,
                  storage_id = excluded.storage_id`)
                .bind(name, path, alb.storage_id || null).run();
              // 清「无头像时的 fallback 缓存键」
              await invalidateR2(c.env, `artist-fallback:${await sha16(name)}:`);
              // R2 优先：导入后立刻镜像头像
              const conf = await r2.r2Conf(c.env);
              if (conf.ready) {
                const cacheKey = `artist:${await sha16(path)}:480`;
                const ctx = await ctxOf(c);
                const job = mirrorImageToR2(
                  c.env, conf, cacheKey, path, "c480x480", alb.storage_id || null);
                const safeJob = job.catch(() => "fail");
                if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(safeJob);
                else await safeJob;
              }
              avatarSet = true;
              avatarPath = path;
            } else {
              avatarError = "写入云盘失败（检查存储凭据/权限）";
            }
          }
        }
      }
    }
    let bioSet = false;
    if (setBio && profile && profile.trim()) {
      await c.env.DB.prepare(
        "INSERT INTO artists (name, avatar_path) VALUES (?, '') " +
        "ON CONFLICT(name) DO NOTHING").bind(name).run();
      await c.env.DB.prepare(`
        INSERT INTO notes (kind, id, text, updated_at) VALUES ('artistbio', ?, ?, ?)
        ON CONFLICT(kind, id) DO UPDATE SET text = excluded.text,
          updated_at = excluded.updated_at`)
        .bind(name, profile.trim(), Date.now()).run();
      bioSet = true;
    }
    if (setAvatar && avatarUri && !avatarSet && !bioSet) {
      return c.json({ error: avatarError || "头像导入失败" }, 502);
    }
    return c.json({
      ok: true, avatarSet, bioSet, avatarPath,
      ...(avatarError && setAvatar ? { avatarError } : {}),
    });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

/* ---------- 播放与封面 ---------- */

const AUDIO_MIME = {
  mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg",
  opus: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", alac: "audio/mp4",
  wav: "audio/wav", aiff: "audio/aiff", aif: "audio/aiff",
};

const AUDIO_RETRYABLE = new Set([429, 502, 503, 504]);
const AUDIO_FETCH_TIMEOUT_MS = 25_000;
const MAX_BUFFERED_IMAGE_BYTES = 16 * 1024 * 1024;

function audioRetryDelay(response, attempt) {
  const raw = response?.headers.get("Retry-After");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), 1200);
    const at = Date.parse(raw);
    if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), 1200);
  }
  return Math.min(250 * (2 ** attempt), 1000);
}

async function fetchAudioSource(url, headers) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUDIO_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!AUDIO_RETRYABLE.has(response.status) || attempt === 2) return response;
      const delay = audioRetryDelay(response, attempt);
      await discardResponse(response);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve,
        audioRetryDelay(null, attempt)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("audio source unavailable");
}

app.get("/api/stream/:trackId", async (c) => {
  const t = await c.env.DB.prepare(`
    SELECT t.path, a.storage_id, COALESCE(a.hidden,0) AS hidden FROM tracks t
    JOIN albums a ON a.id = t.album_id WHERE t.id = ?`)
    .bind(c.req.param("trackId")).first();
  if (!t) return c.json({ error: "not found" }, 404);
  if (t.hidden && !canSeeHidden(c)) {
    return c.json({ error: "not found" }, 404);
  }
  const ext = t.path.split(".").pop().toLowerCase();
  const range = c.req.header("Range") || c.req.header("range");

  let url = await storage.downloadUrl(c.env, t.path, t.storage_id)
    .catch(() => null);
  // stream_proxy=1：开启音源代理
  // stream_proxy_url：可选自定义代理（其它 Worker / 中转）；空则本站 /api/stream 自代理
  // ?proxy=1：单次强制本站代理（前端预取用，避 CORS）
  const proxyTpl = ((await getSetting(c.env, "stream_proxy_url")) || "").trim();
  const onceProxy = c.req.query("proxy") === "1";
  const proxyOn = (await getSetting(c.env, "stream_proxy")) === "1";
  if (url) {
    // 自定义外部代理：把 OneDrive 直链交给代理地址（仅音频）
    // 模板：https://proxy.example.com/?url={url}  或  https://proxy.example.com/  （自动拼 ?url=）
    if (proxyOn && proxyTpl && !onceProxy) {
      let target;
      if (proxyTpl.includes("{url}")) {
        target = proxyTpl.replaceAll("{url}", encodeURIComponent(url));
      } else {
        const sep = proxyTpl.includes("?") ? "&" : "?";
        target = `${proxyTpl}${sep}url=${encodeURIComponent(url)}`;
      }
      // The external proxy accepts a short-lived HMAC hand-off. Keep the
      // unsigned mode for compatibility, but production should set the same
      // STREAM_PROXY_SECRET on both Workers.
      if (c.env.STREAM_PROXY_SECRET) {
        if (typeof c.env.STREAM_PROXY_SECRET !== "string"
            || c.env.STREAM_PROXY_SECRET.length < 32) {
          return c.json({
            error: "STREAM_PROXY_SECRET 必须至少 32 个字符",
          }, 503);
        }
        target = await signProxyTarget(target, url, c.env.STREAM_PROXY_SECRET);
      }
      return temporaryRedirect(target);
    }
    // 本站代理：mp3 默认 302 直链；开启代理或 ?proxy=1 时经本 Worker 转发
    const selfProxy = onceProxy || (proxyOn && !proxyTpl);
    if (ext === "mp3" && !selfProxy) return temporaryRedirect(url);
    const fwd = {};
    if (range) fwd.Range = range;
    let r = null;
    try {
      r = await fetchAudioSource(url, fwd);
    } catch { /* 清直链并重取后再决定是否失败 */ }
    // OneDrive 临时 URL/边缘节点失效：清缓存向 Graph 取新 URL，再快速试一轮。
    if (!r || AUDIO_RETRYABLE.has(r.status) || [401, 403, 404].includes(r.status)) {
      if (r) await discardResponse(r);
      await storage.invalidateDownloadUrl(c.env, t.path, t.storage_id)
        .catch(() => false);
      const fresh = await storage.downloadUrl(c.env, t.path, t.storage_id)
        .catch(() => null);
      if (fresh) {
        url = fresh;
        try { r = await fetchAudioSource(url, fwd); } catch { /* handled below */ }
      }
    }
    if (!r || !(r.ok || r.status === 206)) {
      try {
        const direct = await storage.getFile(c.env, t.path, t.storage_id, range);
        if (direct?.status === 416) return audioResponse(direct, ext);
        if (direct && (direct.ok || direct.status === 206)) {
          return audioResponse(direct, ext);
        }
        if (direct) await discardResponse(direct);
      } catch { /* handled below */ }
      if (r?.status === 416) return audioResponse(r, ext);
      // 默认模式下最后退回微软直链，让用户网络直接尝试；显式代理模式保持 502。
      if (!selfProxy && url) return temporaryRedirect(url);
      return c.json({ error: r ? `源站 ${r.status}` : "源站连接失败" }, 502);
    }
    return audioResponse(r, ext);
  }
  // 无直链的后端（WebDAV / Local）：只能本站代理字节
  try {
    const r = await storage.getFile(c.env, t.path, t.storage_id, range);
    if (r?.status === 416) return audioResponse(r, ext);
    if (!r || !(r.ok || r.status === 206)) {
      if (r) await discardResponse(r);
      return c.json({ error: "storage item unavailable" }, 502);
    }
    return audioResponse(r, ext);
  } catch {
    return c.json({ error: "storage item unavailable" }, 502);
  }
});

// 统一的音频响应头（正确 MIME + inline + Range 透传）
function audioResponse(r, ext) {
  const h = new Headers();
  h.set("Content-Type", AUDIO_MIME[ext] || "application/octet-stream");
  h.set("Content-Disposition", "inline");
  for (const k of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
    const v = r.headers.get(k);
    if (v) h.set(k, v);
  }
  h.set("Accept-Ranges", r.headers.get("Accept-Ranges") || "bytes");
  h.set("Cache-Control", "private, no-store");
  return new Response(r.body, { status: r.status, headers: h });
}

const COVER_NAMES = /^(cover|folder|front|albumart.*)\.(jpe?g|png|webp)$/i;

async function resolveCover(env, album) {
  if (album.cover_path) return album.cover_path;
  const kids = await storage.listChildren(env, album.folder, album.storage_id);
  const images = kids.filter((k) => k.image ||
    /\.(jpe?g|png|webp)$/i.test(k.name));
  if (!images.length) return null;
  const best = images.find((k) => COVER_NAMES.test(k.name)) || images[0];
  const path = `${album.folder}/${best.name}`;
  await env.DB.prepare("UPDATE albums SET cover_path = ? WHERE id = ?")
    .bind(path, album.id).run();
  return path;
}

/* ---------- R2 图床：命中即 302 到 CDN，未命中从 OneDrive 取并懒同步 ----------
   cacheKey 是逻辑键（art:<id>:<size> 等）；srcPath 是 OneDrive 路径；
   dim 是缩略图规格。图片字节走 CDN，不打 Graph API、不过 Worker。 */
async function ctxOf(c) {
  try { return c.executionCtx; } catch { return null; }
}

const R2_IMAGE_EXT_BY_MIME = {
  "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "image/avif": "avif", "image/jpeg": "jpg",
};
const R2_IMAGE_EXTENSIONS = new Set(Object.values(R2_IMAGE_EXT_BY_MIME));
const r2ImageKeyBase = (cacheKey) =>
  `img/${cacheKey.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
const r2ImageObjectKey = (cacheKey, contentType) =>
  `${r2ImageKeyBase(cacheKey)}.${R2_IMAGE_EXT_BY_MIME[contentType] || "jpg"}`;

async function recordR2Mirror(env, cacheKey, r2Key, cachePolicy = 1) {
  await env.DB.prepare(
    "INSERT INTO r2_cache (cache_key, r2_key, created_at, cache_policy) " +
    "VALUES (?,?,?,?) " +
    "ON CONFLICT(cache_key) DO UPDATE SET " +
    "r2_key = excluded.r2_key, created_at = excluded.created_at, " +
    "cache_policy = excluded.cache_policy")
    .bind(cacheKey, r2Key, Date.now(), cachePolicy).run();
}

async function mirrorImageBytes(c, conf, cacheKey, bytes, contentType) {
  const r2Key = r2ImageObjectKey(cacheKey, contentType);
  const upload = (async () => {
    const ok = await r2.r2Put(conf, r2Key, bytes, contentType);
    if (ok) await recordR2Mirror(c.env, cacheKey, r2Key);
  })();
  const ctx = await ctxOf(c);
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(upload);
    return;
  }
  await upload;
}

async function validImageResponse(response) {
  if (!response?.ok) return null;
  let bytes;
  try { bytes = await readResponseLimited(response, MAX_BUFFERED_IMAGE_BYTES); }
  catch { return null; }
  const contentType = imageMimeFromBytes(bytes);
  return contentType ? { bytes, contentType } : null;
}

async function readStoredImage(env, srcPath, dim, storageId) {
  // A OneDrive thumbnail URL may occasionally return a transient non-image
  // body with HTTP 200. Validate bytes, then fall back to the original direct
  // URL and finally the authenticated provider read instead of surfacing a
  // broken cover to the browser.
  const urls = [];
  if (dim) {
    try {
      const thumbnail = await storage.thumbnailUrl(env, srcPath, dim, storageId);
      if (thumbnail) urls.push(thumbnail);
    } catch { /* continue to the original file */ }
  }
  try {
    const direct = await storage.downloadUrl(env, srcPath, storageId);
    if (direct && !urls.includes(direct)) urls.push(direct);
  } catch { /* continue to the authenticated provider read */ }
  for (const url of urls) {
    try {
      const image = await validImageResponse(await fetchWithTimeout(url));
      if (image) return image;
    } catch { /* try the next source */ }
  }
  try {
    return await validImageResponse(
      await storage.getFile(env, srcPath, storageId));
  } catch {
    return null;
  }
}

async function claimExistingR2Image(env, conf, cacheKey, srcPath) {
  const sourceMatch = /\.([a-z0-9]+)$/i.exec(srcPath);
  const sourceExt = sourceMatch?.[1]?.toLowerCase() === "jpeg"
    ? "jpg" : sourceMatch?.[1]?.toLowerCase();
  const extensions = ["jpg"];
  if (sourceExt && R2_IMAGE_EXTENSIONS.has(sourceExt) && sourceExt !== "jpg") {
    extensions.push(sourceExt);
  }
  for (const ext of extensions) {
    const r2Key = `${r2ImageKeyBase(cacheKey)}.${ext}`;
    const exists = await r2.r2PublicObjectExists(conf, r2Key);
    if (!exists) continue;
    // The object predates this deployment, so its browser-cache metadata is
    // unknown. It will be upgraded in-place the next time it is served.
    await recordR2Mirror(env, cacheKey, r2Key, 0);
    return true;
  }
  return false;
}

async function serveImageR2(c, cacheKey, srcPath, dim, cacheControl,
  storageId = null, allowPublicMirror = true) {
  const conf = await r2.r2Conf(c.env);
  // 1) R2 已镜像 → 直接 302 到公开 CDN（优先于边缘缓存，避免旧的 200 字节挡路）
  if (conf.ready && allowPublicMirror) {
    const row = await c.env.DB.prepare(
      "SELECT r2_key, created_at, cache_policy FROM r2_cache WHERE cache_key = ?")
      .bind(cacheKey).first();
    if (row) {
      let version = row.created_at;
      if (!row.cache_policy) {
        const upgrade = (async () => {
          const contentType = Object.entries(R2_IMAGE_EXT_BY_MIME)
            .find(([, extension]) => row.r2_key.endsWith(`.${extension}`))?.[0]
            || "image/jpeg";
          if (!(await r2.r2ApplyImageCacheControl(
            conf, row.r2_key, contentType))) return null;
          const upgradedAt = Date.now();
          await c.env.DB.prepare(`UPDATE r2_cache
            SET cache_policy = 1, created_at = ?
            WHERE cache_key = ? AND r2_key = ?`)
            .bind(upgradedAt, cacheKey, row.r2_key).run();
          return upgradedAt;
        })().catch(() => null);
        const ctx = await ctxOf(c);
        if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(upgrade);
        else version = (await upgrade) || version;
      }
      return publicImageRedirect(
        r2.r2PublicUrl(conf, row.r2_key, version));
    }
  }
  // 2) 未镜像：查边缘缓存（R2 未启用时这是唯一的加速层）
  const edge = globalThis.caches?.default;
  const allowEdgeCache = !!edge && !conf.ready && allowPublicMirror;
  const edgeKey = new Request(c.req.url);
  if (allowEdgeCache) {
    const hit = await edge.match(edgeKey);
    if (hit) return hit;
  }
  // 3) 从所属存储取字节（有缩略图直链的用直链；WebDAV 等直接代理读原图）
  const source = await readStoredImage(c.env, srcPath, dim, storageId);
  if (!source) return null;
  const { bytes, contentType: ct } = source;
  // 4) 懒同步到 R2（后台，不阻塞响应）
  if (conf.ready && allowPublicMirror) {
    await mirrorImageBytes(c, conf, cacheKey, bytes, ct)
      .catch(() => null); // optional mirror failure must not fail the image
  }
  const res = new Response(bytes, {
    headers: {
      "Content-Type": ct,
      // When R2 is enabled this stable API URL is only the one-request
      // fallback while the versioned mirror is being created. Caching it
      // would let an old cover outlive a later mirror-version change.
      "Cache-Control": conf.ready ? "private, no-store" : cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
  // R2 未启用时才落边缘缓存（启用时靠 R2 CDN，避免陈旧字节挡住 302）
  if (allowEdgeCache) {
    const ctx = await ctxOf(c);
    const cacheWrite = edge.put(edgeKey, res.clone()).catch(() => null);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cacheWrite);
    else await cacheWrite;
  }
  return res;
}

async function purgeR2Prefixes(env, prefixes, requireRemote = false) {
  const uniquePrefixes = [...new Set(prefixes.filter(Boolean))];
  const rowsByKey = new Map();
  for (const prefix of uniquePrefixes) {
    const { results } = await env.DB.prepare(`
      SELECT cache_key, r2_key FROM r2_cache
      WHERE substr(cache_key, 1, length(?)) = ?`)
      .bind(prefix, prefix).all();
    for (const row of results) rowsByKey.set(row.cache_key, row);
  }
  const rows = [...rowsByKey.values()];
  if (!rows.length) return true;

  const conf = await r2.r2Conf(env);
  const canDelete = !!(conf.accessKey && conf.secretKey
    && conf.endpoint && conf.bucket);
  let remoteOk = canDelete;
  if (canDelete) {
    for (const row of rows) {
      try {
        if (!(await r2.r2Delete(conf, row.r2_key))) remoteOk = false;
      } catch {
        remoteOk = false;
      }
      if (!remoteOk && requireRemote) return false;
    }
  }
  if (requireRemote && !remoteOk) return false;

  // Remove exact prefix ranges without LIKE/GLOB so user-derived characters
  // can never become SQLite wildcard patterns.
  for (const prefix of uniquePrefixes) {
    await env.DB.prepare(`DELETE FROM r2_cache
      WHERE substr(cache_key, 1, length(?)) = ?`)
      .bind(prefix, prefix).run();
  }
  return remoteOk;
}

// Invalidate changed images. Remote deletion is best-effort here: a stale
// public object is no longer referenced and a new request can re-mirror it.
async function invalidateR2(env, prefix) {
  return purgeR2Prefixes(env, [prefix], false);
}

async function purgeAlbumR2(env, albumId, requireRemote = false) {
  const { results: images } = await env.DB.prepare(
    "SELECT id FROM album_images WHERE album_id = ?").bind(albumId).all();
  return purgeR2Prefixes(env, [
    `art:${albumId}:`,
    ...images.map((image) => `img:${image.id}:`),
  ], requireRemote);
}

async function purgeArtistR2(env, artist, requireRemote = false) {
  const row = await env.DB.prepare(
    "SELECT avatar_path FROM artists WHERE name = ?").bind(artist).first();
  const prefixes = [`artist-fallback:${await sha16(artist)}:`];
  if (row?.avatar_path) {
    prefixes.push(`artist:${await sha16(row.avatar_path)}:`);
  }
  return purgeR2Prefixes(env, prefixes, requireRemote);
}

app.get("/api/art/:albumId", async (c) => {
  const size = imageSizeParam(c.req.query("s"), 400);
  if (size === INVALID_INPUT || size === 0) {
    return c.json({ error: "s 参数必须是 1 到 10000 的整数" }, 400);
  }
  const album = await c.env.DB.prepare(
    "SELECT id, folder, cover_path, storage_id, hidden FROM albums WHERE id = ?")
    .bind(c.req.param("albumId")).first();
  if (!album) return c.json({ error: "not found" }, 404);
  if (album.hidden && !canSeeHidden(c)) {
    return c.json({ error: "not found" }, 404);
  }
  const cover = await resolveCover(c.env, album);
  if (!cover) return c.body(PLACEHOLDER_SVG, 200,
    { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" });

  // A cover is a visual identity, not a responsive thumbnail. Manual and
  // Discogs cover crops are already square files; asking OneDrive for another
  // square thumbnail can crop them again and even choose a different focal
  // window at each size. Mirror the stored bytes once and let browsers scale
  // that exact user-approved composition on every surface.
  const dim = null;
  const logicalKey = `art:${album.id}:original`;
  // proxy=1：始终回源字节（不 302 到 R2/Graph），供前端 canvas/裁剪用，避免跨域 Failed to fetch
  const wantProxy = c.req.query("proxy") === "1" || c.req.query("inline") === "1";
  if (wantProxy) {
    const source = await readStoredImage(
      c.env, cover, dim, album.storage_id);
    if (!source) return c.json({ error: "cover unavailable" }, 502);
    const { bytes, contentType: ct } = source;
    // The browser reaches this branch after a public mirror returned an old
    // cached 404. Serve the source immediately and repair that mirror in the
    // background so subsequent devices return to the fast R2 path.
    if (c.req.query("fallback") === "1" && !album.hidden) {
      const conf = await r2.r2Conf(c.env);
      if (conf.ready) {
        await mirrorImageBytes(c, conf, logicalKey, bytes, ct)
          .catch(() => null);
      }
    }
    return new Response(bytes, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }
  const res = await serveImageR2(c, logicalKey, cover, dim,
    album.hidden ? "private, no-store" : "public, max-age=604800",
    album.storage_id, !album.hidden);
  if (!res) return c.json({ error: "cover unavailable" }, 502);
  return res;
});

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
<rect width="400" height="400" fill="#1a1713"/>
<circle cx="200" cy="200" r="120" fill="none" stroke="#2e2a22" stroke-width="2"/>
<circle cx="200" cy="200" r="80" fill="none" stroke="#2e2a22" stroke-width="1.5"/>
<circle cx="200" cy="200" r="14" fill="#2e2a22"/></svg>`;

/* ---------- 专辑登记 / 编辑（伴侣同步 + 网页上传共用） ---------- */

app.post("/api/albums", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "无效的专辑 JSON" }, 400);
  }
  const folder = safePath(c.env, body.folder);
  if (!folder) return c.json({ error: "folder 必须在曲库根目录下" }, 400);
  const artist = boundedText(body.artist, 500, { allowEmpty: false });
  const title = boundedText(body.title, 1000, { allowEmpty: false });
  if (artist === INVALID_INPUT || title === INVALID_INPUT
      || !Array.isArray(body.tracks) || !body.tracks.length
      || body.tracks.length > 20_000) {
    return c.json({ error: "artist / title / tracks 必填" }, 400);
  }
  const artistSortInput = body.artistSort === undefined
    ? artist : boundedText(body.artistSort, 500);
  const artistSort = artistSortInput === "" ? artist : artistSortInput;
  const year = finiteInput(body.year, { integer: true, min: 1, max: 9999 });
  const rymRating = finiteInput(body.rymRating, { min: 0, max: 5 });
  const rymVotes = finiteInput(body.rymVotes, {
    integer: true, min: 0, max: Number.MAX_SAFE_INTEGER,
  });
  const rymRank = boundedText(body.rymRank, 500);
  const rymUrl = validHttpUrl(body.rymUrl);
  const primaryGenres = strictTextList(body.genres);
  const secondaryGenres = strictTextList(body.secondaryGenres);
  const descriptors = strictTextList(body.descriptors, {
    maxItems: 500, maxItemLength: 500,
  });
  if ([artistSort, year, rymRating, rymVotes, rymRank, rymUrl,
    primaryGenres, secondaryGenres, descriptors].includes(INVALID_INPUT)) {
    return c.json({ error: "专辑元数据格式无效" }, 400);
  }
  if (body.coverPath !== undefined && body.coverPath !== null
      && typeof body.coverPath !== "string") {
    return c.json({ error: "coverPath 格式无效" }, 400);
  }
  const coverPath = body.coverPath ? safePath(c.env, body.coverPath) : "";
  if (body.coverPath && (!coverPath || !coverPath.startsWith(folder + "/"))) {
    return c.json({ error: "coverPath 必须在该专辑目录下" }, 400);
  }
  const genres = genreLists(primaryGenres, secondaryGenres);
  const id = await sha16(folder);
  const now = Date.now();
  // 新专辑落到当前写入目标；已存在的专辑保持原 storage_id（ON CONFLICT 不覆盖）
  const wt = await writeTarget(c.env);
  if (!wt) return c.json({ error: "请先设置一个命名存储写入目标" }, 400);
  const albumStmt = c.env.DB.prepare(`
      INSERT INTO albums (id, artist, artist_sort, title, year, folder,
        cover_path, rym_rating, rym_votes, rym_rank, rym_url,
        genres, sec_genres, descriptors, storage_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        artist=excluded.artist, artist_sort=excluded.artist_sort,
        title=excluded.title, year=excluded.year,
        cover_path=CASE WHEN excluded.cover_path != ''
                        THEN excluded.cover_path ELSE albums.cover_path END,
        rym_rating=COALESCE(excluded.rym_rating, albums.rym_rating),
        rym_votes=COALESCE(excluded.rym_votes, albums.rym_votes),
        rym_rank=CASE WHEN excluded.rym_rank != ''
                      THEN excluded.rym_rank ELSE albums.rym_rank END,
        rym_url=CASE WHEN excluded.rym_url != ''
                     THEN excluded.rym_url ELSE albums.rym_url END,
        genres=CASE WHEN excluded.genres != '[]'
                    THEN excluded.genres ELSE albums.genres END,
        sec_genres=CASE WHEN excluded.sec_genres != '[]'
                        THEN excluded.sec_genres ELSE albums.sec_genres END,
        descriptors=CASE WHEN excluded.descriptors != '[]'
                         THEN excluded.descriptors ELSE albums.descriptors END,
        updated_at=excluded.updated_at`)
      .bind(id, artist, artistSort, title, year, folder, coverPath,
        rymRating, rymVotes, rymRank, rymUrl, JSON.stringify(genres.primary),
        JSON.stringify(genres.secondary),
        JSON.stringify(descriptors), wt?.id || null, now, now);
  const seenTrackPaths = new Set();
  const seenTrackIds = new Set();
  const normalizedTracks = [];
  for (const t of body.tracks) {
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      return c.json({ error: "曲目条目格式无效" }, 400);
    }
    const path = safePath(c.env, t.path);
    if (!path || !path.startsWith(folder + "/")) {
      return c.json({ error: `track path 必须在该专辑目录中: ${t.path}` }, 400);
    }
    if (seenTrackPaths.has(path)) {
      return c.json({ error: `曲目路径重复: ${path}` }, 400);
    }
    seenTrackPaths.add(path);
    const track = finiteInput(t.track, {
      integer: true, min: 1, max: Number.MAX_SAFE_INTEGER,
    });
    const discInput = finiteInput(t.disc, {
      integer: true, min: 1, max: Number.MAX_SAFE_INTEGER,
    });
    const disc = discInput ?? 1;
    const duration = finiteInput(t.duration, { min: 0 });
    const bitrate = finiteInput(t.bitrate, { min: 0 });
    const size = finiteInput(t.size, { integer: true, min: 0,
      max: Number.MAX_SAFE_INTEGER });
    const fallbackTitle = path.split("/").pop();
    const titleInput = boundedText(t.title, 1000);
    const trackTitle = titleInput || fallbackTitle;
    const format = boundedText(t.format, 64);
    if ([track, discInput, duration, bitrate, size, titleInput, format]
      .includes(INVALID_INPUT)) {
      return c.json({ error: `曲目元数据格式无效: ${path}` }, 400);
    }
    const trackId = await sha16(path);
    if (seenTrackIds.has(trackId)) {
      return c.json({ error: `曲目 ID 冲突: ${path}` }, 409);
    }
    seenTrackIds.add(trackId);
    normalizedTracks.push({
      id: trackId, albumId: id, disc, track, title: trackTitle, duration,
      format, bitrate, size, path,
    });
  }
  // A path or truncated-hash id collision with another album must fail before
  // staging. A concurrent collision is still caught by the final UNIQUE write.
  const paths = [...seenTrackPaths];
  for (let i = 0; i < paths.length; i += D1_BATCH_SIZE) {
    const chunk = paths.slice(i, i + D1_BATCH_SIZE);
    const marks = chunk.map(() => "?").join(",");
    const { results: conflicts } = await c.env.DB.prepare(
      `SELECT path, album_id FROM tracks WHERE path IN (${marks})`)
      .bind(...chunk).all();
    const foreign = conflicts.find((row) => row.album_id !== id);
    if (foreign) {
      return c.json({ error: `曲目已经登记在其他专辑: ${foreign.path}` }, 409);
    }
  }
  const trackIds = [...seenTrackIds];
  for (let i = 0; i < trackIds.length; i += D1_BATCH_SIZE) {
    const chunk = trackIds.slice(i, i + D1_BATCH_SIZE);
    const marks = chunk.map(() => "?").join(",");
    const { results: conflicts } = await c.env.DB.prepare(
      `SELECT id, path, album_id FROM tracks WHERE id IN (${marks})`)
      .bind(...chunk).all();
    const foreign = conflicts.find((row) => row.album_id !== id
      || !seenTrackPaths.has(row.path));
    if (foreign) {
      return c.json({ error: `曲目 ID 已经被其他路径占用: ${foreign.path}` }, 409);
    }
  }

  const importId = crypto.randomUUID();
  const stageStatements = normalizedTracks.map((t) => c.env.DB.prepare(`
    INSERT INTO track_imports (import_id, id, album_id, disc, track, title,
      duration, format, bitrate, size, path, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(importId, t.id, t.albumId, t.disc, t.track, t.title, t.duration,
      t.format, t.bitrate, t.size, t.path, now));
  try {
    await runD1Batches(c.env.DB, stageStatements);
    // D1 batch is transactional. The live album is untouched until every
    // staged row exists, then metadata, favorites and tracks change together.
    await c.env.DB.batch([
      albumStmt,
      c.env.DB.prepare(`DELETE FROM favorites
        WHERE kind = 'track' AND item_id IN (
          SELECT id FROM tracks WHERE album_id = ? AND id NOT IN (
            SELECT id FROM track_imports WHERE import_id = ?
          )
        )`).bind(id, importId),
      c.env.DB.prepare("DELETE FROM tracks WHERE album_id = ?").bind(id),
      c.env.DB.prepare(`INSERT INTO tracks
        (id, album_id, disc, track, title, duration, format, bitrate, size, path)
        SELECT id, album_id, disc, track, title, duration, format, bitrate, size, path
        FROM track_imports WHERE import_id = ?`).bind(importId),
      c.env.DB.prepare("DELETE FROM track_imports WHERE import_id = ?")
        .bind(importId),
    ]);
  } catch (error) {
    await c.env.DB.prepare("DELETE FROM track_imports WHERE import_id = ?")
      .bind(importId).run().catch(() => null);
    throw error;
  }
  if (c.get("role") === "companion") {
    await setSetting(c.env, "companion_last_seen", String(Date.now()));
  }
  return c.json({ ok: true, id });
});

app.patch("/api/album/:id", async (c) => {
  const id = c.req.param("id");
  const b = await requestObject(c);
  if (!b) return c.json({ error: "请求 JSON 无效" }, 400);
  const current = await c.env.DB.prepare(
    "SELECT artist, folder, genres, sec_genres FROM albums WHERE id = ?")
    .bind(id).first();
  if (!current) return c.json({ error: "not found" }, 404);
  const sets = [], vals = [];
  const put = (column, value) => { sets.push(`${column} = ?`); vals.push(value); };
  let nextArtist = current.artist;
  if ("artist" in b) {
    nextArtist = boundedText(b.artist, 500, { allowEmpty: false });
    if (nextArtist === INVALID_INPUT) {
      return c.json({ error: "artist 格式无效" }, 400);
    }
    put("artist", nextArtist);
    // The edit form does not expose artistSort.  Keeping the former artist's
    // sort key after a rename makes the album appear under the wrong letter.
    if (!("artistSort" in b)) put("artist_sort", nextArtist);
  }
  if ("artistSort" in b) {
    const value = boundedText(b.artistSort, 500);
    if (value === INVALID_INPUT) {
      return c.json({ error: "artistSort 格式无效" }, 400);
    }
    put("artist_sort", value || nextArtist);
  }
  if ("title" in b) {
    const value = boundedText(b.title, 1000, { allowEmpty: false });
    if (value === INVALID_INPUT) return c.json({ error: "title 格式无效" }, 400);
    put("title", value);
  }
  const numericFields = [
    ["year", "year", { integer: true, min: 1, max: 9999 }],
    ["rymRating", "rym_rating", { min: 0, max: 5 }],
    ["rymVotes", "rym_votes", {
      integer: true, min: 0, max: Number.MAX_SAFE_INTEGER,
    }],
  ];
  for (const [key, column, options] of numericFields) {
    if (!(key in b)) continue;
    const value = finiteInput(b[key], options);
    if (value === INVALID_INPUT) {
      return c.json({ error: `${key} 格式无效` }, 400);
    }
    put(column, value);
  }
  if ("rymRank" in b) {
    const value = boundedText(b.rymRank, 500);
    if (value === INVALID_INPUT) return c.json({ error: "rymRank 格式无效" }, 400);
    put("rym_rank", value);
  }
  if ("rymUrl" in b) {
    const value = validHttpUrl(b.rymUrl);
    if (value === INVALID_INPUT) return c.json({ error: "rymUrl 格式无效" }, 400);
    put("rym_url", value);
  }
  if ("coverPath" in b) {
    if (typeof b.coverPath !== "string" && b.coverPath !== null) {
      return c.json({ error: "coverPath 格式无效" }, 400);
    }
    const p = b.coverPath ? safePath(c.env, b.coverPath) : "";
    if (b.coverPath && (!p || !p.startsWith(current.folder + "/"))) {
      return c.json({ error: "coverPath 必须在该专辑目录下" }, 400);
    }
    put("cover_path", p);
  }
  if ("descriptors" in b) {
    const descriptors = strictTextList(b.descriptors, {
      maxItems: 500, maxItemLength: 500,
    });
    if (descriptors === INVALID_INPUT) {
      return c.json({ error: "descriptors 格式无效" }, 400);
    }
    put("descriptors", JSON.stringify(descriptors));
  }
  // 主/副 Genre：无论 RYM 先还是 Discogs 先写入，落库前统一去重——
  // ①各自列表大小写去重 ②同一个 genre 不同时出现在主+副（主优先，副剔除重复）。
  // 本次只改了一侧时，用数据库现值补齐另一侧，保证交叉去重完整。
  if ("genres" in b || "secondaryGenres" in b) {
    const parse = (s) => J(s, []);
    const primary = "genres" in b
      ? strictTextList(b.genres) : strictTextList(parse(current.genres));
    const secondary = "secondaryGenres" in b
      ? strictTextList(b.secondaryGenres) : strictTextList(parse(current.sec_genres));
    if (primary === INVALID_INPUT || secondary === INVALID_INPUT) {
      return c.json({ error: "genre 格式无效" }, 400);
    }
    const lists = genreLists(
      primary, secondary);
    sets.push("genres = ?"); vals.push(JSON.stringify(lists.primary));
    sets.push("sec_genres = ?"); vals.push(JSON.stringify(lists.secondary));
  }
  let noteText = null;
  if ("note" in b) {
    if (typeof b.note !== "string" || b.note.length > 200_000) {
      return c.json({ error: "note 格式无效" }, 400);
    }
    noteText = b.note.trim();
  }
  if (!sets.length && !("note" in b)) {
    return c.json({ error: "没有可更新字段" }, 400);
  }
  const statements = [];
  if (sets.length) {
    sets.push("updated_at = ?"); vals.push(Date.now(), id);
    statements.push(c.env.DB.prepare(
      `UPDATE albums SET ${sets.join(", ")} WHERE id = ?`).bind(...vals));
  }
  if ("note" in b) {
    const text = noteText;
    if (text) {
      statements.push(c.env.DB.prepare(`
        INSERT INTO notes (kind, id, text, updated_at) VALUES ('album', ?, ?, ?)
        ON CONFLICT(kind, id) DO UPDATE SET text = excluded.text,
          updated_at = excluded.updated_at`).bind(id, text, Date.now()));
    } else {
      statements.push(c.env.DB.prepare(
        "DELETE FROM notes WHERE kind = 'album' AND id = ?").bind(id));
    }
  }
  if (statements.length) await c.env.DB.batch(statements);
  if (sets.length && "coverPath" in b) {
    await invalidateR2(c.env, `art:${id}:`); // 换封面清 R2
  }
  return c.json({ ok: true });
});

app.delete("/api/album/:id", async (c) => {
  const id = c.req.param("id");
  const album = await c.env.DB.prepare(
    "SELECT folder, storage_id, artist FROM albums WHERE id = ?").bind(id).first();
  if (!album) return c.json({ error: "not found" }, 404);
  // 删除会使旧的公开 CDN URL 失去其数据库引用；在真正删除目录前，
  // 必须确认已登记的 R2 镜像也被移除，避免已删除/私有音源仍可被已知 URL 访问。
  if (!(await purgeAlbumR2(c.env, id, true))) {
    return c.json({ error: "公开 R2 镜像删除失败，数据库未修改" }, 502);
  }
  const remainingArtistAlbums = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM albums WHERE artist = ? AND id != ?")
    .bind(album.artist, id).first();
  if (!remainingArtistAlbums?.n && !(await purgeArtistR2(c.env, album.artist, true))) {
    return c.json({ error: "艺人公开头像镜像删除失败，数据库未修改" }, 502);
  }
  let filesDeleted = false;
  if (c.req.query("files") === "1") {
    try {
      filesDeleted = await storage.deleteItem(
        c.env, album.folder, album.storage_id);
    } catch {
      filesDeleted = false;
    }
    if (!filesDeleted) {
      return c.json({ error: "存储中的专辑目录删除失败，数据库未修改" }, 502);
    }
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM favorites WHERE
      (kind = 'album' AND item_id = ?) OR (kind = 'track' AND item_id IN
        (SELECT id FROM tracks WHERE album_id = ?))`).bind(id, id),
    c.env.DB.prepare(
      "DELETE FROM notes WHERE kind = 'album' AND id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM album_images WHERE album_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM tracks WHERE album_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM albums WHERE id = ?").bind(id),
  ]);
  // 该艺人若已无任何音盤，清掉艺术家附加信息（头像/简介行）
  try {
    const left = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM albums WHERE artist = ?").bind(album.artist).first();
    if (!left?.n) {
      await c.env.DB.prepare("DELETE FROM artists WHERE name = ?").bind(album.artist).run();
      await c.env.DB.prepare(
        "DELETE FROM notes WHERE kind IN ('artist','artistbio') AND id = ?")
        .bind(album.artist).run();
    }
  } catch { /* ignore */ }
  return c.json({ ok: true, filesDeleted });
});

// 隐藏 / 恢复显示音盤（曲库列表默认不出现；管理员可 includeHidden 查看）
app.post("/api/album/:id/hide", async (c) => {
  const id = c.req.param("id");
  const body = await requestObject(c);
  const hidden = body?.hidden;
  if (![true, false, 1, 0, "1", "0"].includes(hidden)) {
    return c.json({ error: "hidden 参数无效" }, 400);
  }
  const on = hidden === true || hidden === 1 || hidden === "1";
  const album = await c.env.DB.prepare(
    "SELECT hidden, artist FROM albums WHERE id = ?").bind(id).first();
  if (!album) return c.json({ error: "not found" }, 404);
  if (on) {
    const purged = await purgeAlbumR2(c.env, id, true);
    if (!purged) {
      return c.json({
        error: "隐藏前无法删除公开 R2 镜像；请检查 R2 凭据后重试",
      }, 502);
    }
    const anotherVisible = await c.env.DB.prepare(`
      SELECT 1 FROM albums WHERE artist = ? AND id != ?
      AND COALESCE(hidden,0)=0 LIMIT 1`).bind(album.artist, id).first();
    if (!anotherVisible && !(await purgeArtistR2(c.env, album.artist, true))) {
      return c.json({
        error: "隐藏前无法删除公开艺人头像镜像；请检查 R2 凭据后重试",
      }, 502);
    }
  }
  await c.env.DB.prepare(
    "UPDATE albums SET hidden = ?, updated_at = ? WHERE id = ?")
    .bind(on ? 1 : 0, Date.now(), id).run();
  return c.json({ ok: true, hidden: on });
});

/* ---------- 专辑内页/写真图片（管理员上传，空则前端隐藏入口） ---------- */

app.post("/api/album/:id/images", async (c) => {
  const id = c.req.param("id");
  const album = await c.env.DB.prepare(
    "SELECT folder FROM albums WHERE id = ?").bind(id).first();
  if (!album) return c.json({ error: "not found" }, 404);
  const b = await requestObject(c);
  if (!b || typeof b.path !== "string") {
    return c.json({ error: "path 必填" }, 400);
  }
  const { path } = b;
  const p = safePath(c.env, path);
  if (!p || !p.startsWith(album.folder + "/")) {
    return c.json({ error: "path 必须在该专辑目录下" }, 400);
  }
  const imgId = await sha16(p);
  const priorImage = await c.env.DB.prepare(
    "SELECT album_id FROM album_images WHERE id = ?").bind(imgId).first();
  if (priorImage && priorImage.album_id !== id) {
    return c.json({ error: "该图片路径已经登记在其他专辑" }, 409);
  }
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO album_images (id, album_id, path, sort, created_at)
      SELECT ?, ?, ?, COALESCE(MAX(sort), -1) + 1, ?
      FROM album_images WHERE album_id = ?
      ON CONFLICT(id) DO NOTHING`)
      .bind(imgId, id, p, now, id),
    c.env.DB.prepare("UPDATE albums SET updated_at = ? WHERE id = ?")
      .bind(now, id),
  ]);
  return c.json({ ok: true, id: imgId });
});

// 内页图手动重排：前端传该专辑的完整有序 imgId 列表，落成 sort = 0..n-1
app.put("/api/album/:id/images/reorder", async (c) => {
  const id = c.req.param("id");
  const { ids } = await c.req.json().catch(() => ({}));
  if (!Array.isArray(ids) || ids.some((imgId) =>
    typeof imgId !== "string" || imgId.length > 128)) {
    return c.json({ error: "ids 必须是字符串数组" }, 400);
  }
  const { results } = await c.env.DB.prepare(
    "SELECT id FROM album_images WHERE album_id = ?").bind(id).all();
  const existing = new Set(results.map((row) => row.id));
  if (ids.length !== existing.size || new Set(ids).size !== ids.length
      || ids.some((imgId) => !existing.has(imgId))) {
    return c.json({ error: "ids 与当前专辑内页不一致（请先刷新页面）" }, 400);
  }
  const ordered = JSON.stringify(ids);
  await c.env.DB.batch([
    c.env.DB.prepare(`WITH ordered(id, position) AS (
      SELECT CAST(value AS TEXT), CAST(key AS INTEGER) FROM json_each(?)
    )
    UPDATE album_images SET sort = (
      SELECT position FROM ordered WHERE ordered.id = album_images.id
    )
    WHERE album_id = ? AND id IN (SELECT id FROM ordered)`)
      .bind(ordered, id),
    c.env.DB.prepare("UPDATE albums SET updated_at = ? WHERE id = ?")
      .bind(Date.now(), id),
  ]);
  return c.json({ ok: true });
});

app.delete("/api/album/:id/images/:imgId", async (c) => {
  const imgId = c.req.param("imgId");
  const row = await c.env.DB.prepare(
    "SELECT i.path, a.storage_id FROM album_images i " +
    "JOIN albums a ON a.id = i.album_id WHERE i.id = ? AND i.album_id = ?")
    .bind(imgId, c.req.param("id")).first();
  if (!row) return c.json({ error: "not found" }, 404);
  if (!(await purgeR2Prefixes(c.env, [`img:${imgId}:`], true))) {
    return c.json({ error: "公开 R2 图片镜像删除失败，数据库未修改" }, 502);
  }
  let fileDeleted = false;
  if (c.req.query("file") === "1") {
    try {
      fileDeleted = await storage.deleteItem(c.env, row.path, row.storage_id);
    } catch {
      fileDeleted = false;
    }
    if (!fileDeleted) {
      return c.json({ error: "存储中的图片删除失败，数据库未修改" }, 502);
    }
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM album_images WHERE id = ?").bind(imgId),
    c.env.DB.prepare("UPDATE albums SET updated_at = ? WHERE id = ?")
      .bind(Date.now(), c.req.param("id")),
  ]);
  return c.json({ ok: true, fileDeleted });
});

app.get("/api/image/:imgId", async (c) => {
  const row = await c.env.DB.prepare(`
    SELECT i.path, a.storage_id, COALESCE(a.hidden,0) AS hidden FROM album_images i
    JOIN albums a ON a.id = i.album_id WHERE i.id = ?`)
    .bind(c.req.param("imgId")).first();
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.hidden && !canSeeHidden(c)) {
    return c.json({ error: "not found" }, 404);
  }
  const size = imageSizeParam(c.req.query("s"), 0);
  if (size === INVALID_INPUT) {
    return c.json({ error: "s 参数必须是 0 到 10000 的整数" }, 400);
  }
  if (!size) {  // 原图：能直链就 302；无直链的后端走代理
    const url = await storage.downloadUrl(c.env, row.path, row.storage_id);
    if (url) return temporaryRedirect(url);
    const r = await storage.getFile(c.env, row.path, row.storage_id);
    if (!r) return c.json({ error: "image unavailable" }, 502);
    return new Response(r.body, { headers: {
      "Content-Type": imageMimeFromPath(row.path),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": row.hidden ? "private, no-store" : "public, max-age=604800",
    } });
  }
  const dim = size <= 480 ? "c480x480" : "c1000x1000";
  const logicalKey = `img:${c.req.param("imgId")}:${size <= 480 ? 480 : 1000}`;
  const res = await serveImageR2(c, logicalKey, row.path, dim,
    row.hidden ? "private, no-store" : "public, max-age=604800",
    row.storage_id, !row.hidden);
  if (!res) return c.json({ error: "image unavailable" }, 502);
  return res;
});

/* ---------- 专辑内曲目管理（管理员：加曲/删曲/改名/重排） ---------- */

app.post("/api/album/:id/tracks", async (c) => {
  const id = c.req.param("id");
  const album = await c.env.DB.prepare(
    "SELECT folder FROM albums WHERE id = ?").bind(id).first();
  if (!album) return c.json({ error: "not found" }, 404);
  const b = await requestObject(c);
  if (!b || typeof b.path !== "string") {
    return c.json({ error: "path 必填" }, 400);
  }
  const p = safePath(c.env, b.path);
  if (!p || !p.startsWith(album.folder + "/")) {
    return c.json({ error: "path 必须在该专辑目录下" }, 400);
  }
  const tid = await sha16(p);
  const priorTrack = await c.env.DB.prepare(
    "SELECT album_id FROM tracks WHERE id = ?").bind(tid).first();
  if (priorTrack && priorTrack.album_id !== id) {
    return c.json({ error: "该曲目路径已经登记在其他专辑" }, 409);
  }
  const discInput = finiteInput(b.disc, { integer: true, min: 1 });
  const track = finiteInput(b.track, { integer: true, min: 1 });
  const duration = finiteInput(b.duration, { min: 0 });
  const bitrate = finiteInput(b.bitrate, { min: 0 });
  const size = finiteInput(b.size, { integer: true, min: 0,
    max: Number.MAX_SAFE_INTEGER });
  const titleInput = boundedText(b.title, 1000);
  const format = boundedText(b.format, 64);
  if ([discInput, track, duration, bitrate, size, titleInput, format]
    .includes(INVALID_INPUT)) {
    return c.json({ error: "曲目元数据格式无效" }, 400);
  }
  const disc = discInput ?? 1;
  await c.env.DB.prepare(`
    INSERT INTO tracks (id, album_id, disc, track, title, duration,
      format, bitrate, size, path)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET album_id=excluded.album_id,
      disc=excluded.disc, track=excluded.track, title=excluded.title,
      duration=excluded.duration, format=excluded.format,
      bitrate=excluded.bitrate, size=excluded.size`)
    .bind(tid, id, disc, track, titleInput || p.split("/").pop(), duration,
      format, bitrate, size, p).run();
  await c.env.DB.prepare("UPDATE albums SET updated_at = ? WHERE id = ?")
    .bind(Date.now(), id).run();
  return c.json({ ok: true, id: tid });
});

app.patch("/api/album/:id/tracks/:tid", async (c) => {
  const b = await requestObject(c);
  if (!b) return c.json({ error: "请求 JSON 无效" }, 400);
  if (typeof b.title !== "string" || !b.title.trim() || b.title.length > 1000) {
    return c.json({ error: "title 必填" }, 400);
  }
  const r = await c.env.DB.prepare(
    "UPDATE tracks SET title = ? WHERE id = ? AND album_id = ?")
    .bind(b.title.trim(), c.req.param("tid"), c.req.param("id")).run();
  if (!r.meta?.changes) return c.json({ error: "not found" }, 404);
  await c.env.DB.prepare("UPDATE albums SET updated_at = ? WHERE id = ?")
    .bind(Date.now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

app.delete("/api/album/:id/tracks/:tid", async (c) => {
  const tid = c.req.param("tid");
  const row = await c.env.DB.prepare(
    "SELECT t.path, a.storage_id FROM tracks t " +
    "JOIN albums a ON a.id = t.album_id WHERE t.id = ? AND t.album_id = ?")
    .bind(tid, c.req.param("id")).first();
  if (!row) return c.json({ error: "not found" }, 404);
  let fileDeleted = false;
  if (c.req.query("file") === "1") {
    try {
      fileDeleted = await storage.deleteItem(c.env, row.path, row.storage_id);
    } catch {
      fileDeleted = false;
    }
    if (!fileDeleted) {
      return c.json({ error: "存储中的音频删除失败，数据库未修改" }, 502);
    }
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM favorites WHERE kind = 'track' AND item_id = ?").bind(tid),
    c.env.DB.prepare("DELETE FROM tracks WHERE id = ?").bind(tid),
    c.env.DB.prepare("UPDATE albums SET updated_at = ? WHERE id = ?")
      .bind(Date.now(), c.req.param("id")),
  ]);
  return c.json({ ok: true, fileDeleted });
});

// 重排：按给定 id 顺序重编号 track = 1..n（disc 归 1，作为唯一权威顺序）
app.put("/api/album/:id/tracks/order", async (c) => {
  const id = c.req.param("id");
  const b = await requestObject(c);
  const ids = b?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.some((tid) =>
    typeof tid !== "string" || tid.length > 128)) {
    return c.json({ error: "ids 必填" }, 400);
  }
  const { results } = await c.env.DB.prepare(
    "SELECT id FROM tracks WHERE album_id = ?").bind(id).all();
  const existing = new Set(results.map((r) => r.id));
  if (ids.length !== existing.size || new Set(ids).size !== ids.length
      || ids.some((x) => !existing.has(x))) {
    return c.json({ error: "ids 与专辑曲目不一致（先刷新页面）" }, 400);
  }
  const ordered = JSON.stringify(ids);
  await c.env.DB.batch([
    c.env.DB.prepare(`WITH ordered(id, position) AS (
      SELECT CAST(value AS TEXT), CAST(key AS INTEGER) + 1 FROM json_each(?)
    )
    UPDATE tracks SET
      track = (SELECT position FROM ordered WHERE ordered.id = tracks.id),
      disc = 1
    WHERE album_id = ? AND id IN (SELECT id FROM ordered)`)
      .bind(ordered, id),
    c.env.DB.prepare("UPDATE albums SET updated_at = ? WHERE id = ?")
      .bind(Date.now(), id),
  ]);
  return c.json({ ok: true });
});

/* ---------- RYM 导入（浏览器解析 HTML 后提交） ---------- */

app.post("/api/album/:id/rym", async (c) => {
  const b = await requestObject(c);
  if (!b) return c.json({ error: "请求 JSON 无效" }, 400);
  const album = await c.env.DB.prepare(
    "SELECT id FROM albums WHERE id = ?").bind(c.req.param("id")).first();
  if (!album) return c.json({ error: "not found" }, 404);
  const rating = finiteInput(b.rating, { min: 0, max: 5 });
  const votes = finiteInput(b.votes, {
    integer: true, min: 0, max: Number.MAX_SAFE_INTEGER,
  });
  const rank = boundedText(b.rank, 500);
  const rymUrl = validHttpUrl(b.rymUrl);
  const primary = strictTextList(b.genres);
  const secondary = strictTextList(b.secondaryGenres);
  const descriptors = strictTextList(b.descriptors, {
    maxItems: 500, maxItemLength: 500,
  });
  if ([rating, votes, rank, rymUrl, primary, secondary, descriptors]
    .includes(INVALID_INPUT)) {
    return c.json({ error: "RYM 数据格式无效" }, 400);
  }
  const genres = genreLists(primary, secondary);
  await c.env.DB.prepare(`
    UPDATE albums SET rym_rating=?, rym_votes=?, rym_rank=?, rym_url=?,
      genres=?, sec_genres=?, descriptors=?, updated_at=? WHERE id=?`)
    .bind(rating, votes, rank, rymUrl,
      JSON.stringify(genres.primary), JSON.stringify(genres.secondary),
      JSON.stringify(descriptors),
      Date.now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

/* ---------- 上传（浏览器直传 OneDrive；WebDAV 目标走 Worker 代理端点） ---------- */

// 当前写入目标：所有新上传都必须落到一个命名存储后端。
async function writeTarget(env) {
  const row = await env.DB.prepare(
    "SELECT id, kind FROM storages WHERE is_write = 1").first();
  return row || null;
}

async function uploadTargetForPath(env, path, { includeArtistParent = false } = {}) {
  const parent = path.replace(/\/[^/]+$/, "");
  // An existing album owns every file below its folder. Never silently fall
  // back to the global write target if that album's storage row is missing.
  const album = await env.DB.prepare(`
    SELECT storage_id FROM albums
    WHERE substr(?, 1, length(folder) + 1) = folder || '/'
    ORDER BY length(folder) DESC LIMIT 1`).bind(path).first();
  if (album) {
    if (!album.storage_id) return null;
    return env.DB.prepare("SELECT id, kind FROM storages WHERE id = ?")
      .bind(album.storage_id).first();
  }
  if (includeArtistParent) {
    // Replacing an existing avatar must stay on the backend recorded with the
    // artist; inferring from an arbitrary album is wrong when an artist spans
    // multiple disks.
    const exactArtist = await env.DB.prepare(`
      SELECT s.id, s.kind FROM artists ar
      JOIN storages s ON s.id = ar.storage_id
      WHERE ar.avatar_path = ? LIMIT 1`).bind(path).first();
    if (exactArtist) return exactArtist;
  }
  const row = await env.DB.prepare(`
    SELECT s.id, s.kind FROM albums a
    JOIN storages s ON s.id = a.storage_id
    WHERE substr(?, 1, length(a.folder) + 1) = a.folder || '/'
       OR (? = 1 AND (
         a.folder = ? OR substr(a.folder, 1, length(?) + 1) = ? || '/'
       ))
    ORDER BY CASE
      WHEN substr(?, 1, length(a.folder) + 1) = a.folder || '/' THEN 0
      WHEN a.folder = ? THEN 1 ELSE 2 END,
      CASE WHEN substr(?, 1, length(a.folder) + 1) = a.folder || '/'
           THEN -length(a.folder) ELSE length(a.folder) END
    LIMIT 1`)
    .bind(path, includeArtistParent ? 1 : 0,
      parent, parent, parent, path, parent, path).first();
  return row || writeTarget(env);
}

app.post("/api/upload/session", async (c) => {
  const b = await requestObject(c);
  const path = b?.path;
  const p = safePath(c.env, path);
  if (!p) return c.json({ error: "path 必须在曲库根目录下" }, 400);
  try {
    const wt = await uploadTargetForPath(c.env, p);
    if (!wt) return c.json({ error: "请先设置一个命名存储写入目标" }, 400);
    if (wt.kind === "onedrive" || wt.kind === "gdrive") {
      const uploadUrl = await storage.createUploadSession(c.env, p, wt.id);
      return c.json({ uploadUrl, path: p, storageId: wt.id,
        provider: wt.kind });
    }
    // WebDAV / Local 无浏览器直传会话：走 Worker 流式代理 PUT。
    if (wt.kind === "webdav" || wt.kind === "local") {
      return c.json({ proxy: true, path: p, storageId: wt.id });
    }
    return c.json({ error: `不支持的写入后端: ${wt.kind}` }, 400);
  } catch (e) {
    console.error("upload session failed after retries", e);
    return c.json({
      error: `上传会话创建失败：${String(e?.message || e)}`,
    }, 503);
  }
});

// 代理型存储的流式上传（浏览器 → Worker → WebDAV/Local）
app.put("/api/upload/proxy", async (c) => {
  const path = safePath(c.env, c.req.query("path") || "");
  if (!path) return c.json({ error: "path 非法" }, 400);
  const wt = await uploadTargetForPath(c.env, path);
  const requestedStorageId = c.req.query("storageId") || "";
  if (requestedStorageId && requestedStorageId !== wt?.id) {
    return c.json({ error: "上传目标已变化，请重新创建上传会话" }, 409);
  }
  if (!wt || !["webdav", "local"].includes(wt.kind)) {
    return c.json({ error: "当前写入目标不是代理型存储" }, 400);
  }
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "上传内容为空" }, 400);
  try {
    const ok = await storage.putFile(c.env, path, body,
      c.req.header("Content-Type"), wt.id);
    return ok ? c.json({ ok: true }) : c.json({ error: "上传失败" }, 502);
  } catch (error) {
    console.error("streaming proxy upload failed", error);
    return c.json({ error: `上传失败：${String(error?.message || error)}` }, 502);
  }
});

app.post("/api/upload/cover", async (c) => {
  try {
    const path = safePath(c.env, c.req.query("path") || "");
    if (!path) return c.json({ error: "path 非法" }, 400);
    if (!/\.(jpe?g|png|webp|gif|avif)$/i.test(path)) {
      return c.json({ error: "封面路径必须是图片文件" }, 400);
    }
    const declared = Number(c.req.header("Content-Length"));
    if (Number.isFinite(declared) && declared > 4 * 1024 * 1024) {
      return c.json({ error: "封面请小于 4MB" }, 413);
    }
    const bytes = await readRequestLimited(c, 4 * 1024 * 1024);
    if (bytes.byteLength > 4 * 1024 * 1024) {
      return c.json({ error: "封面请小于 4MB" }, 413);
    }
    // Existing album content follows that album's backend.  Artist avatars
    // live one directory above the album, so allow the parent relationship as
    // a fallback before using the global write target.
    const target = await uploadTargetForPath(
      c.env, path, { includeArtistParent: true });
    const sid = target?.id || null;
    if (!sid) return c.json({ error: "请先设置一个命名存储写入目标" }, 400);
    const suppliedType = (c.req.header("Content-Type") || "").split(";", 1)[0]
      .trim().toLowerCase();
    if (suppliedType && !/^image\/(jpeg|png|webp|gif|avif)$/.test(suppliedType)) {
      return c.json({ error: "只支持 JPEG、PNG、WebP、GIF 或 AVIF 图片" }, 415);
    }
    const ct = imageMimeFromBytes(bytes);
    if (!ct) return c.json({ error: "图片内容格式无效" }, 415);
    const ok = await storage.putSmallFile(c.env, path, bytes, ct, sid);
    if (!ok) return c.json({ error: "上传失败" }, 502);

    // R2 优先：上传成功后立刻镜像（有自定义头像 key 时）
    // 头像路径含 avatar-；封面 cover. 也一并预热
    const conf = await r2.r2Conf(c.env);
    if (conf.ready) {
      const isAvatar = /\/avatar-[^/]+\.(jpe?g|png|webp)$/i.test(path)
        || /\/artist\.(jpe?g|png|webp)$/i.test(path);
      if (isAvatar) {
        const cacheKey = `artist:${await sha16(path)}:480`;
        await invalidateR2(c.env, `artist:${await sha16(path)}:`);
        // 后台镜像；失败不影响上传成功
        const ctx = await ctxOf(c);
        const job = mirrorImageToR2(c.env, conf, cacheKey, path, "c480x480", sid);
        const safeJob = job.catch(() => "fail");
        if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(safeJob);
        else await safeJob;
      }
    }
    return c.json({ ok: true, path, storageId: sid });
  } catch (e) {
    if (/request exceeds/i.test(String(e?.message || e))) {
      return c.json({ error: "封面请小于 4MB" }, 413);
    }
    return c.json({ error: String(e.message || e) }, 500);
  }
});

/* ---------- 云端扫描（直接扔进 OneDrive 的文件夹也能入库） ---------- */

app.post("/api/scan", async (c) => {
  const b = await requestObject(c);
  if (!b) return c.json({ error: "请求 JSON 无效" }, 400);
  const { folder, artist, title, year } = b;
  const f = safePath(c.env, folder);
  if (!f) return c.json({ error: "folder 非法" }, 400);
  // Rescanning an existing album must use that album's backend; otherwise a
  // changed write target can silently scan an unrelated directory.
  const existingAlbum = await c.env.DB.prepare(
    "SELECT storage_id FROM albums WHERE folder = ?").bind(f).first();
  const wt = existingAlbum?.storage_id
    ? { id: existingAlbum.storage_id }
    : await writeTarget(c.env);
  if (!wt) return c.json({ error: "请先设置一个命名存储写入目标" }, 400);
  let kids;
  try {
    kids = await storage.listChildren(c.env, f, wt.id, { strict: true });
  } catch (error) {
    return c.json({ error: `无法读取音盤目录: ${error.message || error}` }, 502);
  }
  const seenNames = new Set();
  const audio = [];
  for (const k of kids) {
    const name = typeof k.name === "string" ? k.name : "";
    if (!/\.(mp3|flac|m4a|ogg|opus|wav)$/i.test(name)) continue;
    if (!name || name.length > 255 || /[\\/\u0000-\u001f]/.test(name)
        || !k.file) {
      return c.json({ error: `音盤中含无法扫描的音频条目: ${name || "(empty)"}` }, 400);
    }
    const key = name.normalize("NFC").toLocaleLowerCase();
    if (seenNames.has(key)) {
      return c.json({ error: `音盘中含重复的音频文件名: ${name}` }, 400);
    }
    seenNames.add(key);
    audio.push(k);
  }
  if (!audio.length) return c.json({ error: "该目录没有音频文件" }, 400);
  const dirName = f.split("/").pop();
  const m = dirName.match(/^\[(\d{4})\]\s*(.+)$/);
  // 已登记的曲目信息（曲名/时长/码率/序号是宝贵数据）优先保留：
  // Graph 的 audio 元数据经常缺（尤其 FLAC），重扫不能把它们冲掉
  const albumId = await sha16(f);
  const { results: prevRows } = await c.env.DB.prepare(
    "SELECT * FROM tracks WHERE album_id = ?").bind(albumId).all();
  const prev = new Map(prevRows.map((t) => [t.path, t]));
  // 文件名兜底和浏览器端 tags.js 同一条规则："01. 曲名" → track=1, title=曲名
  const fromFilename = (name) => {
    const stem = name.replace(/\.[^.]+$/, "");
    const fm = stem.match(/^(\d{1,3})[\s._-]+(.+)$/);
    return { track: fm ? Number(fm[1]) : null, title: fm ? fm[2] : stem };
  };
  const scanNumber = (value, options) => {
    const parsed = finiteInput(value, options);
    return parsed === INVALID_INPUT ? null : parsed;
  };
  const tracks = audio.map((k, i) => {
    const path = `${f}/${k.name}`;
    const old = prev.get(path);
    const fb = fromFilename(k.name);
    return {
      path,
      title: old?.title || k.audio?.title || fb.title,
      track: old?.track ?? (k.audio?.track || fb.track || i + 1),
      disc: old?.disc ?? (k.audio?.disc || 1),
      duration: old?.duration
        ?? scanNumber(k.audio?.duration === undefined
          ? null : Number(k.audio.duration) / 1000, { min: 0 }),
      bitrate: old?.bitrate ?? scanNumber(k.audio?.bitrate, { min: 0 }),
      format: k.name.split(".").pop().toLowerCase(),
      size: scanNumber(k.size, { integer: true, min: 0,
        max: Number.MAX_SAFE_INTEGER }),
    };
  });
  const payload = {
    folder: f,
    artist: artist || audio[0].audio?.albumArtist
      || audio[0].audio?.artist || f.split("/").at(-2),
    title: title || audio[0].audio?.album || (m ? m[2] : dirName),
    year: year || (m ? Number(m[1]) : null),
    tracks,
  };
  const headers = { "Content-Type": "application/json" };
  const apiKey = c.req.header("X-Api-Key");
  if (apiKey) headers["X-Api-Key"] = apiKey;
  else if (c.req.header("Cookie")) headers.Cookie = c.req.header("Cookie");
  const r = await app.request("/api/albums", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }, c.env);
  const result = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  return c.json(result, r.status);
});

/* ---------- 管理后台 ---------- */

app.get("/api/admin/overview", async (c) => {
  const a = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM albums").first();
  const t = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n, SUM(size) AS bytes FROM tracks").first();
  const posts = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM source_posts WHERE status = 'new'").first();
  return c.json({
    albums: a.n, tracks: t.n, bytes: t.bytes || 0,
    newPosts: posts.n,
    companionLastSeen: Number(await getSetting(c.env, "companion_last_seen")) || null,
    sourceLastScan: Number(await getSetting(c.env, "source_last_scan")) || null,
    sourceLastError: (await getSetting(c.env, "source_last_error")) || "",
  });
});

app.post("/api/admin/password", async (c) => {
  const b = await requestObject(c);
  const { target, current, next } = b || {};
  if (!["user", "admin"].includes(target) || typeof current !== "string"
      || current.length > 4096 || typeof next !== "string"
      || next.length < 4 || next.length > 4096) {
    return c.json({ error: "参数不对（新口令至少 4 位）" }, 400);
  }
  if ((await checkPassword(c.env, current)) !== "admin") {
    return c.json({ error: "当前管理员口令不对" }, 403);
  }
  const hash = await hashPassword(next);
  // 密码与会话纪元必须一起提交。否则第二次写入失败时接口虽然报错，
  // 新密码却已经生效，旧 cookie 也仍能继续使用。
  await c.env.DB.batch([
    settingStatement(c.env, `${target}_pass_hash`, hash),
    bumpSessionEpochStatement(c.env),
  ]);
  return c.json({ ok: true });
});

app.get("/api/admin/settings", async (c) => {
  const tok = (await getSetting(c.env, "discogs_token")) || "";
  return c.json({
    sourceUrl: (await getSetting(c.env, "source_url")) || "",
    archivePasswords: settingStringList(
      (await getSetting(c.env, "archive_passwords")) || "[]"),
    // token 只回掩码（••••+末4位），置空表示未配置
    discogsToken: tok ? `••••${tok.slice(-4)}` : "",
    guestOpen: (await getSetting(c.env, "guest_open")) === "1",
    // 可插拔模块（默认关：这些是重度私人工作流，多数用户用不上）
    moduleSource: (await getSetting(c.env, "module_source")) === "1",
    // 音源代理：强制所有有直链的音轨经 Worker 转发（大陆访问 OneDrive 慢时开）
    streamProxy: (await getSetting(c.env, "stream_proxy")) === "1",
    // 自定义代理地址（空 = 用本站 /api/stream 代理；可填其他 Worker）
    // 支持 {url} 占位：https://my-proxy.example.com/?u={url}
    streamProxyUrl: (await getSetting(c.env, "stream_proxy_url")) || "",
  });
});

app.put("/api/admin/settings", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!plainObject(b)
      || ("sourceUrl" in (b || {}) && typeof b.sourceUrl !== "string")
      || ("archivePasswords" in (b || {})
        && (!Array.isArray(b.archivePasswords)
          || b.archivePasswords.length > 200
          || b.archivePasswords.some((value) =>
            typeof value !== "string" || value.length > 512)))
      || ["guestOpen", "moduleSource", "streamProxy"].some(
        (key) => key in (b || {}) && typeof b[key] !== "boolean")
      || ("streamProxyUrl" in (b || {}) && typeof b.streamProxyUrl !== "string")
      || ("discogsToken" in (b || {})
        && typeof b.discogsToken !== "string")) {
    return c.json({ error: "设置格式无效" }, 400);
  }
  const parsedSourceUrl = "sourceUrl" in b
    ? validHttpUrl(b.sourceUrl.trim(), 2048) : null;
  const parsedProxyUrl = "streamProxyUrl" in b
    ? validHttpUrl(b.streamProxyUrl.trim(), 2048) : null;
  if (parsedSourceUrl === INVALID_INPUT || parsedProxyUrl === INVALID_INPUT) {
    return c.json({ error: "设置中的网址必须是 http(s) URL" }, 400);
  }
  const statements = [];
  const put = (key, value) => statements.push(settingStatement(c.env, key, value));
  if ("sourceUrl" in b) put("source_url", parsedSourceUrl);
  if (Array.isArray(b.archivePasswords)) {
    put("archive_passwords", JSON.stringify(strictStringList(b.archivePasswords)));
  }
  // 非空才更新（表单留空 = 保持现值，与云盘凭据同一套约定）
  if (typeof b.discogsToken === "string" && b.discogsToken.trim()
      && !b.discogsToken.includes("••")) {
    put("discogs_token", b.discogsToken.trim());
  }
  if ("guestOpen" in b) {
    put("guest_open", b.guestOpen ? "1" : "0");
  }
  if ("moduleSource" in b) {
    put("module_source", b.moduleSource ? "1" : "0");
  }
  if ("streamProxy" in b) {
    put("stream_proxy", b.streamProxy ? "1" : "0");
  }
  if ("streamProxyUrl" in b) {
    put("stream_proxy_url", parsedProxyUrl);
  }
  if (statements.length) await c.env.DB.batch(statements);
  return c.json({ ok: true });
});

// 资源站模块开关闸门（关闭时扫描类端点直接 404，定时任务也跳过）
const sourceModuleGate = async (c, next) => {
  if ((await getSetting(c.env, "module_source")) !== "1") {
    return c.json({ error: "资源站模块未启用" }, 404);
  }
  return next();
};

app.post("/api/admin/source/scan", sourceModuleGate, async (c) => {
  const b = await requestObject(c);
  if (!b || (b.deep !== undefined && typeof b.deep !== "boolean")) {
    return c.json({ error: "deep 参数无效" }, 400);
  }
  return c.json(await scanSource(c.env, b.deep === true));
});

app.get("/api/admin/source/posts", async (c) => {
  const q = (c.req.query("q") || "").trim();
  if (q.length > 500) return c.json({ error: "搜索词过长" }, 400);
  const status = c.req.query("status") || "";
  const limit = finiteInput(c.req.query("limit") ?? 100,
    { integer: true, min: 1, max: 200 });
  const offset = finiteInput(c.req.query("offset") ?? 0,
    { integer: true, min: 0, max: 10_000_000 });
  if (limit === INVALID_INPUT || limit === null
      || offset === INVALID_INPUT || offset === null) {
    return c.json({ error: "limit / offset 参数无效" }, 400);
  }
  const where = [], vals = [];
  if (["new", "done", "ignored"].includes(status)) {
    where.push("status = ?"); vals.push(status);
  }
  if (q) { where.push("instr(lower(title), lower(?)) > 0"); vals.push(q); }
  const W = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = (await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM source_posts ${W}`).bind(...vals).first()).n;
  const { results: byStatus } = await c.env.DB.prepare(
    "SELECT status, COUNT(*) AS n FROM source_posts GROUP BY status").all();
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
  const { results: posts } = await c.env.DB.prepare(`
    SELECT * FROM source_posts ${W}
    ORDER BY published DESC, created_at DESC LIMIT ? OFFSET ?`)
    .bind(...vals, limit, offset).all();
  return c.json({ total, counts, posts });
});

app.post("/api/admin/source/posts/:id", async (c) => {
  const b = await requestObject(c);
  const status = b?.status;
  if (!["new", "done", "ignored"].includes(status)) {
    return c.json({ error: "status 非法" }, 400);
  }
  await c.env.DB.prepare("UPDATE source_posts SET status = ? WHERE id = ?")
    .bind(status, c.req.param("id")).run();
  return c.json({ ok: true });
});

/* ---------- 管理后台：云盘凭据（过期/换号时在线更新，不用重新部署） ---------- */

const mask = (v) => (v ? `••••${String(v).slice(-4)}` : "");

/* ---------- R2 图床凭据（后台可改，不写死） ---------- */

app.get("/api/admin/r2", async (c) => {
  const conf = await r2.r2Conf(c.env);
  const cached = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM r2_cache").first();
  return c.json({
    enabled: conf.enabled,
    accessKey: mask(conf.accessKey),
    secretKey: mask(conf.secretKey),
    endpoint: conf.endpoint || "",
    bucket: conf.bucket || "",
    publicUrl: conf.publicUrl || "",
    ready: conf.ready,
    mirrored: cached?.n || 0,   // 已镜像的图片变体数
  });
});

app.put("/api/admin/r2", async (c) => {
  const b = await requestObject(c);
  if (!b) return c.json({ error: "请求 JSON 无效" }, 400);
  const stringFields = ["accessKey", "secretKey", "endpoint", "bucket", "publicUrl"];
  if (stringFields.some((key) => key in b && typeof b[key] !== "string")
      || ("enabled" in b && typeof b.enabled !== "boolean")) {
    return c.json({ error: "R2 配置格式无效" }, 400);
  }
  const endpoint = "endpoint" in b ? validHttpUrl(b.endpoint) : null;
  const publicUrl = "publicUrl" in b ? validHttpUrl(b.publicUrl) : null;
  if (endpoint === INVALID_INPUT || publicUrl === INVALID_INPUT
      || (typeof b.bucket === "string" && b.bucket.trim().length > 255)
      || [b.accessKey, b.secretKey].some((value) =>
        typeof value === "string" && value.length > 4096)) {
    return c.json({ error: "R2 配置格式无效" }, 400);
  }
  const statements = [];
  const put = (key, value) => statements.push(settingStatement(c.env, key, value));
  // 掩码值（含 ••）跳过 = 保持不变；明文才写入
  const secret = { accessKey: "r2_access_key", secretKey: "r2_secret_key" };
  for (const [k, sk] of Object.entries(secret)) {
    if (typeof b[k] === "string" && b[k].trim() && !b[k].includes("••")) {
      put(sk, b[k].trim());
    }
  }
  if ("endpoint" in b) put("r2_endpoint", endpoint);
  if ("bucket" in b) put("r2_bucket", b.bucket.trim());
  if ("publicUrl" in b) put("r2_public_url", publicUrl);
  if ("enabled" in b) put("r2_enabled", b.enabled ? "1" : "0");
  if (statements.length) await c.env.DB.batch(statements);
  return c.json({ ok: true });
});

app.post("/api/admin/r2/test", async (c) =>
  c.json(await r2.r2Test(await r2.r2Conf(c.env))));

// Older builds could leave public R2 objects behind when an already-hidden
// album was restored from a backup, or when the final visible album of an
// artist was hidden.  This paginated maintenance endpoint removes only those
// public mirrors; source files in OneDrive/WebDAV/GDrive/local are untouched.
app.post("/api/admin/r2/purge-hidden", async (c) => {
  const body = await requestObject(c);
  if (!body) return c.json({ error: "请求 JSON 无效" }, 400);
  const offset = finiteInput(body.offset ?? 0, {
    integer: true, min: 0, max: 10_000_000,
  });
  const limit = finiteInput(body.limit ?? 10, { integer: true, min: 1, max: 50 });
  if (offset === INVALID_INPUT || offset === null
      || limit === INVALID_INPUT || limit === null) {
    return c.json({ error: "offset / limit 参数无效" }, 400);
  }
  const { results: hiddenAlbums } = await c.env.DB.prepare(
    "SELECT id, artist, title FROM albums WHERE COALESCE(hidden,0)=1 " +
    "ORDER BY created_at, id").all();
  const { results: hiddenArtists } = await c.env.DB.prepare(`
    SELECT ar.name FROM artists ar WHERE NOT EXISTS (
      SELECT 1 FROM albums a WHERE a.artist = ar.name
      AND COALESCE(a.hidden,0)=0
    ) ORDER BY ar.name COLLATE NOCASE`).all();
  const tasks = [
    ...hiddenAlbums.map((album) => ({ kind: "album", ...album })),
    ...hiddenArtists.map((artist) => ({ kind: "artist", artist: artist.name })),
  ];
  const batch = tasks.slice(offset, offset + limit);
  let processed = offset;
  for (const task of batch) {
    const ok = task.kind === "album"
      ? await purgeAlbumR2(c.env, task.id, true)
      : await purgeArtistR2(c.env, task.artist, true);
    if (!ok) {
      return c.json({
        error: "无法删除隐藏内容的公开 R2 镜像；请检查 R2 凭据",
        task, processed, total: tasks.length, finished: false,
      }, 502);
    }
    processed += 1;
  }
  return c.json({
    ok: true, processed, total: tasks.length,
    finished: processed >= tasks.length,
  });
});

// 把一张图镜像到 R2；已存在则跳过。storageId 可空（默认后端）。返回 'done'|'skip'|'fail'
async function mirrorImageToR2(env, conf, cacheKey, srcPath, dim, storageId = null) {
  if (typeof cacheKey !== "string" || !cacheKey
      || typeof srcPath !== "string" || !srcPath) return "fail";
  const exists = await env.DB.prepare(
    "SELECT 1 FROM r2_cache WHERE cache_key = ?").bind(cacheKey).first();
  if (exists) return "skip"; // R2 里已有，不重复上传
  if (await claimExistingR2Image(env, conf, cacheKey, srcPath)) return "skip";
  let bytes, ct;
  const url = (dim ? await storage.thumbnailUrl(env, srcPath, dim, storageId) : null)
    || (await storage.downloadUrl(env, srcPath, storageId));
  if (url) {
    const img = await fetchWithTimeout(url);
    if (!img.ok) return "fail";
    ct = img.headers.get("Content-Type") || "image/jpeg";
    try { bytes = await readResponseLimited(img, MAX_BUFFERED_IMAGE_BYTES); }
    catch { return "fail"; }
  } else {
    const r = await storage.getFile(env, srcPath, storageId);
    if (!r) return "fail";
    ct = r.headers.get("Content-Type") || "image/jpeg";
    try { bytes = await readResponseLimited(r, MAX_BUFFERED_IMAGE_BYTES); }
    catch { return "fail"; }
  }
  ct = imageMimeFromBytes(bytes);
  if (!ct) return "fail";
  const r2key = r2ImageObjectKey(cacheKey, ct);
  if (!(await r2.r2Put(conf, r2key, bytes, ct))) return "fail";
  await recordR2Mirror(env, cacheKey, r2key);
  return "done";
}

// 预热：把所有图片（专辑封面原图 + 内页图 480/1000 + 歌手头像 480）
// 批量镜像到 R2。已在 R2 的跳过。分批返回进度，前端轮询推进。
app.post("/api/admin/r2/prewarm", async (c) => {
  const conf = await r2.r2Conf(c.env);
  if (!conf.ready) return c.json({ error: "R2 未就绪，先在上方配置并测试连接" }, 400);
  const body = await requestObject(c);
  if (!body) return c.json({ error: "请求 JSON 无效" }, 400);
  const offset = finiteInput(body.offset ?? 0, {
    integer: true, min: 0, max: 10_000_000,
  });
  const limit = finiteInput(body.limit ?? 6, { integer: true, min: 1, max: 100 });
  if (offset === INVALID_INPUT || offset === null
      || limit === INVALID_INPUT || limit === null) {
    return c.json({ error: "offset / limit 参数无效" }, 400);
  }

  // 构建统一任务清单：[{key, path, dim}]（path 为 null 的封面需先 resolveCover）
  const tasks = [];
  const { results: albums } = await c.env.DB.prepare(
    `SELECT id, folder, cover_path, storage_id FROM albums
     WHERE COALESCE(hidden,0)=0 ORDER BY created_at`).all();
  for (const album of albums) {
    tasks.push({ kind: "cover", album, sizes: [["original", null]],
      sid: album.storage_id || null });
  }
  const { results: imgs } = await c.env.DB.prepare(`
    SELECT i.id, i.path, a.storage_id FROM album_images i
    JOIN albums a ON a.id = i.album_id
    WHERE COALESCE(a.hidden,0)=0 ORDER BY i.created_at`).all();
  for (const im of imgs) {
    for (const [size, dim] of [[480, "c480x480"], [1000, "c1000x1000"]]) {
      tasks.push({ kind: "image", key: `img:${im.id}:${size}`, path: im.path, dim,
        sid: im.storage_id || null });
    }
  }
  // 头像有独立的存储绑定；跨盘艺人不能再从任一专辑推断。
  const { results: arts } = await c.env.DB.prepare(`
    SELECT ar.avatar_path, ar.storage_id FROM artists ar
    WHERE ar.avatar_path != '' AND EXISTS (
      SELECT 1 FROM albums a WHERE a.artist = ar.name
      AND COALESCE(a.hidden,0)=0
    )`).all();
  for (const a of arts) {
    tasks.push({ kind: "avatar", path: a.avatar_path, key: null, dim: "c480x480",
      sid: a.storage_id || null });
  }

  const total = tasks.length;
  const batch = tasks.slice(offset, offset + limit);
  let done = 0, skipped = 0, failed = 0;
  const mirror = async (...args) => {
    try {
      return await mirrorImageToR2(...args);
    } catch {
      return "fail";
    }
  };
  for (const t of batch) {
    if (t.kind === "cover") {
      let cover;
      try { cover = await resolveCover(c.env, t.album); } catch { cover = null; }
      if (!cover) { skipped++; continue; }
      for (const [size, dim] of t.sizes) {
        const r = await mirror(c.env, conf, `art:${t.album.id}:${size}`, cover, dim, t.sid);
        r === "done" ? done++ : r === "skip" ? skipped++ : failed++;
      }
    } else {
      let key = t.key;
      if (!key) {
        if (typeof t.path !== "string" || !t.path) { failed++; continue; }
        try { key = `artist:${await sha16(t.path)}:480`; }
        catch { failed++; continue; }
      }
      const r = await mirror(c.env, conf, key, t.path, t.dim, t.sid);
      r === "done" ? done++ : r === "skip" ? skipped++ : failed++;
    }
  }
  const next = offset + batch.length;
  return c.json({ total, processed: next, done, skipped, failed, finished: next >= total });
});

/* ---------- 多存储后端（多 OneDrive 账号容量池 / WebDAV / 迁移） ---------- */

const STORAGE_KINDS = ["onedrive", "webdav", "gdrive", "local"];
const STORAGE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const plainObject = (value) => !!value && typeof value === "object"
  && !Array.isArray(value);
const STORAGE_CONFIG_KEYS = {
  onedrive: new Set(["clientId", "clientSecret", "refreshToken", "driveId"]),
  webdav: new Set(["baseUrl", "username", "password"]),
  gdrive: new Set(["clientId", "clientSecret", "refreshToken", "rootId"]),
  local: new Set(["root", "odRoot"]),
};
const MAX_CONFIG_IMPORT_STORAGES = 64;

function normalizeStorageConfig(kind, value) {
  if (!plainObject(value) || !STORAGE_CONFIG_KEYS[kind]) return INVALID_INPUT;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!STORAGE_CONFIG_KEYS[kind].has(key)
        || typeof raw !== "string" || raw.length > 16_384
        || /[\u0000]/.test(raw)) return INVALID_INPUT;
    out[key] = raw;
  }
  if (kind === "webdav" && out.baseUrl) {
    const url = validHttpUrl(out.baseUrl, 4096);
    if (url === INVALID_INPUT) return INVALID_INPUT;
    try {
      const parsed = new URL(url);
      // Credentials belong in the dedicated fields; keeping them out of the
      // URL prevents accidental exposure through the storage list/export.
      if (parsed.username || parsed.password) return INVALID_INPUT;
    } catch { return INVALID_INPUT; }
    out.baseUrl = url;
  }
  if (kind === "local" && out.odRoot) {
    const root = norm(out.odRoot);
    if (!root || root.length > MAX_STORAGE_PATH
        || root.split("/").some((part) => part === "." || part === ".."
          || part.length > 255)) return INVALID_INPUT;
    out.odRoot = root;
  }
  return out;
}

async function requestObject(c) {
  const value = await c.req.json().catch(() => null);
  return plainObject(value) ? value : null;
}
const maskConfig = (kind, cfg) => {
  const c2 = { ...cfg };
  for (const k of ["clientSecret", "refreshToken", "password"]) {
    if (c2[k]) c2[k] = mask(c2[k]);
  }
  return c2;
};

app.get("/api/admin/storages", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM storages ORDER BY created_at").all();
  const counts = {};
  const { results: cnt } = await c.env.DB.prepare(
    "SELECT storage_id, COUNT(*) AS n FROM albums GROUP BY storage_id").all();
  for (const r of cnt) if (r.storage_id) counts[r.storage_id] = r.n;
  return c.json({
    storages: results.map((s) => ({
      id: s.id, name: s.name, kind: s.kind,
      isWrite: !!s.is_write,
      albums: counts[s.id] || 0,
      config: maskConfig(s.kind, configJson(s.config)),
    })),
  });
});

app.post("/api/admin/storages", async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!plainObject(b) || typeof b.name !== "string" || !b.name.trim()
      || b.name.trim().length > 100 || !STORAGE_KINDS.includes(b.kind)
      || (b.config !== undefined && !plainObject(b.config))) {
    return c.json({ error: "name/kind 不合法" }, 400);
  }
  const name = b.name.trim();
  const normalizedConfig = normalizeStorageConfig(b.kind, b.config || {});
  if (normalizedConfig === INVALID_INPUT) {
    return c.json({ error: "存储配置字段无效" }, 400);
  }
  const encodedConfig = JSON.stringify(normalizedConfig);
  if (encodedConfig.length > 65_536) {
    return c.json({ error: "存储配置过大" }, 400);
  }
  const id = await sha16(`${name}:${Date.now()}:${crypto.randomUUID()}`);
  // 先以非写入状态登记，再由同一套选择逻辑确保只有一个写入目标。
  // 这样并发添加首个存储时不会同时留下两个 is_write=1。
  await c.env.DB.prepare(
    "INSERT INTO storages (id, name, kind, config, is_write, created_at) " +
    "VALUES (?,?,?,?,?,?)")
    .bind(id, name, b.kind, encodedConfig, 0, Date.now()).run();
  const writeId = await ensureSingleWriteTarget(c.env);
  storage.clearStorageCache();
  return c.json({ ok: true, id, isWrite: writeId === id });
});

// 设定写入目标（新上传落到哪个命名存储）。
// 注意：必须注册在 PUT /storages/:sid 之前，否则 "write-target" 会被吃进 :sid
app.put("/api/admin/storages/write-target", async (c) => {
  const b = await requestObject(c);
  const id = b?.id;
  if (typeof id !== "string" || !STORAGE_ID_RE.test(id)) {
    return c.json({ error: "必须指定有效的命名存储" }, 400);
  }
  const exists = await c.env.DB.prepare(
    "SELECT 1 FROM storages WHERE id = ?").bind(id).first();
  if (!exists) return c.json({ error: "not found" }, 404);
  // Validate first, then switch both rows in one batch.  The former order
  // cleared the current target before discovering that the requested id did
  // not exist, leaving uploads unusable until another repair request.
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE storages SET is_write = 0"),
    c.env.DB.prepare("UPDATE storages SET is_write = 1 WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

app.put("/api/admin/storages/:sid", async (c) => {
  const sid = c.req.param("sid");
  if (!STORAGE_ID_RE.test(sid)) return c.json({ error: "存储 id 无效" }, 400);
  const row = await c.env.DB.prepare(
    "SELECT kind, config FROM storages WHERE id = ?").bind(sid).first();
  if (!row) return c.json({ error: "not found" }, 404);
  const b = await requestObject(c);
  if (!plainObject(b)
      || (b.name !== undefined && (typeof b.name !== "string"
        || !b.name.trim() || b.name.trim().length > 100))
      || (b.config !== undefined && !plainObject(b.config))) {
    return c.json({ error: "存储配置格式无效" }, 400);
  }
  if (!("name" in b) && !("config" in b)) {
    return c.json({ error: "没有可更新字段" }, 400);
  }
  const statements = [];
  if (b.name) statements.push(c.env.DB.prepare(
    "UPDATE storages SET name = ? WHERE id = ?").bind(b.name.trim(), sid));
  if (b.config) {
    // 掩码值（含••）跳过，保持原值；明文才覆盖
    const patch = normalizeStorageConfig(row.kind, b.config);
    if (patch === INVALID_INPUT) {
      return c.json({ error: "存储配置字段无效" }, 400);
    }
    const cur = configJson(row.config);
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v === "string" && v.includes("••")) continue;
      cur[k] = v;
    }
    const encoded = JSON.stringify(cur);
    if (encoded.length > 65_536) {
      return c.json({ error: "存储配置过大" }, 400);
    }
    // Clear both the former and new account/root caches before committing the
    // new credentials.  Cache deletion is reversible; stale credentials are
    // not safe to keep serving after this request succeeds.
    await storage.invalidateCredentialCache(
      c.env, sid, row.kind, configJson(row.config));
    await storage.invalidateCredentialCache(c.env, sid, row.kind, cur);
    statements.push(c.env.DB.prepare(
      "UPDATE storages SET config = ? WHERE id = ?").bind(encoded, sid));
  }
  if (statements.length) await c.env.DB.batch(statements);
  storage.clearStorageCache();
  return c.json({ ok: true });
});

app.delete("/api/admin/storages/:sid", async (c) => {
  const sid = c.req.param("sid");
  if (!STORAGE_ID_RE.test(sid)) return c.json({ error: "存储 id 无效" }, 400);
  const backend = await c.env.DB.prepare(
    "SELECT kind, config, is_write FROM storages WHERE id = ?").bind(sid).first();
  if (!backend) return c.json({ error: "not found" }, 404);
  const inUse = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM albums WHERE storage_id = ?").bind(sid).first();
  if (inUse.n > 0) {
    return c.json({ error: `还有 ${inUse.n} 张音盤在这个存储上，先迁走再删除` }, 400);
  }
  const avatars = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM artists WHERE storage_id = ? AND avatar_path != ''")
    .bind(sid).first();
  if (avatars.n > 0) {
    return c.json({ error: `还有 ${avatars.n} 个艺人头像在这个存储上，先迁走再删除` }, 400);
  }
  if (backend.is_write) {
    const another = await c.env.DB.prepare(
      "SELECT 1 FROM storages WHERE id != ? LIMIT 1").bind(sid).first();
    if (another) {
      return c.json({ error: "请先把另一个存储设为新上传主位置" }, 400);
    }
  }
  await storage.invalidateCredentialCache(c.env, sid, backend.kind,
    configJson(backend.config));
  await c.env.DB.prepare("DELETE FROM storages WHERE id = ?").bind(sid).run();
  storage.clearStorageCache();
  return c.json({ ok: true });
});

// 测试连通性（已存的按 id 测；未存的直接传 kind+config 测）
app.post("/api/admin/storages/test", async (c) => {
  const b = await requestObject(c);
  if (!b) return c.json({ ok: false, error: "请求 JSON 无效" }, 400);
  if (b.id !== undefined) {
    if (typeof b.id !== "string" || !STORAGE_ID_RE.test(b.id)) {
      return c.json({ ok: false, error: "存储 id 无效" }, 400);
    }
    const row = await c.env.DB.prepare(
      "SELECT kind, config FROM storages WHERE id = ?").bind(b.id).first();
    if (!row) return c.json({ ok: false, error: "not found" }, 404);
    const normalizedConfig = normalizeStorageConfig(row.kind, configJson(row.config));
    if (normalizedConfig === INVALID_INPUT) {
      return c.json({ ok: false, error: "已保存的存储配置字段无效" });
    }
    try { return c.json(await storage.testConfig(c.env, row.kind, normalizedConfig)); }
    catch (e) {
      return c.json({ ok: false, error: String(e?.message || e) }, 502);
    }
  }
  if (!STORAGE_KINDS.includes(b.kind)
      || (b.config !== undefined && !plainObject(b.config))) {
    return c.json({ ok: false, error: "kind / config 格式无效" }, 400);
  }
  const normalizedConfig = normalizeStorageConfig(b.kind, b.config || {});
  if (normalizedConfig === INVALID_INPUT) {
    return c.json({ ok: false, error: "存储配置字段无效" }, 400);
  }
  try { return c.json(await storage.testConfig(c.env, b.kind, normalizedConfig)); }
  catch (e) {
    return c.json({ ok: false, error: String(e?.message || e) }, 502);
  }
});

/* 迁移一步：搬一张音盤的第 fileIndex 个文件；搬完返回 finished:true。
   源文件保留（冷备）。返回 {ok,error?,finished,total,fileIndex,file,bytes} */
const MIGRATION_CHUNK = 10 * 1024 * 1024; // Graph/Google 都接受；也是 320KiB 的整数倍
const UNKNOWN_SIZE_BUFFER_LIMIT = 32 * 1024 * 1024;

async function* fixedStreamChunks(stream, chunkSize = MIGRATION_CHUNK) {
  const reader = stream.getReader();
  let pending = new Uint8Array(chunkSize);
  let used = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const incoming = value instanceof Uint8Array ? value : new Uint8Array(value);
      let offset = 0;
      while (offset < incoming.length) {
        const take = Math.min(chunkSize - used, incoming.length - offset);
        pending.set(incoming.subarray(offset, offset + take), used);
        used += take;
        offset += take;
        if (used === chunkSize) {
          yield pending;
          pending = new Uint8Array(chunkSize);
          used = 0;
        }
      }
    }
    if (used) yield pending.slice(0, used);
  } finally {
    reader.releaseLock();
  }
}

export async function uploadResponseToSession(uploadUrl, response, total, contentType) {
  if (!response.body) throw new Error("源文件没有可读数据流");
  let offset = 0;
  for await (const chunk of fixedStreamChunks(response.body)) {
    const end = offset + chunk.byteLength - 1;
    if (end >= total) throw new Error("源文件长度超过登记大小");
    const r = await fetchWithTimeout(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType || "application/octet-stream",
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${offset}-${end}/${total}`,
      },
      body: chunk,
    }, 5 * 60_000);
    const reply = await r.text().catch(() => "");
    if (![200, 201, 202, 308].includes(r.status)) {
      throw new Error(`分片上传失败 ${r.status}: ${reply.slice(0, 200)}`);
    }
    const expected = end + 1;
    if ([200, 201].includes(r.status)) {
      if (expected !== total) {
        throw new Error("分片上传在源文件结束前被标记为完成");
      }
    } else {
      const range = /bytes=\d+-(\d+)/i.exec(r.headers.get("Range") || "");
      let acknowledged = range ? Number(range[1]) + 1 : null;
      if (acknowledged === null && reply) {
        try {
          const next = JSON.parse(reply)?.nextExpectedRanges?.[0];
          const match = /^(\d+)-/.exec(String(next || ""));
          if (match) acknowledged = Number(match[1]);
        } catch { /* checked below */ }
      }
      if (acknowledged !== expected) {
        throw new Error(
          `分片确认位置不符（确认 ${acknowledged ?? "unknown"}，预期 ${expected}）`);
      }
    }
    offset = expected;
  }
  if (offset !== total) {
    throw new Error(`源文件长度不符（读取 ${offset}，预期 ${total}）`);
  }
  return offset;
}

async function readRequestLimited(c, limit) {
  const declared = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new Error(`request exceeds ${limit} bytes`);
  }
  const stream = c.req.raw.body;
  if (!stream) return new ArrayBuffer(0);
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new Error(`request exceeds ${limit} bytes`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function readResponseLimited(response, limit = UNKNOWN_SIZE_BUFFER_LIMIT) {
  const declared = Number(response.headers?.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new Error(`响应超过 ${limit} 字节上限`);
  }
  if (!response.body) return new ArrayBuffer(0);
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new Error(`源站未提供文件大小，且文件超过 ${limit} 字节`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

async function collectStorageFiles(env, folder, storageId,
  out = [], depth = 0) {
  if (depth > 32) throw new Error(`存储目录层级过深: ${folder}`);
  if (out.length > 20_000) throw new Error("单张音盤文件超过 20000 个");
  const children = await storage.listChildren(env, folder, storageId, { strict: true });
  const names = new Set();
  for (const child of [...children].sort((a, b) =>
    String(a.name).localeCompare(String(b.name)))) {
    const name = String(child.name || "");
    if (!name || name.length > 255 || name === "." || name === ".."
        || /[\\/\u0000-\u001f]/.test(name)) {
      throw new Error(`存储目录含无法迁移的文件名: ${name || "(empty)"}`);
    }
    const nameKey = name.normalize("NFC").toLocaleLowerCase();
    if (names.has(nameKey)) {
      throw new Error(`存储目录含大小写/Unicode 冲突文件: ${name}`);
    }
    names.add(nameKey);
    const path = `${folder}/${name}`;
    if (child.file) {
      out.push({ path, size: Number(child.size) || null });
      if (out.length > 20_000) throw new Error("单张音盤文件超过 20000 个");
    } else if (child.folder) {
      await collectStorageFiles(env, path, storageId, out, depth + 1);
    } else {
      throw new Error(`存储目录含不支持的条目类型: ${name}`);
    }
  }
  return out;
}

async function migrateAlbumStep(env, albumId, targetId, fileIndex = 0) {
  if (!targetId) return { ok: false, error: "迁移目标必须是命名存储" };
  const album = await env.DB.prepare(
    "SELECT id, folder, cover_path, storage_id, artist, title FROM albums WHERE id = ?")
    .bind(albumId).first();
  if (!album) return { ok: false, error: "album not found" };
  let targetKind = "";
  if (targetId) {
    const t = await env.DB.prepare("SELECT id, kind FROM storages WHERE id = ?")
      .bind(targetId).first();
    if (!t) return { ok: false, error: "target not found" };
    targetKind = t.kind;
  }
  if ((album.storage_id || null) === (targetId || null)) {
    return { ok: false, error: "已经在目标存储上了" };
  }

  const { results: tracks } = await env.DB.prepare(
    "SELECT path, size FROM tracks WHERE album_id = ?").bind(albumId).all();
  const { results: imgs } = await env.DB.prepare(
    "SELECT path FROM album_images WHERE album_id = ?").bind(albumId).all();
  const avatar = await env.DB.prepare(
    "SELECT avatar_path, storage_id FROM artists WHERE name = ?")
    .bind(album.artist).first();
  const sourceId = album.storage_id || null;
  const avatarPath = avatar?.avatar_path
    && (avatar.storage_id || null) === sourceId ? avatar.avatar_path : null;
  const manifestKey = `mig:${albumId}:${sourceId || "none"}:${targetId}`;
  let files = await env.KV.get(manifestKey, "json").catch(() => null);
  if (Array.isArray(files) && !files.every((file) => {
    if (!plainObject(file) || typeof file.path !== "string") return false;
    const path = safePath(env, file.path);
    const inScope = path === file.path &&
      (path.startsWith(album.folder + "/") || path === avatarPath);
    return inScope && (file.size === null || file.size === undefined
      || (Number.isSafeInteger(file.size) && file.size >= 0));
  })) {
    files = null;
    await env.KV.delete(manifestKey).catch(() => null);
  }
  if (!Array.isArray(files)) {
    let discovered = [];
    try {
      discovered = await collectStorageFiles(
        env, album.folder, album.storage_id);
    } catch (error) {
      return { ok: false, error: `无法列出源音盤目录: ${error.message || error}` };
    }
    const candidates = [
      ...tracks.map((t) => ({ path: t.path, size: Number(t.size) || null })),
      ...imgs.map((i) => ({ path: i.path, size: null })),
      album.cover_path ? { path: album.cover_path, size: null } : null,
      avatarPath ? { path: avatarPath, size: null } : null,
      ...discovered,
    ].filter(Boolean);
    const byPath = new Map();
    for (const candidate of candidates) {
      const candidatePath = safePath(env, candidate.path);
      if (!candidatePath || (candidatePath !== avatarPath
          && !candidatePath.startsWith(album.folder + "/"))) {
        return { ok: false, error: `迁移清单含越界路径: ${candidate.path}` };
      }
      candidate.path = candidatePath;
      const existing = byPath.get(candidatePath);
      if (!existing || (!existing.size && candidate.size)) {
        byPath.set(candidatePath, candidate);
      }
    }
    files = [...byPath.values()];
    await env.KV.put(manifestKey, JSON.stringify(files), { expirationTtl: 3600 });
  }

  if (fileIndex > files.length) {
    return { ok: false, error: "fileIndex 超出迁移清单范围" };
  }
  if (fileIndex === files.length) {
    const updates = [env.DB.prepare(
      "UPDATE albums SET storage_id = ? WHERE id = ?")
      .bind(targetId || null, albumId)];
    if (avatarPath) {
      updates.push(env.DB.prepare(
        "UPDATE artists SET storage_id = ? WHERE name = ? AND avatar_path = ?")
        .bind(targetId || null, album.artist, avatarPath));
    }
    await env.DB.batch(updates);
    await env.KV.delete(manifestKey).catch(() => null);
    await invalidateR2(env, `art:${albumId}:`);
    if (avatarPath) await purgeArtistR2(env, album.artist, false);
    return {
      ok: true, finished: true, total: files.length,
      albumId, artist: album.artist, title: album.title,
    };
  }

  const file = files[fileIndex];
  const path = file.path;
  let src;
  try {
    src = await storage.getFile(env, path, album.storage_id);
  } catch (e) {
    return { ok: false, error: `源文件读取失败: ${path}（${e.message || e}）` };
  }
  if (!src || !(src.ok || src.status === 206)) {
    if (src) await discardResponse(src);
    return { ok: false, error: `源文件读取失败: ${path}` };
  }
  const ct = src.headers.get("Content-Type") || "application/octet-stream";
  const headerSize = Number(src.headers.get("Content-Length"));
  const knownSize = Number.isSafeInteger(headerSize) && headerSize >= 0
    ? headerSize
    : (Number.isSafeInteger(file.size) && file.size >= 0 ? file.size : null);
  let transferred = 0;
  try {
    let ok = false;
    if (["webdav", "local"].includes(targetKind)) {
      ok = await storage.putFile(env, path, src.body, ct, targetId);
      transferred = knownSize || 0;
    } else if (knownSize === 0) {
      await discardResponse(src);
      ok = await storage.putSmallFile(
        env, path, new ArrayBuffer(0), ct, targetId);
      transferred = 0;
    } else if (["onedrive", "gdrive"].includes(targetKind) && knownSize !== null) {
      const uploadUrl = await storage.createUploadSession(env, path, targetId);
      transferred = await uploadResponseToSession(uploadUrl, src, knownSize, ct);
      ok = true;
    } else {
      // Old rows may lack size and a few origins omit Content-Length. Keep the
      // compatibility path bounded so it can never consume the whole isolate.
      const bytes = await readResponseLimited(src);
      transferred = bytes.byteLength;
      ok = await storage.putSmallFile(env, path, bytes, ct, targetId);
    }
    if (!ok) {
      await discardResponse(src);
      return { ok: false, error: `写入目标失败: ${path}` };
    }
  } catch (e) {
    await discardResponse(src);
    return { ok: false, error: `写入目标失败: ${path}（${e.message || e}）` };
  }
  return {
    ok: true, finished: false, total: files.length,
    fileIndex: fileIndex + 1, file: path.split("/").pop(),
    bytes: transferred, albumId,
    artist: album.artist, title: album.title,
  };
}

app.post("/api/admin/storages/migrate", async (c) => {
  const b = await requestObject(c);
  const { albumId, targetId, fileIndex = 0 } = b || {};
  const index = finiteNumber(fileIndex, { integer: true, min: 0 });
  if (typeof albumId !== "string" || !albumId
      || (targetId !== null && targetId !== undefined
        && typeof targetId !== "string") || index === null) {
    return c.json({ error: "albumId / targetId / fileIndex 参数无效" }, 400);
  }
  const r = await migrateAlbumStep(c.env, albumId, targetId ?? null, index);
  if (!r.ok) return c.json({ error: r.error }, 400);
  return c.json(r);
});

/* 整库一键迁移：推进到下一张「还没在目标上」的音盤，再从 fileIndex 搬文件。
   前端循环调用直到 finished。targetId 必须是另一个命名存储后端。 */
app.post("/api/admin/storages/migrate-all", async (c) => {
  const b = await requestObject(c) || {};
  const { targetId = null, albumOffset = 0, fileIndex = 0 } = b;
  const offset = finiteNumber(albumOffset, { integer: true, min: 0 });
  const index = finiteNumber(fileIndex, { integer: true, min: 0 });
  if (typeof targetId !== "string" || !targetId || offset === null || index === null) {
    return c.json({ error: "迁移参数无效" }, 400);
  }
  if (targetId) {
    const t = await c.env.DB.prepare("SELECT id FROM storages WHERE id = ?")
      .bind(targetId).first();
    if (!t) return c.json({ error: "target not found" }, 404);
  }
  const { results: allAlbums } = await c.env.DB.prepare(
    "SELECT id, artist, title, storage_id FROM albums ORDER BY created_at").all();
  const need = allAlbums.filter((a) => (a.storage_id || null) !== (targetId || null));
  // ``need`` shrinks after each completed album. albumOffset is a cumulative
  // done count, not an index into that newly-shrunk list; indexing need[offset]
  // skipped every other album (A done -> [B,C] -> offset 1 selected C).
  const totalAlbums = offset + need.length;
  if (!need.length) {
    return c.json({
      finished: true, totalAlbums, albumOffset: offset, doneAlbums: offset,
    });
  }
  const album = need[0];
  const step = await migrateAlbumStep(c.env, album.id, targetId, index);
  if (!step.ok) {
    return c.json({
      error: step.error, albumId: album.id, artist: album.artist,
      title: album.title, albumOffset: offset, totalAlbums, fileIndex: index,
    }, 502);
  }
  if (step.finished) {
    // 这张完成 → 推进到下一张（fileIndex 归零）
    const nextOffset = offset + 1;
    return c.json({
      finished: need.length === 1,
      albumFinished: true,
      albumOffset: nextOffset,
      fileIndex: 0,
      totalAlbums,
      doneAlbums: nextOffset,
      albumId: album.id,
      artist: album.artist,
      title: album.title,
      total: step.total,
    });
  }
  return c.json({
    finished: false,
    albumFinished: false,
    albumOffset: offset,
    fileIndex: step.fileIndex,
    totalAlbums,
    doneAlbums: offset,
    albumId: album.id,
    artist: album.artist,
    title: album.title,
    file: step.file,
    total: step.total,
    bytes: step.bytes,
  });
});

/* Google Drive OAuth：生成授权链接 / 用 code 换 refresh_token */
app.post("/api/admin/storages/gdrive-auth-url", async (c) => {
  const b = await requestObject(c) || {};
  const { clientId, redirectUri } = b;
  if (!clientId) return c.json({ error: "clientId 必填" }, 400);
  const gdrive = await import("./gdrive.js");
  return c.json({
    url: gdrive.authUrl(clientId, redirectUri || "http://localhost"),
  });
});

app.post("/api/admin/storages/gdrive-exchange", async (c) => {
  const b = await requestObject(c) || {};
  const { clientId, clientSecret, code, redirectUri } = b;
  if (!clientId || !clientSecret || !code) {
    return c.json({ error: "clientId / clientSecret / code 必填" }, 400);
  }
  try {
    const gdrive = await import("./gdrive.js");
    const tok = await gdrive.exchangeCode(
      clientId, clientSecret, code,
      redirectUri || "http://localhost");
    if (!tok.refresh_token) {
      return c.json({
        error: "未返回 refresh_token（请用 prompt=consent 重新授权，或检查应用是否已授权过）",
      }, 400);
    }
    return c.json({
      refreshToken: tok.refresh_token,
      // access_token 短命，不返回
    });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

/* ---------- 配置导出 / 导入（重新部署后一键还原命名存储 + R2 等） ----------
   导出不含口令哈希与 session 纪元；敏感字段原样导出（请妥善保管 JSON）。 */

app.get("/api/admin/config/export", async (c) => {
  const settings = {};
  for (const k of CONFIG_BACKUP_SETTING_KEYS) {
    const v = await getSetting(c.env, k);
    if (v != null && v !== "") settings[k] = v;
  }
  // R2：同样导出实际生效配置（DB 优先，缺省时已是 conf 解析结果）
  try {
    const r2c = await r2.r2Conf(c.env);
    if (r2c.accessKey) settings.r2_access_key = r2c.accessKey;
    if (r2c.secretKey) settings.r2_secret_key = r2c.secretKey;
    if (r2c.endpoint) settings.r2_endpoint = r2c.endpoint;
    if (r2c.bucket) settings.r2_bucket = r2c.bucket;
    if (r2c.publicUrl) settings.r2_public_url = r2c.publicUrl;
    settings.r2_enabled = r2c.enabled ? "1" : "0";
  } catch { /* ignore */ }

  const { results: storages } = await c.env.DB.prepare(
    "SELECT id, name, kind, config, is_write, created_at FROM storages ORDER BY created_at").all();
  return c.json({
    version: 1,
    exportedAt: Date.now(),
    odRoot: c.env.OD_ROOT || "Music/Library",
    settings,
    storages: storages.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      config: configJson(s.config),
      isWrite: !!s.is_write,
      createdAt: s.created_at,
    })),
  });
});

app.post("/api/admin/config/import", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!plainObject(body)
      || (body.settings !== undefined && !plainObject(body.settings))
      || (body.storages !== undefined && !Array.isArray(body.storages))) {
    return c.json({ error: "无效的配置 JSON" }, 400);
  }

  // Validate the complete payload before writing anything. A partially
  // imported credential set is harder to recover from than a rejected file.
  const normalizedSettings = [];
  const settings = body.settings || {};
  const booleanSettings = new Set([
    "r2_enabled", "guest_open", "module_source", "stream_proxy",
  ]);
  for (const key of CONFIG_BACKUP_SETTING_KEYS) {
    if (settings[key] === undefined || settings[key] === "") continue;
    if (typeof settings[key] !== "string") {
      return c.json({ error: `设置 ${key} 必须是字符串` }, 400);
    }
    let value = settings[key];
    if (booleanSettings.has(key) && !["0", "1"].includes(value)) {
      return c.json({ error: `设置 ${key} 只能是 0 或 1` }, 400);
    }
    if (key === "archive_passwords") {
      const parsed = J(value, null);
      const passwords = strictTextList(parsed, {
        maxItems: 200, maxItemLength: 512,
      });
      if (passwords === INVALID_INPUT) {
        return c.json({ error: "archive_passwords 必须是 JSON 字符串数组" }, 400);
      }
      value = JSON.stringify(passwords);
    }
    if (["source_url", "stream_proxy_url", "r2_endpoint", "r2_public_url"]
      .includes(key)) {
      const url = validHttpUrl(value, 2048);
      if (url === INVALID_INPUT) {
        return c.json({ error: `设置 ${key} 必须是 http(s) URL` }, 400);
      }
      value = url;
    }
    normalizedSettings.push([key, value]);
  }

  const normalizedStorages = [];
  const seenIds = new Set();
  let requestedWrites = 0;
  if ((body.storages || []).length > MAX_CONFIG_IMPORT_STORAGES) {
    return c.json({ error: `一次最多导入 ${MAX_CONFIG_IMPORT_STORAGES} 个存储` }, 400);
  }
  for (const raw of body.storages || []) {
    if (!plainObject(raw) || typeof raw.name !== "string" || !raw.name.trim()
        || raw.name.trim().length > 100 || !STORAGE_KINDS.includes(raw.kind)
        || (raw.config !== undefined && !plainObject(raw.config))
        || (raw.isWrite !== undefined && typeof raw.isWrite !== "boolean")) {
      return c.json({ error: "存储配置条目无效" }, 400);
    }
    let id = raw.id;
    if (id !== undefined && (typeof id !== "string"
        || !STORAGE_ID_RE.test(id.trim()))) {
      return c.json({ error: `存储 id 不合法: ${String(id)}` }, 400);
    }
    id = id?.trim() || (await sha16(
      `${raw.name}:${Date.now()}:${Math.random()}`)).slice(0, 8);
    if (seenIds.has(id)) return c.json({ error: `存储 id 重复: ${id}` }, 400);
    seenIds.add(id);
    if (raw.isWrite) requestedWrites++;
    const createdAt = raw.createdAt === undefined
      ? Date.now() : finiteInput(raw.createdAt, {
        integer: true, min: 1, max: Number.MAX_SAFE_INTEGER,
      });
    const config = normalizeStorageConfig(raw.kind, raw.config || {});
    const configJsonText = config === INVALID_INPUT ? "" : JSON.stringify(config);
    if (createdAt === INVALID_INPUT || createdAt === null
        || !configJsonText || configJsonText.length > 65_536) {
      return c.json({ error: "存储配置条目无效" }, 400);
    }
    normalizedStorages.push({
      id, name: raw.name.trim(), kind: raw.kind, config,
      isWrite: !!raw.isWrite,
      createdAt,
    });
  }
  if (requestedWrites > 1) {
    return c.json({ error: "配置中只能有一个写入目标" }, 400);
  }
  const { results: existingStorages } = await c.env.DB.prepare(
    "SELECT id, kind, config, is_write, created_at FROM storages").all();
  const existingById = new Map(existingStorages.map((row) => [row.id, row]));
  for (const item of normalizedStorages) {
    const existing = existingById.get(item.id);
    if (existing && existing.kind !== item.kind) {
      const albumUse = await c.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM albums WHERE storage_id = ?")
        .bind(item.id).first();
      const avatarUse = await c.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM artists WHERE storage_id = ?")
        .bind(item.id).first();
      if ((albumUse?.n || 0) + (avatarUse?.n || 0) > 0) {
        return c.json({
          error: `存储 ${item.id} 正在使用，不能从 ${existing.kind} 改成 ${item.kind}`,
        }, 409);
      }
    }
  }
  for (const item of normalizedStorages) {
    const prior = existingById.get(item.id);
    if (prior) {
      await storage.invalidateCredentialCache(
        c.env, item.id, prior.kind, configJson(prior.config));
    }
    await storage.invalidateCredentialCache(
      c.env, item.id, item.kind, item.config);
  }

  const statements = normalizedSettings.map(([key, value]) =>
    c.env.DB.prepare(`INSERT INTO settings (k, v) VALUES (?, ?)
      ON CONFLICT(k) DO UPDATE SET v = excluded.v`).bind(key, value));
  let selectedWriteId = null;
  if (normalizedStorages.length) {
    if (requestedWrites) {
      selectedWriteId = normalizedStorages.find((item) => item.isWrite).id;
    } else {
      const finalRows = new Map(existingStorages.map((row) => [row.id, {
        id: row.id, isWrite: !!row.is_write, createdAt: row.created_at,
      }]));
      for (const item of normalizedStorages) {
        const prior = finalRows.get(item.id);
        finalRows.set(item.id, {
          id: item.id, isWrite: false,
          createdAt: prior?.createdAt ?? item.createdAt,
        });
      }
      const ordered = [...finalRows.values()].sort((a, b) =>
        Number(a.createdAt || 0) - Number(b.createdAt || 0)
          || a.id.localeCompare(b.id));
      selectedWriteId = ordered.find((row) => row.isWrite)?.id
        || ordered[0]?.id || null;
    }
    statements.push(c.env.DB.prepare("UPDATE storages SET is_write = 0"));
  }
  for (const item of normalizedStorages) {
      const cfg = JSON.stringify(item.config);
      statements.push(c.env.DB.prepare(`
        INSERT INTO storages (id, name, kind, config, is_write, created_at)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          config = excluded.config,
          is_write = excluded.is_write
      `).bind(item.id, item.name, item.kind, cfg, 0, item.createdAt));
  }
  if (selectedWriteId) {
    statements.push(c.env.DB.prepare(
      "UPDATE storages SET is_write = 1 WHERE id = ?").bind(selectedWriteId));
  }
  if (statements.length) await c.env.DB.batch(statements);
  storage.clearStorageCache();
  return c.json({
    ok: true,
    importedSettings: normalizedSettings.length,
    importedStorages: normalizedStorages.length,
  });
});

/* ---------- 伴侣端点（拉设置 + 心跳） ---------- */

app.get("/api/companion/settings", async (c) => {
  await setSetting(c.env, "companion_last_seen", String(Date.now()));
  return c.json({
    sourceUrl: (await getSetting(c.env, "source_url")) || "",
    archivePasswords: settingStringList(
      (await getSetting(c.env, "archive_passwords")) || "[]"),
  });
});

export default {
  fetch: app.fetch,
  // Cloudflare Cron Trigger（wrangler.jsonc triggers.crons）：定时扫资源站新帖。
  // 资源站模块关闭时（默认）跳过，不浪费调用也不碰外部站点。
  scheduled: (event, env, ctx) => ctx.waitUntil((async () => {
    if ((await getSetting(env, "module_source")) === "1") await scanSource(env);
  })()),
};
