# 云端架构与运行模型

本文解释当前 Cloudflare 主部署如何工作。具体安装命令见 [install.zh.md](install.zh.md)，数据库搬迁见 [database-migration.zh.md](database-migration.zh.md)。

## 组件

| 组件 | 职责 | 是否权威数据 |
|---|---|---|
| React Assets | 播放器与管理界面 | 否，可重新构建 |
| Worker API | 认证、曲库、存储调度、上传与播放 | 无状态业务入口 |
| D1 | 专辑、曲目、艺人、收藏、备注、设置、存储绑定 | 是 |
| KV | 登录限流、Graph token、短期下载 URL 等缓存 | 否，可清空 |
| R2 | 封面、头像、内页图镜像 | 否，可重新预热 |
| 音源存储 | 音频与原始图片 | 是 |
| Cron 资源站扫描 | 定时读取 RSS/Atom/Blogger 标题和链接 | 否，可重扫 |
| 本机 Python 伴侣 | 收件箱、解压、标签、beets 和云同步 | 本机工作流 |

音频本体不进入 D1、KV 或 Git。

## 请求路径

```text
浏览器 --HTTPS--> Worker
  |                 |-- D1 读取元数据
  |                 |-- KV 读取短期缓存
  |                 |-- R2 命中则 302 图片
  |                 +-- 存储后端解析音频/原图
  |
  +-- OneDrive 临时直链：通常 302 直连
  +-- WebDAV/GDrive/Local：Worker 代理并透传 Range
  +-- 可选外部代理：主 Worker 生成五分钟签名后 302
```

外部代理只接管已经能取得临时直链的音源。WebDAV、Google Drive 和 Node 本地目录仍由主 Worker 调用其私有凭据读取。

## 权限

- 未登录：仅 `/api/me`、登录端点和静态页面可用；开放访客模式时获得只读访客身份。
- 听众：浏览、搜索、播放、查看公开收藏。
- 管理员：所有写操作和基础设施设置。
- 伴侣：只接受独立 `X-Api-Key`，用于同步和心跳。

Cookie 由 HMAC 签名并包含会话纪元。修改管理员口令会让既有会话失效。登录失败按来源限流：6 次失败后锁定 15 分钟。

## 数据模型

- `albums`：专辑元数据、存储 ID、隐藏状态。
- `tracks`：曲目与存储相对路径，通过专辑选择后端。
- `artists`：头像路径和独立的头像存储 ID。
- `album_images`：专辑内页图，沿用专辑存储。
- `favorites`：专辑/曲目收藏与顺序。
- `notes`：专辑备注、艺人备注和艺人简介。
- `storages`：命名后端及其配置。
- `settings`：密码哈希、模块开关、默认存储/R2 等运行设置。

配置 JSON 备份会导出允许迁移的设置和命名后端，但不包含专辑、曲目或艺人。D1 数据备份与设置备份缺一不可。

## 上传

- OneDrive 使用上传会话，浏览器分片直传。
- WebDAV/Google Drive 等后端通过 `/api/upload/proxy` 写入。
- 注册专辑时记录当前写入目标的 `storage_id`。
- 艺人头像记录自己的 `storage_id`，不能从“任意一张专辑”猜测。

## 图片

未启用 R2 时，Worker 从所属存储读取图片并使用边缘缓存。启用 R2 后，首次读取或预热会写入 R2；后续请求 302 到公开图片域名。更换图片会清理索引，使下次请求重新镜像。

## 免费托管边界

Cloudflare 免费套餐通常足够个人曲库或少量听众，但配额会变化，应以官方控制台和文档为准：

- API 请求、D1 行读取/写入和 KV 操作都有额度。
- OneDrive 直链音频不经过 Worker；代理音频会占 Worker 请求和持续时间。
- R2 适合图片，不建议用本项目脚本把私人音频做公共缓存。
- 资源站标题/链接扫描可由 Cloudflare Cron 完成，不需要本机在线。
- Worker 看不到电脑或 NAS 的收件箱，也不做转码、音量分析、压缩包解压、beets 匹配或批量改标签。
- `mihonban watch` 必须运行在能访问 `inbox` 的本机或 NAS；整理完成后再把音频与元数据同步到云端。

## 备份与灾难恢复

至少保留：

1. 音频的独立副本。
2. 定期 D1 SQL 导出。
3. 管理后台设置 JSON，放在加密位置。
4. Worker secrets 的恢复记录；不要放进普通文档或 Git。

KV 与 R2 索引可以重建。完整恢复步骤见数据库迁移文档。

## 可观测与排障

```bash
cd cloud/worker
npx wrangler tail
npx wrangler d1 execute mihonban --remote --command "SELECT COUNT(*) AS albums FROM albums"
```

不要在日志中输出 refresh token、预签名音频 URL 或设置备份正文。
