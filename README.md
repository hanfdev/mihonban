# mihonban / 見本盤

A private rare-music library with a Cloudflare-hosted web player and an optional local ingest pipeline.

The current product is the React app in `cloud/web`, backed by the API in `cloud/worker`. Audio stays in storage you control; D1 stores the catalog and user-authored metadata.

## What it includes

- Responsive album, track, artist, favorite, import, and admin views
- Password roles for listeners and administrators, plus optional read-only guest access
- Playback queue, shuffle/repeat, Range streaming, and persistent player state
- OneDrive, WebDAV, Google Drive, and Node-only local-folder backends
- R2 image mirroring for covers, galleries, and artist avatars
- Discogs imports and manual RYM HTML parsing without automated RYM requests
- Optional Python inbox pipeline for folders and single/nested archives, Japanese encoding repair, tags, and cloud sync
- Seven UI languages: English, 简体中文, 繁體中文, 日本語, 한국어, Français, Español
- D1 migration tooling and an optional signed audio proxy Worker

## Architecture

```text
Browser / PWA
    |
    v
Cloudflare Worker + React assets
    |-- D1: albums, tracks, artists, favorites, notes, storage bindings
    |-- KV: rate limits and short-lived caches
    |-- R2: optional image mirror
    +-- OneDrive / WebDAV / Google Drive: audio and source images

Optional local Python companion --> metadata API + configured audio storage
Optional proxy Worker  --> signed, allowlisted audio relay with Range support
```

The Worker is the recommended production runtime. `cloud/worker/src/node.js` runs the same API on Node with SQLite and also enables local-folder storage. A local desktop player can be used independently but is not part of this repository's runtime.

## Quick start

### Optional local pipeline

Cloud-only deployments can skip this section. Install it only for inbox watching, archive processing, tag cleanup, or local-to-cloud synchronization.

```bash
git clone https://github.com/<you>/mihonban.git
cd mihonban
python -m venv .venv
# Windows: .venv\Scripts\activate
# POSIX:   source .venv/bin/activate
pip install -e ./pipeline
mihonban setup
mihonban doctor
```

Keep `music_root`, `data_dir`, databases, and temporary files outside OneDrive, Dropbox, or similar sync folders.

### Local cloud app

```bash
cd cloud/web
npm ci
npm run build
cd ../worker
npm ci
npx wrangler d1 execute mihonban --local --file schema.sql
npm run dev
```

The D1 database resource and Worker product are both named `mihonban`.

Create `cloud/worker/.dev.vars` from `.env.example`. For plain local HTTP, set `DEV_INSECURE_COOKIE=1`. Open the URL printed by Wrangler, normally `http://127.0.0.1:8787`.

### Cloudflare deployment

Windows users who also want the local companion can run the combined wizard:

```powershell
tools\deploy-cloud.cmd
```

For a cloud-only deployment without a companion or watcher, follow the manual steps in [docs/install.md](docs/install.md) or [docs/install.zh.md](docs/install.zh.md).

## Database migration

Catalog data and runtime settings are backed up separately:

```powershell
# Auto-detect the Node SQLite or local Wrangler D1 database and import
# library data into the remote D1 named mihonban (also keeps a local SQL backup).
powershell -File tools\migrate-d1.ps1 -ImportRemote
```

The default SQL contains library data but no settings or storage credentials. Export the settings JSON from Admin before moving, then import it after the D1 data. See [docs/database-migration.md](docs/database-migration.md).

## Optional audio proxy

`cloud/proxy-worker` is a separate standard Cloudflare Worker for audio relay. It supports Range/HEAD, validates a short-lived HMAC signature, restricts upstream hosts, and checks redirects. It is not an open proxy and does not cache private audio.

See [docs/audio-proxy.md](docs/audio-proxy.md). Acceleration is network-dependent; the proxy provides a controlled relay, not guaranteed faster throughput.

## Repository map

| Path | Purpose |
|---|---|
| `cloud/web/` | Main React player and admin UI |
| `cloud/worker/` | Hono API, D1 schema, Node compatibility runtime |
| `cloud/proxy-worker/` | Optional signed audio proxy |
| `pipeline/` | Python `mihonban` CLI and ingest/sync pipeline |
| `config/` | Safe configuration templates |
| `tools/` | Deployment, watcher, and database migration helpers |
| `tests/` | Python regression tests |

## Common commands

```text
mihonban setup                 create portable local config
mihonban doctor                verify dependencies and paths
mihonban ingest --apply        process inbox archives or album folders
mihonban watch                 watch the inbox and periodically reconcile cloud data
mihonban cloud sync            upload/register local albums
mihonban cloud pull            pull web imports back to the local library
mihonban rym parse|match|write parse manually saved RYM HTML and write tags

cd cloud/worker && npm test
cd cloud/proxy-worker && npm test
cd cloud/web && npm run build
```

## Security and data ownership

- Never commit `.dev.vars`, `.env`, `mihonban.toml`, `rclone.conf`, SQL backups, tokens, or audio.
- Production cookies require HTTPS. Guest access is disabled unless you enable it.
- External proxy URLs should always use the shared `STREAM_PROXY_SECRET` / `PROXY_SECRET` signing secret.
- RYM support parses files saved manually by the user; the project contains no RYM crawler.
- Keep at least one independent backup of rare audio. D1 metadata backup is not an audio backup.

## Documentation

| Document | Scope |
|---|---|
| [README.zh.md](README.zh.md) | Chinese overview |
| [GOAL.md](GOAL.md) | Current product goals and non-negotiable boundaries |
| [docs/install.md](docs/install.md) / [中文](docs/install.zh.md) | Install and deployment |
| [docs/database-migration.md](docs/database-migration.md) / [中文](docs/database-migration.zh.md) | D1 backup, migration, and recovery |
| [docs/audio-proxy.md](docs/audio-proxy.md) / [中文](docs/audio-proxy.zh.md) | Optional audio proxy |
| [docs/storage.md](docs/storage.md) / [中文](docs/storage.zh.md) | Multi-backend storage |
| [docs/manual.md](docs/manual.md) | Daily operator guide (Chinese) |
| [docs/github-publish.md](docs/github-publish.md) / [中文](docs/github-publish.zh.md) | Publishing the code safely |

## License

Mihonban is licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). If you modify the software and make it available over a network, the AGPL requires you to offer the corresponding source code of that version.

The license covers this repository's code and configuration templates only. It does not grant rights to distribute music or third-party metadata.
