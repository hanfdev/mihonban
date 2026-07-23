# 安装与部署

[English](install.md)

本文覆盖三种受支持的应用运行时，以及可选的本机 Python 伴侣。应用运行时三选一；伴侣只是额外工作流工具，不是服务器必需组件。

## 1. 准备环境

- Node.js 22 或更新版本
- Git
- 只有部署 Cloudflare 时才需要 Cloudflare 账号
- Cloudflare 部署至少需要 OneDrive、WebDAV 或 Google Drive 中的一种
- 只有安装本机伴侣时才需要 Python 3.11+ 和 7-Zip（`7z`、`7zz` 或 `7za`）
- 可选：供伴侣执行本地到云端文件同步的 `rclone`

实时 SQLite、`music_root`、`data_dir`、临时目录和 `node_modules` 不要放进 OneDrive、Dropbox、iCloud 等同步目录。仓库本身可以同步，但构建目录与可变数据必须放在同步盘外。

克隆正式仓库：

```bash
git clone https://github.com/hanfdev/mihonban.git
cd mihonban
```

## 2. 选择运行方式

| 运行时 | 默认网址 | 数据库 | 本地文件夹后端 |
|---|---|---|---:|
| Wrangler 本地 | `http://127.0.0.1:8787` | 本地 D1/KV 模拟 | 不支持 |
| Node | `http://127.0.0.1:8788` | `<DATA_DIR>/mihonban.sqlite` | 支持 |
| Cloudflare | Worker URL/自定义域 | 远端 D1 + KV | 不支持 |

Wrangler 本地环境最接近 Cloudflare 生产环境。Node 更适合作为长期运行的本机/NAS 服务，也是唯一能读取服务器本地文件夹后端的运行时。

## 3. 本地 Wrangler 开发

### Windows 辅助脚本

仓库位于 OneDrive 时，使用：

```powershell
tools\cloud-dev.cmd
```

脚本默认把 `cloud/` 复制到 `%TEMP%\mihonban-cloud-build`，在同步盘外安装依赖、构建 React、应用本地 schema，并以 `0.0.0.0:8787` 启动 Wrangler。可以把 `MIHONBAN_STAGE` 指向另一个非同步目录，避免系统清理临时目录时丢失本地 D1。

首次运行会生成 `.dev.vars`，其中：

```text
APP_PASSWORD=mihonban-guest
ADMIN_PASSWORD=mihonban-admin
```

其余密钥随机生成。这两个口令只用于本地开发；允许其他人连接前，应在管理后台立即修改。

### 手动运行 Wrangler

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
# 参考 .env.example 创建 .dev.vars，并替换全部占位值。
# 本地 HTTP 设置 DEV_INSECURE_COOKIE=1。
npx wrangler d1 execute DB --local --file schema.sql
npx wrangler dev --ip 0.0.0.0 --port 8787
```

不使用暂存脚本时，本地状态位于 `cloud/worker/.wrangler/`。`.wrangler/` 和 `.dev.vars` 都已被 Git 忽略。

手机测试时，让手机与电脑连接同一局域网，在主机防火墙中允许 Node.js，然后打开 `http://<电脑内网 IP>:8787`。不要把这个纯 HTTP 开发服务器直接暴露到公网。

## 4. 本地 Node + SQLite

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
# Windows: Copy-Item .env.example .env
# POSIX:   cp .env.example .env
npm run node
```

启动前编辑 `.env`：

```dotenv
APP_PASSWORD=自定义听众口令
ADMIN_PASSWORD=另一份管理员口令
SESSION_SECRET=至少32个随机字符
DEV_INSECURE_COOKIE=1
DATA_DIR=D:/mihonban-data
PORT=8788
```

Node 模式没有内置口令。`APP_PASSWORD` 是听众口令；免密访客访问是管理后台中的另一个独立开关。服务器监听 `0.0.0.0`，防火墙允许端口后，局域网设备可以打开 `http://<电脑内网 IP>:8788`。

数据库位于 `<DATA_DIR>/mihonban.sqlite`；未设置 `DATA_DIR` 时默认为 `cloud/worker/data/`。应用停止后再复制数据库，或使用 SQLite 感知的备份工具。公开 Node 部署必须位于可信平台或反向代理的 HTTPS 后面；只有所有请求都经过自己控制的代理时才设置 `TRUST_PROXY=1`。

## 5. 可选 Python 本机伴侣

网页上传/导入已经够用时可跳过。本机伴侣用于收件箱守望、文件夹或单层/嵌套压缩包、标签修复、本地整理，以及本地与云端对账。

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -e ./pipeline
mihonban setup
mihonban doctor
```

`mihonban setup` 会把私有 TOML 写到仓库外。`MIHONBAN_CONFIG` 是当前正式变量，不是旧兼容别名。查找顺序是显式 `--config`、`MIHONBAN_CONFIG`、`./mihonban.toml`，最后才是系统用户配置目录。

常用命令：

```text
mihonban ingest --apply
mihonban watch
mihonban cloud sync
mihonban cloud pull
```

伴侣不能运行在 Cloudflare Workers 中，因为它需要持久本机文件系统和 7-Zip、beets 等外部程序。

## 6. 部署到 Cloudflare

手动部署是标准流程，不要求安装本机伴侣。

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
npx wrangler login
npx wrangler d1 create mihonban
npx wrangler kv namespace create KV
```

把返回的 D1 数据库 ID 和 KV namespace ID 写入 `cloud/worker/wrangler.jsonc`，替换全零占位符。然后执行：

```bash
npx wrangler d1 execute mihonban --remote --file schema.sql
npx wrangler secret put APP_PASSWORD
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

Cloudflare 部署没有默认听众或管理员口令。请分别输入不同口令，并为 `SESSION_SECRET` 使用至少 32 个随机字符。只有本机伴侣要连接云端时才添加：

```bash
npx wrangler secret put COMPANION_KEY
npx wrangler deploy
```

同一个 Worker 同源提供 `/api/*` 和构建后的 React 静态资源，无需另配前端托管。

### 可选 Windows 一体向导

`tools\deploy-cloud.cmd` 会创建 Cloudflare 资源、询问两种口令、上传随机会话/伴侣密钥、写入伴侣 `[cloud]` 配置、首次同步并安装守望任务。它只适合 Windows 的“Cloudflare + 本机伴侣”组合工作流；纯云端用户使用上面的手动命令。

## 7. 配置音源存储

管理员登录后添加命名后端。上传前必须选择一个写入目标。

### OneDrive

在 Azure 创建具有委托文件读写与离线访问权限的应用。在后台填写 client ID、client secret、refresh token 和 drive ID，然后测试。OneDrive 播放通常使用临时直链，可能绕过 Worker。

### WebDAV

填写曲库根 URL 和凭据。WebDAV 没有临时公开下载 URL，因此播放和上传都经过主 Worker。

### Google Drive

启用 Drive API 并创建桌面 OAuth 客户端。在后台生成授权链接并同意授权；必要时从 `http://localhost` 跳转地址中复制 `code`，换取 token 后测试并添加。发现已有曲库和上传文件需要可写 Drive 权限。

### 本地文件夹

只在 Node 运行时可用。根目录必须位于服务器文件系统中，不能直接迁到 Cloudflare。详见[多存储与文件迁移](storage.zh.md)。

## 8. 可选 R2 图片镜像

R2 是可重建的图片镜像，不是曲库数据库，也不是音频后端。创建 bucket、公开读取 URL 和 S3 兼容读写令牌，在后台填写后测试、启用并预热。access key 与 secret 不能进入 Git。

## 9. 搬迁已有数据库

不要以为新建空部署后导入设置就会恢复专辑。曲库数据、设置、运行时密钥和音频是四个独立层次。切换运行时前必须遵循[数据库备份、迁移与恢复](database-migration.zh.md)。

## 10. 可选音源代理

需要私有凭据的后端本来就由主 Worker 代理。只有第二条 Cloudflare 路由或自定义域实测能改善临时直链播放时，才部署 `cloud/proxy-worker`。见[可选 Cloudflare 音源代理](audio-proxy.zh.md)。

## 11. 更新版本

较大更新前备份数据库和管理后台设置 JSON。

Cloudflare：

```bash
git pull
cd cloud/web && npm ci && npm run build
cd ../worker && npm ci
npx wrangler d1 execute mihonban --remote --file schema.sql
npx wrangler deploy
```

Node：重新构建 `cloud/web`、安装 Worker 依赖、停止旧进程并重新运行 `npm run node`。`schema.sql` 可重复执行，运行时迁移会为旧数据库补充必需列。

## 12. 验收

- 分别用听众和管理员口令登录；只有明确启用后才测试免密访客模式。
- 打开曲库、歌曲、艺人、精选、导入和管理页面。
- 播放歌曲、拖到接近结尾，并在 iOS/Android 测试系统媒体控制。
- 打开封面、艺人头像和专辑内页，在手机上测试左右滑动。
- 确认隐藏专辑、曲目、艺人、风格、图片、搜索结果和精选都不能被听众访问。
- 向当前写入目标上传一张可删除的测试专辑，然后删除。
- 同时导出数据库备份和管理后台设置 JSON。

## 排障

| 现象 | 检查 |
|---|---|
| 登录后立刻返回登录页 | 本地 HTTP 需要 `DEV_INSECURE_COOKIE=1`；公开环境必须是 HTTPS |
| 原环境变量口令被拒绝 | 管理后台保存的哈希口令优先级更高 |
| 播放返回 502 | 命名后端绑定、凭据、相对路径和上游 Range 支持 |
| 已有专辑消失 | 必须恢复曲库数据库；设置 JSON 不包含专辑 |
| Wrangler 看起来是空库 | 检查 `--local`/`--remote`，以及哪个暂存目录拥有 `.wrangler/` |
| Node 看起来是空库 | 检查 `DATA_DIR` 是否指向正确的 `mihonban.sqlite` |
| 手机无法连接 | 使用内网 IP、监听 `0.0.0.0`，并允许对应端口通过防火墙 |
| 登录返回 429 | 停止重复尝试，等待来源 IP 的 15 分钟锁定结束 |
