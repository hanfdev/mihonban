# Documentation screenshots / 文档演示图

These are captures of the actual Mihonban interfaces with fictional albums, artists, ratings and notes, plus original geometric cover artwork. They contain no private collection or commercial album artwork. The Web and native Android screenshots show separate clients; they are not design mockups.

这些图片来自 Mihonban 的实际界面，使用虚构的音盘、艺人、评分与介绍，以及原创几何封面，不包含私人曲库或商业唱片封面。Web 与原生 Android 分别标注，均非设计效果图。

## Image inventory

| Image | Interface | Capture date | Source version |
|---|---|---|---|
| [web-library.webp](web-library.webp) | Web album library, English | 2026-11-08 | Web source at `351ba8e` |
| [web-library-zh.webp](web-library-zh.webp) | Web album library, Simplified Chinese | 2026-11-08 | Web source at `351ba8e` |
| [web-album.webp](web-album.webp) | Web album details, English | 2026-11-08 | Web source at `351ba8e` |
| [android-library.webp](android-library.webp) | Native Android album library | 2026-11-05 | Android 0.1.10 |
| [android-player.webp](android-player.webp) | Native Android player | 2026-11-05 | Android 0.1.8 |

The Web images retain their captured 1280 × 720 dimensions. Android captures were proportionally reduced to fit within 800 × 1440. All images use WebP compression (quality 88), without cropping or rearranging interface elements. Full-resolution source captures and other test artifacts remain outside version control.

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

See the [Android development guide](../../android/README.md) ([简体中文](../../android/README.zh.md)) for build and instrumented-test instructions. Only the selected compressed documentation images in this directory are committed; full test runs remain in the ignored Android build directory.
