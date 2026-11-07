# Mihonban for Android

A native Kotlin / Jetpack Compose client for the existing Mihonban server. No WebView is used. Android 8.0 (API 26) or newer is required.

## A look inside

Actual native Android screenshots with fictional test data and original example covers. [Capture details](../docs/images/README.md).

| Android library | Android player |
|:---:|:---:|
| <img src="../docs/images/android-library.webp" height="480" alt="Android library"> | <img src="../docs/images/android-player.webp" height="480" alt="Android player"> |

## Connect

Build the current 0.1.10 preview locally, or download the debug APK from a successful [Android workflow run](https://github.com/hanfdev/mihonban/actions/workflows/android.yml). A release APK needs your own signing key. Enter the server's root address, for example `https://music.example.com` or `http://192.168.1.20:8788`, and your listener or administrator passphrase. Leave the passphrase blank only if the server allows guest access. An Android emulator can access a development server on the host at `http://10.0.2.2:8788`.

HTTPS is recommended for remote servers. Local HTTP is supported for the existing Node/Wrangler development modes; the server must use `DEV_INSECURE_COOKIE=1` for HTTP cookie sessions. The app does not bypass TLS certificate validation.

## Native features

- Album grid and track lists, genre filtering, year/title/artist/rating sorting, whole-library search, multi-artist credits and artist discographies.
- Album details, ratings, notes, related albums, gallery paging and pinch zoom, Android share sheet, shared album and track favorites.
- Compact player and full player, seek, shuffle, repeat, editable queue, play next, sleep timer, audio focus and headphone disconnect handling.
- Media3 foreground playback service with notification, headset and lock-screen controls. Playback continues when the UI is backgrounded; the queue restores paused after process restart.
- WorkManager downloads to private app storage, progress, pause/retry/removal, validated byte-range resume, persistent metadata and album covers, offline playback and cached library browsing.
- Administrator access: album/track/artist editing, visibility, confirmed deletion, Discogs metadata and gallery import, image reordering, phone audio upload through Android's document picker, server-folder scan and registration.
- Server administration: guest access and module settings, named storage configuration/testing/write target, R2 configuration/testing, source inbox and scanning, listener/admin passphrase changes.
- Web palette preserved: black-brown surfaces, warm ivory text, vermilion accents and serif headings. Touch targets, bottom navigation, scroll restoration, system back, rotation and Android insets use native Compose behavior.

The catalog opens directly into albums or tracks. Its top app bar collapses on upward scroll and returns on downward scroll. Grid density is switchable, while genre and sort controls live in a dismissible bottom sheet. Search provides existing genres, recently added albums and result categories. Album details place artwork beside metadata and collect secondary actions in a menu. Tab state is saved separately for each server and access role.

Version 0.1.3 replaces inline description expansion with a dedicated reader. Album pages retain a three-line plain-text excerpt; the reader keeps its header and Close button fixed, offers Back to top, restores the album scroll position on closing and retains reading progress when reopened. CommonMark plus GFM tables/strikethrough render natively with selectable text, nested lists, blockquotes, links, code, dividers and standalone images. Wide tables/code scroll horizontally. Raw HTML remains inert text. The reader follows the Web palette and typography without a WebView.

Version 0.1.4 makes description-image failures visible: loading feedback, readable alternative text and a Retry image button replace an unexplained blank area. Retrying reloads only that image and keeps the reader open. Unusable image addresses show an explanation without offering a retry that cannot succeed.

Version 0.1.5 fixes Back to top for descriptions made of one long paragraph or quote. The button now accounts for scrolling within a Markdown block and disappears again at the beginning of the description. The heading font family is also shared across activity recreations to avoid repeatedly allocating the bundled font buffers.

Version 0.1.6 cancels active download requests when their WorkManager job is stopped, including a server that stalls before headers or during the body. Pausing or deleting a download no longer waits for the network timeout to release its request. Download-cover requests use the same cancellation handling. Manual retry starts a fresh attempt; automatic retries can resume validated partial data.

Version 0.1.7 displays description images even when they share a paragraph with text or captions. Text and images appear in their original order with readable spacing, including inside nested quotes; surrounding text keeps its Markdown formatting. Images retain their loading feedback and retry action.

Version 0.1.8 lifts the portrait playback controls away from the bottom edge and keeps artwork closer to the title. A bottom utility row offers current-track download, share and queue access. Downloads show progress and support pause/retry; completed downloads remain intact. Share opens Android's chooser with the song, artist and Web album link. In landscape, the utility row sits below the artwork to preserve space for song information. The full player continues to show only title and artist metadata.

Version 0.1.9 defaults the album library to weighted rating order, using the same confidence adjustment and tie breakers as the Web client. Tapping a primary or secondary genre on an album opens matching albums in that order; Back returns to the album. The collapsed toolbar fully clips its title and icons while preserving the system status-bar area.

Version 0.1.10 fixes title/icon fragments when the toolbar is almost collapsed. It slides a full-height toolbar out of view instead of centering controls in a shrinking strip, measures the actual collapse distance, and fades the final portion. This also preserves the closed position when display scaling changes. Status-bar padding remains outside the sliding row.

More → Playback settings offers next-track preloading with Wi-Fi only (default), Always on and Off modes. Wi-Fi only cancels speculative requests when the default network changes to cellular and resumes on Wi-Fi. Preloading follows the actual upcoming track under shuffle, waits for the current track to buffer, skips downloaded tracks and stops while paused. Up to the first 16 MiB of the next track is stored in the existing server/access-scoped music cache, within its configured limit; playback reuses those bytes. These are device preferences and do not require administrator access.

Phone layouts from 320–599 dp use explicit two/three-column modes, and narrower windows and tablets also use distinct counts. The grid control uses a neutral icon without a visible number or accent highlight; screen readers still announce the current count. The preference survives restarts and is shared by Library, Favorites and genre pages. The library supports pull-to-refresh. The queue opens at the current track, Back returns to the player, and clearing the queue requires confirmation.

Version 0.1.2 keeps playback controls inside the available safe area and scales artwork to the remaining space. Player metadata contains only the song title and artists; tapping the title opens its album. Buffering retains an actionable play/pause icon. Track-list shuffle is a selection toggle: it does not start or change playback until Play all is pressed. Album-detail shuffle still starts that album.

More → Cache settings shows music/image disk usage, offers a 128 MB–2 GB music cache limit and clears automatic music/image caches. Lowering the limit immediately evicts older music data. Images use a separate 64 MB cap. Explicit downloads, the saved catalog and sign-in are retained; active playback may create new cache data. Stream cache keys include the server and access role.

Favorites are the server's shared curated selection. As on the Web, listeners and guests can read them; only administrators can modify them. Server URLs, catalog snapshots, artwork and downloads are partitioned by server and access role. Session cookies are stored using Android Keystore AES-GCM; passwords are not saved. App data is excluded from Android backup.

## Build and test

Use JDK 17 and Android SDK platform 35 / build-tools 35.0.0. Open this directory in Android Studio, or run from the repository root:

```powershell
android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug assembleRelease
android\gradlew.bat -p android connectedDebugAndroidTest
```

On macOS/Linux:

```sh
sh android/gradlew -p android testDebugUnitTest lintDebug assembleDebug assembleRelease
sh android/gradlew -p android connectedDebugAndroidTest
```

Set `ANDROID_HOME` or create the ignored `android/local.properties` with `sdk.dir` pointing to your SDK. The wrapper pins Gradle 8.9. No production server, credentials or audio files are needed for tests. JVM tests exercise JSON compatibility, URL/cookie isolation, redirect safety and download range validation. Instrumented tests use an embedded HTTP fixture and synthetic PCM audio to check native navigation, playback, seeking, queues, downloads and offline playback.

Outputs:

- Installable development APK: `app/build/outputs/apk/debug/app-debug.apk`.
- Unsigned release APK: `app/build/outputs/apk/release/app-release-unsigned.apk`. Sign it using your own release key before distribution; keep that key for subsequent updates.
- JVM and lint reports: `app/build/reports/`.

The Android GitHub Actions workflow builds both variants and runs JVM/lint checks, with a separate API 35 emulator job. It does not publish a release or sign with a production key.

See [VERIFICATION.md](VERIFICATION.md) for validation commands, recorded results and limits of device coverage. Representative documentation screenshots are included under `docs/images/`. APKs, complete screenshot runs and build reports remain generated artifacts and are not included in the source checkout. CI artifacts require access to the workflow run and expire according to GitHub's retention settings.

## Current limits

Playback format support follows Media3 and the device's decoders (including common MP3, FLAC, AAC, WAV, Vorbis and Opus). DSD/APE and other specialist codecs are not bundled. Phone uploads survive rotation but are a foreground editing operation: keep the app open until registration finishes; they are not a persistent background upload queue. Partial storage uploads may need cleanup in the storage provider if cancelled before registration.

The main listening UI provides Chinese and English labels based on the device language; administration currently uses Simplified Chinese. Browser-assisted RYM updates and saved-HTML import, full configuration backup/restore, bulk storage migration and storage OAuth setup remain in the Web application. This client connects to an existing server; it does not host one.

Licensed under the repository's AGPL-3.0-only license. Third-party dependencies retain their own licenses. The bundled Shippori Mincho and GenRyu Mincho fonts match the Web client's typefaces; their SIL Open Font Licenses are included in `app/src/main/assets/licenses/`.
