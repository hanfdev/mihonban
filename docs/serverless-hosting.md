# Cloudflare serverless hosting

[中文](serverless-hosting.zh.md)

The serverless goal is to keep login, browsing, and playback online while the home computer is off. The supported shape is one Worker serving the React app and API, D1 + KV, optional R2 for images, and audio stored in OneDrive, WebDAV, or Google Drive.

## Workload fit

| Work | Cloudflare Workers fit |
|---|---|
| React assets and short API requests | Good |
| D1 catalog/settings and KV short cache | Good |
| RSS/Atom/Blogger source reminders | Good with Cron Trigger |
| Range streaming from storage | Supported, subject to network and plan limits |
| Inbox watching, archive extraction, beets, bulk tag edits | Not supported; use the local companion |
| Transcoding or persistent local-folder scans | Not supported; use Node/NAS tooling |

## Recommended topology

```text
Browser
  |
Cloudflare Worker (API + React assets)
  |-- D1: catalog and settings
  |-- KV: rate limits and short-lived cache
  |-- optional R2: image mirror
  +-- OneDrive / WebDAV / Google Drive: audio and originals
```

Follow [Install and deploy](install.md). Before moving a local catalog, follow [Database migration](database-migration.md); importing Admin settings alone does not restore albums.

## Does the home computer need to stay on?

No, not for web login, browsing, playback, web imports, or the scheduled source scan. Turn it on only for local inbox processing, local/cloud reconciliation, offline backups, or other companion tasks.

Cloudflare Workers cannot see a home directory or wait for filesystem events. To run the inbox continuously, place the Python companion on an always-on NAS or low-power host. That device organizes and synchronizes files; the web app still runs independently in Cloudflare.

## Free does not mean unlimited

Workers, D1, KV, and R2 quotas and pricing can change; use the current Cloudflare dashboard and official documentation as the authority. The project's free-tier assumption is a personal library or a few listeners, not large public distribution or continuous terabyte-scale lossless audio relay.

OneDrive temporary URLs commonly bypass the Worker. WebDAV, Google Drive, and an explicitly enabled audio proxy transfer bytes through a Worker and consume more platform resources.

## External audio proxy

Test the main deployment first. Add the separate proxy only when measurement shows that another Worker route or custom domain improves the path. It is a signed, allowlisted relay, not a public CDN, and it does not guarantee higher speed. See [Optional Cloudflare audio proxy](audio-proxy.md).

## Launch checklist

- Worker URL/custom domain opens over HTTPS.
- Listener, administrator, and optional passwordless guest permissions are correct.
- Playback and seeking work on desktop, iOS Safari, and Android Chrome.
- Hidden content is unavailable to listeners at API level.
- Every named storage backend is tested; one write target is selected.
- Optional R2 images and proxy are tested independently.
- D1 SQL, Admin settings JSON, runtime secrets, and audio backups are all accounted for.
- No secret appears in Git, documentation, logs, or screenshots.
