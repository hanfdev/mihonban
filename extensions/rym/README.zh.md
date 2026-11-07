# Mihonban RYM 浏览器工具

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

这是可选的 Chrome/Edge Manifest V3 扩展，用于将 RYM 发行页元数据发送到现有 Mihonban 曲库。1.1.0 还提供用户手动启动的队列，为已关联来源链接的专辑刷新评分和评分人数。

## 构建与安装

在仓库根目录安装 Web 依赖并构建：

```sh
npm --prefix cloud/web ci
npm --prefix cloud/web run build
```

构建将扩展与共享解析器复制到 `cloud/web/dist/rym-browser-tool/`，并生成 `cloud/web/dist/rym-browser-tool.zip`。在 Chrome/Edge 扩展页面使用“加载已解压的扩展程序”（Load unpacked），选择包含 `manifest.json` 的生成目录。源码目录本身不完整：构建会补入 `rym-capture.js` 与 `batch-reader.js`。替换已安装的副本后，在扩展页面点击重新加载（Reload）。

部署后的服务器在“管理 → RYM 更新 → 批量更新评分”提供同一 ZIP。安装、来源匹配和分类审阅见[使用手册](../../docs/manual.zh.md#rym-元数据)。

## 操作模式

- **发送当前页面：** 刷新 RYM 发行页，打开扩展，设置 Mihonban 地址并发送。在 Mihonban 中确认匹配专辑。分类以建议形式导入，必须明确采纳才会生效。
- **批量更新评分：** 以管理员身份打开 Mihonban，从该标签页启动扩展，选择已关联专辑并启动队列。只更新评分与评分人数；同一来源的不同版本共用一次采集，人工维护的分类和榜单排名保持不变。

保持曲库和队列标签页打开。页面跳转间隔至少 30 秒；验证或限流会暂停队列，需在来源页完成验证后明确恢复。限流后至少冷却五分钟。工具支持暂停／恢复和重试，不运行定时后台服务，也不绕过网站验证。

批量模式启动时，扩展请求可选的 RYM 访问权限。它通过已打开的曲库标签页使用当前管理员会话，不保存口令、Cookie 或完整 HTML。曲库地址、队列进度和采集评分保存在设备上；选择新批次会替换上一任务。

## 检查

```sh
node --test cloud/web/test/rym-capture.test.js cloud/web/test/rym-batch.test.js
```

`cloud/worker/test/rym-updates.test.js` 中的 Worker 测试覆盖来源匹配、并发编辑、采集时效、人工分类与仅评分更新端点。
