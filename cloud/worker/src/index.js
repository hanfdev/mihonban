// mihonban cloud — API Worker
// Browsing and metadata: D1. Audio: direct OneDrive Graph redirects, with bytes
// bypassing the Worker. Authentication: password login to an HMAC cookie; the
// local companion uses X-Api-Key.

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
const MAX_STORAGE_PATH = 400; // Full-path limit for OneDrive/Graph
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

function mergeStringLists(existing, incoming) {
  const seen = new Set();
  const merged = [];
  for (const value of [...stringList(existing), ...stringList(incoming)]) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }
  return merged;
}

const MAX_ALBUM_ARTISTS = 24;

function artistCredit(artists) {
  const names = (artists || []).map((artist) => artist.name).filter(Boolean);
  if (names.length === 2) return names.join(" × ");
  return names.join(", ");
}

function explicitArtistSort(name, sort) {
  const artistName = String(name || "").normalize("NFC");
  const value = String(sort || "").trim().normalize("NFC");
  return value && value !== artistName ? value : "";
}

const artistIdentityKey = (name) =>
  String(name || "").normalize("NFC").toLocaleLowerCase();

async function canonicalizeArtistCredits(db, artists) {
  if (!artists.length) return artists;
  const names = [...new Set(artists.map((artist) => artist.name))];
  const exactNames = new Set();
  const canonicalByKey = new Map();
  for (let index = 0; index < names.length; index += 80) {
    const chunk = names.slice(index, index + 80);
    const marks = chunk.map(() => "?").join(",");
    const { results } = await db.prepare(`
      SELECT name FROM artists
      WHERE name COLLATE NOCASE IN (${marks}) ORDER BY name`)
      .bind(...chunk).all();
    for (const row of results) {
      exactNames.add(row.name);
      const key = artistIdentityKey(row.name);
      if (!canonicalByKey.has(key)) canonicalByKey.set(key, row.name);
    }
  }
  return artists.map((artist) => {
    const canonical = exactNames.has(artist.name)
      ? artist.name : canonicalByKey.get(artistIdentityKey(artist.name));
    if (!canonical || canonical === artist.name) return artist;
    return {
      ...artist,
      name: canonical,
      sort: explicitArtistSort(canonical, artist.sort),
    };
  });
}

async function canonicalArtistName(db, name) {
  const [artist] = await canonicalizeArtistCredits(db, [{ name, sort: "" }]);
  return artist.name;
}

function albumArtistsInput(value, fallbackName = "", fallbackSort = "") {
  const source = value === undefined
    ? [{ name: fallbackName, sort: fallbackSort }]
    : value;
  if (!Array.isArray(source) || !source.length
      || source.length > MAX_ALBUM_ARTISTS) return INVALID_INPUT;
  const seen = new Set();
  const artists = [];
  for (const item of source) {
    const object = typeof item === "string" ? { name: item } : item;
    if (!object || typeof object !== "object" || Array.isArray(object)) {
      return INVALID_INPUT;
    }
    const name = boundedText(object.name, 500, { allowEmpty: false });
    const sort = object.sort === undefined
      ? "" : boundedText(object.sort, 500);
    if (name === INVALID_INPUT || sort === INVALID_INPUT) return INVALID_INPUT;
    const normalizedName = name.normalize("NFC");
    const normalizedSort = explicitArtistSort(normalizedName, sort);
    const key = normalizedName.toLocaleLowerCase();
    if (seen.has(key)) return INVALID_INPUT;
    seen.add(key);
    artists.push({ name: normalizedName, sort: normalizedSort });
  }
  if (artistCredit(artists).length > 500) return INVALID_INPUT;
  return artists;
}

function trackArtistsInput(value) {
  if (!Array.isArray(value) || value.length > MAX_ALBUM_ARTISTS) {
    return INVALID_INPUT;
  }
  return value.length ? albumArtistsInput(value) : [];
}

const sameArtistCredit = (left, right) => left.length === right.length
  && left.every((artist, index) =>
    artistIdentityKey(artist.name) === artistIdentityKey(right[index]?.name));

async function applyArtistSortOverrides(db, artists) {
  if (!artists.length) return artists;
  const names = [...new Set(artists.map((artist) => artist.name))];
  const overrides = new Map();
  for (let index = 0; index < names.length; index += 80) {
    const chunk = names.slice(index, index + 80);
    const marks = chunk.map(() => "?").join(",");
    const { results } = await db.prepare(`
      SELECT id, text FROM notes WHERE kind = 'artistsort' AND id IN (${marks})`)
      .bind(...chunk).all();
    for (const row of results) overrides.set(row.id, row.text?.trim());
  }
  return artists.map((artist) => ({
    ...artist,
    sort: overrides.has(artist.name)
      ? explicitArtistSort(artist.name, overrides.get(artist.name))
      : explicitArtistSort(artist.name, artist.sort),
  }));
}

function groupAlbumArtists(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const list = grouped.get(row.album_id) || [];
    list.push({ name: row.artist,
      sort: explicitArtistSort(row.artist, row.artist_sort) });
    grouped.set(row.album_id, list);
  }
  return grouped;
}

function groupTrackArtists(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const list = grouped.get(row.track_id) || [];
    list.push({ name: row.artist,
      sort: explicitArtistSort(row.artist, row.artist_sort) });
    grouped.set(row.track_id, list);
  }
  return grouped;
}

async function artistsForAlbum(db, albumId) {
  const { results } = await db.prepare(`
    SELECT album_id, artist, artist_sort FROM album_artists
    WHERE album_id = ? ORDER BY position`).bind(albumId).all();
  return groupAlbumArtists(results).get(albumId) || [];
}

async function artistsForTrack(db, trackId) {
  const { results } = await db.prepare(`
    SELECT track_id, artist, artist_sort FROM track_artists
    WHERE track_id = ? ORDER BY position`).bind(trackId).all();
  return groupTrackArtists(results).get(trackId) || [];
}

async function contributorsForAlbum(db, albumId) {
  const { results } = await db.prepare(`
    SELECT album_id, artist, artist_sort FROM artist_album_links
    WHERE album_id = ? ORDER BY artist COLLATE NOCASE`).bind(albumId).all();
  return groupAlbumArtists(results).get(albumId) || [];
}

const artistRowsForAlbum = (db, albumId, artists) => artists.map((artist, position) =>
  db.prepare(`INSERT INTO album_artists
    (album_id, artist, artist_sort, position) VALUES (?, ?, ?, ?)`)
    .bind(albumId, artist.name, explicitArtistSort(artist.name, artist.sort), position));

const artistRowsForTrack = (db, trackId, artists) => artists.map((artist, position) =>
  db.prepare(`INSERT INTO track_artists
    (track_id, artist, artist_sort, position) VALUES (?, ?, ?, ?)`)
    .bind(trackId, artist.name, explicitArtistSort(artist.name, artist.sort), position));

function removeInheritedTrackArtists(db, albumId, artists) {
  const matches = artists.map(() => "(ta.position = ? AND ta.artist = ?)").join(" OR ");
  const values = artists.flatMap((artist, position) => [position, artist.name]);
  return db.prepare(`DELETE FROM track_artists WHERE track_id IN (
    SELECT ta.track_id FROM track_artists ta
    JOIN tracks t ON t.id = ta.track_id
    WHERE t.album_id = ?
    GROUP BY ta.track_id
    HAVING COUNT(*) = ?
      AND SUM(CASE WHEN ${matches} THEN 1 ELSE 0 END) = ?
  )`).bind(albumId, artists.length, ...values, artists.length);
}

const ensureArtistRows = (db, artists) => artists.map((artist) =>
  db.prepare(`INSERT INTO artists (name, avatar_path) VALUES (?, '')
    ON CONFLICT(name) DO NOTHING`).bind(artist.name));

async function cleanupOrphanArtists(env, artists) {
  const names = [...new Set((artists || []).map((artist) => artist.name).filter(Boolean))];
  for (const name of names) {
    try {
      const left = await env.DB.prepare(
        "SELECT 1 FROM artist_album_links WHERE artist = ? LIMIT 1")
        .bind(name).first();
      if (left) continue;
      await purgeArtistR2(env, name, false);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM artists WHERE name = ?").bind(name),
        env.DB.prepare(
          "DELETE FROM notes WHERE kind IN ('artist','artistbio','artistsort') AND id = ?")
          .bind(name),
      ]);
    } catch (error) {
      console.error("orphan artist cleanup failed", name, error);
    }
  }
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
const RYM_RATING_PRIOR = 3.3;
const RYM_RATING_PRIOR_VOTES = 50;
const RYM_RATING_PRIOR_TOTAL = RYM_RATING_PRIOR * RYM_RATING_PRIOR_VOTES;
async function runD1Batches(db, statements, size = D1_BATCH_SIZE) {
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size));
  }
}

function albumOut(row) {
  // Parse each column only once. genres/sec_genres previously parsed separately
  // under rym and at the top level, costing /api/library another 2-3 parses per
  // album without changing the output bytes.
  const genres = J(row.genres);
  const secondaryGenres = J(row.sec_genres);
  const artists = Array.isArray(row.albumArtists) && row.albumArtists.length
    ? row.albumArtists
    : [{ name: row.artist,
      sort: explicitArtistSort(row.artist, row.artist_sort) }];
  return {
    id: row.id, artist: artistCredit(artists) || row.artist,
    artistSort: explicitArtistSort(artists[0]?.name || row.artist,
      artists[0]?.sort ?? row.artist_sort), artists,
    title: row.title, year: row.year, folder: row.folder,
    storageId: row.storage_id || null,
    hidden: !!row.hidden,
    rym: row.rym_rating == null && !row.rym_url ? null : {
      rating: row.rym_rating, votes: row.rym_votes,
      rank: row.rym_rank || null, rymUrl: row.rym_url || null,
      genres, secondaryGenres,
      descriptors: J(row.descriptors),
    },
    genres, secondaryGenres,
    trackCount: row.track_count, duration: row.total_duration,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const canSeeHidden = (c) => ["admin", "companion"].includes(c.get("role"));

// Catalog version stamp: every album or track write either changes the row count
// or updates albums.updated_at, as enforced by each write endpoint. Therefore
// (COUNT, MAX(updated_at)) is a valid weak ETag. An If-None-Match hit returns 304,
// avoiding a large JOIN, serialization, and full transfer.
async function catalogEtag(c, variant) {
  const stamp = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), 0) AS m FROM albums")
    .first();
  return `W/"${variant}-${stamp.n}-${stamp.m}"`;
}

const notModified = (etag) => new Response(null, {
  status: 304,
  headers: { "ETag": etag, "Cache-Control": "private, no-cache" },
});

// Read multiple settings in one round trip; one D1 query per getSetting key adds
// substantial cost on hot paths.
async function getSettingsMap(env, keys) {
  const marks = keys.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT k, v FROM settings WHERE k IN (${marks})`).bind(...keys).all();
  const map = Object.create(null);
  for (const row of results) map[row.k] = row.v;
  return map;
}

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
  await loginDelay(); // Balanced delay slows brute force and evens out response timing.
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
  // When passwordless guest access is enabled, admit unauthenticated visitors as
  // read-only users; the frontend uses this to skip the login page.
  if ((await getSetting(c.env, "guest_open")) === "1") {
    return c.json({ ok: true, role: "user", guest: true });
  }
  return c.json({ ok: false, role: null, guest: false });
});

app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

// Lightweight startup migration adds newer columns to older databases. ALTER
// errors when a column already exists, so ignore that case. Production uses a
// stable configuration key plus a persisted marker; without that, Cloudflare
// may provide a fresh binding object on each request and repeat the whole check.
const RUNTIME_SCHEMA_VERSION = "2026-08-05-1";
const migratedDbs = new WeakSet();
const migrationPromises = new WeakMap();
const configuredMigrated = new Set();
const configuredMigrationPromises = new Map();

function configuredMigrationKey(env) {
  const value = typeof env.DB_SCHEMA_KEY === "string"
    ? env.DB_SCHEMA_KEY.trim() : "";
  return value ? `configured:${value}` : null;
}

async function ensureMigrations(env) {
  const configuredKey = configuredMigrationKey(env);
  if (configuredKey) {
    if (configuredMigrated.has(configuredKey)) return;
    if (configuredMigrationPromises.has(configuredKey)) {
      return configuredMigrationPromises.get(configuredKey);
    }
  } else {
    if (migratedDbs.has(env.DB)) return;
    if (migrationPromises.has(env.DB)) return migrationPromises.get(env.DB);
  }

  const migration = (async () => {
    if (configuredKey) {
      try {
        const marker = await env.DB.prepare(
          "SELECT v FROM settings WHERE k = 'schema_version'").first();
        if (marker?.v === RUNTIME_SCHEMA_VERSION) return;
      } catch (error) {
        // The settings table is part of the supported schema. A missing table
        // means this is an older database and the compatibility migration must run.
        if (!/no such table/i.test(String(error?.message || error))) throw error;
      }
    }

    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS artists (
      name TEXT PRIMARY KEY,
      avatar_path TEXT NOT NULL DEFAULT '',
      storage_id TEXT
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS album_artists (
      album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      artist TEXT NOT NULL,
      artist_sort TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (album_id, artist),
      UNIQUE (album_id, position)
    )`).run();
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_album_artists_artist
      ON album_artists(artist, album_id)`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS track_artists (
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      artist TEXT NOT NULL,
      artist_sort TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (track_id, artist),
      UNIQUE (track_id, position)
    )`).run();
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_track_artists_artist
      ON track_artists(artist, track_id)`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS track_artist_imports (
      import_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      artist TEXT NOT NULL,
      artist_sort TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (import_id, track_id, artist),
      UNIQUE (import_id, track_id, position)
    )`).run();
    // Every legacy album starts with one exact credit. Combined strings are
    // intentionally not split: commas are valid inside names and sort keys.
    await env.DB.prepare(`INSERT OR IGNORE INTO album_artists
      (album_id, artist, artist_sort, position)
      SELECT id, artist, COALESCE(NULLIF(artist_sort, ''), artist), 0
      FROM albums WHERE TRIM(artist) != ''`).run();
    const alters = [
      "ALTER TABLE favorites ADD COLUMN sort_order INTEGER",
      "ALTER TABLE albums ADD COLUMN storage_id TEXT",
      "ALTER TABLE albums ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
      // NULL identifies a pre-migration row. Its current D1 title wins the first
      // time an older companion submits a different value, preventing data loss.
      "ALTER TABLE tracks ADD COLUMN title_override INTEGER",
      "ALTER TABLE artists ADD COLUMN storage_id TEXT",
      "ALTER TABLE album_images ADD COLUMN source_key TEXT",
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
    await env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_images_album_source
      ON album_images(album_id, source_key)
      WHERE source_key IS NOT NULL AND source_key != ''`).run();
    const artistLinksBody = `AS
      SELECT album_id, artist, artist_sort FROM album_artists
      UNION ALL
      SELECT t.album_id, ta.artist,
             COALESCE(MIN(NULLIF(TRIM(ta.artist_sort), '')), '') AS artist_sort
      FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
      WHERE NOT EXISTS (
        SELECT 1 FROM album_artists aa
        WHERE aa.album_id = t.album_id AND aa.artist = ta.artist
      )
      GROUP BY t.album_id, ta.artist`;
    const artistLinksSql = `CREATE VIEW IF NOT EXISTS artist_album_links ${artistLinksBody}`;
    const artistLinksView = await env.DB.prepare(`SELECT sql FROM sqlite_master
      WHERE type = 'view' AND name = 'artist_album_links'`).first();
    if (artistLinksView?.sql
        && (!/GROUP BY\s+t\.album_id\s*,\s*ta\.artist/i.test(artistLinksView.sql)
          || !/\)\s*,\s*''\s*\)\s+AS\s+artist_sort/i.test(artistLinksView.sql))) {
      await env.DB.batch([
        env.DB.prepare("DROP VIEW IF EXISTS artist_album_links"),
        env.DB.prepare(`CREATE VIEW artist_album_links ${artistLinksBody}`),
      ]);
    } else {
      await env.DB.prepare(artistLinksSql).run();
    }
    // Some legacy catalogs have credit rows but no supplemental artist row.
    // Backfill only the missing shell so case-insensitive identity resolution
    // also covers those artists; existing spelling and metadata remain intact.
    await env.DB.prepare(`INSERT OR IGNORE INTO artists (name, avatar_path)
      SELECT credit.name, '' FROM (
        SELECT MIN(name) AS name FROM (
          SELECT artist AS name FROM album_artists
          UNION ALL
          SELECT artist AS name FROM track_artists
        ) GROUP BY name COLLATE NOCASE
      ) credit
      WHERE NOT EXISTS (
        SELECT 1 FROM artists existing
        WHERE existing.name = credit.name COLLATE NOCASE
      )`).run();
    // Older multi-storage builds inferred avatar storage from the first album
    // of the artist. Persist that same association once so future reads and
    // migrations are deterministic even when the artist spans several disks.
    try {
      await env.DB.prepare(`UPDATE artists SET storage_id = (
        SELECT a.storage_id FROM artist_album_links aa
        JOIN albums a ON a.id = aa.album_id
        WHERE aa.artist = artists.name
        ORDER BY a.created_at LIMIT 1
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
      title_override INTEGER NOT NULL DEFAULT 0,
      duration REAL,
      format TEXT NOT NULL DEFAULT '',
      bitrate INTEGER,
      size INTEGER,
      path TEXT NOT NULL,
      artist_mode INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (import_id, id),
      UNIQUE (import_id, path)
    )`).run();
    try {
      await env.DB.prepare(
        "ALTER TABLE track_imports ADD COLUMN artist_mode INTEGER NOT NULL DEFAULT 0")
        .run();
    } catch (e) {
      if (!/duplicate column|already exists/i.test(String(e?.message || e))) throw e;
    }
    try {
      await env.DB.prepare(
        "ALTER TABLE track_imports ADD COLUMN title_override INTEGER NOT NULL DEFAULT 0")
        .run();
    } catch (e) {
      if (!/duplicate column|already exists/i.test(String(e?.message || e))) throw e;
    }
    await env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_track_imports_created ON track_imports(created_at)")
      .run();
    await env.DB.prepare("DELETE FROM track_imports WHERE created_at < ?")
      .bind(Date.now() - 24 * 60 * 60 * 1000).run();
    await env.DB.prepare(`DELETE FROM track_artist_imports WHERE import_id NOT IN
      (SELECT DISTINCT import_id FROM track_imports)`).run();

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
        SELECT a.storage_id FROM artist_album_links aa
        JOIN albums a ON a.id = aa.album_id
        WHERE aa.artist = artists.name
        ORDER BY a.created_at LIMIT 1
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
    // Index artist-scoped queries used by avatar resolution, deletion cleanup,
    // visibility checks, and the other WHERE artist = ? paths.
    try {
      await env.DB.prepare(
        "CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist)").run();
    } catch (e) {
      if (!/already exists/i.test(String(e?.message || e))) throw e;
    }
    // Provider path rules differ, so the catalog uses a portable identity:
    // within one backend, letter casing alone cannot create a second album or
    // track. The triggers close the small race between the friendly API check
    // and the final write without rewriting any existing records.
    await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS albums_path_case_guard
      BEFORE INSERT ON albums
      WHEN EXISTS (
        SELECT 1 FROM albums existing
        WHERE existing.storage_id = NEW.storage_id
          AND existing.id != NEW.id
          AND existing.folder = NEW.folder COLLATE NOCASE
      )
      BEGIN
        SELECT RAISE(ABORT, 'case-equivalent album folder already exists');
      END`).run();
    await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS tracks_path_case_guard
      BEFORE INSERT ON tracks
      WHEN EXISTS (
        SELECT 1 FROM tracks existing
        JOIN albums old_album ON old_album.id = existing.album_id
        JOIN albums new_album ON new_album.id = NEW.album_id
        WHERE old_album.storage_id = new_album.storage_id
          AND existing.id != NEW.id
          AND existing.path = NEW.path COLLATE NOCASE
      )
      BEGIN
        SELECT RAISE(ABORT, 'case-equivalent track path already exists');
      END`).run();
    // Preserve the first stored display spelling while rejecting any later
    // case-only identity. Exact INSERT OR IGNORE operations remain valid.
    await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS artists_name_case_guard
      BEFORE INSERT ON artists
      WHEN NOT EXISTS (SELECT 1 FROM artists WHERE name = NEW.name)
        AND EXISTS (SELECT 1 FROM artists
          WHERE name = NEW.name COLLATE NOCASE)
      BEGIN
        SELECT RAISE(ABORT, 'case-equivalent artist name already exists');
      END`).run();
    // The normalized genre side table turns same-genre recommendations from a
    // full-table json_each scan into an indexed lookup. Triggers keep every writer
    // (API, direct SQL, or a restored database) consistent. Install them only
    // here because wrangler d1 execute --file incorrectly splits BEGIN..END
    // bodies in schema.sql, while one runtime prepare call works correctly.
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS album_genres (
      album_id TEXT NOT NULL,
      genre TEXT NOT NULL,
      PRIMARY KEY (genre, album_id)
    )`).run();
    const GENRE_ROWS_SQL = (ref) => `
      INSERT OR IGNORE INTO album_genres (album_id, genre)
      SELECT ${ref}.id, lower(CAST(j.value AS TEXT))
      FROM json_each(CASE WHEN json_valid(${ref}.genres)
        THEN ${ref}.genres ELSE '[]' END) j
      UNION
      SELECT ${ref}.id, lower(CAST(j.value AS TEXT))
      FROM json_each(CASE WHEN json_valid(${ref}.sec_genres)
        THEN ${ref}.sec_genres ELSE '[]' END) j;`;
    await env.DB.prepare(`
      CREATE TRIGGER IF NOT EXISTS trg_album_genres_ins
      AFTER INSERT ON albums
      BEGIN
        ${GENRE_ROWS_SQL("new")}
      END`).run();
    await env.DB.prepare(`
      CREATE TRIGGER IF NOT EXISTS trg_album_genres_upd
      AFTER UPDATE OF genres, sec_genres ON albums
      BEGIN
        DELETE FROM album_genres WHERE album_id = new.id;
        ${GENRE_ROWS_SQL("new")}
      END`).run();
    await env.DB.prepare(`
      CREATE TRIGGER IF NOT EXISTS trg_album_genres_del
      AFTER DELETE ON albums
      BEGIN
        DELETE FROM album_genres WHERE album_id = old.id;
      END`).run();
    // Backfill albums that predate trigger installation on the first upgrade.
    const seeded = await env.DB.prepare(
      "SELECT 1 FROM album_genres LIMIT 1").first();
    if (!seeded) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO album_genres (album_id, genre)
        SELECT albums.id, lower(CAST(j.value AS TEXT))
        FROM albums, json_each(CASE WHEN json_valid(albums.genres)
          THEN albums.genres ELSE '[]' END) j
        UNION
        SELECT albums.id, lower(CAST(j.value AS TEXT))
        FROM albums, json_each(CASE WHEN json_valid(albums.sec_genres)
          THEN albums.sec_genres ELSE '[]' END) j`).run();
    }
    if (configuredKey) {
      await env.DB.prepare(`
        INSERT INTO settings (k, v) VALUES ('schema_version', ?)
        ON CONFLICT(k) DO UPDATE SET v = excluded.v`)
        .bind(RUNTIME_SCHEMA_VERSION).run();
    } else {
      migratedDbs.add(env.DB);
    }
  })().finally(() => {
    // Keep the resolved configured promise in the map so a concurrent request
    // cannot start a second migration between completion and marker caching.
    if (!configuredKey) migrationPromises.delete(env.DB);
  });

  if (configuredKey) {
    configuredMigrationPromises.set(configuredKey, migration);
    try {
      await migration;
      configuredMigrated.add(configuredKey);
    } catch (error) {
      configuredMigrationPromises.delete(configuredKey);
      throw error;
    }
    return;
  }

  migrationPromises.set(env.DB, migration);
  return migration;
}

app.use("/api/*", requireAuth());
app.use("/api/*", async (c, next) => { await ensureMigrations(c.env); await next(); });

// Regular users are read-only. Uploads, edits, deletes, registration, scanning,
// and Admin require an admin session or companion key.
const adminGate = requireAdmin();
app.use("/api/albums", adminGate);
app.use("/api/album/*", (c, next) =>
  c.req.method === "GET" ? next() : adminGate(c, next));
app.use("/api/upload/*", adminGate);
app.use("/api/scan", adminGate);
app.use("/api/admin/*", adminGate);
app.use("/api/companion/*", adminGate);
app.use("/api/discogs-lookup", adminGate);
app.use("/api/discogs-image-proxy", adminGate);
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
  // includeHidden=1 lets admins see hidden albums in Favorites and Admin;
  // otherwise they remain hidden from everyone.
  const showHidden = c.req.query("hidden") === "1" && canSeeHidden(c);
  const etag = await catalogEtag(c, `lib${showHidden ? "h" : ""}`);
  if (c.req.header("If-None-Match") === etag) return notModified(etag);
  const [{ results }, { results: artistRows }] = await Promise.all([
    c.env.DB.prepare(`
      SELECT a.*, COUNT(t.id) AS track_count,
             SUM(t.duration) AS total_duration
      FROM albums a LEFT JOIN tracks t ON t.album_id = a.id
      WHERE ${showHidden ? "1=1" : "COALESCE(a.hidden,0)=0"}
      GROUP BY a.id
      ORDER BY COALESCE(NULLIF(a.artist_sort, ''), a.artist),
               a.artist, a.year, a.title`).all(),
    c.env.DB.prepare(`SELECT aa.album_id, aa.artist, aa.artist_sort
      FROM album_artists aa JOIN albums a ON a.id = aa.album_id
      WHERE ${showHidden ? "1=1" : "COALESCE(a.hidden,0)=0"}
      ORDER BY aa.album_id, aa.position`).all(),
  ]);
  const artistMap = groupAlbumArtists(artistRows);
  return c.json(results.map((row) => albumOut({
    ...row, albumArtists: artistMap.get(row.id),
  })), 200,
    { "ETag": etag, "Cache-Control": "private, no-cache" });
});

app.get("/api/album/:id", async (c) => {
  const id = c.req.param("id");
  const album = await c.env.DB.prepare(`
    SELECT a.*, COUNT(t.id) AS track_count, SUM(t.duration) AS total_duration
    FROM albums a LEFT JOIN tracks t ON t.album_id = a.id
    WHERE a.id = ? GROUP BY a.id`).bind(id).first();
  if (!album || !album.id) return c.json({ error: "not found" }, 404);
  // Only admins may read hidden album details, even when a guest opens its hash directly.
  if (album.hidden && !canSeeHidden(c)) {
    return c.json({ error: "not found" }, 404);
  }
  // These four independent subqueries run concurrently, saving three D1 round
  // trips on the album page, one of the hottest read paths.
  const main = J(album.genres)[0];
  const [{ results: tracks }, noteRow, { results: images }, sim,
    { results: artistRows }, { results: trackArtistRows }] =
    await Promise.all([
      c.env.DB.prepare(`
        SELECT id, disc, track, title,
               title_override AS titleOverride,
               duration, format, bitrate, size, path
        FROM tracks WHERE album_id = ? ORDER BY disc, track, title`)
        .bind(id).all(),
      c.env.DB.prepare(
        "SELECT text FROM notes WHERE kind = 'album' AND id = ?")
        .bind(id).first(),
      c.env.DB.prepare(`
        SELECT id FROM album_images WHERE album_id = ?
        ORDER BY sort, created_at`).bind(id).all(),
      // Same-genre recommendations: other visible albums sharing a primary genre.
      // Above-average scores are confidence-adjusted with the same stable prior
      // as the library, so tiny samples cannot dominate broad consensus. The
      // album_genres side table keeps the genre lookup indexed.
      main
        ? c.env.DB.prepare(`
            SELECT a.id, a.artist, a.title, a.year,
                   a.rym_rating, a.rym_votes
            FROM album_genres g JOIN albums a ON a.id = g.album_id
            WHERE g.genre = lower(?) AND a.id != ? AND COALESCE(a.hidden,0)=0
            ORDER BY a.rym_rating IS NULL,
              CASE WHEN a.rym_rating <= ${RYM_RATING_PRIOR} THEN a.rym_rating
                ELSE ((a.rym_rating * COALESCE(a.rym_votes, 0))
                  + ${RYM_RATING_PRIOR_TOTAL})
                  / (COALESCE(a.rym_votes, 0) + ${RYM_RATING_PRIOR_VOTES})
              END DESC,
              COALESCE(a.rym_votes, 0) DESC, a.rym_rating DESC
            LIMIT 12`)
          .bind(main, id).all()
        : null,
      c.env.DB.prepare(`SELECT album_id, artist, artist_sort
        FROM album_artists WHERE album_id = ? ORDER BY position`).bind(id).all(),
      c.env.DB.prepare(`SELECT ta.track_id, ta.artist, ta.artist_sort
        FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
        WHERE t.album_id = ? ORDER BY ta.track_id, ta.position`).bind(id).all(),
    ]);
  const albumArtists = groupAlbumArtists(artistRows).get(id)
    || [{ name: album.artist,
      sort: explicitArtistSort(album.artist, album.artist_sort) }];
  const trackArtistMap = groupTrackArtists(trackArtistRows);
  const out = albumOut({ ...album, albumArtists });
  out.tracks = tracks.map((track) => {
    const ownArtists = trackArtistMap.get(track.id) || [];
    const artists = ownArtists.length ? ownArtists : albumArtists;
    return { ...track, titleOverride: !!track.titleOverride,
      artists, artist: artistCredit(artists),
      artistSort: explicitArtistSort(artists[0]?.name, artists[0]?.sort),
      hasCustomArtists: !!ownArtists.length };
  });
  out.note = noteRow?.text || "";
  out.images = images.map((i) => i.id);
  out.similar = (sim?.results || []).map((s) => ({
    id: s.id, artist: s.artist, title: s.title, year: s.year,
    rating: s.rym_rating, votes: s.rym_votes,
  }));
  return c.json(out);
});

/* ---------- All library tracks (Tracks view; fetch the personal library once
   and sort on the client) ---------- */

app.get("/api/tracks", async (c) => {
  const showHidden = c.req.query("hidden") === "1" && canSeeHidden(c);
  const etag = await catalogEtag(c, `trk${showHidden ? "h" : ""}`);
  if (c.req.header("If-None-Match") === etag) return notModified(etag);
  const [{ results }, { results: artistRows }, { results: trackArtistRows }] =
  await Promise.all([
    c.env.DB.prepare(`
      SELECT t.id, t.title, t.duration, t.format, t.track, t.disc,
             a.id AS albumId, a.title AS albumTitle, a.artist,
             a.artist_sort AS artistSort, a.year, a.created_at AS addedAt,
             COALESCE(a.hidden,0) AS hidden
      FROM tracks t JOIN albums a ON a.id = t.album_id
      WHERE ${showHidden ? "1=1" : "COALESCE(a.hidden,0)=0"}`).all(),
    c.env.DB.prepare(`SELECT aa.album_id, aa.artist, aa.artist_sort
      FROM album_artists aa JOIN albums a ON a.id = aa.album_id
      WHERE ${showHidden ? "1=1" : "COALESCE(a.hidden,0)=0"}
      ORDER BY aa.album_id, aa.position`).all(),
    c.env.DB.prepare(`SELECT ta.track_id, ta.artist, ta.artist_sort
      FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
      JOIN albums a ON a.id = t.album_id
      WHERE ${showHidden ? "1=1" : "COALESCE(a.hidden,0)=0"}
      ORDER BY ta.track_id, ta.position`).all(),
  ]);
  const artistMap = groupAlbumArtists(artistRows);
  const trackArtistMap = groupTrackArtists(trackArtistRows);
  const output = results.map((track) => {
    const ownArtists = trackArtistMap.get(track.id) || [];
    const artists = ownArtists.length ? ownArtists : artistMap.get(track.albumId)
      || [{ name: track.artist,
        sort: explicitArtistSort(track.artist, track.artistSort) }];
    return { ...track, artists, artist: artistCredit(artists),
      artistSort: explicitArtistSort(artists[0]?.name,
        artists[0]?.sort ?? track.artistSort),
      hasCustomArtists: !!ownArtists.length };
  });
  return c.json(output, 200,
    { "ETag": etag, "Cache-Control": "private, no-cache" });
});

/* ---------- Favorites (marked by admins, visible to everyone) ---------- */

app.get("/api/favorites", async (c) => {
  // Manual order is ascending. Legacy NULL rows retain newest-first ordering,
  // while every newly selected item receives a position ahead of the current minimum.
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

// Manual drag reorder: the frontend sends the complete ordered ID list for a
// kind, which becomes sort_order 0 through n-1.
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
    INSERT INTO favorites (kind, item_id, created_at, sort_order)
    VALUES (?, ?, ?, (
      SELECT COALESCE(MIN(sort_order) - 1, 0)
      FROM favorites WHERE kind = ?
    ))
    ON CONFLICT DO NOTHING`)
    .bind(kind, id, Date.now(), kind).run();
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

/* ---------- Artists (avatar and bio; the client filters albums by artist) ---------- */

app.get("/api/artists", async (c) => {
  // Show only artists with at least one visible album; omit orphaned rows from
  // the supplemental information table.
  const showHidden = c.req.query("hidden") === "1" && canSeeHidden(c);
  const vis = showHidden ? "1=1" : "COALESCE(a.hidden,0)=0";
  const { results } = await c.env.DB.prepare(`
    SELECT names.name AS name, ar.avatar_path AS avatar_path, n.text AS note,
           COALESCE(s.text, names.album_sort, '') AS sort_name,
           (b.id IS NOT NULL) AS has_bio,
           (SELECT COUNT(*) FROM track_artists ta
             JOIN tracks t ON t.id = ta.track_id
             JOIN albums a2 ON a2.id = t.album_id
             WHERE ta.artist = names.name
               AND ${showHidden ? "1=1" : "COALESCE(a2.hidden,0)=0"}
               AND NOT EXISTS (SELECT 1 FROM album_artists own
                 WHERE own.album_id = a2.id AND own.artist = names.name)
           ) AS featured_tracks,
           (SELECT COUNT(*) FROM track_artists ta
             JOIN tracks t ON t.id = ta.track_id
             JOIN albums a2 ON a2.id = t.album_id
             WHERE ta.artist = names.name AND COALESCE(a2.hidden,0)=0
               AND NOT EXISTS (SELECT 1 FROM album_artists own
                 WHERE own.album_id = a2.id AND own.artist = names.name)
           ) AS visible_featured_tracks
    FROM (
      SELECT aa.artist AS name,
             MIN(NULLIF(TRIM(aa.artist_sort), '')) AS album_sort
      FROM artist_album_links aa JOIN albums a ON a.id = aa.album_id
      WHERE ${vis}
      GROUP BY aa.artist
    ) names
    LEFT JOIN artists ar ON ar.name = names.name
    LEFT JOIN notes n ON n.kind = 'artist' AND n.id = names.name
    LEFT JOIN notes b ON b.kind = 'artistbio' AND b.id = names.name
    LEFT JOIN notes s ON s.kind = 'artistsort' AND s.id = names.name
    ORDER BY names.name COLLATE NOCASE`).all();
  return c.json(results.map((r) => ({
    name: r.name, hasAvatar: !!r.avatar_path, note: r.note || "",
    hasBio: !!r.has_bio, sort: explicitArtistSort(r.name, r.sort_name),
    featuredTrackCount: Number(r.featured_tracks) || 0,
    visibleFeaturedTrackCount: Number(r.visible_featured_tracks) || 0,
  })));
});

app.get("/api/artists/:name/tracks", async (c) => {
  const name = await canonicalArtistName(c.env.DB, artistNameParam(c));
  const showHidden = c.req.query("hidden") === "1" && canSeeHidden(c);
  const visibility = showHidden ? "1=1" : "COALESCE(a.hidden,0)=0";
  const [{ results }, { results: creditRows }] = await Promise.all([
    c.env.DB.prepare(`SELECT t.id, t.title, t.duration, t.format, t.track, t.disc,
        a.id AS albumId, a.title AS albumTitle, a.year, a.folder,
        COALESCE(a.hidden,0) AS hidden
      FROM track_artists mine JOIN tracks t ON t.id = mine.track_id
      JOIN albums a ON a.id = t.album_id
      WHERE mine.artist = ? AND ${visibility}
        AND NOT EXISTS (SELECT 1 FROM album_artists own
          WHERE own.album_id = a.id AND own.artist = ?)
      ORDER BY a.year, a.title, t.disc, t.track, t.title`)
      .bind(name, name).all(),
    c.env.DB.prepare(`SELECT ta.track_id, ta.artist, ta.artist_sort
      FROM track_artists ta WHERE ta.track_id IN (
        SELECT mine.track_id FROM track_artists mine
        JOIN tracks t ON t.id = mine.track_id
        JOIN albums a ON a.id = t.album_id
        WHERE mine.artist = ? AND ${visibility}
          AND NOT EXISTS (SELECT 1 FROM album_artists own
            WHERE own.album_id = a.id AND own.artist = ?)
      ) ORDER BY ta.track_id, ta.position`).bind(name, name).all(),
  ]);
  const credits = groupTrackArtists(creditRows);
  return c.json(results.map((track) => {
    const artists = credits.get(track.id) || [];
    return { ...track, artists, artist: artistCredit(artists),
      artistSort: artists[0]?.sort || "", hasCustomArtists: true };
  }));
});

// Fetch full Markdown bios separately because they may be too large for the list endpoint.
app.get("/api/artist-bio/:name", async (c) => {
  const name = await canonicalArtistName(c.env.DB, artistNameParam(c));
  if (!canSeeHidden(c)) {
    const visible = await c.env.DB.prepare(
      `SELECT 1 FROM artist_album_links aa JOIN albums a ON a.id = aa.album_id
       WHERE aa.artist = ? AND COALESCE(a.hidden,0)=0 LIMIT 1`)
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
  const name = await canonicalArtistName(c.env.DB, rawName.normalize("NFC"));
  if ((b.note !== undefined &&
       (typeof b.note !== "string" || b.note.length > 20_000))
      || (b.bio !== undefined &&
        (typeof b.bio !== "string" || b.bio.length > 200_000))
      || (b.artistSort !== undefined &&
        (typeof b.artistSort !== "string" || b.artistSort.length > 500))) {
    return c.json({ error: "艺人信息格式无效" }, 400);
  }
  let avatarChange = null;
  if (b.avatarPath !== undefined) {   // Update only when explicit, so editing a bio cannot clear the avatar.
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
        `SELECT a.folder, a.storage_id FROM artist_album_links aa
         JOIN albums a ON a.id = aa.album_id WHERE aa.artist = ?`)
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
    // Clear the R2 mirror when the avatar changes. Overwriting the same filename
    // preserves the key, so it must be invalidated explicitly.
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
  if (b.bio !== undefined) {   // Store the full Markdown bio separately from its excerpt.
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
  if (b.artistSort !== undefined) {
    const sort = explicitArtistSort(name, b.artistSort);
    const now = Date.now();
    const statements = [];
    if (sort && sort !== name) {
      statements.push(c.env.DB.prepare(`
        INSERT INTO notes (kind, id, text, updated_at)
        VALUES ('artistsort', ?, ?, ?)
        ON CONFLICT(kind, id) DO UPDATE SET text = excluded.text,
          updated_at = excluded.updated_at`).bind(name, sort, now));
    } else {
      statements.push(c.env.DB.prepare(
        "DELETE FROM notes WHERE kind = 'artistsort' AND id = ?").bind(name));
    }
    statements.push(c.env.DB.prepare(`UPDATE album_artists
      SET artist_sort = ? WHERE artist = ?`).bind(sort, name));
    statements.push(c.env.DB.prepare(`UPDATE track_artists
      SET artist_sort = ? WHERE artist = ?`).bind(sort, name));
    statements.push(c.env.DB.prepare(`UPDATE albums
      SET artist_sort = COALESCE((SELECT aa.artist_sort FROM album_artists aa
        WHERE aa.album_id = albums.id ORDER BY aa.position LIMIT 1), artist_sort),
        updated_at = ?
      WHERE id IN (SELECT album_id FROM album_artists WHERE artist = ?)`)
      .bind(now, name));
    await c.env.DB.batch(statements);
  }
  return c.json({ ok: true });
});

function artistNameParam(c) {
  let name = c.req.param("name") || "";
  try { name = decodeURIComponent(name); } catch { /* keep */ }
  return name.normalize("NFC");
}

app.get("/api/artist-art/:name", async (c) => {
  const name = await canonicalArtistName(c.env.DB, artistNameParam(c));
  const publiclyVisible = await c.env.DB.prepare(
    `SELECT 1 FROM artist_album_links aa JOIN albums a ON a.id = aa.album_id
     WHERE aa.artist = ? AND COALESCE(a.hidden,0)=0 LIMIT 1`)
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
    // A failed custom-avatar read is a 502. Never redirect to an album cover,
    // which would mask the failure and poison the cache.
    return c.json({ error: "avatar unavailable" }, 502, {
      "Cache-Control": "no-store",
    });
  }
  const ch = [...name][0]?.toUpperCase() || "♪";
  // Without a custom avatar, reuse a compact cover mirror from the earliest
  // visible album. Public fallback must always choose a visible album or an
  // admin could write a hidden cover into the public R2 cache.
  const albumVisibility = publiclyVisible
    ? "COALESCE(hidden,0)=0" : "1=1";
  const alb = await c.env.DB.prepare(`
    SELECT a.id, a.folder, a.cover_path, a.storage_id FROM artist_album_links aa
    JOIN albums a ON a.id = aa.album_id WHERE aa.artist = ?
      AND ${albumVisibility.replaceAll("hidden", "a.hidden")}
    ORDER BY a.year IS NULL, a.year, a.created_at LIMIT 1`).bind(name).first();
  if (alb) {
    const cover = await resolveCover(c.env, alb);
    if (cover) {
      const variant = coverImageVariant(120);
      const res = await serveImageR2(
        c, `art:${alb.id}:${variant.key}`, cover, null,
        publiclyVisible
          ? "public, max-age=300, stale-while-revalidate=86400"
          : "private, no-store",
        alb.storage_id || null, !!publiclyVisible, variant.transform,
        `art:${alb.id}:original`);
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

/* ---------- Automatic Discogs matching via the official server-side API,
   avoiding browser CORS restrictions ---------- */

const DISCOGS_USER_AGENT = "mihonban/1.0 (+https://github.com/hanfdev/mihonban)";
const DISCOGS_DAY = 24 * 60 * 60;
const discogsInflight = new Map();

async function discogsApiJson(env, token, path, query = {}, {
  freshSeconds = 7 * DISCOGS_DAY,
  staleSeconds = 30 * DISCOGS_DAY,
} = {}) {
  const url = new URL(path, "https://api.discogs.com/");
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const cacheId = await sha16(`${url.pathname}?${url.searchParams.toString()}`);
  const cacheKey = `discogs:v1:${cacheId}`;
  const now = Date.now();
  let cached = null;
  if (env.KV) {
    try { cached = await env.KV.get(cacheKey, "json"); } catch { /* cache miss */ }
  }
  const cacheAge = cached && Number.isFinite(cached.fetchedAt)
    ? now - cached.fetchedAt : Infinity;
  if (cached?.data && cacheAge <= freshSeconds * 1000) return cached.data;

  if (discogsInflight.has(cacheKey)) return discogsInflight.get(cacheKey);
  const request = (async () => {
    let response;
    try {
      response = await fetchWithTimeout(url, {
        headers: {
          "Authorization": `Discogs token=${token}`,
          "User-Agent": DISCOGS_USER_AGENT,
        },
      });
    } catch (error) {
      if (cached?.data && cacheAge <= staleSeconds * 1000) return cached.data;
      throw error;
    }
    if (response.status === 401) throw new Error("Discogs token 无效");
    if (response.status === 404) throw new Error("Discogs 上没有这个编号");
    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500)
          && cached?.data && cacheAge <= staleSeconds * 1000) {
        return cached.data;
      }
      if (response.status === 429) {
        throw new Error("Discogs 429：上游正在限流，请稍后重试");
      }
      throw new Error(`Discogs ${response.status}`);
    }
    const data = await response.json();
    if (env.KV) {
      try {
        await env.KV.put(cacheKey, JSON.stringify({ fetchedAt: now, data }), {
          expirationTtl: staleSeconds,
        });
      } catch { /* a cache write must not fail the request */ }
    }
    return data;
  })();
  discogsInflight.set(cacheKey, request);
  try { return await request; }
  finally { discogsInflight.delete(cacheKey); }
}

app.post("/api/album/:id/discogs-search", async (c) => {
  const token = await getSetting(c.env, "discogs_token");
  if (!token) {
    return c.json({ error: "未配置 Discogs token（管理后台 → Discogs）" }, 400);
  }
  const albumId = c.req.param("id");
  const [al, credits] = await Promise.all([
    c.env.DB.prepare(
      "SELECT artist, artist_sort, title, year FROM albums WHERE id = ?")
      .bind(albumId).first(),
    artistsForAlbum(c.env.DB, albumId),
  ]);
  if (!al) return c.json({ error: "not found" }, 404);

  const search = async (artist) => {
    const data = await discogsApiJson(c.env, token, "database/search", {
      release_title: al.title, artist, type: "release", per_page: 8,
    }, { freshSeconds: 60 * 60, staleSeconds: 7 * DISCOGS_DAY });
    return data.results || [];
  };

  try {
    // Try each collaborator's original name and natural-order romanization in
    // sequence, then fall back to the release title alone. Do not use compatibility
    // display fields such as "A x B" as the Discogs artist query.
    const source = credits.length ? credits
      : [{ name: al.artist,
        sort: explicitArtistSort(al.artist, al.artist_sort) }];
    const terms = [];
    const seen = new Set();
    const add = (value) => {
      const term = String(value || "").trim();
      const key = term.toLocaleLowerCase();
      if (term && !seen.has(key)) { seen.add(key); terms.push(term); }
    };
    for (const credit of source) {
      add(credit.name);
      const sort = credit.sort || "";
      add(sort.includes(",")
        ? sort.split(",").reverse().map((part) => part.trim()).join(" ")
        : sort);
    }
    let results = [];
    for (const term of terms) {
      results = await search(term);
      if (results.length) break;
    }
    if (!results.length) results = await search("");
    return c.json({
      candidates: results.slice(0, 8).map((r) => ({
        id: r.id, title: r.title || "", year: r.year || "",
        country: r.country || "",
        format: (r.format || []).slice(0, 3).join(" · "),
        label: (r.label || [])[0] || "",
        genres: r.genre || [], styles: r.style || [],
        thumb: r.thumb || r.cover_image || "",
        url: r.id ? `https://www.discogs.com/release/${r.id}` : "",
      })),
    });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

/* Paste a Discogs release or master URL directly and retrieve details from the
   official API. Use api.discogs.com only; do not scrape web pages. */
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
    const d = await discogsApiJson(c.env, token, `${ref.kind}/${ref.id}`);
    // Remove disambiguation suffixes such as "Artist (2)".
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

/* ---------- Discogs image import (album images / artist avatar and bio) ----------
   The server fetches images from Discogs and uploads them directly to storage;
   the browser never handles the bytes. Official API only. */

// Fetch the image list for a Discogs release/master, with primary images first.
async function discogsImages(env, token, kind, id) {
  const d = await discogsApiJson(env, token, `${kind}/${id}`);
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

// Discogs image hotlink protection requires Referer and User-Agent to retrieve bytes.
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

// Discogs image hosts reject ordinary browser hotlinks. Keep the signed source
// URL server-side and return verified image bytes through the authenticated
// same-origin API so candidate and detail thumbnails render consistently.
app.get("/api/discogs-image-proxy", async (c) => {
  const uri = c.req.query("url");
  if (!isDiscogsImageUrl(uri)) {
    return c.json({ error: "Discogs 图片地址无效" }, 400);
  }
  try {
    const { bytes, ct } = await fetchDiscogsBytes(uri);
    return new Response(bytes, {
      headers: {
        "Content-Type": ct,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

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
  // Discogs canonical URLs commonly append a title slug directly after the
  // numeric id: /release/12345-Artist-Title. Keep the separator strict so
  // paths such as /release/12345abc are not accepted as valid ids.
  const m = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(release|master)s?\/(\d+)(?:[-\/]|$)/i
    .exec(url.pathname);
  if (!m || !DISCOGS_ID_RE.test(m[2])) return null;
  return { kind: m[1].toLowerCase() === "master" ? "masters" : "releases", id: m[2] };
}

function discogsArtistIdFrom(value) {
  const text = typeof value === "string"
    ? value.trim()
    : (Number.isSafeInteger(value) ? String(value) : "");
  if (!text || text.length > 2048) return null;
  if (DISCOGS_ID_RE.test(text)) return text;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "discogs.com" && host !== "www.discogs.com") return null;
  const match = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?artists?\/(\d+)(?:[-\/]|$)/i
    .exec(url.pathname);
  return match && DISCOGS_ID_RE.test(match[1]) ? match[1] : null;
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

// List selectable images for a Discogs release/master for frontend preview.
app.post("/api/album/:id/discogs-image-list", async (c) => {
  const token = await getSetting(c.env, "discogs_token");
  if (!token) return c.json({ error: "未配置 Discogs token" }, 400);
  const body = await requestObject(c);
  const d = discogsIdFrom(body?.ref);
  if (!d) return c.json({ error: "认不出 Discogs 编号/链接" }, 400);
  try {
    const { images } = await discogsImages(c.env, token, d.kind, d.id);
    return c.json({ images });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

// Return a verified Discogs image through the authenticated same-origin API so
// the browser can load it into canvas without depending on Discogs CORS rules.
app.post("/api/album/:id/discogs-image-source", async (c) => {
  const album = await c.env.DB.prepare(
    "SELECT 1 FROM albums WHERE id = ?").bind(c.req.param("id")).first();
  if (!album) return c.json({ error: "not found" }, 404);
  const body = await requestObject(c);
  const d = discogsIdFrom(body?.ref);
  if (!d || !isDiscogsImageUrl(body?.uri)) {
    return c.json({ error: "Discogs 图片参数无效" }, 400);
  }
  try {
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

// Import selected album images: download, upload to <folder>/artwork/, and
// register album_images. With asCover=true, make the first image the cover.
app.post("/api/album/:id/discogs-import-images", async (c) => {
  const id = c.req.param("id");
  const album = await c.env.DB.prepare(
    "SELECT folder, cover_path, storage_id FROM albums WHERE id = ?").bind(id).first();
  if (!album) return c.json({ error: "not found" }, 404);
  const body = await requestObject(c);
  const { ref, uris, images, asCover } = body || {};
  const d = discogsIdFrom(ref);
  if (!d) return c.json({ error: "认不出 Discogs 编号/链接" }, 400);
  const structured = Array.isArray(images);
  const requested = structured ? images : uris;
  if (!Array.isArray(requested) || !requested.length || requested.length > 50
      || (structured
        ? requested.some((image) => !image || typeof image !== "object"
          || Array.isArray(image) || !Number.isSafeInteger(image.idx)
          || image.idx < 0 || image.idx > 10_000
          || !isDiscogsImageUrl(image.uri))
        : requested.some((uri) => !isDiscogsImageUrl(uri)))) {
    return c.json({ error: "没有选择图片" }, 400);
  }
  if (asCover !== undefined && typeof asCover !== "boolean") {
    return c.json({ error: "asCover 必须是布尔值" }, 400);
  }
  try {
    // Only authenticated admins reach this endpoint. URLs remain restricted to
    // Discogs-owned HTTPS hosts and downloaded bytes still pass size/signature
    // checks, so image import does not depend on a rate-limited API re-check.
    const pickedBySource = new Map();
    for (const item of requested) {
      const uri = structured ? item.uri : item;
      const sourceKey = structured
        ? `discogs:${d.kind}:${d.id}:${item.idx}`
        : `discogs:${d.kind}:${d.id}:url:${await sha16(uri)}`;
      const prior = pickedBySource.get(sourceKey);
      if (prior && prior.uri !== uri) {
        return c.json({ error: "Discogs 图片索引冲突" }, 400);
      }
      pickedBySource.set(sourceKey, { uri, sourceKey });
    }
    const picked = [...pickedBySource.values()];

    const imported = [];
    let failed = 0, skipped = 0;
    let coverSet = false;
    const sid = album.storage_id || null;
    const orderRow = await c.env.DB.prepare(
      "SELECT COALESCE(MAX(sort), -1) AS n FROM album_images WHERE album_id = ?")
      .bind(id).first();
    const firstSort = Number(orderRow?.n ?? -1) + 1;
    for (let i = 0; i < picked.length; i++) {
      const { uri, sourceKey } = picked[i];
      const existing = await c.env.DB.prepare(
        "SELECT id FROM album_images WHERE album_id = ? AND source_key = ?")
        .bind(id, sourceKey).first();
      if (existing) { skipped++; continue; }
      let bytes, ct;
      try {
        const image = await fetchDiscogsBytes(uri);
        bytes = image.bytes; ct = image.ct;
      } catch { failed++; continue; }
      if (bytes.byteLength > 12 * 1024 * 1024) { failed++; continue; }
      const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
      const path = `${album.folder}/artwork/discogs-${await sha16(sourceKey)}.${ext}`;
      const ok = await storage.putSmallFile(c.env, path, bytes, ct, sid);
      if (!ok) { failed++; continue; }
      // With asCover, the first image replaces the cover.
      if (asCover && !coverSet) {
        const coverPath = `${album.folder}/cover.${ext}`;
        const coverOk = await storage.putSmallFile(c.env, coverPath, bytes, ct, sid);
        if (coverOk) {
          await c.env.DB.prepare("UPDATE albums SET cover_path = ? WHERE id = ?")
            .bind(coverPath, id).run();
          await invalidateR2(c.env, `art:${id}:`); // Clear R2 mirrors after the cover changes.
          coverSet = true;
        }
      }
      const imgId = await sha16(path);
      const inserted = await c.env.DB.prepare(`
        INSERT INTO album_images
          (id, album_id, path, source_key, sort, created_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
        .bind(imgId, id, path, sourceKey, firstSort + imported.length,
          Date.now()).run();
      if (inserted.meta?.changes) imported.push(imgId);
      else skipped++;
    }
    if (imported.length || coverSet) {
      await c.env.DB.prepare("UPDATE albums SET updated_at = ? WHERE id = ?")
        .bind(Date.now(), id).run();
    }
    return c.json({
      ok: true, imported: imported.length, skipped, failed, coverSet,
      coverFailed: !!asCover && imported.length > 0 && !coverSet,
    });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

// Artist: search Discogs by name and preview avatar and bio before confirmation.
app.post("/api/artist-discogs-search", async (c) => {
  const token = await getSetting(c.env, "discogs_token");
  if (!token) return c.json({ error: "未配置 Discogs token" }, 400);
  const body = await requestObject(c);
  const name = boundedText(body?.name, 300, { allowEmpty: false });
  if (name === INVALID_INPUT) return c.json({ error: "name 格式无效" }, 400);
  try {
    const data = await discogsApiJson(c.env, token, "database/search", {
      q: name, type: "artist", per_page: 6,
    }, { freshSeconds: 60 * 60, staleSeconds: 7 * DISCOGS_DAY });
    const results = data.results || [];
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

// Fetch a Discogs artist's avatar and bio for preview.
app.post("/api/artist-discogs-detail", async (c) => {
  const token = await getSetting(c.env, "discogs_token");
  if (!token) return c.json({ error: "未配置 Discogs token" }, 400);
  const body = await requestObject(c);
  const artistId = discogsArtistIdFrom(body?.artistId);
  if (!artistId) return c.json({ error: "Discogs 艺人链接或 ID 格式无效" }, 400);
  try {
    const d = await discogsApiJson(c.env, token, `artists/${artistId}`);
    const imgs = (d.images || []).map((im) => ({
      uri: im.uri || "", thumb: im.uri150 || im.uri || "",
      type: im.type || "secondary",
    })).filter((im) => im.uri);
    imgs.sort((a, b) => (a.type === "primary" ? -1 : 0) - (b.type === "primary" ? -1 : 0));
    // Discogs profiles use [b]...[/b] BBCode and [a=name] artist links; reduce
    // them to plain text with a lightweight cleanup.
    const profile = (d.profile || "")
      .replace(/\[\/?[abiu](=[^\]]+)?\]/gi, "")
      .replace(/\[url=[^\]]+\]|\[\/url\]/gi, "")
      .trim();
    return c.json({ name: d.name || "", images: imgs, profile });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

// Import an artist avatar and bio: upload the avatar under a unique filename in
// the artist directory, then write the bio.
app.post("/api/artists/:name/discogs-import", async (c) => {
  const name = await canonicalArtistName(c.env.DB, artistNameParam(c));
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
  // Find any album directory for the artist and store the avatar one level above
  // it on the same storage backend.
  const alb = await c.env.DB.prepare(
    `SELECT a.folder, a.storage_id FROM artist_album_links aa
     JOIN albums a ON a.id = aa.album_id WHERE aa.artist = ?
     ORDER BY a.created_at LIMIT 1`).bind(name).first();
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
            // A unique filename gives every import a new path and R2 key, fully
            // avoiding stale caches from overwriting the same path.
            const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
            const stamp = `${Date.now().toString(36)}-${(await sha16(
              String.fromCharCode(...new Uint8Array(bytes.slice(0, 64))))).slice(0, 8)}`;
            const path = `${artistDir}/avatar-${stamp}.${ext}`;
            const prev = await c.env.DB.prepare(
              "SELECT avatar_path FROM artists WHERE name = ?").bind(name).first();
            const ok = await storage.putSmallFile(
              c.env, path, bytes, ct, alb.storage_id || null);
            if (ok) {
              await c.env.DB.prepare(`
                INSERT INTO artists (name, avatar_path, storage_id) VALUES (?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET
                  avatar_path = excluded.avatar_path,
                  storage_id = excluded.storage_id`)
                .bind(name, path, alb.storage_id || null).run();
              // The source write is durable. Old-object cleanup and the new
              // public mirror can finish after the response under waitUntil.
              const maintenance = [];
              if (prev?.avatar_path) {
                maintenance.push(invalidateR2(
                  c.env, `artist:${await sha16(prev.avatar_path)}:`));
              }
              maintenance.push(invalidateR2(
                c.env, `artist-fallback:${await sha16(name)}:`));
              const conf = await r2.r2Conf(c.env);
              if (conf.ready) {
                const cacheKey = `artist:${await sha16(path)}:480`;
                maintenance.push(mirrorImageBytes(
                  c, conf, cacheKey, bytes, ct));
              }
              await runBestEffortInBackground(
                c, Promise.allSettled(maintenance));
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

/* ---------- Playback and covers ---------- */

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
  // stream_proxy=1 enables audio proxying.
  // stream_proxy_url optionally selects another Worker or relay; blank uses this
  // site's /api/stream proxy. ?proxy=1 forces this site's proxy for one request,
  // used by frontend prefetch to avoid CORS.
  const proxySettings = await getSettingsMap(c.env,
    ["stream_proxy_url", "stream_proxy"]);
  const proxyTpl = (proxySettings.stream_proxy_url || "").trim();
  const onceProxy = c.req.query("proxy") === "1";
  const proxyOn = proxySettings.stream_proxy === "1";
  if (url) {
    // Custom external audio proxy: pass it the direct OneDrive URL. Supported
    // forms are https://proxy.example.com/?url={url} and
    // https://proxy.example.com/, where ?url= is appended automatically.
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
    // Local proxy: MP3 normally redirects directly; proxy settings or ?proxy=1
    // forward it through this Worker.
    const selfProxy = onceProxy || (proxyOn && !proxyTpl);
    if (ext === "mp3" && !selfProxy) return temporaryRedirect(url);
    const fwd = {};
    if (range) fwd.Range = range;
    let r = null;
    try {
      r = await fetchAudioSource(url, fwd);
    } catch { /* Clear and reacquire the direct URL before deciding that it failed. */ }
    // When a temporary OneDrive URL or edge node expires, clear the cache, ask
    // Graph for a new URL, and retry once quickly.
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
      // In default mode, finally fall back to Microsoft's direct URL so the user
      // network can try it. Explicit proxy mode retains the 502.
      if (!selfProxy && url) return temporaryRedirect(url);
      return c.json({ error: r ? `源站 ${r.status}` : "源站连接失败" }, 502);
    }
    return audioResponse(r, ext);
  }
  // Backends without direct URLs, such as WebDAV and local storage, must proxy bytes here.
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

// Shared audio response headers: correct MIME, inline disposition, and Range passthrough.
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

/* ---------- R2 image host: hits redirect to the CDN; misses fetch from OneDrive
   and synchronize lazily. cacheKey is a logical key such as art:<id>:<size>,
   srcPath is the OneDrive path, and dim is the thumbnail specification. Image
   bytes travel through the CDN, not Graph API or the Worker. ---------- */
async function ctxOf(c) {
  try { return c.executionCtx; } catch { return null; }
}

async function runBestEffortInBackground(c, task) {
  const safeTask = Promise.resolve(task).catch(() => null);
  const ctx = await ctxOf(c);
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(safeTask);
    return;
  }
  await safeTask;
}

const R2_IMAGE_EXT_BY_MIME = {
  "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "image/avif": "avif", "image/jpeg": "jpg",
};
const R2_IMAGE_EXTENSIONS = new Set(Object.values(R2_IMAGE_EXT_BY_MIME));
const coverImageVariant = (requestedSize) => {
  const width = requestedSize <= 160 ? 256 : requestedSize <= 480 ? 640 : null;
  return width
    ? { key: String(width), transform: {
      fit: "scale-down", width, height: width, format: "webp",
    } }
    : { key: "original", transform: null };
};
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
  // Explicitly cancel abandoned response bodies. Each Worker isolate has a
  // limited number of concurrent subrequest connections, and an unread body
  // retains one until garbage collection.
  if (!response?.ok) { await discardResponse(response); return null; }
  let bytes;
  try { bytes = await readResponseLimited(response, MAX_BUFFERED_IMAGE_BYTES); }
  catch { return null; }
  const contentType = imageMimeFromBytes(bytes);
  return contentType ? { bytes, contentType } : null;
}

async function readTransformedImageUrl(url, imageTransform) {
  try {
    const image = await validImageResponse(await fetchWithTimeout(url, {
      cf: { image: imageTransform },
    }));
    return image?.contentType === "image/webp"
      ? { ...image, transformed: true } : null;
  } catch {
    return null;
  }
}

async function readStoredImage(env, srcPath, dim, storageId,
  imageTransform = null) {
  // A OneDrive thumbnail URL may occasionally return a transient non-image
  // body with HTTP 200. Validate bytes, then fall back to the original direct
  // URL and finally the authenticated provider read instead of surfacing a
  // broken cover to the browser.
  const requests = [];
  if (dim) {
    try {
      const thumbnail = await storage.thumbnailUrl(env, srcPath, dim, storageId);
      if (thumbnail) requests.push({ url: thumbnail, init: undefined });
    } catch { /* continue to the original file */ }
  }
  try {
    const direct = await storage.downloadUrl(env, srcPath, storageId);
    if (direct) {
      // Resize the source bytes themselves so a provider thumbnail cache cannot
      // return an older crop after a cover is replaced at the same path.
      if (imageTransform) {
        const transformed = await readTransformedImageUrl(direct, imageTransform);
        if (transformed) return transformed;
      }
      if (!requests.some((request) => request.url === direct && !request.init)) {
        requests.push({ url: direct, init: undefined });
      }
    }
  } catch { /* continue to the authenticated provider read */ }
  for (const request of requests) {
    try {
      const image = await validImageResponse(
        await fetchWithTimeout(request.url, request.init));
      if (!image) continue;
      return image;
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
  storageId = null, allowPublicMirror = true, imageTransform = null,
  transformSourceKey = null) {
  const conf = await r2.r2Conf(c.env);
  // 1) Existing R2 mirror: redirect to the public CDN before checking the edge
  // cache, so stale cached 200-byte responses cannot block it.
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
  // 2) No mirror: check the edge cache, the only acceleration layer when R2 is disabled.
  const edge = globalThis.caches?.default;
  const allowEdgeCache = !!edge && !conf.ready && allowPublicMirror;
  const edgeKey = new Request(c.req.url);
  if (allowEdgeCache) {
    const hit = await edge.match(edgeKey);
    if (hit) return hit;
  }
  // 3) Read bytes from the owning storage. Use a direct thumbnail URL when
  // available; proxy the original for WebDAV and similar backends.
  let source = null;
  let hasTransformSourceMirror = false;
  if (conf.ready && imageTransform && transformSourceKey) {
    const sourceRow = await c.env.DB.prepare(
      "SELECT r2_key, created_at FROM r2_cache WHERE cache_key = ?")
      .bind(transformSourceKey).first();
    if (sourceRow) {
      hasTransformSourceMirror = true;
      source = await readTransformedImageUrl(
        r2.r2PublicUrl(conf, sourceRow.r2_key, sourceRow.created_at),
        imageTransform);
    }
  }
  source ||= await readStoredImage(
    c.env, srcPath, dim, storageId, imageTransform);
  if (!source) return null;
  const { bytes, contentType: ct } = source;
  // 4) Mirror to R2 lazily in the background without blocking the response.
  if (conf.ready && allowPublicMirror
      && (!imageTransform || source.transformed)) {
    // Return source bytes immediately. The next request will use the R2
    // redirect after this best-effort mirror finishes.
    await runBestEffortInBackground(
      c, mirrorImageBytes(c, conf, cacheKey, bytes, ct));
  } else if (conf.ready && allowPublicMirror && imageTransform
      && transformSourceKey && !hasTransformSourceMirror) {
    // Backends without public source URLs need one extra request: seed the
    // original R2 mirror now, then derive the compact variant from it later.
    await runBestEffortInBackground(
      c, mirrorImageBytes(c, conf, transformSourceKey, bytes, ct));
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
  // Populate the edge cache only when R2 is disabled. With R2 enabled, rely on
  // its CDN so stale bytes cannot block a redirect.
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

  // Small surfaces use bounded transforms of the stored source itself. This
  // preserves the exact user-approved crop while avoiding multi-megabyte image
  // decodes in dense album and track lists. Large detail views keep the source.
  const variant = coverImageVariant(size);
  const dim = null;
  const logicalKey = `art:${album.id}:${variant.key}`;
  // proxy=1 always returns origin bytes without redirecting to R2 or Graph. The
  // frontend uses this for canvas/cropping to avoid cross-origin Failed to fetch.
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
        if (variant.transform) {
          // This endpoint intentionally serves original bytes to canvas and
          // fallback consumers. Never record them under a resized cache key.
          await runBestEffortInBackground(c, c.env.DB.prepare(
            "DELETE FROM r2_cache WHERE cache_key = ?").bind(logicalKey).run());
        } else {
          await runBestEffortInBackground(
            c, mirrorImageBytes(c, conf, logicalKey, bytes, ct));
        }
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
    album.storage_id, !album.hidden, variant.transform,
    `art:${album.id}:original`);
  if (!res) return c.json({ error: "cover unavailable" }, 502);
  return res;
});

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
<rect width="400" height="400" fill="#1a1713"/>
<circle cx="200" cy="200" r="120" fill="none" stroke="#2e2a22" stroke-width="2"/>
<circle cx="200" cy="200" r="80" fill="none" stroke="#2e2a22" stroke-width="1.5"/>
<circle cx="200" cy="200" r="14" fill="#2e2a22"/></svg>`;

/* ---------- Album registration and editing, shared by companion sync and web upload ---------- */

app.post("/api/albums", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "无效的专辑 JSON" }, 400);
  }
  const folder = safePath(c.env, body.folder);
  if (!folder) return c.json({ error: "folder 必须在曲库根目录下" }, 400);
  const legacyArtist = body.artist === undefined
    ? "" : boundedText(body.artist, 500, { allowEmpty: false });
  const title = boundedText(body.title, 1000, { allowEmpty: false });
  const artistSortInput = body.artistSort === undefined
    ? "" : boundedText(body.artistSort, 500);
  const incomingArtists = albumArtistsInput(
    body.artists, legacyArtist, artistSortInput);
  if (legacyArtist === INVALID_INPUT || incomingArtists === INVALID_INPUT
      || title === INVALID_INPUT
      || !Array.isArray(body.tracks) || !body.tracks.length
      || body.tracks.length > 20_000) {
    return c.json({ error: "artists / title / tracks 必填且格式必须有效" }, 400);
  }
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
  if ([artistSortInput, year, rymRating, rymVotes, rymRank, rymUrl,
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
  const id = await sha16(folder);
  const now = Date.now();
  const [previousContributors, existingAlbum] = await Promise.all([
    contributorsForAlbum(c.env.DB, id),
    c.env.DB.prepare(`SELECT storage_id, genres, sec_genres, descriptors
      FROM albums WHERE id = ?`)
      .bind(id).first(),
  ]);
  // Existing curated metadata stays authoritative; companion metadata only
  // appends new values and never changes an established list placement.
  const currentPrimary = stringList(J(existingAlbum?.genres));
  const currentSecondary = stringList(J(existingAlbum?.sec_genres));
  const existingGenreKeys = new Set([
    ...currentPrimary, ...currentSecondary,
  ].map((value) => value.toLocaleLowerCase()));
  const genres = genreLists(
    [...currentPrimary,
      ...primaryGenres.filter((value) => !existingGenreKeys.has(
        value.toLocaleLowerCase()))],
    [...currentSecondary,
      ...secondaryGenres.filter((value) => !existingGenreKeys.has(
        value.toLocaleLowerCase()))],
  );
  const descriptorsToStore = mergeStringLists(
    J(existingAlbum?.descriptors), descriptors);
  // A legacy companion only knows the singular artist field. Once an album
  // has been explicitly edited to multiple credits, later rescans must not
  // collapse it back to one combined string.
  const existingArtists = body.artists === undefined
    ? await artistsForAlbum(c.env.DB, id) : [];
  let albumArtists = existingArtists.length > 1 ? existingArtists : incomingArtists;
  albumArtists = await canonicalizeArtistCredits(c.env.DB, albumArtists);
  albumArtists = await applyArtistSortOverrides(c.env.DB, albumArtists);
  const artist = artistCredit(albumArtists);
  const artistSort = explicitArtistSort(
    albumArtists[0]?.name, albumArtists[0]?.sort);
  // New albums use the current write target. Existing albums retain storage_id
  // because ON CONFLICT does not overwrite it.
  const wt = await writeTarget(c.env);
  if (!wt) return c.json({ error: "请先设置一个命名存储写入目标" }, 400);
  const storageId = existingAlbum?.storage_id || wt.id;
  const folderConflict = await c.env.DB.prepare(`
    SELECT id, folder FROM albums
    WHERE storage_id = ? AND id != ? AND folder = ? COLLATE NOCASE
    LIMIT 1`).bind(storageId, id, folder).first();
  if (folderConflict) {
    return c.json({
      error: "This storage folder is already registered with different letter casing",
      conflictAlbumId: folderConflict.id,
    }, 409);
  }
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
        JSON.stringify(descriptorsToStore), storageId, now, now);
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
    const pathKey = path.toLocaleLowerCase();
    if (seenTrackPaths.has(pathKey)) {
      return c.json({ error: `曲目路径重复: ${path}` }, 400);
    }
    seenTrackPaths.add(pathKey);
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
    const hasArtistOverride = Object.hasOwn(t, "artists");
    let trackArtists = hasArtistOverride ? trackArtistsInput(t.artists) : null;
    if ([track, discInput, duration, bitrate, size, titleInput, format, trackArtists]
      .includes(INVALID_INPUT)) {
      return c.json({ error: `曲目元数据格式无效: ${path}` }, 400);
    }
    if (trackArtists && sameArtistCredit(trackArtists, albumArtists)) trackArtists = [];
    const trackId = await sha16(path);
    if (seenTrackIds.has(trackId)) {
      return c.json({ error: `曲目 ID 冲突: ${path}` }, 409);
    }
    seenTrackIds.add(trackId);
    normalizedTracks.push({
      id: trackId, albumId: id, disc, track, title: trackTitle, duration,
      format, bitrate, size, path, artistMode: hasArtistOverride ? 1 : 0,
      artists: trackArtists,
    });
  }
  const explicitArtists = normalizedTracks.flatMap((track) => track.artists || []);
  const canonicalArtists = await canonicalizeArtistCredits(c.env.DB, explicitArtists);
  const resolvedArtists = await applyArtistSortOverrides(c.env.DB, canonicalArtists);
  const resolvedCredits = new Map(resolvedArtists.map((artist) =>
    [artistIdentityKey(artist.name), artist]));
  for (const track of normalizedTracks) {
    if (!track.artists) continue;
    track.artists = track.artists.map((artist) =>
      resolvedCredits.get(artistIdentityKey(artist.name)) || artist);
  }
  // A path or truncated-hash id collision with another album must fail before
  // staging. A concurrent collision is still caught by the final UNIQUE write.
  const paths = normalizedTracks.map((track) => track.path);
  for (let i = 0; i < paths.length; i += D1_BATCH_SIZE) {
    const chunk = paths.slice(i, i + D1_BATCH_SIZE);
    const marks = chunk.map(() => "?").join(",");
    const { results: conflicts } = await c.env.DB.prepare(`
      SELECT t.path, t.album_id FROM tracks t
      JOIN albums a ON a.id = t.album_id
      WHERE a.storage_id = ? AND t.path COLLATE NOCASE IN (${marks})`)
      .bind(storageId, ...chunk).all();
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
      || !seenTrackPaths.has(row.path.toLocaleLowerCase()));
    if (foreign) {
      return c.json({ error: `曲目 ID 已经被其他路径占用: ${foreign.path}` }, 409);
    }
  }

  const importId = crypto.randomUUID();
  const stageStatements = normalizedTracks.map((t) => c.env.DB.prepare(`
    INSERT INTO track_imports (import_id, id, album_id, disc, track, title,
      title_override, duration, format, bitrate, size, path, artist_mode, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(importId, t.id, t.albumId, t.disc, t.track, t.title, 0,
      t.duration, t.format, t.bitrate, t.size, t.path, t.artistMode, now));
  const creditStageStatements = normalizedTracks.flatMap((track) =>
    (track.artists || []).map((artist, position) => c.env.DB.prepare(`
      INSERT INTO track_artist_imports
        (import_id, track_id, artist, artist_sort, position)
      VALUES (?,?,?,?,?)`).bind(importId, track.id, artist.name,
        explicitArtistSort(artist.name, artist.sort), position)));
  try {
    await runD1Batches(c.env.DB, stageStatements);
    await runD1Batches(c.env.DB, creditStageStatements);
    // Old clients omit track artists. Preserve any manually curated override
    // for surviving track IDs instead of erasing it during a rescan.
    await c.env.DB.prepare(`INSERT OR IGNORE INTO track_artist_imports
      (import_id, track_id, artist, artist_sort, position)
      SELECT ?, ta.track_id, ta.artist, ta.artist_sort, ta.position
      FROM track_artists ta JOIN track_imports ti ON ti.id = ta.track_id
      WHERE ti.import_id = ? AND ti.artist_mode = 0`)
      .bind(importId, importId).run();
    // D1 batch is transactional. The live album is untouched until every
    // staged row exists, then metadata, favorites and tracks change together.
    await c.env.DB.batch([
      // A manually edited title is authoritative. Resolve it inside the same
      // transaction that replaces live rows so a concurrent edit cannot be lost.
      c.env.DB.prepare(`UPDATE track_imports SET
        title = (SELECT t.title FROM tracks t
          WHERE t.id = track_imports.id AND t.album_id = track_imports.album_id),
        title_override = 1
        WHERE import_id = ? AND EXISTS (
          SELECT 1 FROM tracks t
          WHERE t.id = track_imports.id
            AND t.album_id = track_imports.album_id
            AND (t.title_override = 1 OR
              (t.title_override IS NULL AND t.title != track_imports.title))
        )`).bind(importId),
      albumStmt,
      c.env.DB.prepare("DELETE FROM album_artists WHERE album_id = ?").bind(id),
      ...ensureArtistRows(c.env.DB, albumArtists),
      ...artistRowsForAlbum(c.env.DB, id, albumArtists),
      c.env.DB.prepare(`DELETE FROM favorites
        WHERE kind = 'track' AND item_id IN (
          SELECT id FROM tracks WHERE album_id = ? AND id NOT IN (
            SELECT id FROM track_imports WHERE import_id = ?
          )
        )`).bind(id, importId),
      c.env.DB.prepare(`DELETE FROM track_artists WHERE track_id IN
        (SELECT id FROM tracks WHERE album_id = ?)`).bind(id),
      c.env.DB.prepare("DELETE FROM tracks WHERE album_id = ?").bind(id),
      c.env.DB.prepare(`INSERT INTO tracks
        (id, album_id, disc, track, title, title_override,
          duration, format, bitrate, size, path)
        SELECT id, album_id, disc, track, title, title_override,
          duration, format, bitrate, size, path
        FROM track_imports WHERE import_id = ?`).bind(importId),
      c.env.DB.prepare(`INSERT OR IGNORE INTO artists (name, avatar_path)
        SELECT DISTINCT artist, '' FROM track_artist_imports
        WHERE import_id = ?`).bind(importId),
      c.env.DB.prepare(`INSERT INTO track_artists
        (track_id, artist, artist_sort, position)
        SELECT track_id, artist, artist_sort, position
        FROM track_artist_imports WHERE import_id = ?`).bind(importId),
      removeInheritedTrackArtists(c.env.DB, id, albumArtists),
      c.env.DB.prepare("DELETE FROM track_artist_imports WHERE import_id = ?")
        .bind(importId),
      c.env.DB.prepare("DELETE FROM track_imports WHERE import_id = ?")
        .bind(importId),
    ]);
  } catch (error) {
    await Promise.all([
      c.env.DB.prepare("DELETE FROM track_imports WHERE import_id = ?")
        .bind(importId).run().catch(() => null),
      c.env.DB.prepare("DELETE FROM track_artist_imports WHERE import_id = ?")
        .bind(importId).run().catch(() => null),
    ]);
    throw error;
  }
  if (c.get("role") === "companion") {
    await setSetting(c.env, "companion_last_seen", String(Date.now()));
  }
  await cleanupOrphanArtists(c.env, previousContributors);
  return c.json({ ok: true, id });
});

app.patch("/api/album/:id", async (c) => {
  const id = c.req.param("id");
  const b = await requestObject(c);
  if (!b) return c.json({ error: "请求 JSON 无效" }, 400);
  const [current, currentArtists] = await Promise.all([
    c.env.DB.prepare(
      "SELECT artist, artist_sort, folder, genres, sec_genres FROM albums WHERE id = ?")
      .bind(id).first(),
    artistsForAlbum(c.env.DB, id),
  ]);
  if (!current) return c.json({ error: "not found" }, 404);
  const sets = [], vals = [];
  const put = (column, value) => { sets.push(`${column} = ?`); vals.push(value); };
  let nextArtists = null;
  if ("artists" in b) {
    nextArtists = albumArtistsInput(b.artists);
  } else if ("artist" in b) {
    const name = boundedText(b.artist, 500, { allowEmpty: false });
    const sort = "artistSort" in b ? boundedText(b.artistSort, 500) : "";
    nextArtists = (name === INVALID_INPUT || sort === INVALID_INPUT)
      ? INVALID_INPUT : albumArtistsInput(undefined, name, sort);
  } else if ("artistSort" in b) {
    const sort = boundedText(b.artistSort, 500);
    if (sort !== INVALID_INPUT) {
      const base = currentArtists.length ? currentArtists
        : [{ name: current.artist,
          sort: explicitArtistSort(current.artist, current.artist_sort) }];
      nextArtists = base.map((artist, index) => index === 0
        ? { ...artist, sort: explicitArtistSort(artist.name, sort) } : artist);
    } else {
      nextArtists = INVALID_INPUT;
    }
  }
  if (nextArtists === INVALID_INPUT) {
    return c.json({ error: "artists 格式无效、重复或过长" }, 400);
  }
  if (nextArtists) {
    nextArtists = await canonicalizeArtistCredits(c.env.DB, nextArtists);
    put("artist", artistCredit(nextArtists));
    put("artist_sort", explicitArtistSort(
      nextArtists[0].name, nextArtists[0].sort));
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
  // Primary and secondary genres are normalized before storage regardless of
  // whether RYM or Discogs writes first: deduplicate each list case-insensitively,
  // then prevent a genre from appearing in both, with primary taking precedence.
  // If this request changes only one side, use the stored value for the other so
  // cross-list deduplication remains complete.
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
  if (nextArtists) {
    statements.push(c.env.DB.prepare(
      "DELETE FROM album_artists WHERE album_id = ?").bind(id));
    statements.push(...ensureArtistRows(c.env.DB, nextArtists));
    statements.push(...artistRowsForAlbum(c.env.DB, id, nextArtists));
    statements.push(removeInheritedTrackArtists(c.env.DB, id, nextArtists));
  }
  if (statements.length) await c.env.DB.batch(statements);
  if (sets.length && "coverPath" in b) {
    await invalidateR2(c.env, `art:${id}:`); // Clear R2 mirrors after a cover change.
  }
  if (nextArtists) {
    const kept = new Set(nextArtists.map((artist) => artist.name));
    for (const removed of currentArtists.filter((artist) => !kept.has(artist.name))) {
      const left = await c.env.DB.prepare(
        "SELECT 1 FROM artist_album_links WHERE artist = ? LIMIT 1")
        .bind(removed.name).first();
      if (left) continue;
      await purgeArtistR2(c.env, removed.name, false);
      await c.env.DB.batch([
        c.env.DB.prepare("DELETE FROM artists WHERE name = ?").bind(removed.name),
        c.env.DB.prepare(
          "DELETE FROM notes WHERE kind IN ('artist','artistbio','artistsort') AND id = ?")
          .bind(removed.name),
      ]);
    }
  }
  return c.json({ ok: true });
});

app.delete("/api/album/:id", async (c) => {
  const id = c.req.param("id");
  const [album, relatedArtists] = await Promise.all([
    c.env.DB.prepare(
      "SELECT folder, storage_id, artist, artist_sort FROM albums WHERE id = ?")
      .bind(id).first(),
    contributorsForAlbum(c.env.DB, id),
  ]);
  if (!album) return c.json({ error: "not found" }, 404);
  const albumArtists = relatedArtists.length ? relatedArtists
    : [{ name: album.artist,
      sort: explicitArtistSort(album.artist, album.artist_sort) }];
  if (c.req.query("files") === "1") {
    const sharedFolder = await c.env.DB.prepare(`
      SELECT id FROM albums
      WHERE storage_id = ? AND id != ? AND folder = ? COLLATE NOCASE
      LIMIT 1`).bind(album.storage_id, id, album.folder).first();
    if (sharedFolder) {
      return c.json({
        error: "Storage folder is still referenced by another album",
        conflictAlbumId: sharedFolder.id,
      }, 409);
    }
  }
  // Deletion removes database references for old public CDN URLs. Before deleting
  // the directory, confirm registered R2 mirrors are also removed so deleted or
  // private media cannot remain accessible through a known URL.
  if (!(await purgeAlbumR2(c.env, id, true))) {
    return c.json({ error: "公开 R2 镜像删除失败，数据库未修改" }, 502);
  }
  for (const artist of albumArtists) {
    const remaining = await c.env.DB.prepare(`SELECT 1 FROM artist_album_links
      WHERE artist = ? AND album_id != ? LIMIT 1`).bind(artist.name, id).first();
    if (!remaining && !(await purgeArtistR2(c.env, artist.name, true))) {
      return c.json({ error: "艺人公开头像镜像删除失败，数据库未修改" }, 502);
    }
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
    c.env.DB.prepare(`DELETE FROM track_artists WHERE track_id IN
      (SELECT id FROM tracks WHERE album_id = ?)`).bind(id),
    c.env.DB.prepare("DELETE FROM tracks WHERE album_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM album_artists WHERE album_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM albums WHERE id = ?").bind(id),
  ]);
  // Any contributor that no longer owns an album becomes an orphan. Clear its
  // optional metadata only after the catalog deletion has committed.
  for (const artist of albumArtists) {
    const left = await c.env.DB.prepare(
      "SELECT 1 FROM artist_album_links WHERE artist = ? LIMIT 1")
      .bind(artist.name).first();
    if (left) continue;
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM artists WHERE name = ?").bind(artist.name),
      c.env.DB.prepare(
        "DELETE FROM notes WHERE kind IN ('artist','artistbio','artistsort') AND id = ?")
        .bind(artist.name),
    ]);
  }
  return c.json({ ok: true, filesDeleted });
});

// Hide or restore an album. Library lists omit it by default; admins may includeHidden.
app.post("/api/album/:id/hide", async (c) => {
  const id = c.req.param("id");
  const body = await requestObject(c);
  const hidden = body?.hidden;
  if (![true, false, 1, 0, "1", "0"].includes(hidden)) {
    return c.json({ error: "hidden 参数无效" }, 400);
  }
  const on = hidden === true || hidden === 1 || hidden === "1";
  const [album, relatedArtists] = await Promise.all([
    c.env.DB.prepare(
      "SELECT hidden, artist, artist_sort FROM albums WHERE id = ?").bind(id).first(),
    contributorsForAlbum(c.env.DB, id),
  ]);
  if (!album) return c.json({ error: "not found" }, 404);
  if (on) {
    const purged = await purgeAlbumR2(c.env, id, true);
    if (!purged) {
      return c.json({
        error: "隐藏前无法删除公开 R2 镜像；请检查 R2 凭据后重试",
      }, 502);
    }
    const albumArtists = relatedArtists.length ? relatedArtists
      : [{ name: album.artist,
        sort: explicitArtistSort(album.artist, album.artist_sort) }];
    for (const artist of albumArtists) {
      const anotherVisible = await c.env.DB.prepare(`
        SELECT 1 FROM artist_album_links aa JOIN albums a ON a.id = aa.album_id
        WHERE aa.artist = ? AND a.id != ?
        AND COALESCE(a.hidden,0)=0 LIMIT 1`).bind(artist.name, id).first();
      if (!anotherVisible && !(await purgeArtistR2(c.env, artist.name, true))) {
        return c.json({
          error: "隐藏前无法删除公开艺人头像镜像；请检查 R2 凭据后重试",
        }, 502);
      }
    }
  }
  await c.env.DB.prepare(
    "UPDATE albums SET hidden = ?, updated_at = ? WHERE id = ?")
    .bind(on ? 1 : 0, Date.now(), id).run();
  return c.json({ ok: true, hidden: on });
});

/* ---------- Album booklet and photo images, uploaded by admins; the frontend
   hides the entry point when none exist ---------- */

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

// Manual gallery reorder: the frontend sends the album's complete ordered imgId
// list, which becomes sort 0 through n-1.
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
  if (c.req.query("file") === "1") {
    const sharedFile = await c.env.DB.prepare(`
      SELECT i.id FROM album_images i JOIN albums a ON a.id = i.album_id
      WHERE a.storage_id = ? AND i.id != ? AND i.path = ? COLLATE NOCASE
      LIMIT 1`).bind(row.storage_id, imgId, row.path).first();
    if (sharedFile) {
      return c.json({ error: "Storage file is still referenced by another image" }, 409);
    }
  }
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
  if (!size) {  // Original image: redirect when possible; proxy backends without direct URLs.
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

/* ---------- Album-track management for admins: add, delete, rename, and reorder ---------- */

app.post("/api/album/:id/tracks", async (c) => {
  const id = c.req.param("id");
  const [album, albumCredits] = await Promise.all([
    c.env.DB.prepare(
      "SELECT folder, artist, artist_sort, storage_id FROM albums WHERE id = ?")
      .bind(id).first(),
    artistsForAlbum(c.env.DB, id),
  ]);
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
  const [priorTrack, previousCredits] = await Promise.all([
    c.env.DB.prepare(
      "SELECT album_id FROM tracks WHERE id = ?").bind(tid).first(),
    "artists" in b ? artistsForTrack(c.env.DB, tid) : [],
  ]);
  if (priorTrack && priorTrack.album_id !== id) {
    return c.json({ error: "该曲目路径已经登记在其他专辑" }, 409);
  }
  const pathConflict = await c.env.DB.prepare(`
    SELECT t.id FROM tracks t JOIN albums a ON a.id = t.album_id
    WHERE a.storage_id = ? AND t.id != ? AND t.path = ? COLLATE NOCASE
    LIMIT 1`).bind(album.storage_id, tid, p).first();
  if (pathConflict) {
    return c.json({
      error: "This storage file is already registered with different letter casing",
    }, 409);
  }
  const discInput = finiteInput(b.disc, { integer: true, min: 1 });
  const track = finiteInput(b.track, { integer: true, min: 1 });
  const duration = finiteInput(b.duration, { min: 0 });
  const bitrate = finiteInput(b.bitrate, { min: 0 });
  const size = finiteInput(b.size, { integer: true, min: 0,
    max: Number.MAX_SAFE_INTEGER });
  const titleInput = boundedText(b.title, 1000);
  const format = boundedText(b.format, 64);
  let trackCredits = "artists" in b ? trackArtistsInput(b.artists) : null;
  if ([discInput, track, duration, bitrate, size, titleInput, format, trackCredits]
    .includes(INVALID_INPUT)) {
    return c.json({ error: "曲目元数据格式无效" }, 400);
  }
  if (trackCredits) {
    trackCredits = await canonicalizeArtistCredits(c.env.DB, trackCredits);
    trackCredits = await applyArtistSortOverrides(c.env.DB, trackCredits);
    const inherited = albumCredits.length ? albumCredits
      : [{ name: album.artist,
        sort: explicitArtistSort(album.artist, album.artist_sort) }];
    if (sameArtistCredit(trackCredits, inherited)) trackCredits = [];
  }
  const disc = discInput ?? 1;
  const statements = [c.env.DB.prepare(`
    INSERT INTO tracks (id, album_id, disc, track, title, duration,
      format, bitrate, size, path)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET album_id=excluded.album_id,
      disc=excluded.disc, track=excluded.track,
      title=CASE WHEN tracks.title_override = 1 OR
                      (tracks.title_override IS NULL
                       AND tracks.title != excluded.title)
                 THEN tracks.title ELSE excluded.title END,
      title_override=CASE WHEN tracks.title_override IS NULL
        THEN CASE WHEN tracks.title != excluded.title THEN 1 ELSE 0 END
        ELSE tracks.title_override END,
      duration=excluded.duration, format=excluded.format,
      bitrate=excluded.bitrate, size=excluded.size`)
    .bind(tid, id, disc, track, titleInput || p.split("/").pop(), duration,
      format, bitrate, size, p)];
  if (trackCredits) {
    statements.push(c.env.DB.prepare(
      "DELETE FROM track_artists WHERE track_id = ?").bind(tid));
    statements.push(...ensureArtistRows(c.env.DB, trackCredits));
    statements.push(...artistRowsForTrack(c.env.DB, tid, trackCredits));
  }
  statements.push(c.env.DB.prepare(
    "UPDATE albums SET updated_at = ? WHERE id = ?").bind(Date.now(), id));
  await c.env.DB.batch(statements);
  if ("artists" in b) await cleanupOrphanArtists(c.env, previousCredits);
  return c.json({ ok: true, id: tid });
});

app.patch("/api/album/:id/tracks/:tid", async (c) => {
  const b = await requestObject(c);
  if (!b) return c.json({ error: "请求 JSON 无效" }, 400);
  if (!("title" in b) && !("artists" in b)) {
    return c.json({ error: "没有可更新字段" }, 400);
  }
  const albumId = c.req.param("id");
  const trackId = c.req.param("tid");
  const [album, inheritedCredits, exists, previousCredits] = await Promise.all([
    c.env.DB.prepare("SELECT artist, artist_sort FROM albums WHERE id = ?")
      .bind(albumId).first(),
    artistsForAlbum(c.env.DB, albumId),
    c.env.DB.prepare("SELECT 1 FROM tracks WHERE id = ? AND album_id = ?")
      .bind(trackId, albumId).first(),
    "artists" in b ? artistsForTrack(c.env.DB, trackId) : [],
  ]);
  if (!exists || !album) return c.json({ error: "not found" }, 404);
  const statements = [];
  if ("title" in b) {
    const title = boundedText(b.title, 1000, { allowEmpty: false });
    if (title === INVALID_INPUT) return c.json({ error: "title 格式无效" }, 400);
    statements.push(c.env.DB.prepare(
      `UPDATE tracks SET title = ?, title_override = 1
       WHERE id = ? AND album_id = ?`)
      .bind(title, trackId, albumId));
  }
  let nextCredits = null;
  if ("artists" in b) {
    nextCredits = trackArtistsInput(b.artists);
    if (nextCredits === INVALID_INPUT) {
      return c.json({ error: "artists 格式无效、重复或过长" }, 400);
    }
    nextCredits = await canonicalizeArtistCredits(c.env.DB, nextCredits);
    nextCredits = await applyArtistSortOverrides(c.env.DB, nextCredits);
    const inherited = inheritedCredits.length ? inheritedCredits
      : [{ name: album.artist,
        sort: explicitArtistSort(album.artist, album.artist_sort) }];
    if (sameArtistCredit(nextCredits, inherited)) nextCredits = [];
    statements.push(c.env.DB.prepare(
      "DELETE FROM track_artists WHERE track_id = ?").bind(trackId));
    statements.push(...ensureArtistRows(c.env.DB, nextCredits));
    statements.push(...artistRowsForTrack(c.env.DB, trackId, nextCredits));
  }
  statements.push(c.env.DB.prepare(
    "UPDATE albums SET updated_at = ? WHERE id = ?").bind(Date.now(), albumId));
  await c.env.DB.batch(statements);
  if ("artists" in b) await cleanupOrphanArtists(c.env, previousCredits);
  return c.json({ ok: true });
});

app.delete("/api/album/:id/tracks/:tid", async (c) => {
  const tid = c.req.param("tid");
  const [row, previousCredits] = await Promise.all([
    c.env.DB.prepare(
      "SELECT t.path, a.storage_id FROM tracks t " +
      "JOIN albums a ON a.id = t.album_id WHERE t.id = ? AND t.album_id = ?")
      .bind(tid, c.req.param("id")).first(),
    artistsForTrack(c.env.DB, tid),
  ]);
  if (!row) return c.json({ error: "not found" }, 404);
  let fileDeleted = false;
  if (c.req.query("file") === "1") {
    const sharedFile = await c.env.DB.prepare(`
      SELECT t.id FROM tracks t JOIN albums a ON a.id = t.album_id
      WHERE a.storage_id = ? AND t.id != ? AND t.path = ? COLLATE NOCASE
      LIMIT 1`).bind(row.storage_id, tid, row.path).first();
    if (sharedFile) {
      return c.json({ error: "Storage file is still referenced by another track" }, 409);
    }
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
    c.env.DB.prepare("DELETE FROM track_artists WHERE track_id = ?").bind(tid),
    c.env.DB.prepare("DELETE FROM tracks WHERE id = ?").bind(tid),
    c.env.DB.prepare("UPDATE albums SET updated_at = ? WHERE id = ?")
      .bind(Date.now(), c.req.param("id")),
  ]);
  await cleanupOrphanArtists(c.env, previousCredits);
  return c.json({ ok: true, fileDeleted });
});

// Reorder tracks within their existing discs. Each disc receives an independent
// 1-through-n sequence, and disc assignments are never changed by this endpoint.
app.put("/api/album/:id/tracks/order", async (c) => {
  const id = c.req.param("id");
  const b = await requestObject(c);
  const ids = b?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.some((tid) =>
    typeof tid !== "string" || tid.length > 128)) {
    return c.json({ error: "ids 必填" }, 400);
  }
  const { results } = await c.env.DB.prepare(
    "SELECT id, disc FROM tracks WHERE album_id = ?").bind(id).all();
  const existing = new Set(results.map((r) => r.id));
  if (ids.length !== existing.size || new Set(ids).size !== ids.length
      || ids.some((x) => !existing.has(x))) {
    return c.json({ error: "ids 与专辑曲目不一致（先刷新页面）" }, 400);
  }
  const discs = new Map(results.map((row) => [row.id, row.disc]));
  const nextPosition = new Map();
  const ordered = JSON.stringify(ids.map((trackId) => {
    const disc = discs.get(trackId);
    const track = (nextPosition.get(disc) || 0) + 1;
    nextPosition.set(disc, track);
    return { id: trackId, track };
  }));
  await c.env.DB.batch([
    c.env.DB.prepare(`WITH ordered(id, track) AS (
      SELECT CAST(json_extract(value, '$.id') AS TEXT),
        CAST(json_extract(value, '$.track') AS INTEGER)
      FROM json_each(?)
    )
    UPDATE tracks SET
      track = (SELECT track FROM ordered WHERE ordered.id = tracks.id)
    WHERE album_id = ? AND id IN (SELECT id FROM ordered)`)
      .bind(ordered, id),
    c.env.DB.prepare("UPDATE albums SET updated_at = ? WHERE id = ?")
      .bind(Date.now(), id),
  ]);
  return c.json({ ok: true });
});

/* ---------- RYM import: the browser parses HTML before submission ---------- */

app.post("/api/album/:id/rym", async (c) => {
  const b = await requestObject(c);
  if (!b) return c.json({ error: "请求 JSON 无效" }, 400);
  const album = await c.env.DB.prepare(`
    SELECT genres, sec_genres, descriptors FROM albums WHERE id = ?`)
    .bind(c.req.param("id")).first();
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
  // Ratings are refreshed by re-importing a newer RYM page, but the stored
  // taxonomy usually mixes RYM, Discogs, and manual edits by then. Merge like
  // the Discogs importer instead of replacing: existing placement wins (a tag
  // curated as secondary is not re-added as primary), only new values append,
  // so repeating an import never changes the curated lists.
  const lower = (value) => String(value).toLocaleLowerCase();
  const currentPrimary = stringList(J(album.genres));
  const currentSecondary = stringList(J(album.sec_genres));
  const currentDescriptors = stringList(J(album.descriptors));
  const taken = new Set([...currentPrimary, ...currentSecondary].map(lower));
  const genres = genreLists(
    [...currentPrimary, ...primary.filter((g) => !taken.has(lower(g)))],
    [...currentSecondary, ...secondary.filter((g) => !taken.has(lower(g)))]);
  const seenDescriptors = new Set(currentDescriptors.map(lower));
  const mergedDescriptors = [...currentDescriptors,
    ...descriptors.filter((d) => !seenDescriptors.has(lower(d)))];
  await c.env.DB.prepare(`
    UPDATE albums SET rym_rating=?, rym_votes=?, rym_rank=?, rym_url=?,
      genres=?, sec_genres=?, descriptors=?, updated_at=? WHERE id=?`)
    .bind(rating, votes, rank, rymUrl,
      JSON.stringify(genres.primary), JSON.stringify(genres.secondary),
      JSON.stringify(mergedDescriptors),
      Date.now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

/* ---------- Uploads: browser-to-OneDrive direct transfer; WebDAV targets use a
   Worker proxy endpoint ---------- */

// Current write target: every new upload must land on a named storage backend.
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
    // WebDAV and local storage have no browser direct-upload session; stream the
    // PUT through the Worker.
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

async function uploadedFileSize(env, path, storageId, expectedSize = null) {
  const delays = [0, 150, 350, 700];
  let size = null;
  let lastError = null;
  let readSucceeded = false;
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      size = await storage.fileSize(env, path, storageId);
      readSucceeded = true;
    } catch (error) {
      lastError = error;
      continue;
    }
    if (size !== null && (expectedSize === null || size === expectedSize)) {
      return size;
    }
  }
  if (!readSucceeded && lastError) throw lastError;
  return size;
}

async function verifyUploadedFile(env, path, storageId, expectedSize) {
  const actualSize = await uploadedFileSize(
    env, path, storageId, expectedSize);
  return {
    ok: actualSize === expectedSize,
    actualSize,
    expectedSize,
  };
}

app.post("/api/upload/verify", async (c) => {
  const b = await requestObject(c);
  const path = safePath(c.env, b?.path);
  const storageId = boundedText(b?.storageId, 200, { allowEmpty: false });
  const expectedSize = finiteInput(b?.size, {
    integer: true, min: 1, max: Number.MAX_SAFE_INTEGER,
  });
  if (!path || storageId === INVALID_INPUT || expectedSize === INVALID_INPUT
      || expectedSize === null) {
    return c.json({ error: "上传校验参数无效" }, 400);
  }
  const target = await uploadTargetForPath(c.env, path);
  if (!target || target.id !== storageId) {
    return c.json({ error: "上传目标已变化，请重新开始上传" }, 409);
  }
  try {
    const result = await verifyUploadedFile(
      c.env, path, storageId, expectedSize);
    if (!result.ok) {
      return c.json({
        error: result.actualSize === null
          ? "上传后的文件不存在"
          : "上传后的文件大小不完整，请重试",
        ...result,
      }, 409);
    }
    return c.json(result);
  } catch (error) {
    console.error("upload verification failed", error);
    return c.json({
      error: `无法校验上传文件：${String(error?.message || error)}`,
    }, 502);
  }
});

// Streaming upload for proxied storage: browser -> Worker -> WebDAV/local.
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
  const expectedSize = finiteInput(c.req.query("size"), {
    integer: true, min: 1, max: Number.MAX_SAFE_INTEGER,
  });
  if (expectedSize === INVALID_INPUT || expectedSize === null) {
    return c.json({ error: "缺少有效的上传文件大小" }, 400);
  }
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "上传内容为空" }, 400);
  try {
    const ok = await storage.putFile(c.env, path, body,
      c.req.header("Content-Type"), wt.id);
    if (!ok) return c.json({ error: "上传失败" }, 502);
    const verified = await verifyUploadedFile(
      c.env, path, wt.id, expectedSize);
    if (!verified.ok) {
      return c.json({
        error: verified.actualSize === null
          ? "上传后的文件不存在"
          : "上传后的文件大小不完整，请重试",
        ...verified,
      }, 409);
    }
    return c.json(verified);
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

    // Prefer R2: mirror immediately after a successful upload when a custom
    // avatar key exists. Paths containing avatar- and cover files are prewarmed too.
    const conf = await r2.r2Conf(c.env);
    if (conf.ready) {
      const isAvatar = /\/avatar-[^/]+\.(jpe?g|png|webp)$/i.test(path)
        || /\/artist\.(jpe?g|png|webp)$/i.test(path);
      if (isAvatar) {
        const cacheKey = `artist:${await sha16(path)}:480`;
        await invalidateR2(c.env, `artist:${await sha16(path)}:`);
        // Mirror in the background; failure does not invalidate the upload.
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

/* ---------- Cloud scan: folders placed directly in OneDrive can enter the library ---------- */

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
  // Preserve registered track information such as title, duration, bitrate, and
  // sequence. Graph audio metadata is often incomplete, especially for FLAC, so
  // rescanning must not overwrite these valuable values.
  const albumId = await sha16(f);
  const { results: prevRows } = await c.env.DB.prepare(
    "SELECT * FROM tracks WHERE album_id = ?").bind(albumId).all();
  const prev = new Map(prevRows.map((t) => [t.path, t]));
  // Filename fallback follows the same rule as browser tags.js:
  // "01. Track title" -> track=1, title="Track title".
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

/* ---------- Admin ---------- */

app.get("/api/admin/overview", async (c) => {
  const [a, t, posts, s] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM albums").first(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n, SUM(size) AS bytes FROM tracks").first(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM source_posts WHERE status = 'new'").first(),
    getSettingsMap(c.env,
      ["companion_last_seen", "source_last_scan", "source_last_error"]),
  ]);
  return c.json({
    albums: a.n, tracks: t.n, bytes: t.bytes || 0,
    newPosts: posts.n,
    companionLastSeen: Number(s.companion_last_seen) || null,
    sourceLastScan: Number(s.source_last_scan) || null,
    sourceLastError: s.source_last_error || "",
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
  // Commit the password and session epoch together. If a separate second write
  // failed, the endpoint would report an error even though the new password was
  // active and old cookies still worked.
  await c.env.DB.batch([
    settingStatement(c.env, `${target}_pass_hash`, hash),
    bumpSessionEpochStatement(c.env),
  ]);
  return c.json({ ok: true });
});

app.get("/api/admin/settings", async (c) => {
  const s = await getSettingsMap(c.env, [
    "discogs_token", "source_url", "archive_passwords", "guest_open",
    "module_source", "stream_proxy", "stream_proxy_url",
  ]);
  const tok = s.discogs_token || "";
  return c.json({
    sourceUrl: s.source_url || "",
    archivePasswords: settingStringList(s.archive_passwords || "[]"),
    // Return only a masked token (bullets plus the final four characters); blank means unset.
    discogsToken: tok ? `••••${tok.slice(-4)}` : "",
    guestOpen: s.guest_open === "1",
    // Optional modules default off because they support specialized personal
    // workflows that most users do not need.
    moduleSource: s.module_source === "1",
    // Audio proxy: force every directly addressable track through the Worker,
    // useful when OneDrive is slow from mainland China.
    streamProxy: s.stream_proxy === "1",
    // Custom proxy address: blank uses this site's /api/stream; another Worker is
    // also accepted. Supports a {url} placeholder, for example
    // https://my-proxy.example.com/?u={url}.
    streamProxyUrl: s.stream_proxy_url || "",
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
  // Update nonempty fields only. A blank form value preserves the current one,
  // matching storage-credential behavior.
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

// Source-module gate: when disabled, scan endpoints return 404 and scheduled jobs skip it.
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

/* ---------- Admin: storage credentials, updated online after expiry or account
   changes without redeployment ---------- */

const mask = (v) => (v ? `••••${String(v).slice(-4)}` : "");

/* ---------- R2 image-host credentials, editable in Admin rather than hardcoded ---------- */

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
    mirrored: cached?.n || 0,   // Number of mirrored image variants
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
  // Skip masked values containing bullets to preserve them; write plaintext only.
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
  // Fetch only this batch on each step instead of rebuilding the complete task
  // list on every poll, which previously cost O(total^2 / limit) row reads.
  const [{ n: nAlbums = 0 } = {}, { n: nArtists = 0 } = {}] = await Promise.all([
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM albums WHERE COALESCE(hidden,0)=1").first(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM artists ar WHERE NOT EXISTS (
      SELECT 1 FROM artist_album_links aa JOIN albums a ON a.id = aa.album_id
      WHERE aa.artist = ar.name
      AND COALESCE(a.hidden,0)=0)`).first(),
  ]);
  const total = nAlbums + nArtists;
  const tasks = [];
  if (offset < nAlbums && tasks.length < limit) {
    const { results } = await c.env.DB.prepare(
      "SELECT id, artist, title FROM albums WHERE COALESCE(hidden,0)=1 " +
      "ORDER BY created_at, id LIMIT ? OFFSET ?")
      .bind(Math.min(limit, nAlbums - offset), offset).all();
    tasks.push(...results.map((album) => ({ kind: "album", ...album })));
  }
  if (tasks.length < limit && offset + tasks.length >= nAlbums) {
    const { results } = await c.env.DB.prepare(`
      SELECT ar.name FROM artists ar WHERE NOT EXISTS (
        SELECT 1 FROM artist_album_links aa JOIN albums a ON a.id = aa.album_id
        WHERE aa.artist = ar.name
        AND COALESCE(a.hidden,0)=0
      ) ORDER BY ar.name COLLATE NOCASE LIMIT ? OFFSET ?`)
      .bind(limit - tasks.length, Math.max(0, offset - nAlbums)).all();
    tasks.push(...results.map((artist) => ({ kind: "artist", artist: artist.name })));
  }
  let processed = offset;
  for (const task of tasks) {
    const ok = task.kind === "album"
      ? await purgeAlbumR2(c.env, task.id, true)
      : await purgeArtistR2(c.env, task.artist, true);
    if (!ok) {
      return c.json({
        error: "无法删除隐藏内容的公开 R2 镜像；请检查 R2 凭据",
        task, processed, total, finished: false,
      }, 502);
    }
    processed += 1;
  }
  return c.json({
    ok: true, processed, total,
    finished: processed >= total,
  });
});

// Mirror one image to R2, skipping existing objects. storageId may be empty for
// the default backend. Return 'done', 'skip', or 'fail'.
async function mirrorImageToR2(env, conf, cacheKey, srcPath, dim,
  storageId = null, imageTransform = null, transformSourceKey = null) {
  if (typeof cacheKey !== "string" || !cacheKey
      || typeof srcPath !== "string" || !srcPath) return "fail";
  const exists = await env.DB.prepare(
    "SELECT 1 FROM r2_cache WHERE cache_key = ?").bind(cacheKey).first();
  if (exists) return "skip"; // Already in R2; do not upload again.
  if (await claimExistingR2Image(env, conf, cacheKey, srcPath)) return "skip";
  let source = null;
  if (imageTransform && transformSourceKey) {
    const sourceRow = await env.DB.prepare(
      "SELECT r2_key, created_at FROM r2_cache WHERE cache_key = ?")
      .bind(transformSourceKey).first();
    if (sourceRow) {
      source = await readTransformedImageUrl(
        r2.r2PublicUrl(conf, sourceRow.r2_key, sourceRow.created_at),
        imageTransform);
    }
  }
  source ||= await readStoredImage(
    env, srcPath, dim, storageId, imageTransform);
  if (!source) return "fail";
  if (imageTransform && !source.transformed) return "fail";
  const { bytes, contentType: ct } = source;
  const r2key = r2ImageObjectKey(cacheKey, ct);
  if (!(await r2.r2Put(conf, r2key, bytes, ct))) return "fail";
  await recordR2Mirror(env, cacheKey, r2key);
  return "done";
}

// Prewarm all images into R2 in batches: original and 256/640 album covers, gallery
// images at 480/1000, and artist avatars at 480. Skip existing objects and return
// progress for frontend polling.
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

  // Read only this batch of source rows per step. The old implementation rebuilt
  // the entire task array on every poll, costing O(total^2 / limit) row reads.
  // One database row is one task: a cover row is one task, a gallery row is one
  // task containing both 480 and 1000 mirrors, and an avatar row is one task.
  // offset, processed, and total are all measured in rows.
  const [{ n: nAlbums = 0 } = {}, { n: nImages = 0 } = {},
    { n: nAvatars = 0 } = {}] = await Promise.all([
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM albums WHERE COALESCE(hidden,0)=0").first(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM album_images i
      JOIN albums a ON a.id = i.album_id
      WHERE COALESCE(a.hidden,0)=0`).first(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM artists ar
      WHERE ar.avatar_path != '' AND EXISTS (
        SELECT 1 FROM artist_album_links aa JOIN albums a ON a.id = aa.album_id
        WHERE aa.artist = ar.name
        AND COALESCE(a.hidden,0)=0)`).first(),
  ]);
  const total = nAlbums + nImages + nAvatars;
  const tasks = [];
  if (offset < nAlbums && tasks.length < limit) {
    const { results } = await c.env.DB.prepare(
      `SELECT id, folder, cover_path, storage_id FROM albums
       WHERE COALESCE(hidden,0)=0 ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .bind(Math.min(limit, nAlbums - offset), offset).all();
    for (const album of results) {
      tasks.push({ kind: "cover", album, requestSizes: ["original", 120, 400],
        sid: album.storage_id || null });
    }
  }
  if (tasks.length < limit && offset + tasks.length >= nAlbums
      && offset + tasks.length < nAlbums + nImages) {
    const { results } = await c.env.DB.prepare(`
      SELECT i.id, i.path, a.storage_id FROM album_images i
      JOIN albums a ON a.id = i.album_id
      WHERE COALESCE(a.hidden,0)=0 ORDER BY i.created_at, i.id
      LIMIT ? OFFSET ?`)
      .bind(limit - tasks.length,
        Math.max(0, offset + tasks.length - nAlbums)).all();
    for (const im of results) {
      tasks.push({ kind: "image", id: im.id, path: im.path,
        sid: im.storage_id || null });
    }
  }
  if (tasks.length < limit && offset + tasks.length >= nAlbums + nImages) {
    // Avatars have an explicit storage binding; for artists spanning multiple
    // backends, it can no longer be inferred from an arbitrary album.
    const { results } = await c.env.DB.prepare(`
      SELECT ar.avatar_path, ar.storage_id FROM artists ar
      WHERE ar.avatar_path != '' AND EXISTS (
        SELECT 1 FROM artist_album_links aa JOIN albums a ON a.id = aa.album_id
        WHERE aa.artist = ar.name
        AND COALESCE(a.hidden,0)=0
      ) ORDER BY ar.name COLLATE NOCASE LIMIT ? OFFSET ?`)
      .bind(limit - tasks.length,
        Math.max(0, offset + tasks.length - nAlbums - nImages)).all();
    for (const a of results) {
      tasks.push({ kind: "avatar", path: a.avatar_path, key: null,
        dim: "c480x480", sid: a.storage_id || null });
    }
  }

  let done = 0, skipped = 0, failed = 0;
  const mirror = async (...args) => {
    try {
      return await mirrorImageToR2(...args);
    } catch {
      return "fail";
    }
  };
  for (const t of tasks) {
    if (t.kind === "cover") {
      let cover;
      try { cover = await resolveCover(c.env, t.album); } catch { cover = null; }
      if (!cover) { skipped++; continue; }
      const sizeResults = [];
      const sourceKey = `art:${t.album.id}:original`;
      for (const requestedSize of t.requestSizes) {
        const variant = requestedSize === "original"
          ? { key: "original", transform: null }
          : coverImageVariant(requestedSize);
        sizeResults.push(await mirror(
          c.env, conf, `art:${t.album.id}:${variant.key}`, cover, null, t.sid,
          variant.transform, sourceKey));
      }
      if (sizeResults.includes("fail")) failed++;
      else if (sizeResults.includes("done")) done++;
      else skipped++;
    } else if (t.kind === "image") {
      // Count each row once so done/skipped/failed and row-based total share the
      // same unit; the completion toast cannot exceed the progress-bar total.
      const sizeResults = [];
      for (const [size, dim] of [[480, "c480x480"], [1000, "c1000x1000"]]) {
        sizeResults.push(
          await mirror(c.env, conf, `img:${t.id}:${size}`, t.path, dim, t.sid));
      }
      if (sizeResults.includes("fail")) failed++;
      else if (sizeResults.includes("done")) done++;
      else skipped++;
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
  const next = offset + tasks.length;
  return c.json({ total, processed: next, done, skipped, failed, finished: next >= total });
});

/* ---------- Multiple storage backends: OneDrive account pools, WebDAV, and migration ---------- */

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
  // Register in non-write mode first, then use the shared selection logic to
  // guarantee one write target. Concurrent creation of the first storage cannot
  // leave two rows with is_write=1.
  await c.env.DB.prepare(
    "INSERT INTO storages (id, name, kind, config, is_write, created_at) " +
    "VALUES (?,?,?,?,?,?)")
    .bind(id, name, b.kind, encodedConfig, 0, Date.now()).run();
  const writeId = await ensureSingleWriteTarget(c.env);
  storage.clearStorageCache();
  return c.json({ ok: true, id, isWrite: writeId === id });
});

// Select the named storage that receives new uploads. Register this before
// PUT /storages/:sid or "write-target" is consumed as :sid.
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
    // Skip masked values containing bullets and preserve the original; overwrite
    // only with plaintext.
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

// Test connectivity by ID for saved backends, or directly with kind+config for unsaved ones.
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

/* One migration step moves fileIndex from one album and returns finished:true
   when complete. Source files remain as a cold backup. Returns
   {ok,error?,finished,total,fileIndex,file,bytes}. */
const MIGRATION_CHUNK = 10 * 1024 * 1024; // Accepted by Graph and Google; also a multiple of 320KiB
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
  const sourceId = album.storage_id || null;
  const albumParent = album.folder.split("/").slice(0, -1).join("/");
  const { results: relatedAvatars } = await env.DB.prepare(`
    SELECT DISTINCT ar.name, ar.avatar_path, ar.storage_id
    FROM artist_album_links aa JOIN artists ar ON ar.name = aa.artist
    WHERE aa.album_id = ? AND ar.avatar_path != ''`).bind(albumId).all();
  // Only move an avatar physically owned by this album's parent directory.
  // A collaboration may reference artists whose shared avatar lives beside a
  // different album; migrating this album must not move that unrelated file.
  const avatars = relatedAvatars.filter((avatar) =>
    (avatar.storage_id || null) === sourceId && albumParent
    && avatar.avatar_path.startsWith(`${albumParent}/`));
  const avatarPaths = new Set(avatars.map((avatar) => avatar.avatar_path));
  const manifestKey = `mig:${albumId}:${sourceId || "none"}:${targetId}`;
  let files = await env.KV.get(manifestKey, "json").catch(() => null);
  if (Array.isArray(files) && !files.every((file) => {
    if (!plainObject(file) || typeof file.path !== "string") return false;
    const path = safePath(env, file.path);
    const inScope = path === file.path &&
      (path.startsWith(album.folder + "/") || avatarPaths.has(path));
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
      ...avatars.map((avatar) => ({ path: avatar.avatar_path, size: null })),
      ...discovered,
    ].filter(Boolean);
    const byPath = new Map();
    for (const candidate of candidates) {
      const candidatePath = safePath(env, candidate.path);
      if (!candidatePath || (!avatarPaths.has(candidatePath)
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
    // storageId appears in /api/library, so update updated_at at the same time.
    // Otherwise the catalog ETag remains unchanged and a browser 304 keeps
    // serving the pre-migration storageId.
    const updates = [env.DB.prepare(
      "UPDATE albums SET storage_id = ?, updated_at = ? WHERE id = ?")
      .bind(targetId || null, Date.now(), albumId)];
    for (const avatar of avatars) {
      updates.push(env.DB.prepare(
        "UPDATE artists SET storage_id = ? WHERE name = ? AND avatar_path = ?")
        .bind(targetId || null, avatar.name, avatar.avatar_path));
    }
    await env.DB.batch(updates);
    await env.KV.delete(manifestKey).catch(() => null);
    await invalidateR2(env, `art:${albumId}:`);
    for (const avatar of avatars) {
      await purgeArtistR2(env, avatar.name, false);
    }
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

/* One-click library migration advances to the next album not yet on the target,
   then moves files beginning at fileIndex. The frontend repeats calls until
   finished. targetId must name a different storage backend. */
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
  // Count once and select the first pending album instead of loading and filtering
  // the whole table for every file step. Validation above guarantees a nonempty
  // targetId; COALESCE('') only handles a NULL storage_id. ``need`` shrinks as
  // migration completes. albumOffset is a cumulative completion count, not an
  // array index; always process the first album not yet on the target.
  const [{ n: needCount = 0 } = {}, album] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM albums
      WHERE COALESCE(storage_id, '') != ?`).bind(targetId).first(),
    c.env.DB.prepare(`SELECT id, artist, title, storage_id FROM albums
      WHERE COALESCE(storage_id, '') != ?
      ORDER BY created_at, id LIMIT 1`).bind(targetId).first(),
  ]);
  const totalAlbums = offset + needCount;
  if (!album) {
    return c.json({
      finished: true, totalAlbums, albumOffset: offset, doneAlbums: offset,
    });
  }
  const step = await migrateAlbumStep(c.env, album.id, targetId, index);
  if (!step.ok) {
    return c.json({
      error: step.error, albumId: album.id, artist: album.artist,
      title: album.title, albumOffset: offset, totalAlbums, fileIndex: index,
    }, 502);
  }
  if (step.finished) {
    // This album is complete; advance to the next and reset fileIndex.
    const nextOffset = offset + 1;
    return c.json({
      finished: needCount === 1,
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

/* Google Drive OAuth: generate an authorization URL and exchange code for refresh_token */
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
      // access_token is short-lived and is not returned.
    });
  } catch (e) {
    return c.json({ error: String(e.message || e) }, 502);
  }
});

/* ---------- Configuration export/import for one-click restoration of named
   storage, R2, and related settings after redeployment. Exports exclude password
   hashes and the session epoch, but include sensitive fields verbatim; protect
   the JSON accordingly. ---------- */

app.get("/api/admin/config/export", async (c) => {
  const settings = {};
  for (const k of CONFIG_BACKUP_SETTING_KEYS) {
    const v = await getSetting(c.env, k);
    if (v != null && v !== "") settings[k] = v;
  }
  // Export the effective R2 configuration too. Database values take priority;
  // missing values have already been resolved by conf.
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

/* ---------- Companion endpoints for settings and heartbeat ---------- */

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
  // Cloudflare Cron Trigger from wrangler.jsonc triggers.crons periodically scans
  // new source posts. When the source module is disabled by default, skip the job
  // to avoid wasted invocations and external requests.
  scheduled: (event, env, ctx) => ctx.waitUntil((async () => {
    if ((await getSetting(env, "module_source")) === "1") await scanSource(env);
  })()),
};
