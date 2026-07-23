# mihonban / 見本盤

[简体中文](README.zh.md)

Mihonban is a private, self-hosted music library with a responsive web player. Run it locally with Node and SQLite, use Wrangler's local D1 emulator, or deploy the same application to Cloudflare Workers and D1. Audio remains in storage you control.

## Highlights

- Responsive album, track, artist, favorites, import, and administration views
- Listener and administrator passwords, plus an optional passwordless read-only guest mode
- Persistent playback queue, shuffle/repeat, Range seeking, Media Session support, and mobile gestures
- Named OneDrive, WebDAV, Google Drive, and Node-only local-folder storage backends
- Optional R2 image mirror for covers, galleries, and artist avatars
- Discogs API imports and manual RYM HTML parsing without automated RYM requests
- Optional Python companion for inbox folders, single/nested archives, tag repair, and cloud synchronization
- English, Simplified Chinese, Traditional Chinese, Japanese, Korean, French, and Spanish interfaces
- SQLite/D1 migration tools and an optional signed audio proxy Worker

## Runtime choices

| Runtime | Metadata database | File backends | Typical use |
|---|---|---|---|
| Node | `<DATA_DIR>/mihonban.sqlite` | OneDrive, WebDAV, Google Drive, local folder | Local network, NAS, VPS |
| Wrangler local | Local D1/KV under `.wrangler/` | OneDrive, WebDAV, Google Drive | Cloudflare-compatible development |
| Cloudflare | D1 + KV, optional R2 | OneDrive, WebDAV, Google Drive | Always-online serverless deployment |

The Python companion is optional in every mode. Install it only when you need local inbox watching, archive extraction, tag organization, or local-to-cloud reconciliation.

## Quick start

Clone the canonical repository:

```bash
git clone https://github.com/hanfdev/mihonban.git
cd mihonban
```

### Local Wrangler app

On Windows, the helper stages build files outside OneDrive and starts Wrangler on all network interfaces:

```powershell
tools\cloud-dev.cmd
```

Open `http://127.0.0.1:8787`. A phone on the same LAN can use `http://<computer-lan-ip>:8787` after the Windows firewall permits Node.js. The helper's first local secrets file uses listener password `mihonban-guest` and administrator password `mihonban-admin`; change both in Admin before sharing the service.

For a manual Wrangler setup, see [Install and deploy](docs/install.md).

### Local Node + SQLite app

```bash
cd cloud/web
npm ci
npm run build
cd ../worker
npm ci
# Copy .env.example to .env, replace every placeholder, and set DEV_INSECURE_COOKIE=1 for local HTTP.
npm run node
```

Node listens on `0.0.0.0:8788` by default. Its database is `cloud/worker/data/mihonban.sqlite` unless `DATA_DIR` is set. There are no built-in Node passwords: `.env` must define `APP_PASSWORD`, `ADMIN_PASSWORD`, and a `SESSION_SECRET` of at least 32 characters.

### Cloudflare

Build the web app, create D1 and KV, set Worker secrets, apply `schema.sql`, and deploy. The manual path is canonical; the local Python companion is not required. Follow [Install and deploy](docs/install.md) and read [Database migration](docs/database-migration.md) before moving an existing local catalog.

### Optional Python companion

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# POSIX:   source .venv/bin/activate
pip install -e ./pipeline
mihonban setup
mihonban doctor
```

Keep `music_root`, `data_dir`, databases, and temporary files outside OneDrive, Dropbox, iCloud, or any other synchronized directory.

## Data and backups

| Data | Source of truth | Backup method |
|---|---|---|
| Albums, tracks, artists, favorites, notes | Node SQLite or D1 | SQLite-aware backup or logical SQL export |
| Named storage, R2, and module settings | Database settings | Admin settings JSON; store encrypted |
| Password bootstrap, session, companion, and proxy secrets | Runtime environment | Record separately in a password manager |
| Audio and original images | Configured storage backend | Independent storage-level backup |
| R2 image mirror and KV caches | Rebuildable cache | Re-prewarm; no migration required |

An Admin settings JSON is not a catalog backup, and a database backup is not an audio backup.

## Repository map

| Path | Purpose |
|---|---|
| `cloud/web/` | React player and administration UI |
| `cloud/worker/` | Hono API, D1 schema, Node compatibility runtime |
| `cloud/proxy-worker/` | Optional signed audio relay |
| `pipeline/` | Python `mihonban` CLI and ingest/sync pipeline |
| `config/` | Safe configuration templates |
| `tools/` | Local development, deployment, watcher, and migration helpers |
| `tests/` | Python regression tests |

## Common commands

```text
mihonban setup                  create local companion config
mihonban doctor                 verify dependencies and paths
mihonban ingest --apply         process inbox archives or album folders
mihonban watch                  watch the inbox and reconcile cloud data
mihonban cloud sync             upload/register local albums
mihonban cloud pull             pull web imports back to the local library
mihonban rym parse|match|write  process manually saved RYM HTML

cd cloud/worker && npm test
cd cloud/proxy-worker && npm test
cd cloud/web && npm test && npm run build
python -m pytest -q
```

## Security

- Never commit `.dev.vars`, `.env`, `mihonban.toml`, `rclone.conf`, databases, settings exports, tokens, or audio.
- Local HTTP requires `DEV_INSECURE_COOKIE=1`; public deployments require HTTPS and must leave it unset.
- Password changes saved in Admin override bootstrap environment passwords and revoke existing sessions.
- Keep `STREAM_PROXY_SECRET` and `PROXY_SECRET` identical and private when the external proxy is enabled.
- RYM support only parses files saved manually by the user; this repository contains no RYM crawler.
- Keep at least one independent copy of irreplaceable audio.

## Documentation

| English | 中文 |
|---|---|
| [Install and deploy](docs/install.md) | [安装与部署](docs/install.zh.md) |
| [Architecture and runtime](docs/cloud.md) | [云端架构与运行模型](docs/cloud.zh.md) |
| [Daily operation](docs/manual.md) | [日常使用手册](docs/manual.zh.md) |
| [Database migration](docs/database-migration.md) | [数据库迁移](docs/database-migration.zh.md) |
| [Storage and file migration](docs/storage.md) | [多存储与文件迁移](docs/storage.zh.md) |
| [Serverless hosting](docs/serverless-hosting.md) | [纯 Cloudflare 托管](docs/serverless-hosting.zh.md) |
| [Optional audio proxy](docs/audio-proxy.md) | [可选音源代理](docs/audio-proxy.zh.md) |
| [Publishing safely](docs/github-publish.md) | [安全发布代码](docs/github-publish.zh.md) |

## License

Mihonban is licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). If you modify the software and make it available over a network, the AGPL requires you to offer the corresponding source code of that version.

The license covers this repository's code and safe templates only. It does not grant rights to distribute music or third-party metadata.
