-- mihonban cloud D1 schema（幂等，可重复执行）
CREATE TABLE IF NOT EXISTS albums (
  id          TEXT PRIMARY KEY,          -- sha1(folder NFC)[:16]，本地伴侣与 Worker 算法一致
  artist      TEXT NOT NULL,
  artist_sort TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL,
  year        INTEGER,
  folder      TEXT NOT NULL UNIQUE,      -- 存储相对路径（正斜杠，NFC）
  cover_path  TEXT NOT NULL DEFAULT '',  -- 封面文件路径（懒解析）
  rym_rating  REAL,
  rym_votes   INTEGER,
  rym_rank    TEXT NOT NULL DEFAULT '',
  rym_url     TEXT NOT NULL DEFAULT '',
  genres      TEXT NOT NULL DEFAULT '[]',  -- JSON 数组，primary 在前
  sec_genres  TEXT NOT NULL DEFAULT '[]',
  descriptors TEXT NOT NULL DEFAULT '[]',
  storage_id  TEXT NOT NULL,             -- 所属命名存储后端
  hidden      INTEGER NOT NULL DEFAULT 0, -- 1 = 曲库列表隐藏（管理员仍可 includeHidden）
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id       TEXT PRIMARY KEY,             -- sha1(path NFC)[:16]
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  disc     INTEGER NOT NULL DEFAULT 1,
  track    INTEGER,
  title    TEXT NOT NULL,
  duration REAL,
  format   TEXT NOT NULL DEFAULT '',
  bitrate  INTEGER,
  size     INTEGER,
  path     TEXT NOT NULL UNIQUE          -- 存储相对路径
);

CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id, disc, track);

-- 大型专辑登记的临时写入区。曲目先分批落到这里，最后用一个 D1 batch
-- 原子替换正式目录，避免中途失败留下半张专辑。
CREATE TABLE IF NOT EXISTS track_imports (
  import_id  TEXT NOT NULL,
  id         TEXT NOT NULL,
  album_id   TEXT NOT NULL,
  disc       INTEGER NOT NULL DEFAULT 1,
  track      INTEGER,
  title      TEXT NOT NULL,
  duration   REAL,
  format     TEXT NOT NULL DEFAULT '',
  bitrate    INTEGER,
  size       INTEGER,
  path       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (import_id, id),
  UNIQUE (import_id, path)
);

CREATE INDEX IF NOT EXISTS idx_track_imports_created
  ON track_imports(created_at);

-- 运行时设置（密码哈希、资源站配置、伴侣心跳等），后台可改、无需重新部署
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- 资源站新帖（扫描器只记录标题和链接，不下载任何文件）
CREATE TABLE IF NOT EXISTS source_posts (
  id         TEXT PRIMARY KEY,          -- sha1(url)[:16]
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  published  TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'new',  -- new | done | ignored
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON source_posts(status, published DESC);

-- 收藏（管理员标记；普通用户只读）
CREATE TABLE IF NOT EXISTS favorites (
  kind       TEXT NOT NULL,             -- 'album' | 'track'
  item_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sort_order INTEGER,                   -- 手动拖动的自定义顺序（NULL = 用 -created_at 兜底，最近在前）
  PRIMARY KEY (kind, item_id)
);

-- 艺术家附加信息（头像等；name 与 albums.artist 精确匹配）
CREATE TABLE IF NOT EXISTS artists (
  name        TEXT PRIMARY KEY,
  avatar_path TEXT NOT NULL DEFAULT '', -- 存储相对路径
  storage_id  TEXT                      -- 有头像时记录其命名存储后端
);

-- 专辑内页/写真等附加图片（管理员上传，存 OneDrive，专辑删除时级联）
CREATE TABLE IF NOT EXISTS album_images (
  id         TEXT PRIMARY KEY,          -- sha1(path)[:16]
  album_id   TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  path       TEXT NOT NULL UNIQUE,      -- 存储相对路径
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_images_album ON album_images(album_id, sort, created_at);

-- R2 图床镜像索引：cache_key（如 art:<albumId>:480）→ 已上传的 R2 对象 key。
-- 命中即 302 到公开 CDN，图片字节不过 Worker、不打 OneDrive Graph API。
CREATE TABLE IF NOT EXISTS r2_cache (
  cache_key  TEXT PRIMARY KEY,   -- 逻辑键：art:<id>:<size> / img:<id>:<size> / artist:<name>:<size>
  r2_key     TEXT NOT NULL,      -- R2 对象 key
  created_at INTEGER NOT NULL
);

-- 存储后端（可多个共存：OneDrive / WebDAV / Google Drive / 本地文件夹）。
-- config 是各后端的 JSON 凭据。albums.storage_id 必须引用一个命名后端。
CREATE TABLE IF NOT EXISTS storages (
  id         TEXT PRIMARY KEY,          -- 短 id
  name       TEXT NOT NULL,             -- 展示名
  kind       TEXT NOT NULL,             -- 'onedrive' | 'webdav' | 'gdrive' | 'local'
  config     TEXT NOT NULL DEFAULT '{}',-- JSON 凭据
  is_write   INTEGER NOT NULL DEFAULT 0,-- 是否为当前主写入目标（新上传落此后端；仅一个为 1）
  created_at INTEGER NOT NULL
);

-- 简介（管理员编辑；kind='artist' 时 id 为艺术家名，'album' 时为专辑 id）
CREATE TABLE IF NOT EXISTS notes (
  kind       TEXT NOT NULL,
  id         TEXT NOT NULL,
  text       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
