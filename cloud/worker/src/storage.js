// Storage dispatcher: route operations by album.storage_id to a concrete backend.
//
// storage_id must reference a named backend in the storages table; all types use
// the same model:
//   'onedrive' -> graph.js explicit-config variants for a multi-account pool
//   'webdav'   → webdav.js
//   'gdrive'   -> gdrive.js (Drive API v3, resolving paths by folder name)
//   'local'    -> env.LOCAL_FS (injected by Node; Workers have no filesystem)
//
// Shared interface: downloadUrl / getFile / thumbnailUrl / listChildren /
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

/** Clear a temporary OneDrive download URL so the next request fetches a fresh
 *  Graph URL after an origin 401/403/5xx. */
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

/** Return a direct audio/image URL when supported, or null to make the caller
 *  proxy through the Worker. */
export async function downloadUrl(env, path, storageId) {
  const s = await requireStorage(env, storageId);
  if (s.kind === "onedrive") return graph.downloadUrlWith(env, s.config, path);
  if (s.kind === "webdav") return webdav.downloadUrl();
  if (s.kind === "gdrive") return gdrive.downloadUrl();
  if (s.kind === "local") return null;
  return null;
}

/** Read file bytes for Worker proxying. Return a Response or null. */
export async function getFile(env, path, storageId, range) {
  const s = await requireStorage(env, storageId);
  if (s.kind === "onedrive") {
    // OneDrive normally has direct URLs, so proxying is uncommon; obtain one and fetch it here.
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
  return null; // WebDAV, Google Drive, and local storage have no generic server thumbnail.
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

/** Return the exact byte length of a stored file, or null when it is absent. */
export async function fileSize(env, path, storageId) {
  const parts = String(path || "").replace(/^\/+|\/+$/g, "").split("/");
  const name = parts.pop();
  if (!name) return null;
  const folder = parts.join("/");
  const children = await listChildren(env, folder, storageId, { strict: true });
  const normalizedName = name.normalize("NFC");
  const matches = children.filter((item) => item?.file
    && String(item.name || "").normalize("NFC") === normalizedName);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`storage returned duplicate file names: ${path}`);
  }
  const size = Number(matches[0].size);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`storage returned an invalid file size: ${path}`);
  }
  return size;
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

/** Test connectivity while configuring a backend in Admin. */
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
