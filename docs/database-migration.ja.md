# データベースバックアップ、移行、リカバリー

[English](database-migration.md) · [简体中文](database-migration.zh.md) · [繁體中文](database-migration.zh-Hant.md) · [日本語](database-migration.ja.md) · [한국어](database-migration.ko.md) · [Français](database-migration.fr.md) · [Español](database-migration.es.md)

この文書は、カタログをローカルNode SQLite、ローカルWrangler D1、遠隔地Cloudflare D1間で移動させます。

ローカルのままであれば、`<DATA_DIR>/mihonban.sqlite`、管理者設定のJSON、runtimeシークレット、オーディオを別々にバックアップしてください。リモートセクションはCloudflare展開が存在する場合にのみ適用されます。

## 移行対象

|データ |移行経路 |
|---|---|
|アルバム、トラック、アーティスト、ギャラリー、お気に入り、ノート、ソース投稿 |D1 SQLエクスポート/インポート |
|OneDrive/R2/モジュール設定および名前付きストレージ設定 |管理者設定JSON |
|アプリ/管理者パスワード、セッションシークレット、コンパニオンキー、プロキシ署名シークレット |ターゲットWorker秘密として設定 |
|KV レート制限と短命なキャッシュ |移行しないでください |
|R2キャッシュインデックス |同じバケット:`--include-cache`でエクスポート;新しいバケット:省略およびプリウォーム |
|音声およびオリジナル画像 |ストレージ層でのコピー/移行;D1の一部ではありません |

Admin JSON単独ではカタログバックアップではありません。D1 SQLファイルだけでは音声やデフォルトで認証情報は含まれません。

## Node のローカルストレージを Cloudflare に移す前に

Cloudflare Node `local`バックエンドを読み取ることができません。古いNodeアプリはまだ利用可能です:

1. OneDrive、WebDAV、またはGoogle Driveを追加・テストします。
2. ローカルストレージに割り当てられたすべてのアルバムを移行する。
3. クラウドバックエンドからのストリームや画像の検証。
4. 次にデータベースをエクスポートします。

## 1. 移行元をバックアップする

古いアプリで管理者としてログインし、**Admin → Backup settings**をダウンロードしてください。そのJSONは暗号化して保存してください。

Node、データベースは`<DATA_DIR>/mihonban.sqlite`です。ローカルWrangler D1ファイルは`cloud/worker/.wrangler/state/v3/d1/`に置かれています。

最終カットオーバー中に書き込みを停止します。エクスポーターはSQLite読み取りトランザクションを使用しますが、同時編集を避けることで検証が容易になります。

## 2. 移行先を準備する

D1/KVを作成し、公開テンプレートを無視したローカル設定にコピーし、
そのローカルファイル内の実IDを適用し、スキーマを適用します。

```bash
cd cloud/worker
npm ci
cp wrangler.jsonc wrangler.local.jsonc
# wrangler.local.jsonc 内の D1／KV のゼロ ID を実際の値に置き換えます。
npx wrangler d1 execute mihonban --remote --file schema.sql \
  --config wrangler.local.jsonc
```

PowerShellでは`Copy-Item wrangler.jsonc wrangler.local.jsonc`を使いましょう。D1
リソースは設定とWorkerに合った`mihonban`と名付けられています。絶対にアカウントを入力しないでください
公開テンプレート内のリソースIDやデプロイシークレットなどです。

ターゲットがすでに重要なデータを持っている場合は、まずエクスポートしてください:

```bash
mkdir -p ../../backups
npx wrangler d1 export mihonban --remote \
  --output ../../backups/remote-before-import.sql \
  --config wrangler.local.jsonc
```

## 3. ライブラリデータのエクスポートとインポート

### Windows 補助スクリプト

リポジトリのルートから:

```powershell
powershell -File tools\migrate-d1.ps1 -ImportRemote
```

ヘルパーは最新のNode SQLiteまたはローカルWrangler D1を自動的に検出し、無視`backups/`の下にタイムスタンプ付きのSQLファイルを書き込みます。リモートD1は`-ImportRemote`が存在する場合にのみ書き込みます。エクスポート時のみそのスイッチを省略します。リモートインポートの前に現在のターゲットを`backups/`にエクスポートし、バックアップが失敗した場合は中止します。`-SkipRemoteBackup`は明示的な緊急オーバーライドです。

ヘルパーは存在する場合は無視された`cloud/worker/wrangler.local.jsonc`を好み、それ以外は公開テンプレートを使用します。別のプライベート設定を選択するには`-WranglerConfig <path>`パスしてください。

ターゲットがまったく同じR2バケットとパブリックURLを保持している場合は、
`-IncludeCache`、プリウォームがすでにそこに鏡像化されたオブジェクトをスキップできるようにしています:

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -IncludeCache -ImportRemote
```

空のバケットや別のバケットに移動する際は、そのインデックスを含めないでください:その行
存在しないオブジェクトを指し示す。もしインデックスが省略されていたら
同じ公共オブジェクトは依然として存在し、現在の予備チェックは決定論的です
オブジェクトURLはHEADで表示され、画像バイトを再アップロードせずにインデックスを回収します。

複数のローカルデータベースが存在する場合は、修正時間に頼らず必ず`-Source`を渡してください。

明確な出典:

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -Database "mihonban" `
  -WranglerConfig "cloud\worker\wrangler.local.jsonc" `
  -ImportRemote
```

### 手動／クロスプラットフォーム

```bash
cd cloud/worker
npm ci
npm run db:export -- \
  --source /path/to/mihonban.sqlite \
  --output ../../backups/mihonban-d1.sql

npx wrangler d1 execute mihonban --remote \
  --file ../../backups/mihonban-d1.sql \
  --config wrangler.local.jsonc
```

デフォルトモードではプライマリーキーUPSERTを使用し、ソースに存在しないターゲット行を保持します。異なるIDを持つ一意パスの競合は、データが静かに削除される代わりに失敗します。新規ターゲットの場合、正確なソースカタログが作成されます。`--replace`まず含まれているカタログテーブルをクリアします。リモートバックアップ後にのみ使用します。

生成されたSQLには意図的に明示的な`BEGIN TRANSACTION`や
`COMMIT`:現在のリモートD1インポートはこれらの文を拒否し、Wrangler適用されます
アップロードされたファイルは原子的に処理されます。エクスポート者は依然として1 SQLiteでソースを読み込みます
トランザクションのスナップショットは一貫しています。

`--include-config`は名前付きストレージと同じ許可設定をエクスポートします
管理者バックアップとして機能するため、SQLにはストレージとサービスの認証情報が含まれています。それは
リスナー/管理者パスワードハッシュ、セッションエポック、コンパニオンを意図的に除外しています
心拍、スキャンタイムスタンプ、エラーの検出。ターゲットのパスワードWorker設定し、
秘密runtime独立して管理します。別の管理者JSONは推奨されています
設定パス。`--replace`を使っても、許容リストされた設定キーのみ
は置き換えられ、ターゲット認証およびruntime状態行はそのまま維持されます。
同じR2バケットの場合は`--include-cache`を加えます。新しいバケットのために省略します。

## 4. 設定とシークレットの復元

1. 新しい`APP_PASSWORD`、`ADMIN_PASSWORD`、`SESSION_SECRET`、`COMPANION_KEY`秘密を備えたメインWorkerを展開する。
2. 新しい管理者パスワードでログインします。
3. 管理者→バックアップ設定→古いJSONを取り込む。
4. すべてのストレージおよびR2構成をテストする。
5. 外部オーディオプロキシを使用する場合、メインWorkerに`STREAM_PROXY_SECRET`を設定し、プロキシWorkerの`PROXY_SECRET`と同じ値を設定します。

設定のJSONは意図的にパスワードハッシュやセッション状態を復元しません。

## 5. 件数と動作を確認する

```bash
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS albums FROM albums"
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS tracks FROM tracks"
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS artists FROM artists"
```

次に確認してください:

- アルバム、トラック、アーティスト、お気に入り、ノート、隠し状態、並べ順。
- ストレージバックエンドごとに1トラック、シークも含む。
- カバー、アバター、ギャラリー画像。
- リスナーは隠しオブジェクトにアクセスできません。
- 管理者設定のエクスポートは新しいデプロイメントで動作します。
- R2インデックスが省略されている場合、事前ウォームを実行します:既存のパブリックオブジェクトはHEADで回収され、欠落したオブジェクトのみがアップロードされます。

## 6. 切り替えとロールバック

検証後にのみコンパニオン`[cloud].url`を更新してください。古いデータベース、古いデプロイメント、SQLバックアップ、設定JSON、ソースオーディオは、新しいデプロイメントが復元テストに合格するまで保持してください。

ロールバックとは、URLを元のデプロイに戻すか、プリインポート済みのリモートSQLバックアップをクリーンなD1データベースにインポートすることです。データベースカットオーバー中に唯一の音声コピーを削除しないでください。

## リモート間の移行

2つのCloudflare展開の場合は、スキーマを適用した後、古いリモートD1をエクスポートし、新しいリモートにインポートします。同じ分離を保ちます:カタログD1 SQL、設定Worker Admin JSON、秘密はそれぞれ独立設定します。
