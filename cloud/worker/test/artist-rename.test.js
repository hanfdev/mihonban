import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import worker from "../src/index.js";
import { sessionCookie } from "../src/auth.js";
import { d1FromSqlite, kvFromSqlite } from "../src/compat.js";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const artistPath = (name) => `/api/artists/${encodeURIComponent(name)}`;

function catalog(t) {
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
  const request = (path, method = "GET", body) => worker.fetch(
    new Request(`http://mihonban.test${path}`, {
      method, headers: { "X-Api-Key": env.COMPANION_KEY, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
  const json = async (path, method, body) => {
    const response = await request(path, method, body);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const rename = (from, to) => json(artistPath(from), "PATCH", { name: to });
  const register = async (title, artists, trackArtists) => {
    const folder = `Music/Library/Rename/${title}`;
    const payload = { folder, title, artists,
      tracks: [{ path: `${folder}/01.flac`, title: "Song", track: 1,
        ...(trackArtists ? { artists: trackArtists } : {}) }] };
    const { id } = await json("/api/albums", "POST", payload);
    return { ...(await json(`/api/album/${id}`)), payload };
  };
  const snapshot = () => ["artists", "artist_aliases", "album_artists", "track_artists",
    "track_artist_imports", "albums", "tracks", "notes", "favorites"]
    .map((table) => db.prepare(`SELECT * FROM ${table}`).all());
  return { db, env, request, json, rename, register, snapshot };
}

test("artist-page renames preserve the complete identity and resolve old links and imports", async (t) => {
  const { db, json, rename, register } = catalog(t);
  const from = "Original Artist";
  const to = "New Artist Name";
  const first = await register("First", [{ name: from }]);
  const hidden = await register("Hidden", [{ name: "Guest" }, { name: from }]);
  const featured = await register("Featured", [{ name: "Guest" }],
    [{ name: "Guest" }, { name: from }]);
  db.prepare("UPDATE albums SET hidden = 1 WHERE id = ?").run(hidden.id);
  await json("/api/artists", "PUT", { name: from, note: "Short bio", bio: "# Full bio",
    artistSort: "Artist, Original", avatarPath: "Music/Library/Rename/avatar.jpg",
    avatarStorageId: "store" });
  db.prepare(`INSERT INTO favorites (kind, item_id, created_at, sort_order)
    VALUES ('album', ?, 1, 2), ('track', ?, 2, 3)`).run(first.id, featured.tracks[0].id);
  db.prepare(`INSERT INTO track_artist_imports
    (import_id, track_id, artist, position) VALUES ('pending', 'pending-track', ?, 0)`).run(from);
  const files = db.prepare(
    "SELECT id, folder, storage_id, hidden, created_at FROM albums ORDER BY id").all();
  const tracks = db.prepare("SELECT * FROM tracks ORDER BY id").all();
  const favorites = db.prepare("SELECT * FROM favorites ORDER BY kind").all();

  const result = await rename(from, to);
  assert.deepEqual(result.artistRenames, [{ from, to }]);
  assert.equal(result.name, to);
  assert.deepEqual(db.prepare(
    "SELECT id, folder, storage_id, hidden, created_at FROM albums ORDER BY id").all(), files);
  assert.deepEqual(db.prepare("SELECT * FROM tracks ORDER BY id").all(), tracks);
  assert.deepEqual(db.prepare("SELECT * FROM favorites ORDER BY kind").all(), favorites);
  assert.deepEqual(db.prepare("SELECT * FROM artists WHERE name = ?").get(to), {
    name: to, avatar_path: "Music/Library/Rename/avatar.jpg", storage_id: "store",
  });
  assert.equal(db.prepare("SELECT 1 FROM artists WHERE name = ?").get(from), undefined);
  assert.equal(db.prepare("SELECT artist FROM track_artist_imports").get().artist, to);
  const profile = (await json("/api/artists?hidden=1")).find((artist) => artist.name === to);
  assert.deepEqual(profile.aliases, [from]);
  assert.equal(profile.note, "Short bio");
  assert.equal(profile.sort, "Artist, Original");
  assert.equal(profile.hasAvatar, true);
  assert.equal((await json(`/api/artist-bio/${encodeURIComponent(from)}`)).bio, "# Full bio");
  assert.equal((await json(`${artistPath(from)}/tracks`))[0].id, featured.tracks[0].id);
  assert.equal((await json(`/api/album/${first.id}`)).artist, to);
  assert.equal((await json(`/api/album/${featured.id}`)).tracks[0].artists[1].name, to);

  await json("/api/albums", "POST", first.payload);
  await json("/api/albums", "POST", featured.payload);
  assert.equal((await json(`/api/album/${first.id}`)).artist, to);
  assert.equal((await json(`/api/album/${featured.id}`)).tracks[0].artists[1].name, to);
  const imported = await register("After rename", [{ name: from }, { name: to }],
    [{ name: "Guest" }, { name: from }, { name: to }]);
  assert.deepEqual(imported.artists.map((artist) => artist.name), [to]);
  assert.deepEqual(imported.tracks[0].artists.map((artist) => artist.name), ["Guest", to]);
  await json("/api/artists", "PUT", { name: from, bio: "Updated through the old link" });
  assert.equal((await json(`/api/artist-bio/${encodeURIComponent(to)}`)).bio,
    "Updated through the old link");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM artists").get().n, 2);
});

test("repeated renames flatten aliases, allow changing back, and retain case corrections", async (t) => {
  const { db, json, rename, register } = catalog(t);
  const album = await register("History", [{ name: "Björk" }]);
  await json("/api/artists", "PUT", { name: "Björk", bio: "Biography" });
  await rename("Björk", "Bjork / Solo");
  await rename("Björk", "New Stage Name");
  assert.deepEqual(new Set(db.prepare("SELECT artist FROM artist_aliases").all()
    .map((row) => row.artist)), new Set(["New Stage Name"]));
  assert.equal((await json(`/api/artist-bio/${encodeURIComponent("Bjork / Solo")}`)).bio,
    "Biography");
  await rename("New Stage Name", " BJÖRK ");
  assert.equal((await json(`/api/album/${album.id}`)).artist, "BJÖRK");
  assert.deepEqual(db.prepare("SELECT alias, artist FROM artist_aliases WHERE alias_key = 'björk'")
    .get(), { alias: "BJÖRK", artist: "BJÖRK" });
  assert.deepEqual(new Set((await json("/api/artists"))[0].aliases),
    new Set(["Bjork / Solo", "New Stage Name"]));
  assert.deepEqual(new Set(db.prepare("SELECT artist FROM artist_aliases").all()
    .map((row) => row.artist)), new Set(["BJÖRK"]));
  await json(`/api/album/${album.id}`, "PATCH", { artists: [{ name: "Björk" }] });
  assert.equal((await json(`/api/artist-bio/${encodeURIComponent("New Stage Name")}`)).bio,
    "Biography");
  assert.deepEqual(new Set(db.prepare("SELECT artist FROM artist_aliases").all()
    .map((row) => row.artist)), new Set(["Björk"]));
});

test("existing names, Unicode variants, and another artist's aliases never merge", async (t) => {
  const { db, request, json, rename, register, snapshot } = catalog(t);
  await register("Source", [{ name: "Source" }]);
  await register("Other", [{ name: "Other" }]);
  await register("Unicode", [{ name: "Björk" }]);
  await rename("Other", "Retitled");
  await json("/api/artists", "PUT", { name: "Source", bio: "Keep source bio" });
  db.prepare(`INSERT INTO notes (kind, id, text, updated_at)
    VALUES ('artistbio', 'Orphan', 'Keep orphan', 1)`).run();
  const before = snapshot();
  for (const name of ["Retitled", "retitled", "Other", "OTHER", "BJÖRK", "Orphan"]) {
    const response = await request(artistPath("Source"), "PATCH", { name });
    assert.equal(response.status, 409, name);
    assert.equal((await response.json()).code, "artist_name_conflict");
    assert.deepEqual(snapshot(), before);
  }
  db.exec("DROP TRIGGER artists_name_case_guard");
  db.prepare("INSERT INTO artists (name, avatar_path) VALUES ('SOURCE', 'legacy.jpg')").run();
  const response = await request(artistPath("Source"), "PATCH", { name: "Different" });
  assert.equal(response.status, 409);
  assert.equal(db.prepare("SELECT name FROM artists WHERE name = 'Different'").get(), undefined);
});

test("name validation and unchanged saves do not write artist data", async (t) => {
  const { db, env, request, rename, register, snapshot } = catalog(t);
  await register("Validation", [{ name: "Artist" }, { name: "Guest" }]);
  const before = snapshot();
  for (const name of ["", "  ", null, 1, {}, [], "bad\nname", "bad\u0000name", "x".repeat(501)]) {
    assert.equal((await request(artistPath("Artist"), "PATCH", { name })).status, 400);
    assert.deepEqual(snapshot(), before);
  }
  for (const name of ["x".repeat(499), "🎵".repeat(247)]) {
    const long = await request(artistPath("Artist"), "PATCH", { name });
    assert.equal(long.status, 400);
    assert.equal((await long.json()).code, "artist_credit_too_long");
    assert.deepEqual(snapshot(), before);
  }
  assert.equal((await request(artistPath("Missing"), "PATCH", { name: "New" })).status, 404);
  const batch = env.DB.batch;
  env.DB.batch = () => { throw new Error("Unchanged names must not write"); };
  assert.deepEqual(await rename("Artist", " Artist "), { ok: true, name: "Artist", artistRenames: [] });
  env.DB.batch = batch;
  assert.deepEqual(snapshot(), before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM artist_aliases").get().n, 0);
});

test("only administrators or the companion can rename artists", async (t) => {
  const { env, register, snapshot } = catalog(t);
  await register("Permission", [{ name: "Artist" }]);
  const before = snapshot();
  const cookie = (await sessionCookie(env, "user")).split(";")[0];
  for (const [headers, status] of [[{}, 401], [{ Cookie: cookie }, 403]]) {
    const response = await worker.fetch(new Request("http://mihonban.test/api/artists/Artist", {
      method: "PATCH", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ name: "Forbidden" }),
    }), env);
    assert.equal(response.status, status);
  }
  assert.deepEqual(snapshot(), before);
});

test("a failure after updating the artist rolls back aliases, credits, and profile data", async (t) => {
  const { db, request, json, register, snapshot } = catalog(t);
  await register("Rollback", [{ name: "Artist" }]);
  await json("/api/artists", "PUT", { name: "Artist", bio: "Keep this" });
  const before = snapshot();
  db.exec(`CREATE TRIGGER reject_profile_rename BEFORE UPDATE ON notes
    WHEN OLD.kind = 'artistbio' BEGIN SELECT RAISE(ABORT, 'forced rollback'); END`);
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal((await request(artistPath("Artist"), "PATCH", { name: "Rejected" })).status, 500);
  } finally { console.error = originalError; }
  assert.deepEqual(snapshot(), before);
});

test("a concurrent rename cannot redirect an alias or report a nonexistent name as saved", async (t) => {
  const { db, env, request, rename, register } = catalog(t);
  const album = await register("Concurrent", [{ name: "Artist" }]);
  const batch = env.DB.batch;
  env.DB.batch = async (statements) => {
    env.DB.batch = batch;
    await rename("Artist", "Concurrent Name");
    return batch(statements);
  };
  const response = await request(artistPath("Artist"), "PATCH", { name: "Stale Name" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "artist_changed");
  assert.equal(db.prepare("SELECT artist FROM albums WHERE id = ?").get(album.id).artist,
    "Concurrent Name");
  assert.deepEqual(db.prepare("SELECT alias, artist FROM artist_aliases WHERE alias != artist").all(),
    [{ alias: "Artist", artist: "Concurrent Name" }]);
});

test("concurrent artists cannot claim case-equivalent names, including Unicode", async (t) => {
  for (const [saved, conflicting] of [["Björk", "BJÖRK"], ["Shared", "SHARED"]]) {
    const { db, env, request, rename, register } = catalog(t);
    const first = await register("First", [{ name: "First Artist" }]);
    const second = await register("Second", [{ name: "Second Artist" }]);
    const batch = env.DB.batch;
    env.DB.batch = async (statements) => {
      env.DB.batch = batch;
      await rename("Second Artist", saved);
      return batch(statements);
    };
    const response = await request(artistPath("First Artist"), "PATCH", { name: conflicting });
    assert.equal(response.status, 409, conflicting);
    assert.equal((await response.json()).code, "artist_changed");
    assert.equal(db.prepare("SELECT artist FROM albums WHERE id = ?").get(first.id).artist,
      "First Artist");
    assert.equal(db.prepare("SELECT artist FROM albums WHERE id = ?").get(second.id).artist,
      saved);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM artists").get().n, 2);
    assert.equal(db.prepare("SELECT artist FROM artist_aliases WHERE alias_key = ?")
      .get(saved.toLowerCase()).artist, saved);
  }
});

test("deleting the last release removes its artist aliases", async (t) => {
  const { db, json, rename, register } = catalog(t);
  const album = await register("Delete", [{ name: "Artist" }]);
  await rename("Artist", "Renamed");
  await json(`/api/album/${album.id}`, "DELETE");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM artists").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM artist_aliases").get().n, 0);
});

test("existing databases receive the alias table before handling artist requests", async (t) => {
  const { db, env, rename, register } = catalog(t);
  db.exec("DROP TABLE artist_aliases");
  db.prepare("INSERT INTO settings (k, v) VALUES ('schema_version', '2026-08-05-1')").run();
  env.DB_SCHEMA_KEY = "artist-rename-legacy-migration";
  await register("Legacy", [{ name: "Old" }]);
  await rename("Old", "New");
  assert.equal(db.prepare("SELECT v FROM settings WHERE k = 'schema_version'").get().v,
    "2026-09-14-1");
  assert.deepEqual(db.prepare("SELECT alias, artist FROM artist_aliases WHERE alias != artist").all(),
    [{ alias: "Old", artist: "New" }]);
});
