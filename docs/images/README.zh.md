# 文档演示图

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

这些图片来自 Mihonban 的实际界面，使用虚构的音盘、艺人、评分与介绍。Web 和 Android 使用原创几何封面，iOS 使用应用内置的唱片占位图，不包含私人曲库或商业唱片封面。Web、原生 Android 与原生 iOS 分别标注，均非设计效果图。

## 图片清单

| 图片 | 界面 | 截图日期 | 来源版本 |
|---|---|---|---|
| [web-library.webp](web-library.webp) | Web 音盘库，英语 | 2026-11-08 | Web 源码 `351ba8e` |
| [web-library-zh.webp](web-library-zh.webp) | Web 音盘库，简体中文 | 2026-11-08 | Web 源码 `351ba8e` |
| [web-album.webp](web-album.webp) | Web 音盘详情，英语 | 2026-11-08 | Web 源码 `351ba8e` |
| [android-library.webp](android-library.webp) | 原生 Android 音盘库 | 2026-11-05 | Android 0.1.10 |
| [android-player.webp](android-player.webp) | 原生 Android 播放器 | 2026-11-05 | Android 0.1.8 |
| [ios-library.webp](ios-library.webp) | 原生 iPhone 音盘库 | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-album.webp](ios-album.webp) | 原生 iPhone 音盘详情 | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-player.webp](ios-player.webp) | 原生 iPhone 播放器 | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-ipad-album.webp](ios-ipad-album.webp) | 原生 iPad 音盘详情，横屏 | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |

Web 图片保留截图时的 1280 × 720 尺寸。Android 和 iPhone 截图等比例缩小至不超过 800 × 1440；iPad 截图应用原图记录的 EXIF 方向后缩小至 1600 × 1200。所有图片使用 WebP 压缩（质量 88），未裁剪或重新排列界面元素。原始分辨率截图及其他测试产物保留在版本控制之外。

## 重现 Web 演示

使用 Node.js 20 或更高版本，从仓库根目录运行：

```bash
npm --prefix cloud/web ci
npm --prefix cloud/web run build
node tools/docs-demo.mjs --check
node tools/docs-demo.mjs
```

打开 <http://127.0.0.1:8767> 查看曲库，或打开 <http://127.0.0.1:8767/#/album/midnight-sessions> 查看示例音盘。在语言菜单选择 English 或简体中文。文档截图使用深色主题和默认评分排序。使用 `Ctrl+C` 停止服务器。如果默认端口被占用，设置 `MIHONBAN_DEMO_PORT`。

[`tools/docs-demo.mjs`](../../tools/docs-demo.mjs)提供当前构建的 React 应用，包含 18 张虚构音盘、144 首歌曲和六位艺人。它仅监听回环地址，只接受读取请求，不访问数据库、凭据、存储服务或生产服务。播放使用生成的静音 WAV 音频，支持 Range 请求。演示从本地提供仓库中的 Inter 和 Shippori Mincho 字体，不向 Google Fonts 请求字体；应用组件和布局样式保持不变。

更新图片时，从当前构建截取相应页面，检查截图，转换为 WebP，并更新上表中的日期和源码版本。重复使用截图时，应明确说明音盘名称和评分为虚构数据。

## Android 来源

Android 示例来自 [`NativeUiTest.kt`](../../android/app/src/androidTest/java/org/mihonban/android/NativeUiTest.kt)中的原生 UI 测试数据。测试提供虚构曲库，并使用 Android Canvas 绘制封面。选定的本地原图为 `android/build/screenshots/0110-08-library-overview.png` 和 `android/build/screenshots/018-player-tall.png`。它们代表上表列出的版本，不表示所有客户端或当前界面都在同一时间重新截图。

构建和插桩测试步骤见 [Android 开发指南](../../android/README.zh.md)。仅提交本目录中选定的压缩文档图片；完整测试产物仍位于已忽略的 Android 构建目录。

## iOS 来源

原生 iOS 图片来自成功的 [iOS 预览构建第 72 次运行](https://github.com/hanfdev/mihonban/actions/runs/42380336181)，源码提交为 [`5e667fb`](https://github.com/hanfdev/mihonban/commit/5e667fbacfb99ab3020ae8869f4534ed7f917dc4)。Xcode UI 测试于 2026-11-07 在 **iPhone 17** 和 **iPad Pro 13-inch (M5)** 模拟器上截图，使用英语界面和深色外观。这些是模拟器截图，不是真机照片。选定图片包含 [`DemoLibrary.swift`](../../ios/Sources/DemoLibrary.swift)中的虚构曲库和 [`Theme.swift`](../../ios/Sources/UI/Theme.swift)中的内置唱片占位图。

| 文档图片 | 附件名称 | `MihonbanUITests` 中的测试 |
|---|---|---|
| `ios-library.webp` | `01-library` | `testBrowsePlayPauseAndQueue` |
| `ios-album.webp` | `02-album` | `testBrowsePlayPauseAndQueue` |
| `ios-player.webp` | `03-now-playing` | `testBrowsePlayPauseAndQueue` |
| `ios-ipad-album.webp` | `48-album-balanced-landscape` | `testTabletAlbumHeaderBalancesArtworkAndInformation` |

下载的 `iOS-screenshots-72` 压缩包已与 GitHub 运行页面公布的 SHA-256 摘要核对：`34f1bb830c6453fe2074c77744ff23a34461b0fb32fb57688636e2542fae8457`。附件清单记录了各项测试、设备、时间戳和原始文件名；iPad 附件位于 `ipad/`。选定附件均未关联测试失败。

更新图片时，在 macOS 上按 [iOS 开发指南](../../ios/README.zh.md)准备环境，运行 [`MihonbanUITests.swift`](../../ios/UITests/MihonbanUITests.swift)中的对应测试，并使用 `xcrun xcresulttool export attachments` 导出测试结果包的附件。[iOS 工作流](../../.github/workflows/mobile.yml)已执行此导出并发布 `iOS-screenshots-<run_number>` 产物。选择上表中的附件，应用图片记录的方向，等比例缩放，并更新截图／版本表。CI 产物在保留期结束后过期；选定的 WebP 图片会保留在仓库中。

[返回项目文档](../../README.zh.md)
