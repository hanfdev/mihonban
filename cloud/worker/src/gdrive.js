// Google Drive storage backend using Drive API v3.
// config: { clientId, clientSecret, refreshToken, rootId }
//   rootId = library root folder ID (use "root" for My Drive; a dedicated
//            "mihonban" folder is recommended)
// Paths are relative to the library root (Music/Library/Artist/Album/track.mp3)
// and resolved one folder name at a time. Folder IDs are cached in KV under
// gdF:driveRoot:path.

import { discardResponse, fetchWithTimeout } from "./net.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
// The library can be an existing folder selected by rootId, not only files
// created by this OAuth client. drive.file would hide those existing files.
const SCOPES = "https://www.googleapis.com/auth/drive";
const enc = new TextEncoder();
const namespacePromises = new WeakMap();
const MAX_LIST_PAGES = 1000;

function httpsUrl(value) {
  if (typeof value !== "string" || !value || value.length > 16_384) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString() : null;
  } catch {
    return null;
  }
}

function driveNode(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.id !== "string" || !value.id
      || value.id.length > 1024) return null;
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : "",
    mimeType: typeof value.mimeType === "string" ? value.mimeType : "",
    size: value.size,
  };
}

/**
 * Isolate cached access tokens and Drive item ids per named backend/account.
 * Multiple Google accounts commonly share one OAuth client id, so clientId
 * alone is not an account identifier and can route reads/writes to the wrong
 * Drive. The refresh token is hashed and never appears in the KV key.
 */
export async function cacheNamespace(conf) {
  if (conf && typeof conf === "object" && namespacePromises.has(conf)) {
    return namespacePromises.get(conf);
  }
  const material = conf?.__storageId
    ? `storage:${conf.__storageId}`
    : `oauth:${conf?.clientId || ""}\n${conf?.refreshToken || ""}`;
  const promise = crypto.subtle.digest("SHA-256", enc.encode(material))
    .then((buf) => [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24));
  if (conf && typeof conf === "object") namespacePromises.set(conf, promise);
  return promise;
}

export async function resetCredentialCache(env, conf) {
  const ns = await cacheNamespace(conf);
  await env.KV.delete(`gdT:${ns}`);
  if (!env.KV.list) return;
  const prefix = `gdF:${ns}:`;
  let cursor = "";
  do {
    const page = await env.KV.list({ prefix, cursor, limit: 1000 });
    await Promise.all((page.keys || []).map((entry) => env.KV.delete(entry.name)));
    cursor = page.list_complete ? "" : (page.cursor || "");
  } while (cursor);
}

async function accessToken(env, conf, force = false) {
  const ck = `gdT:${await cacheNamespace(conf)}`;
  if (!force) {
    const cached = await env.KV.get(ck, "json");
    if (cached && typeof cached.access_token === "string"
        && cached.access_token
        && Number.isFinite(Number(cached.expires_at))
        && cached.expires_at > Date.now() + 60_000) return cached.access_token;
  }
  const body = new URLSearchParams({
    client_id: conf.clientId,
    client_secret: conf.clientSecret,
    grant_type: "refresh_token",
    refresh_token: conf.refreshToken,
  });
  const r = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`Google token 刷新失败: ${r.status} ${await r.text()}`);
  const tok = await r.json();
  const expiresIn = Number(tok?.expires_in);
  if (typeof tok?.access_token !== "string" || !tok.access_token
      || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("Google token response is invalid");
  }
  await env.KV.put(ck, JSON.stringify({
    access_token: tok.access_token,
    expires_at: Date.now() + Math.max(expiresIn - 60, 1) * 1000,
  }));
  return tok.access_token;
}

async function gfetch(env, conf, url, init = {}, retry = true) {
  const tok = await accessToken(env, conf);
  const r = await fetchWithTimeout(url.startsWith("http") ? url : `${DRIVE}${url}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tok}`,
      ...(init.headers || {}),
    },
  });
  if (r.status === 401 && retry) {
    await accessToken(env, conf, true);
    return gfetch(env, conf, url, init, false);
  }
  return r;
}

function rootId(conf) {
  return typeof conf?.rootId === "string" && conf.rootId ? conf.rootId : "root";
}

async function cacheKey(conf, path) {
  return `gdF:${await cacheNamespace(conf)}:${rootId(conf)}:` +
    path.replace(/^\/+|\/+$/g, "");
}

/** Remove a path cache and every cached descendant after deleting a folder. */
export async function invalidatePathCache(env, conf, path) {
  const clean = (path || "").replace(/^\/+|\/+$/g, "");
  const ns = `gdF:${await cacheNamespace(conf)}:${rootId(conf)}:`;
  const exact = `${ns}${clean}`;
  if (!env.KV.list) {
    await env.KV.delete(exact);
    return;
  }
  let cursor = "";
  const doomed = [];
  do {
    const page = await env.KV.list({ prefix: exact, cursor, limit: 1000 });
    const keys = (page.keys || []).map((entry) => entry.name)
      .filter((key) => key === exact || key.startsWith(`${exact}/`));
    doomed.push(...keys);
    cursor = page.list_complete ? "" : (page.cursor || "");
  } while (cursor);
  await Promise.all(doomed.map((key) => env.KV.delete(key)));
}

async function invalidatePathLineage(env, conf, path) {
  const parts = String(path || "").replace(/^\/+|\/+$/g, "").split("/")
    .filter(Boolean);
  const prefixes = [];
  for (let i = 1; i <= parts.length; i += 1) {
    prefixes.push(await cacheKey(conf, parts.slice(0, i).join("/")));
  }
  await Promise.all(prefixes.map((key) => env.KV.delete(key)));
}

/** Find an item by exact filename under parentId; return null when absent. */
async function findChild(env, conf, parentId, name) {
  const escaped = String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = `'${parentId}' in parents and name = '${escaped}' and trashed = false`;
  const u = new URL(`${DRIVE}/files`);
  u.searchParams.set("q", q);
  u.searchParams.set("fields", "files(id,name,mimeType,size)");
  u.searchParams.set("pageSize", "5");
  u.searchParams.set("spaces", "drive");
  const r = await gfetch(env, conf, u.toString());
  if (!r.ok) return null;
  const page = await r.json();
  if (!page || typeof page !== "object" || !Array.isArray(page.files)) {
    throw new Error("Google Drive child lookup response is invalid");
  }
  return page.files.map(driveNode).find(Boolean) || null;
}

/** Resolve a relative path to { id, mimeType, size? }; return null if any folder is missing. */
async function resolvePath(env, conf, path) {
  const clean = (path || "").replace(/^\/+|\/+$/g, "");
  if (!clean) return { id: rootId(conf), mimeType: FOLDER_MIME };

  const ck = await cacheKey(conf, clean);
  const hitRaw = await env.KV.get(ck, "json");
  const hit = driveNode(hitRaw);
  if (hit) return hit;
  if (hitRaw !== null) await env.KV.delete(ck);

  const parts = clean.split("/");
  let parent = rootId(conf);
  let node = { id: parent, mimeType: FOLDER_MIME };
  let acc = "";
  for (const [index, part] of parts.entries()) {
    acc = acc ? `${acc}/${part}` : part;
    const partKey = await cacheKey(conf, acc);
    const cachedRaw = await env.KV.get(partKey, "json");
    const cached = driveNode(cachedRaw);
    if (cached) {
      if (index < parts.length - 1 && cached.mimeType !== FOLDER_MIME) {
        return null;
      }
      node = cached;
      parent = cached.id;
      continue;
    }
    if (cachedRaw !== null) await env.KV.delete(partKey);
    const child = await findChild(env, conf, parent, part);
    if (!child) return null;
    if (index < parts.length - 1 && child.mimeType !== FOLDER_MIME) return null;
    node = { id: child.id, mimeType: child.mimeType, size: child.size };
    parent = child.id;
    await env.KV.put(await cacheKey(conf, acc), JSON.stringify(node), { expirationTtl: 3600 });
  }
  return node;
}

/** Ensure every folder in a path exists and return the final folder ID. */
async function ensureFolderPath(env, conf, folderPath) {
  const clean = (folderPath || "").replace(/^\/+|\/+$/g, "");
  if (!clean) return rootId(conf);
  const parts = clean.split("/");
  let parent = rootId(conf);
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    const partKey = await cacheKey(conf, acc);
    const cachedRaw = await env.KV.get(partKey, "json");
    const cached = driveNode(cachedRaw);
    if (cached?.mimeType === FOLDER_MIME) {
      parent = cached.id;
      continue;
    }
    if (cachedRaw !== null) await env.KV.delete(partKey);
    let child = await findChild(env, conf, parent, part);
    if (child && child.mimeType !== FOLDER_MIME) {
      throw new Error(`Google Drive path component is not a folder: ${part}`);
    }
    if (!child) {
      const r = await gfetch(env, conf, `${DRIVE}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: part,
          mimeType: FOLDER_MIME,
          parents: [parent],
        }),
      });
      if (!r.ok) throw new Error(`创建文件夹失败 ${r.status}: ${await r.text()}`);
      child = driveNode(await r.json());
      if (!child) throw new Error("Google Drive create-folder response is invalid");
    }
    parent = child.id;
    await env.KV.put(await cacheKey(conf, acc),
      JSON.stringify({ id: child.id, mimeType: FOLDER_MIME }),
      { expirationTtl: 3600 });
  }
  return parent;
}

/** No presigned direct URLs; always proxy through the Worker, as with WebDAV. */
export async function downloadUrl() {
  return null;
}

/** Read file bytes with Range support. */
export async function getFile(env, conf, path, range) {
  let node = await resolvePath(env, conf, path);
  if (!node || node.mimeType === FOLDER_MIME) return null;
  const headers = {};
  if (range) headers.Range = range;
  let r = await gfetch(env, conf,
    `${DRIVE}/files/${node.id}?alt=media`, { headers });
  if (r.status === 404) {
    await discardResponse(r);
    await invalidatePathLineage(env, conf, path);
    const fresh = await resolvePath(env, conf, path);
    if (!fresh || fresh.mimeType === FOLDER_MIME) return null;
    node = fresh;
    r = await gfetch(env, conf,
      `${DRIVE}/files/${node.id}?alt=media`, { headers });
  }
  return r.ok || r.status === 206 || r.status === 416 ? r : null;
}

/** Drive has no general thumbnail URL without extra permissions; return null to use the original. */
export async function thumbnailUrl() {
  return null;
}

/** List a directory. */
export async function listChildren(env, conf, folder, strict = false) {
  const node = await resolvePath(env, conf, folder);
  if (!node) {
    if (strict) throw new Error(`Google Drive folder not found: ${folder}`);
    return [];
  }
  const out = [];
  const seenTokens = new Set();
  let pages = 0;
  let pageToken = "";
  do {
    if (++pages > MAX_LIST_PAGES || (pageToken && seenTokens.has(pageToken))) {
      if (strict) throw new Error(`Google Drive list pagination exceeded limit: ${folder}`);
      break;
    }
    if (pageToken) seenTokens.add(pageToken);
    const u = new URL(`${DRIVE}/files`);
    u.searchParams.set("q",
      `'${node.id}' in parents and trashed = false`);
    u.searchParams.set("fields",
      "nextPageToken,files(id,name,mimeType,size)");
    u.searchParams.set("pageSize", "200");
    u.searchParams.set("spaces", "drive");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const r = await gfetch(env, conf, u.toString());
    if (!r.ok) {
      if (strict) throw new Error(`Google Drive list HTTP ${r.status}: ${folder}`);
      break;
    }
    const page = await r.json();
    if (!page || typeof page !== "object" || !Array.isArray(page.files)
        || (page.nextPageToken !== undefined
          && typeof page.nextPageToken !== "string")) {
      if (strict) throw new Error(`Google Drive list response invalid: ${folder}`);
      break;
    }
    for (const raw of page.files) {
      const f = driveNode(raw);
      if (!f) {
        if (strict) throw new Error(`Google Drive list item invalid: ${folder}`);
        continue;
      }
      if (!f.name || f.name.length > 255 || /[\\/\u0000-\u001f]/.test(f.name)
          || f.name === "." || f.name === "..") {
        if (strict) throw new Error(`Google Drive list item name invalid: ${folder}`);
        continue;
      }
      const isDir = f.mimeType === FOLDER_MIME;
      out.push({
        name: f.name,
        size: Number(f.size || 0),
        file: isDir ? null : {},
        folder: isDir ? {} : null,
      });
    }
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return out;
}

/** Upload small and medium files using multipart, suitable for covers and tracks
 *  under 20MB. Larger files work but consume Worker memory. */
export async function putSmallFile(env, conf, path, bytes, contentType) {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  const fileName = parts.pop();
  const parentPath = parts.join("/");
  const parentId = await ensureFolderPath(env, conf, parentPath);

  // Update an existing same-name file; otherwise create one.
  const existing = await findChild(env, conf, parentId, fileName);
  const tok = await accessToken(env, conf);
  const meta = existing
    ? {}
    : { name: fileName, parents: [parentId] };
  const boundary = "mihonban_gd_" + Date.now().toString(36);
  const metaJson = JSON.stringify(meta);
  const prefix = existing
    ? "" // media-only update
    : `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n` +
      `--${boundary}\r\nContent-Type: ${contentType || "application/octet-stream"}\r\n\r\n`;
  const suffix = existing ? "" : `\r\n--${boundary}--`;

  let body, url, headers;
  if (existing) {
    url = `${UPLOAD}/files/${existing.id}?uploadType=media`;
    headers = {
      Authorization: `Bearer ${tok}`,
      "Content-Type": contentType || "application/octet-stream",
    };
    body = bytes;
  } else {
    url = `${UPLOAD}/files?uploadType=multipart`;
    // multipart body: string prefix + binary + string suffix
    const pre = new TextEncoder().encode(prefix);
    const suf = new TextEncoder().encode(suffix);
    const bin = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes);
    const merged = new Uint8Array(pre.length + bin.length + suf.length);
    merged.set(pre, 0);
    merged.set(bin, pre.length);
    merged.set(suf, pre.length + bin.length);
    body = merged;
    headers = {
      Authorization: `Bearer ${tok}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    };
  }
  const r = await fetchWithTimeout(url, { method: existing ? "PATCH" : "POST", headers, body });
  if (!r.ok) return false;
  const file = driveNode(await r.json());
  if (!file) return false;
  // Refresh the path cache.
  await env.KV.put(await cacheKey(conf, path.replace(/^\/+|\/+$/g, "")),
    JSON.stringify({ id: file.id, mimeType: file.mimeType || contentType, size: file.size }),
    { expirationTtl: 3600 });
  return true;
}

/**
 * Browser-direct resumable upload. Google returns a session URL that accepts
 * the same Content-Range chunks used by the OneDrive uploader, so large audio
 * never has to be buffered inside a Worker isolate.
 */
export async function createUploadSession(env, conf, path, contentType) {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  const fileName = parts.pop();
  const parentId = await ensureFolderPath(env, conf, parts.join("/"));
  const existing = await findChild(env, conf, parentId, fileName);
  const url = existing
    ? `${UPLOAD}/files/${existing.id}?uploadType=resumable`
    : `${UPLOAD}/files?uploadType=resumable`;
  const body = existing ? {} : { name: fileName, parents: [parentId] };
  const r = await gfetch(env, conf, url, {
    method: existing ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Upload-Content-Type": contentType || "application/octet-stream",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`Google resumable upload failed: ${r.status} ${await r.text()}`);
  }
  const location = r.headers.get("Location") || r.headers.get("location");
  const uploadUrl = httpsUrl(location);
  if (!uploadUrl) throw new Error("Google did not return a valid upload session URL");
  return uploadUrl;
}

/** Delete a file or folder. */
export async function deleteItem(env, conf, path) {
  let node = await resolvePath(env, conf, path);
  if (!node) return true; // Already absent
  let r = await gfetch(env, conf, `${DRIVE}/files/${node.id}`, { method: "DELETE" });
  if (r.status === 404) {
    await discardResponse(r);
    await invalidatePathLineage(env, conf, path);
    const fresh = await resolvePath(env, conf, path);
    if (!fresh) return true;
    node = fresh;
    r = await gfetch(env, conf, `${DRIVE}/files/${node.id}`, { method: "DELETE" });
  }
  if (r.ok || r.status === 204 || r.status === 404) {
    await invalidatePathCache(env, conf, path);
  }
  return r.ok || r.status === 204 || r.status === 404;
}

/** Test connectivity. */
export async function test(env, conf) {
  try {
    const tok = await accessToken(env, conf, true);
    const r = await fetchWithTimeout(
      `${DRIVE}/files/${rootId(conf)}?fields=id,name,mimeType`,
      { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) {
      if (r.status === 401) return { ok: false, error: "凭证无效（检查 client/secret/refresh）" };
      if (r.status === 404) return { ok: false, error: "rootId 文件夹不存在" };
      return { ok: false, error: `Drive HTTP ${r.status}` };
    }
    const d = await r.json();
    // Read quota information from about.
    const about = await fetchWithTimeout(`${DRIVE}/about?fields=user,storageQuota`,
      { headers: { Authorization: `Bearer ${tok}` } });
    let used = 0, total = 0, owner = d.name || "";
    if (about.ok) {
      const a = await about.json();
      owner = a.user?.emailAddress || owner;
      used = Number(a.storageQuota?.usage || 0);
      total = Number(a.storageQuota?.limit || 0);
    }
    return { ok: true, owner, used, total };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** Generate an OAuth authorization URL for the user to obtain a code in the browser. */
export function authUrl(clientId, redirectUri = "http://localhost") {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  return u.toString();
}

/** Exchange an authorization code for a refresh_token. */
export async function exchangeCode(clientId, clientSecret, code,
  redirectUri = "http://localhost") {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const r = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`换 token 失败 ${r.status}: ${await r.text()}`);
  return r.json(); // { access_token, refresh_token, expires_in, ... }
}
