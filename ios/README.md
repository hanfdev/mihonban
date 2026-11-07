# Mihonban for iPhone and iPad

[English](README.md) · [简体中文](README.zh.md)

A native SwiftUI client for an existing Mihonban server, using SFBAudioEngine for playback. The current preview is 0.2.0 and requires iOS/iPadOS 17 or later. It does not host the server or use a WebView for its listening interface.

## A look inside

Actual native iOS screens captured in the iPhone and iPad simulators, using fictional demo data and built-in cover placeholders. [Capture details](../docs/images/README.md).

| iPhone library | iPhone album details | iPhone player |
|:---:|:---:|:---:|
| <img src="../docs/images/ios-library.webp" height="420" alt="iPhone library"> | <img src="../docs/images/ios-album.webp" height="420" alt="iPhone album details"> | <img src="../docs/images/ios-player.webp" height="420" alt="iPhone player"> |

**iPad album details in landscape**

![iPad album details in landscape](../docs/images/ios-ipad-album.webp)

## Connect and listen

Enter the server's root URL, such as `https://music.example.com`, and a listener or administrator passphrase. A blank passphrase works only when guest access is enabled on the server. The optional Save password switch stores the passphrase in Keychain for reconnection. Use the computer's LAN address for a local server; the phone's `localhost` is the phone itself. Local HTTP sessions require `DEV_INSECURE_COOKIE=1` on the server; use HTTPS for remote access.

- Browse albums, songs, artists and shared favorites, with search, genre filters, sorting, multi-artist credits and related albums.
- Read album and artist descriptions in a native Markdown reader; browse and zoom album artwork; share album and song links through the system share sheet.
- Use the mini player, full player, editable queue, seek, shuffle and repeat. Background audio, lock-screen controls and the system audio-output picker use native iOS facilities.
- Save albums for offline playback. Downloads show progress, failed transfers can be retried, and completed downloads remain separate from the automatic cache. Background transfers can continue while the app is suspended; force-quitting interrupts them.
- Reopen the previously authorized library and downloaded music when the server is unreachable. An explicit session rejection requires signing in again.
- Choose system, light or dark appearance; adjust the automatic cache from 256 MB to 4 GB (1 GB by default), or turn it off. Clearing this cache preserves explicit downloads.
- Configure next-track preloading as Off, Automatic (Wi-Fi) or Always. Automatic is the default and avoids cellular, metered connections and Low Data Mode. This prepares only the next queued track and can work with the persistent cache disabled.
- Administrators can change shared favorites, edit album metadata and covers, show/hide albums, and confirm removal with or without stored files. Full server configuration, bulk import/migration and browser-assisted RYM updates use the Web application.

The interface supports English, Japanese, Korean, French, Spanish, Simplified Chinese and Traditional Chinese. Portrait, landscape, Dynamic Type and iPad layouts have separate regression coverage. Format support depends on SFBAudioEngine and its bundled codecs; synthetic MP3, FLAC and Vorbis decoding and seeking are exercised by the test suite.

## Build

Use macOS, Xcode with the Swift 6.2 language features used by the sources, XcodeGen, Python 3 and FFmpeg. The [iOS workflow](../.github/workflows/mobile.yml) records the exact runner and Xcode selection used by CI (currently `macos-26` and Xcode 26.6). Source preparation and build commands run from the repository root:

```sh
brew install xcodegen ffmpeg
python3 -I ios/tools/check-l10n.py
python3 -I ios/tools/check-fonts.py
mkdir -p ios/TestFixtures ios/Resources/ThirdParty
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=8:sample_rate=44100' -ac 2 -c:a libmp3lame -q:a 3 ios/TestFixtures/tone.mp3
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=8:sample_rate=44100' -ac 2 -c:a flac ios/TestFixtures/tone.flac
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=8:sample_rate=44100' -ac 2 -c:a vorbis -strict experimental -q:a 4 ios/TestFixtures/tone.ogg
xcodegen generate --spec ios/project.yml
xcodebuild -resolvePackageDependencies -project ios/Mihonban.xcodeproj -scheme Mihonban -clonedSourcePackagesDirPath .spm
python3 -I ios/tools/acknowledgements.py .spm/checkouts ios/Resources/ThirdParty/Acknowledgements.txt
xcodegen generate --spec ios/project.yml
open ios/Mihonban.xcodeproj
```

SFBAudioEngine is pinned to a revision in `project.yml`. If a reviewed `ios/Package.resolved` is supplied, copy it into `ios/Mihonban.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/` before resolving packages, as CI does. CI includes the resolved dependency lock with its artifacts. The generated Xcode project, dependency checkouts, synthetic audio and build products are excluded from Git; the supplied icons, font, localization catalog and search tables are source assets.

Select an iPhone or iPad simulator and run the Mihonban scheme. For a physical device, configure your own development team and signing settings. CI creates an **unsigned** IPA; downloading it does not make it installable without an appropriate signing or sideloading process. The workflow also packages checksums, third-party notices and relinkable build objects. Artifacts are available from successful [iOS workflow runs](https://github.com/hanfdev/mihonban/actions/workflows/mobile.yml) and expire according to their retention settings; there is no automatic App Store release.

## Test

Run the fixture server in another terminal before running the Xcode test scheme:

```sh
python3 -I ios/tools/fixture-server.py ios/TestFixtures
```

The server listens on loopback port 8766 and supplies synthetic media and API fixtures. Tests cover API contracts, offline launch, catalog refresh, favorites, queue transitions, cache/download handling, decoding/seeking, typography, layout and native navigation. CI runs the iPhone suite and a separate iPad subset, and uploads test reports and screenshots. Selected documentation screenshots are committed under `docs/images/`; full screenshot runs and test reports remain generated artifacts outside version control. No production account or music collection is required. An iOS build or simulator run requires macOS; passing the portable Python checks alone does not verify Swift compilation or device behavior.

## Maintain generated resources

After editing shared Web translations or search aliases, regenerate the committed catalogs and review their diff:

```sh
node ios/tools/export-locales.mjs
node ios/tools/export-search.mjs
python3 -I ios/tools/check-l10n.py
python3 -I ios/tools/check-fonts.py
```

Only when changing artwork or font coverage, install Pillow, fontTools and Brotli in a development Python environment and run `python3 ios/tools/prepare-assets.py .`. This regenerates the icon/logo and the fallback font from the pinned source and shared Web assets; it is not required for an ordinary build.

The project uses AGPL-3.0-only. Bundled fonts retain their SIL Open Font Licenses. SFBAudioEngine and its codec dependencies retain their own licenses; retain the generated notices and dependency information when distributing builds.
