# Mihonban RYM ブラウザーツール

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

RYM のリリースメタデータを既存の Mihonban ライブラリへ送る、任意導入の Chrome/Edge Manifest V3 拡張機能です。1.1.0 には、ソースリンクを持つアルバムの評価と評価件数を更新する、ユーザー開始型キューもあります。

## ビルドとインストール

リポジトリのルートで Web の依存関係を導入し、ビルドします。

```sh
npm --prefix cloud/web ci
npm --prefix cloud/web run build
```

ビルドは拡張機能と共有パーサーを `cloud/web/dist/rym-browser-tool/` にコピーし、`cloud/web/dist/rym-browser-tool.zip` を生成します。Chrome/Edge の拡張機能画面で「パッケージ化されていない拡張機能を読み込む」（Load unpacked）を使い、`manifest.json` を含む生成フォルダーを指定します。ソースフォルダーだけでは不完全で、ビルドが `rym-capture.js` と `batch-reader.js` を補います。既存コピーを置き換えたら拡張機能画面で再読み込み（Reload）してください。

公開済みサーバーの「Admin → RYM updates → Batch update ratings」から同じ ZIP を取得できます。導入、ソース照合、分類の確認は[使用手順](../../docs/manual.ja.md#rymメタデータ)を参照してください。

## 操作モード

- **現在ページを送信：** RYM リリースページを更新し、拡張機能を開き、Mihonban のアドレスを設定して送信します。Mihonban 側で一致するアルバムを確認します。分類は提案として届くため、明示的に採用する必要があります。
- **評価の一括更新：** 管理者として Mihonban を開き、そのタブから拡張機能を起動してリンク済みアルバムを選び、キューを開始します。評価と件数だけを更新し、同じソースを持つ版は 1 回の観測を共有します。手動整理した分類や順位は変更しません。

ライブラリとキューのタブを開いたままにしてください。ページ移動は最低 30 秒間隔です。認証確認やレート制限でキューが止まったら、ソースタブで確認を完了し、明示的に再開します。レート制限後は最低 5 分の待機があります。一時停止／再開と再試行に対応しますが、定期的なバックグラウンドサービスは実行せず、サイトの確認も回避しません。

バッチ開始時に RYM への任意のアクセス権限を要求します。開いているライブラリタブ経由で現在の管理者セッションを使用し、パスワード、Cookie、完全な HTML は保存しません。ライブラリアドレス、キュー進捗、取得評価は端末内に保存し、新しいバッチを選ぶと以前のジョブを置き換えます。

## 検査

```sh
node --test cloud/web/test/rym-capture.test.js cloud/web/test/rym-batch.test.js
```

`cloud/worker/test/rym-updates.test.js` の Worker テストは、ソース照合、同時編集、観測の鮮度、手動分類、評価のみの更新エンドポイントを検証します。
