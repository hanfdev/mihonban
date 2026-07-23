# Storage backends and file migration

[English](storage.md) · [简体中文](storage.zh.md) · [繁體中文](storage.zh-Hant.md) · [日本語](storage.ja.md) · [한국어](storage.ko.md) · [Français](storage.fr.md) · [Español](storage.es.md)

mihonban separates catalog metadata from file storage. D1 knows which named backend owns each album; audio and source images remain in that backend.

## Data model

| Field/table | Meaning |
|---|---|
| `storages` | Named OneDrive, WebDAV, Google Drive, or Node-local backend configuration |
| `albums.storage_id` | Backend that contains the album folder; required |
| `artists.storage_id` | Backend that contains the artist avatar |
| `storages.is_write` | The single named target for new uploads; select one before uploading |

Track and gallery paths are relative storage paths. Tracks inherit the album backend; gallery images also use the album backend. Artist avatars have their own binding because an artist can span several disks.

## Supported backends

| Backend | Cloudflare | Node runtime | Playback path |
|---|---:|---:|---|
| OneDrive | Yes | Yes | Temporary URL, usually 302 |
| WebDAV | Yes | Yes | Main Worker Range proxy |
| Google Drive | Yes | Yes | Main Worker Range proxy |
| Local folder | No | Yes | Node Range stream |

A local-folder binding cannot play after moving the API to Cloudflare. Migrate those albums to a cloud backend before exporting D1.

## Write target

Changing the write target affects future uploads only. It does not move existing albums. Reads may span any number of configured backends.

Uploads are rejected when no backend has `is_write = 1`. Only one backend may be active at a time.

## Album migration

For one album, the Worker:

1. Enumerates tracks, cover, gallery images, and the artist avatar if it belongs to the same source backend.
2. Copies each object to the same relative path on the target.
3. Updates `albums.storage_id` only after every required copy succeeds.
4. Rebinds the copied avatar and invalidates image mirror indexes.
5. Leaves source objects untouched.

Bulk migration repeats the same resumable operation. Already-bound albums are skipped. Refreshing the page stops the client loop without undoing completed albums.

## Important limitations

- Migration copies bytes; it does not rewrite audio tags or directory layouts.
- Source files are not deleted automatically.
- Large proxy-based transfers consume Worker requests and execution time. Move large libraries in batches.
- R2 is an image mirror, not an audio backend.
- A database migration does not move files. The same relative paths must exist in the restored backend.

## Practical strategies

| Goal | Procedure |
|---|---|
| Add capacity | Add a backend and set it as the write target; keep old albums where they are |
| Move everything | Add/test target, bulk migrate, verify playback, then archive the source later |
| Move Node local storage to Cloudflare | While Node is still running, add a cloud backend and migrate local-bound albums before D1 export |
| Roll back a file move | Migrate back to a tested backend; source copies may already exist |

## Backup behavior

Admin config backup includes `storages` and their credentials. It does not include albums or audio. Treat the JSON as a secret.

The default database exporter omits storage configs but preserves each album/avatar `storage_id`. Restore the Admin JSON after importing D1 so those IDs resolve to the same named backends.

See [database-migration.md](database-migration.md) for the complete restore order.

## Verification after migration

- Test the target backend in Admin.
- Play at least one small and one large track; seek near the end.
- Check cover, avatar, and gallery images.
- Confirm the album reports the target backend.
- Keep the source until a separate backup and restore test have succeeded.

## Troubleshooting

| Symptom | Cause/check |
|---|---|
| Backend cannot be deleted | One or more albums are still bound to it |
| Album metadata works but stream is 502 | Backend ID missing, wrong credentials, or file not copied at the same path |
| Avatar breaks after album migration | Verify `artists.storage_id` and migrate the album that owns that avatar |
| Local backend fails on Cloudflare | Expected; local storage exists only in the Node runtime |
| Migration stops on a large file | Retry from reported `fileIndex`, or move the file outside Worker and retain the same path |
