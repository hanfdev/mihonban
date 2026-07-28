// API 客户端：同源 fetch + cookie 会话；401 统一抛出触发登录界面。

import * as discogsDirect from './discogs-api.js'

class AuthError extends Error {}

async function req(method, url, body, raw = false) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) {
      init.body = body;
    } else {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
  }
  const r = await fetch(url, init);
  if (r.status === 401) throw new AuthError("unauthorized");
  if (raw) {
    if (!r.ok) {
      const problem = await r.clone().json().catch(() => ({}));
      const error = new Error(problem.error || `${r.status}`);
      error.status = r.status;
      throw error;
    }
    return r;
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(data.error || `${r.status}`);
    error.status = r.status;
    throw error;
  }
  return data;
}

const discogsFirst = async (direct, server) => {
  try { return await direct() }
  catch (directError) {
    try { return await server() }
    catch (serverError) {
      if (/Discogs (?:429|5\d\d)/.test(serverError.message)) throw directError
      throw serverError
    }
  }
}

// getSettingsShared 的 in-flight/结果缓存（写入或失败即失效）
let settingsShared = null;

export const api = {
  AuthError,
  login: (password) => req("POST", "/api/login", { password }),
  logout: () => req("POST", "/api/logout"),
  me: () => req("GET", "/api/me"),
  library: (opts = {}) =>
    req("GET", `/api/library${opts.hidden ? "?hidden=1" : ""}`),
  album: (id) => req("GET", `/api/album/${id}`),
  tracks: (opts = {}) =>
    req("GET", `/api/tracks${opts.hidden ? "?hidden=1" : ""}`),
  patchAlbum: (id, fields) => req("PATCH", `/api/album/${id}`, fields),
  deleteAlbum: (id, files) =>
    req("DELETE", `/api/album/${id}${files ? "?files=1" : ""}`),
  hideAlbum: (id, hidden) =>
    req("POST", `/api/album/${id}/hide`, { hidden: !!hidden }),
  postRym: (id, data) => req("POST", `/api/album/${id}/rym`, data),
  discogsSearch: (id, album) => discogsFirst(
    () => discogsDirect.releaseSearch(album),
    () => req("POST", `/api/album/${id}/discogs-search`)),
  discogsLookup: (url) => discogsFirst(
    () => discogsDirect.releaseLookup(url),
    () => req("POST", "/api/discogs-lookup", { url })),
  discogsImageList: (id, ref) =>
    discogsFirst(() => discogsDirect.releaseImages(ref),
      () => req("POST", `/api/album/${id}/discogs-image-list`, { ref })),
  discogsImageSource: async (id, ref, uri) => {
    const response = await req(
      "POST", `/api/album/${id}/discogs-image-source`, { ref, uri }, true);
    return response.blob();
  },
  discogsImportImages: (id, ref, images, asCover) =>
    req("POST", `/api/album/${id}/discogs-import-images`, { ref, images, asCover }),
  artistDiscogsSearch: (name) => discogsFirst(
    () => discogsDirect.artistSearch(name),
    () => req("POST", "/api/artist-discogs-search", { name })),
  artistDiscogsDetail: (artistId) => discogsFirst(
    () => discogsDirect.artistDetail(artistId),
    () => req("POST", "/api/artist-discogs-detail", { artistId })),
  artistDiscogsImport: (name, payload) =>
    req("POST", `/api/artists/${encodeURIComponent(name)}/discogs-import`, payload),
  registerAlbum: (payload) => req("POST", "/api/albums", payload),
  scanFolder: (folder, extra = {}) =>
    req("POST", "/api/scan", { folder, ...extra }),
  uploadSession: (path) => req("POST", "/api/upload/session", { path }),
  uploadCover: (path, blob) =>
    req("POST", `/api/upload/cover?path=${encodeURIComponent(path)}`, blob),
  // 收藏（管理员写，所有人读）
  favorites: () => req("GET", "/api/favorites"),
  addFavorite: (kind, id) => req("PUT", `/api/favorites/${kind}/${id}`),
  removeFavorite: (kind, id) => req("DELETE", `/api/favorites/${kind}/${id}`),
  reorderFavorites: (kind, ids) => req("PUT", `/api/favorites/${kind}/reorder`, { ids }),
  // 艺术家
  artists: (opts = {}) =>
    req("GET", `/api/artists${opts.hidden ? "?hidden=1" : ""}`),
  artistBio: (name) =>
    req("GET", `/api/artist-bio/${encodeURIComponent(name)}`),
  putArtist: (name, fields = {}) =>
    req("PUT", "/api/artists", { name, ...fields }),
  // 专辑内页图片
  addAlbumImage: (albumId, path) =>
    req("POST", `/api/album/${albumId}/images`, { path }),
  deleteAlbumImage: (albumId, imgId, file) =>
    req("DELETE", `/api/album/${albumId}/images/${imgId}${file ? "?file=1" : ""}`),
  reorderAlbumImages: (albumId, ids) =>
    req("PUT", `/api/album/${albumId}/images/reorder`, { ids }),
  // 专辑内曲目管理
  addTrack: (albumId, payload) =>
    req("POST", `/api/album/${albumId}/tracks`, payload),
  patchTrack: (albumId, trackId, fields) =>
    req("PATCH", `/api/album/${albumId}/tracks/${trackId}`, fields),
  deleteTrack: (albumId, trackId, file) =>
    req("DELETE", `/api/album/${albumId}/tracks/${trackId}${file ? "?file=1" : ""}`),
  orderTracks: (albumId, ids) =>
    req("PUT", `/api/album/${albumId}/tracks/order`, { ids }),
  // admin
  adminOverview: () => req("GET", "/api/admin/overview"),
  changePassword: (target, current, next) =>
    req("POST", "/api/admin/password", { target, current, next }),
  getSettings: () => req("GET", "/api/admin/settings"),
  // 后台页四个卡片挂载时各自要读设置：共享同一个 in-flight 请求，
  // 一次网络往返喂所有卡片。写入或失败后失效，下次重新拉取。
  getSettingsShared: () => {
    if (!settingsShared) {
      settingsShared = req("GET", "/api/admin/settings")
        .catch((e) => { settingsShared = null; throw e; });
    }
    return settingsShared;
  },
  putSettings: (s) => {
    // PUT 前后都失效：请求在途时若有挂载点缓存了写前快照，完成后也会被清掉
    settingsShared = null;
    return req("PUT", "/api/admin/settings", s)
      .finally(() => { settingsShared = null; });
  },
  scanSource: (deep) => req("POST", "/api/admin/source/scan", { deep: !!deep }),
  sourcePosts: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== "" && v != null));
    return req("GET", `/api/admin/source/posts?${qs}`);
  },
  setPostStatus: (id, status) =>
    req("POST", `/api/admin/source/posts/${id}`, { status }),
  getR2: () => req("GET", "/api/admin/r2"),
  putR2: (s) => req("PUT", "/api/admin/r2", s),
  testR2: () => req("POST", "/api/admin/r2/test"),
  prewarmR2: (offset, limit) =>
    req("POST", "/api/admin/r2/prewarm", { offset, limit }),
  // 多存储后端
  listStorages: () => req("GET", "/api/admin/storages"),
  addStorage: (s) => req("POST", "/api/admin/storages", s),
  putStorageBackend: (id, s) => req("PUT", `/api/admin/storages/${id}`, s),
  deleteStorageBackend: (id) => req("DELETE", `/api/admin/storages/${id}`),
  testStorageBackend: (payload) => req("POST", "/api/admin/storages/test", payload),
  setWriteTarget: (id) => req("PUT", "/api/admin/storages/write-target", { id }),
  migrateAlbum: (albumId, targetId, fileIndex = 0) =>
    req("POST", "/api/admin/storages/migrate", { albumId, targetId, fileIndex }),
  migrateAll: (targetId, albumOffset = 0, fileIndex = 0) =>
    req("POST", "/api/admin/storages/migrate-all",
      { targetId, albumOffset, fileIndex }),
  gdriveAuthUrl: (clientId, redirectUri) =>
    req("POST", "/api/admin/storages/gdrive-auth-url", { clientId, redirectUri }),
  gdriveExchange: (payload) =>
    req("POST", "/api/admin/storages/gdrive-exchange", payload),
  // 配置导出 / 导入（重新部署后还原 OneDrive / R2 / 存储后端）
  exportConfig: () => req("GET", "/api/admin/config/export"),
  importConfig: (payload) => {
    // 导入会覆盖后台设置。前后都清缓存，避免在途的旧 settings 请求在
    // 导入完成后重新把旧快照放回共享缓存。
    settingsShared = null;
    return req("POST", "/api/admin/config/import", payload)
      .finally(() => { settingsShared = null; });
  },
};

export const artUrl = (albumId, s = 400, origin = false) =>
  `/api/art/${albumId}?s=${s}${origin ? '&proxy=1&fallback=1' : ''}`;
export const streamUrl = (trackId) => `/api/stream/${trackId}`;
export const imgUrl = (imgId, s = 0) =>
  s ? `/api/image/${imgId}?s=${s}` : `/api/image/${imgId}`;
export const artistArtUrl = (name, v = 0) => {
  const q = new URLSearchParams();
  // v 可以是数字（会话内 bump）或 'c'（有自定义头像，刷新后仍能与默认封面区分）
  if (v !== 0 && v !== '' && v != null) q.set('v', String(v));
  const qs = q.toString();
  return `/api/artist-art/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`;
};

const UPLOAD_RETRYABLE = new Set([0, 408, 429, 500, 502, 503, 504]);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function xhrRetryAfter(xhr) {
  const raw = xhr.getResponseHeader("Retry-After");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), 15000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 0), 15000) : null;
}

export function resumableOffset(status, rangeHeader, fallbackEnd, responseText = "") {
  if (status === 308) {
    const match = /bytes=\d+-(\d+)/i.exec(rangeHeader || "");
    return match ? Number(match[1]) + 1 : null;
  }
  if (status === 202 && responseText) {
    try {
      const next = JSON.parse(responseText)?.nextExpectedRanges?.[0];
      const match = /^(\d+)-/.exec(String(next || ""));
      if (match) return Number(match[1]);
    } catch { /* caller falls back to the sent chunk boundary */ }
  }
  return null;
}

function chunkOnce(uploadUrl, blob, start, end, total, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.timeout = 5 * 60 * 1000;
    xhr.setRequestHeader("Content-Range", `bytes ${start}-${end - 1}/${total}`);
    xhr.upload.onprogress = (e) => onProgress && onProgress(start + e.loaded);
    xhr.onload = () => {
      // Google Drive resumable sessions acknowledge non-final chunks with
      // 308 + Range, while Microsoft Graph uses 202. Both mean "continue".
      if (xhr.status === 308) {
        const resumeAt = resumableOffset(
          xhr.status, xhr.getResponseHeader("Range"), end, xhr.responseText);
        if (!Number.isFinite(resumeAt)) {
          const error = new Error("上传服务器未确认已接收的字节位置");
          error.status = 422;
          reject(error);
          return;
        }
        resolve({ __status: xhr.status, __resumeAt: resumeAt });
        return;
      }
      if (xhr.status < 300) {
        let result = {};
        try { result = xhr.responseText ? JSON.parse(xhr.responseText) : {}; }
        catch { /* keep empty result */ }
        result.__status = xhr.status;
        const resumeAt = resumableOffset(
          xhr.status, xhr.getResponseHeader("Range"), end, xhr.responseText);
        if (xhr.status === 202 && !Number.isFinite(resumeAt)) {
          const error = new Error("上传服务器未确认已接收的字节位置");
          error.status = 422;
          reject(error);
          return;
        }
        if (resumeAt !== null) result.__resumeAt = resumeAt;
        resolve(result);
        return;
      }
      let detail = "";
      try { detail = JSON.parse(xhr.responseText || "{}").error?.message || ""; }
      catch { detail = String(xhr.responseText || "").slice(0, 160); }
      const error = new Error(`上传失败 HTTP ${xhr.status}${detail ? `：${detail}` : ""}`);
      error.status = xhr.status;
      error.retryAfter = xhrRetryAfter(xhr);
      reject(error);
    };
    xhr.onerror = () => {
      const error = new Error("上传时网络连接中断");
      error.status = 0;
      reject(error);
    };
    xhr.ontimeout = () => {
      const error = new Error("上传超时");
      error.status = 0;
      reject(error);
    };
    xhr.send(blob);
  });
}

async function uploadChunk(uploadUrl, blob, start, end, total, onProgress) {
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await chunkOnce(uploadUrl, blob, start, end, total, onProgress);
    } catch (error) {
      if (!UPLOAD_RETRYABLE.has(error.status) || attempt === attempts - 1) throw error;
      const delay = error.retryAfter ?? Math.min(700 * (2 ** attempt), 6000);
      await wait(delay);
    }
  }
  throw new Error("上传失败");
}

/** 上传音频到当前写入目标：
 *  - OneDrive / Google Drive：resumable session 分片直传
 *  - WebDAV / Local：整文件经 Worker 流式代理 PUT
 *  onProgress(uploadedBytes)。返回最终 item JSON（或 {ok:true}）。 */
export async function uploadFileToOneDrive(path, file, onProgress) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) {
    throw new Error("不能上传空文件");
  }
  const sess = await api.uploadSession(path);
  if (sess.proxy) {
    // WebDAV / Local 无会话后端：整文件流式代理上传（带进度）
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT",
        `/api/upload/proxy?path=${encodeURIComponent(path)}` +
        `&storageId=${encodeURIComponent(sess.storageId || "")}`);
      xhr.timeout = 5 * 60 * 1000;
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) =>
        onProgress && e.lengthComputable && onProgress(e.loaded);
      xhr.onload = () => {
        if (xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText || "{}")); }
          catch { resolve({ ok: true }); }
        } else reject(new Error(`上传失败 HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("网络错误"));
      xhr.ontimeout = () => reject(new Error("上传超时"));
      xhr.send(file);
    });
  }
  const { uploadUrl } = sess;
  const CHUNK = 10 * 1024 * 1024; // 10MiB = 320KiB × 32（Graph 要求的对齐）
  let done = 0;
  while (done < file.size) {
    const end = Math.min(done + CHUNK, file.size);
    const blob = file.slice(done, end);
    const result = await uploadChunk(
      uploadUrl, blob, done, end, file.size, onProgress);
    const uploadResult = result && typeof result === "object" ? result : {};
    if ([200, 201].includes(uploadResult.__status) && end < file.size) {
      throw new Error("上传会话过早结束");
    }
    if ("__resumeAt" in uploadResult) {
      if (!Number.isFinite(uploadResult.__resumeAt)
          || uploadResult.__resumeAt <= done || uploadResult.__resumeAt > end) {
        throw new Error("上传进度确认无效");
      }
      done = uploadResult.__resumeAt;
    } else {
      done = end;
    }
    if (done >= file.size) {
      const { __status, __resumeAt, ...item } = uploadResult;
      return item; // 最后一片返回 item 元数据
    }
  }
}
