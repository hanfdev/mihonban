# 原生客户端兼容性约定

[English](API_COMPATIBILITY.md) · [简体中文](API_COMPATIBILITY.zh.md) · [繁體中文](API_COMPATIBILITY.zh-Hant.md) · [日本語](API_COMPATIBILITY.ja.md) · [한국어](API_COMPATIBILITY.ko.md) · [Français](API_COMPATIBILITY.fr.md) · [Español](API_COMPATIBILITY.es.md)

原生客户端与 `cloud/web` 独立。只要下列 API 行为保持兼容，Mihonban 服务器可修改 Web 界面并独立部署。

## 会话与曲库

客户端在请求之间保留会话 Cookie。配置好的访客会话可免密浏览；受保护的部署需要登录。隐藏音盘和共享精选的变更仍受服务器权限限制。

- `GET /api/health` 返回任意成功响应。
- `GET /api/me` 返回当前会话对象。`401` 表示客户端应显示口令登录流程。
- `POST /api/login` 接受 `{ "password": "..." }`，返回 `{ "ok": true, "role": "user|admin" }`。
- `GET /api/library` 返回可见音盘数组。
- `GET /api/tracks` 返回可见曲目数组。
- `GET /api/album/:id` 返回包含 `tracks` 数组的音盘对象。
- `GET /api/artists` 返回艺人资料。
- `GET /api/favorites` 返回包含 `albums` 和 `tracks` 数组的对象，各项均有 `id`。
- `PUT /api/favorites/:kind/:id` 添加共享精选，同一路径的 `DELETE` 删除精选；`kind` 为 `album` 或 `track`。写入需要管理员权限。

授权管理员可对音盘和曲目列表使用 `?hidden=1`。音盘详情还可包含 `note`、`images` 和 `similar`。请求路径中的艺人名称和条目 ID 使用 URL 编码。

## 图片与音频

- `GET /api/art/:albumId?s=480` 返回图片内容。
- `GET /api/image/:id?s=:size` 返回音盘内页图片。
- `GET /api/artist-bio/:name` 返回包含 `bio` 字符串的对象。
- `GET /api/artist-art/:name` 返回艺人图片；自定义头像时客户端添加 `?v=c`。
- `GET /api/stream/:trackId` 返回原始音频字节或可成功访问该音频的重定向。

桌面客户端下载完整音频文件，在本地解码和定位播放，不依赖 Web 播放器的流式布局。图片下载每次响应限制为 32 MiB。精确请求路径和反序列化默认值见 [`src/api.rs`](src/api.rs)。

## 兼容性与客户端更新

客户端忽略未知 JSON 字段，并为数据模型中声明为可选的字段提供默认值。音盘 ID、艺人名称和标题等必填字段必须保持兼容的数据类型；允许新增未知字段并不意味着既有必填字段可以省略。客户端不访问 Mihonban 数据库、存储凭据或部署文件，因此服务器迁移、存储后端和客户端发布可在此 API 约定内独立演进。

客户端发布可使用独立托管的 JSON 清单，包含 `latest`、`download_url`、`sha256` 和 `notes`。发布时应提供 SHA-256 校验值：当前客户端仅在该字段非空时进行校验。下载后准备文件供手动替换 exe，不会自动安装或更新服务器。配置、构建和播放详情见[桌面端指南](README.zh.md)。
