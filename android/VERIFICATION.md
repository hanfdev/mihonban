# Android validation

[English](VERIFICATION.md) · [简体中文](VERIFICATION.zh.md) · [繁體中文](VERIFICATION.zh-Hant.md) · [日本語](VERIFICATION.ja.md) · [한국어](VERIFICATION.ko.md) · [Français](VERIFICATION.fr.md) · [Español](VERIFICATION.es.md)

Current source version: 0.1.10 / version code 11. The toolchain is JDK 17, Gradle 8.9, Android Gradle Plugin 8.7.3, Kotlin 2.0.21, SDK 35 and Build Tools 35.0.0.

## Reproduce

From the repository root, with an installed SDK selected through `ANDROID_HOME` or an ignored `android/local.properties`:

```powershell
android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug assembleRelease
android\gradlew.bat -p android connectedDebugAndroidTest
```

On macOS/Linux, use `sh android/gradlew -p android` with the same tasks. The wrapper pins and checksums Gradle 8.9. The second command requires an emulator or device. Tests use an embedded HTTP fixture and synthetic audio rather than a production server, credentials or personal music.

Standard outputs are under `android/app/build/`:

- `reports/tests/testDebugUnitTest/` and `test-results/testDebugUnitTest/`: JVM reports.
- `reports/lint-results-debug.html` and `.xml`: lint diagnostics.
- `reports/androidTests/` and `outputs/androidTest-results/`: device reports.
- `outputs/apk/debug/app-debug.apk`: development APK.
- `outputs/apk/release/app-release-unsigned.apk`: minified APK requiring a release signature.

The [Android workflow](../.github/workflows/android.yml) builds Debug and Release, runs JVM tests and lint, and runs a separate API 35 emulator job. It uploads APKs, reports and screenshots as CI artifacts. Selected documentation screenshots are committed under `docs/images/`; full generated outputs and local test evidence remain outside version control.

## Recorded results

The 2026-11-07 source-publication check completed `testDebugUnitTest lintDebug assembleDebug assembleRelease` successfully with Gradle 8.9 and JDK 17. It reused the existing incremental outputs: 2 tasks executed and 97 were up-to-date. The wrapper's distribution download did not finish in the local network check, so this run used the already installed Gradle 8.9 distribution. A local init script selected a previously existing build output directory; the source and tasks were those in this repository.

The reused reports contain 29 JVM tests with no failures, errors or skipped tests. Lint contains no errors, 15 warnings and one informational item. Both development and minified unsigned release APKs exist. These are incremental validation results, not a fresh emulator run or an independent clean build.

The earlier 2026-11-05 validation recorded all 22 device tests passing on an Android 15 / API 35 x86_64 emulator, at 945 × 1680 pixels and 420 dpi. It also verified the development APK signature. The suite covers native navigation, playback and seeking, queue behavior, download/offline use, cache isolation, next-track preloading and the collapsing-toolbar regression.

The toolbar regression samples partially collapsed states, several density/font-scale combinations and status-bar insets, then verifies full collapse, restoration and density changes. This targets the title/icon fragments fixed in 0.1.10. Existing lint findings concern dependency updates, synchronous preference writes, the exported media service, the application-scoped repository reference and boxed integer state in the import UI.

## Coverage limits

No new emulator or physical-device run was performed for the 2026-11-07 documentation update. Android 8 runtime coverage, Android 16 and manufacturer-specific system behavior, battery/headset integration and production storage-account integration remain unverified. An Android 15 delayed Stop race after immediately clearing and restarting the queue remains a known limitation.

See [README.md](README.md#current-limits) for codec, foreground-upload and advanced server-administration limits. CI or locally built APKs can differ in signature and checksum; verify the artifact produced by the run you intend to install.
