# Browser list regressions

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

This harness mounts the actual React list views and compares the current source with Git revision `95eed448dd80ca49de0de2703d1db1f7e78e8e94`, immediately before the list memoization change. It checks unchanged sort/filter results, playback callbacks, favorite reordering, query work and track-row render counts. Recently-added ordering has changed intentionally since that revision, so separate current-view cases cover original addition times, rating/title edits, refresh order, new imports, tied timestamps, unknown dates and hidden albums in Library, Artists and Import.

From the repository root, install the web dependencies and build the harness:

```sh
npm --prefix cloud/web ci
node cloud/web/tools/build-performance-browser.mjs
python -m http.server 8766 --bind 127.0.0.1 --directory backups/web-perf-browser
```

Open `http://127.0.0.1:8766` in a desktop browser with a visible viewport, then click **Run all tests**. The page reports each case and its final pass/fail count. For browser automation, call `await window.runPerformanceTests()` and read `window.performanceTestResults`. Pointer-reordering tests use viewport hit testing, so a zero-size viewport is unsupported.

The build reads baseline files directly from Git; it does not need a private `backups/web-perf-baseline` directory. Use a clone whose Git history contains the pinned revision. A full clone includes it; a source ZIP alone does not. For a shallow clone, fetch the pinned revision before building, or fetch the full history with `git fetch --unshallow`:

```sh
git fetch origin 95eed448dd80ca49de0de2703d1db1f7e78e8e94
```

Generated files stay under the ignored `backups/web-perf-browser` directory. Its `manifest.json` records the baseline revision and source hashes. API responses and cover images use local fixtures, and the page blocks external connections. It never writes to a live library. These browser checks are separate from `npm test`; a successful harness build alone does not confirm the browser cases passed.
