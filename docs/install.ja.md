# インストールとデプロイ

[English](install.md) · [简体中文](install.zh.md) · [繁體中文](install.zh-Hant.md) · [日本語](install.ja.md) · [한국어](install.ko.md) · [Français](install.fr.md) · [Español](install.es.md)

このガイドでは、サポートされている3つのruntimesとオプションのローカルPythonコンパニオンをカバーしています。アプリケーションruntimeを選びます。コンパニオンはサーバー要件ではなく、追加のワークフローツールです。

## 1. 前提条件

- Node.js 22年以降
- ギット
- CloudflareアカウントはCloudflareに展開する時のみ
- OneDrive、WebDAV、またはCloudflare展開のためのGoogle Drive
- Python 3.11以降、そしてローカルコンパニオン専用の7-Zip(`7z`、`7zz`、または`7za`)
- コンパニオン駆動のローカルからクラウドへのファイル同期のためのオプションの`rclone`

ライブSQLiteデータベース、`music_root`、`data_dir`、一時ディレクトリ、`node_modules`をOneDrive、Dropbox、iCloud、または他の同期フォルダに配置しないでください。ビルドデータや可変データが他の場所でステージングされている場合、リポジトリ自体が同期されることがあります。

正典リポジトリのクローン:

```bash
git clone https://github.com/hanfdev/mihonban.git
cd mihonban
```

## 2. 実行環境を選ぶ

|Runtime |デフォルトURL |データベース |ローカルフォルダストレージ |
|---|---|---|---:|
|Wrangler ローカル |`http://127.0.0.1:8787` |ローカルD1/KVエミュレーター |いいえ |
|Node |`http://127.0.0.1:8788` |`<DATA_DIR>/mihonban.sqlite` |はい |
|Cloudflare |Worker URL/カスタムドメイン |リモートD1 + KV |いいえ |

ローカルWrangler最も本番Cloudflareに近いです。Nodeは恒久的なローカル/NASサービスに適しており、サーバーローカルフォルダのバックエンドを読み取れる唯一の runtime です。

## 3. ローカル Wrangler 開発

### Windows 補助スクリプト

リポジトリがOneDriveされている場合は、以下をご利用ください:

```powershell
tools\cloud-dev.cmd
```

ヘルパーはデフォルトで `cloud/` を`%TEMP%\mihonban-cloud-build`にコピーし、そこに依存関係をインストールし、Reactを構築し、ローカルスキーマを適用して`0.0.0.0:8787`でWranglerを始めます。`MIHONBAN_STAGE` を別の非同期ディレクトリに設定し、一時的なディレクトリのクリーンアップを通じてローカルD1を保持します。

初回実行時には以下の`.dev.vars`が生成されます:

```text
APP_PASSWORD=mihonban-guest
ADMIN_PASSWORD=mihonban-admin
```

残りの秘密はランダムです。これら2つのパスワードはローカル開発のデフォルトのみです。他の人が接続できるようにする前に、管理者で変更してください。

### Wrangler の手動設定

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
# .env.example を基に .dev.vars を作成し、すべてのプレースホルダーを置き換えます。
# ローカル HTTP では DEV_INSECURE_COOKIE=1 を設定します。
npx wrangler d1 execute DB --local --file schema.sql
npx wrangler dev --ip 0.0.0.0 --port 8787
```

ステージングヘルパーがなければ、ローカルステートは`cloud/worker/.wrangler/`下に置かれます。`.wrangler/`も`.dev.vars`もGitは無視されます。

電話のテストでは、同じLANに接続し、ホストファイアウォールをNode.jsして`http://<computer-lan-ip>:8787`を開きます。この単純なHTTP開発サーバーをインターネットに公開しないでください。

## 4. ローカル Node + SQLite

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
# Windows: Copy-Item .env.example .env
# POSIX:   cp .env.example .env
npm run node
```

始める前に、編集を`.env`:

```dotenv
APP_PASSWORD=choose-a-listener-password
ADMIN_PASSWORD=choose-a-separate-admin-password
SESSION_SECRET=at-least-32-random-characters
DEV_INSECURE_COOKIE=1
DATA_DIR=D:/mihonban-data
PORT=8788
```

内蔵のNodeパスワードはありません。`APP_PASSWORD`はリスナーパスワードです。パスワードなしのゲストアクセスは別の管理者トグルです。サーバーが`0.0.0.0`を割り当てるので、ファイアウォールがポートを許可した後`http://<computer-lan-ip>:8788` LANで動作します。

データベースは`<DATA_DIR>/mihonban.sqlite`されています。`DATA_DIR`が設定されていないとデフォルトで`cloud/worker/data/`になります。アプリが停止している間やSQLite認識ツールを使ってバックアップしてください。公開Node展開では、信頼できるプラットフォームやリバースプロキシの背後でHTTPSが必要です。リクエストが常に自分が管理するプロキシを通過する場合にのみ`TRUST_PROXY=1`設定してください。

## 5. オプションの Python コンパニオン

ウェブアップロード/インポートで十分な場合はこのセクションを飛ばしてください。受信トレイの監視、フォルダやシングル/ネストアーカイブ、タグ修復、ローカル整理、ローカル/クラウドの照合のためにコンパニオンをインストールしてください。

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -e ./pipeline
mihonban setup
mihonban doctor
```

`mihonban setup`リポジトリの外にプライベートTOMLを書き込みます。`MIHONBAN_CONFIG`は現在のオーバーライド変数であり、レガシーエイリアスではありません。ルックアップの順序は明示的に`--config`、`MIHONBAN_CONFIG`、`./mihonban.toml`、そしてプラットフォームユーザー設定ディレクトリです。

一般的なコマンド:

```text
mihonban ingest --apply
mihonban watch
mihonban cloud sync
mihonban cloud pull
```

コンパニオンは、永続的なローカルファイルシステムや7-Zipやビーツなどの外部ツールが必要なため、Cloudflare Workers内で実行できません。

## 6. Cloudflare へのデプロイ

マニュアルパスは正史であり、コンパニオンを必要としません。

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
npx wrangler login
npx wrangler d1 create mihonban
npx wrangler kv namespace create mihonban-kv --binding KV
```

`d1 create`に `--location apac`(または他の対応する場所のヒント)を加えてください
明示的なプライマリリージョンが必要です。公開設定を無視した設定にコピーしてください
ローカルデプロイメントのconfigを、そのゼロのプレースホルダーを返されたものに置き換えます
D1およびKV ID:

もしWranglerがどちらかのリソースを作成する際に現在の設定を更新することを提案した場合、
回答 **いいえ**;本物のIDは下記に作成されたプライベートコピーに記載されています。

```bash
cp wrangler.jsonc wrangler.local.jsonc
```

PowerShellは`Copy-Item wrangler.jsonc wrangler.local.jsonc`を使っています。現実を考えてください
アカウントIDと公開`wrangler.jsonc`の秘密をすべて外に出します。次に実行してください:

```bash
npx wrangler d1 execute mihonban --remote --file schema.sql --config wrangler.local.jsonc
npx wrangler secret put APP_PASSWORD --config wrangler.local.jsonc
npx wrangler secret put ADMIN_PASSWORD --config wrangler.local.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

Cloudflareデプロイメントにはデフォルトのリスナーや管理者パスワードはありません。固有の数値を入力し、`SESSION_SECRET`には少なくとも32文字のランダムな文字を使います。ローカルのコンパニオンがデプロイメントを呼び出す場合にのみ、`COMPANION_KEY`を追加します:

```bash
npx wrangler secret put COMPANION_KEY --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

同じWorkerものが`/api/*`と構築されたReact資産の両方にサービスを提供します。別のフロントエンドホストは不要です。

### 任意の Windows 統合ウィザード

`tools\deploy-cloud.cmd`リソースCloudflareプロビングし、両方のパスワードにプロンプトを出し、ランダムなセッション/コンパニオンシークレットをアップロードし、コンパニオン`[cloud]`セクションを書き込み、最初の同期を実行し、ウォッチャーをインストールします。これは統合されたWindowsワークフローにのみ使用してください。クラウドのみのユーザーは上記の手動コマンドを使うべきです。

## 7. ストレージの設定

管理者としてサインインし、名前付きのバックエンドを追加してください。アップロード前に1つのバックエンドを書き込みターゲットとして選択する必要があります。

### OneDrive

ファイルの読み書きとオフラインアクセスを委任したAzureアプリケーションを作成します。AdminでクライアントID、クライアントシークレット、リフレッシュトークン、ドライブIDを入力し、バックエンドをテストします。OneDrive再生は通常一時的なURLを使用し、Workerをバイパスすることがあります。

### WebDAV

ライブラリのルートURLと認証情報を入力します。再生とアップロードはメインWorkerを通過します。なぜならWebDAVには一時的な公開ダウンロードURLが存在しないためです。

### Google Drive

Drive APIを有効にし、デスクトップOAuthクライアントを作成します。Adminで認可URLを生成し、承認し、必要に応じて`http://localhost`から`code`をコピーし、必要に応じてリダイレクトし、交換してからテストしバックエンドを追加します。既存のライブラリの発見とアップロードには、書き込み可能なドライブのスコープが必要です。

### ローカルフォルダ

Node runtimeでのみ利用可能です。設定済みのルートはサーバーのファイルシステム内に留まる必要があり、Cloudflareに持ち運べません。[ストレージバックエンドとファイル遷移](storage.ja.md).

## 8. 任意の R2 イメージミラー

R2は再構築可能なイメージミラーであり、カタログデータベースやオーディオバックエンドではありません。バケット、公開読み取りURL、S3互換の読み書きトークンを作成し、Admin、test、enable、prewarmに入力してください。アクセスキーとシークレットはGitには残さないようにしてください。同じバケットを保持しながら移行する際は、`-IncludeCache`で`r2_cache`を保持してください。新しいバケットの場合は省略してプリウォームしてください。

## 9. 既存データベースの移行

空のデプロイを作成し、設定リストアでアルバムが戻ると考えないでください。カタログデータ、設定、runtimeシークレット、オーディオは別々のレイヤーです。切り替え前に[データベースのバックアップ、移行、回復](database-migration.ja.md)に従ってください。runtimes。

## 10. 任意の音声プロキシ

メインWorkerすでにプライベート認証情報を必要とするバックエンドをプロキシしています。2つ目のCloudflareルートやカスタムドメインが一時的なURL再生を測定的に改善した場合にのみ`cloud/proxy-worker`展開してください。[オプションCloudflare audio proxy](audio-proxy.ja.md) を参照。

## 11. アップデート

大幅なアップデートの前に、データベースと管理者設定のJSONをバックアップしてください。

Cloudflare:

```bash
git pull
cd cloud/web && npm ci && npm run build
cd ../worker && npm ci
npx wrangler d1 execute mihonban --remote --file schema.sql --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

Node:`cloud/web`を再構築し、Worker依存関係を再インストールし、古いプロセスを停止し、`npm run node`を再起動します。`schema.sql`は繰り返し可能であり、移行runtime古いデータベースで必要とされる列を追加します。

## 12. 動作確認

- リスナーおよび管理者のパスワードでログイン;パスワードレスゲストモードは有効時のみテスト。
- ライブラリ、トラック、アーティスト、お気に入り、インポート、管理ルートをオープン。
- トラックを再生し、終盤近くを探し、iOS/Androidでシステムのメディアコントロールをテストします。
- カバー、アーティストアバター、アルバムギャラリーを開く;モバイルでギャラリーをスワイプするテスト。
- 隠しアルバム、トラック、アーティスト、スタイル、画像、検索結果、お気に入りがリスナーに利用できないことを確認する。
- 使い捨てアルバムを選んだ書き込みターゲットにアップロードし、その後削除します。
- データベースバックアップと管理設定のJSONの両方をエクスポートします。

## トラブルシューティング

|症状 |チェック |
|---|---|
|ログインはすぐにログインページに戻る |ローカルHTTPは`DEV_INSECURE_COOKIE=1`が必要です;公開展開はHTTPSが必要です |
|古い環境のパスワードが拒否される |Adminに保存されたパスワードはハッシュとして保存され、優先されます |
|ストリームリターン502 |名前付きバックエンドバインディング、認証情報、相対パス、上流Rangeサポート |
|既存のアルバムが欠落しています |カタログデータベースを復元してください;設定 JSON にアルバムが含まれていません |
|Wrangler空のようです |コマンドが`--local`か`--remote`か、どのステージディレクトリが`.wrangler/`を持っているかを確認してください |
|Node空に見える |`DATA_DIR`が意図した`mihonban.sqlite`を指しているか確認 |
|電話が接続できません |LAN IPを使い、バインド`0.0.0.0`、選択したポートをファイアウォール通過させてください |
|ログインで429 |再試行をやめて、ソースIPロックアウトが切れるまで15分待ってください |
