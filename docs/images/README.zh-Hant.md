# 文件示範截圖

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

這些圖片來自 Mihonban 的實際介面，使用虛構的音盤、藝人、評分與介紹。Web 和 Android 使用原創幾何封面，iOS 使用應用程式內建的唱片預留圖，不包含私人曲庫或商業唱片封面。Web、原生 Android 與原生 iOS 分別標示，均非設計效果圖。

## 圖片清單

| 圖片 | 介面 | 截圖日期 | 來源版本 |
|---|---|---|---|
| [web-library.webp](web-library.webp) | Web 音盤庫，英語 | 2026-11-08 | Web 原始碼 `351ba8e` |
| [web-library-zh.webp](web-library-zh.webp) | Web 音盤庫，簡體中文 | 2026-11-08 | Web 原始碼 `351ba8e` |
| [web-album.webp](web-album.webp) | Web 音盤詳情，英語 | 2026-11-08 | Web 原始碼 `351ba8e` |
| [android-library.webp](android-library.webp) | 原生 Android 音盤庫 | 2026-11-05 | Android 0.1.10 |
| [android-player.webp](android-player.webp) | 原生 Android 播放器 | 2026-11-05 | Android 0.1.8 |
| [ios-library.webp](ios-library.webp) | 原生 iPhone 音盤庫 | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-album.webp](ios-album.webp) | 原生 iPhone 音盤詳情 | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-player.webp](ios-player.webp) | 原生 iPhone 播放器 | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-ipad-album.webp](ios-ipad-album.webp) | 原生 iPad 音盤詳情，橫向 | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |

Web 圖片保留截圖時的 1280 × 720 尺寸。Android 與 iPhone 截圖等比例縮小至不超過 800 × 1440；iPad 截圖套用原圖記錄的 EXIF 方向後縮小至 1600 × 1200。所有圖片使用 WebP 壓縮（品質 88），未裁切或重新排列介面元素。原始解析度截圖與其他測試產物保留在版本控制之外。

## 重現 Web 示範

使用 Node.js 20 或更新版本，從儲存庫根目錄執行：

```bash
npm --prefix cloud/web ci
npm --prefix cloud/web run build
node tools/docs-demo.mjs --check
node tools/docs-demo.mjs
```

開啟 <http://127.0.0.1:8767> 查看曲庫，或開啟 <http://127.0.0.1:8767/#/album/midnight-sessions> 查看示範音盤。在語言選單選擇 English 或简体中文。文件截圖使用深色主題與預設評分排序。使用 `Ctrl+C` 停止伺服器。如果預設連接埠已被占用，請設定 `MIHONBAN_DEMO_PORT`。

[`tools/docs-demo.mjs`](../../tools/docs-demo.mjs)提供目前建置的 React 應用程式，包含 18 張虛構音盤、144 首歌曲與六位藝人。它僅監聽回環位址，只接受讀取請求，不存取資料庫、憑證、儲存服務或正式環境服務。播放使用產生的靜音 WAV 音訊，支援 Range 請求。示範從本機提供儲存庫中的 Inter 與 Shippori Mincho 字型，不向 Google Fonts 請求字型；應用程式元件與版面樣式保持不變。

更新圖片時，從目前建置擷取對應頁面，檢查截圖，轉換為 WebP，並更新上表的日期與原始碼版本。再次使用截圖時，應明確說明音盤名稱與評分為虛構資料。

## Android 來源

Android 範例來自 [`NativeUiTest.kt`](../../android/app/src/androidTest/java/org/mihonban/android/NativeUiTest.kt)中的原生 UI 測試資料。測試提供虛構曲庫，並使用 Android Canvas 繪製封面。選定的本機原圖為 `android/build/screenshots/0110-08-library-overview.png` 與 `android/build/screenshots/018-player-tall.png`。它們代表上表列出的版本，不表示所有用戶端或目前畫面都在同一時間重新截圖。

建置與儀器化測試步驟見 [Android 開發指南](../../android/README.zh-Hant.md)。僅提交本目錄中選定的壓縮文件圖片；完整測試產物仍位於已忽略的 Android 建置目錄。

## iOS 來源

原生 iOS 圖片來自成功的 [iOS 預覽建置第 72 次執行](https://github.com/hanfdev/mihonban/actions/runs/42380336181)，原始碼提交為 [`5e667fb`](https://github.com/hanfdev/mihonban/commit/5e667fbacfb99ab3020ae8869f4534ed7f917dc4)。Xcode UI 測試於 2026-11-07 在 **iPhone 17** 與 **iPad Pro 13-inch (M5)** 模擬器上截圖，使用英語介面與深色外觀。這些是模擬器截圖，不是實體裝置照片。選定圖片包含 [`DemoLibrary.swift`](../../ios/Sources/DemoLibrary.swift)中的虛構曲庫與 [`Theme.swift`](../../ios/Sources/UI/Theme.swift)中的內建唱片預留圖。

| 文件圖片 | 附件名稱 | `MihonbanUITests` 中的測試 |
|---|---|---|
| `ios-library.webp` | `01-library` | `testBrowsePlayPauseAndQueue` |
| `ios-album.webp` | `02-album` | `testBrowsePlayPauseAndQueue` |
| `ios-player.webp` | `03-now-playing` | `testBrowsePlayPauseAndQueue` |
| `ios-ipad-album.webp` | `48-album-balanced-landscape` | `testTabletAlbumHeaderBalancesArtworkAndInformation` |

下載的 `iOS-screenshots-72` 壓縮檔已與 GitHub 執行頁面公布的 SHA-256 摘要核對：`34f1bb830c6453fe2074c77744ff23a34461b0fb32fb57688636e2542fae8457`。附件清單記錄各項測試、裝置、時間戳記與原始檔名；iPad 附件位於 `ipad/`。選定附件均未關聯測試失敗。

更新圖片時，在 macOS 上依 [iOS 開發指南](../../ios/README.zh-Hant.md)準備環境，執行 [`MihonbanUITests.swift`](../../ios/UITests/MihonbanUITests.swift)中的對應測試，並使用 `xcrun xcresulttool export attachments` 匯出測試結果套件的附件。[iOS 工作流程](../../.github/workflows/mobile.yml)已執行此匯出並發佈 `iOS-screenshots-<run_number>` 產物。選擇上表中的附件，套用圖片記錄的方向，等比例縮放，並更新截圖／版本表。CI 產物會在保留期結束後到期；選定的 WebP 圖片會保留在儲存庫中。

[返回專案文件](../../README.zh-Hant.md)
