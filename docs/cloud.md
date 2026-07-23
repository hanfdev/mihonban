# Architecture and runtime model

[中文](cloud.zh.md)

Mihonban uses the same React frontend and Worker-compatible API in local and cloud deployments. The persistence and file-access adapters change by runtime.

## Components

| Component | Node | Wrangler local | Cloudflare | Authority |
|---|---:|---:|---:|---|
| React assets | Yes | Yes | Yes | Rebuildable |
| Hono API | Yes | Yes | Yes | Stateless application layer |
| Catalog database | SQLite | Local D1 | Remote D1 | Authoritative metadata |
| Rate-limit/cache KV | SQLite adapter | Local KV | Cloudflare KV | Rebuildable |
| R2 image mirror | Optional | Optional binding | Optional | Rebuildable image cache |
| Local-folder backend | Yes | No | No | Authoritative files when configured |
| OneDrive/WebDAV/Google Drive | Yes | Yes | Yes | Authoritative files |
| Python companion | External process | External process | External process | Optional local workflow |

Audio files never belong in D1, KV, R2 image cache, or Git.

## Request path

```text
Browser --HTTP/HTTPS--> API runtime
                         |-- catalog metadata: SQLite or D1
                         |-- short cache/rate limit: KV adapter
                         |-- image mirror: optional R2
                         +-- named storage backend

OneDrive temporary URL ---------> usually 302 direct playback
WebDAV / Google Drive ----------> main API Range proxy
Node local folder --------------> Node Range stream
Optional external proxy --------> signed five-minute relay for temporary URLs
```

The external proxy only receives sources for which the main API can obtain a temporary URL. It never receives WebDAV, Google Drive, or local-folder credentials.

## Authentication and roles

- Listener password (`APP_PASSWORD` bootstrap): browse and play.
- Administrator password (`ADMIN_PASSWORD` bootstrap): all writes and infrastructure settings.
- Passwordless guest mode: an explicit Admin toggle that grants the listener role without a password.
- Companion key (`COMPANION_KEY`): optional `X-Api-Key` used by the local Python companion.

Passwords changed in Admin are stored as PBKDF2 hashes and take precedence over bootstrap environment values. Changing a password increments the session epoch and revokes existing login cookies. Login failures are counted per source IP; six failures lock that source for 15 minutes.

Production cookies require HTTPS. `DEV_INSECURE_COOKIE=1` exists only for trusted local HTTP testing.

## Data model

- `albums`: album metadata, named `storage_id`, hidden state, and ordering fields.
- `tracks`: track metadata and storage-relative path; tracks inherit the album backend.
- `artists`: artist metadata, hidden state, avatar path, and independent avatar `storage_id`.
- `album_images`: gallery paths on the album backend.
- `favorites`: album/track favorites and order.
- `notes`: album notes, artist notes, and biographies.
- `storages`: named OneDrive, WebDAV, Google Drive, or Node-local configurations.
- `settings`: password hashes, module flags, R2 configuration, source settings, and other runtime state.
- `source_posts`, `track_imports`, and image-cache tables: operational metadata.

The Admin settings JSON exports an allowlisted subset of settings plus named storage configurations, including credentials. It excludes catalog rows, password hashes, and old sessions. Store it encrypted.

## Upload and playback

- A single named backend is selected as the write target for new uploads.
- Existing albums retain their own `storage_id`; changing the write target does not move them.
- OneDrive uses an upload session and temporary download URLs.
- WebDAV and Google Drive uploads/streams pass through the main API.
- Node local-folder files are streamed by the Node runtime only.
- Range and `Content-Range` behavior are required for reliable seeking, especially on iOS.

## Images

Without R2, the API reads images from the owning storage and uses edge/browser cache headers. With R2 enabled, a first request or prewarm copies the image into the mirror and later requests can redirect to its public URL. Replacing an image invalidates its index so it can be mirrored again.

R2 is not an audio backend and is not the catalog database.

## Scheduled work

Cloudflare uses the Wrangler Cron trigger at minute 17 every six hours. Node uses `SOURCE_SCAN_HOURS` (default `6`, `0` disables it). Source scanning reads supported RSS/Atom/Blogger titles and links; it does not download music.

`mihonban watch` is different: it watches a real local inbox and invokes 7-Zip/beets. It must run on a computer or NAS that can access that directory and cannot run inside Cloudflare Workers.

## Backup and recovery layers

1. Catalog: SQLite-aware backup or D1 logical SQL export.
2. Configuration: Admin settings JSON, encrypted at rest.
3. Runtime secrets: password manager or deployment secret store.
4. Audio and original images: independent storage-level backup.
5. KV and R2 image index: rebuild instead of migrating.

See [Database backup, migration, and recovery](database-migration.md) for the complete order.

## Hosting boundaries

Cloudflare's free plan can suit a personal library or a few listeners, but quotas and terms change. API requests, D1 rows, KV operations, R2, and proxied audio all consume platform resources. OneDrive temporary URLs commonly bypass the Worker; WebDAV, Google Drive, local Node streams, and enabled proxy routes do not.

Workers cannot access a home computer's folders, stay resident for filesystem events, transcode audio, run beets, or extract archives. Keep those jobs in the optional companion.

## Diagnostics

Cloudflare:

```bash
cd cloud/worker
npx wrangler tail
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc \
  --command "SELECT COUNT(*) AS albums FROM albums"
```

Local Wrangler uses the same command with `--local`. Node users should verify `DATA_DIR`, the startup log, and the Admin system status. Never print refresh tokens, signed audio URLs, settings exports, or request authorization headers in logs.
