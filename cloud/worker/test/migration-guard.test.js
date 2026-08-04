import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import worker from "../src/index.js";
import { d1FromSqlite, kvFromSqlite } from "../src/compat.js";

const schema = readFileSync(join(process.cwd(), "schema.sql"), "utf8");

test("configured migration guard runs once across fresh binding objects", async () => {
  const db = new Database(":memory:");
  db.exec(schema);
  const base = d1FromSqlite(db);
  let prepares = 0;
  const sqlLog = [];
  const makeCounted = () => ({
    prepare(sql) {
      prepares += 1;
      sqlLog.push(sql);
      return base.prepare(sql);
    },
    batch: (...args) => base.batch(...args),
  });
  const env = {
    DB: makeCounted(),
    KV: kvFromSqlite(db),
    COMPANION_KEY: "test-companion-key",
    DB_SCHEMA_KEY: "migration-guard-test",
    OD_ROOT: "Music/Library",
  };
  const request = () => {
    // Cloudflare may expose a new binding wrapper on a later request.
    env.DB = makeCounted();
    return worker.fetch(new Request(
      "http://mihonban.test/api/library?hidden=1",
      { headers: { "X-Api-Key": "test-companion-key" } },
    ), env);
  };

  try {
    const first = await request();
    assert.equal(first.status, 200);
    assert.ok(prepares > 10, "the compatibility migration should run initially");

    prepares = 0;
    sqlLog.length = 0;
    const second = await request();
    assert.equal(second.status, 200);
    assert.ok(prepares <= 4,
      "a stable migration key must leave only the catalog queries on later requests");
    assert.equal(sqlLog.some((sql) => /CREATE TABLE|CREATE INDEX|CREATE TRIGGER|ALTER TABLE|sqlite_master/i.test(sql)), false);
    assert.equal(db.prepare(
      "SELECT v FROM settings WHERE k = 'schema_version'").get().v,
    "2026-08-05-1");

    // A different in-memory key simulates a cold isolate. The D1 marker must
    // still avoid rerunning the compatibility migration.
    env.DB_SCHEMA_KEY = "migration-guard-cold-test";
    prepares = 0;
    sqlLog.length = 0;
    const cold = await request();
    assert.equal(cold.status, 200);
    assert.ok(prepares <= 5);
    assert.equal(sqlLog.some((sql) => /CREATE TABLE|CREATE INDEX|CREATE TRIGGER|ALTER TABLE|sqlite_master/i.test(sql)), false);
  } finally {
    db.close();
  }
});
