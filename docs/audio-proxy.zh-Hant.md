# 可選 Cloudflare 音源代理

[English](audio-proxy.md) · [简体中文](audio-proxy.zh.md) · [繁體中文](audio-proxy.zh-Hant.md) · [日本語](audio-proxy.ja.md) · [한국어](audio-proxy.ko.md) · [Français](audio-proxy.fr.md) · [Español](audio-proxy.es.md)

`cloud/proxy-worker` 是獨立 Worker，用於中轉主 mihonban Worker 取得的臨時音訊 URL。只有第二條 Worker 路由或自定義域確實改善到儲存 CDN 的路徑時，它才有價值。

它不快取音訊，也不保證一定更快。部署前後應實際測速。

## 安全模型

- 主 Worker 用 `STREAM_PROXY_SECRET` 對源 URL 和五分鐘有效期簽名。
- 代理用相同值 `PROXY_SECRET` 校驗。
- 只接受 GET、HEAD、OPTIONS。
- 只允許 `ALLOWED_HOSTS` 中的 HTTPS 上游。
- 每一次上游重定向都重新檢查白名單。
- 透傳 Range 和條件請求頭，不轉發 cookie/authorization。
- 響應為 private/no-store。

生產環境不要開啟無簽名模式，也不要配置無限制域名萬用字元。

## 1. 配置並部署代理

編輯 `cloud/proxy-worker/wrangler.jsonc`：

- `ALLOWED_HOSTS`：逗號分隔的精確域名，或以點開頭的子域字尾。
- `ALLOWED_ORIGINS`：主 mihonban 站點 origin；可用 `*`，但指定域名更好。

預設 OneDrive 字尾只是起點。微軟可能跳到租戶或地區下載域名；遇到失敗時只新增實際核對過的字尾。

```bash
cd cloud/proxy-worker
npm ci
npm test
npx wrangler login
npx wrangler secret put PROXY_SECRET
npx wrangler deploy
```

至少使用 32 個隨機字元，推薦把 32 個隨機位元組編碼為十六進位制字串。臨時保留它，以便給主 Worker 輸入完全相同的值。

## 2. 配置主 Worker

```bash
cd ../worker
npx wrangler secret put STREAM_PROXY_SECRET
npx wrangler deploy
```

輸入與 `PROXY_SECRET` 完全相同的值。

進入見本盤管理後臺的模組設定：

1. 開啟音源代理。
2. 自定義代理地址填寫：

```text
https://mihonban-audio-proxy.<賬號>.workers.dev/?url={url}
```

3. 儲存，播放一首 OneDrive 後端歌曲。

主 Worker 會自動追加 `expires` 和 `sig`。不要把共享金鑰寫在 URL 中。

## 3. 驗證

```bash
curl https://mihonban-audio-proxy.<賬號>.workers.dev/healthz
```

播放時在瀏覽器網路面板確認：

- 主 `/api/stream/<id>` 302 到代理。
- 代理返回 200 或 206。
- 拖進度會傳送 `Range`，響應包含 `Content-Range`。
- 不帶簽名的 `?url=...` 返回 401。
- 非白名單域名返回 403。

## 適用範圍

外部代理只用於主 Worker 能取得臨時下載直鏈的後端，目前主要是 OneDrive。WebDAV、Google Drive 和 Node 本地目錄需要私有憑據，仍由主 Worker 讀取。

## 排障

| 狀態 | 含義/處理 |
|---|---|
| 401 | 兩邊金鑰不同、簽名過期，或主 Worker 未重新部署 |
| 403 | 初始源域名不在白名單 |
| 502 且提示 host | 重定向到了另一域名，核對後再新增字尾 |
| 416 | 上游拒絕 Range |
| 反而更慢 | 清空自定義代理 URL，恢復直鏈/主 Worker 路徑 |

簽名值洩露時同時輪換兩邊 secret。既有簽名 URL 最長五分鐘失效。
