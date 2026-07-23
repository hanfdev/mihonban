# 安全发布代码到 GitHub

仓库只应包含源码、测试、文档和安全模板。音频、手存 RYM 页面、数据库、备份和凭据必须留在私有位置。

## 推送前检查

```bash
git status --short
git diff --check
git grep -n -I -i -E "refresh[_-]?token|client[_-]?secret|access[_-]?key|proxy[_-]?secret" -- .
```

逐条人工判断：变量名和模板正常，真实值不正常。

绝不能跟踪：

- `.dev.vars`、`.env`、`mihonban.toml`、`rclone.conf`
- `backups/`、`*.sqlite`、`*.db`、管理后台设置 JSON
- 音频、私人曲库封面、RYM HTML 存档
- Cloudflare、Azure、Google、WebDAV、Discogs、R2 凭据

首次公开前建议用 Gitleaks 等工具扫描完整 Git 历史。

公开历史前也要检查提交者身份：

```bash
git log --all --format='%an <%ae>' | sort -u
```

本仓库采用 `AGPL-3.0-only`。发布或再分发项目时必须保留根目录中的 `LICENSE` 文件。

## 验证仓库

```bash
python -m pytest -q
cd cloud/worker && npm ci && npm test && npx wrangler deploy --dry-run
cd ../proxy-worker && npm ci && npm test && npx wrangler deploy --dry-run
cd ../web && npm ci && npm run build
```

不要为了 CI 把 `dist`、`.wrangler`、`node_modules`、数据库或备份 SQL 加进 Git。

## 创建远端

```bash
gh auth login
gh repo create mihonban --private --source=. --remote=origin --push
```

也可在 GitHub 创建空仓库后手动添加：

```bash
git remote add origin git@github.com:<你>/mihonban.git
git push -u origin HEAD
```

默认建议 Private。公开前检查所有内置资源许可，并明确仓库不分发音乐。

## CI 密钥

- 构建和单元测试不需要生产密钥。
- 不要让不受信任的 PR 触发部署。
- 部署使用 GitHub Environment 和最小权限 Cloudflare token。
- OneDrive/R2 凭据绝不能进入前端构建变量。

## 发布清单

- 文档链接都能解析。
- 全新 clone 可用 `npm ci` 和 `pip install -e ./pipeline` 安装。
- D1 迁移和代理测试通过。
- 文档无机器专属路径或真实服务网址。
- `git status` 没有遗漏的私密配置文件。
- 曾出现在聊天、日志、截图或历史中的生产密钥已经轮换。

## 若密钥已经提交

1. 立即在服务商侧吊销/轮换。
2. 从当前文件删除。
3. 必要时用 `git filter-repo` 或 BFG 清历史。
4. 与协作者协调后再 force-push。
5. 假设所有旧副本都已泄露。

只在后续 commit 删除一行并不能消除泄露。
