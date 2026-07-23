# 安裝與部署

[English](install.md) · [简体中文](install.zh.md) · [繁體中文](install.zh-Hant.md) · [日本語](install.ja.md) · [한국어](install.ko.md) · [Français](install.fr.md) · [Español](install.es.md)

本文覆蓋三種受支援的應用執行時，以及可選的本機 Python 伴侶。應用執行時三選一；伴侶只是額外工作流工具，不是伺服器必需元件。

## 1. 準備環境

- Node.js 22 或更新版本
- Git
- 只有部署 Cloudflare 時才需要 Cloudflare 賬號
- Cloudflare 部署至少需要 OneDrive、WebDAV 或 Google Drive 中的一種
- 只有安裝本機伴侶時才需要 Python 3.11+ 和 7-Zip（`7z`、`7zz` 或 `7za`）
- 可選：供伴侶執行本地到雲端檔案同步的 `rclone`

實時 SQLite、`music_root`、`data_dir`、臨時目錄和 `node_modules` 不要放進 OneDrive、Dropbox、iCloud 等同步目錄。倉庫本身可以同步，但構建目錄與可變資料必須放在同步盤外。

克隆正式倉庫：

```bash
git clone https://github.com/hanfdev/mihonban.git
cd mihonban
```

## 2. 選擇執行方式

| 執行時 | 預設網址 | 資料庫 | 本地資料夾後端 |
|---|---|---|---:|
| Wrangler 本地 | `http://127.0.0.1:8787` | 本地 D1/KV 模擬 | 不支援 |
| Node | `http://127.0.0.1:8788` | `<DATA_DIR>/mihonban.sqlite` | 支援 |
| Cloudflare | Worker URL/自定義域 | 遠端 D1 + KV | 不支援 |

Wrangler 本地環境最接近 Cloudflare 生產環境。Node 更適合作為長期執行的本機/NAS 服務，也是唯一能讀取伺服器本地資料夾後端的執行時。

## 3. 本地 Wrangler 開發

### Windows 輔助指令碼

倉庫位於 OneDrive 時，使用：

```powershell
tools\cloud-dev.cmd
```

指令碼預設把 `cloud/` 複製到 `%TEMP%\mihonban-cloud-build`，在同步盤外安裝依賴、構建 React、應用本地 schema，並以 `0.0.0.0:8787` 啟動 Wrangler。可以把 `MIHONBAN_STAGE` 指向另一個非同步目錄，避免系統清理臨時目錄時丟失本地 D1。

首次執行會生成 `.dev.vars`，其中：

```text
APP_PASSWORD=mihonban-guest
ADMIN_PASSWORD=mihonban-admin
```

其餘金鑰隨機生成。這兩個口令只用於本地開發；允許其他人連線前，應在管理後臺立即修改。

### 手動執行 Wrangler

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
# 參考 .env.example 建立 .dev.vars，並替換全部佔位值。
# 本地 HTTP 設定 DEV_INSECURE_COOKIE=1。
npx wrangler d1 execute DB --local --file schema.sql
npx wrangler dev --ip 0.0.0.0 --port 8787
```

不使用暫存指令碼時，本地狀態位於 `cloud/worker/.wrangler/`。`.wrangler/` 和 `.dev.vars` 都已被 Git 忽略。

手機測試時，讓手機與電腦連線同一區域網，在主機防火牆中允許 Node.js，然後開啟 `http://<電腦內網 IP>:8787`。不要把這個純 HTTP 開發伺服器直接暴露到公網。

## 4. 本地 Node + SQLite

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

啟動前編輯 `.env`：

```dotenv
APP_PASSWORD=自定義聽眾口令
ADMIN_PASSWORD=另一份管理員口令
SESSION_SECRET=至少32個隨機字元
DEV_INSECURE_COOKIE=1
DATA_DIR=D:/mihonban-data
PORT=8788
```

Node 模式沒有內建口令。`APP_PASSWORD` 是聽眾口令；免密訪客訪問是管理後臺中的另一個獨立開關。伺服器監聽 `0.0.0.0`，防火牆允許埠後，區域網裝置可以開啟 `http://<電腦內網 IP>:8788`。

資料庫位於 `<DATA_DIR>/mihonban.sqlite`；未設定 `DATA_DIR` 時預設為 `cloud/worker/data/`。應用停止後再複製資料庫，或使用 SQLite 感知的備份工具。公開 Node 部署必須位於可信平臺或反向代理的 HTTPS 後面；只有所有請求都經過自己控制的代理時才設定 `TRUST_PROXY=1`。

## 5. 可選 Python 本機伴侶

網頁上傳/匯入已經夠用時可跳過。本機伴侶用於收件箱守望、資料夾或單層/巢狀壓縮包、標籤修復、本地整理，以及本地與雲端對賬。

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

`mihonban setup` 會把私有 TOML 寫到倉庫外。`MIHONBAN_CONFIG` 是當前正式變數，不是舊相容別名。查詢順序是顯式 `--config`、`MIHONBAN_CONFIG`、`./mihonban.toml`，最後才是系統使用者配置目錄。

常用命令：

```text
mihonban ingest --apply
mihonban watch
mihonban cloud sync
mihonban cloud pull
```

伴侶不能執行在 Cloudflare Workers 中，因為它需要持久本機檔案系統和 7-Zip、beets 等外部程式。

## 6. 部署到 Cloudflare

手動部署是標準流程，不要求安裝本機伴侶。

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

需要明確主區域時，可在 `d1 create` 後新增 `--location apac` 或其他受支援的區域提示。建立任一資源時，如果 Wrangler 詢問是否更新當前配置，請選擇**否**；真實 ID 應寫入下面建立的私有副本。把公開配置複製為已被忽略的本地部署配置，再在其中用返回的 D1/KV ID 替換全零佔位符：

```bash
cp wrangler.jsonc wrangler.local.jsonc
```

PowerShell 使用 `Copy-Item wrangler.jsonc wrangler.local.jsonc`。不要把真實賬戶資源 ID 或任何金鑰寫進公開 `wrangler.jsonc`。然後執行：

```bash
npx wrangler d1 execute mihonban --remote --file schema.sql --config wrangler.local.jsonc
npx wrangler secret put APP_PASSWORD --config wrangler.local.jsonc
npx wrangler secret put ADMIN_PASSWORD --config wrangler.local.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

Cloudflare 部署沒有預設聽眾或管理員口令。請分別輸入不同口令，併為 `SESSION_SECRET` 使用至少 32 個隨機字元。只有本機伴侶要連線雲端時才新增：

```bash
npx wrangler secret put COMPANION_KEY --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

同一個 Worker 同源提供 `/api/*` 和構建後的 React 靜態資源，無需另配前端託管。

### 可選 Windows 一體嚮導

`tools\deploy-cloud.cmd` 會建立 Cloudflare 資源、詢問兩種口令、上傳隨機會話/伴侶金鑰、寫入伴侶 `[cloud]` 配置、首次同步並安裝守望任務。它只適合 Windows 的“Cloudflare + 本機伴侶”組合工作流；純雲端使用者使用上面的手動命令。

## 7. 配置音源儲存

管理員登入後新增命名後端。上傳前必須選擇一個寫入目標。

### OneDrive

在 Azure 建立具有委託檔案讀寫與離線訪問許可權的應用。在後臺填寫 client ID、client secret、refresh token 和 drive ID，然後測試。OneDrive 播放通常使用臨時直鏈，可能繞過 Worker。

### WebDAV

填寫曲庫根 URL 和憑據。WebDAV 沒有臨時公開下載 URL，因此播放和上傳都經過主 Worker。

### Google Drive

啟用 Drive API 並建立桌面 OAuth 客戶端。在後臺生成授權連結並同意授權；必要時從 `http://localhost` 跳轉地址中複製 `code`，換取 token 後測試並新增。發現已有曲庫和上傳檔案需要可寫 Drive 許可權。

### 本地資料夾

只在 Node 執行時可用。根目錄必須位於伺服器檔案系統中，不能直接遷到 Cloudflare。詳見[多儲存與檔案遷移](storage.zh-Hant.md)。

## 8. 可選 R2 圖片映象

R2 是可重建的圖片映象，不是曲庫資料庫，也不是音訊後端。建立 bucket、公開讀取 URL 和 S3 相容讀寫令牌，在後臺填寫後測試、啟用並預熱。access key 與 secret 不能進入 Git。遷移時繼續使用同一桶，應透過 `-IncludeCache` 保留 `r2_cache`；換新桶則省略並重新預熱。

## 9. 搬遷已有資料庫

不要以為新建空部署後匯入設定就會恢復專輯。曲庫資料、設定、執行時金鑰和音訊是四個獨立層次。切換執行時前必須遵循[資料庫備份、遷移與恢復](database-migration.zh-Hant.md)。

## 10. 可選音源代理

需要私有憑據的後端本來就由主 Worker 代理。只有第二條 Cloudflare 路由或自定義域實測能改善臨時直鏈播放時，才部署 `cloud/proxy-worker`。見[可選 Cloudflare 音源代理](audio-proxy.zh-Hant.md)。

## 11. 更新版本

較大更新前備份資料庫和管理後臺設定 JSON。

Cloudflare：

```bash
git pull
cd cloud/web && npm ci && npm run build
cd ../worker && npm ci
npx wrangler d1 execute mihonban --remote --file schema.sql --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

Node：重新構建 `cloud/web`、安裝 Worker 依賴、停止舊程序並重新執行 `npm run node`。`schema.sql` 可重複執行，執行時遷移會為舊資料庫補充必需列。

## 12. 驗收

- 分別用聽眾和管理員口令登入；只有明確啟用後才測試免密訪客模式。
- 開啟曲庫、歌曲、藝人、精選、匯入和管理頁面。
- 播放歌曲、拖到接近結尾，並在 iOS/Android 測試系統媒體控制。
- 開啟封面、藝人頭像和專輯內頁，在手機上測試左右滑動。
- 確認隱藏專輯、曲目、藝人、風格、圖片、搜尋結果和精選都不能被聽眾訪問。
- 向當前寫入目標上傳一張可刪除的測試專輯，然後刪除。
- 同時匯出資料庫備份和管理後臺設定 JSON。

## 排障

| 現象 | 檢查 |
|---|---|
| 登入後立刻返回登入頁 | 本地 HTTP 需要 `DEV_INSECURE_COOKIE=1`；公開環境必須是 HTTPS |
| 原環境變數口令被拒絕 | 管理後臺儲存的雜湊口令優先順序更高 |
| 播放返回 502 | 命名後端繫結、憑據、相對路徑和上游 Range 支援 |
| 已有專輯消失 | 必須恢復曲庫資料庫；設定 JSON 不包含專輯 |
| Wrangler 看起來是空庫 | 檢查 `--local`/`--remote`，以及哪個暫存目錄擁有 `.wrangler/` |
| Node 看起來是空庫 | 檢查 `DATA_DIR` 是否指向正確的 `mihonban.sqlite` |
| 手機無法連線 | 使用內網 IP、監聽 `0.0.0.0`，並允許對應埠透過防火牆 |
| 登入返回 429 | 停止重複嘗試，等待來源 IP 的 15 分鐘鎖定結束 |
