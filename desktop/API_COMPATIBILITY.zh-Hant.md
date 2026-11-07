# 原生用戶端相容性約定

[English](API_COMPATIBILITY.md) · [简体中文](API_COMPATIBILITY.zh.md) · [繁體中文](API_COMPATIBILITY.zh-Hant.md) · [日本語](API_COMPATIBILITY.ja.md) · [한국어](API_COMPATIBILITY.ko.md) · [Français](API_COMPATIBILITY.fr.md) · [Español](API_COMPATIBILITY.es.md)

原生用戶端與 `cloud/web` 獨立。只要下列 API 行為保持相容，Mihonban 伺服器可修改 Web 介面並獨立部署。

## 工作階段與曲庫

用戶端在請求之間保留工作階段 Cookie。設定好的訪客工作階段可免密碼瀏覽；受保護的部署需要登入。隱藏音盤與共用精選的變更仍受伺服器權限限制。

- `GET /api/health` 傳回任意成功回應。
- `GET /api/me` 傳回目前工作階段物件。`401` 表示用戶端應顯示密碼登入流程。
- `POST /api/login` 接受 `{ "password": "..." }`，傳回 `{ "ok": true, "role": "user|admin" }`。
- `GET /api/library` 傳回可見音盤陣列。
- `GET /api/tracks` 傳回可見曲目陣列。
- `GET /api/album/:id` 傳回包含 `tracks` 陣列的音盤物件。
- `GET /api/artists` 傳回藝人資料。
- `GET /api/favorites` 傳回包含 `albums` 和 `tracks` 陣列的物件，各項均有 `id`。
- `PUT /api/favorites/:kind/:id` 新增共用精選，同一路徑的 `DELETE` 刪除精選；`kind` 為 `album` 或 `track`。寫入需要管理員權限。

獲授權的管理員可對音盤和曲目清單使用 `?hidden=1`。音盤詳情還可包含 `note`、`images` 和 `similar`。請求路徑中的藝人名稱和項目 ID 使用 URL 編碼。

## 圖片與音訊

- `GET /api/art/:albumId?s=480` 傳回圖片內容。
- `GET /api/image/:id?s=:size` 傳回音盤內頁圖片。
- `GET /api/artist-bio/:name` 傳回包含 `bio` 字串的物件。
- `GET /api/artist-art/:name` 傳回藝人圖片；自訂頭像時用戶端加上 `?v=c`。
- `GET /api/stream/:trackId` 傳回原始音訊位元組或可成功存取該音訊的重新導向。

桌面用戶端下載完整音訊檔案，在本機解碼及定位播放，不依賴 Web 播放器的串流版面。圖片下載每次回應限制為 32 MiB。精確請求路徑及反序列化預設值見 [`src/api.rs`](src/api.rs)。

## 相容性與用戶端更新

用戶端忽略未知 JSON 欄位，並為資料模型中宣告為選用的欄位提供預設值。音盤 ID、藝人名稱和標題等必填欄位必須保持相容的資料型別；允許新增未知欄位並不代表既有必填欄位可以省略。用戶端不存取 Mihonban 資料庫、儲存認證或部署檔案，因此伺服器遷移、儲存後端及用戶端發佈可在此 API 約定內獨立演進。

用戶端發佈可使用獨立託管的 JSON 資訊清單，包含 `latest`、`download_url`、`sha256` 和 `notes`。發佈時應提供 SHA-256 校驗值：目前用戶端僅在該欄位非空時校驗。下載後準備檔案供手動替換 exe，不會自動安裝或更新伺服器。設定、建置和播放詳情見[桌面端指南](README.zh-Hant.md)。
