import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import worker from "../src/index.js";
import { d1FromSqlite, kvFromSqlite } from "../src/compat.js";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const originalName = "roly poly rag bear";
const correctedName = "Roly Poly Rag Bear";

function catalog(t) {
  const db = new Database(":memory:");
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
      method, headers: { "X-Api-Key": env.COMPANION_KEY,
        "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
  const json = async (path, method, body) => {
    const response = await request(path, method, body);
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  };
  const register = async (title, artists, trackArtists) => {
    const folder = `Music/Library/Casing/${title}`;
    const payload = { folder, title, artists,
      tracks: [{ path: `${folder}/01.flac`, title: "Song", track: 1,
        ...(trackArtists ? { artists: trackArtists } : {}) }] };
    const { id } = await json("/api/albums", "POST", payload);
    return { ...(await json(`/api/album/${id}`)), payload };
  };
  return { db, env, request, json, register };
}

test("casing edits preserve profiles, ordered credits, hidden state, files and favorites", async (t) => {
  const { db, json, register } = catalog(t);
  const first = await register("First", [{ name: originalName }]);
  const duet = await register("Duet", [{ name: "Guest" }, { name: originalName }]);
  const trio = await register("Trio",
    [{ name: originalName }, { name: "Guest" }, { name: "Other" }]);
  const featured = await register("Featured", [{ name: "Other" }],
    [{ name: "Other" }, { name: originalName }]);
  db.prepare("UPDATE albums SET hidden = 1 WHERE id = ?").run(duet.id);
  const avatarPath = "Music/Library/Casing/avatar.jpg";
  const sort = "Rag Bear, Roly Poly";
  await json("/api/artists", "PUT", { name: originalName,
    note: "Short introduction", bio: "# Full biography", artistSort: sort,
    avatarPath, avatarStorageId: "store" });
  const avatarKey = `artist:${createHash("sha1").update(avatarPath)
    .digest("hex").slice(0, 16)}:480`;
  db.prepare(`INSERT INTO r2_cache (cache_key, r2_key, created_at, cache_policy)
    VALUES (?, 'img/avatar.webp', 1, 1)`).run(avatarKey);
  db.prepare(`INSERT INTO favorites (kind, item_id, created_at, sort_order)
    VALUES ('album', ?, 1, 4), ('track', ?, 2, 2)`)
    .run(first.id, featured.tracks[0].id);
  db.prepare(`INSERT INTO track_artist_imports
    (import_id, track_id, artist, artist_sort, position)
    VALUES ('pending', 'pending-track', ?, ?, 0)`).run(originalName, sort);
  db.prepare("UPDATE albums SET updated_at = 1").run();
  const filesBefore = db.prepare(
    "SELECT id, folder, storage_id, hidden, created_at FROM albums ORDER BY id").all();
  const tracksBefore = db.prepare("SELECT * FROM tracks ORDER BY id").all();
  const favoritesBefore = db.prepare("SELECT * FROM favorites ORDER BY kind").all();

  const result = await json(`/api/album/${first.id}`, "PATCH", {
    artists: [{ name: correctedName, sort }],
  });
  assert.deepEqual(result.artistRenames, [{ from: originalName, to: correctedName }]);
  assert.deepEqual(db.prepare("SELECT * FROM artists WHERE name = ?").get(correctedName),
    { name: correctedName, avatar_path: avatarPath, storage_id: "store" });
  assert.equal(db.prepare("SELECT 1 FROM artists WHERE name = ?").get(originalName),
    undefined);
  assert.deepEqual(db.prepare(
    "SELECT id, folder, storage_id, hidden, created_at FROM albums ORDER BY id").all(),
  filesBefore);
  assert.deepEqual(db.prepare("SELECT * FROM tracks ORDER BY id").all(), tracksBefore);
  assert.deepEqual(db.prepare("SELECT * FROM favorites ORDER BY kind").all(), favoritesBefore);
  assert.equal(db.prepare("SELECT r2_key FROM r2_cache WHERE cache_key = ?")
    .get(avatarKey).r2_key, "img/avatar.webp");
  assert.deepEqual(db.prepare("SELECT kind, id, text FROM notes ORDER BY kind").all(), [
    { kind: "artist", id: correctedName, text: "Short introduction" },
    { kind: "artistbio", id: correctedName, text: "# Full biography" },
    { kind: "artistsort", id: correctedName, text: sort },
  ]);
  assert.deepEqual(db.prepare(
    "SELECT artist, artist_sort FROM track_artist_imports").all(),
  [{ artist: correctedName, artist_sort: sort }]);
  assert.equal((await json(`/api/album/${duet.id}`)).artist,
    `Guest × ${correctedName}`);
  assert.equal((await json(`/api/album/${trio.id}`)).artist,
    `${correctedName}, Guest, Other`);
  assert.equal((await json(`/api/album/${featured.id}`)).tracks[0].artists[1].name,
    correctedName);
  for (const row of db.prepare("SELECT updated_at FROM albums").all()) {
    assert.ok(row.updated_at > 1);
  }
  const oldLink = encodeURIComponent(originalName);
  assert.equal((await json(`/api/artist-bio/${oldLink}`)).bio, "# Full biography");
  const guests = await json(`/api/artists/${oldLink}/tracks?hidden=1`);
  assert.deepEqual(guests.map((track) => track.id), [featured.tracks[0].id]);
  const artistList = await json("/api/artists?hidden=1");
  assert.equal(artistList.filter((artist) =>
    artist.name.toLowerCase() === originalName).length, 1);
  assert.equal(artistList.find((artist) => artist.name === correctedName).hasAvatar, true);

  // Old tags and an older client using the old URL cannot undo the curated name.
  await json("/api/albums", "POST", first.payload);
  await json("/api/albums", "POST", featured.payload);
  await json("/api/artists", "PUT", { name: originalName, bio: "Updated biography" });
  assert.equal((await json(`/api/album/${first.id}`)).artist, correctedName);
  assert.equal((await json(`/api/album/${featured.id}`)).tracks[0].artists[1].name,
    correctedName);
  assert.equal((await json(`/api/artist-bio/${oldLink}`)).bio, "Updated biography");
});

test("track casing edits also update shared names and preserve inheritance", async (t) => {
  const { db, json, register } = catalog(t);
  const album = await register("Inherited", [{ name: originalName }]);
  const guestAlbum = await register("Guest", [{ name: "Main" }],
    [{ name: "Main" }, { name: originalName }]);
  await json("/api/artists", "PUT", { name: originalName, artistSort: "Rag Bear, Roly Poly" });
  const result = await json(`/api/album/${album.id}/tracks/${album.tracks[0].id}`, "PATCH",
    { artists: [{ name: correctedName }] });
  assert.deepEqual(result.artistRenames, [{ from: originalName, to: correctedName }]);
  const detail = await json(`/api/album/${album.id}`);
  assert.equal(detail.artist, correctedName);
  assert.equal(detail.tracks[0].hasCustomArtists, false);
  assert.equal(detail.tracks[0].artistSort, "Rag Bear, Roly Poly");
  const editedGuest = await json(
    `/api/album/${guestAlbum.id}/tracks/${guestAlbum.tracks[0].id}`, "PATCH",
    { artists: [{ name: "Main" }, { name: "ROLY POLY RAG BEAR" }] });
  assert.deepEqual(editedGuest.artistRenames,
    [{ from: correctedName, to: "ROLY POLY RAG BEAR" }]);
  assert.equal((await json(`/api/album/${album.id}`)).artist, "ROLY POLY RAG BEAR");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM artists").get().n, 2);
});

test("adding an existing artist or choosing a different artist does not rename their profile", async (t) => {
  const { db, json, register } = catalog(t);
  const original = await register("Original", [{ name: originalName }]);
  const another = await register("Another", [{ name: "Another Artist" }]);
  const added = await json(`/api/album/${another.id}`, "PATCH",
    { artists: [{ name: correctedName }] });
  assert.equal(added.artistRenames, undefined);
  assert.equal((await json(`/api/album/${another.id}`)).artist, originalName);
  await json(`/api/album/${another.id}`, "PATCH", { artist: "A Different Artist" });
  assert.equal((await json(`/api/album/${original.id}`)).artist, originalName);
  assert.ok(db.prepare("SELECT 1 FROM artists WHERE name = ?").get(originalName));
});

test("invalid edits and failed transactions leave all artist references unchanged", async (t) => {
  const { db, request, json, register } = catalog(t);
  const album = await register("Atomic", [{ name: originalName }]);
  await json("/api/artists", "PUT", { name: originalName, bio: "Keep biography" });
  const snapshot = () => ["artists", "album_artists", "track_artists", "albums", "notes"]
    .map((table) => db.prepare(`SELECT * FROM ${table}`).all());
  const before = snapshot();
  const invalid = await request(`/api/album/${album.id}`, "PATCH",
    { artists: [{ name: correctedName }], note: { invalid: true } });
  assert.equal(invalid.status, 400);
  assert.deepEqual(snapshot(), before);
  db.exec(`CREATE TRIGGER reject_album_edit BEFORE UPDATE ON albums
    WHEN NEW.title = 'Rejected' BEGIN
      SELECT RAISE(ABORT, 'simulated save failure');
    END`);
  const errorLog = t.mock.method(console, "error", () => {});
  const failure = await request(`/api/album/${album.id}`, "PATCH",
    { artists: [{ name: correctedName }], title: "Rejected" });
  assert.equal(failure.status, 500);
  assert.match(String(errorLog.mock.calls[0]?.arguments[0]), /simulated save failure/);
  assert.deepEqual(snapshot(), before);
});

test("legacy profile collisions are reported without merging or losing data", async (t) => {
  const { db, request, json, register } = catalog(t);
  const album = await register("Collision", [{ name: originalName }]);
  await json("/api/artists", "PUT", { name: originalName, bio: "Original biography" });
  db.exec("DROP TRIGGER artists_name_case_guard");
  db.prepare("INSERT INTO artists (name, avatar_path) VALUES (?, 'other/avatar.jpg')")
    .run(correctedName);
  const response = await request(`/api/album/${album.id}`, "PATCH",
    { artists: [{ name: correctedName }] });
  assert.equal(response.status, 409);
  assert.equal((await json(`/api/album/${album.id}`)).artist, originalName);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM artists").get().n, 2);
  assert.equal(db.prepare("SELECT text FROM notes WHERE kind = 'artistbio'").get().text,
    "Original biography");
});

test("Unicode casing and the legacy singular edit field survive subsequent rescans", async (t) => {
  const { db, json, register } = catalog(t);
  const album = await register("Unicode", [{ name: "Björk" }]);
  await json(`/api/album/${album.id}`, "PATCH", { artist: "BJÖRK" });
  assert.equal((await json(`/api/album/${album.id}`)).artist, "BJÖRK");
  await json("/api/albums", "POST", album.payload);
  assert.equal((await json(`/api/album/${album.id}`)).artist, "BJÖRK");
  assert.deepEqual(db.prepare("SELECT name FROM artists").all(), [{ name: "BJÖRK" }]);
});

test("correcting all 24 credits stays within one bounded D1 transaction", async (t) => {
  const { db, env, json, register } = catalog(t);
  const names = Array.from({ length: 24 }, (_, index) => `artist ${index}`);
  const album = await register("Many", names.map((name) => ({ name })));
  const batch = env.DB.batch;
  const sizes = [];
  env.DB.batch = (statements) => {
    sizes.push(statements.length);
    assert.ok(statements.length <= 80);
    return batch(statements);
  };
  const result = await json(`/api/album/${album.id}`, "PATCH",
    { artists: names.map((name) => ({ name: name.toUpperCase() })) });
  assert.equal(result.artistRenames.length, 24);
  assert.equal(sizes.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM artists").get().n, 24);
  assert.deepEqual((await json(`/api/album/${album.id}`)).artists,
    names.map((name) => ({ name: name.toUpperCase(), sort: "" })));
});
