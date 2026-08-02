# 資料庫備份、遷移與恢復

[English](database-migration.md) · [简体中文](database-migration.zh.md) · [繁體中文](database-migration.zh-Hant.md) · [日本語](database-migration.ja.md) · [한국어](database-migration.ko.md) · [Français](database-migration.fr.md) · [Español](database-migration.es.md)

本文用於在 Node SQLite、Wrangler 本地 D1 和 Cloudflare 遠端 D1 之間搬遷完整曲庫。

繼續只在本地使用時，應分別備份 `<DATA_DIR>/mihonban.sqlite`、管理後臺設定 JSON、執行時金鑰和音訊。只有真正建立 Cloudflare 部署後，遠端步驟才適用。

## 到底要搬哪些東西

| 資料 | 遷移方式 |
|---|---|
| 專輯、曲目、藝人、內頁、收藏、備註、資源站狀態 | D1 SQL 匯出/匯入 |
| OneDrive/R2/模組設定和命名儲存配置 | 管理後臺設定 JSON |
| 聽眾/管理員口令、會話金鑰、伴侶 Key、代理簽名金鑰 | 在新 Worker 單獨配置 secrets |
| KV 限流與短期快取 | 不遷移 |
| R2 映象索引 | 複用同一桶時加 `--include-cache` 匯出；換新桶時省略並重新預熱 |
| 音訊和原圖 | 在儲存層複製/遷移，不屬於 D1 |

只下載管理後臺 JSON 不等於備份曲庫；只匯入 D1 也不會自動搬音訊或恢復全部金鑰。

專輯與藝人的有序關係保存在 `album_artists`；只有某首歌具有獨立署名時才寫入 `track_artists`，沒有歌曲層級記錄就自動繼承專輯藝人。邏輯 SQL 匯出會包含這兩張表。升級後首次使用時，Mihonban 會自動建表，並將每張舊專輯的原藝人欄位原樣回填為一位藝人。系統不會按逗號自動拆分，因為逗號也可能屬於藝人名或排序名。整張合作請使用專輯編輯器；只在部分歌曲出現的客席藝人，請在「管理曲目」的藝人按鈕中設定。

`artist_sort` 是選填值：匯出與匯入會保留空值，搜尋與排序只在執行時改用藝人原名。

## 從 Node 本地儲存遷到 Cloudflare 前

Cloudflare 不能讀取 Node 的 `local` 後端。舊 Node 服務還能執行時先做：

1. 新增並測試 OneDrive、WebDAV 或 Google Drive。
2. 把所有繫結本地資料夾的專輯遷到雲後端。
3. 抽查播放、封面、頭像和內頁。
4. 再匯出資料庫。

否則新站只能看到後設資料，音訊會 502。

## 1. 備份源端

在舊站用管理員登入，下載 **管理 → 設定備份** JSON，並放進加密保險庫。

Node 資料庫為 `<DATA_DIR>/mihonban.sqlite`。Wrangler 本地 D1 位於 `cloud/worker/.wrangler/state/v3/d1/`。

正式切換時停止寫操作。匯出器使用 SQLite 只讀事務，但無人同時編輯更容易核對。

## 2. 準備新 Cloudflare 專案

建立 D1/KV，把公開模板複製為已忽略的本地配置，只在本地配置中填入真實 ID，然後應用 schema：

```bash
cd cloud/worker
npm ci
cp wrangler.jsonc wrangler.local.jsonc
# 在 wrangler.local.jsonc 中替換 D1/KV 的全零佔位 ID。
npx wrangler d1 execute mihonban --remote --file schema.sql \
  --config wrangler.local.jsonc
```

PowerShell 使用 `Copy-Item wrangler.jsonc wrangler.local.jsonc`。本文命令中的 D1 資源名為 `mihonban`，與配置和 Worker 保持一致。不要把賬戶資源 ID 或部署金鑰寫進公開模板。

如果目標 D1 已有重要內容，先備份：

```bash
mkdir -p ../../backups
npx wrangler d1 export mihonban --remote \
  --output ../../backups/remote-before-import.sql \
  --config wrangler.local.jsonc
```

PowerShell 可先用 `New-Item -ItemType Directory ../../backups -Force` 建立目錄。

## 3. 匯出並匯入曲庫

### Windows 一體工具

倉庫根目錄執行：

```powershell
powershell -File tools\migrate-d1.ps1 -ImportRemote
```

工具會自動尋找最新的 Node SQLite 或 Wrangler 本地 D1，在已忽略的 `backups/` 下生成帶時間戳 SQL。只有顯式加 `-ImportRemote` 才寫遠端；去掉該開關就是隻匯出。每次遠端匯入前，工具還會先把當前目標匯出到 `backups/`，備份失敗就終止匯入。`-SkipRemoteBackup` 只用於明確接受風險的緊急情況。

工具優先使用已忽略的 `cloud/worker/wrangler.local.jsonc`，不存在時才使用公開模板。可用 `-WranglerConfig <路徑>` 指定其他私有配置。

目標繼續使用完全相同的 R2 桶和公開 URL 時，加 `-IncludeCache`，預熱即可跳過桶內已有映象：

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -IncludeCache -ImportRemote
```

遷往空桶或不同桶時不要帶這個索引，否則記錄會指向不存在的物件。如果複用原桶卻漏遷了索引，當前預熱會對確定性物件 URL 做 HEAD 檢查，直接認領已有物件，不再重複上傳圖片位元組。

本機存在多個資料庫時，必須顯式傳入 `-Source`，不要依賴修改時間自動選擇。

顯式指定源：

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -Database "mihonban" `
  -WranglerConfig "cloud\worker\wrangler.local.jsonc" `
  -ImportRemote
```

### 任意系統手動執行

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

預設是按主鍵 UPSERT 的合併模式，源端沒有的目標行會保留；如果同一路徑已對應另一個 ID，會明確失敗而不是靜默刪除。對空目標來說就是完整源曲庫。`--replace` 會先清空本次包含的曲庫表，只能在目標備份後使用。

生成的 SQL 故意不包含顯式 `BEGIN TRANSACTION` 或 `COMMIT`：當前遠端 D1 匯入會拒絕這些語句，而 Wrangler 會原子應用整個上傳檔案。匯出器讀取源 SQLite 時仍使用單個事務，因此快照保持一致。

`--include-config` 會匯出命名儲存和與管理後臺備份相同的設定白名單，因此 SQL 會包含儲存及服務憑據；它明確排除聽眾/管理員口令雜湊、會話紀元、伴侶心跳、掃描時間和錯誤狀態。目標 Worker 的口令與執行時金鑰必須單獨設定。配置遷移仍推薦使用管理後臺 JSON。即使同時使用 `--replace`，也只替換白名單配置鍵，目標端認證與執行狀態行保持不變。

複用同一 R2 桶時再加 `--include-cache`；換新桶時省略。

## 4. 恢復設定和 secrets

1. 新主 Worker 配置新的 `APP_PASSWORD`、`ADMIN_PASSWORD`、`SESSION_SECRET`、`COMPANION_KEY`。
2. 用新管理員口令登入。
3. 管理 → 設定備份 → 匯入舊 JSON。
4. 逐個測試儲存和 R2。
5. 使用外部音源代理時，主 Worker 設定 `STREAM_PROXY_SECRET`，代理 Worker 設定相同值為 `PROXY_SECRET`。

設定 JSON 故意不恢復口令雜湊和舊會話。

## 5. 核對

```bash
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS albums FROM albums"
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS tracks FROM tracks"
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS artists FROM artists"
```

網頁繼續檢查：

- 專輯、曲目、藝人、收藏、備註、隱藏狀態和排序。
- 每個儲存後端至少播一首，並拖動進度。
- 封面、藝人頭像、內頁圖。
- 聽眾無法看到隱藏資源。
- 新站能再次匯出設定 JSON。
- 未遷移 R2 索引時執行預熱：已有公開物件會透過 HEAD 被認領，只有真正缺失的物件才上傳。

## 6. 切換與回滾

驗收透過後才修改本機 `[cloud].url`。保留舊資料庫、舊部署、SQL、設定 JSON 和源音訊，直到新站完成一次真實恢復演練。

回滾可以把 URL 指回舊站，或把匯入前的遠端 SQL 恢復到乾淨 D1。資料庫切換期間絕不能刪除唯一音訊副本。

## Cloudflare 專案之間遷移

舊專案直接 `wrangler d1 export --remote`，新專案應用 schema 後匯入。仍保持三層分離：D1 SQL 遷曲庫、設定 JSON 遷配置、Worker secrets 單獨設定。
