# Install and deploy

[中文](install.zh.md)

This guide covers the three supported runtimes and the optional local Python companion. Choose one application runtime; the companion is an additional workflow tool, not a server requirement.

## 1. Prerequisites

- Node.js 22 or newer
- Git
- Cloudflare account only when deploying to Cloudflare
- OneDrive, WebDAV, or Google Drive for a Cloudflare deployment
- Python 3.11 or newer and 7-Zip (`7z`, `7zz`, or `7za`) only for the local companion
- Optional `rclone` for companion-driven local-to-cloud file synchronization

Do not place live SQLite databases, `music_root`, `data_dir`, temporary directories, or `node_modules` in OneDrive, Dropbox, iCloud, or another synchronized folder. The repository itself may be synchronized if build and mutable data are staged elsewhere.

Clone the canonical repository:

```bash
git clone https://github.com/hanfdev/mihonban.git
cd mihonban
```

## 2. Choose a runtime

| Runtime | Default URL | Database | Local-folder storage |
|---|---|---|---:|
| Wrangler local | `http://127.0.0.1:8787` | Local D1/KV emulator | No |
| Node | `http://127.0.0.1:8788` | `<DATA_DIR>/mihonban.sqlite` | Yes |
| Cloudflare | Worker URL/custom domain | Remote D1 + KV | No |

Wrangler local most closely matches production Cloudflare. Node is better for a permanent local/NAS service and is the only runtime that can read a server-local folder backend.

## 3. Local Wrangler development

### Windows helper

When the repository is under OneDrive, use:

```powershell
tools\cloud-dev.cmd
```

The helper copies `cloud/` to `%TEMP%\mihonban-cloud-build` by default, installs dependencies there, builds React, applies the local schema, and starts Wrangler on `0.0.0.0:8787`. Set `MIHONBAN_STAGE` to another non-synchronized directory to retain its local D1 across temporary-directory cleanup.

On first run it generates `.dev.vars` with:

```text
APP_PASSWORD=mihonban-guest
ADMIN_PASSWORD=mihonban-admin
```

The remaining secrets are random. These two passwords are local-development defaults only. Change them in Admin before allowing another person to connect.

### Manual Wrangler setup

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
# Create .dev.vars from .env.example and replace all placeholders.
# Set DEV_INSECURE_COOKIE=1 for local HTTP.
npx wrangler d1 execute DB --local --file schema.sql
npx wrangler dev --ip 0.0.0.0 --port 8787
```

Without the staging helper, local state is under `cloud/worker/.wrangler/`. Both `.wrangler/` and `.dev.vars` are ignored by Git.

For phone testing, connect the phone to the same LAN, allow Node.js through the host firewall, and open `http://<computer-lan-ip>:8787`. Do not expose this plain-HTTP development server to the Internet.

## 4. Local Node + SQLite

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
# Windows: Copy-Item .env.example .env
# POSIX:   cp .env.example .env
npm run node
```

Before starting, edit `.env`:

```dotenv
APP_PASSWORD=choose-a-listener-password
ADMIN_PASSWORD=choose-a-separate-admin-password
SESSION_SECRET=at-least-32-random-characters
DEV_INSECURE_COOKIE=1
DATA_DIR=D:/mihonban-data
PORT=8788
```

There are no built-in Node passwords. `APP_PASSWORD` is the listener password; passwordless guest access is a separate Admin toggle. The server binds `0.0.0.0`, so `http://<computer-lan-ip>:8788` works on the LAN after the firewall permits the port.

The database is `<DATA_DIR>/mihonban.sqlite`; when `DATA_DIR` is unset it defaults to `cloud/worker/data/`. Back it up while the app is stopped or with SQLite-aware tooling. Public Node deployments require HTTPS behind a trusted platform or reverse proxy. Set `TRUST_PROXY=1` only when requests always pass through a proxy you control.

## 5. Optional Python companion

Skip this section when web upload/import is sufficient. Install the companion for inbox watching, folders or single/nested archives, tag repair, local organization, and local/cloud reconciliation.

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -e ./pipeline
mihonban setup
mihonban doctor
```

`mihonban setup` writes a private TOML outside the repository. `MIHONBAN_CONFIG` is the current override variable, not a legacy alias. Lookup order is explicit `--config`, `MIHONBAN_CONFIG`, `./mihonban.toml`, then the platform user config directory.

Common commands:

```text
mihonban ingest --apply
mihonban watch
mihonban cloud sync
mihonban cloud pull
```

The companion cannot run inside Cloudflare Workers because it requires a persistent local filesystem and external tools such as 7-Zip and beets.

## 6. Cloudflare deployment

The manual path is canonical and does not require the companion.

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

Copy the returned D1 database ID and KV namespace ID into `cloud/worker/wrangler.jsonc`, replacing the zero placeholders. Then run:

```bash
npx wrangler d1 execute mihonban --remote --file schema.sql
npx wrangler secret put APP_PASSWORD
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

Cloudflare deployment has no default listener or administrator password. Enter unique values, and use at least 32 random characters for `SESSION_SECRET`. Add `COMPANION_KEY` only when a local companion will call the deployment:

```bash
npx wrangler secret put COMPANION_KEY
npx wrangler deploy
```

The same Worker serves `/api/*` and the built React assets. A separate frontend host is unnecessary.

### Optional Windows combined wizard

`tools\deploy-cloud.cmd` provisions Cloudflare resources, prompts for both passwords, uploads random session/companion secrets, writes the companion `[cloud]` section, performs the first sync, and installs the watcher. Use it only for the combined Windows workflow; cloud-only users should use the manual commands above.

## 7. Configure storage

Sign in as administrator and add a named backend. One backend must be selected as the write target before uploads.

### OneDrive

Create an Azure application with delegated file read/write and offline access. Enter client ID, client secret, refresh token, and drive ID in Admin, then test the backend. OneDrive playback normally uses a temporary URL and may bypass the Worker.

### WebDAV

Enter the library root URL and credentials. Playback and upload pass through the main Worker because WebDAV has no temporary public download URL.

### Google Drive

Enable Drive API and create a Desktop OAuth client. Generate the authorization URL in Admin, approve it, copy the `code` from the `http://localhost` redirect when necessary, exchange it, then test and add the backend. Writable Drive scope is required for existing-library discovery and uploads.

### Local folder

Available only in the Node runtime. The configured root must stay within the server's filesystem and is not portable to Cloudflare. See [Storage backends and file migration](storage.md).

## 8. Optional R2 image mirror

R2 is a rebuildable image mirror, not the catalog database or an audio backend. Create a bucket, public read URL, and S3-compatible read/write token; enter them in Admin, test, enable, and prewarm. Keep the access key and secret out of Git.

## 9. Move an existing database

Do not create an empty deployment and assume settings restore will bring albums back. Catalog data, settings, runtime secrets, and audio are separate layers. Follow [Database backup, migration, and recovery](database-migration.md) before switching runtimes.

## 10. Optional audio proxy

The main Worker already proxies backends that need private credentials. Deploy `cloud/proxy-worker` only when a second Cloudflare route or custom domain measurably improves temporary-URL playback. See [Optional Cloudflare audio proxy](audio-proxy.md).

## 11. Updates

Before a significant update, back up the database and Admin settings JSON.

Cloudflare:

```bash
git pull
cd cloud/web && npm ci && npm run build
cd ../worker && npm ci
npx wrangler d1 execute mihonban --remote --file schema.sql
npx wrangler deploy
```

Node: rebuild `cloud/web`, reinstall Worker dependencies, stop the old process, and restart `npm run node`. `schema.sql` is repeatable and runtime migrations add columns required by older databases.

## 12. Verification

- Log in with listener and administrator passwords; test passwordless guest mode only if enabled.
- Open library, tracks, artists, favorites, import, and Admin routes.
- Play a track, seek near the end, and test the system media controls on iOS/Android.
- Open a cover, artist avatar, and album gallery; test gallery swiping on mobile.
- Verify hidden albums, tracks, artists, styles, images, search results, and favorites are unavailable to listeners.
- Upload one disposable album to the selected write target, then remove it.
- Export both a database backup and Admin settings JSON.

## Troubleshooting

| Symptom | Check |
|---|---|
| Login returns immediately to the login page | Local HTTP needs `DEV_INSECURE_COOKIE=1`; public deployment needs HTTPS |
| Old environment password is rejected | A password saved in Admin is stored as a hash and takes precedence |
| Stream returns 502 | Named backend binding, credentials, relative path, and upstream Range support |
| Existing albums are missing | Restore the catalog database; settings JSON does not include albums |
| Wrangler appears empty | Confirm whether the command is using `--local` or `--remote`, and which stage directory owns `.wrangler/` |
| Node appears empty | Confirm `DATA_DIR` points to the intended `mihonban.sqlite` |
| Phone cannot connect | Use the LAN IP, bind `0.0.0.0`, and allow the selected port through the firewall |
| Login returns 429 | Stop retrying and wait 15 minutes for the source-IP lockout to expire |
