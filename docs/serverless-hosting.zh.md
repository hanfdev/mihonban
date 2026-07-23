# 纯 Cloudflare 免费托管方案

目标是让家里电脑关机后，网页仍能登录、浏览和播放。推荐形态是 Worker + D1 + KV + 可选 R2，音频保存在你的网盘。

## 哪些适合 Serverless

| 工作 | Cloudflare Worker 是否合适 |
|---|---|
| React 静态页面与短 API | 合适 |
| D1 元数据、KV 短期缓存 | 合适 |
| RSS/Atom/Blogger 资源站提醒 | 合适，可用 Cron Trigger |
| 从存储读取并流式转发音频 | 可用，但受请求/网络/额度影响 |
| 本机收件箱守望、RAR 解压、beets 匹配、批量改 tag | 不合适，留在本机管线 |
| 常驻播放器、转码、本机文件夹持续扫描 | 不合适，需要本机或 NAS |

## 推荐部署

```text
浏览器
  |
Cloudflare Worker（API + React）
  |-- D1：曲库与设置
  |-- KV：限流和短期缓存
  |-- R2：图片镜像
  +-- OneDrive / WebDAV / Google Drive：音频
```

具体创建 D1、KV、secrets 和部署命令见 [install.zh.md](install.zh.md)。已有本地曲库要迁移时，先读 [database-migration.zh.md](database-migration.zh.md)，不要只导入设置 JSON。

## 家里电脑是否必须常开

不需要为了在线浏览和播放而常开。资源站提醒也可以由 Cloudflare Cron 独立运行。本机只在以下情况开机：

- 守望本机收件箱，处理文件夹或单层/嵌套压缩包并修复标签。
- 把本机曲库同步到云端。
- 把网页上传拉回本机。
- 做离线备份。

也可以完全通过网页导入音频，但仍建议保留离线副本。

Cloudflare Workers 无法访问电脑上的目录，也不能常驻等待文件变化。若希望收件箱 24 小时自动处理，可以把 Python 伴侣放在常开的低功耗主机或 NAS；这台设备只负责整理和同步，网页与播放仍由 Cloudflare 托管。

## 免费不等于无限

Workers、D1、KV 和 R2 的免费配额会调整，以 Cloudflare 当期官方说明为准。个人曲库和少量听众通常适合；大量公开访问、持续代理无损音频或 TB 级 Worker 搬运不属于本项目的免费使用假设。

OneDrive 临时直链通常让音频绕过 Worker。WebDAV、Google Drive、本地目录以及主动启用的音源代理会让字节经过 Worker。

## 要不要额外部署音源代理

先用主站实测。只有网络路径确实不理想时，再部署 [audio-proxy.zh.md](audio-proxy.zh.md) 中的独立 Worker。它是受控中转，不是 CDN，也不保证在所有地区更快。

## 上线清单

- Worker URL 或自定义域可打开。
- 管理员和听众权限正确。
- 播放和拖动进度条正常。
- 隐藏专辑对听众完全不可见。
- R2 图片可选但已测试。
- D1 和设置 JSON 均已备份。
- 所有密钥未进入 Git、文档或截图。
