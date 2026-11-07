# 文書用スクリーンショット

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

Mihonban の実際の画面を、架空のアルバム、アーティスト、評価、紹介文を使って撮影したものです。Web と Android ではオリジナルの幾何学的なカバーを、iOS ではアプリ内蔵のレコード代替画像を使用します。個人のコレクションや市販アルバムの画像は含みません。Web、ネイティブ Android、ネイティブ iOS は別々のクライアントで、画像はデザインのモックアップではありません。

## 画像一覧

| 画像 | 画面 | 撮影日 | ソースのバージョン |
|---|---|---|---|
| [web-library.webp](web-library.webp) | Web アルバムライブラリ、英語 | 2026-11-08 | Web ソース `351ba8e` |
| [web-library-zh.webp](web-library-zh.webp) | Web アルバムライブラリ、簡体字中国語 | 2026-11-08 | Web ソース `351ba8e` |
| [web-album.webp](web-album.webp) | Web アルバム詳細、英語 | 2026-11-08 | Web ソース `351ba8e` |
| [android-library.webp](android-library.webp) | ネイティブ Android アルバムライブラリ | 2026-11-05 | Android 0.1.10 |
| [android-player.webp](android-player.webp) | ネイティブ Android プレーヤー | 2026-11-05 | Android 0.1.8 |
| [ios-library.webp](ios-library.webp) | ネイティブ iPhone アルバムライブラリ | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-album.webp](ios-album.webp) | ネイティブ iPhone アルバム詳細 | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-player.webp](ios-player.webp) | ネイティブ iPhone プレーヤー | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-ipad-album.webp](ios-ipad-album.webp) | ネイティブ iPad アルバム詳細、横向き | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |

Web 画像は撮影時の 1280 × 720 を維持しています。Android と iPhone は縦横比を保って 800 × 1440 以内に縮小し、iPad は記録された EXIF の向きを適用してから 1600 × 1200 に縮小しました。すべて WebP 圧縮（品質 88）を使用し、画面要素の切り抜きや配置変更は行っていません。原寸の画像やその他のテスト成果物はバージョン管理の対象外です。

## Web デモの再現

Node.js 20 以降を使用し、リポジトリのルートで実行します。

```bash
npm --prefix cloud/web ci
npm --prefix cloud/web run build
node tools/docs-demo.mjs --check
node tools/docs-demo.mjs
```

ライブラリは <http://127.0.0.1:8767>、サンプルアルバムは <http://127.0.0.1:8767/#/album/midnight-sessions> で開きます。言語メニューから English または简体中文を選択してください。文書の画像はダークテーマと既定の評価順を使用しています。`Ctrl+C` でサーバーを停止します。既定のポートが使用中なら `MIHONBAN_DEMO_PORT` を設定してください。

[`tools/docs-demo.mjs`](../../tools/docs-demo.mjs) は現在ビルドされた React アプリに、18 枚の架空アルバム、144 曲、6 組のアーティストを提供します。ループバックだけで待ち受け、読み取りリクエストのみを受け付けます。データベース、認証情報、ストレージプロバイダー、本番サービスへはアクセスしません。再生には Range 対応の生成済み無音 WAV を使います。Google Fonts へ要求する代わりに、リポジトリの Inter と Shippori Mincho をローカルで配信します。アプリのコンポーネントとレイアウトスタイルは変更していません。

画像を更新する際は現在のビルドで対象ページを撮影し、確認して WebP に変換し、上の表の日付とソースのバージョンを更新してください。再利用時も、アルバム名と評価が架空であることを明記してください。

## Android の出典

Android の画像は [`NativeUiTest.kt`](../../android/app/src/androidTest/java/org/mihonban/android/NativeUiTest.kt) のネイティブ UI フィクスチャから取得しています。架空のカタログを提供し、Android Canvas で独自のカバーを描画するテストです。選定したローカルの原本は `android/build/screenshots/0110-08-library-overview.png` と `android/build/screenshots/018-player-tall.png` です。上記バージョンを代表する画像であり、すべてのクライアントや現在の各画面を同時に撮り直したことを意味しません。

ビルドと計装テストの手順は [Android 開発ガイド](../../android/README.ja.md) を参照してください。このディレクトリ内の選定した圧縮画像だけをコミットしています。テスト全体の成果物は、無視対象の Android ビルドディレクトリに残ります。

## iOS の出典

ネイティブ iOS 画像は成功した [iOS プレビュー実行 #72](https://github.com/hanfdev/mihonban/actions/runs/42380336181)、ソースコミット [`5e667fb`](https://github.com/hanfdev/mihonban/commit/5e667fbacfb99ab3020ae8869f4534ed7f917dc4) から取得しています。2026-11-07 に、**iPhone 17** と **iPad Pro 13-inch (M5)** のシミュレータで Xcode UI テストが撮影しました。画面は英語、外観はダークです。シミュレータの画像であり、実機の写真ではありません。[`DemoLibrary.swift`](../../ios/Sources/DemoLibrary.swift) の架空カタログと [`Theme.swift`](../../ios/Sources/UI/Theme.swift) の内蔵レコード代替画像を表示しています。

| 文書画像 | 添付ファイル名 | `MihonbanUITests` のテスト |
|---|---|---|
| `ios-library.webp` | `01-library` | `testBrowsePlayPauseAndQueue` |
| `ios-album.webp` | `02-album` | `testBrowsePlayPauseAndQueue` |
| `ios-player.webp` | `03-now-playing` | `testBrowsePlayPauseAndQueue` |
| `ios-ipad-album.webp` | `48-album-balanced-landscape` | `testTabletAlbumHeaderBalancesArtworkAndInformation` |

ダウンロードした `iOS-screenshots-72` アーカイブは、GitHub の実行ページに公開された SHA-256 `34f1bb830c6453fe2074c77744ff23a34461b0fb32fb57688636e2542fae8457` と照合済みです。添付マニフェストには各テスト、デバイス、タイムスタンプ、元のファイル名が記録されています。iPad の添付は `ipad/` 配下です。選定した添付に、テスト失敗に関連付けられたものはありません。

更新時は macOS で [iOS 開発ガイド](../../ios/README.ja.md) に従い、[`MihonbanUITests.swift`](../../ios/UITests/MihonbanUITests.swift) の対応テストを実行して、`xcrun xcresulttool export attachments` で結果バンドルの添付をエクスポートします。[iOS ワークフロー](../../.github/workflows/mobile.yml) はこの処理を行い、`iOS-screenshots-<run_number>` 成果物を公開します。上記の添付を選び、記録された画像の向きを適用し、縦横比を保って縮小して、撮影日／バージョン表を更新してください。CI 成果物は保持期間が過ぎると削除されますが、選定した WebP はリポジトリに残ります。

[プロジェクト文書に戻る](../../README.ja.md)
