# 任意の Cloudflare 音声プロキシ

[English](audio-proxy.md) · [简体中文](audio-proxy.zh.md) · [繁體中文](audio-proxy.zh-Hant.md) · [日本語](audio-proxy.ja.md) · [한국어](audio-proxy.ko.md) · [Français](audio-proxy.fr.md) · [Español](audio-proxy.es.md)

`cloud/proxy-worker`はメインmihonbanアプリの一時的な音声URLを中継するスタンドアロンWorkerです。2つ目のWorkerルートやカスタムドメインがストレージCDNへのより良い経路を提供する場合に便利です。

音声キャッシュはできず、高速を保証できません。前後で測定してください。

## セキュリティモデル

- メインWorkerはソースURLと5分間の有効期限を署名`STREAM_PROXY_SECRET`。
- プロキシは`PROXY_SECRET`と同じ値を検証します。
- GET、HEAD、OPTIONSのみが受け付けられています。
- `ALLOWED_HOSTS`のHTTPSアップストリームのみが認められています。
- すべての上流リダイレクトは許可リストと照合されます。
- Rangeおよび条件付きヘッダーは転送されます。クッキーや認可ヘッダーは転送されません。
- レスポンスは非公開/ストアなしです。

本番環境で非署名モードを有効にしず、制限なしホストワイルドカードを設定しないでください。

## 1. プロキシの設定とデプロイ

編集`cloud/proxy-worker/wrangler.jsonc`:

- `ALLOWED_HOSTS`:点で始まるコンマ区切られた正確なホストまたは接尾辞。
- `ALLOWED_ORIGINS`:主なmihonban起源;`*`は機能しますが、特定の起源が望ましいです。

デフォルトのOneDrive接尾辞は出発点です。Microsoftはテナントや地域のダウンロードドメインにリダイレクトできます。失敗したリクエストで確認された正確な接尾辞のみを追加してください。

```bash
cd cloud/proxy-worker
npm ci
npm test
npx wrangler login
npx wrangler secret put PROXY_SECRET
npx wrangler deploy
```

少なくとも32文字のランダム文字を使用し、32バイトのランダムな文字列から生成される十六進文字列を推奨します。一時的に保持しておき、まったく同じ値をメインWorkerに加えられます。

## 2. メイン Worker の設定

```bash
cd ../worker
npx wrangler secret put STREAM_PROXY_SECRET
npx wrangler deploy
```

`PROXY_SECRET`に使ったのとまったく同じ秘密を貼り付けます。

mihonban管理モジュールパネルでは:

1. オーディオプロキシを有効にする。
2. カスタムプロキシURLを以下に設定します:

```text
https://mihonban-audio-proxy.<account>.workers.dev/?url={url}
```

3. OneDriveバックトラックを保存して再生する。

メインWorkerは自動的に`expires`と`sig`付け加えます。共有シークレットはURLに絶対に入れないでください。

## 3. 動作確認

```bash
curl https://mihonban-audio-proxy.<account>.workers.dev/healthz
```

その後、プレイ中にブラウザのネットワークツールを使ってください:

- メイン`/api/stream/<id>`が302をプロキシに返します。
- 代理は200または206を返す。
- シークは送`Range`と受け取り`Content-Range`。
- 署名のない`?url=...`リクエストは401を返します。
- 許可されていないホストは403を返す。

## スコープ

外部プロキシは、メインWorkerが一時的なダウンロードURLを取得できる場合にのみ使用され、現在はOneDriveスタイルのバックエンドです。WebDAV、Google Drive、Nodeローカルストレージはプライベート認証情報を必要とし、メインWorkerの背後に留まります。

## トラブルシューティング

|ステータス |意味/行動 |
|---|---|
|401 |秘密が異なる、署名が期限切れ、またはメインWorkerが再配置されていない |
|403 |初期ソースホストは許可リストに載せられません |
|ホストメッセージ付き502 |リダイレクトが別のホストに届きました;接尾辞を追加する前に確認してください |
|416 |上流が要求されたバイト範囲を拒否しました |
|再生が遅くなる |外部URLを無効にして、ダイレクト/メインWorkerパスを使え |

署名値が露出した場合は両方の秘密をローテーションします。既存の署名済みURLは5分以内に期限切れになります。
