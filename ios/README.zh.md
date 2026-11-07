# Mihonban 原生 iPhone 与 iPad 客户端

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

连接现有 Mihonban 服务器的原生 SwiftUI 客户端，使用 SFBAudioEngine 播放音频。当前预览版本为 0.2.0，需要 iOS / iPadOS 17 或更高版本。客户端不托管服务器，听歌界面不使用 WebView。

## 界面预览

以下为原生 iOS 应用在 iPhone 与 iPad 模拟器中的实际截图，使用虚构演示数据和内置封面占位图。 [截图说明](../docs/images/README.zh.md)。

| iPhone 曲库 | iPhone 音盘详情 | iPhone 播放器 |
|:---:|:---:|:---:|
| <img src="../docs/images/ios-library.webp" height="420" alt="iPhone 曲库"> | <img src="../docs/images/ios-album.webp" height="420" alt="iPhone 音盘详情"> | <img src="../docs/images/ios-player.webp" height="420" alt="iPhone 播放器"> |

**iPad 横屏音盘详情**

![iPad 横屏音盘详情](../docs/images/ios-ipad-album.webp)

## 连接与使用

填写服务器根地址，例如 `https://music.example.com`，以及听众或管理员口令。仅在服务器开启访客访问时可留空。可选的“保存密码”开关会把口令存入钥匙串，供重新连接使用。本地服务器应填写电脑的局域网地址；手机的 `localhost` 指向手机自身。本地 HTTP 会话需要服务器设置 `DEV_INSECURE_COOKIE=1`；远程访问应使用 HTTPS。

- 浏览音盘、歌曲、艺人和共享精选，支持搜索、风格筛选、排序、多艺人署名和相关作品。
- 使用原生 Markdown 阅读器阅读音盘和艺人介绍；浏览、缩放音盘图片；通过系统分享面板分享音盘和歌曲链接。
- 使用迷你播放器、完整播放器、可编辑队列、进度拖动、随机和循环。后台音频、锁屏控制和系统音频输出选择均使用 iOS 原生功能。
- 保存音盘供离线播放。下载显示进度，失败可重试，已完成下载与自动缓存分开保存。应用挂起后后台传输可继续；强制退出会中断传输。
- 服务器不可达时，可重新打开之前已授权的曲库及已下载音乐。服务器明确拒绝会话时需要重新登录。
- 选择跟随系统、浅色或深色外观；自动缓存可在 256 MB～4 GB 间调整，默认 1 GB，也可关闭。清理此缓存会保留主动下载的文件。
- 下一首预加载提供关闭、自动（Wi-Fi）或始终开启。默认自动模式避开移动网络、计费连接和低数据模式，只预先准备队列中的下一首；关闭持久缓存后仍可使用。
- 管理员可修改共享精选、编辑音盘资料和封面、显示／隐藏音盘，并确认是否连同存储文件一起删除。完整服务器设置、批量导入／迁移和浏览器辅助 RYM 更新使用 Web 应用。

界面支持英语、日语、韩语、法语、西班牙语、简体中文和繁体中文。竖屏、横屏、动态字体和 iPad 布局有各自的回归测试。格式支持取决于 SFBAudioEngine 及其附带编解码库；测试套件使用合成 MP3、FLAC 和 Vorbis 音频验证解码和拖动。

## 构建

需要 macOS、支持源代码所用 Swift 6.2 语言特性的 Xcode、XcodeGen、Python 3 和 FFmpeg。[iOS 工作流](../.github/workflows/mobile.yml)记录 CI 使用的确切运行器和 Xcode 版本，目前为 `macos-26` 与 Xcode 26.6。以下准备和构建命令均从仓库根目录运行：

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

SFBAudioEngine 在 `project.yml` 中固定到具体修订。如果提供了经过审阅的 `ios/Package.resolved`，请像 CI 一样，在解析依赖前将它复制到 `ios/Mihonban.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/`。CI 在产物中附带解析后的依赖锁文件。生成的 Xcode 工程、依赖检出目录、合成音频和构建产物不纳入 Git；随仓库提供的图标、字体、本地化目录和搜索映射属于源资源。

选择 iPhone 或 iPad 模拟器并运行 Mihonban scheme。真机需自行配置开发团队和签名。CI 生成的是**未签名 IPA**；下载后仍需适用的签名或侧载流程才能安装。工作流还打包校验值、第三方声明和可重新链接的构建对象。产物可从成功的 [iOS 工作流运行](https://github.com/hanfdev/mihonban/actions/workflows/mobile.yml)获取，并按保留设置到期；不会自动发布到 App Store。

## 测试

运行 Xcode 测试 scheme 前，在另一终端启动测试服务器：

```sh
python3 -I ios/tools/fixture-server.py ios/TestFixtures
```

服务器监听回环地址的 8766 端口，提供合成媒体和 API 测试数据。测试涵盖 API 契约、离线启动、曲库刷新、精选、队列切换、缓存／下载处理、解码／拖动、字体排版、布局和原生导航。CI 运行 iPhone 测试套件与独立的 iPad 子集，并上传报告和截图。精选文档截图提交在 `docs/images/`；完整截图集和测试报告仍为版本控制之外的生成产物。无需生产账号或真实音乐。iOS 构建及模拟器运行需要 macOS；仅通过跨平台 Python 检查不能证明 Swift 编译或设备行为正确。

## 维护生成资源

修改共享 Web 翻译或搜索别名后，重新生成已提交的目录并审阅差异：

```sh
node ios/tools/export-locales.mjs
node ios/tools/export-search.mjs
python3 -I ios/tools/check-l10n.py
python3 -I ios/tools/check-fonts.py
```

仅在修改图片或字体覆盖时，在开发用 Python 环境中安装 Pillow、fontTools 和 Brotli，然后运行 `python3 ios/tools/prepare-assets.py .`。该命令根据固定来源和共享 Web 资源重新生成图标／标志及后备字体；普通构建不需要运行。

项目采用 AGPL-3.0-only。附带字体保留各自的 SIL Open Font License。SFBAudioEngine 及编解码依赖保留各自许可证；分发构建时应保留生成的第三方声明和依赖信息。

[返回项目文档](../README.zh.md)
