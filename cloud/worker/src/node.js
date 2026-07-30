// Entry point for VPS or free Node hosting such as Render, Railway, and Fly:
//   node src/node.js
// It runs the same business logic in index.js, replacing D1/KV with local SQLite files.
// Environment variables, or a sibling .env file:
//   APP_PASSWORD ADMIN_PASSWORD SESSION_SECRET COMPANION_KEY
//   OD_ROOT=Music/Library  DATA_DIR=./data  PORT=8788  HOST=0.0.0.0
//   SOURCE_SCAN_HOURS=6 (0 disables scheduled scanning)
//   TRUST_PROXY=1 (enable only behind a trusted reverse proxy; uses X-Forwarded-For)

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { isIP } from "node:net";
import worker from "./index.js";
import { d1FromSqlite, kvFromSqlite } from "./compat.js";
import { scanSource } from "./source.js";
import * as localfs from "./localfs.js";

const here = dirname(fileURLToPath(import.meta.url));

// Node deployments conventionally use .env. Local Wrangler uses .dev.vars,
// so accept it as a fallback to keep both development runtimes consistent.
for (const name of [".env", ".dev.vars"]) {
  const envFile = join(here, "..", name);
  if (!existsSync(envFile)) continue;
  for (const line of readFileSync(envFile, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}

const dataDir = process.env.DATA_DIR || join(here, "..", "data");
mkdirSync(dataDir, { recursive: true });
const dbPath = join(dataDir, "mihonban.sqlite");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(readFileSync(join(here, "..", "schema.sql"), "utf-8"));

const env = {
  ...process.env,
  OD_ROOT: process.env.OD_ROOT || "Music/Library",
  DB: d1FromSqlite(db),
  KV: kvFromSqlite(db),
  // Local-disk backend exposed as Local Storage in Admin; Workers do not have this field.
  LOCAL_FS: localfs.api,
};

if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET must contain at least 32 characters");
  process.exit(1);
}
// Outer router: /api uses the application; everything else serves the static SPA
// with history fallback.
const root = new Hono();
root.all("/api/*", (c) => {
  const socketIp = c.env.incoming?.socket?.remoteAddress || "local";
  let clientIp = socketIp;
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = (c.req.header("X-Forwarded-For") || "")
      .split(",", 1)[0].trim();
    const real = (c.req.header("X-Real-IP") || "").trim();
    if (isIP(forwarded)) clientIp = forwarded;
    else if (isIP(real)) clientIp = real;
  }
  // The shared Worker code already trusts CF-Connecting-IP. Overwrite any
  // client-supplied value here with the socket/proxy address we just derived,
  // so Node users no longer all share the single "local" lockout bucket.
  c.req.raw.headers.set("CF-Connecting-IP", clientIp);
  return worker.fetch(c.req.raw, env);
});
const webDist = process.env.WEB_DIST || join(here, "..", "..", "web", "dist");
root.use("*", serveStatic({ root: webDist }));
root.get("*", (c) => {
  try {
    return c.html(readFileSync(join(webDist, "index.html"), "utf-8"));
  } catch {
    return c.text("web/dist not built — run: cd cloud/web && npm run build", 500);
  }
});

const port = Number(process.env.PORT || 8788);
// HOST=127.0.0.1 narrows the listening surface behind a reverse proxy. The
// default remains 0.0.0.0 for direct VPS access.
const hostname = process.env.HOST || "0.0.0.0";
const server = serve({ fetch: root.fetch, port, hostname }, () =>
  console.log(`mihonban cloud (node) on http://${hostname}:${port}`));

const hours = Number(process.env.SOURCE_SCAN_HOURS ?? 6);
if (hours > 0) {
  // unref keeps scheduled work from preventing natural process exit.
  setInterval(() => scanSource(env).catch(() => {}), hours * 3600_000).unref();
  setTimeout(() => scanSource(env).catch(() => {}), 30_000).unref();
}

// Graceful shutdown: hosting platforms such as Render, Railway, Fly, Docker, and
// systemd send SIGTERM before stopping or redeploying; local Ctrl+C sends SIGINT.
// Stop accepting connections, close SQLite so its WAL is flushed, and exit 0.
// Force exit after five seconds if existing connections linger. Windows cannot
// deliver SIGTERM, so taskkill /F still reports a nonzero exit code; that is a
// platform limitation, not an application failure.
let closing = false;
let shutdownTimer = null;
function closeDatabase() {
  try { db.close(); } catch { /* Already closed */ }
}
function finishShutdown() {
  if (shutdownTimer) clearTimeout(shutdownTimer);
  closeDatabase();
  process.exit(0);
}
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`${signal} received — shutting down`);
  // Even if long-lived connections keep server.close() from calling back within
  // five seconds, close SQLite and settle the WAL before exiting. Otherwise the
  // fallback path would skip the most important cleanup in graceful shutdown.
  shutdownTimer = setTimeout(finishShutdown, 5000);
  shutdownTimer.unref();
  server.close(finishShutdown);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(signal, () => shutdown(signal));
}
