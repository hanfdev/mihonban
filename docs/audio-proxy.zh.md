# 可选 Cloudflare 音源代理

[English](audio-proxy.md) · [简体中文](audio-proxy.zh.md) · [繁體中文](audio-proxy.zh-Hant.md) · [日本語](audio-proxy.ja.md) · [한국어](audio-proxy.ko.md) · [Français](audio-proxy.fr.md) · [Español](audio-proxy.es.md)

`cloud/proxy-worker` 是独立 Worker，用于中转主 mihonban Worker 取得的临时音频 URL。只有第二条 Worker 路由或自定义域确实改善到存储 CDN 的路径时，它才有价值。

它不缓存音频，也不保证一定更快。部署前后应实际测速。

## 安全模型

- 主 Worker 用 `STREAM_PROXY_SECRET` 对源 URL 和五分钟有效期签名。
- 代理用相同值 `PROXY_SECRET` 校验。
- 只接受 GET、HEAD、OPTIONS。
- 只允许 `ALLOWED_HOSTS` 中的 HTTPS 上游。
- 每一次上游重定向都重新检查白名单。
- 透传 Range 和条件请求头，不转发 cookie/authorization。
- 响应为 private/no-store。

生产环境不要打开无签名模式，也不要配置无限制域名通配符。

## 1. 配置并部署代理

编辑 `cloud/proxy-worker/wrangler.jsonc`：

- `ALLOWED_HOSTS`：逗号分隔的精确域名，或以点开头的子域后缀。
- `ALLOWED_ORIGINS`：主 mihonban 站点 origin；可用 `*`，但指定域名更好。

默认 OneDrive 后缀只是起点。微软可能跳到租户或地区下载域名；遇到失败时只添加实际核对过的后缀。

```bash
cd cloud/proxy-worker
npm ci
npm test
npx wrangler login
npx wrangler secret put PROXY_SECRET
npx wrangler deploy
```

至少使用 32 个随机字符，推荐把 32 个随机字节编码为十六进制字符串。临时保留它，以便给主 Worker 输入完全相同的值。

## 2. 配置主 Worker

```bash
cd ../worker
npx wrangler secret put STREAM_PROXY_SECRET
npx wrangler deploy
```

输入与 `PROXY_SECRET` 完全相同的值。

进入見本盤管理后台的模块设置：

1. 打开音源代理。
2. 自定义代理地址填写：

```text
https://mihonban-audio-proxy.<账号>.workers.dev/?url={url}
```

3. 保存，播放一首 OneDrive 后端歌曲。

主 Worker 会自动追加 `expires` 和 `sig`。不要把共享密钥写在 URL 中。

## 3. 验证

```bash
curl https://mihonban-audio-proxy.<账号>.workers.dev/healthz
```

播放时在浏览器网络面板确认：

- 主 `/api/stream/<id>` 302 到代理。
- 代理返回 200 或 206。
- 拖进度会发送 `Range`，响应包含 `Content-Range`。
- 不带签名的 `?url=...` 返回 401。
- 非白名单域名返回 403。

## 适用范围

外部代理只用于主 Worker 能取得临时下载直链的后端，目前主要是 OneDrive。WebDAV、Google Drive 和 Node 本地目录需要私有凭据，仍由主 Worker 读取。

## 排障

| 状态 | 含义/处理 |
|---|---|
| 401 | 两边密钥不同、签名过期，或主 Worker 未重新部署 |
| 403 | 初始源域名不在白名单 |
| 502 且提示 host | 重定向到了另一域名，核对后再添加后缀 |
| 416 | 上游拒绝 Range |
| 反而更慢 | 清空自定义代理 URL，恢复直链/主 Worker 路径 |

签名值泄露时同时轮换两边 secret。既有签名 URL 最长五分钟失效。
