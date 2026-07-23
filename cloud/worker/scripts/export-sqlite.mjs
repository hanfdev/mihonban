#!/usr/bin/env node

// Export a Node/local-Wrangler SQLite database as D1-compatible SQL.
// Durable library data is exported by default. Settings are opt-in because
// they may contain credentials; use the Admin config backup for those values.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { CONFIG_BACKUP_SETTING_KEYS } from "../src/config-backup.js";

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = resolve(here, "..");
const repoDir = resolve(workerDir, "..", "..");
const durableTables = [
  "albums", "tracks", "artists", "album_images", "favorites", "notes",
  "source_posts",
];

function usage(message = "") {
  if (message) console.error(`Error: ${message}\n`);
  console.error(`Usage: npm run db:export -- --source <sqlite> --output <sql> [options]

Options:
  --source <file>       SQLite file from Node or local Wrangler D1
  --output <file>       SQL output path (default: d1-backup.sql)
  --include-config      Include config settings + storages (contains secrets;
                        excludes password hashes and runtime/session state)
  --include-cache       Include R2 index when reusing the same bucket
  --replace             Clear included catalog tables/config keys first
  --help                Show this help

Import with:
  npx wrangler d1 execute mihonban --remote --file <output>
`);
  process.exit(message ? 2 : 0);
}

const args = process.argv.slice(2);
const valueArg = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
if (args.includes("--help")) usage();

const sourceArg = valueArg("--source");
const outputArg = valueArg("--output", "d1-backup.sql");
const includeConfig = args.includes("--include-config")
  || args.includes("--include-settings");
const includeCache = args.includes("--include-cache");
const replace = args.includes("--replace");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function resolveSource(source) {
  if (source) return resolve(source);
  const candidates = [
    join(workerDir, "data", "mihonban.sqlite"),
    join(repoDir, "data", "mihonban.sqlite"),
  ];
  const localD1 = join(workerDir, ".wrangler", "state", "v3", "d1");
  if (existsSync(localD1)) {
    candidates.push(...walk(localD1).filter((file) =>
      file.endsWith(".sqlite") && !file.endsWith("metadata.sqlite")));
  }
  const existing = candidates.filter(existsSync);
  if (!existing.length) throw new Error("SQLite source not found; pass --source <path>");
  existing.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return existing[0];
}

const source = resolveSource(sourceArg);
if (!existsSync(source)) usage(`source does not exist: ${source}`);
const output = isAbsolute(outputArg) ? outputArg : resolve(process.cwd(), outputArg);
mkdirSync(dirname(output), { recursive: true });
const db = new Database(source, { readonly: true, fileMustExist: true });

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
function tableExists(table) {
  return !!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}
function sqlValue(value) {
  if (value === undefined || value === null) return "NULL";
  return db.prepare("SELECT quote(?) AS value").get(value).value;
}

const tables = [...durableTables];
if (includeConfig) tables.unshift("storages");
if (includeConfig) tables.push("settings");
if (includeCache) tables.push("r2_cache");
const selected = tables.filter(tableExists);
const configSettingPlaceholders = CONFIG_BACKUP_SETTING_KEYS
  .map(() => "?").join(", ");
db.exec("BEGIN TRANSACTION");
const lines = [
  "-- mihonban D1 logical backup",
  `-- source: ${source.replaceAll("\\", "/")}`,
  `-- generated: ${new Date().toISOString()}`,
  "-- Import with: npx wrangler d1 execute mihonban --remote --file this.sql",
  includeConfig
    ? "-- WARNING: allowlisted settings and storage configs are included; protect this file like a secret."
    : "-- settings/storage configs omitted; use the Admin config backup for credentials.",
  "-- Remote D1 imports reject explicit SQL transactions; Wrangler applies the uploaded file atomically.",
  replace
    ? "-- WARNING: --replace was requested; included tables are cleared first."
    : "-- Mode: merge (primary-key UPSERT; absent source rows are retained).",
];

if (replace) {
  for (const table of [...selected].reverse()) {
    if (table === "settings") {
      lines.push(`DELETE FROM ${quoteIdent(table)} WHERE "k" IN (` +
        `${CONFIG_BACKUP_SETTING_KEYS.map(sqlValue).join(", ")});`);
    } else {
      lines.push(`DELETE FROM ${quoteIdent(table)};`);
    }
  }
}

const counts = [];
for (const table of selected) {
  const info = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
  const columns = info.map((column) => column.name);
  if (!columns.length) continue;
  const primaryKey = info.filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk).map((column) => column.name);
  const updateColumns = columns.filter((column) => !primaryKey.includes(column));
  const select = `SELECT ${columns.map(quoteIdent).join(", ")} ` +
    `FROM ${quoteIdent(table)}`;
  const rows = table === "settings"
    ? db.prepare(`${select} WHERE "k" IN (${configSettingPlaceholders})`)
      .all(...CONFIG_BACKUP_SETTING_KEYS)
    : db.prepare(select).all();
  counts.push(`${table}=${rows.length}`);
  const prefix = `INSERT INTO ${quoteIdent(table)} ` +
    `(${columns.map(quoteIdent).join(", ")}) VALUES `;
  const upsert = primaryKey.length
    ? ` ON CONFLICT (${primaryKey.map(quoteIdent).join(", ")}) ` +
      (updateColumns.length
        ? `DO UPDATE SET ${updateColumns.map((column) =>
          `${quoteIdent(column)} = excluded.${quoteIdent(column)}`).join(", ")}`
        : "DO NOTHING")
    : "";
  for (const row of rows) {
    lines.push(`${prefix}(${columns.map((column) => sqlValue(row[column])).join(", ")})${upsert};`);
  }
}
lines.push("");
db.exec("COMMIT");
db.close();
writeFileSync(output, lines.join("\n"), "utf8");
console.log(`Exported ${counts.join(", ")} from ${source}`);
console.log(`Wrote ${output}`);
