# Cloudflare Serverless 托管

[English](serverless-hosting.md)

Serverless 的目标是在家中电脑关机后，网页仍能登录、浏览和播放。受支持的形态是：一个 Worker 同源提供 React 与 API，D1 + KV，可选 R2 图片镜像，音频保存在 OneDrive、WebDAV 或 Google Drive。

## 工作负载是否适合

| 工作 | Cloudflare Workers 适合度 |
|---|---|
| React 静态资源和短 API 请求 | 适合 |
| D1 曲库/设置与 KV 短期缓存 | 适合 |
| RSS/Atom/Blogger 资源站提醒 | 适合，可用 Cron Trigger |
| 从存储进行 Range 流式播放 | 支持，但受网络和套餐限制 |
| 收件箱守望、解压、beets、批量改标签 | 不支持，使用本机伴侣 |
| 转码或持续扫描本地文件夹 | 不支持，使用 Node/NAS 工具 |

## 推荐拓扑

```text
浏览器
  |
Cloudflare Worker（API + React 静态资源）
  |-- D1：曲库和设置
  |-- KV：限流与短期缓存
  |-- 可选 R2：图片镜像
  +-- OneDrive / WebDAV / Google Drive：音频和原图
```

部署步骤见[安装与部署](install.zh.md)。已有本地曲库先按[数据库迁移](database-migration.zh.md)操作；只导入管理后台设置不会恢复专辑。

## 家中电脑是否必须常开

网页登录、浏览、播放、网页导入和定时资源站扫描都不需要家中电脑常开。只有处理本机收件箱、本地与云端对账、离线备份或其他伴侣任务时才开机。

Cloudflare Workers 看不到家中目录，也不能常驻等待文件事件。希望收件箱全天自动处理时，可把 Python 伴侣放到常开的 NAS 或低功耗主机。该设备只负责整理与同步，网页应用仍独立运行在 Cloudflare。

## 免费不等于无限

Workers、D1、KV 与 R2 的额度和价格会变化，应以当前 Cloudflare 控制台和官方文档为准。本项目对免费额度的假设是个人曲库或少量听众，不包括大规模公开分发或持续搬运 TB 级无损音频。

OneDrive 临时 URL 常常绕过 Worker。WebDAV、Google Drive 和主动启用的音源代理会让字节经过 Worker，消耗更多平台资源。

## 外部音源代理

先实测主部署。只有测量证实另一条 Worker 路由或自定义域改善网络路径时才添加独立代理。它是带签名和白名单的中转，不是公共 CDN，也不保证更快。详见[可选 Cloudflare 音源代理](audio-proxy.zh.md)。

## 上线清单

- Worker URL/自定义域通过 HTTPS 打开。
- 听众、管理员和可选免密访客权限正确。
- 桌面、iOS Safari 和 Android Chrome 均能播放和拖动进度。
- 隐藏内容在 API 层面对听众不可访问。
- 每个命名存储都已测试，并选择了一个写入目标。
- 可选 R2 图片和代理分别通过测试。
- D1 SQL、设置 JSON、运行时密钥和音频备份各自都有安排。
- Git、文档、日志和截图中没有任何密钥。
