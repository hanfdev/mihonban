# Mihonban 原生 iPhone 與 iPad 用戶端

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

連接現有 Mihonban 伺服器的原生 SwiftUI 用戶端，使用 SFBAudioEngine 播放音訊。目前預覽版本為 0.2.0，需要 iOS / iPadOS 17 或更新版本。用戶端不託管伺服器，聆聽介面不使用 WebView。

## 介面預覽

以下為原生 iOS 應用程式在 iPhone 與 iPad 模擬器中的實際截圖，使用虛構示範資料與內建封面預留圖。 [截圖說明](../docs/images/README.zh-Hant.md)。

| iPhone 曲庫 | iPhone 音盤詳情 | iPhone 播放器 |
|:---:|:---:|:---:|
| <img src="../docs/images/ios-library.webp" height="420" alt="iPhone 曲庫"> | <img src="../docs/images/ios-album.webp" height="420" alt="iPhone 音盤詳情"> | <img src="../docs/images/ios-player.webp" height="420" alt="iPhone 播放器"> |

**iPad 橫向音盤詳情**

![iPad 橫向音盤詳情](../docs/images/ios-ipad-album.webp)

## 連線與使用

填寫伺服器根網址，例如 `https://music.example.com`，以及聽眾或管理員密碼。只有伺服器開啟訪客存取時才可留白。選用的「儲存密碼」開關會將密碼存入鑰匙圈，供重新連線使用。本機伺服器應填寫電腦的區域網路位址；手機的 `localhost` 指向手機本身。本機 HTTP 工作階段需要伺服器設定 `DEV_INSECURE_COOKIE=1`；遠端存取應使用 HTTPS。

- 瀏覽音盤、歌曲、藝人與共享精選，支援搜尋、曲風篩選、排序、多藝人署名與相關作品。
- 使用原生 Markdown 閱讀器閱讀音盤與藝人介紹；瀏覽、縮放音盤圖片；透過系統分享面板分享音盤與歌曲連結。
- 使用迷你播放器、完整播放器、可編輯佇列、進度拖曳、隨機與循環。背景音訊、鎖定畫面控制與系統音訊輸出選擇均使用 iOS 原生功能。
- 儲存音盤供離線播放。下載顯示進度，失敗可重試，已完成下載與自動快取分開儲存。應用程式暫停後背景傳輸可繼續；強制結束會中斷傳輸。
- 伺服器無法連線時，可重新開啟先前已授權的曲庫及已下載音樂。伺服器明確拒絕工作階段時需要重新登入。
- 選擇跟隨系統、淺色或深色外觀；自動快取可在 256 MB～4 GB 間調整，預設 1 GB，也可關閉。清除此快取會保留主動下載的檔案。
- 下一首預載提供關閉、自動（Wi-Fi）或一律開啟。預設自動模式避開行動網路、計量付費連線與低數據模式，只預先準備佇列中的下一首；關閉持久快取後仍可使用。
- 管理員可修改共享精選、編輯音盤資料與封面、顯示／隱藏音盤，並確認是否連同儲存檔案一起刪除。完整伺服器設定、批次匯入／遷移與瀏覽器輔助 RYM 更新使用 Web 應用程式。

介面支援英語、日語、韓語、法語、西班牙語、簡體中文與繁體中文。直向、橫向、動態字體與 iPad 版面有各自的回歸測試。格式支援取決於 SFBAudioEngine 及其附帶編解碼程式庫；測試套件使用合成 MP3、FLAC 與 Vorbis 音訊驗證解碼與拖曳。

## 建置

需要 macOS、支援原始碼所用 Swift 6.2 語言特性的 Xcode、XcodeGen、Python 3 與 FFmpeg。[iOS 工作流程](../.github/workflows/mobile.yml)記錄 CI 使用的確切執行環境與 Xcode 版本，目前為 `macos-26` 與 Xcode 26.6。以下準備與建置命令均從儲存庫根目錄執行：

```sh
brew install xcodegen ffmpeg
python3 -I ios/tools/check-l10n.py
python3 -I ios/tools/check-fonts.py
mkdir -p ios/TestFixtures ios/Resources/ThirdParty
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=8:sample_rate=44100' -ac 2 -c:a libmp3lame -q:a 3 ios/TestFixtures/tone.mp3
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=8:sample_rate=44100' -ac 2 -c:a flac ios/TestFixtures/tone.flac
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=8:sample_rate=44100' -ac 2 -c:a vorbis -strict experimental -q:a 4 ios/TestFixtures/tone.ogg
xcodegen generate --spec ios/project.yml
xcodebuild -resolvePackageDependencies -project ios/Mihonban.xcodeproj -scheme Mihonban -clonedSourcePackagesDirPath .spm
python3 -I ios/tools/acknowledgements.py .spm/checkouts ios/Resources/ThirdParty/Acknowledgements.txt
xcodegen generate --spec ios/project.yml
open ios/Mihonban.xcodeproj
```

SFBAudioEngine 在 `project.yml` 中固定至特定修訂。如果提供了經過審閱的 `ios/Package.resolved`，請如同 CI，在解析相依套件前將它複製到 `ios/Mihonban.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/`。CI 在產物中附帶解析後的相依套件鎖定檔。產生的 Xcode 專案、相依套件檢出目錄、合成音訊與建置產物不納入 Git；隨儲存庫提供的圖示、字型、本地化目錄與搜尋對照表屬於原始資源。

選擇 iPhone 或 iPad 模擬器並執行 Mihonban scheme。實體裝置需自行設定開發團隊與簽章。CI 產生的是**未簽章 IPA**；下載後仍需適用的簽章或側載流程才能安裝。工作流程也會封裝校驗值、第三方聲明與可重新連結的建置物件。產物可從成功的 [iOS 工作流程執行](https://github.com/hanfdev/mihonban/actions/workflows/mobile.yml)取得，並依保留設定到期；不會自動發佈至 App Store。

## 測試

執行 Xcode 測試 scheme 前，在另一個終端機啟動測試伺服器：

```sh
python3 -I ios/tools/fixture-server.py ios/TestFixtures
```

伺服器監聽回環位址的 8766 連接埠，提供合成媒體與 API 測試資料。測試涵蓋 API 契約、離線啟動、曲庫更新、精選、佇列切換、快取／下載處理、解碼／拖曳、字體排版、版面配置與原生導覽。CI 執行 iPhone 測試套件與獨立的 iPad 子集，並上傳報告與截圖。精選文件截圖提交在 `docs/images/`；完整截圖集與測試報告仍為版本控制之外的產生物。無需正式環境帳號或真實音樂。iOS 建置及模擬器執行需要 macOS；僅通過跨平台 Python 檢查不能證明 Swift 編譯或裝置行為正確。

## 維護產生的資源

修改共用 Web 翻譯或搜尋別名後，重新產生已提交的目錄並審閱差異：

```sh
node ios/tools/export-locales.mjs
node ios/tools/export-search.mjs
python3 -I ios/tools/check-l10n.py
python3 -I ios/tools/check-fonts.py
```

僅在修改圖片或字型涵蓋範圍時，在開發用 Python 環境中安裝 Pillow、fontTools 與 Brotli，然後執行 `python3 ios/tools/prepare-assets.py .`。該命令根據固定來源與共用 Web 資源重新產生圖示／標誌及後備字型；一般建置不需要執行。

專案採用 AGPL-3.0-only。附帶字型保留各自的 SIL Open Font License。SFBAudioEngine 與編解碼相依套件保留各自授權；散布建置版本時應保留產生的第三方聲明與相依套件資訊。

[返回專案文件](../README.zh-Hant.md)
