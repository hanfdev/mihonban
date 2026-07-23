// 存储调度层：按 album.storage_id 分派到具体后端。
//
// storage_id 必须指向 storages 表中的命名后端，所有类型使用同一套模型：
//   'onedrive' → graph.js 的「带 config」变体（多账号容量池）
//   'webdav'   → webdav.js
//   'gdrive'   → gdrive.js（Drive API v3，路径按文件夹名解析）
//   'local'    → env.LOCAL_FS（Node 部署注入；Worker 无文件系统）
//
// 统一接口：downloadUrl / getFile / thumbnailUrl / listChildren /
//           putSmallFile / deleteItem / createUploadSession

import * as graph from "./graph.js";
import * as webdav from "./webdav.js";
import * as gdrive from "./gdrive.js";

// A Worker isolate can serve more than one DB binding in tests, previews, or
// local tooling. Never let credentials cached for one database bleed into
// another merely because both use the same storage id.
let cacheByDb = new WeakMap(); // DB binding -> Map(storageId, {kind, config})

function cacheFor(env) {
  let cache = cacheByDb.get(env.DB);
  if (!cache) {
    cache = new Map();
    cacheByDb.set(env.DB, cache);
  }
  return cache;
}

export async function loadStorage(env, storageId) {
  if (!storageId) throw new Error("storage backend id is required");
  const cache = cacheFor(env);
  if (cache.has(storageId)) return cache.get(storageId);
  const row = await env.DB.prepare(
    "SELECT kind, config FROM storages WHERE id = ?").bind(storageId).first();
  if (!row) return null;
  let config = {};
  try { config = JSON.parse(row.config || "{}"); } catch { /* ignore */ }
  // The dispatcher id is an in-memory namespace only. Backends may use it to
  // isolate token/path caches; it is never written back into stored config.
  const s = { kind: row.kind, config: { ...config, __storageId: storageId } };
  cache.set(storageId, s);
  return s;
}

async function requireStorage(env, storageId) {
  if (!storageId) throw new Error("storage backend is not assigned");
  const storage = await loadStorage(env, storageId);
  if (!storage) throw new Error(`storage backend not found: ${storageId}`);
  return storage;
}

export function clearStorageCache() { cacheByDb = new WeakMap(); }

/** Drop provider caches after credentials/account/root settings change. */
export async function invalidateCredentialCache(env, storageId, kind, config = {}) {
  const scoped = { ...config, __storageId: storageId };
  if (kind === "onedrive") {
    await graph.resetTokenCacheWith(env, scoped);
  } else if (kind === "gdrive") {
    await gdrive.resetCredentialCache(env, scoped);
  }
}

/** 清除 OneDrive 临时下载直链；源站 401/403/5xx 后下次强制向 Graph 取新链接。 */
export async function invalidateDownloadUrl(env, path, storageId) {
  const s = await requireStorage(env, storageId);
  if (s.kind === "onedrive" && s.config?.driveId) {
    const ns = s.config.__storageId || s.config.driveId;
    await env.KV.delete(`dl:${ns}:${path}`);
    // Remove the pre-named-storage cache key as well when upgrading an old
    // installation; never read it for a named backend.
    await env.KV.delete(`dl:${s.config.driveId}:${path}`);
    await env.KV.delete(`dl:${path}`);
    return true;
  }
  return false;
}

function localFs(env) {
  if (env?.LOCAL_FS) return env.LOCAL_FS;
  return null;
}

function needLocal(env) {
  const fs = localFs(env);
  if (fs) return fs;
  throw new Error("本地存储仅支持 Node 部署（node src/node.js），Cloudflare Worker 无磁盘");
}

/** 音频/图片直链（能直连则返回 URL，否则 null → 上层走 Worker 代理）。 */
export async function downloadUrl(env, path, storageId) {
  const s = await requireStorage(env, storageId);
  if (s.kind === "onedrive") return graph.downloadUrlWith(env, s.config, path);
  if (s.kind === "webdav") return webdav.downloadUrl();
  if (s.kind === "gdrive") return gdrive.downloadUrl();
  if (s.kind === "local") return null;
  return null;
}

/** 读文件字节（Worker 代理用）。返回 Response 或 null。 */
export async function getFile(env, path, storageId, range) {
  const s = await requireStorage(env, storageId);
  if (s.kind === "onedrive") {
    // OneDrive 有直链，代理场景少用；这里取直链再 fetch
    return graph.getFileWith(env, s.config, path, range);
  }
  if (s.kind === "webdav") return webdav.getFile(s.config, path, range);
  if (s.kind === "gdrive") return gdrive.getFile(env, s.config, path, range);
  if (s.kind === "local") return needLocal(env).getFile(s.config, path, range);
  return null;
}

export async function thumbnailUrl(env, path, size, storageId) {
  const s = await requireStorage(env, storageId);
  if (s.kind === "onedrive") return graph.thumbnailUrlWith(env, s.config, path, size);
  return null; // webdav/gdrive/local 无通用服务端缩略图
}

export async function listChildren(env, folder, storageId, options = {}) {
  const strict = options?.strict === true;
  const s = await requireStorage(env, storageId);
  if (s.kind === "onedrive") return graph.listChildrenWith(env, s.config, folder, strict);
  if (s.kind === "webdav") return webdav.listChildren(s.config, folder, strict);
  if (s.kind === "gdrive") return gdrive.listChildren(env, s.config, folder, strict);
  if (s.kind === "local") return needLocal(env).listChildren(s.config, folder, strict);
  return [];
}

export async function putSmallFile(env, path, bytes, contentType, storageId) {
  const s = await requireStorage(env, storageId);
  if (s.kind === "onedrive") return graph.putSmallFileWith(env, s.config, path, bytes, contentType);
  if (s.kind === "webdav") return webdav.putSmallFile(s.config, path, bytes, contentType);
  if (s.kind === "gdrive") return gdrive.putSmallFile(env, s.config, path, bytes, contentType);
  if (s.kind === "local") return needLocal(env).putSmallFile(s.config, path, bytes, contentType);
  return false;
}

/** Direct resumable session for browser chunk uploads. */
export async function createUploadSession(env, path, storageId) {
  const s = await requireStorage(env, storageId);
  if (s.kind === "onedrive") {
    return graph.createUploadSessionWith(env, s.config, path);
  }
  if (s.kind === "gdrive") {
    return gdrive.createUploadSession(env, s.config, path);
  }
  return null;
}

/** Proxy a request stream to a backend without buffering the whole file. */
export async function putFile(env, path, body, contentType, storageId) {
  const s = await requireStorage(env, storageId);
  if (s.kind === "webdav") return webdav.putFile(s.config, path, body, contentType);
  if (s.kind === "local") return needLocal(env).putFile(s.config, path, body, contentType);
  return false;
}

export async function deleteItem(env, path, storageId) {
  const s = await requireStorage(env, storageId);
  if (s.kind === "onedrive") return graph.deleteItemWith(env, s.config, path);
  if (s.kind === "webdav") return webdav.deleteItem(s.config, path);
  if (s.kind === "gdrive") return gdrive.deleteItem(env, s.config, path);
  if (s.kind === "local") return needLocal(env).deleteItem(s.config, path);
  return false;
}

/** 连通性测试（后台配置时用）。 */
export async function testConfig(env, kind, config) {
  if (kind === "onedrive") return graph.testStorageWith(env, config);
  if (kind === "webdav") return webdav.test(config);
  if (kind === "gdrive") return gdrive.test(env, config);
  if (kind === "local") {
    const fs = localFs(env);
    if (!fs) {
      return { ok: false, error: "本地存储仅支持 Node 部署（node src/node.js）" };
    }
    return fs.test(config || {});
  }
  return { ok: false, error: "暂不支持该类型" };
}
