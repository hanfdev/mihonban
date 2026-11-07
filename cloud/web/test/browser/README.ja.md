# ブラウザーの一覧回帰テスト

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

このテストページは実際の React 一覧ビューをマウントし、現在のソースを一覧のメモ化変更直前の Git リビジョン `95eed448dd80ca49de0de2703d1db1f7e78e8e94` と比較します。ソート／絞り込み結果、再生コールバック、お気に入りの並べ替え、クエリ処理量、曲の行のレンダリング回数を確認します。このリビジョン以降、「最近追加」の並び順は意図的に変更されているため、現在のビュー専用のケースで、Library、Artists、Import の初回追加日時、評価／タイトルの編集、更新順、新規インポート、同一タイムスタンプ、日付不明、非表示アルバムを検証します。

リポジトリのルートから Web の依存関係をインストールし、テストページをビルドします。

```sh
npm --prefix cloud/web ci
node cloud/web/tools/build-performance-browser.mjs
python -m http.server 8766 --bind 127.0.0.1 --directory backups/web-perf-browser
```

表示領域のあるデスクトップブラウザーで `http://127.0.0.1:8766` を開き、**Run all tests** をクリックします。各ケースと最終的な成功／失敗件数が表示されます。ブラウザー自動化では `await window.runPerformanceTests()` を呼び出し、`window.performanceTestResults` を読み取れます。ポインターによる並べ替えテストは表示領域のヒットテストを使うため、サイズがゼロのビューポートには対応しません。

ビルドは Git から基準ファイルを直接読み取るため、非公開の `backups/web-perf-baseline` ディレクトリは不要です。固定リビジョンを含む履歴を持つクローンを使用してください。完全なクローンには含まれますが、ソース ZIP だけには含まれません。浅いクローンではビルド前に固定リビジョンを取得するか、`git fetch --unshallow` で全履歴を取得します。

```sh
git fetch origin 95eed448dd80ca49de0de2703d1db1f7e78e8e94
```

生成物は Git の対象外である `backups/web-perf-browser` に保存され、`manifest.json` に基準リビジョンとソースのハッシュが記録されます。API 応答とカバーにはローカルのテストデータを使用し、ページは外部接続を遮断します。実際のライブラリには書き込みません。このブラウザー検証は `npm test` とは別です。テストページのビルド成功だけでは、ブラウザーのケースが成功したことにはなりません。
