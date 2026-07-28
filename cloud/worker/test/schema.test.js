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
    assert.ok(albumColumns.includes("storage_id"));
    assert.ok(albumColumns.includes("hidden"));
    assert.ok(artistColumns.includes("storage_id"));
    assert.ok(imageColumns.includes("source_key"));
    assert.ok(db.prepare(`SELECT 1 FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_images_album_source'`).get());
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
