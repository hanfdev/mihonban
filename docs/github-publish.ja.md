# コードを安全に公開する

[English](github-publish.md) · [简体中文](github-publish.zh.md) · [繁體中文](github-publish.zh-Hant.md) · [日本語](github-publish.ja.md) · [한국어](github-publish.ko.md) · [Français](github-publish.fr.md) · [Español](github-publish.es.md)

公式の公開リポジトリは [hanfdev/mihonban](https://github.com/hanfdev/mihonban) です。ソースコード、テスト、公開ドキュメント、安全なテンプレートだけを収録します。

## 追跡してはいけないもの

- `.dev.vars`、`.env`、`mihonban.toml`、`rclone.conf`、`wrangler.local.jsonc`、またはプロバイダー構成
- `backups/`、`*.sqlite`、`*.db`、SQLエクスポート、または管理者設定JSON
- 音声、個人カバー/ギャラリー、保存されたRYMページ、または受信箱アーカイブ
- Cloudflare、Azure、Google、WebDAV、Discogs、R2、プロキシ、またはコンパニオンの認証情報
- `GOAL.local.md`およびその他の民間計画・代理人に関する注記
- 生成された`node_modules`、`.wrangler`、ビルド出力、ログ、または一時ファイル

ルート`.gitignore`は標準的な場所をカバーしますが、ルールを無視すると、すでにコミットされたファイルを削除することはありません。

## push 前の確認

```bash
git status --short
git diff --check
git diff --stat
git grep -n -I -i -E "refresh[_-]?token|client[_-]?secret|access[_-]?key|proxy[_-]?secret" -- .
```

すべてのマッチを手動で確認してください。変数名や黒塗りされた例は期待されますが、実際の値は含まれません。また、コミット作成者の識別も確認してください:

```bash
git log -5 --format='%h %an <%ae> %s'
```

最初の公開リリース前や履歴書き直しの後に、Gitleaksのような専用スキャナーをすべてのリファレンスに対して実行してください。

## リポジトリの検証

リポジトリのルートから:

```bash
python -m pytest -q
```

そして各パッケージで:

```bash
cd cloud/web
npm ci
npm test
npm run build

cd ../worker
npm ci
npm test
npx wrangler deploy --dry-run

cd ../proxy-worker
npm ci
npm test
npx wrangler deploy --dry-run
```

CIパスを通すためだけに、無視されたビルド出力やローカルD1状態、データベース、バックアップを追加しないでください。

## remote と fork

押す前に目的地を確認してください:

```bash
git remote -v
git branch --show-current
```

正典上の起源は以下の通りです:

```text
https://github.com/hanfdev/mihonban.git
```

個人的なforkとして、`origin` forkを指し示し、正典リポジトリを保持してください`upstream`:

```bash
git remote add upstream https://github.com/hanfdev/mihonban.git
git fetch upstream
```

ローカルリカバリーブランチやバックアップ資料を無視してpushないでください。

## CI とデプロイ用シークレット

- ビルドおよびユニットテストは本番の秘密を必要としません。
- 信頼されていないpull requestsは展開秘密を受け取ってはならない。
- 展開時にGitHub環境および最小権限Cloudflare APIトークンを使用すること。
- フロントエンドのビルド変数にストレージやR2認証情報を置かないでください。
- チャット、ログ、スクリーンショット、CI出力、またはGit履歴に現れた生産秘密をローテーションします。

## リリースチェックリスト

- すべての公開ガイドには、英語、簡体字中国語、繁体字中国語、日本語、韓国語、フランス語、スペイン語の各バージョンがあり、有効なクロス言語リンクがあります。
- `npm ci`と`pip install -e ./pipeline`で新しいクローンをインストールします。
- Python、フロントエンド、メインWorker、プロキシWorker、そしてドライランチェックが通過します。
- ドキュメントには機械固有のパス、個人サービスURL、認証情報が含まれていません。
- データベース/スキーマの移行ノートがリリースコードと一致します。
- プライベート音楽や第三者の著作権資産はバンドルされません。
- `LICENSE`は存在し、パッケージのメタデータは依然として`AGPL-3.0-only`を宣言します。

## シークレットをコミットした場合

1. すぐに提供者で取り消しまたはローテーションを行う。
2. 現在のファイルやデプロイメントから削除する。
3. 必要に応じて影響を受けた歴史を書き換え、`git filter-repo`またはBFGで行います。
4. すべての協力者と連携した後にフォースpush。
5. 古いクローン、ログ、遺物はすべて破損したコピーとして扱う。

後のコミットで値を削除しても、履歴からは消えるわけではありません。

## ライセンスの範囲

このAGPLはこのリポジトリのソフトウェアを扱っています。音楽、個人ライブラリ画像、第三者メタデータの公開許可は付与しません。すべてのリリースはその区別を保持しなければなりません。
