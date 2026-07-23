# 安全发布代码到 GitHub

[English](github-publish.md)

正式公开仓库是 [hanfdev/mihonban](https://github.com/hanfdev/mihonban)。仓库只应包含源码、测试、公开文档和安全模板。

## 绝不能跟踪

- `.dev.vars`、`.env`、`mihonban.toml`、`rclone.conf`、`wrangler.local.jsonc` 或服务商配置
- `backups/`、`*.sqlite`、`*.db`、SQL 导出或管理后台设置 JSON
- 音频、私人封面/内页、手存 RYM 页面或收件箱压缩包
- Cloudflare、Azure、Google、WebDAV、Discogs、R2、代理或伴侣凭据
- `GOAL.local.md` 和其他私有规划/代理笔记
- 生成的 `node_modules`、`.wrangler`、构建产物、日志或临时文件

根目录 `.gitignore` 已覆盖常见位置，但忽略规则不会自动移除已经提交过的文件。

## 每次推送前

```bash
git status --short
git diff --check
git diff --stat
git grep -n -I -i -E "refresh[_-]?token|client[_-]?secret|access[_-]?key|proxy[_-]?secret" -- .
```

逐条人工判断：变量名和脱敏示例正常，真实值不正常。同时检查最近提交者身份：

```bash
git log -5 --format='%h %an <%ae> %s'
```

首次公开或改写历史后，使用 Gitleaks 等专用工具扫描所有 refs。

## 验证仓库

在仓库根目录：

```bash
python -m pytest -q
```

然后分别进入三个 Node package：

```bash
cd cloud/web
npm ci
npm test
npm run build

cd ../worker
npm ci
npm test
npx wrangler deploy --dry-run

cd ../proxy-worker
npm ci
npm test
npx wrangler deploy --dry-run
```

不要为了让 CI 通过而添加被忽略的构建产物、本地 D1、数据库或备份。

## 远端与 Fork

推送前确认目标：

```bash
git remote -v
git branch --show-current
```

正式 origin 是：

```text
https://github.com/hanfdev/mihonban.git
```

个人 fork 应让 `origin` 指向自己的仓库，并把正式仓库保留为 `upstream`：

```bash
git remote add upstream https://github.com/hanfdev/mihonban.git
git fetch upstream
```

不要推送本地恢复分支或被忽略的备份材料。

## CI 与部署密钥

- 构建和单元测试不需要生产密钥。
- 不受信任的 pull request 不能获得部署密钥。
- 部署使用 GitHub Environment 和最小权限 Cloudflare API token。
- 存储和 R2 凭据绝不能进入前端构建变量。
- 曾出现在聊天、日志、截图、CI 输出或 Git 历史中的生产密钥必须轮换。

## 发布清单

- 每份公开文档都有中英文版本，并能互相跳转。
- 全新 clone 可用 `npm ci` 和 `pip install -e ./pipeline` 安装。
- Python、前端、主 Worker、代理 Worker 和 dry-run 检查全部通过。
- 文档没有机器专属路径、私人服务 URL 或凭据。
- 数据库/schema 迁移说明与发布代码一致。
- 仓库不包含私人音乐或未经许可的第三方版权资源。
- `LICENSE` 保留，package metadata 仍声明 `AGPL-3.0-only`。

## 若密钥已经提交

1. 立即在服务商侧吊销或轮换。
2. 从当前文件和部署中删除。
3. 必要时用 `git filter-repo` 或 BFG 改写受影响历史。
4. 与全部协作者协调后再强制推送。
5. 把旧 clone、日志和构建产物都视为已泄露副本。

只在后续 commit 删除该值，并不能从历史中清除它。

## 许可证边界

AGPL 覆盖本仓库的软件，不授予发布音乐、私人曲库图片或第三方元数据的许可。每次发布都必须保持这条边界清晰。
