import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import worker from "../src/index.js";
import { d1FromSqlite, kvFromSqlite } from "../src/compat.js";
import { sessionCookie } from "../src/auth.js";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

function catalog(t, kind) {
  const db = new Database(":memory:");
  db.exec(schema);
  t.after(() => db.close());
  const insert = db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES (?, ?, ?, ?, ?, 1)`);
  insert.run("album-store", "Music archive", kind,
    JSON.stringify({ root: "/private-library", token: "fixture-private-token" }), 0);
  insert.run("write-store", "New uploads", "local", "{}", 1);
  db.prepare(`INSERT INTO albums (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('album', 'Artist', 'Album', 'Music/Library/Artist/Album', 'album-store', 1, 1)`).run();
  db.prepare("INSERT INTO settings (k, v) VALUES ('guest_open', '1')").run();
  const env = {
    DB: d1FromSqlite(db), KV: kvFromSqlite(db),
    COMPANION_KEY: "test-companion",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    OD_ROOT: "Music/Library",
  };
  const call = async (role) => {
    const headers = role === "companion" ? { "X-Api-Key": env.COMPANION_KEY }
      : role ? { Cookie: (await sessionCookie(env, role)).split(";")[0] } : {};
    const response = await worker.fetch(new Request("http://mihonban.test/api/album/album", {
      headers,
    }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const body = await response.json();
    assert.ok(!JSON.stringify(body).includes("fixture-private-token"));
    assert.ok(!JSON.stringify(body).includes("/private-library"));
    return body;
  };
  return { db, call };
}

for (const kind of ["onedrive", "gdrive", "webdav", "local"]) {
  test(`album metadata names its ${kind} backend, not the current write target`, async (t) => {
    const { db, call } = catalog(t, kind);
    for (const role of ["admin", "companion"]) {
      assert.deepEqual((await call(role)).storage, { name: "Music archive", kind });
    }
    for (const role of ["user", null]) {
      const album = await call(role);
      assert.equal(Object.hasOwn(album, "storage"), false);
      assert.ok(!JSON.stringify(album).includes("Music archive"));
    }
    db.prepare("UPDATE storages SET name = 'Renamed archive' WHERE id = 'album-store'").run();
    assert.deepEqual((await call("admin")).storage, { name: "Renamed archive", kind });
  });
}

test("a missing storage record does not break album browsing or name the write target", async (t) => {
  const { db, call } = catalog(t, "local");
  await call("admin");
  db.prepare("DELETE FROM storages WHERE id = 'album-store'").run();
  assert.equal(Object.hasOwn(await call("admin"), "storage"), false);
});
