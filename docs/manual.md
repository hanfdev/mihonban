# 日常使用手册

本文面向曲库管理员。路径和网址都以你自己的配置为准。

## 三个入口

| 入口 | 用途 |
|---|---|
| 見本盤网页 | 浏览、播放、收藏、导入和管理 |
| 本机收件箱 | 放入 RAR/ZIP/7z 或专辑文件夹，交给 Python 管线整理 |
| 本机命令行 | 同步、拉回、修复和诊断 |

本机桌面播放器不是云端播放的依赖；云端播放完全由 Worker 和配置的音源存储完成。

## 身份

- 听众口令：浏览与播放。
- 管理员口令：上传、编辑、隐藏、删除、收藏和后台设置。
- 访客模式：管理员显式打开后，陌生访问者可以只读浏览。

管理员口令不要分享。改管理员口令后，旧登录会话会失效。

## 常见工作流

### 收件箱压缩包或文件夹

1. 准备你有权使用的压缩包或专辑文件夹。
2. 放入配置的 `inbox`。
3. `mihonban watch` 自动处理，或手动运行 `mihonban ingest --apply`。
4. 检查隔离区和日志；失败不会静默丢弃。
5. 配置云同步后，运行 `mihonban cloud sync`。

支持单层压缩、压缩包内再嵌套压缩包，以及直接放入文件夹。守望者会连续三次确认文件大小或目录树没有变化，避免读取复制到一半的内容。管线在私有工作区处理副本；成功后原始收件项进入 `_done`，硬失败则连同原因进入 `_quarantine`。

管线负责解压、日文编码修复、标签匹配、规范目录和云端登记。自动匹配不可靠的项目进入人工复核。

### Cloudflare 与本机守望

管理后台里的资源站扫描可以由 Cloudflare Cron 定时运行，只读取 RSS/Atom/Blogger 的标题和链接。`mihonban watch` 不能运行在 Cloudflare Workers：Worker 看不到电脑上的 `inbox`，没有持久本机文件系统，也不适合运行 7-Zip、beets 和批量改标签。

因此网页播放和资源站提醒可以完全云托管；收件箱自动整理需要在能访问该目录的 Windows、macOS、Linux 或 NAS 上运行本机 Python 伴侣。它不必为了在线播放而常开，只需在接收和整理新音源时运行；启动后会继续同步到云端。

### 网页导入散装音频

1. 管理员进入“导入”。
2. 选择同一张专辑的音频，核对艺人、专辑、年份和曲目。
3. 选择封面并上传。
4. 上传完成后打开专辑抽查播放。
5. 需要本机副本时运行 `mihonban cloud pull`；`--retag` 可按云端信息补齐已有文件标签。

### RYM 元数据

1. 浏览器手动保存对应发行页 HTML。
2. 在专辑页导入该 HTML，确认评分、票数、genre 和 descriptor。
3. 不要使用自动抓取脚本访问 RYM。

### Discogs

管理员可搜索发行或艺人，预览后导入图片、风格和简介。Discogs token 在管理后台设置，只使用官方 API。

### 收藏和隐藏

- 管理员可收藏专辑或歌曲并拖动排序。
- 听众只能查看收藏。
- 隐藏专辑不会出现在听众的曲库、搜索、收藏、图片或艺人资料接口中。

### 多存储

- “写入目标”只影响之后的新上传。
- 已有专辑继续从自己的 `storage_id` 读取。
- 迁移会复制文件并改绑定，不删除源文件。
- 大批量迁移后先抽查播放、封面、头像和内页，再手工处理旧副本。

## 管理后台

- 系统概览：专辑、曲目和伴侣状态。
- 口令与访客访问。
- 设置备份：迁移凭据和后端配置，不包含曲库数据。
- 存储后端与写入目标。
- R2 配置和预热。
- Discogs token。
- 可选模块：资源站提醒、音源代理。

设置备份 JSON 含敏感凭据，应放入加密保险库；不要发送到聊天、邮件或 Git。

## 推荐备份节奏

| 频率 | 动作 |
|---|---|
| 每次重大导入后 | 导出 D1 SQL；确认音频已有第二份副本 |
| 每次改存储/R2 后 | 下载新的管理后台设置 JSON |
| 每次部署升级前 | 远端 D1 导出 + 设置 JSON + 记录当前 Worker 版本 |
| 定期 | 抽查备份能否恢复，而不只是“文件存在” |

详见 [database-migration.zh.md](database-migration.zh.md)。

## 常用命令

```text
mihonban doctor
mihonban ingest --apply
mihonban watch
mihonban cloud sync
mihonban cloud pull
mihonban cloud pull --retag
mihonban rym parse
mihonban rym match
mihonban rym write --apply

cd cloud/worker && npm test
cd cloud/web && npm run build
```

## 排障

| 现象 | 处理 |
|---|---|
| 收件箱没反应 | 确认输入是 RAR/ZIP/7z 或非隐藏文件夹、内容已复制完成，且 `mihonban watch` 只有一个实例；查看 `data_dir/logs` |
| 文件进入隔离区 | 阅读同目录报告，检查损坏、密码和匹配置信度 |
| 网页无旧专辑 | 检查是否只恢复了设置 JSON；专辑需要 D1 SQL |
| 播放 502 | 后台测试对应存储；确认路径没有被手工移动 |
| 拖进度条失败 | 检查上游和代理是否正确返回 206/Content-Range |
| 图片慢或 Graph 限流 | 启用 R2，测试后预热 |
| Google Drive 找不到旧文件 | 重新授权当前 Drive 权限，并核对 root ID |
| 网页上传未回到本机 | 运行 `mihonban cloud pull`，检查 rclone remote |
| 登录 429 | 等待 15 分钟并停止重复尝试 |
| 本机 HTTP 登录不保持 | 本地 `.dev.vars` 设置 `DEV_INSECURE_COOKIE=1` |
