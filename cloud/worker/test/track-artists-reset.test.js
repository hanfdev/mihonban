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
  const call = async (path, method = "GET", body, key = env.COMPANION_KEY) => {
    const response = await worker.fetch(new Request(`http://mihonban.test${path}`, {
      method, headers: { ...(key ? { "X-Api-Key": key } : {}),
        "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
    return { status: response.status, data: await response.json() };
  };
  const json = async (...args) => {
    const { status, data } = await call(...args);
    assert.equal(status, 200, JSON.stringify(data));
    return data;
  };
  return { call, json };
}

const names = (artists) => artists.map((artist) => artist.name);

async function albumWithTrackCredits(json) {
  const folder = "Music/Library/Reset/Album";
  const { id } = await json("/api/albums", "POST", {
    folder, title: "Album", artists: [{ name: "Main Artist" }],
    tracks: [
      { path: `${folder}/01.flac`, title: "One", track: 1,
        artists: [{ name: "Main Artist" }, { name: "Only Guest" }] },
      { path: `${folder}/02.flac`, title: "Two", track: 2,
        artists: [{ name: "Other Artist" }] },
      { path: `${folder}/03.flac`, title: "Three", track: 3 },
    ],
  });
  return id;
}

test("clearing track artists returns every track to the album credit", async (t) => {
  const { json } = catalog(t);
  const id = await albumWithTrackCredits(json);
  const before = await json(`/api/album/${id}`);
  assert.deepEqual(before.tracks.map((track) => track.hasCustomArtists), [true, true, false]);

  const result = await json(`/api/album/${id}/track-artists`, "DELETE");
  assert.deepEqual(result, { ok: true, cleared: 2 });

  const after = await json(`/api/album/${id}`);
  assert.deepEqual(names(after.artists), ["Main Artist"]);
  for (const track of after.tracks) {
    assert.equal(track.hasCustomArtists, false);
    assert.deepEqual(names(track.artists), ["Main Artist"]);
  }
  // Artists that were credited only on those tracks no longer exist.
  const artists = names(await json("/api/artists"));
  assert.ok(artists.includes("Main Artist"));
  assert.ok(!artists.includes("Only Guest"));
  assert.ok(!artists.includes("Other Artist"));

  // A second call is a no-op.
  assert.deepEqual(await json(`/api/album/${id}/track-artists`, "DELETE"),
    { ok: true, cleared: 0 });
});

test("clearing track artists keeps guests credited on other albums", async (t) => {
  const { json } = catalog(t);
  const id = await albumWithTrackCredits(json);
  await json("/api/albums", "POST", {
    folder: "Music/Library/Reset/Solo", title: "Solo",
    artists: [{ name: "Only Guest" }],
    tracks: [{ path: "Music/Library/Reset/Solo/01.flac", title: "Solo", track: 1 }],
  });
  await json(`/api/album/${id}/track-artists`, "DELETE");
  assert.ok(names(await json("/api/artists")).includes("Only Guest"));
});

test("clearing track artists requires an administrator and an existing album", async (t) => {
  const { call, json } = catalog(t);
  const id = await albumWithTrackCredits(json);
  const anonymous = await call(`/api/album/${id}/track-artists`, "DELETE", undefined, null);
  assert.equal(anonymous.status, 401);
  const after = await json(`/api/album/${id}`);
  assert.deepEqual(after.tracks.map((track) => track.hasCustomArtists), [true, true, false]);
  const missing = await call("/api/album/missing/track-artists", "DELETE");
  assert.equal(missing.status, 404);
});
