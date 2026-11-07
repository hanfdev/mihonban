# 浏览器列表回归测试

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

此测试页面挂载实际的 React 列表视图，将当前源码与列表记忆化改动前的 Git 版本 `95eed448dd80ca49de0de2703d1db1f7e78e8e94` 比较，检查排序／筛选结果、播放回调、精选重新排序、查询工作量及歌曲行渲染次数。自该版本以来，“最近添加”的排序规则已按预期调整，因此另有针对当前视图的用例，覆盖 Library、Artists 和 Import 中的首次添加时间、评分／标题编辑、刷新顺序、新导入、相同时间戳、未知日期与隐藏音盘。

从仓库根目录安装 Web 依赖并构建测试页面：

```sh
npm --prefix cloud/web ci
node cloud/web/tools/build-performance-browser.mjs
python -m http.server 8766 --bind 127.0.0.1 --directory backups/web-perf-browser
```

在具有可见视口的桌面浏览器中打开 `http://127.0.0.1:8766`，点击 **Run all tests**。页面会显示各用例及最终通过／失败数量。浏览器自动化可调用 `await window.runPerformanceTests()` 并读取 `window.performanceTestResults`。指针重新排序测试依赖视口命中检测，不支持零尺寸视口。

构建直接从 Git 读取基线文件，无需私有的 `backups/web-perf-baseline` 目录。使用包含固定版本的 Git 历史记录的克隆；完整克隆包含该版本，仅下载源码 ZIP 则不包含。浅克隆应在构建前获取固定版本，或用 `git fetch --unshallow` 获取完整历史：

```sh
git fetch origin 95eed448dd80ca49de0de2703d1db1f7e78e8e94
```

生成文件保存在被忽略的 `backups/web-perf-browser` 目录，其 `manifest.json` 记录基线版本和源码哈希。API 响应和封面使用本地测试数据，页面禁止外部连接，也不会写入真实曲库。这些浏览器检查独立于 `npm test`；测试页面构建成功不代表浏览器用例已通过。
