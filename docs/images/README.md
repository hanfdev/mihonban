# Documentation screenshots

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

These are captures of the actual Mihonban interfaces with fictional albums, artists, ratings and notes. Web and Android use original geometric cover artwork; iOS uses the app's built-in record placeholders. They contain no private collection or commercial album artwork. The Web, native Android and native iOS screenshots show separate clients; they are not design mockups.

## Image inventory

| Image | Interface | Capture date | Source version |
|---|---|---|---|
| [web-library.webp](web-library.webp) | Web album library, English | 2026-11-08 | Web source at `351ba8e` |
| [web-library-zh.webp](web-library-zh.webp) | Web album library, Simplified Chinese | 2026-11-08 | Web source at `351ba8e` |
| [web-album.webp](web-album.webp) | Web album details, English | 2026-11-08 | Web source at `351ba8e` |
| [android-library.webp](android-library.webp) | Native Android album library | 2026-11-05 | Android 0.1.10 |
| [android-player.webp](android-player.webp) | Native Android player | 2026-11-05 | Android 0.1.8 |
| [ios-library.webp](ios-library.webp) | Native iPhone album library | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-album.webp](ios-album.webp) | Native iPhone album details | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-player.webp](ios-player.webp) | Native iPhone player | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-ipad-album.webp](ios-ipad-album.webp) | Native iPad album details, landscape | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |

The Web images retain their captured 1280 × 720 dimensions. Android and iPhone captures were proportionally reduced to fit within 800 × 1440; the iPad capture was reduced to 1600 × 1200 after applying its recorded EXIF orientation. All images use WebP compression (quality 88), without cropping or rearranging interface elements. Full-resolution source captures and other test artifacts remain outside version control.

## Reproduce the Web demo

From the repository root, using Node.js 20 or later:

```bash
npm --prefix cloud/web ci
npm --prefix cloud/web run build
node tools/docs-demo.mjs --check
node tools/docs-demo.mjs
```

Open <http://127.0.0.1:8767> for the library, or <http://127.0.0.1:8767/#/album/midnight-sessions> for the featured album. Select English or 简体中文 from the language menu. The documentation captures use the dark theme and the default rating sort. Stop the server with `Ctrl+C`. Set `MIHONBAN_DEMO_PORT` if the default port is occupied.

[`tools/docs-demo.mjs`](../../tools/docs-demo.mjs) serves the current built React app with 18 fictional albums, 144 tracks and six artists. It listens only on the loopback interface, accepts only read requests, and does not access a database, credentials, a storage provider or the production service. Playback uses generated silent WAV audio with Range support. The demo serves the repository's Inter and Shippori Mincho fonts locally instead of requesting Google Fonts; application components and layout styles are unchanged.

To refresh these images, capture the relevant pages from the current build, inspect the captures, convert them to WebP, and update the dates and source version above. Keep album names and ratings clearly identified as fictional when reusing the screenshots.

## Android sources

The Android examples come from the native UI fixture in [`NativeUiTest.kt`](../../android/app/src/androidTest/java/org/mihonban/android/NativeUiTest.kt), which supplies fictional catalog data and draws its own cover artwork with Android Canvas. The selected local originals are `android/build/screenshots/0110-08-library-overview.png` and `android/build/screenshots/018-player-tall.png`. They are representative captures from the versions listed above, rather than a claim that every client or current screen was recaptured together.

See the [Android development guide](../../android/README.md) for build and instrumented-test instructions. Only the selected compressed documentation images in this directory are committed; full test runs remain in the ignored Android build directory.

## iOS sources

The native iOS images come from the successful [iOS preview run #72](https://github.com/hanfdev/mihonban/actions/runs/42380336181), source commit [`5e667fb`](https://github.com/hanfdev/mihonban/commit/5e667fbacfb99ab3020ae8869f4534ed7f917dc4). They were captured on 2026-11-07 by Xcode UI tests on **iPhone 17** and **iPad Pro 13-inch (M5)** simulators, with the English interface and dark appearance. They are simulator captures, not physical-device photographs. The selected images contain the fictional catalog from [`DemoLibrary.swift`](../../ios/Sources/DemoLibrary.swift) and the built-in record placeholder from [`Theme.swift`](../../ios/Sources/UI/Theme.swift).

| Documentation image | Attachment name | Test in `MihonbanUITests` |
|---|---|---|
| `ios-library.webp` | `01-library` | `testBrowsePlayPauseAndQueue` |
| `ios-album.webp` | `02-album` | `testBrowsePlayPauseAndQueue` |
| `ios-player.webp` | `03-now-playing` | `testBrowsePlayPauseAndQueue` |
| `ios-ipad-album.webp` | `48-album-balanced-landscape` | `testTabletAlbumHeaderBalancesArtworkAndInformation` |

The downloaded `iOS-screenshots-72` archive was verified against the SHA-256 digest published on the GitHub run: `34f1bb830c6453fe2074c77744ff23a34461b0fb32fb57688636e2542fae8457`. The attachment manifests record each test, device, timestamp and original filename; the iPad attachments are under `ipad/`. None of these selected attachments is associated with a test failure.

To refresh the images, follow the [iOS development guide](../../ios/README.md) on macOS, run the corresponding tests in [`MihonbanUITests.swift`](../../ios/UITests/MihonbanUITests.swift), and export the result-bundle attachments with `xcrun xcresulttool export attachments`. The [iOS workflow](../../.github/workflows/mobile.yml) already performs this export and publishes an `iOS-screenshots-<run_number>` artifact. Choose the named attachments above, apply the image's recorded orientation, resize proportionally, and update the capture/version table. CI artifacts expire after their retention period; these selected WebP images remain in the repository.

[Back to project documentation](../../README.md)
