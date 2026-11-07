# Android 検証記録

[English](VERIFICATION.md) · [简体中文](VERIFICATION.zh.md) · [繁體中文](VERIFICATION.zh-Hant.md) · [日本語](VERIFICATION.ja.md) · [한국어](VERIFICATION.ko.md) · [Français](VERIFICATION.fr.md) · [Español](VERIFICATION.es.md)

現在のソース版は 0.1.10、バージョンコードは 11 です。ツールチェーンは JDK 17、Gradle 8.9、Android Gradle Plugin 8.7.3、Kotlin 2.0.21、SDK 35、Build Tools 35.0.0 です。

## 再現手順

`ANDROID_HOME` または Git 対象外の `android/local.properties` でインストール済み SDK を指定し、リポジトリのルートから実行します。

```powershell
android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug assembleRelease
android\gradlew.bat -p android connectedDebugAndroidTest
```

macOS/Linux では `sh android/gradlew -p android` に同じタスクを指定します。ラッパーは Gradle 8.9 に固定し、チェックサムを確認します。2 番目のコマンドにはエミュレーターか実機が必要です。テストには内蔵 HTTP フィクスチャーと合成音声を使い、本番サーバー、認証情報、個人の音楽は使いません。

標準出力は `android/app/build/` 配下です。

- `reports/tests/testDebugUnitTest/` と `test-results/testDebugUnitTest/`：JVM レポート。
- `reports/lint-results-debug.html` と `.xml`：lint 診断。
- `reports/androidTests/` と `outputs/androidTest-results/`：端末レポート。
- `outputs/apk/debug/app-debug.apk`：開発 APK。
- `outputs/apk/release/app-release-unsigned.apk`：リリース署名が必要な縮小 APK。

[Android ワークフロー](../.github/workflows/android.yml)は Debug/Release のビルド、JVM テスト、lint と独立した API 35 エミュレータージョブを実行し、APK・レポート・画像を CI 成果物として保存します。選定した文書用画像は `docs/images/` に含めますが、完全な生成出力とローカル検証資料はバージョン管理しません。

## 記録された結果

2026-11-07 のソース公開検査では Gradle 8.9 と JDK 17 で `testDebugUnitTest lintDebug assembleDebug assembleRelease` が成功しました。既存の増分出力を再利用し、2 タスクを実行、97 タスクは最新でした。ローカルネットワーク検査でラッパーの配布物ダウンロードが完了しなかったため、インストール済み Gradle 8.9 を使用しました。ローカル初期化スクリプトで既存の出力先を選びましたが、ソースとタスクはこのリポジトリのものです。

再利用レポートには JVM テスト 29 件があり、失敗・エラー・スキップはありません。lint はエラー 0、警告 15、情報 1 件です。開発 APK と縮小済み未署名 release APK が存在します。これは増分検証であり、新規エミュレーター実行や独立したクリーンビルドではありません。

以前の 2026-11-05 検証は Android 15 / API 35 x86_64 エミュレーター（945 × 1680 ピクセル、420 dpi）で端末テスト 22 件すべての成功を記録し、開発 APK の署名も確認しました。ネイティブ操作、再生とシーク、キュー、ダウンロード／オフライン、キャッシュ分離、次曲プリロード、折り畳みバーの回帰を対象としています。

バーの回帰は半端な折り畳み状態、複数の密度／文字倍率、ステータスバーの余白をサンプリングした後、完全な折り畳み、復元、密度変更を検証します。0.1.10 で修正したタイトル／アイコン断片が対象です。既存 lint 指摘は依存更新、同期的な設定保存、公開メディアサービス、アプリスコープのリポジトリ参照、取込 UI のボックス化整数状態に関するものです。

## 検証範囲の制限

2026-11-07 の文書更新では新たなエミュレーター／実機検証を行っていません。Android 8 の実行、Android 16 とメーカー固有動作、バッテリー／ヘッドセット連携、本番ストレージアカウントとの連携は未検証です。Android 15 でキューを即座に消去・再開した後に Stop が遅れて届く競合も既知の制限です。

コーデック、前面アップロード、高度なサーバー管理の制限は [Android ガイド](README.ja.md#現在の制限)を参照してください。CI とローカル APK は署名やチェックサムが異なる場合があるため、インストールする実行結果の成果物を検証してください。
