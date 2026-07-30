-- mihonban cloud D1 schema (idempotent and safe to run repeatedly)
CREATE TABLE IF NOT EXISTS albums (
  id          TEXT PRIMARY KEY,          -- sha1(folder NFC)[:16], matching the companion and Worker algorithm
  artist      TEXT NOT NULL,
  artist_sort TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL,
  year        INTEGER,
  folder      TEXT NOT NULL UNIQUE,      -- storage-relative path (forward slashes, NFC)
  cover_path  TEXT NOT NULL DEFAULT '',  -- cover path (resolved lazily)
  rym_rating  REAL,
  rym_votes   INTEGER,
  rym_rank    TEXT NOT NULL DEFAULT '',
  rym_url     TEXT NOT NULL DEFAULT '',
  genres      TEXT NOT NULL DEFAULT '[]',  -- JSON array, primary genres first
  sec_genres  TEXT NOT NULL DEFAULT '[]',
  descriptors TEXT NOT NULL DEFAULT '[]',
  storage_id  TEXT NOT NULL,             -- owning named storage backend
  hidden      INTEGER NOT NULL DEFAULT 0, -- 1 = hidden from library lists (admins may still includeHidden)
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
  path     TEXT NOT NULL UNIQUE          -- storage-relative path
);

CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id, disc, track);
CREATE INDEX IF NOT EXISTS idx_albums_hidden ON albums(hidden);
CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist);

-- Normalized lowercase genre side table: indexed lookup source for same-genre recommendations.
-- ensureMigrations installs synchronization triggers at runtime because
-- wrangler d1 execute --file incorrectly splits BEGIN..END trigger bodies;
-- the first upgrade backfills existing rows.
CREATE TABLE IF NOT EXISTS album_genres (
  album_id TEXT NOT NULL,
  genre    TEXT NOT NULL,
  PRIMARY KEY (genre, album_id)
);

-- Staging area for registering large albums. Tracks arrive here in chunks, then
-- one D1 batch atomically replaces the live catalog so a mid-import failure
-- cannot leave a partially registered album.
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
  artist_mode INTEGER NOT NULL DEFAULT 0, -- 0 = preserve override; 1 = replace
  created_at INTEGER NOT NULL,
  PRIMARY KEY (import_id, id),
  UNIQUE (import_id, path)
);

CREATE INDEX IF NOT EXISTS idx_track_imports_created
  ON track_imports(created_at);

-- Runtime settings (password hashes, source configuration, companion heartbeat, etc.);
-- editable in Admin without redeployment
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- New source posts (the scanner records titles and links only; it downloads no files)
CREATE TABLE IF NOT EXISTS source_posts (
  id         TEXT PRIMARY KEY,          -- sha1(url)[:16]
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  published  TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'new',  -- new | done | ignored
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON source_posts(status, published DESC);

-- Favorites (marked by admins; read-only for regular users)
CREATE TABLE IF NOT EXISTS favorites (
  kind       TEXT NOT NULL,             -- 'album' | 'track'
  item_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sort_order INTEGER,                   -- custom drag order (NULL falls back to -created_at, newest first)
  PRIMARY KEY (kind, item_id)
);

-- Supplemental artist information (avatar, etc.; name is the stable display name)
CREATE TABLE IF NOT EXISTS artists (
  name        TEXT PRIMARY KEY,
  avatar_path TEXT NOT NULL DEFAULT '', -- storage-relative path
  storage_id  TEXT                      -- named storage backend when an avatar exists
);

-- Ordered many-to-many relationship between albums and artists. albums.artist
-- and artist_sort remain display fields for older clients; all artist-scoped
-- business logic treats this table as authoritative.
CREATE TABLE IF NOT EXISTS album_artists (
  album_id   TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  artist     TEXT NOT NULL,
  artist_sort TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (album_id, artist),
  UNIQUE (album_id, position)
);

CREATE INDEX IF NOT EXISTS idx_album_artists_artist
  ON album_artists(artist, album_id);

-- Optional per-track credit override. No rows means inherit album artists.
CREATE TABLE IF NOT EXISTS track_artists (
  track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  artist      TEXT NOT NULL,
  artist_sort TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (track_id, artist),
  UNIQUE (track_id, position)
);

CREATE INDEX IF NOT EXISTS idx_track_artists_artist
  ON track_artists(artist, track_id);

CREATE TABLE IF NOT EXISTS track_artist_imports (
  import_id   TEXT NOT NULL,
  track_id    TEXT NOT NULL,
  artist      TEXT NOT NULL,
  artist_sort TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (import_id, track_id, artist),
  UNIQUE (import_id, track_id, position)
);

-- Shared contributor surface for visibility, avatars, and storage ownership.
-- Album credits win when the same artist also has a per-track credit.
CREATE VIEW IF NOT EXISTS artist_album_links AS
  SELECT album_id, artist, artist_sort FROM album_artists
  UNION ALL
  SELECT t.album_id, ta.artist,
         COALESCE(MIN(NULLIF(TRIM(ta.artist_sort), '')), ta.artist) AS artist_sort
  FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
  WHERE NOT EXISTS (
    SELECT 1 FROM album_artists aa
    WHERE aa.album_id = t.album_id AND aa.artist = ta.artist
  )
  GROUP BY t.album_id, ta.artist;

-- Supplemental album images such as booklet pages and photos (uploaded by admins,
-- stored in OneDrive, and deleted with the album)
CREATE TABLE IF NOT EXISTS album_images (
  id         TEXT PRIMARY KEY,          -- sha1(path)[:16]
  album_id   TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  path       TEXT NOT NULL UNIQUE,      -- storage-relative path
  source_key TEXT,                      -- stable provider identity for idempotent imports
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_images_album ON album_images(album_id, sort, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_images_album_source
  ON album_images(album_id, source_key)
  WHERE source_key IS NOT NULL AND source_key != '';

-- R2 image-mirror index: cache_key (for example art:<albumId>:480) maps to an
-- uploaded R2 object key. A hit redirects to the public CDN, keeping image bytes
-- out of the Worker and avoiding OneDrive Graph API traffic.
CREATE TABLE IF NOT EXISTS r2_cache (
  cache_key  TEXT PRIMARY KEY,   -- logical key: art:<id>:<size> / img:<id>:<size> / artist:<name>:<size>
  r2_key     TEXT NOT NULL,      -- R2 object key
  created_at INTEGER NOT NULL,
  cache_policy INTEGER NOT NULL DEFAULT 0 -- 1 = immutable browser cache metadata applied
);

-- Storage backends (multiple OneDrive, WebDAV, Google Drive, and local-folder
-- backends may coexist). config holds backend-specific JSON credentials;
-- albums.storage_id must reference a named backend.
CREATE TABLE IF NOT EXISTS storages (
  id         TEXT PRIMARY KEY,          -- short ID
  name       TEXT NOT NULL,             -- display name
  kind       TEXT NOT NULL,             -- 'onedrive' | 'webdav' | 'gdrive' | 'local'
  config     TEXT NOT NULL DEFAULT '{}',-- JSON credentials
  is_write   INTEGER NOT NULL DEFAULT 0,-- current primary write target for new uploads; only one may be 1
  created_at INTEGER NOT NULL
);

-- Descriptions and artist sort names (artistsort uses the artist name as id;
-- see the API for other kinds)
CREATE TABLE IF NOT EXISTS notes (
  kind       TEXT NOT NULL,
  id         TEXT NOT NULL,
  text       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
