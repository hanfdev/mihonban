# iPhone・iPad 向け Mihonban

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

既存の Mihonban サーバーに接続するネイティブ SwiftUI クライアントです。再生には SFBAudioEngine を使用します。現在のプレビューは 0.2.0 で、iOS/iPadOS 17 以降が必要です。サーバーをホストする機能はなく、再生画面に WebView は使用しません。

## 画面プレビュー

iPhone と iPad のシミュレータで撮影した、ネイティブ iOS アプリの実際の画面です。架空のデモデータと内蔵のカバー代替画像を使用しています。 [撮影について](../docs/images/README.ja.md)。

| iPhone ライブラリ | iPhone アルバム詳細 | iPhone プレーヤー |
|:---:|:---:|:---:|
| <img src="../docs/images/ios-library.webp" height="420" alt="iPhone ライブラリ"> | <img src="../docs/images/ios-album.webp" height="420" alt="iPhone アルバム詳細"> | <img src="../docs/images/ios-player.webp" height="420" alt="iPhone プレーヤー"> |

**iPad 横向きアルバム詳細**

![iPad 横向きアルバム詳細](../docs/images/ios-ipad-album.webp)

## 接続と再生

サーバーのルート URL（例：`https://music.example.com`）と、リスナーまたは管理者のパスワードを入力します。空欄で接続できるのは、サーバーでゲストアクセスが有効な場合だけです。任意の「パスワードを保存」スイッチを有効にすると、再接続用のパスワードをキーチェーンに保存します。ローカルサーバーにはコンピュータの LAN アドレスを指定してください。スマートフォンの `localhost` は端末自身を指します。ローカル HTTP セッションにはサーバー側で `DEV_INSECURE_COOKIE=1` が必要です。リモートアクセスには HTTPS を使用してください。

- アルバム、曲、アーティスト、共有お気に入りを閲覧でき、検索、ジャンルフィルター、並べ替え、複数アーティスト表記、関連アルバムに対応します。
- アルバムやアーティストの紹介文をネイティブ Markdown リーダーで読み、アルバム画像を閲覧・拡大し、システムの共有シートからアルバムや曲のリンクを共有できます。
- ミニプレーヤー、フルプレーヤー、編集可能なキュー、シーク、シャッフル、リピートを利用できます。バックグラウンド音声、ロック画面操作、システムの音声出力選択には iOS のネイティブ機能を使います。
- アルバムを保存してオフライン再生できます。ダウンロードは進捗を表示し、失敗時に再試行でき、完了したダウンロードは自動キャッシュと分離して保存します。アプリがサスペンド中でもバックグラウンド転送は継続できますが、強制終了すると中断します。
- サーバーに接続できない場合でも、以前認証したライブラリとダウンロード済みの音楽を再び開けます。セッションが明示的に拒否された場合は再ログインが必要です。
- 外観はシステム、ライト、ダークから選択できます。自動キャッシュは 256 MB～4 GB（既定は 1 GB）に調整でき、無効化も可能です。このキャッシュを消去しても、明示的にダウンロードしたファイルは残ります。
- 次の曲のプリロードは「オフ」「自動（Wi-Fi）」「常に有効」から選択できます。既定の自動モードでは、携帯回線、従量制接続、省データモードを避けます。準備するのはキュー内の次の 1 曲だけで、永続キャッシュが無効でも動作します。
- 管理者は共有お気に入り、アルバム情報とカバー、表示／非表示を変更し、保存ファイルを含めるかどうかを確認して削除できます。サーバー全体の設定、一括インポート／移行、ブラウザを使った RYM 更新には Web アプリを使用します。

画面は英語、日本語、韓国語、フランス語、スペイン語、簡体字中国語、繁体字中国語に対応します。縦向き、横向き、Dynamic Type、iPad レイアウトには個別の回帰テストがあります。対応形式は SFBAudioEngine と付属コーデックに依存します。テストスイートでは合成 MP3、FLAC、Vorbis のデコードとシークを検証します。

## ビルド

macOS、ソースが使用する Swift 6.2 の言語機能に対応した Xcode、XcodeGen、Python 3、FFmpeg を使用します。[iOS ワークフロー](../.github/workflows/mobile.yml)に CI の正確なランナーと Xcode の選択を記録しています（現在は `macos-26` と Xcode 26.6）。準備とビルドのコマンドはリポジトリのルートで実行します。

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

SFBAudioEngine は `project.yml` で特定のリビジョンに固定しています。レビュー済みの `ios/Package.resolved` が提供されている場合は、CI と同様に依存関係を解決する前に `ios/Mihonban.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/` へコピーしてください。CI の成果物には解決後の依存関係ロックファイルが含まれます。生成した Xcode プロジェクト、依存リポジトリのチェックアウト、合成音声、ビルド成果物は Git の対象外です。同梱するアイコン、フォント、ローカライズカタログ、検索テーブルはソース資産です。

iPhone または iPad シミュレータを選び、Mihonban scheme を実行します。実機では自分の開発チームと署名設定を構成してください。CI は**未署名の IPA**を作成するため、ダウンロード後も適切な署名またはサイドロードの手続きが必要です。ワークフローはチェックサム、第三者の通知、再リンク可能なビルドオブジェクトも梱包します。成果物は成功した [iOS ワークフロー実行](https://github.com/hanfdev/mihonban/actions/workflows/mobile.yml)から入手でき、保持設定に従って期限切れになります。App Store への自動公開は行いません。

## テスト

Xcode のテスト scheme を実行する前に、別のターミナルでフィクスチャサーバーを起動します。

```sh
python3 -I ios/tools/fixture-server.py ios/TestFixtures
```

サーバーはループバックのポート 8766 で待ち受け、合成メディアと API フィクスチャを提供します。テストは API 契約、オフライン起動、ライブラリ更新、お気に入り、キュー遷移、キャッシュ／ダウンロード処理、デコード／シーク、文字組み、レイアウト、ネイティブナビゲーションを対象とします。CI は iPhone スイートと独立した iPad のサブセットを実行し、レポートとスクリーンショットをアップロードします。選定した文書用画像は `docs/images/` にコミットしています。全スクリーンショットとテストレポートは、バージョン管理外の生成物です。本番アカウントや音楽コレクションは必要ありません。iOS のビルドとシミュレータ実行には macOS が必要であり、移植可能な Python チェックだけでは Swift のコンパイルや端末動作を検証できません。

## 生成リソースの保守

共有 Web 翻訳や検索エイリアスを編集したら、コミット済みカタログを再生成して差分を確認してください。

```sh
node ios/tools/export-locales.mjs
node ios/tools/export-search.mjs
python3 -I ios/tools/check-l10n.py
python3 -I ios/tools/check-fonts.py
```

画像やフォントの文字範囲を変更する場合だけ、開発用 Python 環境に Pillow、fontTools、Brotli をインストールし、`python3 ios/tools/prepare-assets.py .` を実行します。固定されたソースと共有 Web 資産からアイコン／ロゴとフォールバックフォントを再生成する処理で、通常のビルドには不要です。

プロジェクトは AGPL-3.0-only です。同梱フォントには各 SIL Open Font License が引き続き適用されます。SFBAudioEngine とコーデック依存関係には各ライセンスが適用されるため、配布時は生成された通知と依存関係情報を保持してください。

[プロジェクト文書に戻る](../README.ja.md)
