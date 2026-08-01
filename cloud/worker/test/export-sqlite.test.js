import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Database from "better-sqlite3";

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = join(here, "..");
const schema = readFileSync(join(workerDir, "schema.sql"), "utf8");

test("SQLite export restores library data without leaking config by default", () => {
  const temp = mkdtempSync(join(tmpdir(), "mihonban-export-"));
  const sourcePath = join(temp, "source.sqlite");
  const outputPath = join(temp, "backup.sql");
  const source = new Database(sourcePath);
  try {
    source.exec(schema);
    source.prepare(`INSERT INTO storages
      (id, name, kind, config, created_at)
      VALUES ('catalog-store', 'Catalog', 'webdav', '{}', 1)`).run();
    source.prepare(`INSERT INTO albums
      (id, artist, title, folder, storage_id, created_at, updated_at)
      VALUES ('album-1', 'Artist', 'Album', 'Music/Library/Artist/Album',
        'catalog-store', 1, 1)`).run();
    source.prepare(`INSERT INTO tracks
      (id, album_id, title, title_override, path)
      VALUES ('track-1', 'album-1', 'Track', 1,
        'Music/Library/Artist/Album/01.flac')`).run();
    source.prepare(`INSERT INTO album_artists
      (album_id, artist, artist_sort, position) VALUES
      ('album-1', 'Artist', 'Artist', 0),
      ('album-1', 'Guest', 'Guest', 1)`).run();
    source.prepare(`INSERT INTO track_artists
      (track_id, artist, artist_sort, position) VALUES
      ('track-1', 'Artist', 'Artist', 0),
      ('track-1', 'Track Guest', 'Guest, Track', 1)`).run();
    source.prepare(`INSERT INTO artists (name, avatar_path, storage_id)
      VALUES ('Artist', 'Music/Library/Artist/avatar.jpg', 'catalog-store')`).run();
    source.prepare(`INSERT INTO storages (id, name, kind, config, created_at)
      VALUES ('secret-store', 'Store', 'webdav', '{"password":"do-not-export"}', 1)`).run();
    source.prepare("INSERT INTO settings (k, v) VALUES ('discogs_token', 'do-not-export')").run();
  } finally {
    source.close();
  }

  try {
    execFileSync(process.execPath, [join(workerDir, "scripts", "export-sqlite.mjs"),
      "--source", sourcePath, "--output", outputPath], { cwd: workerDir });
    const sql = readFileSync(outputPath, "utf8");
    assert.equal(sql.includes("do-not-export"), false);

    const target = new Database(":memory:");
    try {
      target.exec(schema);
      target.exec(sql);
      assert.equal(target.prepare("SELECT COUNT(*) AS n FROM albums").get().n, 1);
      assert.equal(target.prepare("SELECT COUNT(*) AS n FROM tracks").get().n, 1);
      assert.equal(target.prepare(
        "SELECT title_override FROM tracks WHERE id = 'track-1'").get()
        .title_override, 1);
      assert.equal(target.prepare("SELECT COUNT(*) AS n FROM album_artists").get().n, 2);
      assert.equal(target.prepare("SELECT COUNT(*) AS n FROM track_artists").get().n, 2);
      assert.equal(target.prepare("SELECT COUNT(*) AS n FROM artists").get().n, 1);
      assert.equal(target.prepare("SELECT COUNT(*) AS n FROM storages").get().n, 0);
      assert.equal(target.prepare("SELECT COUNT(*) AS n FROM settings").get().n, 0);
    } finally {
      target.close();
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("config export is remote-D1 compatible and excludes auth/runtime state", () => {
  const temp = mkdtempSync(join(tmpdir(), "mihonban-export-config-"));
  const sourcePath = join(temp, "source.sqlite");
  const outputPath = join(temp, "backup.sql");
  const source = new Database(sourcePath);
  try {
    source.exec(schema);
    source.prepare(`INSERT INTO storages
      (id, name, kind, config, created_at)
      VALUES ('store-1', 'Store', 'webdav', '{"password":"storage-secret"}', 1)`).run();
    const insertSetting = source.prepare(
      "INSERT INTO settings (k, v) VALUES (?, ?)");
    insertSetting.run("discogs_token", "config-secret");
    insertSetting.run("admin_pass_hash", "admin-auth-secret");
    insertSetting.run("user_pass_hash", "user-auth-secret");
    insertSetting.run("session_epoch", "session-runtime-secret");
    insertSetting.run("companion_last_seen", "heartbeat-runtime-secret");
    insertSetting.run("source_last_scan", "scanner-runtime-secret");
  } finally {
    source.close();
  }

  try {
    execFileSync(process.execPath, [join(workerDir, "scripts", "export-sqlite.mjs"),
      "--source", sourcePath, "--output", outputPath, "--include-config",
      "--replace"],
    { cwd: workerDir });
    const sql = readFileSync(outputPath, "utf8");
    assert.equal(/^\s*(?:BEGIN TRANSACTION|COMMIT);\s*$/mi.test(sql), false);
    assert.equal(sql.includes("storage-secret"), true);
    assert.equal(sql.includes("config-secret"), true);
    for (const excluded of [
      "admin-auth-secret", "user-auth-secret", "session-runtime-secret",
      "heartbeat-runtime-secret", "scanner-runtime-secret",
    ]) assert.equal(sql.includes(excluded), false);

    const target = new Database(":memory:");
    try {
      target.exec(schema);
      target.prepare("INSERT INTO settings (k, v) VALUES (?, ?)")
        .run("admin_pass_hash", "target-admin-auth");
      target.prepare("INSERT INTO settings (k, v) VALUES (?, ?)")
        .run("discogs_token", "stale-config-secret");
      target.exec(sql);
      assert.equal(target.prepare("SELECT COUNT(*) AS n FROM storages").get().n, 1);
      assert.equal(target.prepare(
        "SELECT v FROM settings WHERE k = 'discogs_token'").get().v,
      "config-secret");
      assert.equal(target.prepare(
        "SELECT v FROM settings WHERE k = 'admin_pass_hash'").get().v,
      "target-admin-auth");
      assert.equal(target.prepare(
        "SELECT v FROM settings WHERE k = 'session_epoch'").get(), undefined);
    } finally {
      target.close();
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
