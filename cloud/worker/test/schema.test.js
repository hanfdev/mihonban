import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Database from "better-sqlite3";

import { kvFromSqlite } from "../src/compat.js";

const here = dirname(fileURLToPath(import.meta.url));

test("fresh schema includes current storage and image identity columns", () => {
  const db = new Database(":memory:");
  try {
    db.exec(readFileSync(join(here, "..", "schema.sql"), "utf8"));
    const albumColumns = db.prepare("PRAGMA table_info(albums)").all()
      .map((c) => c.name);
    const artistColumns = db.prepare("PRAGMA table_info(artists)").all()
      .map((c) => c.name);
    const imageColumns = db.prepare("PRAGMA table_info(album_images)").all()
      .map((c) => c.name);
    const albumArtistColumns = db.prepare("PRAGMA table_info(album_artists)").all()
      .map((c) => c.name);
    const trackArtistColumns = db.prepare("PRAGMA table_info(track_artists)").all()
      .map((c) => c.name);
    const trackColumns = db.prepare("PRAGMA table_info(tracks)").all()
      .map((c) => c.name);
    const trackImportColumns = db.prepare("PRAGMA table_info(track_imports)").all()
      .map((c) => c.name);
    assert.ok(albumColumns.includes("storage_id"));
    assert.ok(albumColumns.includes("hidden"));
    assert.ok(artistColumns.includes("storage_id"));
    assert.ok(imageColumns.includes("source_key"));
    assert.ok(trackColumns.includes("title_override"));
    assert.ok(trackImportColumns.includes("title_override"));
    assert.deepEqual(albumArtistColumns,
      ["album_id", "artist", "artist_sort", "position"]);
    assert.deepEqual(trackArtistColumns,
      ["track_id", "artist", "artist_sort", "position"]);
    assert.ok(db.prepare(`SELECT 1 FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_images_album_source'`).get());
    assert.ok(db.prepare(`SELECT 1 FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_album_artists_artist'`).get());
    assert.ok(db.prepare(`SELECT 1 FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_track_artists_artist'`).get());
    assert.ok(db.prepare(`SELECT 1 FROM sqlite_master
      WHERE type = 'view' AND name = 'artist_album_links'`).get());
    db.prepare(`INSERT INTO albums
      (id, artist, title, folder, storage_id, created_at, updated_at)
      VALUES ('album', 'Main', 'Album', 'Music/Main/Album', 'store', 1, 1)`).run();
    db.prepare(`INSERT INTO tracks (id, album_id, title, path) VALUES
      ('one', 'album', 'One', 'Music/Main/Album/01.mp3'),
      ('two', 'album', 'Two', 'Music/Main/Album/02.mp3')`).run();
    db.prepare(`INSERT INTO track_artists
      (track_id, artist, artist_sort, position) VALUES
      ('one', 'Guest', 'Guest', 0), ('two', 'Guest', 'Guest', 0)`).run();
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM artist_album_links
      WHERE album_id = 'album' AND artist = 'Guest'`).get().n, 1);
  } finally {
    db.close();
  }
});

test("Node KV treats damaged JSON cache entries as misses", async () => {
  const db = new Database(":memory:");
  try {
    const kv = kvFromSqlite(db);
    db.prepare("INSERT INTO _kv (k, v, exp) VALUES (?, ?, NULL)")
      .run("broken", "{not-json");
    assert.equal(await kv.get("broken", "json"), null);
    assert.equal(await kv.get("broken"), null);
  } finally {
    db.close();
  }
});
