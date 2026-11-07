import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import worker from "../src/index.js";
import { sessionCookie } from "../src/auth.js";
import { d1FromSqlite, kvFromSqlite } from "../src/compat.js";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

async function catalog(t) {
  let now = 1_700_000_000_000;
  t.mock.method(Date, "now", () => now);
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schema);
  t.after(() => db.close());
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('store', 'Store', 'local', '{}', 1, 1)`).run();
  const env = {
    DB: d1FromSqlite(db), KV: kvFromSqlite(db),
    COMPANION_KEY: "test-companion",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    OD_ROOT: "Music/Library",
  };
  const cookie = (await sessionCookie(env, "admin")).split(";")[0];
  const request = (path, { method = "GET", body, headers = {}, companion = false } = {}) =>
    worker.fetch(new Request(`http://mihonban.test${path}`, {
      method,
      headers: {
        ...(companion ? { "X-Api-Key": env.COMPANION_KEY } : { Cookie: cookie }),
        "Content-Type": "application/json", ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
  const json = async (path, options) => {
    const response = await request(path, options);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const register = async (title) => {
    const folder = `Music/Library/Artist/${title}`;
    const payload = { folder, artist: "Artist", title, rymRating: 3.5,
      tracks: [{ path: `${folder}/01.flac`, title: "Song", track: 1 }] };
    const { id } = await json("/api/albums", {
      method: "POST", body: payload, companion: true,
    });
    return { ...(await json(`/api/album/${id}`)), payload };
  };
  return { request, json, register, advance: () => (now += 1_000) };
}

test("editing or rescanning an album preserves its added time and refreshes cached catalogs", async (t) => {
  const { request, json, register, advance } = await catalog(t);
  const old = await register("Old album");
  advance();
  const newer = await register("Newer album");
  const trackId = old.tracks[0].id;
  const edits = [
    ["admin rating edit", `/api/album/${old.id}`,
      { method: "PATCH", body: { rymRating: 4.5 } }],
    ["album metadata edit", `/api/album/${old.id}`,
      { method: "PATCH", body: { title: "Corrected title", year: 2001, genres: ["Rock"] } }],
    ["track metadata edit", `/api/album/${old.id}/tracks/${trackId}`,
      { method: "PATCH", body: { title: "Corrected song title" } }],
    ["companion rescan", "/api/albums",
      { method: "POST", body: old.payload, companion: true }],
  ];

  for (const [label, path, options] of edits) {
    await t.test(label, async () => {
      const etags = new Map();
      for (const catalogPath of ["/api/library", "/api/tracks"]) {
        const response = await request(catalogPath);
        assert.equal(response.status, 200);
        const etag = response.headers.get("ETag");
        assert.ok(etag);
        etags.set(catalogPath, etag);
        assert.equal((await request(catalogPath, {
          headers: { "If-None-Match": etag },
        })).status, 304);
      }

      const editedAt = advance();
      await json(path, options);
      const detail = await json(`/api/album/${old.id}`);
      assert.equal(detail.createdAt, old.createdAt);
      assert.equal(detail.updatedAt, editedAt);
      assert.equal(detail.rym.rating, 4.5);
      if (label === "track metadata edit" || label === "companion rescan") {
        assert.equal(detail.tracks[0].title, "Corrected song title");
      }

      for (const [catalogPath, etag] of etags) {
        const response = await request(catalogPath, {
          headers: { "If-None-Match": etag },
        });
        assert.equal(response.status, 200);
        assert.notEqual(response.headers.get("ETag"), etag);
        const rows = await response.json();
        if (catalogPath === "/api/library") {
          const album = rows.find((row) => row.id === old.id);
          assert.equal(album.createdAt, old.createdAt);
          assert.equal(album.updatedAt, editedAt);
          assert.equal(rows.find((row) => row.id === newer.id).createdAt, newer.createdAt);
          assert.ok(album.createdAt < newer.createdAt);
        } else {
          assert.equal(rows.find((row) => row.id === trackId).addedAt, old.createdAt);
        }
      }
    });
  }
});

test("a newly imported album receives its own creation time", async (t) => {
  const { json, register, advance } = await catalog(t);
  const first = await register("First album");
  const addedAt = advance();
  const second = await register("Second album");
  assert.equal(second.createdAt, addedAt);
  assert.equal(second.updatedAt, addedAt);
  assert.ok(second.createdAt > first.createdAt);
  assert.equal((await json(`/api/album/${first.id}`)).createdAt, first.createdAt);
});
