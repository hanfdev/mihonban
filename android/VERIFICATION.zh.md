# Android 验证记录

[English](VERIFICATION.md) · [简体中文](VERIFICATION.zh.md) · [繁體中文](VERIFICATION.zh-Hant.md) · [日本語](VERIFICATION.ja.md) · [한국어](VERIFICATION.ko.md) · [Français](VERIFICATION.fr.md) · [Español](VERIFICATION.es.md)

当前源码版本：0.1.10 / 版本代码 11。工具链为 JDK 17、Gradle 8.9、Android Gradle Plugin 8.7.3、Kotlin 2.0.21、SDK 35 和 Build Tools 35.0.0。

## 复现步骤

在仓库根目录运行，通过 `ANDROID_HOME` 或忽略的 `android/local.properties` 指定已安装的 SDK：

```powershell
android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug assembleRelease
android\gradlew.bat -p android connectedDebugAndroidTest
```

macOS/Linux 使用 `sh android/gradlew -p android` 加相同任务。包装脚本固定 Gradle 8.9 并验证校验和。第二条命令需要模拟器或设备。测试使用内嵌 HTTP 测试服务和合成音频，无需生产服务器、凭据或个人音乐。

标准输出位于 `android/app/build/`：

- `reports/tests/testDebugUnitTest/` 与 `test-results/testDebugUnitTest/`：JVM 报告。
- `reports/lint-results-debug.html` 与 `.xml`：lint 诊断。
- `reports/androidTests/` 与 `outputs/androidTest-results/`：设备报告。
- `outputs/apk/debug/app-debug.apk`：开发 APK。
- `outputs/apk/release/app-release-unsigned.apk`：压缩后的 APK，需要发布签名。

[Android 工作流](../.github/workflows/android.yml)构建 Debug 和 Release，运行 JVM 测试和 lint，并使用独立的 API 35 模拟器任务。APK、报告和截图作为 CI 产物上传。精选文档截图保存在 `docs/images/`；完整生成产物和本地测试证据不纳入版本控制。

## 已记录结果

2026-11-07 的源码发布检查使用 Gradle 8.9 和 JDK 17，成功完成 `testDebugUnitTest lintDebug assembleDebug assembleRelease`。它复用了现有增量输出：执行 2 个任务，97 个已是最新。本地网络检查中包装脚本未能完成发行包下载，因此此次使用已安装的 Gradle 8.9。本地初始化脚本选择了既有构建输出目录，使用的源码与任务均来自本仓库。

复用报告包含 29 个 JVM 测试，没有失败、错误或跳过项。lint 为 0 个错误、15 个警告和 1 条信息。开发 APK 与压缩后的未签名发布 APK 均存在。这是增量验证结果，不是新模拟器运行或独立的干净构建。

2026-11-05 的较早验证记录：Android 15 / API 35 x86_64 模拟器、945 × 1680 像素、420 dpi，22 个设备测试全部通过，并验证了开发 APK 签名。测试覆盖原生导航、播放与进度拖动、队列、下载／离线使用、缓存隔离、下一首预加载和折叠顶部栏回归。

顶部栏回归采样部分折叠状态、多种密度／字体缩放及状态栏边距，再验证完整收起、恢复与密度变化，针对 0.1.10 修复的标题／图标碎片。现有 lint 项涉及依赖更新、同步偏好写入、导出的媒体服务、应用级仓库引用和导入界面的装箱整数状态。

## 覆盖限制

2026-11-07 文档更新未重新运行模拟器或实体设备。Android 8 运行时、Android 16、厂商特定系统行为、电池／耳机集成以及生产存储账户集成仍未验证。Android 15 上立即清空并重新启动队列后出现延迟 Stop 的竞争条件，仍是已知限制。

编解码器、前台上传和高级服务器管理限制见 [Android 指南](README.zh.md#当前边界)。CI 与本地构建 APK 的签名和校验和可能不同；请验证准备安装的具体运行产物。
