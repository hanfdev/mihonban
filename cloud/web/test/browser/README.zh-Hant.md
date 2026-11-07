# 瀏覽器清單迴歸測試

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

此測試頁面掛載實際的 React 清單檢視，將目前原始碼與清單記憶化改動前的 Git 版本 `95eed448dd80ca49de0de2703d1db1f7e78e8e94` 比較，檢查排序／篩選結果、播放回呼、精選重新排序、查詢工作量及歌曲列繪製次數。自該版本以來，「最近加入」的排序規則已按預期調整，因此另有針對目前檢視的案例，涵蓋 Library、Artists 和 Import 中的首次加入時間、評分／標題編輯、重新整理順序、新匯入、相同時間戳記、未知日期與隱藏音盤。

從儲存庫根目錄安裝 Web 相依套件並建置測試頁面：

```sh
npm --prefix cloud/web ci
node cloud/web/tools/build-performance-browser.mjs
python -m http.server 8766 --bind 127.0.0.1 --directory backups/web-perf-browser
```

在具有可見檢視區域的桌面瀏覽器中開啟 `http://127.0.0.1:8766`，點選 **Run all tests**。頁面會顯示各案例及最終通過／失敗數量。瀏覽器自動化可呼叫 `await window.runPerformanceTests()` 並讀取 `window.performanceTestResults`。指標重新排序測試依賴檢視區域的命中偵測，不支援零尺寸檢視區域。

建置直接從 Git 讀取基準檔案，無需私有的 `backups/web-perf-baseline` 目錄。使用包含固定版本之 Git 歷史記錄的複本；完整複製包含該版本，僅下載原始碼 ZIP 則不包含。淺層複製應在建置前取得固定版本，或用 `git fetch --unshallow` 取得完整歷史：

```sh
git fetch origin 95eed448dd80ca49de0de2703d1db1f7e78e8e94
```

產生的檔案保存在被忽略的 `backups/web-perf-browser` 目錄，其 `manifest.json` 記錄基準版本和原始碼雜湊值。API 回應和封面使用本機測試資料，頁面禁止外部連線，也不會寫入真實曲庫。這些瀏覽器檢查獨立於 `npm test`；測試頁面建置成功不代表瀏覽器案例已通過。
