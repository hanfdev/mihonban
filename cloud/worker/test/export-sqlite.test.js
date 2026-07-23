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
    source.prepare(`INSERT INTO tracks (id, album_id, title, path)
      VALUES ('track-1', 'album-1', 'Track', 'Music/Library/Artist/Album/01.flac')`).run();
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
