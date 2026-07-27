import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import worker from "../src/index.js";
import { d1FromSqlite, kvFromSqlite } from "../src/compat.js";
import { api as localFs } from "../src/localfs.js";

const schema = readFileSync(join(process.cwd(), "schema.sql"), "utf8");

const jsonBody = (value) => ({
  headers: { "Content-Type": "application/json", "X-Api-Key": "companion-key" },
  body: JSON.stringify(value),
});

function companionRequest(env, url, init = {}) {
  return worker.fetch(new Request(`http://mihonban.test${url}`, {
    ...init,
    headers: { "X-Api-Key": "companion-key", ...(init.headers || {}) },
  }), env);
}

function companionEnv(db, extra = {}) {
  return {
    DB: d1FromSqlite(db),
    KV: kvFromSqlite(db),
    COMPANION_KEY: "companion-key",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    OD_ROOT: "Music/Library",
    ...extra,
  };
}

test("catalog writes preserve folder, image-order, search, and storage invariants", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('main-store', 'Main', 'local', '{}', 1, 1),
           ('avatar-store', 'Avatar', 'local', '{}', 0, 2),
           ('unused-store', 'Unused', 'local', '{}', 0, 3)`).run();
  const env = companionEnv(db);

  try {
    const folder = "Music/Library/Artist/[2000] A..B";
    const created = await companionRequest(env, "/api/albums", {
      method: "POST",
      ...jsonBody({
        folder, artist: "Artist", title: "A..B", genres: ["Rock"],
        tracks: [{ path: `${folder}/01.mp3`, title: "One" }],
      }),
    });
    const createdBody = await created.json();
    assert.equal(created.status, 200, createdBody.error);
    const albumId = createdBody.id;

    const outsideTrack = await companionRequest(env, "/api/albums", {
      method: "POST",
      ...jsonBody({
        folder: "Music/Library/Artist/Other", artist: "Artist", title: "Other",
        tracks: [{ path: "Music/Library/Elsewhere/01.mp3", title: "Wrong" }],
      }),
    });
    assert.equal(outsideTrack.status, 400);
    assert.equal(db.prepare("SELECT 1 FROM albums WHERE title = 'Other'").get(), undefined);

    for (const field of ["track", "disc"]) {
      const unsafeFolder = `Music/Library/Artist/Unsafe ${field}`;
      const unsafeNumber = await companionRequest(env, "/api/albums", {
        method: "POST",
        ...jsonBody({
          folder: unsafeFolder, artist: "Artist", title: `Unsafe ${field}`,
          tracks: [{
            path: `${unsafeFolder}/01.mp3`, title: "Wrong",
            [field]: Number.MAX_SAFE_INTEGER + 1,
          }],
        }),
      });
      assert.equal(unsafeNumber.status, 400);
      assert.equal(db.prepare("SELECT 1 FROM albums WHERE title = ?")
        .get(`Unsafe ${field}`), undefined);
    }

    db.prepare(`INSERT INTO albums
      (id, artist, title, folder, genres, storage_id, created_at, updated_at)
      VALUES ('hard-rock', 'Other', 'Hard', 'Music/Library/Other/Hard',
        '["Hard Rock"]', 'main-store', 2, 2),
             ('exact-rock', 'Other', 'Exact', 'Music/Library/Other/Exact',
        '["rock"]', 'main-store', 3, 3)`).run();
    const detail = await companionRequest(env, `/api/album/${albumId}`);
    const similar = (await detail.json()).similar.map((item) => item.id);
    assert.deepEqual(similar, ["exact-rock"]);

    const addImage = async (name) => {
      const response = await companionRequest(env, `/api/album/${albumId}/images`, {
        method: "POST", ...jsonBody({ path: `${folder}/artwork/${name}.jpg` }),
      });
      const body = await response.json();
      assert.equal(response.status, 200, body.error);
      return body.id;
    };
    const image1 = await addImage("one");
    const image2 = await addImage("two");
    const partialOrder = await companionRequest(
      env, `/api/album/${albumId}/images/reorder`, {
        method: "PUT", ...jsonBody({ ids: [image1] }),
      });
    assert.equal(partialOrder.status, 400);
    assert.equal((await companionRequest(
      env, `/api/album/${albumId}/images/reorder`, {
        method: "PUT", ...jsonBody({ ids: [image2, image1] }),
      })).status, 200);
    const image3 = await addImage("three");
    assert.deepEqual(db.prepare(
      "SELECT id FROM album_images WHERE album_id = ? ORDER BY sort, created_at")
      .all(albumId).map((row) => row.id), [image2, image1, image3]);

    const trackId = db.prepare(
      "SELECT id FROM tracks WHERE album_id = ? LIMIT 1").get(albumId).id;
    assert.equal((await companionRequest(
      env, `/api/album/${albumId}/tracks/${trackId}?file=1`, {
        method: "DELETE",
      })).status, 502);
    assert.ok(db.prepare("SELECT 1 FROM tracks WHERE id = ?").get(trackId));
    assert.equal((await companionRequest(
      env, `/api/album/${albumId}/images/${image3}?file=1`, {
        method: "DELETE",
      })).status, 502);
    assert.ok(db.prepare("SELECT 1 FROM album_images WHERE id = ?").get(image3));
    assert.equal((await companionRequest(
      env, `/api/album/${albumId}?files=1`, { method: "DELETE" })).status, 502);
    assert.ok(db.prepare("SELECT 1 FROM albums WHERE id = ?").get(albumId));

    db.prepare(`INSERT INTO source_posts (id, title, url, published, status, created_at)
      VALUES ('percent', '100% Pure', 'https://example.test/1', '', 'new', 1),
             ('plain', '100x Pure', 'https://example.test/2', '', 'new', 2)`).run();
    const search = await companionRequest(env, "/api/admin/source/posts?q=%25");
    assert.deepEqual((await search.json()).posts.map((post) => post.id), ["percent"]);

    const missingAvatarStorage = await companionRequest(env, "/api/artists", {
      method: "PUT",
      ...jsonBody({ name: "No Storage", avatarPath: `${folder}/avatar.jpg` }),
    });
    assert.equal(missingAvatarStorage.status, 400);
    assert.equal(db.prepare("SELECT 1 FROM artists WHERE name = 'No Storage'").get(), undefined);

    db.prepare(`INSERT INTO artists (name, avatar_path, storage_id)
      VALUES ('Avatar Artist', 'Music/Library/Avatar Artist/avatar.jpg', 'avatar-store')`).run();
    assert.equal((await companionRequest(env, "/api/admin/storages/avatar-store", {
      method: "DELETE",
    })).status, 400);

    assert.equal((await companionRequest(env, "/api/admin/storages/write-target", {
      method: "PUT", ...jsonBody({ id: "unused-store" }),
    })).status, 200);
    assert.equal((await companionRequest(env, "/api/admin/storages/unused-store", {
      method: "DELETE",
    })).status, 400);

    db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
      VALUES ('broken-config', 'Broken', 'webdav', '{', 0, 4)`).run();
    const storageList = await companionRequest(env, "/api/admin/storages");
    assert.equal(storageList.status, 200);
    assert.deepEqual((await storageList.json()).storages
      .find((storage) => storage.id === "broken-config").config, {});

    const imported = await companionRequest(env, "/api/admin/config/import", {
      method: "POST",
      ...jsonBody({ storages: [{
        id: "unused-store", name: "Unused", kind: "local",
        config: {}, isWrite: false, createdAt: 3,
      }] }),
    });
    assert.equal(imported.status, 200);
    assert.deepEqual(db.prepare(
      "SELECT id FROM storages WHERE is_write = 1 ORDER BY id").all(),
    [{ id: "main-store" }]);
    assert.equal((await companionRequest(env, "/api/admin/storages/unused-store", {
      method: "DELETE",
    })).status, 200);
  } finally {
    db.close();
  }
});

test("named storage creation chooses one write target and rejects URL credentials", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  const env = companionEnv(db);
  try {
    const create = async (name, kind, config) => companionRequest(
      env, "/api/admin/storages", {
        method: "POST", ...jsonBody({ name, kind, config }),
      });
    const first = await create("Local A", "local", { root: "C:/music-a" });
    const firstBody = await first.json();
    assert.equal(first.status, 200, firstBody.error);
    assert.equal(firstBody.isWrite, true);
    const second = await create("Local B", "local", { root: "C:/music-b" });
    const secondBody = await second.json();
    assert.equal(second.status, 200, secondBody.error);
    assert.equal(secondBody.isWrite, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM storages WHERE is_write = 1")
      .get().n, 1);
    const badUrl = await create("DAV", "webdav", {
      baseUrl: "https://user:password@dav.example/", username: "user", password: "password",
    });
    assert.equal(badUrl.status, 400);
  } finally {
    db.close();
  }
});

test("deleting a named storage clears provider credential caches", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('drive-cache', 'Drive', 'onedrive', ?, 0, 1),
           ('local-store', 'Local', 'local', '{}', 1, 2)`)
    .run(JSON.stringify({ clientId: "c", clientSecret: "s", refreshToken: "r", driveId: "d" }));
  const env = companionEnv(db);
  await env.KV.put("msT:drive-cache", "token");
  await env.KV.put("msR:drive-cache", "refresh");
  await env.KV.put("dl:drive-cache:Music/track.flac", "https://download.example/1");
  try {
    const response = await companionRequest(env, "/api/admin/storages/drive-cache", {
      method: "DELETE",
    });
    assert.equal(response.status, 200, await response.text());
    assert.equal(await env.KV.get("msT:drive-cache"), null);
    assert.equal(await env.KV.get("msR:drive-cache"), null);
    assert.equal(await env.KV.get("dl:drive-cache:Music/track.flac"), null);
  } finally {
    db.close();
  }
});

test("settings updates are atomic when one setting write fails", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.exec(`CREATE TRIGGER reject_stream_setting
    BEFORE INSERT ON settings WHEN NEW.k = 'stream_proxy'
    BEGIN SELECT RAISE(ABORT, 'reject stream setting'); END`);
  const env = companionEnv(db);
  try {
    const response = await companionRequest(env, "/api/admin/settings", {
      method: "PUT",
      ...jsonBody({ guestOpen: true, streamProxy: true }),
    });
    assert.equal(response.status, 500);
    assert.equal(db.prepare("SELECT 1 FROM settings WHERE k = 'guest_open'").get(), undefined);
    assert.equal(db.prepare("SELECT 1 FROM settings WHERE k = 'stream_proxy'").get(), undefined);
  } finally {
    db.close();
  }
});

test("legacy OneDrive migration never overwrites a colliding named storage", async () => {
  const db = new Database(":memory:");
  db.exec(schema.replace(
    "storage_id  TEXT NOT NULL,             -- 所属命名存储后端",
    "storage_id  TEXT,                       -- legacy unbound album"));
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('onedrive-12345678', 'Local collision', 'local', ?, 1, 1)`)
    .run(JSON.stringify({ root: "C:/music" }));
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('legacy-album', 'Artist', 'Album', 'Music/Library/Artist/Album', NULL, 1, 1)`)
    .run();
  const env = companionEnv(db, {
    MS_CLIENT_ID: "client", MS_CLIENT_SECRET: "secret",
    MS_REFRESH_TOKEN: "refresh", MS_DRIVE_ID: "drive-12345678",
  });
  try {
    const response = await companionRequest(env, "/api/library");
    assert.equal(response.status, 200);
    const old = db.prepare(
      "SELECT kind, config FROM storages WHERE id = 'onedrive-12345678'").get();
    assert.equal(old.kind, "local");
    assert.deepEqual(JSON.parse(old.config), { root: "C:/music" });
    const migrated = db.prepare(
      "SELECT id, kind, config FROM storages WHERE kind = 'onedrive'").get();
    assert.ok(migrated);
    assert.notEqual(migrated.id, "onedrive-12345678");
    assert.equal(JSON.parse(migrated.config).driveId, "drive-12345678");
    assert.equal(db.prepare(
      "SELECT storage_id FROM albums WHERE id = 'legacy-album'").get().storage_id,
    migrated.id);
  } finally {
    db.close();
  }
});

test("track and booklet mutations refresh the parent album timestamp", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('main', 'Main', 'local', '{}', 1, 1)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('album', 'Artist', 'Album', 'Music/Library/Artist/Album',
      'main', 1, 1)`).run();
  db.prepare(`INSERT INTO tracks (id, album_id, title, path)
    VALUES ('track', 'album', 'Track',
      'Music/Library/Artist/Album/01.flac')`).run();
  db.prepare(`INSERT INTO album_images (id, album_id, path, sort, created_at)
    VALUES ('first-image', 'album',
      'Music/Library/Artist/Album/first.jpg', 0, 1)`).run();
  const env = companionEnv(db);
  const reset = () => db.prepare(
    "UPDATE albums SET updated_at = 1 WHERE id = 'album'").run();
  const timestamp = () => db.prepare(
    "SELECT updated_at FROM albums WHERE id = 'album'").get().updated_at;

  try {
    reset();
    const added = await companionRequest(env, "/api/album/album/images", {
      method: "POST", ...jsonBody({
        path: "Music/Library/Artist/Album/second.jpg",
      }),
    });
    const secondImage = (await added.json()).id;
    assert.equal(added.status, 200);
    assert.ok(timestamp() > 1);

    reset();
    assert.equal((await companionRequest(env,
      "/api/album/album/images/reorder", {
        method: "PUT", ...jsonBody({ ids: [secondImage, "first-image"] }),
      })).status, 200);
    assert.ok(timestamp() > 1);

    reset();
    assert.equal((await companionRequest(env, "/api/album/album/tracks/track", {
      method: "PATCH", ...jsonBody({ title: "Renamed" }),
    })).status, 200);
    assert.ok(timestamp() > 1);

    reset();
    assert.equal((await companionRequest(env, "/api/album/album/tracks/track", {
      method: "DELETE",
    })).status, 200);
    assert.ok(timestamp() > 1);

    reset();
    assert.equal((await companionRequest(
      env, `/api/album/album/images/${secondImage}`, {
        method: "DELETE",
      })).status, 200);
    assert.ok(timestamp() > 1);
  } finally {
    db.close();
  }
});

test("damaged settings and invalid config imports fail without partial writes", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('used', 'Used', 'local', '{}', 1, 1)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('album', 'Artist', 'Album', 'Music/Library/Artist/Album',
      'used', 1, 1)`).run();
  db.prepare("INSERT INTO settings (k, v) VALUES ('archive_passwords', '{')").run();
  const env = companionEnv(db);
  try {
    const adminSettings = await companionRequest(env, "/api/admin/settings");
    assert.equal(adminSettings.status, 200);
    assert.deepEqual((await adminSettings.json()).archivePasswords, []);
    const companionSettings = await companionRequest(env, "/api/companion/settings");
    assert.equal(companionSettings.status, 200);
    assert.deepEqual((await companionSettings.json()).archivePasswords, []);

    const invalidBoolean = await companionRequest(env, "/api/admin/config/import", {
      method: "POST",
      ...jsonBody({
        settings: { r2_enabled: "yes", discogs_token: "must-not-write" },
      }),
    });
    assert.equal(invalidBoolean.status, 400);
    assert.equal(db.prepare(
      "SELECT 1 FROM settings WHERE k = 'discogs_token'").get(), undefined);

    const duplicateIds = await companionRequest(env, "/api/admin/config/import", {
      method: "POST",
      ...jsonBody({ storages: [
        { id: "dup", name: "One", kind: "local", config: {} },
        { id: "dup", name: "Two", kind: "webdav", config: {} },
      ] }),
    });
    assert.equal(duplicateIds.status, 400);
    assert.equal(db.prepare("SELECT 1 FROM storages WHERE id = 'dup'").get(), undefined);

    const changeUsedKind = await companionRequest(env, "/api/admin/config/import", {
      method: "POST",
      ...jsonBody({ storages: [
        { id: "used", name: "Used", kind: "webdav", config: {} },
      ] }),
    });
    assert.equal(changeUsedKind.status, 409);
    assert.equal(db.prepare("SELECT kind FROM storages WHERE id = 'used'")
      .get().kind, "local");

    const invalidProviderConfig = await companionRequest(
      env, "/api/admin/config/import", {
        method: "POST",
        ...jsonBody({ storages: [{
          id: "bad-config", name: "Bad", kind: "local",
          config: { root: { nested: true } },
        }] }),
      });
    assert.equal(invalidProviderConfig.status, 400);
    assert.equal(db.prepare(
      "SELECT 1 FROM storages WHERE id = 'bad-config'").get(), undefined);

    const tooMany = Array.from({ length: 65 }, (_, index) => ({
      id: `store-${index}`, name: `Store ${index}`, kind: "local",
      config: { root: `C:/music/${index}` },
    }));
    assert.equal((await companionRequest(env, "/api/admin/config/import", {
      method: "POST", ...jsonBody({ storages: tooMany }),
    })).status, 400);

    db.exec(`CREATE TRIGGER reject_import BEFORE INSERT ON storages
      WHEN NEW.id = 'reject-me'
      BEGIN SELECT RAISE(ABORT, 'forced import failure'); END`);
    const priorConsoleError = console.error;
    let atomicFailure;
    try {
      console.error = () => {};
      atomicFailure = await companionRequest(env, "/api/admin/config/import", {
        method: "POST",
        ...jsonBody({
          settings: { discogs_token: "must-roll-back" },
          storages: [
            { id: "first-write", name: "First", kind: "local", config: {} },
            { id: "reject-me", name: "Reject", kind: "local", config: {} },
          ],
        }),
      });
    } finally {
      console.error = priorConsoleError;
    }
    assert.equal(atomicFailure.status, 500);
    assert.equal(db.prepare(
      "SELECT 1 FROM settings WHERE k = 'discogs_token'").get(), undefined);
    assert.equal(db.prepare(
      "SELECT 1 FROM storages WHERE id IN ('first-write', 'reject-me')").get(), undefined);
  } finally {
    db.close();
  }
});

test("image size inputs are strict and temporary cloud redirects are not cached", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  const folder = "Music/Library/Artist/Album";
  const trackPath = `${folder}/01.mp3`;
  const imagePath = `${folder}/booklet.jpg`;
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('media', 'Media', 'onedrive', ?, 1, 1)`).run(JSON.stringify({
    clientId: "client", clientSecret: "secret", refreshToken: "refresh",
    driveId: "drive",
  }));
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('album', 'Artist', 'Album', ?, 'media', 1, 1)`).run(folder);
  db.prepare(`INSERT INTO tracks (id, album_id, title, path)
    VALUES ('track', 'album', 'Track', ?)`).run(trackPath);
  db.prepare(`INSERT INTO album_images (id, album_id, path, sort, created_at)
    VALUES ('image', 'album', ?, 0, 1)`).run(imagePath);
  const env = companionEnv(db);
  await env.KV.put(`dl:media:${trackPath}`, "https://media.example.test/track?sig=one");
  await env.KV.put(`dl:media:${imagePath}`, "https://media.example.test/image?sig=two");

  try {
    for (const query of ["abc", "-1", "1.5", "10001"]) {
      assert.equal((await companionRequest(
        env, `/api/image/image?s=${encodeURIComponent(query)}`)).status, 400);
    }
    assert.equal((await companionRequest(env, "/api/art/album?s=0")).status, 400);

    const image = await companionRequest(env, "/api/image/image");
    assert.equal(image.status, 302);
    assert.equal(image.headers.get("location"), "https://media.example.test/image?sig=two");
    assert.equal(image.headers.get("cache-control"), "private, no-store");
    assert.equal(image.headers.get("referrer-policy"), "no-referrer");

    const audio = await companionRequest(env, "/api/stream/track");
    assert.equal(audio.status, 302);
    assert.equal(audio.headers.get("location"), "https://media.example.test/track?sig=one");
    assert.equal(audio.headers.get("cache-control"), "private, no-store");
  } finally {
    db.close();
  }
});

test("R2 image redirects carry the stable mirror version and cache publicly", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('media', 'Media', 'local', '{}', 1, 1)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, cover_path, storage_id, created_at, updated_at)
    VALUES ('album', 'Artist', 'Album', 'Music/Library/Artist/Album',
      'Music/Library/Artist/Album/cover.jpg', 'media', 1, 1)`).run();
  db.prepare("INSERT INTO settings (k, v) VALUES ('r2_enabled', '1')").run();
  db.prepare(`INSERT INTO r2_cache (cache_key, r2_key, created_at, cache_policy)
    VALUES ('art:album:original', 'img/art_album_original.jpg', 123456, 1)`).run();
  const env = companionEnv(db, {
    R2_ACCESS_KEY: "access",
    R2_SECRET_KEY: "secret",
    R2_ENDPOINT: "https://r2.example",
    R2_BUCKET: "bucket",
    R2_PUBLIC_URL: "https://cdn.example",
  });
  try {
    const card = await companionRequest(env, "/api/art/album?s=480");
    const detail = await companionRequest(env, "/api/art/album?s=1000");
    assert.equal(card.status, 302);
    assert.equal(detail.status, 302);
    assert.equal(card.headers.get("location"),
      "https://cdn.example/img/art_album_original.jpg?v=123456");
    assert.equal(card.headers.get("location"), detail.headers.get("location"));
    assert.equal(card.headers.get("cache-control"),
      "public, max-age=300, stale-while-revalidate=86400");
  } finally {
    db.close();
  }
});

test("default artist art reuses the earliest visible album R2 mirror", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('media', 'Media', 'local', '{}', 1, 1)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, cover_path, storage_id, hidden, year,
      created_at, updated_at)
    VALUES
      ('hidden', 'Artist', 'Hidden', 'Music/Library/Artist/Hidden',
        'Music/Library/Artist/Hidden/cover.jpg', 'media', 1, 1990, 1, 1),
      ('visible', 'Artist', 'Visible', 'Music/Library/Artist/Visible',
        'Music/Library/Artist/Visible/cover.jpg', 'media', 0, 2000, 2, 2)`)
    .run();
  db.prepare("INSERT INTO settings (k, v) VALUES ('r2_enabled', '1')").run();
  db.prepare(`INSERT INTO r2_cache (cache_key, r2_key, created_at, cache_policy)
    VALUES
      ('art:hidden:original', 'img/art_hidden_original.jpg', 111, 1),
      ('art:visible:original', 'img/art_visible_original.jpg', 222, 1)`)
    .run();
  const env = companionEnv(db, {
    R2_ACCESS_KEY: "access",
    R2_SECRET_KEY: "secret",
    R2_ENDPOINT: "https://r2.example",
    R2_BUCKET: "bucket",
    R2_PUBLIC_URL: "https://cdn.example",
  });
  try {
    const response = await companionRequest(env, "/api/artist-art/Artist");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"),
      "https://cdn.example/img/art_visible_original.jpg?v=222");
    assert.equal(response.headers.get("cache-control"),
      "public, max-age=300, stale-while-revalidate=86400");
  } finally {
    db.close();
  }
});

test("a successful cover fallback repairs a missing public R2 mirror", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00]);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('media', 'Media', 'local', '{}', 1, 1)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, cover_path, storage_id, created_at, updated_at)
    VALUES ('album', 'Artist', 'Album', 'Music/Library/Artist/Album',
      'Music/Library/Artist/Album/cover.jpg', 'media', 1, 1)`).run();
  db.prepare("INSERT INTO settings (k, v) VALUES ('r2_enabled', '1')").run();
  db.prepare(`INSERT INTO r2_cache (cache_key, r2_key, created_at)
    VALUES ('art:album:original', 'img/stale.jpg', 1)`).run();
  const env = companionEnv(db, {
    R2_ACCESS_KEY: "access",
    R2_SECRET_KEY: "secret",
    R2_ENDPOINT: "https://r2.example",
    R2_BUCKET: "bucket",
    R2_PUBLIC_URL: "https://cdn.example",
    LOCAL_FS: {
      async thumbnailUrl() { return null; },
      async downloadUrl() { return null; },
      async getFile() {
        return new Response(jpeg, { headers: { "Content-Type": "image/jpeg" } });
      },
    },
  });
  const realFetch = globalThis.fetch;
  let uploaded = null;
  globalThis.fetch = async (input, init = {}) => {
    if (init.method === "PUT" && String(input).startsWith("https://r2.example/")) {
      uploaded = new Uint8Array(init.body);
      return new Response(null, { status: 200 });
    }
    throw new Error(`unexpected request ${init.method || "GET"} ${input}`);
  };

  try {
    const response = await companionRequest(
      env, "/api/art/album?s=1000&proxy=1&fallback=1");
    assert.equal(response.status, 200, await response.text());
    assert.deepEqual(uploaded, jpeg);
    const row = db.prepare(`SELECT r2_key, created_at FROM r2_cache
      WHERE cache_key = 'art:album:original'`).get();
    assert.equal(row.r2_key, "img/art_album_original.jpg");
    assert.ok(row.created_at > 1);
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});

test("hidden images never enter the shared edge cache", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  const folder = "Music/Library/Hidden/Album";
  const cover = `${folder}/cover.jpg`;
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('private-media', 'Private', 'local', '{}', 1, 1)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, cover_path, storage_id, hidden, created_at, updated_at)
    VALUES ('hidden-album', 'Hidden', 'Album', ?, ?, 'private-media', 1, 1, 1)`)
    .run(folder, cover);
  const env = companionEnv(db, {
    LOCAL_FS: {
      async thumbnailUrl() { return null; },
      async downloadUrl() { return null; },
      async getFile() {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00]), {
          headers: { "Content-Type": "image/jpeg" },
        });
      },
    },
  });
  const previousCaches = globalThis.caches;
  let matches = 0;
  let puts = 0;
  globalThis.caches = { default: {
    async match() { matches++; return null; },
    async put() { puts++; },
  } };

  try {
    const response = await companionRequest(env, "/api/art/hidden-album?s=480");
    assert.equal(response.status, 200, await response.text());
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(matches, 0);
    assert.equal(puts, 0);
  } finally {
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
    db.close();
  }
});

test("Discogs image import never records a cover that failed to upload", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  const folder = "Music/Library/Artist/Album";
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('discogs-store', 'Discogs', 'local', '{}', 1, 1)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, cover_path, storage_id, created_at, updated_at)
    VALUES ('discogs-album', 'Artist', 'Album', ?, '', 'discogs-store', 1, 1)`)
    .run(folder);
  db.prepare("INSERT INTO settings (k, v) VALUES ('discogs_token', 'token')").run();
  const writes = [];
  const env = companionEnv(db, {
    LOCAL_FS: {
      async putSmallFile(_config, path) {
        writes.push(path);
        return !/\/cover\.[^.]+$/i.test(path);
      },
    },
  });
  const realFetch = globalThis.fetch;
  const imageUrl = "https://img.discogs.com/example.jpg";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.discogs.com/releases/1?")) {
      return Response.json({ images: [{ type: "primary", uri: imageUrl }] });
    }
    if (url === imageUrl) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00]));
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const response = await companionRequest(
      env, "/api/album/discogs-album/discogs-import-images", {
        method: "POST",
        ...jsonBody({ ref: "1", uris: [imageUrl], asCover: true }),
      });
    const body = await response.json();
    assert.equal(response.status, 200, body.error);
    assert.equal(body.imported, 1);
    assert.equal(body.coverSet, false);
    assert.equal(body.coverFailed, true);
    assert.equal(db.prepare(
      "SELECT cover_path FROM albums WHERE id = 'discogs-album'").get().cover_path, "");
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS n FROM album_images WHERE album_id = 'discogs-album'").get().n, 1);
    assert.ok(db.prepare(
      "SELECT updated_at FROM albums WHERE id = 'discogs-album'").get().updated_at > 1);
    assert.equal(writes.filter((path) => path.includes("/artwork/")).length, 1);
    assert.equal(writes.filter((path) => /\/cover\.[^.]+$/i.test(path)).length, 1);
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});

test("Discogs crop source proxies only images belonging to the selected release", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('discogs-store', 'Discogs', 'local', '{}', 1, 1)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('discogs-crop', 'Artist', 'Album',
      'Music/Library/Artist/Album', 'discogs-store', 1, 1)`).run();
  db.prepare("INSERT INTO settings (k, v) VALUES ('discogs_token', 'token')").run();
  const env = companionEnv(db);
  const imageUrl = "https://img.discogs.com/allowed.jpg";
  const realFetch = globalThis.fetch;
  let imageFetches = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("https://api.discogs.com/releases/1?")) {
      return Response.json({ images: [{ type: "primary", uri: imageUrl }] });
    }
    if (url === imageUrl) {
      imageFetches += 1;
      assert.equal(init.headers.Referer, "https://www.discogs.com/");
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00]));
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const response = await companionRequest(
      env, "/api/album/discogs-crop/discogs-image-source", {
        method: "POST", ...jsonBody({ ref: "1", uri: imageUrl }),
      });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),
      new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00]));
    assert.equal(imageFetches, 1);

    const rejected = await companionRequest(
      env, "/api/album/discogs-crop/discogs-image-source", {
        method: "POST",
        ...jsonBody({ ref: "1", uri: "https://img.discogs.com/not-listed.jpg" }),
      });
    assert.equal(rejected.status, 400);
    assert.equal(imageFetches, 1);
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});

test("API input validation rejects corrupt metadata and preserves prior state", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('main', 'Main', 'local', '{}', 1, 1),
           ('other', 'Other', 'local', '{}', 0, 2)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, artist_sort, title, folder, storage_id, created_at, updated_at)
    VALUES ('album', 'Artist', 'Artist', 'Original',
      'Music/Library/Artist/Original', 'main', 1, 1)`).run();
  db.prepare(`INSERT INTO settings (k, v) VALUES
    ('discogs_token', 'token'), ('r2_enabled', '1')`).run();
  const env = companionEnv(db, {
    R2_ACCESS_KEY: "access",
    R2_SECRET_KEY: "secret",
    R2_ENDPOINT: "https://r2.example",
    R2_BUCKET: "bucket",
    R2_PUBLIC_URL: "https://cdn.example",
  });

  try {
    const partialPatch = await companionRequest(env, "/api/album/album", {
      method: "PATCH",
      ...jsonBody({ title: "Must not persist", note: { invalid: true } }),
    });
    assert.equal(partialPatch.status, 400);
    assert.equal(db.prepare("SELECT title FROM albums WHERE id = 'album'")
      .get().title, "Original");

    const renamed = await companionRequest(env, "/api/album/album", {
      method: "PATCH", ...jsonBody({ artist: "Renamed Artist" }),
    });
    assert.equal(renamed.status, 200);
    assert.deepEqual(db.prepare(
      "SELECT artist, artist_sort FROM albums WHERE id = 'album'").get(), {
      artist: "Renamed Artist", artist_sort: "Renamed Artist",
    });
    db.prepare("UPDATE albums SET artist = 'Artist', artist_sort = 'Artist' WHERE id = 'album'")
      .run();

    const invalidTrack = await companionRequest(env, "/api/album/album/tracks", {
      method: "POST",
      ...jsonBody({
        path: "Music/Library/Artist/Original/bad.flac",
        title: "Bad", duration: -1,
      }),
    });
    assert.equal(invalidTrack.status, 400);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tracks").get().n, 0);

    const invalidRym = await companionRequest(env, "/api/album/album/rym", {
      method: "POST", ...jsonBody({ rating: 6, votes: 10 }),
    });
    assert.equal(invalidRym.status, 400);
    assert.equal(db.prepare("SELECT rym_rating FROM albums WHERE id = 'album'")
      .get().rym_rating, null);

    const missingHidden = await companionRequest(env, "/api/album/album/hide", {
      method: "POST", ...jsonBody({}),
    });
    assert.equal(missingHidden.status, 400);
    assert.equal(db.prepare("SELECT hidden FROM albums WHERE id = 'album'")
      .get().hidden, 0);

    const invalidR2 = await companionRequest(env, "/api/admin/r2", {
      method: "PUT", ...jsonBody({ enabled: "false" }),
    });
    assert.equal(invalidR2.status, 400);
    assert.equal(db.prepare("SELECT v FROM settings WHERE k = 'r2_enabled'")
      .get().v, "1");

    const invalidPrewarm = await companionRequest(env, "/api/admin/r2/prewarm", {
      method: "POST", ...jsonBody({ offset: 0, limit: -1 }),
    });
    assert.equal(invalidPrewarm.status, 400);

    const missingTarget = await companionRequest(
      env, "/api/admin/storages/write-target", {
        method: "PUT", ...jsonBody({ id: "missing" }),
      });
    assert.equal(missingTarget.status, 404);
    assert.equal(db.prepare("SELECT id FROM storages WHERE is_write = 1")
      .get().id, "main");

    db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
      VALUES ('cloud', 'Cloud', 'onedrive', ?, 0, 3)`).run(JSON.stringify({
      clientId: "client", clientSecret: "secret", refreshToken: "refresh",
      driveId: "old-drive",
    }));
    await env.KV.put("msT:cloud", "cached-token");
    await env.KV.put("msR:cloud", "rotated-refresh");
    await env.KV.put("dl:old-drive:Music/Library/A/01.flac", "cached-url");
    const changedStorage = await companionRequest(env,
      "/api/admin/storages/cloud", {
        method: "PUT", ...jsonBody({ config: { driveId: "new-drive" } }),
      });
    assert.equal(changedStorage.status, 200);
    assert.equal(await env.KV.get("msT:cloud"), null);
    assert.equal(await env.KV.get("msR:cloud"), null);
    assert.equal(await env.KV.get("dl:old-drive:Music/Library/A/01.flac"), null);

    assert.equal((await companionRequest(env, "/api/admin/storages/test", {
      method: "POST", ...jsonBody({ kind: "unknown", config: {} }),
    })).status, 400);
    assert.equal((await companionRequest(env, "/api/admin/source/posts?limit=-1"))
      .status, 400);

    const badDiscogsHost = await companionRequest(env, "/api/discogs-lookup", {
      method: "POST",
      ...jsonBody({ url: "https://discogs.com.evil.example/release/123" }),
    });
    assert.equal(badDiscogsHost.status, 400);
    const badAvatarSource = await companionRequest(
      env, "/api/artists/Artist/discogs-import", {
        method: "POST",
        ...jsonBody({
          avatarUri: "http://127.0.0.1/private",
          profile: "", setAvatar: true, setBio: false,
        }),
      });
    assert.equal(badAvatarSource.status, 400);
  } finally {
    db.close();
  }
});

test("local storage migration streams files instead of buffering them", async (t) => {
  const db = new Database(":memory:");
  db.exec(schema);
  const temp = mkdtempSync(join(tmpdir(), "mihonban-migrate-stream-"));
  const sourceRoot = join(temp, "source");
  const targetRoot = join(temp, "target");
  const sourceAlbum = join(sourceRoot, "Artist", "Album");
  mkdirSync(join(sourceAlbum, "scans"), { recursive: true });
  mkdirSync(targetRoot, { recursive: true });
  const content = Buffer.from("stream-me-between-storage-backends");
  writeFileSync(join(sourceAlbum, "track.flac"), content);
  writeFileSync(join(sourceAlbum, "scans", "page.jpg"), "nested-artwork");
  t.after(() => {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  });

  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('source', 'Source', 'local', ?, 1, 1),
           ('target', 'Target', 'local', ?, 0, 2)`)
    .run(JSON.stringify({ root: sourceRoot, odRoot: "Music/Library" }),
      JSON.stringify({ root: targetRoot, odRoot: "Music/Library" }));
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('album', 'Artist', 'Album', 'Music/Library/Artist/Album',
      'source', 1, 1)`).run();
  db.prepare(`INSERT INTO tracks
    (id, album_id, title, path, size)
    VALUES ('track', 'album', 'Track',
      'Music/Library/Artist/Album/track.flac', ?)`)
    .run(content.length);

  let streamWrites = 0;
  const streamingFs = {
    ...localFs,
    async putFile(...args) {
      streamWrites += 1;
      return localFs.putFile(...args);
    },
    async putSmallFile() {
      throw new Error("migration must not buffer into putSmallFile");
    },
  };
  const env = companionEnv(db, { LOCAL_FS: streamingFs });
  const first = await companionRequest(env, "/api/admin/storages/migrate", {
    method: "POST",
    ...jsonBody({ albumId: "album", targetId: "target", fileIndex: 0 }),
  });
  const firstBody = await first.json();
  assert.equal(first.status, 200, firstBody.error);
  assert.equal(firstBody.fileIndex, 1);
  assert.equal(firstBody.bytes, content.length);
  assert.equal(streamWrites, 1);
  assert.deepEqual(readFileSync(join(targetRoot, "Artist", "Album", "track.flac")),
    content);

  let fileIndex = firstBody.fileIndex;
  for (;;) {
    const response = await companionRequest(env, "/api/admin/storages/migrate", {
      method: "POST",
      ...jsonBody({ albumId: "album", targetId: "target", fileIndex }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, body.error);
    if (body.finished) break;
    fileIndex = body.fileIndex;
  }
  assert.equal(streamWrites, 2);
  assert.equal(readFileSync(join(targetRoot, "Artist", "Album", "scans", "page.jpg"),
    "utf8"), "nested-artwork");
  assert.equal(db.prepare("SELECT storage_id FROM albums WHERE id = 'album'")
    .get().storage_id, "target");
});

test("migration refuses missing source folders and out-of-range progress", async (t) => {
  const db = new Database(":memory:");
  db.exec(schema);
  const temp = mkdtempSync(join(tmpdir(), "mihonban-migrate-guard-"));
  const sourceRoot = join(temp, "source");
  const targetRoot = join(temp, "target");
  mkdirSync(join(sourceRoot, "Artist", "Present"), { recursive: true });
  mkdirSync(targetRoot, { recursive: true });
  writeFileSync(join(sourceRoot, "Artist", "Present", "track.flac"), "audio");
  t.after(() => {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  });
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('source', 'Source', 'local', ?, 1, 1),
           ('target', 'Target', 'local', ?, 0, 2)`)
    .run(JSON.stringify({ root: sourceRoot, odRoot: "Music/Library" }),
      JSON.stringify({ root: targetRoot, odRoot: "Music/Library" }));
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('present', 'Artist', 'Present',
      'Music/Library/Artist/Present', 'source', 1, 1),
           ('missing', 'Artist', 'Missing',
      'Music/Library/Artist/Missing', 'source', 2, 2)`).run();
  const env = companionEnv(db, { LOCAL_FS: localFs });

  const skipped = await companionRequest(env, "/api/admin/storages/migrate", {
    method: "POST",
    ...jsonBody({ albumId: "present", targetId: "target", fileIndex: 999 }),
  });
  assert.equal(skipped.status, 400);
  assert.equal(db.prepare("SELECT storage_id FROM albums WHERE id = 'present'")
    .get().storage_id, "source");

  const missing = await companionRequest(env, "/api/admin/storages/migrate", {
    method: "POST",
    ...jsonBody({ albumId: "missing", targetId: "target", fileIndex: 0 }),
  });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /无法列出源音盤目录/);
  assert.equal(db.prepare("SELECT storage_id FROM albums WHERE id = 'missing'")
    .get().storage_id, "source");
});

test("cloud rescan follows the album storage and preserves admin-cookie auth", async (t) => {
  const db = new Database(":memory:");
  db.exec(schema);
  const temp = mkdtempSync(join(tmpdir(), "mihonban-rescan-storage-"));
  const albumRoot = join(temp, "album");
  const writeRoot = join(temp, "write");
  mkdirSync(join(albumRoot, "Artist", "Album"), { recursive: true });
  mkdirSync(writeRoot, { recursive: true });
  writeFileSync(join(albumRoot, "Artist", "Album", "01. Song.flac"), "audio");
  t.after(() => {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  });
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('album-store', 'Album', 'local', ?, 0, 1),
           ('write-store', 'Write', 'local', ?, 1, 2)`)
    .run(JSON.stringify({ root: albumRoot, odRoot: "Music/Library" }),
      JSON.stringify({ root: writeRoot, odRoot: "Music/Library" }));
  db.prepare(`INSERT INTO albums
    (id, artist, artist_sort, title, folder, storage_id, created_at, updated_at)
    VALUES ('025306f4cbcef733', 'Artist', 'Artist', 'Album',
      'Music/Library/Artist/Album', 'album-store', 1, 1)`).run();
  const env = {
    DB: d1FromSqlite(db), KV: kvFromSqlite(db), LOCAL_FS: localFs,
    ADMIN_PASSWORD: "admin-password",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    DEV_INSECURE_COOKIE: "1", OD_ROOT: "Music/Library",
  };
  const request = (url, init = {}) => worker.fetch(
    new Request(`http://mihonban.test${url}`, init), env);
  const login = await request("/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "admin-password" }),
  });
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const scan = await request("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ folder: "Music/Library/Artist/Album" }),
  });
  const scanBody = await scan.json();
  assert.equal(scan.status, 200, scanBody.error);
  assert.equal(db.prepare("SELECT title FROM tracks WHERE album_id = '025306f4cbcef733'")
    .get().title, "Song");
  assert.equal(db.prepare("SELECT storage_id FROM albums WHERE id = '025306f4cbcef733'")
    .get().storage_id, "album-store");

  const invalid = await request("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      folder: "Music/Library/Artist/Album", title: { invalid: true },
    }),
  });
  assert.equal(invalid.status, 400);
});

test("bulk migration does not skip albums as the remaining list shrinks", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('source', 'Source', 'local', '{}', 1, 1),
           ('target', 'Target', 'local', '{}', 0, 2)`).run();
  for (const [index, id] of ["a", "b", "c"].entries()) {
    db.prepare(`INSERT INTO albums
      (id, artist, title, folder, storage_id, created_at, updated_at)
      VALUES (?, 'Artist', ?, ?, 'source', ?, ?)`)
      .run(id, id.toUpperCase(), `Music/Library/Artist/${id}`, index + 1, index + 1);
  }
  const emptyLocal = {
    ...localFs,
    async listChildren() { return []; },
  };
  const env = companionEnv(db, { LOCAL_FS: emptyLocal });
  try {
    let albumOffset = 0;
    const completed = [];
    for (;;) {
      const response = await companionRequest(env, "/api/admin/storages/migrate-all", {
        method: "POST",
        ...jsonBody({ targetId: "target", albumOffset, fileIndex: 0 }),
      });
      const body = await response.json();
      assert.equal(response.status, 200, body.error);
      if (body.albumFinished) completed.push(body.albumId);
      albumOffset = body.albumOffset;
      if (body.finished) break;
    }
    assert.deepEqual(completed, ["a", "b", "c"]);
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS n FROM albums WHERE storage_id = 'target'").get().n, 3);
  } finally {
    db.close();
  }
});

test("album registration stages large box sets within D1 batch limits", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('store', 'Store', 'local', '{}', 1, 1)`).run();
  const base = d1FromSqlite(db);
  const batchSizes = [];
  const guarded = {
    ...base,
    async batch(statements) {
      batchSizes.push(statements.length);
      assert.ok(statements.length <= 80);
      return base.batch(statements);
    },
  };
  const env = companionEnv(db, { DB: guarded });
  const folder = "Music/Library/Artist/Box Set";
  const tracks = Array.from({ length: 130 }, (_, index) => ({
    path: `${folder}/${String(index + 1).padStart(3, "0")}.flac`,
    title: `Track ${index + 1}`, track: index + 1,
  }));
  try {
    const response = await companionRequest(env, "/api/albums", {
      method: "POST", ...jsonBody({ folder, artist: "Artist", title: "Box Set", tracks }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, body.error);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tracks").get().n, 130);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM track_imports").get().n, 0);
    assert.ok(batchSizes.some((size) => size === 80));
    assert.ok(batchSizes.some((size) => size <= 52));
  } finally {
    db.close();
  }
});

test("album registration atomically preserves the previous catalog on failure", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('store', 'Store', 'local', '{}', 1, 1)`).run();
  const env = companionEnv(db);
  const folder = "Music/Library/Artist/Atomic Album";
  const pathOne = `${folder}/01.flac`;
  const pathTwo = `${folder}/02.flac`;
  try {
    const initial = await companionRequest(env, "/api/albums", {
      method: "POST",
      ...jsonBody({
        folder, artist: "Artist", title: "Before",
        tracks: [
          { path: pathOne, title: "Old One", track: 1 },
          { path: pathTwo, title: "Old Two", track: 2 },
        ],
      }),
    });
    assert.equal(initial.status, 200, (await initial.json()).error);
    const oldTracks = db.prepare(
      "SELECT id, path FROM tracks ORDER BY path").all();
    for (const [index, track] of oldTracks.entries()) {
      db.prepare(`INSERT INTO favorites
        (kind, item_id, created_at, sort_order) VALUES ('track', ?, ?, ?)`)
        .run(track.id, index + 1, index);
    }

    db.exec(`CREATE TRIGGER reject_atomic_album
      BEFORE INSERT ON tracks WHEN NEW.title = 'Reject'
      BEGIN SELECT RAISE(ABORT, 'reject atomic album'); END`);
    const failed = await companionRequest(env, "/api/albums", {
      method: "POST",
      ...jsonBody({
        folder, artist: "Artist", title: "After",
        tracks: [
          { path: pathOne, title: "Changed", track: 1 },
          { path: `${folder}/03.flac`, title: "Reject", track: 3 },
        ],
      }),
    });
    assert.equal(failed.status, 500);
    assert.equal(db.prepare(
      "SELECT title FROM albums WHERE folder = ?").get(folder).title, "Before");
    assert.deepEqual(db.prepare(
      "SELECT path, title FROM tracks ORDER BY path").all(), [
      { path: pathOne, title: "Old One" },
      { path: pathTwo, title: "Old Two" },
    ]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM favorites").get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM track_imports").get().n, 0);

    db.exec("DROP TRIGGER reject_atomic_album");
    const replaced = await companionRequest(env, "/api/albums", {
      method: "POST",
      ...jsonBody({
        folder, artist: "Artist", title: "After",
        tracks: [{ path: pathOne, title: "Changed", track: 1 }],
      }),
    });
    assert.equal(replaced.status, 200, (await replaced.json()).error);
    assert.deepEqual(db.prepare(
      "SELECT path, title FROM tracks ORDER BY path").all(), [
      { path: pathOne, title: "Changed" },
    ]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM favorites").get().n, 1);
  } finally {
    db.close();
  }
});

test("large reorder operations never leave partially updated positions", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('store', 'Store', 'local', '{}', 1, 1)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('album', 'Artist', 'Album', 'Music/Library/Artist/Album',
      'store', 1, 1)`).run();
  const ids = Array.from({ length: 130 }, (_, index) =>
    `item-${String(index).padStart(3, "0")}`);
  const insertFavorite = db.prepare(`INSERT INTO favorites
    (kind, item_id, created_at, sort_order) VALUES ('album', ?, ?, ?)`);
  const insertImage = db.prepare(`INSERT INTO album_images
    (id, album_id, path, sort, created_at) VALUES (?, 'album', ?, ?, ?)`);
  const insertTrack = db.prepare(`INSERT INTO tracks
    (id, album_id, disc, track, title, path)
    VALUES (?, 'album', 2, ?, ?, ?)`);
  for (const [index, id] of ids.entries()) {
    insertFavorite.run(id, index + 1, index);
    insertImage.run(id, `Music/Library/Artist/Album/${id}.jpg`, index, index + 1);
    insertTrack.run(id, index + 1, id,
      `Music/Library/Artist/Album/${id}.flac`);
  }
  const env = companionEnv(db);
  const reversed = [...ids].reverse();
  try {
    db.exec(`CREATE TRIGGER reject_favorite_reorder
      BEFORE UPDATE ON favorites WHEN NEW.sort_order = 100
      BEGIN SELECT RAISE(ABORT, 'reject favorite reorder'); END`);
    const favoriteResponse = await companionRequest(
      env, "/api/favorites/album/reorder", {
        method: "PUT", ...jsonBody({ ids: reversed }),
      });
    assert.equal(favoriteResponse.status, 500);
    assert.deepEqual(db.prepare(
      "SELECT item_id, sort_order FROM favorites ORDER BY item_id").all(),
    ids.map((id, index) => ({ item_id: id, sort_order: index })));

    db.exec(`CREATE TRIGGER reject_image_reorder
      BEFORE UPDATE ON album_images WHEN NEW.sort = 100
      BEGIN SELECT RAISE(ABORT, 'reject image reorder'); END`);
    const imageResponse = await companionRequest(
      env, "/api/album/album/images/reorder", {
        method: "PUT", ...jsonBody({ ids: reversed }),
      });
    assert.equal(imageResponse.status, 500);
    assert.deepEqual(db.prepare(
      "SELECT id, sort FROM album_images ORDER BY id").all(),
    ids.map((id, index) => ({ id, sort: index })));
    assert.equal(db.prepare(
      "SELECT updated_at FROM albums WHERE id = 'album'").get().updated_at, 1);

    db.exec(`CREATE TRIGGER reject_track_reorder
      BEFORE UPDATE ON tracks WHEN NEW.track = 100
      BEGIN SELECT RAISE(ABORT, 'reject track reorder'); END`);
    const trackResponse = await companionRequest(
      env, "/api/album/album/tracks/order", {
        method: "PUT", ...jsonBody({ ids: reversed }),
      });
    assert.equal(trackResponse.status, 500);
    assert.deepEqual(db.prepare(
      "SELECT id, disc, track FROM tracks ORDER BY id").all(),
    ids.map((id, index) => ({ id, disc: 2, track: index + 1 })));
    assert.equal(db.prepare(
      "SELECT updated_at FROM albums WHERE id = 'album'").get().updated_at, 1);
  } finally {
    db.close();
  }
});

test("changing the listener password revokes previously issued sessions", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  const env = companionEnv(db, {
    APP_PASSWORD: "old-listener",
    ADMIN_PASSWORD: "admin-password",
    DEV_INSECURE_COOKIE: "1",
  });
  const request = (url, init = {}) => worker.fetch(
    new Request(`http://mihonban.test${url}`, init), env);

  try {
    const login = await request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "old-listener" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";", 1)[0];

    const changed = await companionRequest(env, "/api/admin/password", {
      method: "POST",
      ...jsonBody({ target: "user", current: "admin-password", next: "new-listener" }),
    });
    assert.equal(changed.status, 200);
    const stale = await request("/api/library", { headers: { Cookie: cookie } });
    assert.equal(stale.status, 401);
    const replacement = await request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "new-listener" }),
    });
    assert.equal(replacement.status, 200);
  } finally {
    db.close();
  }
});

test("password and session revocation commit atomically", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.exec(`CREATE TRIGGER reject_session_epoch
    BEFORE INSERT ON settings WHEN NEW.k = 'session_epoch'
    BEGIN SELECT RAISE(ABORT, 'reject session epoch'); END`);
  const env = companionEnv(db, {
    APP_PASSWORD: "old-listener",
    ADMIN_PASSWORD: "admin-password",
  });
  try {
    const changed = await companionRequest(env, "/api/admin/password", {
      method: "POST",
      ...jsonBody({
        target: "user", current: "admin-password", next: "new-listener",
      }),
    });
    assert.equal(changed.status, 500);
    assert.equal(db.prepare(
      "SELECT v FROM settings WHERE k = 'user_pass_hash'").get(), undefined);
    assert.equal(db.prepare(
      "SELECT v FROM settings WHERE k = 'session_epoch'").get(), undefined);
  } finally {
    db.close();
  }
});

test("API rejects invalid album paths and keeps favorite order strict", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('test-store', 'Test', 'local', '{}', 1, 1)`).run();
  const env = {
    DB: d1FromSqlite(db),
    KV: kvFromSqlite(db),
    APP_PASSWORD: "listener",
    ADMIN_PASSWORD: "admin-password",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    COMPANION_KEY: "companion-key",
    OD_ROOT: "Music/Library",
    DEV_INSECURE_COOKIE: "1",
  };
  const request = (url, init = {}) => worker.fetch(
    new Request(`http://mihonban.test${url}`, init), env);
  const json = (value) => ({
    "Content-Type": "application/json",
    body: JSON.stringify(value),
  });

  try {
    const login = await request("/api/login", { method: "POST", ...json({ password: "admin-password" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";", 1)[0];
    const auth = (url, init = {}) => request(url, {
      ...init,
      headers: { ...(init.headers || {}), Cookie: cookie },
    });

    const create = await auth("/api/albums", {
      method: "POST",
      ...json({
        folder: "Music/Library/Artist/[2000] Album",
        artist: "Artist",
        title: "Album",
        tracks: [{ path: "Music/Library/Artist/[2000] Album/01.mp3", title: "One" }],
      }),
    });
    assert.equal(create.status, 200);
    const albumId = (await create.json()).id;

    const badCover = await auth(`/api/album/${albumId}`, {
      method: "PATCH",
      ...json({ coverPath: "Music/Library/other/cover.jpg" }),
    });
    assert.equal(badCover.status, 400);

    const missingRym = await auth("/api/album/missing/rym", {
      method: "POST", ...json({ rating: 3.8 }),
    });
    assert.equal(missingRym.status, 404);

    const trackId = db.prepare("SELECT id FROM tracks LIMIT 1").get().id;
    assert.equal((await auth(`/api/favorites/album/${albumId}`, { method: "PUT" })).status, 200);
    assert.equal((await auth(`/api/favorites/track/${trackId}`, { method: "PUT" })).status, 200);
    const badOrder = await auth("/api/favorites/album/reorder", {
      method: "PUT", ...json({ ids: ["not-a-favorite"] }),
    });
    assert.equal(badOrder.status, 400);

    db.prepare(`INSERT INTO album_images (id, album_id, path, sort, created_at)
      VALUES ('image-1', ?, 'Music/Library/Artist/[2000] Album/artwork/page.jpg', 0, 1)`)
      .run(albumId);
    assert.equal((await auth(`/api/album/${albumId}/hide`, {
      method: "POST", ...json({ hidden: true }),
    })).status, 200);

    const visibleTracks = await auth("/api/tracks");
    assert.equal((await visibleTracks.json()).length, 0);
    const allTracks = await auth("/api/tracks?hidden=1");
    assert.equal((await allTracks.json())[0].hidden, 1);
    assert.deepEqual(await (await auth("/api/artists")).json(), []);
    assert.equal((await (await auth("/api/artists?hidden=1")).json())[0].name,
      "Artist");
    assert.equal((await (await companionRequest(
      env, "/api/library?hidden=1")).json())[0].id, albumId);
    assert.equal((await companionRequest(env, `/api/album/${albumId}`)).status, 200);

    const listenerLogin = await request("/api/login", {
      method: "POST", ...json({ password: "listener" }),
    });
    const listenerCookie = listenerLogin.headers.get("set-cookie").split(";", 1)[0];
    const listen = (url) => request(url, { headers: { Cookie: listenerCookie } });
    assert.equal((await listen(`/api/art/${albumId}`)).status, 404);
    assert.equal((await listen("/api/image/image-1")).status, 404);
    assert.equal((await listen("/api/artist-art/Artist")).status, 404);
    assert.equal((await listen("/api/artist-bio/Artist")).status, 404);
    assert.deepEqual(await (await listen("/api/favorites")).json(),
      { albums: [], tracks: [] });
  } finally {
    db.close();
  }
});

test("R2 prewarm reads artist avatars from their recorded storage", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  const temp = mkdtempSync(join(tmpdir(), "mihonban-prewarm-"));
  const avatarRoot = join(temp, "avatar-store");
  const albumRoot = join(temp, "album-store");
  const avatarDir = join(avatarRoot, "Artist");
  const correctAvatar = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const wrongAvatar = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  mkdirSync(avatarDir, { recursive: true });
  mkdirSync(join(albumRoot, "Artist"), { recursive: true });
  writeFileSync(join(avatarDir, "avatar.jpg"), correctAvatar);
  writeFileSync(join(albumRoot, "Artist", "avatar.jpg"), wrongAvatar);

  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES (?, ?, 'local', ?, 0, ?)`)
    .run("avatar-store", "Avatar", JSON.stringify({ root: avatarRoot }), 1);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES (?, ?, 'local', ?, 0, ?)`)
    .run("album-store", "Album", JSON.stringify({ root: albumRoot }), 2);
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('album-1', 'Artist', 'Album',
      'Music/Library/Artist/Album', 'album-store', 1, 1)`).run();
  db.prepare(`INSERT INTO artists (name, avatar_path, storage_id)
    VALUES ('Artist', 'Music/Library/Artist/avatar.jpg', 'avatar-store')`).run();
  db.prepare("INSERT INTO settings (k, v) VALUES ('r2_enabled', '1')").run();

  const env = {
    DB: d1FromSqlite(db),
    KV: kvFromSqlite(db),
    LOCAL_FS: localFs,
    ADMIN_PASSWORD: "admin-password",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    DEV_INSECURE_COOKIE: "1",
    OD_ROOT: "Music/Library",
    R2_ACCESS_KEY: "access",
    R2_SECRET_KEY: "secret",
    R2_ENDPOINT: "https://r2.example",
    R2_BUCKET: "bucket",
    R2_PUBLIC_URL: "https://cdn.example",
  };
  const request = (url, init = {}) => worker.fetch(
    new Request(`http://mihonban.test${url}`, init), env);
  const realFetch = globalThis.fetch;
  let uploaded = null;

  try {
    const login = await request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "admin-password" }),
    });
    const cookie = login.headers.get("set-cookie").split(";", 1)[0];
    globalThis.fetch = async (input, init) => {
      if (init?.method === "HEAD" && String(input).startsWith("https://cdn.example/")) {
        return new Response(null, { status: 404 });
      }
      if (init?.method === "PUT" && String(input).startsWith("https://r2.example/")) {
        uploaded = Buffer.from(init.body);
        return new Response(null, { status: 200 });
      }
      return realFetch(input, init);
    };

    const response = await request("/api/admin/r2/prewarm", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ limit: 10 }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).failed, 0);
    assert.deepEqual(uploaded, correctAvatar);
  } finally {
    globalThis.fetch = realFetch;
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("R2 prewarm claims existing public objects without reading source images", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('store-1', 'Store', 'local', '{}', 1, 1)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, cover_path, storage_id, created_at, updated_at)
    VALUES ('album-1', 'Artist', 'Album', 'Music/Library/Artist/Album',
      'Music/Library/Artist/Album/cover.jpg', 'store-1', 1, 1)`).run();
  db.prepare("INSERT INTO settings (k, v) VALUES ('r2_enabled', '1')").run();
  const env = companionEnv(db, {
    R2_ACCESS_KEY: "access",
    R2_SECRET_KEY: "secret",
    R2_ENDPOINT: "https://r2.example",
    R2_BUCKET: "bucket",
    R2_PUBLIC_URL: "https://cdn.example",
  });
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method || "GET" });
    if (init.method === "HEAD" && String(input).startsWith("https://cdn.example/")) {
      return new Response(null, { status: 200 });
    }
    throw new Error(`unexpected source/upload request ${input}`);
  };

  try {
    const response = await companionRequest(env, "/api/admin/r2/prewarm", {
      method: "POST", ...jsonBody({ offset: 0, limit: 1 }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, body.error);
    assert.deepEqual(body, {
      total: 1, processed: 1, done: 0, skipped: 1, failed: 0, finished: true,
    });
    assert.deepEqual(calls, [
      { url: "https://cdn.example/img/art_album-1_original.jpg", method: "HEAD" },
    ]);
    assert.deepEqual(db.prepare(
      "SELECT cache_key, r2_key FROM r2_cache ORDER BY cache_key").all(), [
      { cache_key: "art:album-1:original", r2_key: "img/art_album-1_original.jpg" },
    ]);
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});

test("R2 prewarm never uploads when the public existence check is inconclusive", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('store-1', 'Store', 'local', '{}', 1, 1)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, cover_path, storage_id, created_at, updated_at)
    VALUES ('album-1', 'Artist', 'Album', 'Music/Library/Artist/Album',
      'Music/Library/Artist/Album/cover.jpg', 'store-1', 1, 1)`).run();
  db.prepare("INSERT INTO settings (k, v) VALUES ('r2_enabled', '1')").run();
  const env = companionEnv(db, {
    R2_ACCESS_KEY: "access",
    R2_SECRET_KEY: "secret",
    R2_ENDPOINT: "https://r2.example",
    R2_BUCKET: "bucket",
    R2_PUBLIC_URL: "https://cdn.example",
  });
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method || "GET" });
    if (init.method === "HEAD" && String(input).startsWith("https://cdn.example/")) {
      return new Response(null, { status: 503 });
    }
    throw new Error(`unexpected source/upload request ${input}`);
  };

  try {
    const response = await companionRequest(env, "/api/admin/r2/prewarm", {
      method: "POST", ...jsonBody({ offset: 0, limit: 1 }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, body.error);
    assert.deepEqual(body, {
      total: 1, processed: 1, done: 0, skipped: 0, failed: 1, finished: true,
    });
    assert.deepEqual(calls, [
      { url: "https://cdn.example/img/art_album-1_original.jpg", method: "HEAD" },
    ]);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM r2_cache").get().count, 0);
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});

test("hiding an album removes its public R2 mirrors and excludes it from prewarm", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('hidden-store', 'Hidden', 'local', '{}', 1, 1)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('hidden-album', 'Hidden Artist', 'Hidden Album',
      'Music/Library/Hidden Artist/Hidden Album', 'hidden-store', 1, 1)`).run();
  db.prepare(`INSERT INTO album_images (id, album_id, path, sort, created_at)
    VALUES ('hidden-image', 'hidden-album',
      'Music/Library/Hidden Artist/Hidden Album/page.jpg', 0, 1)`).run();
  db.prepare(`INSERT INTO artists (name, avatar_path, storage_id)
    VALUES ('Hidden Artist', 'Music/Library/Hidden Artist/avatar.jpg',
      'hidden-store')`).run();
  db.prepare(`INSERT INTO r2_cache (cache_key, r2_key, created_at)
    VALUES ('art:hidden-album:480', 'img/art-hidden.jpg', 1),
           ('img:hidden-image:480', 'img/page-hidden.jpg', 1),
           ('artist:3445ba72eb922937:480', 'img/avatar-hidden.jpg', 1)`).run();
  db.prepare("INSERT INTO settings (k, v) VALUES ('r2_enabled', '1')").run();
  const env = companionEnv(db, {
    R2_ACCESS_KEY: "access",
    R2_SECRET_KEY: "secret",
    R2_ENDPOINT: "https://r2.example",
    R2_BUCKET: "bucket",
    R2_PUBLIC_URL: "https://cdn.example",
  });
  const realFetch = globalThis.fetch;
  const deleted = [];
  globalThis.fetch = async (input, init = {}) => {
    if (init.method === "DELETE" && String(input).startsWith("https://r2.example/")) {
      deleted.push(String(input));
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${input}`);
  };

  try {
    const hidden = await companionRequest(env, "/api/album/hidden-album/hide", {
      method: "POST", ...jsonBody({ hidden: true }),
    });
    assert.equal(hidden.status, 200, await hidden.text());
    assert.equal(deleted.length, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM r2_cache").get().n, 0);
    assert.equal(db.prepare(
      "SELECT hidden FROM albums WHERE id = 'hidden-album'").get().hidden, 1);

    const prewarm = await companionRequest(env, "/api/admin/r2/prewarm", {
      method: "POST", ...jsonBody({ offset: 0, limit: 10 }),
    });
    assert.equal(prewarm.status, 200);
    assert.equal((await prewarm.json()).total, 0);

    // Simulate public mirrors restored from an old database backup.  The
    // maintenance endpoint must clean them without touching source files.
    db.prepare(`INSERT INTO r2_cache (cache_key, r2_key, created_at)
      VALUES ('art:hidden-album:1000', 'img/art-restored.jpg', 2),
             ('img:hidden-image:1000', 'img/page-restored.jpg', 2),
             ('artist:3445ba72eb922937:480', 'img/avatar-restored.jpg', 2)`).run();
    const purged = await companionRequest(env, "/api/admin/r2/purge-hidden", {
      method: "POST", ...jsonBody({ offset: 0, limit: 10 }),
    });
    const purgedBody = await purged.json();
    assert.equal(purged.status, 200, purgedBody.error);
    assert.equal(purgedBody.ok, true);
    assert.equal(purgedBody.finished, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM r2_cache").get().n, 0);
    assert.equal(deleted.length, 6);
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});

test("failed R2 purges never delete source album or image files", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  const folder = "Music/Library/Artist/Album";
  const imagePath = `${folder}/booklet.jpg`;
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('media', 'Media', 'local', '{}', 1, 1)`).run();
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('album', 'Artist', 'Album', ?, 'media', 1, 1)`).run(folder);
  db.prepare(`INSERT INTO album_images (id, album_id, path, sort, created_at)
    VALUES ('image', 'album', ?, 0, 1)`).run(imagePath);
  db.prepare(`INSERT INTO r2_cache (cache_key, r2_key, created_at)
    VALUES ('art:album:480', 'img/album.jpg', 1),
           ('img:image:480', 'img/image.jpg', 1)`).run();
  db.prepare("INSERT INTO settings (k, v) VALUES ('r2_enabled', '1')").run();
  const deleted = [];
  const env = companionEnv(db, {
    LOCAL_FS: {
      async deleteItem(_config, path) {
        deleted.push(path);
        return true;
      },
    },
    R2_ACCESS_KEY: "access",
    R2_SECRET_KEY: "secret",
    R2_ENDPOINT: "https://r2.example",
    R2_BUCKET: "bucket",
    R2_PUBLIC_URL: "https://cdn.example",
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    if (init.method === "DELETE" && String(input).startsWith("https://r2.example/")) {
      return new Response(null, { status: 503 });
    }
    throw new Error(`unexpected fetch ${input}`);
  };

  try {
    const imageDelete = await companionRequest(
      env, "/api/album/album/images/image?file=1", { method: "DELETE" });
    assert.equal(imageDelete.status, 502);
    assert.deepEqual(deleted, []);
    assert.ok(db.prepare("SELECT 1 FROM album_images WHERE id = 'image'").get());

    const albumDelete = await companionRequest(
      env, "/api/album/album?files=1", { method: "DELETE" });
    assert.equal(albumDelete.status, 502);
    assert.deepEqual(deleted, []);
    assert.ok(db.prepare("SELECT 1 FROM albums WHERE id = 'album'").get());
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});

test("cover storage lookup never uses LIKE and supports an artist parent folder", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  const temp = mkdtempSync(join(tmpdir(), "mihonban-cover-"));
  const albumRoot = join(temp, "album-store");
  const writeRoot = join(temp, "write-store");
  const baseD1 = d1FromSqlite(db);
  let checkedLookup = false;
  const guardedD1 = {
    ...baseD1,
    prepare(sql) {
      if (/SELECT\s+storage_id\s+FROM\s+albums/i.test(sql)) {
        checkedLookup = true;
        assert.doesNotMatch(sql, /\b(?:LIKE|GLOB)\b/i);
      }
      return baseD1.prepare(sql);
    },
  };

  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES (?, ?, 'local', ?, 0, ?)`).run(
    "cover-album-store", "Album", JSON.stringify({ root: albumRoot }), 1);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES (?, ?, 'local', ?, 1, ?)`).run(
    "cover-write-store", "Write", JSON.stringify({ root: writeRoot }), 2);
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('cover-album', 'Artist', 'Existing',
      'Music/Library/Artist/Existing', 'cover-album-store', 1, 1)`).run();

  const env = {
    DB: guardedD1,
    KV: kvFromSqlite(db),
    LOCAL_FS: localFs,
    COMPANION_KEY: "companion-key",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    OD_ROOT: "Music/Library",
  };

  try {
    const response = await worker.fetch(new Request(
      "http://mihonban.test/api/upload/cover?path=Music%2FLibrary%2FArtist%2Favatar.jpg", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg", "X-Api-Key": "companion-key" },
        body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      }), env);
    assert.equal(response.status, 200, await response.text());
    assert.equal(checkedLookup, true);
    assert.equal(readFileSync(join(albumRoot, "Artist", "avatar.jpg")).length, 4);
    assert.equal(existsSync(join(writeRoot, "Artist", "avatar.jpg")), false);

    const existingSession = await companionRequest(env, "/api/upload/session", {
      method: "POST",
      ...jsonBody({
        path: "Music/Library/Artist/Existing/bonus.flac",
      }),
    });
    assert.equal(existingSession.status, 200);
    assert.equal((await existingSession.json()).storageId, "cover-album-store");
    const newSession = await companionRequest(env, "/api/upload/session", {
      method: "POST",
      ...jsonBody({
        path: "Music/Library/New Artist/New Album/01.flac",
      }),
    });
    assert.equal((await newSession.json()).storageId, "cover-write-store");

    const proxyUpload = await companionRequest(env,
      "/api/upload/proxy?path=Music%2FLibrary%2FArtist%2FExisting%2Fbonus.flac", {
        method: "PUT",
        headers: { "Content-Type": "audio/flac" },
        body: "existing-album-audio",
      });
    assert.equal(proxyUpload.status, 200, await proxyUpload.text());
    assert.equal(readFileSync(join(albumRoot, "Artist", "Existing", "bonus.flac"),
      "utf8"), "existing-album-audio");
    assert.equal(existsSync(join(writeRoot, "Artist", "Existing", "bonus.flac")),
      false);

    const nestedCover = await worker.fetch(new Request(
      "http://mihonban.test/api/upload/cover?path=" +
      "Music%2FLibrary%2FArtist%2FExisting%2Fartwork%2Fpage.jpg", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg", "X-Api-Key": "companion-key" },
        body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      }), env);
    assert.equal(nestedCover.status, 200, await nestedCover.text());
    assert.equal(existsSync(join(albumRoot, "Artist", "Existing", "artwork", "page.jpg")),
      true);
    assert.equal(existsSync(join(writeRoot, "Artist", "Existing", "artwork", "page.jpg")),
      false);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("audio streaming retries a transient upstream 503 and preserves byte ranges", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('stream-album', 'Artist', 'Album', 'Music/Library/Artist/Album', 'stream-store', 1, 1)`).run();
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('stream-store', 'Stream', 'onedrive', ?, 0, 1)`)
    .run(JSON.stringify({ clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh', driveId: 'drive' }));
  db.prepare(`INSERT INTO tracks
    (id, album_id, disc, track, title, path)
    VALUES ('stream-track', 'stream-album', 1, 1, 'Track',
      'Music/Library/Artist/Album/01.ogg')`).run();
  const kv = kvFromSqlite(db);
  await kv.put("dl:stream-store:Music/Library/Artist/Album/01.ogg",
    "https://download.example/audio.ogg");
  const env = {
    DB: d1FromSqlite(db), KV: kv,
    COMPANION_KEY: "companion-key",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    OD_ROOT: "Music/Library",
  };
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://download.example/audio.ogg");
    assert.equal(init.headers.Range, "bytes=10-19");
    calls += 1;
    if (calls === 1) {
      return new Response("unavailable", {
        status: 503, headers: { "Retry-After": "0" },
      });
    }
    return new Response("0123456789", {
      status: 206,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": "10",
        "Content-Range": "bytes 10-19/100",
        "Accept-Ranges": "bytes",
      },
    });
  };
  try {
    const response = await worker.fetch(new Request(
      "http://mihonban.test/api/stream/stream-track", {
        headers: { "X-Api-Key": "companion-key", Range: "bytes=10-19" },
      }), env);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Type"), "audio/ogg");
    assert.equal(response.headers.get("Content-Range"), "bytes 10-19/100");
    assert.equal(await response.text(), "0123456789");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});

test("audio streaming refreshes an unhealthy cached OneDrive download URL", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('fresh-album', 'Artist', 'Album', 'Music/Library/Artist/Album', 'fresh-store', 1, 1)`).run();
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('fresh-store', 'Fresh', 'onedrive', ?, 0, 1)`)
    .run(JSON.stringify({ clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh', driveId: 'drive' }));
  db.prepare(`INSERT INTO tracks
    (id, album_id, disc, track, title, path)
    VALUES ('fresh-track', 'fresh-album', 1, 1, 'Track',
      'Music/Library/Artist/Album/fresh.ogg')`).run();
  const kv = kvFromSqlite(db);
  await kv.put("dl:fresh-store:Music/Library/Artist/Album/fresh.ogg",
    "https://download.example/stale.ogg");
  await kv.put("msT:fresh-store", JSON.stringify({
    access_token: "cached-token", expires_at: Date.now() + 600_000,
  }));
  const env = {
    DB: d1FromSqlite(db), KV: kv,
    COMPANION_KEY: "companion-key",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    OD_ROOT: "Music/Library",
    MS_DRIVE_ID: "drive",
    MS_CLIENT_ID: "client",
    MS_CLIENT_SECRET: "secret",
    MS_REFRESH_TOKEN: "refresh",
  };
  const realFetch = globalThis.fetch;
  let staleCalls = 0, graphCalls = 0, freshCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://download.example/stale.ogg") {
      staleCalls += 1;
      return new Response("unavailable", {
        status: 503, headers: { "Retry-After": "0" },
      });
    }
    if (url.startsWith("https://graph.microsoft.com/v1.0/")) {
      graphCalls += 1;
      return Response.json({
        "@microsoft.graph.downloadUrl": "https://download.example/fresh.ogg",
      });
    }
    if (url === "https://download.example/fresh.ogg") {
      freshCalls += 1;
      assert.equal(init.headers.Range, "bytes=20-29");
      return new Response("abcdefghij", {
        status: 206,
        headers: {
          "Content-Length": "10",
          "Content-Range": "bytes 20-29/100",
          "Accept-Ranges": "bytes",
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const response = await worker.fetch(new Request(
      "http://mihonban.test/api/stream/fresh-track", {
        headers: { "X-Api-Key": "companion-key", Range: "bytes=20-29" },
      }), env);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), "bytes 20-29/100");
    assert.equal(await response.text(), "abcdefghij");
    assert.equal(staleCalls, 3);
    assert.equal(graphCalls, 1);
    assert.equal(freshCalls, 1);
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});

test("audio streaming falls back to Graph content when metadata stays unavailable", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('content-album', 'Artist', 'Album', 'Music/Library/Artist/Album', 'content-store', 1, 1)`).run();
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('content-store', 'Content', 'onedrive', ?, 0, 1)`)
    .run(JSON.stringify({ clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh', driveId: 'drive' }));
  db.prepare(`INSERT INTO tracks
    (id, album_id, disc, track, title, path)
    VALUES ('content-track', 'content-album', 1, 1, 'Track',
      'Music/Library/Artist/Album/content.flac')`).run();
  const kv = kvFromSqlite(db);
  await kv.put("msT:content-store", JSON.stringify({
    access_token: "cached-token", expires_at: Date.now() + 600_000,
  }));
  const env = {
    DB: d1FromSqlite(db), KV: kv,
    COMPANION_KEY: "companion-key",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    MS_DRIVE_ID: "drive",
  };
  const realFetch = globalThis.fetch;
  let metadataCalls = 0, contentCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("content.downloadUrl")) {
      metadataCalls += 1;
      return new Response("metadata unavailable", {
        status: 503, headers: { "Retry-After": "0" },
      });
    }
    if (url.endsWith(":/content")) {
      contentCalls += 1;
      assert.equal(init.headers.Range, "bytes=0-15");
      return new Response("fLaC-content-ok", {
        status: 206,
        headers: {
          "Content-Length": "16",
          "Content-Range": "bytes 0-15/100",
          "Accept-Ranges": "bytes",
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const response = await worker.fetch(new Request(
      "http://mihonban.test/api/stream/content-track?proxy=1", {
        headers: { "X-Api-Key": "companion-key", Range: "bytes=0-15" },
      }), env);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Type"), "audio/flac");
    assert.equal(await response.text(), "fLaC-content-ok");
    assert.equal(metadataCalls, 3);
    assert.equal(contentCalls, 1);
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});

test("audio streaming preserves an unsatisfiable local range response", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  const temp = mkdtempSync(join(tmpdir(), "mihonban-empty-audio-"));
  const root = join(temp, "library");
  mkdirSync(join(root, "Artist", "Album"), { recursive: true });
  writeFileSync(join(root, "Artist", "Album", "empty.flac"), "");
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('local', 'Local', 'local', ?, 0, 1)`).run(
    JSON.stringify({ root, odRoot: "Music/Library" }));
  db.prepare(`INSERT INTO albums
    (id, artist, title, folder, storage_id, created_at, updated_at)
    VALUES ('empty-album', 'Artist', 'Album',
      'Music/Library/Artist/Album', 'local', 1, 1)`).run();
  db.prepare(`INSERT INTO tracks (id, album_id, title, path)
    VALUES ('empty-track', 'empty-album', 'Empty',
      'Music/Library/Artist/Album/empty.flac')`).run();
  const env = companionEnv(db, { LOCAL_FS: localFs });
  try {
    const response = await companionRequest(env, "/api/stream/empty-track", {
      headers: { Range: "bytes=0-0" },
    });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("Content-Range"), "bytes */0");
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("catalog endpoints revalidate with ETag and return 304 until data changes", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare(`INSERT INTO storages (id, name, kind, config, is_write, created_at)
    VALUES ('main-store', 'Main', 'local', '{}', 1, 1)`).run();
  const env = companionEnv(db);
  try {
    const folder = "Music/Library/Artist/Cached";
    const created = await companionRequest(env, "/api/albums", {
      method: "POST",
      ...jsonBody({
        folder, artist: "Artist", title: "Cached",
        tracks: [{ path: `${folder}/01.mp3`, title: "One" }],
      }),
    });
    assert.equal(created.status, 200);
    const albumId = (await created.json()).id;

    for (const path of ["/api/library", "/api/tracks"]) {
      const first = await companionRequest(env, path);
      assert.equal(first.status, 200);
      const etag = first.headers.get("ETag");
      assert.ok(etag, `${path} must expose an ETag`);
      assert.equal(first.headers.get("Cache-Control"), "private, no-cache");

      const revalidated = await companionRequest(env, path, {
        headers: { "If-None-Match": etag },
      });
      assert.equal(revalidated.status, 304, `${path} unchanged -> 304`);

      // 任何目录写入（这里改一首曲名，会回写 albums.updated_at）都要打破 304。
      // 版本戳含 MAX(updated_at) 毫秒值：先等 2ms 保证时间戳前进。
      await new Promise((resolve) => setTimeout(resolve, 2));
      const bump = await companionRequest(env, `/api/album/${albumId}`, {
        method: "PATCH", ...jsonBody({ title: `Renamed for ${path}` }),
      });
      assert.equal(bump.status, 200);
      const changed = await companionRequest(env, path, {
        headers: { "If-None-Match": etag },
      });
      assert.equal(changed.status, 200, `${path} changed -> full body`);
      assert.notEqual(changed.headers.get("ETag"), etag);
    }
  } finally {
    db.close();
  }
});
