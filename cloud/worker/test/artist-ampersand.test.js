import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import worker from "../src/index.js";
import { d1FromSqlite, kvFromSqlite } from "../src/compat.js";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

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
  const json = async (path, method = "GET", body) => {
    const response = await worker.fetch(new Request(`http://mihonban.test${path}`, {
      method, headers: { "X-Api-Key": env.COMPANION_KEY,
        "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  };
  const names = (artists) => artists.map((artist) => artist.name);
  const register = async (title, artists, trackArtists) => {
    const folder = `Music/Library/Amp/${title}`;
    const { id } = await json("/api/albums", "POST", { folder, title, artists,
      tracks: [{ path: `${folder}/01.flac`, title: "Song", track: 1,
        ...(trackArtists ? { artists: trackArtists } : {}) }] });
    return json(`/api/album/${id}`);
  };
  return { json, names, register };
}

test("new ampersand credits stay split when the combined name is unknown", async (t) => {
  const { names, register } = catalog(t);
  const album = await register("Valle",
    [{ name: "Marcos Valle" }, { name: "Azymuth" }]);
  assert.deepEqual(names(album.artists), ["Marcos Valle", "Azymuth"]);
});

test("a combined artist already in the library is rejoined on rescans and imports", async (t) => {
  const { json, names, register } = catalog(t);
  const first = await register("First", [{ name: "Simon & Garfunkel" }]);
  // A rescan with a client that now splits "&" keeps the existing credit.
  const rescan = await register("First", [{ name: "Simon" }, { name: "Garfunkel" }]);
  assert.equal(rescan.id, first.id);
  assert.deepEqual(names(rescan.artists), ["Simon & Garfunkel"]);
  // A new album and a track-level credit join the known artist too, and the
  // rejoined track credit is recognised as inherited from the album.
  const second = await register("Second",
    [{ name: "simon" }, { name: "GARFUNKEL" }, { name: "Guest" }],
    [{ name: "Simon" }, { name: "Garfunkel" }]);
  assert.deepEqual(names(second.artists), ["Simon & Garfunkel", "Guest"]);
  assert.deepEqual(names(second.tracks[0].artists), ["Simon & Garfunkel"]);
  const added = await json(`/api/album/${second.id}/tracks`, "POST", {
    path: "Music/Library/Amp/Second/02.flac", title: "Two", track: 2,
    artists: [{ name: "Simon" }, { name: "Garfunkel" }],
  });
  assert.ok(added);
  const after = await json(`/api/album/${second.id}`);
  assert.deepEqual(names(after.tracks.find((track) => track.track === 2).artists),
    ["Simon & Garfunkel"]);
});

test("known comma-joined artists are rejoined whatever separators the client used", async (t) => {
  const { names, register } = catalog(t);
  await register("Band", [{ name: "Crosby, Stills, Nash & Young" }]);
  await register("Session", [{ name: "Kazuo Ohtani, Yoshiaki Furuta" }]);
  const album = await register("Later", [
    { name: "Crosby" }, { name: "Stills" }, { name: "Nash" }, { name: "Young" },
    { name: "Kazuo Ohtani" }, { name: "Yoshiaki Furuta" }, { name: "Ryo Yonemitsu" },
  ]);
  assert.deepEqual(names(album.artists),
    ["Crosby, Stills, Nash & Young", "Kazuo Ohtani, Yoshiaki Furuta", "Ryo Yonemitsu"]);
});

test("manual edits can split a known combined artist", async (t) => {
  const { json, names, register } = catalog(t);
  const album = await register("Duo", [{ name: "Neil & Iraiza" }]);
  await json(`/api/album/${album.id}`, "PATCH",
    { artists: [{ name: "Neil" }, { name: "Iraiza" }] });
  const after = await json(`/api/album/${album.id}`);
  assert.deepEqual(names(after.artists), ["Neil", "Iraiza"]);
});
