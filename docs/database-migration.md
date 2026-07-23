# Database backup, migration, and recovery

[中文](database-migration.zh.md)

This document moves a catalog between local Node SQLite, local Wrangler D1, and remote Cloudflare D1.

If you remain local, back up `<DATA_DIR>/mihonban.sqlite`, the Admin settings JSON, runtime secrets, and audio separately. The remote sections apply only when a Cloudflare deployment actually exists.

## What must be moved

| Data | Migration path |
|---|---|
| Albums, tracks, artists, galleries, favorites, notes, source posts | D1 SQL export/import |
| OneDrive/R2/module settings and named storage configs | Admin settings JSON |
| App/admin password, session secret, companion key, proxy signing secret | Configure as target Worker secrets |
| KV rate limits and short-lived caches | Do not migrate |
| R2 cache index | Rebuild with image prewarm |
| Audio and original images | Copy/migrate in the storage layer; not part of D1 |

The Admin JSON alone is not a catalog backup. A D1 SQL file alone does not contain audio or, by default, credentials.

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

Create D1/KV, place their IDs in `wrangler.jsonc`, and apply the schema:

```bash
cd cloud/worker
npm ci
npx wrangler d1 execute mihonban --remote --file schema.sql
```

The D1 resource is named `mihonban`, matching `wrangler.jsonc` and the Worker.

If the target already has important data, export it first:

```bash
mkdir -p ../../backups
npx wrangler d1 export mihonban --remote --output ../../backups/remote-before-import.sql
```

## 3. Export and import library data

### Windows helper

From the repository root:

```powershell
powershell -File tools\migrate-d1.ps1 -ImportRemote
```

The helper auto-detects the newest Node SQLite or local Wrangler D1 and writes a timestamped SQL file under ignored `backups/`. It writes remote D1 only when `-ImportRemote` is present; omit that switch for export only.

When several local databases exist, always pass `-Source` instead of relying on modification time.

Explicit source:

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -Database "mihonban" `
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
  --file ../../backups/mihonban-d1.sql
```

Default mode uses primary-key UPSERT and retains target rows absent from the source. A conflicting unique path with a different ID fails instead of deleting data silently. For a fresh target this produces an exact source catalog. `--replace` clears the included catalog tables first; only use it after a remote backup.

`--include-config` also exports `settings` and `storages`, but then the SQL contains secrets. The recommended flow is the separate Admin JSON instead.

## 4. Restore configuration and secrets

1. Deploy the main Worker with new `APP_PASSWORD`, `ADMIN_PASSWORD`, `SESSION_SECRET`, and `COMPANION_KEY` secrets.
2. Log in using the new admin password.
3. Admin → Backup settings → import the old JSON.
4. Test every storage and R2 configuration.
5. If using the external audio proxy, set `STREAM_PROXY_SECRET` on the main Worker and the same value as `PROXY_SECRET` on the proxy Worker.

The settings JSON intentionally does not restore password hashes or session state.

## 5. Verify counts and behavior

```bash
npx wrangler d1 execute mihonban --remote --command \
  "SELECT COUNT(*) AS albums FROM albums"
npx wrangler d1 execute mihonban --remote --command \
  "SELECT COUNT(*) AS tracks FROM tracks"
npx wrangler d1 execute mihonban --remote --command \
  "SELECT COUNT(*) AS artists FROM artists"
```

Then verify:

- Albums, tracks, artists, favorites, notes, hidden state, and ordering.
- One track per storage backend, including seeking.
- Cover, avatar, and gallery images.
- Listener cannot access hidden objects.
- Admin settings export works on the new deployment.
- R2 images are prewarmed again if the cache index was omitted.

## 6. Cutover and rollback

Only update the companion `[cloud].url` after verification. Keep the old database, old deployment, SQL backup, settings JSON, and source audio until the new deployment has passed a restore test.

Rollback is either switching the URL back to the old deployment or importing the pre-import remote SQL backup into a clean D1 database. Never delete the only audio copy during a database cutover.

## Remote-to-remote migration

For two Cloudflare deployments, export the old remote D1 and import it into the new remote after applying the schema. Keep the same separation: D1 SQL for catalog, Admin JSON for config, Worker secrets set independently.
