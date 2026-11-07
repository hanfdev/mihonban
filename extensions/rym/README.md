# Mihonban RYM browser tool

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

This optional Chrome/Edge Manifest V3 extension sends release metadata from RYM to an existing Mihonban library. Version 1.1.0 also provides a user-started queue that refreshes ratings and rating counts for albums with an existing source link.

## Build and install

From the repository root, install the Web dependencies and build:

```sh
npm --prefix cloud/web ci
npm --prefix cloud/web run build
```

The build copies the extension and shared parser into `cloud/web/dist/rym-browser-tool/` and creates `cloud/web/dist/rym-browser-tool.zip`. Load the generated folder containing `manifest.json` with **Load unpacked** in Chrome/Edge's Extensions page. The source directory alone is incomplete: the build supplies `rym-capture.js` and `batch-reader.js`. After replacing an installed copy, click **Reload** in the Extensions page.

On a deployed server, **Admin → RYM updates → Batch update ratings** provides the same ZIP. See the [usage manual](../../docs/manual.md#rym-metadata) for installation, source matching and classification review.

## Operating modes

- **Send current page:** refresh a RYM release page, open the extension, set the Mihonban address and send it. Confirm the matching albums in Mihonban. Classifications arrive as suggestions that require explicit adoption.
- **Batch update ratings:** open Mihonban as an administrator, launch the extension from that tab, select linked albums and start the queue. It updates ratings and rating counts only, shares one observation across editions with the same source, and keeps curated classifications and ranks intact.

Keep the library and queue tabs open. Navigations are at least 30 seconds apart. Verification or throttling pauses the queue; complete verification in the source tab and resume explicitly. Throttling imposes at least a five-minute cooldown. The tool supports pause/resume and retries, but does not run a scheduled background service or bypass site verification.

The extension requests optional access to RYM when batch mode starts. It uses the existing administrator session through the open library tab and does not store passwords, cookies or full HTML. The library address, queue progress and captured scores are stored on the device; selecting a new batch replaces the previous job.

## Checks

```sh
node --test cloud/web/test/rym-capture.test.js cloud/web/test/rym-batch.test.js
```

The Worker tests in `cloud/worker/test/rym-updates.test.js` cover source matching, concurrent edits, observation freshness, curated classifications and the scores-only endpoint.
