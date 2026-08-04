# 架构与运行模型

[English](cloud.md) · [简体中文](cloud.zh.md) · [繁體中文](cloud.zh-Hant.md) · [日本語](cloud.ja.md) · [한국어](cloud.ko.md) · [Français](cloud.fr.md) · [Español](cloud.es.md)

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
- `album_images`：位于专辑后端的内页路径，以及用于保证外部图片导入幂等性的可选稳定来源标识。
- `favorites`：专辑/曲目精选及顺序。
- `notes`：专辑备注、艺人备注和简介。
- `storages`：命名 OneDrive、WebDAV、Google Drive 或 Node 本地后端配置。
- `settings`：口令哈希、模块开关、R2、资源站及其他运行状态。
- `source_posts`、`track_imports` 与图片缓存表：操作性元数据。

曲目标题的权威来源是明确的：管理员在网页中重命名曲目后，系统会设置 `tracks.title_override` 标记；后续本机伴侣扫描、整张专辑登记和单曲同步都会保留该标题，普通曲目则继续跟随文件标签。旧 D1 会自动增加此字段。迁移前的曲目会在下一次登记时完成归类：标题一致则作为普通同步标题，不一致则以避免丢失数据为原则，保留当前 D1 标题并认定为人工修改。SQLite/D1 逻辑备份会保留该标记。

管理后台设置 JSON 会导出白名单内的设置和命名存储配置，其中包含凭据；它不包含曲库行、口令哈希或旧会话，必须加密保存。

## 上传与播放

- 新上传必须选择一个命名后端作为写入目标。
- 旧专辑继续使用自己的 `storage_id`；切换写入目标不会搬移旧文件。
- OneDrive 使用上传会话和临时下载 URL。
- WebDAV 与 Google Drive 上传/播放经过主 API。
- Node 本地文件夹只由 Node 运行时流式读取。
- 网页上传只有在存储后端报告的精确字节数与预期一致后才会被接受。可续传服务会在短暂故障后查询已提交偏移量继续上传；代理型服务则重试完整请求体。
- 正确的 Range 与 `Content-Range` 对拖动进度至关重要，尤其是 iOS。

## 图片

未启用 R2 时，API 从所属存储读取图片并使用边缘/浏览器缓存头。启用 R2 后，首次访问或预热会复制到镜像，之后可重定向到公开 URL。更换图片会清除索引，使其重新镜像。如果 D1 丢失索引但同一公开 R2 对象仍存在，预热会用有界 HEAD 探测直接认领，不再下载和重复上传图片。

公开 R2 图片重定向会在浏览器和 Cloudflare 边缘缓存 5 分钟，并启用 stale-while-revalidate。重定向目标是带版本号且不可变的 R2 URL，因此刷新曲库时不会为每张封面重复调用 Worker；更换封面也能在缓存窗口后及时生效。隐藏图片和音频重定向仍保持私有且不缓存。

专辑列表及紧凑封面区域使用 Cloudflare Image Transformations 从存储源文件生成 256 px 或 640 px 的 WebP 衍生图。`fit: scale-down` 会保留手动或 Discogs 裁剪后的准确构图，不依赖可能滞后的存储服务缩略图缓存，同时避免滚动时解码数 MB 的源图。详情与裁剪界面仍使用原图。R2 会保留 `art:<album-id>:original` 原图转换源，并同时保存 `art:<album-id>:256` 与 `art:<album-id>:640`。转换不可用时，API 会回退提供源图，但不会把源图错误登记到衍生图键下。

公开镜像重定向落到缺失或陈旧对象时，网页会改为从所属存储回源。Worker 会校验返回的图片字节，必要时从服务商缩略图退回原图；恢复成功后自动修复 R2 对象及带版本号的 D1 索引。这样浏览器缓存过的旧 404 可以自愈，同时不会把私有存储凭据交给浏览器。

R2 不是音频后端，也不是曲库数据库。

## 运行时结构与 D1 配额

Worker 会在处理 API 请求前升级旧曲库。公开 Wrangler 模板提供稳定的 `DB_SCHEMA_KEY`，升级成功后会把当前代码的运行时版本写入 `settings.schema_version`。同一 isolate 后续直接使用内存状态；冷启动 isolate 只读取这一行标记，随后跳过兼容 DDL 和数据回填。请保持 `DB_SCHEMA_KEY` 稳定，也不要把该标记当作普通垃圾数据删除。后续版本若增加运行时迁移，维护者必须同时递增 `RUNTIME_SCHEMA_VERSION`。

在同一个命名存储内，专辑文件夹和曲目路径按不区分大小写的身份判断；整个曲库中的艺人身份也遵循同一规则。Mihonban 会保留第一次写入的展示拼写，但拒绝之后仅大小写不同的重复记录。

Workers Free 当前每天包含读取 500 万行、写入 10 万行的 D1 额度，并在 00:00 UTC 重置。重新部署或修复代码无法扣除已经计入的用量，控制台聚合也可能在查询恢复后继续显示上一周期的总数。判断当前服务状态时，应发起不使用缓存的 API 请求或直接执行 D1 查询，并查看每条查询的 `meta.rows_read` / `meta.rows_written`；控制台进度条应视为历史用量，而不是实时封锁开关。如果用量再次快速攀升，请确认部署配置仍包含 `DB_SCHEMA_KEY`，且 `settings.schema_version` 与当前 Worker 一致。最新额度以 [D1 定价文档](https://developers.cloudflare.com/d1/platform/pricing/)为准。

## 定时任务

Cloudflare 的 Wrangler Cron 在每六小时的第 17 分钟触发。Node 使用 `SOURCE_SCAN_HOURS`（默认 `6`，设为 `0` 关闭）。资源站扫描只读取支持的 RSS/Atom/Blogger 标题和链接，不下载音乐。

`mihonban watch` 是另一项功能：它守望真实本机收件箱并调用 7-Zip/beets，必须运行在能访问该目录的电脑或 NAS 上，不能放进 Cloudflare Workers。

## 备份与恢复层次

1. 曲库：SQLite 感知备份或 D1 逻辑 SQL 导出。
2. 配置：管理后台设置 JSON，加密保存。
3. 运行时密钥：密码管理器或部署平台 secret store。
4. 音频与原图：独立的存储层备份。
5. KV：重新生成。R2 图片索引：仅在保留同一桶时迁移；否则通过预热认领已有公开对象或重新生成。

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
