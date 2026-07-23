# 安装与部署

本文以纯 Cloudflare 部署为主，同时覆盖可选的本机 Python 伴侣、本地开发和备用 Node 运行方式。

## 1. 准备环境

- Node.js 22+
- Git
- 生产环境需要 Cloudflare 账号
- 至少一种音源存储：OneDrive、WebDAV 或 Google Drive
- 仅安装本机伴侣时需要：Python 3.11+、7-Zip（`7z` 或 `7zz`）
- 可选：用于本机同步的 `rclone`

`music_root`、`data_dir`、SQLite、临时文件和 `node_modules` 不要放在任何同步盘目录。

## 2. 可选：安装本机伴侣

如果你只使用网页上传/导入，并把网页、数据库和音源访问全部部署在 Cloudflare 与网盘上，可以跳过本节。关闭电脑后，登录、浏览、播放、网页导入和资源站 Cron 扫描仍可正常运行。

只有需要以下本地自动化时才安装伴侣：守望收件箱、处理文件夹或单层/嵌套压缩包、修复标签、批量整理本机曲库，以及把本机文件同步到云端。

```bash
git clone https://github.com/<你>/mihonban.git
cd mihonban
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -e ./pipeline
mihonban setup
mihonban doctor
```

`mihonban setup` 会把可移植 TOML 写到仓库外。若不在系统默认配置目录，设置 `MIHONBAN_CONFIG`；`MIHONBAN_CONFIG` 仅保留给旧安装兼容。

常用命令：

```bash
mihonban ingest --apply
mihonban watch
mihonban cloud sync
```

## 3. 本地运行 Worker

参照 `.env.example` 创建 `cloud/worker/.dev.vars`，只放测试凭据。本机纯 HTTP 必须设置 `DEV_INSECURE_COOKIE=1`；HTTPS 生产环境不得设置。

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
npx wrangler d1 execute mihonban --local --file schema.sql
npm run dev
```

默认网址通常是 `http://127.0.0.1:8787`。本地 D1 在 `cloud/worker/.wrangler/`，已被 Git 忽略。

## 4. 部署到 Cloudflare

### Windows 向导

```powershell
tools\deploy-cloud.cmd
```

此向导面向“Cloudflare + 本机伴侣”工作流，会在部署后写入本机 `[cloud]` 配置、首次同步并安装 Windows 守望任务。纯 Cloudflare 部署不需要运行它，直接使用下面的手动部署步骤即可。

### 手动部署

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

`mihonban` 是为兼容既有部署保留的 D1 资源名；产品与 CLI 名称仍是 `mihonban`，不需要仅为改名重建数据库。

把返回的 D1/KV ID 写入 `cloud/worker/wrangler.jsonc`，然后：

```bash
npx wrangler d1 execute mihonban --remote --file schema.sql
npx wrangler secret put APP_PASSWORD
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

`SESSION_SECRET` 使用 32 字节以上随机值。如果安装了本机伴侣，再额外执行 `npx wrangler secret put COMPANION_KEY`，并使用另一份独立随机值；纯云端模式可以不设置它。所有存储位置都在管理员后台配置；OneDrive 与 WebDAV、Google Drive、本地文件夹统一使用命名存储模型。

默认部署由同一个 Worker 同源托管 API 和 React 静态资源，不需要再拆 Vercel/Netlify。

## 5. 配置音源存储

### OneDrive

在 Azure 注册应用并配置文件读写与离线访问，取得 refresh token 和 drive ID。管理员后台填写 client ID、client secret、refresh token、drive ID，测试成功后再导入音频。

### WebDAV

填写曲库根 URL 和凭据。WebDAV 没有短期公开直链，播放会通过主 Worker 代理。

### Google Drive

1. 启用 Google Drive API。
2. 创建桌面 OAuth 客户端。
3. 在管理后台生成授权链接并同意授权。
4. Google 跳到 `http://localhost` 后，如果页面打不开，直接复制地址栏中的 `code`。
5. 换取 token，测试并添加。

应用使用可写 Drive 权限，以便看到已有曲库并上传文件。

多存储绑定和文件迁移见 [storage.zh.md](storage.zh.md)。

## 6. R2 图片镜像

R2 可选，但中大型曲库建议启用：

1. 创建桶和公开读 URL。
2. 创建对该桶有读写权限的 S3 兼容令牌。
3. 管理后台填写 endpoint、bucket、public URL、access key、secret。
4. 测试、启用、预热。

R2 只是图片镜像，不是数据库；索引可以重新生成。

## 7. 迁移已有数据库

如果权威曲库已经存在本地，不要先跑一次全量 `mihonban cloud sync`。正确顺序是：部署空 schema → 导入 D1 曲库数据 → 恢复管理后台设置 JSON → 验证存储 → 再开始同步。

完整流程见 [database-migration.zh.md](database-migration.zh.md)。Windows 工具：

```powershell
powershell -File tools\migrate-d1.ps1 -ImportRemote
```

## 8. Node 运行方式

```bash
cd cloud/web && npm ci && npm run build
cd ../worker && npm ci
cp .env.example .env
node src/node.js
```

设置持久化 `DATA_DIR`；数据库为 `<DATA_DIR>/mihonban.sqlite`。Node 模式额外支持 `local` 本地文件夹后端。公开部署必须通过平台 HTTPS 或 Caddy 等反代，不能用纯 HTTP 承载登录。

## 9. 可选音源代理

主 Worker 本身已经能中转。只有第二条 Cloudflare 路由或自定义域确实改善网络时，才部署 `cloud/proxy-worker`。生产必须启用签名，见 [audio-proxy.zh.md](audio-proxy.zh.md)。

## 10. 更新版本

```bash
git pull
cd cloud/web && npm ci && npm run build
cd ../worker && npm ci
npx wrangler d1 execute mihonban --remote --file schema.sql
npx wrangler deploy
```

较大升级前先备份 D1 和管理后台设置。`schema.sql` 可重复执行，旧数据库的新增列由运行时迁移补齐。

## 11. 上线验收

- 分别用听众和管理员口令登录。
- 打开专辑、歌曲、艺人、收藏和管理页。
- 播放一首歌并拖动进度条。
- 打开封面、艺人头像和内页图。
- 上传或登记一张测试专辑，再删除。
- 确认听众无法通过直接 URL 访问隐藏内容。
- 导出一份 D1 备份和设置 JSON。

## 排障

| 现象 | 检查 |
|---|---|
| 登录后立刻回登录页 | HTTPS cookie；本机 HTTP 需要 `DEV_INSECURE_COOKIE=1` |
| 播放 502 | 存储凭据、路径、专辑后端绑定、上游 Range |
| 新部署没有旧专辑 | 必须恢复 D1；设置 JSON 不包含专辑 |
| 封面慢 | 启用 R2 并预热 |
| Google Drive 看不到旧目录 | 用当前 Drive 权限重新授权 |
| Wrangler 操作错数据库 | 明确写 `--local` 或 `--remote` |
