# Database backup, migration, and recovery

[English](database-migration.md) · [简体中文](database-migration.zh.md) · [繁體中文](database-migration.zh-Hant.md) · [日本語](database-migration.ja.md) · [한국어](database-migration.ko.md) · [Français](database-migration.fr.md) · [Español](database-migration.es.md)

This document moves a catalog between local Node SQLite, local Wrangler D1, and remote Cloudflare D1.

If you remain local, back up `<DATA_DIR>/mihonban.sqlite`, the Admin settings JSON, runtime secrets, and audio separately. The remote sections apply only when a Cloudflare deployment actually exists.

## What must be moved

| Data | Migration path |
|---|---|
| Albums, tracks, artists, galleries, favorites, notes, source posts | D1 SQL export/import |
| OneDrive/R2/module settings and named storage configs | Admin settings JSON |
| App/admin password, session secret, companion key, proxy signing secret | Configure as target Worker secrets |
| KV rate limits and short-lived caches | Do not migrate |
| R2 cache index | Same bucket: export with `--include-cache`; new bucket: omit and prewarm |
| Audio and original images | Copy/migrate in the storage layer; not part of D1 |

The Admin JSON alone is not a catalog backup. A D1 SQL file alone does not contain audio or, by default, credentials.

Ordered album contributor credits are stored in `album_artists`. Optional song-specific credits are stored in `track_artists`; no rows for a track means it inherits the album credit. Both tables are included in logical SQL exports. On first use after an upgrade, Mihonban creates them and backfills each legacy album as one exact artist credit. It deliberately does not split old combined text on commas because commas are valid in artist and sort names. Use the album editor for a whole-release collaboration, or the artist control in Manage tracks for a guest who appears only on selected songs.

`artist_sort` is optional: blank values are preserved in exports and imports, while search and ordering fall back to the original artist name at runtime.

## Before moving Node local storage to Cloudflare

Cloudflare cannot read a Node `local` backend. While the old Node app is still available:

1. Add and test OneDrive, WebDAV, or Google Drive.
2. Migrate every album bound to local storage.
3. Verify streams and images from the cloud backend.
4. Then export the database.

## 1. Back up the source

In the old app, log in as administrator and download **Admin → Backup settings**. Store that JSON encrypted.

For Node, the database is `<DATA_DIR>/mihonban.sqlite`. Local Wrangler D1 files are under `cloud/worker/.wrangler/state/v3/d1/`.

Stop writes during the final cutover. The exporter uses a SQLite read transaction, but avoiding concurrent edits makes verification easier.

## 2. Prepare the target

Create D1/KV, copy the public template to the ignored local config, place the
real IDs in that local file, and apply the schema:

```bash
cd cloud/worker
npm ci
cp wrangler.jsonc wrangler.local.jsonc
# Replace the zero D1/KV IDs in wrangler.local.jsonc.
npx wrangler d1 execute mihonban --remote --file schema.sql \
  --config wrangler.local.jsonc
```

On PowerShell, use `Copy-Item wrangler.jsonc wrangler.local.jsonc`. The D1
resource is named `mihonban`, matching the config and Worker. Never put account
resource IDs or deployment secrets in the public template.

If the target already has important data, export it first:

```bash
mkdir -p ../../backups
npx wrangler d1 export mihonban --remote \
  --output ../../backups/remote-before-import.sql \
  --config wrangler.local.jsonc
```

## 3. Export and import library data

### Windows helper

From the repository root:

```powershell
powershell -File tools\migrate-d1.ps1 -ImportRemote
```

The helper auto-detects the newest Node SQLite or local Wrangler D1 and writes a timestamped SQL file under ignored `backups/`. It writes remote D1 only when `-ImportRemote` is present; omit that switch for export only. Before every remote import it also exports the current target to `backups/` and aborts if that backup fails. `-SkipRemoteBackup` is an explicit emergency override.

The helper prefers ignored `cloud/worker/wrangler.local.jsonc` when present and otherwise uses the public template. Pass `-WranglerConfig <path>` to select another private config.

When the target keeps the exact same R2 bucket and public URL, add
`-IncludeCache` so prewarm can skip objects already mirrored there:

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -IncludeCache -ImportRemote
```

Do not include that index when moving to an empty/different bucket: its rows
would point at objects that are not present. If an index was omitted while the
same public objects still exist, current prewarm checks those deterministic
object URLs with HEAD and reclaims the index without re-uploading image bytes.

When several local databases exist, always pass `-Source` instead of relying on modification time.

Explicit source:

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -Database "mihonban" `
  -WranglerConfig "cloud\worker\wrangler.local.jsonc" `
  -ImportRemote
```

### Manual/cross-platform

```bash
cd cloud/worker
npm ci
npm run db:export -- \
  --source /path/to/mihonban.sqlite \
  --output ../../backups/mihonban-d1.sql

npx wrangler d1 execute mihonban --remote \
  --file ../../backups/mihonban-d1.sql \
  --config wrangler.local.jsonc
```

Default mode uses primary-key UPSERT and retains target rows absent from the source. A conflicting unique path with a different ID fails instead of deleting data silently. For a fresh target this produces an exact source catalog. `--replace` clears the included catalog tables first; only use it after a remote backup.

The generated SQL intentionally has no explicit `BEGIN TRANSACTION` or
`COMMIT`: current remote D1 imports reject those statements and Wrangler applies
an uploaded file atomically. The exporter still reads the source in one SQLite
transaction, so its snapshot is consistent.

`--include-config` also exports named storages and the same allowlisted settings
as the Admin backup, so the SQL contains storage and service credentials. It
deliberately excludes listener/admin password hashes, session epoch, companion
heartbeat, scan timestamps, and errors. Configure target Worker passwords and
runtime secrets independently. The separate Admin JSON remains the recommended
configuration path. Even with `--replace`, only allowlisted configuration keys
are replaced; target authentication and runtime-state rows remain untouched.
For the same R2 bucket, add `--include-cache`; omit it for a new bucket.

## 4. Restore configuration and secrets

1. Deploy the main Worker with new `APP_PASSWORD`, `ADMIN_PASSWORD`, `SESSION_SECRET`, and `COMPANION_KEY` secrets.
2. Log in using the new admin password.
3. Admin → Backup settings → import the old JSON.
4. Test every storage and R2 configuration.
5. If using the external audio proxy, set `STREAM_PROXY_SECRET` on the main Worker and the same value as `PROXY_SECRET` on the proxy Worker.

The settings JSON intentionally does not restore password hashes or session state.

## 5. Verify counts and behavior

```bash
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS albums FROM albums"
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS tracks FROM tracks"
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS artists FROM artists"
```

Then verify:

- Albums, tracks, artists, favorites, notes, hidden state, and ordering.
- One track per storage backend, including seeking.
- Cover, avatar, and gallery images.
- Listener cannot access hidden objects.
- Admin settings export works on the new deployment.
- If the R2 index was omitted, run prewarm: existing public objects are reclaimed with HEAD and only missing objects are uploaded.

## 6. Cutover and rollback

Only update the companion `[cloud].url` after verification. Keep the old database, old deployment, SQL backup, settings JSON, and source audio until the new deployment has passed a restore test.

Rollback is either switching the URL back to the old deployment or importing the pre-import remote SQL backup into a clean D1 database. Never delete the only audio copy during a database cutover.

## Remote-to-remote migration

For two Cloudflare deployments, export the old remote D1 and import it into the new remote after applying the schema. Keep the same separation: D1 SQL for catalog, Admin JSON for config, Worker secrets set independently.
