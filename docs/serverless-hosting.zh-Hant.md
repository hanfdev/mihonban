# Cloudflare Serverless 託管

[English](serverless-hosting.md) · [简体中文](serverless-hosting.zh.md) · [繁體中文](serverless-hosting.zh-Hant.md) · [日本語](serverless-hosting.ja.md) · [한국어](serverless-hosting.ko.md) · [Français](serverless-hosting.fr.md) · [Español](serverless-hosting.es.md)

Serverless 的目標是在家中電腦關機後，網頁仍能登入、瀏覽和播放。受支援的形態是：一個 Worker 同源提供 React 與 API，D1 + KV，可選 R2 圖片映象，音訊儲存在 OneDrive、WebDAV 或 Google Drive。

## 工作負載是否適合

| 工作 | Cloudflare Workers 適合度 |
|---|---|
| React 靜態資源和短 API 請求 | 適合 |
| D1 曲庫/設定與 KV 短期快取 | 適合 |
| RSS/Atom/Blogger 資源站提醒 | 適合，可用 Cron Trigger |
| 從儲存進行 Range 流式播放 | 支援，但受網路和套餐限制 |
| 收件箱守望、解壓、beets、批次改標籤 | 不支援，使用本機伴侶 |
| 轉碼或持續掃描本地資料夾 | 不支援，使用 Node/NAS 工具 |

## 推薦拓撲

```text
瀏覽器
  |
Cloudflare Worker（API + React 靜態資源）
  |-- D1：曲庫和設定
  |-- KV：限流與短期快取
  |-- 可選 R2：圖片映象
  +-- OneDrive / WebDAV / Google Drive：音訊和原圖
```

部署步驟見[安裝與部署](install.zh-Hant.md)。已有本地曲庫先按[資料庫遷移](database-migration.zh-Hant.md)操作；只匯入管理後臺設定不會恢復專輯。

## 家中電腦是否必須常開

網頁登入、瀏覽、播放、網頁匯入和定時資源站掃描都不需要家中電腦常開。只有處理本機收件箱、本地與雲端對賬、離線備份或其他伴侶任務時才開機。

Cloudflare Workers 看不到家中目錄，也不能常駐等待檔案事件。希望收件箱全天自動處理時，可把 Python 伴侶放到常開的 NAS 或低功耗主機。該裝置只負責整理與同步，網頁應用仍獨立執行在 Cloudflare。

## 免費不等於無限

Workers、D1、KV 與 R2 的額度和價格會變化，應以當前 Cloudflare 控制檯和官方文件為準。本專案對免費額度的假設是個人曲庫或少量聽眾，不包括大規模公開分發或持續搬運 TB 級無損音訊。

OneDrive 臨時 URL 常常繞過 Worker。WebDAV、Google Drive 和主動啟用的音源代理會讓位元組經過 Worker，消耗更多平臺資源。

## 外部音源代理

先實測主部署。只有測量證實另一條 Worker 路由或自定義域改善網路路徑時才新增獨立代理。它是帶簽名和白名單的中轉，不是公共 CDN，也不保證更快。詳見[可選 Cloudflare 音源代理](audio-proxy.zh-Hant.md)。

## 上線清單

- Worker URL/自定義域透過 HTTPS 開啟。
- 聽眾、管理員和可選免密訪客許可權正確。
- 桌面、iOS Safari 和 Android Chrome 均能播放和拖動進度。
- 隱藏內容在 API 層面對聽眾不可訪問。
- 每個命名儲存都已測試，並選擇了一個寫入目標。
- 可選 R2 圖片和代理分別透過測試。
- D1 SQL、設定 JSON、執行時金鑰和音訊備份各自都有安排。
- Git、文件、日誌和截圖中沒有任何金鑰。
