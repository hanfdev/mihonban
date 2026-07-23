# 架構與執行模型

[English](cloud.md) · [简体中文](cloud.zh.md) · [繁體中文](cloud.zh-Hant.md) · [日本語](cloud.ja.md) · [한국어](cloud.ko.md) · [Français](cloud.fr.md) · [Español](cloud.es.md)

Mihonban 在本地與雲端使用同一套 React 前端和 Worker 相容 API；不同執行時只替換持久化與檔案訪問適配層。

## 元件

| 元件 | Node | Wrangler 本地 | Cloudflare | 權威性 |
|---|---:|---:|---:|---|
| React 靜態資源 | 支援 | 支援 | 支援 | 可重新構建 |
| Hono API | 支援 | 支援 | 支援 | 無狀態應用層 |
| 曲庫資料庫 | SQLite | 本地 D1 | 遠端 D1 | 權威後設資料 |
| 限流/快取 KV | SQLite 適配 | 本地 KV | Cloudflare KV | 可重建 |
| R2 圖片映象 | 可選 | 可選 binding | 可選 | 可重建圖片快取 |
| 本地資料夾後端 | 支援 | 不支援 | 不支援 | 配置後屬於權威檔案 |
| OneDrive/WebDAV/Google Drive | 支援 | 支援 | 支援 | 權威檔案 |
| Python 伴侶 | 外部程序 | 外部程序 | 外部程序 | 可選本地工作流 |

音訊檔案絕不能進入 D1、KV、R2 圖片快取或 Git。

## 請求路徑

```text
瀏覽器 --HTTP/HTTPS--> API 執行時
                         |-- 曲庫後設資料：SQLite 或 D1
                         |-- 短期快取/限流：KV 適配層
                         |-- 圖片映象：可選 R2
                         +-- 命名儲存後端

OneDrive 臨時 URL ------------> 通常 302 直連播放
WebDAV / Google Drive --------> 主 API Range 代理
Node 本地資料夾 --------------> Node Range 流
可選外部代理 -----------------> 臨時 URL 的五分鐘簽名中轉
```

外部代理只接收主 API 已經能夠取得臨時 URL 的音源，永遠不會獲得 WebDAV、Google Drive 或本地資料夾憑據。

## 認證與身份

- 聽眾口令（初始 `APP_PASSWORD`）：瀏覽和播放。
- 管理員口令（初始 `ADMIN_PASSWORD`）：所有寫操作和基礎設施設定。
- 免密訪客模式：管理員顯式開啟後，無需口令即可獲得聽眾只讀身份。
- 伴侶金鑰（`COMPANION_KEY`）：可選，由本機 Python 伴侶透過 `X-Api-Key` 使用。

在管理後臺修改的口令以 PBKDF2 雜湊寫入資料庫，優先於環境變數中的初始值。修改口令會遞增會話紀元，使已有登入 cookie 失效。登入失敗按來源 IP 計數；六次失敗後鎖定該來源 15 分鐘。

生產 cookie 必須使用 HTTPS。`DEV_INSECURE_COOKIE=1` 只用於可信區域網內的本地 HTTP 測試。

## 資料模型

- `albums`：專輯後設資料、命名 `storage_id`、隱藏狀態和排序欄位。
- `tracks`：曲目後設資料與儲存相對路徑；繼承專輯後端。
- `artists`：藝人後設資料、隱藏狀態、頭像路徑和獨立頭像 `storage_id`。
- `album_images`：位於專輯後端的內頁路徑。
- `favorites`：專輯/曲目精選及順序。
- `notes`：專輯備註、藝人備註和簡介。
- `storages`：命名 OneDrive、WebDAV、Google Drive 或 Node 本地後端配置。
- `settings`：口令雜湊、模組開關、R2、資源站及其他執行狀態。
- `source_posts`、`track_imports` 與圖片快取表：操作性後設資料。

管理後臺設定 JSON 會匯出白名單內的設定和命名儲存配置，其中包含憑據；它不包含曲庫行、口令雜湊或舊會話，必須加密儲存。

## 上傳與播放

- 新上傳必須選擇一個命名後端作為寫入目標。
- 舊專輯繼續使用自己的 `storage_id`；切換寫入目標不會搬移舊檔案。
- OneDrive 使用上傳會話和臨時下載 URL。
- WebDAV 與 Google Drive 上傳/播放經過主 API。
- Node 本地資料夾只由 Node 執行時流式讀取。
- 正確的 Range 與 `Content-Range` 對拖動進度至關重要，尤其是 iOS。

## 圖片

未啟用 R2 時，API 從所屬儲存讀取圖片並使用邊緣/瀏覽器快取頭。啟用 R2 後，首次訪問或預熱會複製到映象，之後可重定向到公開 URL。更換圖片會清除索引，使其重新映象。如果 D1 丟失索引但同一公開 R2 物件仍存在，預熱會用有界 HEAD 探測直接認領，不再下載和重複上傳圖片。

公開映象重新導向落到缺失或陳舊物件時，網頁會改為從所屬儲存回源。Worker 會驗證返回的圖片位元組，必要時從服務商縮圖退回原圖；恢復成功後自動修復 R2 物件及帶版本號的 D1 索引。這樣瀏覽器快取過的舊 404 可以自我修復，同時不會把私人儲存憑據交給瀏覽器。

R2 不是音訊後端，也不是曲庫資料庫。

## 定時任務

Cloudflare 的 Wrangler Cron 在每六小時的第 17 分鐘觸發。Node 使用 `SOURCE_SCAN_HOURS`（預設 `6`，設為 `0` 關閉）。資源站掃描只讀取支援的 RSS/Atom/Blogger 標題和連結，不下載音樂。

`mihonban watch` 是另一項功能：它守望真實本機收件箱並呼叫 7-Zip/beets，必須執行在能訪問該目錄的電腦或 NAS 上，不能放進 Cloudflare Workers。

## 備份與恢復層次

1. 曲庫：SQLite 感知備份或 D1 邏輯 SQL 匯出。
2. 配置：管理後臺設定 JSON，加密儲存。
3. 執行時金鑰：密碼管理器或部署平臺 secret store。
4. 音訊與原圖：獨立的儲存層備份。
5. KV：重新生成。R2 圖片索引：僅在保留同一桶時遷移；否則透過預熱認領已有公開物件或重新生成。

完整順序見[資料庫備份、遷移與恢復](database-migration.zh-Hant.md)。

## 託管邊界

Cloudflare 免費計劃通常適合個人曲庫或少量聽眾，但額度和條款會變化。API 請求、D1 行、KV 操作、R2 和代理音訊都會消耗平臺資源。OneDrive 臨時 URL 常常繞過 Worker；WebDAV、Google Drive、Node 本地流和主動啟用的代理不會。

Workers 無法訪問家中電腦目錄、常駐等待檔案事件、轉碼、執行 beets 或解壓。此類任務必須留在可選本機伴侶中。

## 診斷

Cloudflare：

```bash
cd cloud/worker
npx wrangler tail
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc \
  --command "SELECT COUNT(*) AS albums FROM albums"
```

Wrangler 本地把命令改為 `--local`。Node 使用者檢查 `DATA_DIR`、啟動日誌和管理後臺系統狀態。日誌中不得輸出 refresh token、簽名音訊 URL、設定備份正文或請求授權頭。
