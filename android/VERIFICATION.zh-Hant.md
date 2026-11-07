# Android 驗證記錄

[English](VERIFICATION.md) · [简体中文](VERIFICATION.zh.md) · [繁體中文](VERIFICATION.zh-Hant.md) · [日本語](VERIFICATION.ja.md) · [한국어](VERIFICATION.ko.md) · [Français](VERIFICATION.fr.md) · [Español](VERIFICATION.es.md)

當前原始碼版本：0.1.10 / 版本程式碼 11。工具鏈為 JDK 17、Gradle 8.9、Android Gradle Plugin 8.7.3、Kotlin 2.0.21、SDK 35 和 Build Tools 35.0.0。

## 復現步驟

在倉庫根目錄執行，透過 `ANDROID_HOME` 或忽略的 `android/local.properties` 指定已安裝的 SDK：

```powershell
android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug assembleRelease
android\gradlew.bat -p android connectedDebugAndroidTest
```

macOS/Linux 使用 `sh android/gradlew -p android` 加相同任務。包裝指令碼固定 Gradle 8.9 並驗證校驗和。第二條命令需要模擬器或裝置。測試使用內嵌 HTTP 測試服務和合成音訊，無需生產伺服器、憑據或個人音樂。

標準輸出位於 `android/app/build/`：

- `reports/tests/testDebugUnitTest/` 與 `test-results/testDebugUnitTest/`：JVM 報告。
- `reports/lint-results-debug.html` 與 `.xml`：lint 診斷。
- `reports/androidTests/` 與 `outputs/androidTest-results/`：裝置報告。
- `outputs/apk/debug/app-debug.apk`：開發 APK。
- `outputs/apk/release/app-release-unsigned.apk`：壓縮後的 APK，需要釋出簽名。

[Android 工作流](../.github/workflows/android.yml)構建 Debug 和 Release，執行 JVM 測試和 lint，並使用獨立的 API 35 模擬器任務。APK、報告和截圖作為 CI 產物上傳。精選文件截圖儲存在 `docs/images/`；完整生成產物和本地測試證據不納入版本控制。

## 已記錄結果

2026-11-07 的原始碼釋出檢查使用 Gradle 8.9 和 JDK 17，成功完成 `testDebugUnitTest lintDebug assembleDebug assembleRelease`。它複用了現有增量輸出：執行 2 個任務，97 個已是最新。本地網路檢查中包裝指令碼未能完成發行包下載，因此此次使用已安裝的 Gradle 8.9。本地初始化指令碼選擇了既有構建輸出目錄，使用的原始碼與任務均來自本倉庫。

複用報告包含 29 個 JVM 測試，沒有失敗、錯誤或跳過項。lint 為 0 個錯誤、15 個警告和 1 條資訊。開發 APK 與壓縮後的未簽名釋出 APK 均存在。這是增量驗證結果，不是新模擬器執行或獨立的乾淨構建。

2026-11-05 的較早驗證記錄：Android 15 / API 35 x86_64 模擬器、945 × 1680 畫素、420 dpi，22 個裝置測試全部透過，並驗證了開發 APK 簽名。測試覆蓋原生導航、播放與進度拖動、佇列、下載／離線使用、快取隔離、下一首預載入和摺疊頂部欄迴歸。

頂部欄迴歸取樣部分摺疊狀態、多種密度／字型縮放及狀態列邊距，再驗證完整收起、恢復與密度變化，針對 0.1.10 修復的標題／圖示碎片。現有 lint 項涉及依賴更新、同步偏好寫入、匯出的媒體服務、應用級倉庫引用和匯入介面的裝箱整數狀態。

## 覆蓋限制

2026-11-07 文件更新未重新執行模擬器或實體裝置。Android 8 執行時、Android 16、廠商特定系統行為、電池／耳機整合以及生產儲存賬戶整合仍未驗證。Android 15 上立即清空並重新啟動佇列後出現延遲 Stop 的競爭條件，仍是已知限制。

編解碼器、前臺上傳和高階伺服器管理限制見 [Android 指南](README.zh-Hant.md#當前邊界)。CI 與本地構建 APK 的簽名和校驗和可能不同；請驗證準備安裝的具體執行產物。
