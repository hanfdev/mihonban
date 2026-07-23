# Cloudflare Serverless ホスティング

[English](serverless-hosting.md) · [简体中文](serverless-hosting.zh.md) · [繁體中文](serverless-hosting.zh-Hant.md) · [日本語](serverless-hosting.ja.md) · [한국어](serverless-hosting.ko.md) · [Français](serverless-hosting.fr.md) · [Español](serverless-hosting.es.md)

serverless目標は、自宅のパソコンがオフの間もログイン、ブラウジング、再生をオンラインに保つことです。サポートされている形状は、ReactアプリとAPIを提供するWorker、D1+KV、画像のオプションR2、音声をOneDrive、WebDAV、またはGoogle Driveに保存するものです。

## 適したワークロード

|仕事 |Cloudflare Workersフィット |
|---|---|
|Reactアセットと短いAPIリクエスト |良い |
|D1カタログ/設定とKV短いキャッシュ |良い |
|RSS/Atom/Bloggerのソースリマインダー |Cron Triggerで問題ありません |
|ストレージからのストリーミングRange |ネットワークおよびプランの制限により対応 |
|受信トレイ監視、アーカイブ抽出、ビーツ、一括タグ編集 |サポートされていません;ローカルのコンパニオンをご利用ください |
|トランスコードまたは永続的なローカルフォルダスキャン |サポートされていません;Node/NASツールの使用 |

## 推奨構成

```text
Browser
  |
Cloudflare Worker (API + React assets)
  |-- D1: catalog and settings
  |-- KV: rate limits and short-lived cache
  |-- optional R2: image mirror
  +-- OneDrive / WebDAV / Google Drive: audio and originals
```

[インストールとデプロイ](install.ja.md)に従ってください。ローカルカタログを移行する前に、[データベース移行](database-migration.ja.md)を行う必要があります。管理者設定だけをインポートしてもアルバムは復元されません。

## 家庭用パソコンは電源を入れたままでいなければならないの?

いいえ、ウェブログイン、ブラウジング、再生、ウェブインポート、または予定されたソーススキャンには使いません。ローカル受信トレイ処理、ローカル/クラウドの照合、オフラインバックアップ、その他の関連作業のためだけをオンにしてください。

Cloudflare Workersホームディレクトリを見たり、ファイルシステムのイベントを待つこともできません。受信トレイを継続的に実行するには、Pythonコンパニオンを常時稼働のNASまたは低消費電力ホストに置いてください。そのデバイスがファイルを整理・同期します。ウェブアプリはCloudflare上で独立して動作します。

## 無料だからといって無限ではない

Workers、D1、KV、R2の割当や価格は変更されることがあります。現在のCloudflareダッシュボードと公式ドキュメントを権威として活用してください。このプロジェクトの無料プランの前提は、個人ライブラリまたは数人のリスナーであり、大規模な公共配信や連続テラバイトスケールのロスレス音声中継ではありません。

OneDrive一時的なURLはWorkerを迂回することが多いです。WebDAV、Google Drive、そして明示的に有効になっているオーディオプロキシ転送バイトはWorkerを経由し、より多くのプラットフォームリソースを消費します。

## 外部オーディオプロキシ

まずメインのデプロイをテストしてください。別のWorkerルートやカスタムドメインがパスを改善することが測定された場合にのみ、別のプロキシを追加してください。これは署名付き、許容リストされたリレーであり、パブリックCDNではなく、高速化を保証するものではありません。[オプションCloudflareオーディオプロキシ](audio-proxy.ja.md)を参照してください。

## 公開前チェックリスト

- Worker HTTPS上で開くURL/カスタムドメイン。
- リスナー、管理者、オプションのパスワードレスゲスト権限は正しいです。
- デスクトップ、iOS Safari、Android Chromeでの再生および仕事の探索。
- 隠されたコンテンツはAPIレベルでリスナーに利用できません。
- すべての名前付きストレージバックエンドがテストされます。1つの書き込みターゲットを選択します。
- オプションのR2画像とプロキシは独立してテストされます。
- D1 SQL、管理設定のJSON、runtimeシークレット、オーディオバックアップはすべて考慮されています。
- Git、ドキュメント、ログ、スクリーンショットにシークレットが現れないこと。
