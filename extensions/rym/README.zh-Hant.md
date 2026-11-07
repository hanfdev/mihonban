# Mihonban RYM 瀏覽器工具

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

這是可選的 Chrome/Edge Manifest V3 擴充套件，用於將 RYM 發行頁後設資料傳送到現有 Mihonban 曲庫。1.1.0 還提供使用者手動啟動的佇列，為已關聯來源連結的專輯重新整理評分和評分人數。

## 構建與安裝

在倉庫根目錄安裝 Web 依賴並構建：

```sh
npm --prefix cloud/web ci
npm --prefix cloud/web run build
```

構建將擴充套件與共享解析器複製到 `cloud/web/dist/rym-browser-tool/`，並生成 `cloud/web/dist/rym-browser-tool.zip`。在 Chrome/Edge 擴充套件頁面使用“載入已解壓的擴充套件程式”（Load unpacked），選擇包含 `manifest.json` 的生成目錄。原始碼目錄本身不完整：構建會補入 `rym-capture.js` 與 `batch-reader.js`。替換已安裝的副本後，在擴充套件頁面點選重新載入（Reload）。

部署後的伺服器在“管理 → RYM 更新 → 批次更新評分”提供同一 ZIP。安裝、來源匹配和分類審閱見[使用手冊](../../docs/manual.zh-Hant.md#rym-後設資料)。

## 操作模式

- **傳送當前頁面：** 重新整理 RYM 發行頁，開啟擴充套件，設定 Mihonban 地址併傳送。在 Mihonban 中確認匹配專輯。分類以建議形式匯入，必須明確採納才會生效。
- **批次更新評分：** 以管理員身份開啟 Mihonban，從該標籤頁啟動擴充套件，選擇已關聯專輯並啟動佇列。只更新評分與評分人數；同一來源的不同版本共用一次採集，人工維護的分類和榜單排名保持不變。

保持曲庫和佇列標籤頁開啟。頁面跳轉間隔至少 30 秒；驗證或限流會暫停佇列，需在來源頁完成驗證後明確恢復。限流後至少冷卻五分鐘。工具支援暫停／恢復和重試，不執行定時後臺服務，也不繞過網站驗證。

批次模式啟動時，擴充套件請求可選的 RYM 訪問許可權。它透過已開啟的曲庫標籤頁使用當前管理員會話，不儲存口令、Cookie 或完整 HTML。曲庫地址、佇列進度和採集評分儲存在裝置上；選擇新批次會替換上一任務。

## 檢查

```sh
node --test cloud/web/test/rym-capture.test.js cloud/web/test/rym-batch.test.js
```

`cloud/worker/test/rym-updates.test.js` 中的 Worker 測試覆蓋來源匹配、併發編輯、採集時效、人工分類與僅評分更新端點。
