import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

import { kvFromSqlite } from "../src/compat.js";

test("kv list pages every key while the caller deletes returned pages", async () => {
  const db = new Database(":memory:");
  const kv = kvFromSqlite(db);
  const total = 2500; // 超过单页 1000，跨 3 页
  for (let i = 0; i < total; i++) {
    await kv.put(`dl:test:${String(i).padStart(5, "0")}`, "v");
  }
  await kv.put("other:key", "v");

  // graph.js/gdrive.js 的缓存清理模式：取一页 → 删掉这一页 → 用 cursor 取下一页。
  // OFFSET 型游标在这种用法下会跳过存活键；键集游标必须一个不漏。
  let cursor = "";
  let seen = 0;
  for (let guard = 0; guard < 10; guard++) {
    const page = await kv.list({ prefix: "dl:", cursor, limit: 1000 });
    seen += page.keys.length;
    await Promise.all(page.keys.map((entry) => kv.delete(entry.name)));
    if (page.list_complete) { cursor = ""; break; }
    cursor = page.cursor;
  }
  assert.equal(seen, total);
  const leftover = await kv.list({ prefix: "dl:" });
  assert.equal(leftover.keys.length, 0);
  assert.equal((await kv.list({ prefix: "other:" })).keys.length, 1);
});

test("kv list cursor resumes after the last returned key", async () => {
  const db = new Database(":memory:");
  const kv = kvFromSqlite(db);
  for (const k of ["p:a", "p:b", "p:c", "q:z"]) await kv.put(k, "v");
  const first = await kv.list({ prefix: "p:", limit: 2 });
  assert.deepEqual(first.keys.map((entry) => entry.name), ["p:a", "p:b"]);
  assert.equal(first.list_complete, false);
  const second = await kv.list({ prefix: "p:", cursor: first.cursor, limit: 2 });
  assert.deepEqual(second.keys.map((entry) => entry.name), ["p:c"]);
  assert.equal(second.list_complete, true);
  assert.equal(second.cursor, "");
});
