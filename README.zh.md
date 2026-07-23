# mihonban / 見本盤

一套面向稀有音乐收藏的私有曲库：Cloudflare 托管网页播放器，可选在本机自动整理音频。

当前主产品是 `cloud/web` 的 React 应用和 `cloud/worker` 的 API。音频留在你控制的存储里；D1 保存曲库、艺人和人工维护的元数据。

## 主要能力

- 专辑、歌曲、艺人、收藏、导入和管理后台，完整适配桌面与手机
- 听众/管理员口令与可选只读访客模式
- 播放队列、随机/循环、Range 流式播放和播放器状态持久化
- OneDrive、WebDAV、Google Drive，以及 Node 部署专用的本地文件夹
- R2 镜像封面、内页和艺人头像
- Discogs 官方 API 导入；手动保存 RYM HTML 后本地解析，不自动请求 RYM
- 可选的 Python 收件箱管线：处理文件夹及单层/嵌套压缩包、修复日文乱码、整理标签并同步云端
- 七种界面语言
- SQLite/D1 迁移工具和可选的签名音源代理 Worker

## 架构

```text
浏览器 / PWA
    |
    v
Cloudflare Worker + React 静态资源
    |-- D1：专辑、曲目、艺人、收藏、备注、存储绑定
    |-- KV：限流和短期缓存
    |-- R2：可选图片镜像
    +-- OneDrive / WebDAV / Google Drive：音频与原图

可选本机 Python 伴侣 --> 元数据 API + 音频存储
可选代理 Worker  --> 短期签名、域名白名单、Range 音频中转
```

生产环境首选 Cloudflare。`cloud/worker/src/node.js` 可在 Node 上用 SQLite 运行同一套 API，并支持本地文件夹存储。本机桌面播放器可以独立使用，但不属于本仓库运行时。

## 快速开始

### 可选：本机管线

纯 Cloudflare 部署可以跳过本节；只有需要收件箱守望、压缩包处理、标签整理或本机同步时才安装。

```bash
git clone https://github.com/<你>/mihonban.git
cd mihonban
python -m venv .venv
# Windows: .venv\Scripts\activate
# POSIX:   source .venv/bin/activate
pip install -e ./pipeline
mihonban setup
mihonban doctor
```

`music_root`、`data_dir`、数据库和临时目录不要放进 OneDrive、Dropbox 等同步目录。

### 本地运行云端应用

```bash
cd cloud/web
npm ci
npm run build
cd ../worker
npm ci
npx wrangler d1 execute mihonban --local --file schema.sql
npm run dev
```

这里的 `mihonban` 是 `wrangler.jsonc` 中保留的 D1 资源名，不是产品显示名称；现有部署无需为改名重建数据库。

根据 `.env.example` 创建 `cloud/worker/.dev.vars`。本机纯 HTTP 需要 `DEV_INSECURE_COOKIE=1`。打开 Wrangler 输出的网址，通常是 `http://127.0.0.1:8787`。

### 部署到 Cloudflare

如果需要同时配置本机伴侣，Windows 可运行一体化向导：

```powershell
tools\deploy-cloud.cmd
```

纯 Cloudflare 部署不需要本机伴侣或守望任务，请使用 [docs/install.zh.md](docs/install.zh.md) 中的手动部署步骤。

## 数据库迁移

曲库数据和运行设置分开备份：

```powershell
# 自动寻找 Node SQLite 或 Wrangler 本地 D1，保留 SQL 备份并导入远端 mihonban D1
powershell -File tools\migrate-d1.ps1 -ImportRemote
```

默认 SQL 包含专辑、曲目、艺人、收藏、备注等，不包含设置和存储凭据。迁移前在管理后台下载“设置备份”JSON，D1 导入后再恢复。完整说明见 [docs/database-migration.zh.md](docs/database-migration.zh.md)。

## 可选音源代理

`cloud/proxy-worker` 是独立的标准 Cloudflare Worker：支持 Range/HEAD，校验五分钟 HMAC 签名、上游域名和每次重定向，不会成为开放代理，也不缓存私人音频。

部署见 [docs/audio-proxy.zh.md](docs/audio-proxy.zh.md)。是否加速取决于用户、Cloudflare 与源站之间的真实网络，代理只提供受控中转，不承诺一定更快。

## 仓库结构

| 路径 | 用途 |
|---|---|
| `cloud/web/` | 主 React 播放器与管理后台 |
| `cloud/worker/` | Hono API、D1 schema、Node 兼容运行时 |
| `cloud/proxy-worker/` | 可选签名音源代理 |
| `pipeline/` | Python `mihonban` CLI 与整理/同步管线 |
| `config/` | 不含密钥的配置模板 |
| `tools/` | 部署、守望和数据库迁移工具 |
| `tests/` | Python 回归测试 |

## 常用命令

```text
mihonban setup                 创建可移植配置
mihonban doctor                检查依赖与路径
mihonban ingest --apply        处理收件箱压缩包或专辑文件夹
mihonban watch                 守望收件箱并定期对账
mihonban cloud sync            上传并登记本机专辑
mihonban cloud pull            把网页导入拉回本机
mihonban rym parse|match|write 解析手存 RYM HTML 并写标签

cd cloud/worker && npm test
cd cloud/proxy-worker && npm test
cd cloud/web && npm run build
```

## 安全与数据所有权

- 不要提交 `.dev.vars`、`.env`、`mihonban.toml`、`rclone.conf`、SQL 备份、token 或音频。
- 生产 cookie 依赖 HTTPS；访客模式默认关闭。
- 外部代理应始终配置同一份 `STREAM_PROXY_SECRET` / `PROXY_SECRET`。
- RYM 只解析用户手动保存的文件，项目不包含 RYM 爬虫。
- 稀有音频至少保留一份独立备份；D1 备份不等于音频备份。

## 文档

| 文档 | 内容 |
|---|---|
| [GOAL.md](GOAL.md) | 当前产品目标与红线 |
| [docs/install.zh.md](docs/install.zh.md) | 安装与部署 |
| [docs/database-migration.zh.md](docs/database-migration.zh.md) | D1 备份、迁移和恢复 |
| [docs/audio-proxy.zh.md](docs/audio-proxy.zh.md) | 音源代理部署 |
| [docs/storage.zh.md](docs/storage.zh.md) | 多存储与文件迁移 |
| [docs/manual.md](docs/manual.md) | 日常使用与排障 |
| [docs/serverless-hosting.zh.md](docs/serverless-hosting.zh.md) | 纯 Cloudflare 免费托管决策 |
| [docs/github-publish.zh.md](docs/github-publish.zh.md) | 安全发布代码 |
| [README.md](README.md) | English overview |

## 许可证

Mihonban 使用 [GNU Affero 通用公共许可证第三版](LICENSE)（`AGPL-3.0-only`）。如果修改本软件并通过网络向他人提供服务，AGPL 要求向这些用户提供对应版本的源代码。

许可证只覆盖本仓库中的代码和配置模板，不授予传播音乐或第三方元数据的权利。
