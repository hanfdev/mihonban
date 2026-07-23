# 安全釋出程式碼到 GitHub

[English](github-publish.md) · [简体中文](github-publish.zh.md) · [繁體中文](github-publish.zh-Hant.md) · [日本語](github-publish.ja.md) · [한국어](github-publish.ko.md) · [Français](github-publish.fr.md) · [Español](github-publish.es.md)

正式公開倉庫是 [hanfdev/mihonban](https://github.com/hanfdev/mihonban)。倉庫只應包含原始碼、測試、公開文件和安全模板。

## 絕不能跟蹤

- `.dev.vars`、`.env`、`mihonban.toml`、`rclone.conf`、`wrangler.local.jsonc` 或服務商配置
- `backups/`、`*.sqlite`、`*.db`、SQL 匯出或管理後臺設定 JSON
- 音訊、私人封面/內頁、手存 RYM 頁面或收件箱壓縮包
- Cloudflare、Azure、Google、WebDAV、Discogs、R2、代理或伴侶憑據
- `GOAL.local.md` 和其他私有規劃/代理筆記
- 生成的 `node_modules`、`.wrangler`、構建產物、日誌或臨時檔案

根目錄 `.gitignore` 已覆蓋常見位置，但忽略規則不會自動移除已經提交過的檔案。

## 每次推送前

```bash
git status --short
git diff --check
git diff --stat
git grep -n -I -i -E "refresh[_-]?token|client[_-]?secret|access[_-]?key|proxy[_-]?secret" -- .
```

逐條人工判斷：變數名和脫敏示例正常，真實值不正常。同時檢查最近提交者身份：

```bash
git log -5 --format='%h %an <%ae> %s'
```

首次公開或改寫歷史後，使用 Gitleaks 等專用工具掃描所有 refs。

## 驗證倉庫

在倉庫根目錄：

```bash
python -m pytest -q
```

然後分別進入三個 Node package：

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

不要為了讓 CI 透過而新增被忽略的構建產物、本地 D1、資料庫或備份。

## 遠端與 Fork

推送前確認目標：

```bash
git remote -v
git branch --show-current
```

正式 origin 是：

```text
https://github.com/hanfdev/mihonban.git
```

個人 fork 應讓 `origin` 指向自己的倉庫，並把正式倉庫保留為 `upstream`：

```bash
git remote add upstream https://github.com/hanfdev/mihonban.git
git fetch upstream
```

不要推送本地恢復分支或被忽略的備份材料。

## CI 與部署金鑰

- 構建和單元測試不需要生產金鑰。
- 不受信任的 pull request 不能獲得部署金鑰。
- 部署使用 GitHub Environment 和最小許可權 Cloudflare API token。
- 儲存和 R2 憑據絕不能進入前端構建變數。
- 曾出現在聊天、日誌、截圖、CI 輸出或 Git 歷史中的生產金鑰必須輪換。

## 釋出清單

- 每份公開指南都有英語、簡體中文、繁體中文、日語、韓語、法語和西班牙語版本，並能透過有效連結互相跳轉。
- 全新 clone 可用 `npm ci` 和 `pip install -e ./pipeline` 安裝。
- Python、前端、主 Worker、代理 Worker 和 dry-run 檢查全部透過。
- 文件沒有機器專屬路徑、私人服務 URL 或憑據。
- 資料庫/schema 遷移說明與釋出程式碼一致。
- 倉庫不包含私人音樂或未經許可的第三方版權資源。
- `LICENSE` 保留，package metadata 仍宣告 `AGPL-3.0-only`。

## 若金鑰已經提交

1. 立即在服務商側吊銷或輪換。
2. 從當前檔案和部署中刪除。
3. 必要時用 `git filter-repo` 或 BFG 改寫受影響歷史。
4. 與全部協作者協調後再強制推送。
5. 把舊 clone、日誌和構建產物都視為已洩露副本。

只在後續 commit 刪除該值，並不能從歷史中清除它。

## 許可證邊界

AGPL 覆蓋本倉庫的軟體，不授予釋出音樂、私人曲庫圖片或第三方後設資料的許可。每次釋出都必須保持這條邊界清晰。
