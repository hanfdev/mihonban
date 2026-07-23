# 数据库备份、迁移与恢复

[English](database-migration.md)

本文用于在 Node SQLite、Wrangler 本地 D1 和 Cloudflare 远端 D1 之间搬迁完整曲库。

继续只在本地使用时，应分别备份 `<DATA_DIR>/mihonban.sqlite`、管理后台设置 JSON、运行时密钥和音频。只有真正创建 Cloudflare 部署后，远端步骤才适用。

## 到底要搬哪些东西

| 数据 | 迁移方式 |
|---|---|
| 专辑、曲目、艺人、内页、收藏、备注、资源站状态 | D1 SQL 导出/导入 |
| OneDrive/R2/模块设置和命名存储配置 | 管理后台设置 JSON |
| 听众/管理员口令、会话密钥、伴侣 Key、代理签名密钥 | 在新 Worker 单独配置 secrets |
| KV 限流与短期缓存 | 不迁移 |
| R2 镜像索引 | 不迁移，重新预热 |
| 音频和原图 | 在存储层复制/迁移，不属于 D1 |

只下载管理后台 JSON 不等于备份曲库；只导入 D1 也不会自动搬音频或恢复全部密钥。

## 从 Node 本地存储迁到 Cloudflare 前

Cloudflare 不能读取 Node 的 `local` 后端。旧 Node 服务还能运行时先做：

1. 添加并测试 OneDrive、WebDAV 或 Google Drive。
2. 把所有绑定本地文件夹的专辑迁到云后端。
3. 抽查播放、封面、头像和内页。
4. 再导出数据库。

否则新站只能看到元数据，音频会 502。

## 1. 备份源端

在旧站用管理员登录，下载 **管理 → 设置备份** JSON，并放进加密保险库。

Node 数据库为 `<DATA_DIR>/mihonban.sqlite`。Wrangler 本地 D1 位于 `cloud/worker/.wrangler/state/v3/d1/`。

正式切换时停止写操作。导出器使用 SQLite 只读事务，但无人同时编辑更容易核对。

## 2. 准备新 Cloudflare 项目

创建 D1/KV，把 ID 写入 `wrangler.jsonc`，应用 schema：

```bash
cd cloud/worker
npm ci
npx wrangler d1 execute mihonban --remote --file schema.sql
```

本文命令中的 D1 资源名为 `mihonban`，与 `wrangler.jsonc` 和 Worker 保持一致。

如果目标 D1 已有重要内容，先备份：

```bash
mkdir -p ../../backups
npx wrangler d1 export mihonban --remote --output ../../backups/remote-before-import.sql
```

PowerShell 可先用 `New-Item -ItemType Directory ../../backups -Force` 创建目录。

## 3. 导出并导入曲库

### Windows 一体工具

仓库根目录执行：

```powershell
powershell -File tools\migrate-d1.ps1 -ImportRemote
```

工具会自动寻找最新的 Node SQLite 或 Wrangler 本地 D1，在已忽略的 `backups/` 下生成带时间戳 SQL。只有显式加 `-ImportRemote` 才写远端；去掉该开关就是只导出。

本机存在多个数据库时，必须显式传入 `-Source`，不要依赖修改时间自动选择。

显式指定源：

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -Database "mihonban" `
  -ImportRemote
```

### 任意系统手动执行

```bash
cd cloud/worker
npm ci
npm run db:export -- \
  --source /path/to/mihonban.sqlite \
  --output ../../backups/mihonban-d1.sql

npx wrangler d1 execute mihonban --remote \
  --file ../../backups/mihonban-d1.sql
```

默认是按主键 UPSERT 的合并模式，源端没有的目标行会保留；如果同一路径已对应另一个 ID，会明确失败而不是静默删除。对空目标来说就是完整源曲库。`--replace` 会先清空本次包含的曲库表，只能在目标备份后使用。

`--include-config` 会把 `settings` 和 `storages` 也写进 SQL，但文件会含密钥。推荐仍使用单独的管理后台 JSON。

## 4. 恢复设置和 secrets

1. 新主 Worker 配置新的 `APP_PASSWORD`、`ADMIN_PASSWORD`、`SESSION_SECRET`、`COMPANION_KEY`。
2. 用新管理员口令登录。
3. 管理 → 设置备份 → 导入旧 JSON。
4. 逐个测试存储和 R2。
5. 使用外部音源代理时，主 Worker 设置 `STREAM_PROXY_SECRET`，代理 Worker 设置相同值为 `PROXY_SECRET`。

设置 JSON 故意不恢复口令哈希和旧会话。

## 5. 核对

```bash
npx wrangler d1 execute mihonban --remote --command \
  "SELECT COUNT(*) AS albums FROM albums"
npx wrangler d1 execute mihonban --remote --command \
  "SELECT COUNT(*) AS tracks FROM tracks"
npx wrangler d1 execute mihonban --remote --command \
  "SELECT COUNT(*) AS artists FROM artists"
```

网页继续检查：

- 专辑、曲目、艺人、收藏、备注、隐藏状态和排序。
- 每个存储后端至少播一首，并拖动进度。
- 封面、艺人头像、内页图。
- 听众无法看到隐藏资源。
- 新站能再次导出设置 JSON。
- 未迁移 R2 索引时重新预热。

## 6. 切换与回滚

验收通过后才修改本机 `[cloud].url`。保留旧数据库、旧部署、SQL、设置 JSON 和源音频，直到新站完成一次真实恢复演练。

回滚可以把 URL 指回旧站，或把导入前的远端 SQL 恢复到干净 D1。数据库切换期间绝不能删除唯一音频副本。

## Cloudflare 项目之间迁移

旧项目直接 `wrangler d1 export --remote`，新项目应用 schema 后导入。仍保持三层分离：D1 SQL 迁曲库、设置 JSON 迁配置、Worker secrets 单独设置。
