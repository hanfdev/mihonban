# Mihonban 原生 iPhone / iPad 客户端

[English](README.md) · [简体中文](README.zh.md)

使用 SwiftUI 和 SFBAudioEngine，连接现有 Mihonban 服务器。当前预览版本为 0.2.0，需要 iOS / iPadOS 17 或更高版本。听歌界面为原生实现；客户端不负责托管服务器。

## 连接与使用

填写服务器根地址，例如 `https://music.example.com`，以及听众或管理员口令。仅在服务器开启访客访问时可留空。“将口令保存在钥匙串”是可选项，用于重新连接。手机访问本地服务器时应填写电脑的局域网 IP；手机的 `localhost` 指向手机自身。本地 HTTP 会话需要服务器设置 `DEV_INSECURE_COOKIE=1`；远程访问应使用 HTTPS。

- 浏览音盘、歌曲、艺人和共享精选，支持全库搜索、风格筛选、排序、多艺人署名和相关作品。
- 原生 Markdown 简介阅读、内页翻阅与缩放，通过系统分享面板分享音盘和歌曲链接。
- 迷你播放器、完整播放器、队列编辑、进度拖动、随机与循环，以及后台播放、锁屏控制和系统音频输出选择。
- 整张音盘下载、进度查看、失败重试和离线播放。主动下载与自动缓存分开保存；后台下载可在应用挂起时继续，强制退出应用会中断下载。
- 服务器不可达时可重新打开之前已授权会话的曲库及已下载音乐；服务器明确拒绝会话时仍需重新登录。
- 跟随系统、浅色或深色外观；自动缓存可关闭，容量可在 256 MB～4 GB 间调整，默认 1 GB。清理缓存保留主动下载的文件。
- 下一首预加载提供关闭、自动（Wi-Fi）和始终开启。默认自动模式避开移动网络、计费连接和低数据模式，只预先准备队列中的下一首；关闭持久缓存后仍可使用。
- 管理员可修改共享精选、编辑音盘资料及封面、显示／隐藏音盘，并确认是否连同文件一起删除。完整服务器设置、批量导入／迁移和浏览器辅助 RYM 更新仍使用 Web 端。

支持英语、日语、韩语、法语、西班牙语、简体中文及繁体中文。代码包含横竖屏、动态字体和 iPad 布局的回归测试。音频格式支持取决于 SFBAudioEngine 及其编解码库；测试使用合成 MP3、FLAC 和 Vorbis 音频验证解码和拖动。

## 构建和安装

需要 macOS、支持源代码所用 Swift 6.2 特性的 Xcode、XcodeGen、Python 3 和 FFmpeg。[iOS 工作流](../.github/workflows/mobile.yml)记录准确的 CI 环境，目前为 `macos-26` 与 Xcode 26.6。完整的环境准备、合成测试音频、生成 Xcode 工程和解析依赖命令见 [英文构建说明](README.md#build)，均从仓库根目录运行。

使用 `xcodegen generate --spec ios/project.yml` 生成的 Xcode 工程，选择 iPhone 或 iPad 模拟器后运行 Mihonban scheme。真机需要自行配置开发团队和签名。SFBAudioEngine 在 `project.yml` 中固定到具体修订；CI 在构建产物中附带实际解析的依赖锁文件。

可在成功的 [iOS 工作流](https://github.com/hanfdev/mihonban/actions/workflows/mobile.yml)中下载预览构建。CI 生成的是**未签名 IPA**，需要适用的签名或侧载流程才能安装，不能直接当作 App Store 安装包。产物还包含校验值、第三方声明及可重新链接的构建对象；这些文件按工作流保留期限过期，不会自动发布到 App Store。

生成的工程、依赖缓存、合成音频及编译产物不纳入 Git。图标、字体、语言目录和搜索映射作为源资源随仓库提供，普通构建无需重新生成。

## 验证与维护

构建前可在 Windows、macOS 或 Linux 运行以下检查：

```sh
python3 -I ios/tools/check-l10n.py
python3 -I ios/tools/check-fonts.py
```

在 macOS 中运行 Xcode 测试前，先按英文说明生成测试音频，并在另一终端启动本地测试服务器：

```sh
python3 -I ios/tools/fixture-server.py ios/TestFixtures
```

测试服务器监听回环地址的 8766 端口，提供合成音频和 API 测试数据，无需生产账号或真实音乐。CI 运行 iPhone 测试和独立的 iPad 子集，保存报告及截图。上述 Python 检查通过只表示语言键和字体覆盖检查通过，不能代替 Swift 编译、模拟器或真机验证。

修改共享 Web 翻译或艺人别名后，运行 `node ios/tools/export-locales.mjs`、`node ios/tools/export-search.mjs`，审阅生成文件的差异，再运行语言和字体检查。仅在需要更新图标或字体覆盖时运行 `prepare-assets.py`；所需依赖见英文说明。

项目采用 AGPL-3.0-only。附带字体保留 SIL Open Font License；SFBAudioEngine 及编解码依赖保留各自许可证。分发构建时应保留生成的第三方声明和依赖版本信息。
