# Install and deploy

This guide starts with a cloud-only Cloudflare deployment and also covers the optional local Python companion, local development, and the alternate Node runtime.

## 1. Prerequisites

- Node.js 22 or newer
- Git
- A Cloudflare account for production
- One supported audio store: OneDrive, WebDAV, or Google Drive
- Required only for the local companion: Python 3.11 or newer and 7-Zip (`7z` or `7zz`)
- Optional: `rclone` for local-to-cloud file sync

Never place `music_root`, `data_dir`, SQLite files, temporary files, or `node_modules` inside a cloud-sync folder.

## 2. Optional local companion

Skip this section when you upload/import through the web app and host the site, database, and storage access in Cloudflare and your cloud drive. Login, browsing, playback, web imports, and the source-feed Cron continue to work while your computer is off.

Install the companion only for local automation: watching an inbox, processing folders or single/nested archives, repairing tags, organizing a local library in bulk, and syncing local files to the cloud.

```bash
git clone https://github.com/<you>/mihonban.git
cd mihonban
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -e ./pipeline
mihonban setup
mihonban doctor
```

`mihonban setup` writes a portable TOML config outside the repository. Set `MIHONBAN_CONFIG` when it is not in the default platform config directory.

Useful first commands:

```bash
mihonban ingest --apply
mihonban watch
mihonban cloud sync
```

## 3. Local Worker development

Create `cloud/worker/.dev.vars` from `.env.example`. Use non-production credentials. Plain HTTP requires `DEV_INSECURE_COOKIE=1`; never set it in an HTTPS deployment.

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
npx wrangler d1 execute mihonban --local --file schema.sql
npm run dev
```

Wrangler normally serves the app at `http://127.0.0.1:8787`. Local D1 data is stored under `cloud/worker/.wrangler/` and is ignored by Git.

## 4. Cloudflare deployment

### Windows wizard

```powershell
tools\deploy-cloud.cmd
```

This wizard is for the combined “Cloudflare + local companion” workflow. It writes the local `[cloud]` config, runs the first sync, and installs the Windows watcher. A cloud-only deployment does not need the wizard; use the manual steps below.

### Manual deployment

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
npx wrangler login
npx wrangler d1 create mihonban
npx wrangler kv namespace create KV
```

The D1 resource is named `mihonban`, matching the Worker and CLI.

Copy the returned D1 and KV IDs into `cloud/worker/wrangler.jsonc`, then run:

```bash
npx wrangler d1 execute mihonban --remote --file schema.sql
npx wrangler secret put APP_PASSWORD
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

Use a random `SESSION_SECRET` of at least 32 bytes. If you install the local companion, also run `npx wrangler secret put COMPANION_KEY` with a separate random value; cloud-only deployments may omit it. Configure every storage location after signing in as administrator; OneDrive uses the same named-storage model as WebDAV, Google Drive, and local folders.

The default deployment serves both `/api/*` and the React assets from one Worker origin. A separate Vercel or Netlify frontend is unnecessary and makes cookie/CORS handling more complex.

## 5. Storage setup

### OneDrive

Create an Azure application with delegated file read/write and offline access, obtain a refresh token and drive ID, then enter client ID, client secret, refresh token, and drive ID in Admin. Test the connection before importing music.

### WebDAV

Enter the library root URL and credentials. WebDAV audio is proxied through the main Worker because it has no temporary public download URL.

### Google Drive

1. Enable Google Drive API.
2. Create a Desktop OAuth client.
3. In Admin, generate the authorization URL and approve access.
4. Google redirects to `http://localhost`; copy the `code` from the address bar if no local page is listening.
5. Exchange the code, test, and add the backend.

The app requests writable Drive access so it can find an existing library and upload files.

See [storage.md](storage.md) for storage bindings and file migration.

## 6. R2 image mirror

R2 is optional but recommended for medium or large libraries:

1. Create a bucket and public read URL.
2. Create an S3-compatible token with bucket read/write access.
3. Enter endpoint, bucket, public URL, access key, and secret in Admin.
4. Test, enable, then prewarm images.

R2 contains image mirrors, not the authoritative album database. Its index can be rebuilt.

## 7. Existing database migration

Do not run a first `mihonban cloud sync` if the authoritative catalog already exists locally. Deploy the empty schema, migrate D1 data, restore the Admin settings JSON, and then verify storage.

Follow [database-migration.md](database-migration.md). The Windows helper is:

```powershell
powershell -File tools\migrate-d1.ps1 -ImportRemote
```

## 8. Node runtime

The same API can run on Node with SQLite:

```bash
cd cloud/web && npm ci && npm run build
cd ../worker && npm ci
cp .env.example .env
node src/node.js
```

Set a persistent `DATA_DIR`; the database is `<DATA_DIR>/mihonban.sqlite`. Back up the database with the app stopped or by using SQLite-aware backup tooling. Node mode also enables the `local` storage backend.

Public Node deployments require HTTPS through the platform, Caddy, or another reverse proxy. Do not expose plain HTTP login cookies.

## 9. Optional audio proxy

The main Worker can proxy audio itself. Deploy `cloud/proxy-worker` only when a second Cloudflare route or custom domain improves your network path. Follow [audio-proxy.md](audio-proxy.md); use signing in production.

## 10. Update procedure

```bash
git pull
cd cloud/web && npm ci && npm run build
cd ../worker && npm ci
npx wrangler d1 execute mihonban --remote --file schema.sql
npx wrangler deploy
```

Back up D1 and Admin config before a significant upgrade. `schema.sql` is repeatable; runtime migrations cover columns added to older databases.

## 11. Verification

- Login as listener and administrator.
- Open library, tracks, artists, favorites, and Admin.
- Play a track and seek to a different position.
- Load one cover, artist avatar, and gallery image.
- Upload or register one test album, then remove it.
- Confirm hidden content is unavailable to a listener.
- Export a D1 backup and Admin settings backup.

## Troubleshooting

| Symptom | Check |
|---|---|
| Login succeeds but immediately returns to login | HTTPS cookie policy; local HTTP needs `DEV_INSECURE_COOKIE=1` |
| Stream returns 502 | Storage credentials, file path, backend binding, upstream Range behavior |
| Existing albums are missing after a new deployment | Restore D1 data; config JSON alone does not contain albums |
| Covers are slow | Enable R2 and prewarm |
| Google Drive cannot see old folders | Reauthorize with the current Drive scope |
| Wrangler reads the wrong database | Use `--local` or `--remote` explicitly |
