# 架构与运行模型

[English](cloud.md)

Mihonban 在本地与云端使用同一套 React 前端和 Worker 兼容 API；不同运行时只替换持久化与文件访问适配层。

## 组件

| 组件 | Node | Wrangler 本地 | Cloudflare | 权威性 |
|---|---:|---:|---:|---|
| React 静态资源 | 支持 | 支持 | 支持 | 可重新构建 |
| Hono API | 支持 | 支持 | 支持 | 无状态应用层 |
| 曲库数据库 | SQLite | 本地 D1 | 远端 D1 | 权威元数据 |
| 限流/缓存 KV | SQLite 适配 | 本地 KV | Cloudflare KV | 可重建 |
| R2 图片镜像 | 可选 | 可选 binding | 可选 | 可重建图片缓存 |
| 本地文件夹后端 | 支持 | 不支持 | 不支持 | 配置后属于权威文件 |
| OneDrive/WebDAV/Google Drive | 支持 | 支持 | 支持 | 权威文件 |
| Python 伴侣 | 外部进程 | 外部进程 | 外部进程 | 可选本地工作流 |

音频文件绝不能进入 D1、KV、R2 图片缓存或 Git。

## 请求路径

```text
浏览器 --HTTP/HTTPS--> API 运行时
                         |-- 曲库元数据：SQLite 或 D1
                         |-- 短期缓存/限流：KV 适配层
                         |-- 图片镜像：可选 R2
                         +-- 命名存储后端

OneDrive 临时 URL ------------> 通常 302 直连播放
WebDAV / Google Drive --------> 主 API Range 代理
Node 本地文件夹 --------------> Node Range 流
可选外部代理 -----------------> 临时 URL 的五分钟签名中转
```

外部代理只接收主 API 已经能够取得临时 URL 的音源，永远不会获得 WebDAV、Google Drive 或本地文件夹凭据。

## 认证与身份

- 听众口令（初始 `APP_PASSWORD`）：浏览和播放。
- 管理员口令（初始 `ADMIN_PASSWORD`）：所有写操作和基础设施设置。
- 免密访客模式：管理员显式开启后，无需口令即可获得听众只读身份。
- 伴侣密钥（`COMPANION_KEY`）：可选，由本机 Python 伴侣通过 `X-Api-Key` 使用。

在管理后台修改的口令以 PBKDF2 哈希写入数据库，优先于环境变量中的初始值。修改口令会递增会话纪元，使已有登录 cookie 失效。登录失败按来源 IP 计数；六次失败后锁定该来源 15 分钟。

生产 cookie 必须使用 HTTPS。`DEV_INSECURE_COOKIE=1` 只用于可信局域网内的本地 HTTP 测试。

## 数据模型

- `albums`：专辑元数据、命名 `storage_id`、隐藏状态和排序字段。
- `tracks`：曲目元数据与存储相对路径；继承专辑后端。
- `artists`：艺人元数据、隐藏状态、头像路径和独立头像 `storage_id`。
- `album_images`：位于专辑后端的内页路径。
- `favorites`：专辑/曲目精选及顺序。
- `notes`：专辑备注、艺人备注和简介。
- `storages`：命名 OneDrive、WebDAV、Google Drive 或 Node 本地后端配置。
- `settings`：口令哈希、模块开关、R2、资源站及其他运行状态。
- `source_posts`、`track_imports` 与图片缓存表：操作性元数据。

管理后台设置 JSON 会导出白名单内的设置和命名存储配置，其中包含凭据；它不包含曲库行、口令哈希或旧会话，必须加密保存。

## 上传与播放

- 新上传必须选择一个命名后端作为写入目标。
- 旧专辑继续使用自己的 `storage_id`；切换写入目标不会搬移旧文件。
- OneDrive 使用上传会话和临时下载 URL。
- WebDAV 与 Google Drive 上传/播放经过主 API。
- Node 本地文件夹只由 Node 运行时流式读取。
- 正确的 Range 与 `Content-Range` 对拖动进度至关重要，尤其是 iOS。

## 图片

未启用 R2 时，API 从所属存储读取图片并使用边缘/浏览器缓存头。启用 R2 后，首次访问或预热会复制到镜像，之后可重定向到公开 URL。更换图片会清除索引，使其重新镜像。

R2 不是音频后端，也不是曲库数据库。

## 定时任务

Cloudflare 的 Wrangler Cron 在每六小时的第 17 分钟触发。Node 使用 `SOURCE_SCAN_HOURS`（默认 `6`，设为 `0` 关闭）。资源站扫描只读取支持的 RSS/Atom/Blogger 标题和链接，不下载音乐。

`mihonban watch` 是另一项功能：它守望真实本机收件箱并调用 7-Zip/beets，必须运行在能访问该目录的电脑或 NAS 上，不能放进 Cloudflare Workers。

## 备份与恢复层次

1. 曲库：SQLite 感知备份或 D1 逻辑 SQL 导出。
2. 配置：管理后台设置 JSON，加密保存。
3. 运行时密钥：密码管理器或部署平台 secret store。
4. 音频与原图：独立的存储层备份。
5. KV 与 R2 图片索引：不迁移，重新生成。

完整顺序见[数据库备份、迁移与恢复](database-migration.zh.md)。

## 托管边界

Cloudflare 免费计划通常适合个人曲库或少量听众，但额度和条款会变化。API 请求、D1 行、KV 操作、R2 和代理音频都会消耗平台资源。OneDrive 临时 URL 常常绕过 Worker；WebDAV、Google Drive、Node 本地流和主动启用的代理不会。

Workers 无法访问家中电脑目录、常驻等待文件事件、转码、运行 beets 或解压。此类任务必须留在可选本机伴侣中。

## 诊断

Cloudflare：

```bash
cd cloud/worker
npx wrangler tail
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc \
  --command "SELECT COUNT(*) AS albums FROM albums"
```

Wrangler 本地把命令改为 `--local`。Node 用户检查 `DATA_DIR`、启动日志和管理后台系统状态。日志中不得输出 refresh token、签名音频 URL、设置备份正文或请求授权头。
