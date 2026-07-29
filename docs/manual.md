# Daily operation guide

[English](manual.md) · [简体中文](manual.zh.md) · [繁體中文](manual.zh-Hant.md) · [日本語](manual.ja.md) · [한국어](manual.ko.md) · [Français](manual.fr.md) · [Español](manual.es.md)

This guide is for library administrators. Paths and URLs depend on the selected runtime and your private configuration.

## Entry points

| Entry point | Purpose |
|---|---|
| Web app | Browse, play, search, favorite, import, and administer |
| Local inbox | Optional folders or RAR/ZIP/7z archives processed by the Python companion |
| `mihonban` CLI | Diagnose, ingest, watch, synchronize, pull, and process saved RYM pages |

The Python companion and any desktop player are not required for web playback.

## Identities

- Listener password: browse and play authenticated content.
- Administrator password: upload, edit, hide, delete, favorite, order, and configure infrastructure.
- Passwordless guest mode: optional read-only listener access without entering a password.
- Companion key: machine credential for the optional local pipeline.

All helper scripts generate random passwords when none are supplied; nothing ships with a fixed default password. Local-development passwords live in the stage directory's `.dev.vars`.

Passwords saved in Admin override environment bootstrap values. Changing either password revokes existing sessions.

## Playback and mobile interaction

- Volume, language, and sort preferences are local to each browser origin. Opening a new hostname or custom domain starts with fresh preferences; an unset volume starts at 100%.
- Playback is initiated inside the originating tap/click so Android Chrome can establish audible playback and a system media session. The lock-screen/notification controls expose play, pause, previous, next, and seeking where the browser supports them.
- On mobile, tap the cover or the empty part of the mini-player, or swipe the mini-player upward, to open Now Playing. Album and artist links remain independently tappable.
- The compact mobile transport keeps previous, play/pause, and next visible in that order. Shuffle and repeat remain available in the full Now Playing view.
- Gallery images show a loading state while switching; swipe horizontally to move between pages on touch devices.

## Inbox folders and archives

1. Put an album folder or an archive you are authorized to use into the configured `inbox`.
2. Run `mihonban watch`, or process once with `mihonban ingest --apply`.
3. Review logs and quarantine reports; hard failures are never silently discarded.
4. When cloud synchronization is configured, run `mihonban cloud sync`.

The pipeline supports direct folders, one archive, and nested archives. It waits for three unchanged polls before processing so partially copied files are not opened. Work occurs in a private temporary area. Successful source items move to `_done`; hard failures and their report move to `_quarantine`.

The pipeline extracts, repairs Japanese filename encoding, runs metadata/tag organization, normalizes the library layout, and can register the result with the API. Ambiguous metadata stays available for manual review.

## Cloud source scan versus local watcher

The Admin source module reads supported RSS/Atom/Blogger titles and links. Cloudflare Cron or Node's interval can run it while a home computer is off. It does not download or unpack music.

`mihonban watch` requires access to the local `inbox`, persistent files, 7-Zip, and beets. Run it on Windows, macOS, Linux, or a NAS; it cannot run inside Cloudflare Workers.

## Web import

1. Sign in as administrator and open Import.
2. Select tracks belonging to one album and review artist, title, year, filenames, and order.
3. Choose/crop a cover and select the intended write-target storage.
4. Start upload and wait for every track to finish before leaving the page.
5. Open the completed album, play a track, and seek near the end.

On an artist page, administrators can edit the Romanized / English name. This artist-level value updates every album by that artist and survives later companion synchronization.

Use `mihonban cloud pull` when the web copy must return to the local library. Add `--retag` only when cloud metadata should update existing local tags.

Before downloading each missing album, the companion writes a persistent marker under `data_dir/state/cloud_pull_incomplete/`. It clears the marker only after download, cloud-detail lookup, tag repair, and any required upload and registration all succeed. An interrupted directory containing `.partial` files—or no valid audio—is retried automatically instead of being mistaken for a complete album. Rclone restarts an old `.partial` file from byte zero rather than resuming its bytes, so keep the watcher and network running on slow links.

## RYM metadata

Mihonban does not automate requests to Rate Your Music. Save a release page manually in the browser, import the saved HTML on the album page, and review rating, vote count, primary/secondary genres, and descriptors before saving. The CLI can parse, match, and write manually saved pages in bulk.

## Discogs

Administrators can search releases or artists and preview an import of images, genres/styles, and biography text. On Cloudflare, the administrator browser calls the official public API directly and caches public metadata locally, avoiding shared Worker egress limits. The personal token in Admin is optional and is used only by the server-side fallback; it is never sent to the browser. When search results omit artwork, visible candidates lazily reuse the cached release details to fill it in. Preview thumbnails are public Discogs images loaded by the browser; files actually imported into configured storage still pass through the authenticated Worker and its Discogs-host, size, and file-signature checks.

Album-image imports are idempotent. Re-importing the same Discogs images skips the copies already registered for that release instead of creating duplicates.

## Favorites and hidden content

- Administrators can favorite albums or tracks and drag to reorder them.
- Listeners can view the curated favorites pages but cannot edit them.
- Hidden albums, tracks, artists, styles that exist only on hidden content, images, searches, and favorite entries are excluded from listener responses.
- The Show hidden toggle is an administrator-only view state shared by album, track, and artist lists.
- The header album count follows that same state: hidden albums are counted only while Show hidden is enabled.
- In the album gallery, switching images clears the previous image immediately and shows a loading indicator until the selected image is ready; a failed request shows an explicit error state.

After changing hidden state, verify with a separate listener session instead of relying only on the administrator UI.

## Named storage

- The write target affects future uploads only.
- Existing albums continue to read from their own `storage_id`.
- Migration copies required objects and changes bindings only after required copies succeed.
- Source objects are not automatically deleted.
- After a bulk move, test playback, seeking, covers, avatars, and galleries before archiving old copies.

See [Storage backends and file migration](storage.md).

## Admin areas

- System status: album/track/storage totals and companion heartbeat.
- Passwords and guest access.
- Backup and restore settings: sensitive configuration, not catalog rows.
- Named storage backends and write target.
- R2 image mirror and prewarm.
- Discogs token.
- Optional source scan and audio proxy modules.

The settings JSON contains credentials. Store it in an encrypted vault and never attach it to issues, chat, email, or Git.

## Backup routine

| When | Action |
|---|---|
| After a major import | Back up Node SQLite or export D1 SQL; confirm a second audio copy exists |
| After storage/R2/module changes | Export a new Admin settings JSON |
| Before an application update | Database + settings JSON + current commit/deployment identifier |
| Periodically | Perform a restore test rather than checking only that files exist |

See [Database backup, migration, and recovery](database-migration.md).

## Common commands

```text
mihonban doctor
mihonban ingest --apply
mihonban watch
mihonban cloud sync
mihonban cloud pull
mihonban cloud pull --retag
mihonban rym parse
mihonban rym match
mihonban rym write --apply

cd cloud/worker && npm test
cd cloud/web && npm test && npm run build
```

## Troubleshooting

| Symptom | Action |
|---|---|
| Inbox does nothing | Confirm the item is supported and fully copied, only one watcher runs, and inspect `data_dir/logs` |
| Item is quarantined | Read its report; check corruption, archive password, unsupported files, and match confidence |
| Web app has no old albums | Restore the catalog database; Admin settings JSON does not contain albums |
| Playback returns 502 | Test the album's named storage and confirm no file was moved outside Mihonban |
| Playback advances but is silent | Check player, tab, and system output volume; hard-refresh after an upgrade. A new browser origin defaults to 100% volume |
| Seeking fails or iOS duration is wrong | Verify the upstream/proxy returns correct 206, `Content-Range`, and total length |
| Images are slow or Graph is throttled | Test and enable R2, then prewarm |
| A detail-page cover fails while its card works | Hard-refresh once. Current builds fall back to the owning storage and repair a missing R2 mirror; if it persists, test both that storage and R2 |
| Google Drive cannot find existing files | Reauthorize the current Drive scope and verify root ID |
| Web upload is absent locally | Run `mihonban cloud pull` and verify the configured rclone remote |
| Login returns 429 | Stop retrying and wait 15 minutes |
| Local HTTP login does not persist | Set `DEV_INSECURE_COOKIE=1`; never use it on public HTTPS |
