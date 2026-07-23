import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { d1FromSqlite } from "../src/compat.js";
import { fetchWithTimeout, scanSource } from "../src/source.js";
import worker from "../src/index.js";

const schema = readFileSync(join(process.cwd(), "schema.sql"), "utf8");

test("feed fetches abort instead of hanging forever", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_input, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  try {
    await assert.rejects(fetchWithTimeout("https://slow.example/feed", {}, 5));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("source scanner imports a Blogger feed and remains idempotent", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare("INSERT INTO settings (k, v) VALUES ('source_url', ?)")
    .run("https://music.example/");
  const env = { DB: d1FromSqlite(db) };
  const realFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    assert.match(url, /^https:\/\/music\.example\/feeds\/posts\/default\?/);
    return Response.json({
      feed: {
        "openSearch$totalResults": { $t: "2" },
        entry: [
          {
            title: { $t: "First album" },
            published: { $t: "2026-07-20T12:00:00Z" },
            link: [{ rel: "alternate", href: "https://music.example/first" }],
          },
          {
            title: { $t: "Second album" },
            published: { $t: "2026-07-21T12:00:00Z" },
            link: [{ rel: "alternate", href: "https://music.example/second" }],
          },
        ],
      },
    });
  };

  try {
    assert.deepEqual(await scanSource(env), {
      added: 2, total: 2, feedTotal: 2,
    });
    assert.deepEqual(await scanSource(env), {
      added: 0, total: 2, feedTotal: 2,
    });
    assert.equal(requests.length, 2);
    assert.deepEqual(
      db.prepare("SELECT title, url, status FROM source_posts ORDER BY title").all(),
      [
        { title: "First album", url: "https://music.example/first", status: "new" },
        { title: "Second album", url: "https://music.example/second", status: "new" },
      ],
    );
    assert.ok(Number(db.prepare(
      "SELECT v FROM settings WHERE k = 'source_last_scan'").get().v));
    assert.equal(db.prepare(
      "SELECT v FROM settings WHERE k = 'source_last_error'").get().v, "");
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});

test("source scanner filters unsafe feed links and bounds oversized feeds", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare("INSERT INTO settings (k, v) VALUES ('source_url', ?)")
    .run("https://feed.example/");
  const env = { DB: d1FromSqlite(db) };
  const realFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async (input) => {
    call += 1;
    const url = String(input);
    if (url.includes("feeds/posts/default")) {
      return new Response("not-json", { status: 500 });
    }
    if (url.endsWith("/rss.xml")) {
      return new Response(`<?xml version="1.0"?><rss><channel>
        <item><title>Safe</title><link>https://feed.example/safe</link></item>
        <item><title>Unsafe</title><link>javascript:alert(1)</link></item>
      </channel></rss>`, { status: 200 });
    }
    return new Response("missing", { status: 404 });
  };
  try {
    const result = await scanSource(env);
    assert.equal(result.added, 1);
    assert.deepEqual(db.prepare("SELECT url FROM source_posts").all(), [
      { url: "https://feed.example/safe" },
    ]);
    assert.ok(call >= 2);
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});

test("Cloudflare scheduled handler runs the enabled source scanner", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  db.prepare("INSERT INTO settings (k, v) VALUES ('source_url', ?), ('module_source', '1')")
    .run("https://cron.example");
  const env = { DB: d1FromSqlite(db) };
  const realFetch = globalThis.fetch;
  let pending;

  globalThis.fetch = async () => Response.json({
    feed: {
      "openSearch$totalResults": { $t: "1" },
      entry: [{
        title: { $t: "Cron album" },
        published: { $t: "2026-07-21T12:00:00Z" },
        link: [{ rel: "alternate", href: "https://cron.example/album" }],
      }],
    },
  });

  try {
    worker.scheduled({}, env, { waitUntil(value) { pending = value; } });
    assert.ok(pending instanceof Promise);
    await pending;
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM source_posts").get().n, 1);
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});
