// Microsoft Graph client for personal OneDrive: token refresh, direct URLs, and
// upload sessions. Audio bytes never pass through the Worker; playback redirects
// to @microsoft.graph.downloadUrl.

import { discardResponse, fetchWithTimeout } from "./net.js";

const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH = "https://graph.microsoft.com/v1.0";

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

/* ---------- Credentials: Admin settings in the database take priority, with
   deployment environment variables as fallback. Paste updated values in Admin
   when a token expires or the OneDrive account changes; no redeploy is needed. */

async function getSettingRaw(env, k) {
  const row = await env.DB.prepare("SELECT v FROM settings WHERE k = ?")
    .bind(k).first();
  return row ? row.v : null;
}

export async function storageConf(env) {
  const [cid, secret, refresh, drive] = await Promise.all([
    getSettingRaw(env, "ms_client_id"),
    getSettingRaw(env, "ms_client_secret"),
    getSettingRaw(env, "ms_refresh_token"),
    getSettingRaw(env, "ms_drive_id"),
  ]);
  return {
    clientId: cid || env.MS_CLIENT_ID,
    clientSecret: secret || env.MS_CLIENT_SECRET,
    refreshToken: refresh || env.MS_REFRESH_TOKEN,
    driveId: drive || env.MS_DRIVE_ID,
  };
}

/** Get a valid access token using KV caching and automatic refresh; persist a
 *  rotated MSA refresh token back to KV. */
export async function accessToken(env, force = false) {
  if (!force) {
    const cached = await env.KV.get("ms:token", "json");
    if (cached && typeof cached.access_token === "string"
        && cached.access_token
        && Number.isFinite(Number(cached.expires_at))
        && cached.expires_at > Date.now() + 120_000) {
      return cached.access_token;
    }
  }
  const conf = await storageConf(env);
  const stored = await env.KV.get("ms:refresh");
  const refreshToken = stored || conf.refreshToken;
  const body = new URLSearchParams({
    client_id: conf.clientId,
    client_secret: conf.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "Files.ReadWrite.All offline_access",
  });
  const r = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    throw new Error(`token refresh failed: ${r.status} ${await r.text()}`);
  }
  const tok = await r.json();
  const expiresIn = Number(tok?.expires_in);
  if (typeof tok?.access_token !== "string" || !tok.access_token
      || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("token refresh returned an invalid token response");
  }
  await env.KV.put("ms:token", JSON.stringify({
    access_token: tok.access_token,
    expires_at: Date.now() + Math.max(expiresIn - 60, 1) * 1000,
  }));
  if (tok.refresh_token && tok.refresh_token !== refreshToken) {
    await env.KV.put("ms:refresh", tok.refresh_token);
  }
  return tok.access_token;
}

async function gfetch(env, path, init = {}, retry = true) {
  const tok = await accessToken(env);
  const r = await fetchWithTimeout(`${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, ...(init.headers || {}) },
  });
  if (r.status === 401 && retry) {
    await accessToken(env, true);
    return gfetch(env, path, init, false);
  }
  return r;
}

const GRAPH_RETRYABLE = new Set([429, 502, 503, 504]);
const GRAPH_MAX_ATTEMPTS = 5;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(response) {
  const raw = response.headers.get("Retry-After");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.min(Math.max(seconds * 1000, 0), 15_000);
  }
  const at = Date.parse(raw);
  return Number.isFinite(at)
    ? Math.min(Math.max(at - Date.now(), 0), 15_000)
    : null;
}

function retryDelay(response, attempt) {
  const directed = response ? retryAfterMs(response) : null;
  if (directed !== null) return directed;
  const exponential = Math.min(500 * (2 ** attempt), 8_000);
  return exponential + Math.floor(Math.random() * 250);
}

/** Microsoft Graph occasionally returns 429/5xx or drops connections; retry all
 *  upload operations consistently here. */
async function retryGraphRequest(makeRequest, label) {
  let lastError = null;
  for (let attempt = 0; attempt < GRAPH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await makeRequest();
      if (!GRAPH_RETRYABLE.has(response.status)
          || attempt === GRAPH_MAX_ATTEMPTS - 1) {
        return response;
      }
      const delay = retryDelay(response, attempt);
      await discardResponse(response);
      console.warn(`${label}: Graph HTTP ${response.status}; retry ${attempt + 1}/${GRAPH_MAX_ATTEMPTS - 1}`);
      await sleep(delay);
    } catch (error) {
      lastError = error;
      if (attempt === GRAPH_MAX_ATTEMPTS - 1) break;
      console.warn(`${label}: ${String(error?.message || error)}; retry ${attempt + 1}/${GRAPH_MAX_ATTEMPTS - 1}`);
      await sleep(retryDelay(null, attempt));
    }
  }
  throw new Error(`${label}: ${String(lastError?.message || lastError || "network error")}`);
}

/** Read requests also see short Graph brownouts. Keep this retry budget small so
 * playback starts promptly, then let the stream route fall back to /content. */
async function retryGraphRead(makeRequest) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await makeRequest();
      if (!GRAPH_RETRYABLE.has(response.status) || attempt === 2) {
        return response;
      }
      const delay = retryAfterMs(response) ?? (150 * (attempt + 1));
      await discardResponse(response);
      await sleep(Math.min(delay, 600));
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
      await sleep(150 * (attempt + 1));
    }
  }
  throw lastError || new Error("Graph read failed");
}

const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
const MAX_LIST_PAGES = 1000;
function validChild(item) {
  return item && typeof item === "object" && !Array.isArray(item)
    && typeof item.name === "string" && item.name.length > 0
    && item.name.length <= 255
    && !/[\\/\u0000-\u001f]/.test(item.name)
    && item.name !== "." && item.name !== "..";
}
const drivePath = async (env, p) =>
  `/drives/${(await storageConf(env)).driveId}/root:/${enc(p)}`;

/** Clear token caches after credential changes, including any rotated old refresh token. */
export async function resetTokenCache(env) {
  await env.KV.delete("ms:token");
  await env.KV.delete("ms:refresh");
}

/** Test connectivity by forcing a token refresh and reading drive information.
 *  Returns {ok, owner?, used?, total?, error?}. */
export async function testStorage(env) {
  try {
    await resetTokenCache(env);
    await accessToken(env, true);
    const { driveId } = await storageConf(env);
    const r = await gfetch(env, `/drives/${driveId}?select=owner,quota`);
    if (!r.ok) return { ok: false, error: `drive HTTP ${r.status}` };
    const d = await r.json();
    return {
      ok: true,
      owner: d.owner?.user?.displayName || "",
      used: d.quota?.used || 0,
      total: d.quota?.total || 0,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** Temporary file URL from Microsoft's CDN, with Range support and roughly one
 *  hour of validity; cached in KV for 45 minutes. */
export async function downloadUrl(env, path) {
  const key = `dl:${path}`;
  const cached = await env.KV.get(key);
  if (cached) {
    const valid = httpsUrl(cached);
    if (valid) return valid;
    await env.KV.delete(key).catch(() => null);
  }
  const target = `${await drivePath(env, path)}?select=id,size,content.downloadUrl`;
  const r = await retryGraphRead(() => gfetch(env, target));
  if (!r.ok) return null;
  const item = await r.json();
  const url = httpsUrl(item?.["@microsoft.graph.downloadUrl"]);
  if (url) await env.KV.put(key, url, { expirationTtl: 45 * 60 });
  return url || null;
}

/** Authenticated /content fallback. This avoids a separate metadata lookup. */
export async function getFile(env, path, range) {
  const headers = range ? { Range: range } : {};
  const target = `${await drivePath(env, path)}:/content`;
  return retryGraphRead(() => gfetch(env, target, { headers }));
}

/** List an entire directory across all pages. Returns [{name,id,size,file,folder,audio,image}]. */
export async function listChildren(env, folder, strict = false) {
  const out = [];
  const seenLinks = new Set();
  let pages = 0;
  let url = `${await drivePath(env, folder)}:/children` +
    `?$top=200&select=id,name,size,file,folder,audio,image`;
  while (url) {
    if (++pages > MAX_LIST_PAGES || seenLinks.has(url)) {
      if (strict) throw new Error(`Graph list pagination exceeded limit: ${folder}`);
      return out;
    }
    seenLinks.add(url);
    const r = await gfetch(env, url.startsWith("http")
      ? url.slice(GRAPH.length) : url);
    if (!r.ok) {
      if (strict) throw new Error(`Graph list HTTP ${r.status}: ${folder}`);
      return out;
    }
    const page = await r.json();
    if (!page || typeof page !== "object" || !Array.isArray(page.value)) {
      if (strict) throw new Error(`Graph list response invalid: ${folder}`);
      return out;
    }
    for (const item of page.value) {
      if (!validChild(item)) {
        if (strict) throw new Error(`Graph list item invalid: ${folder}`);
        continue;
      }
      out.push(item);
    }
    const next = page["@odata.nextLink"];
    if (next && (typeof next !== "string" || !next.startsWith(`${GRAPH}/`))) {
      if (strict) throw new Error(`Graph list nextLink invalid: ${folder}`);
      return out;
    }
    url = next || null;
  }
  return out;
}

/** OneDrive thumbnail using c-size cropping; return null on failure. */
export async function thumbnailUrl(env, path, size = "c400x400") {
  const r = await gfetch(env,
    `${await drivePath(env, path)}:/thumbnails?select=${size}`);
  if (!r.ok) return null;
  const t = await r.json();
  return httpsUrl(t?.value?.[0]?.[size]?.url);
}

/** Create a large-file upload session. The browser sends chunked PUT requests
 *  directly to uploadUrl because Microsoft supports CORS there. */
export async function createUploadSession(env, path) {
  const target = `${await drivePath(env, path)}:/createUploadSession`;
  const r = await retryGraphRequest(() => gfetch(env, target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      item: { "@microsoft.graph.conflictBehavior": "replace" },
    }),
  }), "create upload session");
  if (!r.ok) {
    throw new Error(`upload session failed: ${r.status} ${await r.text()}`);
  }
  const uploadUrl = httpsUrl((await r.json())?.uploadUrl);
  if (!uploadUrl) throw new Error("upload session returned an invalid URL");
  return uploadUrl;
}

/** Upload small files such as covers under 4MB directly. */
export async function putSmallFile(env, path, bytes, contentType) {
  const target = `${await drivePath(env, path)}:/content`;
  const r = await retryGraphRequest(() => gfetch(env, target, {
    method: "PUT",
    headers: { "Content-Type": contentType || "application/octet-stream" },
    body: bytes,
  }), "upload small file");
  return r.ok;
}

/** Delete a file or directory into the recoverable recycle bin. */
export async function deleteItem(env, path) {
  const r = await gfetch(env, await drivePath(env, path), { method: "DELETE" });
  return r.ok || r.status === 404;
}

/* ---------- Explicit-config variants for a pool of multiple OneDrive accounts ----------
   Each named storage carries {clientId, clientSecret, refreshToken, driveId}.
   Caches are isolated by storage ID, so mounting one drive under different
   credentials cannot mix access tokens. */

const tokenNamespace = (config) => config.__storageId || config.driveId;

async function deleteKvPrefix(env, prefix) {
  if (!env.KV.list) return;
  let cursor = "";
  do {
    const page = await env.KV.list({ prefix, cursor, limit: 1000 });
    await Promise.all((page.keys || []).map((entry) => env.KV.delete(entry.name)));
    cursor = page.list_complete ? "" : (page.cursor || "");
  } while (cursor);
}

export async function resetTokenCacheWith(env, config) {
  const ns = tokenNamespace(config);
  await Promise.all([
    env.KV.delete(`msT:${ns}`), env.KV.delete(`msR:${ns}`),
    // Clear pre-unification keys as well when upgrading an existing install.
    ns === config.driveId ? Promise.resolve() : env.KV.delete(`msT:${config.driveId}`),
    ns === config.driveId ? Promise.resolve() : env.KV.delete(`msR:${config.driveId}`),
    deleteKvPrefix(env, `dl:${ns}:`),
    ns === config.driveId ? Promise.resolve()
      : deleteKvPrefix(env, `dl:${config.driveId}:`),
  ]);
}

async function tokenWith(env, config, force = false) {
  const ns = tokenNamespace(config);
  const ck = `msT:${ns}`;
  if (!force) {
    const cached = await env.KV.get(ck, "json");
    if (cached && typeof cached.access_token === "string"
        && cached.access_token
        && Number.isFinite(Number(cached.expires_at))
        && cached.expires_at > Date.now() + 120_000) return cached.access_token;
  }
  const stored = await env.KV.get(`msR:${ns}`);
  const refreshToken = stored || config.refreshToken;
  const body = new URLSearchParams({
    client_id: config.clientId, client_secret: config.clientSecret,
    grant_type: "refresh_token", refresh_token: refreshToken,
    scope: "Files.ReadWrite.All offline_access",
  });
  const r = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) throw new Error(`token refresh failed: ${r.status}`);
  const tok = await r.json();
  const expiresIn = Number(tok?.expires_in);
  if (typeof tok?.access_token !== "string" || !tok.access_token
      || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("token refresh returned an invalid token response");
  }
  await env.KV.put(ck, JSON.stringify({
    access_token: tok.access_token,
    expires_at: Date.now() + Math.max(expiresIn - 60, 1) * 1000,
  }));
  if (tok.refresh_token && tok.refresh_token !== refreshToken) {
    await env.KV.put(`msR:${ns}`, tok.refresh_token);
  }
  return tok.access_token;
}

async function gfetchWith(env, config, path, init = {}, retry = true) {
  const tok = await tokenWith(env, config);
  const r = await fetchWithTimeout(`${GRAPH}${path}`, {
    ...init, headers: { Authorization: `Bearer ${tok}`, ...(init.headers || {}) },
  });
  if (r.status === 401 && retry) {
    await tokenWith(env, config, true);
    return gfetchWith(env, config, path, init, false);
  }
  return r;
}

const drivePathWith = (config, p) =>
  `/drives/${config.driveId}/root:/${enc(p)}`;

export async function downloadUrlWith(env, config, path) {
  const key = `dl:${tokenNamespace(config)}:${path}`;
  const cached = await env.KV.get(key);
  if (cached) {
    const valid = httpsUrl(cached);
    if (valid) return valid;
    await env.KV.delete(key).catch(() => null);
  }
  const r = await retryGraphRead(() => gfetchWith(env, config,
    `${drivePathWith(config, path)}?select=id,size,content.downloadUrl`));
  if (!r.ok) return null;
  const url = httpsUrl((await r.json())?.["@microsoft.graph.downloadUrl"]);
  if (url) await env.KV.put(key, url, { expirationTtl: 45 * 60 });
  return url || null;
}

export async function getFileWith(env, config, path, range) {
  const headers = range ? { Range: range } : {};
  return retryGraphRead(() => gfetchWith(env, config,
    `${drivePathWith(config, path)}:/content`, { headers }));
}

export async function thumbnailUrlWith(env, config, path, size = "c400x400") {
  const r = await gfetchWith(env, config,
    `${drivePathWith(config, path)}:/thumbnails?select=${size}`);
  if (!r.ok) return null;
  return httpsUrl((await r.json())?.value?.[0]?.[size]?.url);
}

export async function listChildrenWith(env, config, folder, strict = false) {
  const out = [];
  const seenLinks = new Set();
  let pages = 0;
  let url = `${drivePathWith(config, folder)}:/children` +
    `?$top=200&select=id,name,size,file,folder,audio,image`;
  while (url) {
    if (++pages > MAX_LIST_PAGES || seenLinks.has(url)) {
      if (strict) throw new Error(`Graph list pagination exceeded limit: ${folder}`);
      return out;
    }
    seenLinks.add(url);
    const r = await gfetchWith(env, config,
      url.startsWith("http") ? url.slice(GRAPH.length) : url);
    if (!r.ok) {
      if (strict) throw new Error(`Graph list HTTP ${r.status}: ${folder}`);
      return out;
    }
    const page = await r.json();
    if (!page || typeof page !== "object" || !Array.isArray(page.value)) {
      if (strict) throw new Error(`Graph list response invalid: ${folder}`);
      return out;
    }
    for (const item of page.value) {
      if (!validChild(item)) {
        if (strict) throw new Error(`Graph list item invalid: ${folder}`);
        continue;
      }
      out.push(item);
    }
    const next = page["@odata.nextLink"];
    if (next && (typeof next !== "string" || !next.startsWith(`${GRAPH}/`))) {
      if (strict) throw new Error(`Graph list nextLink invalid: ${folder}`);
      return out;
    }
    url = next || null;
  }
  return out;
}

export async function putSmallFileWith(env, config, path, bytes, contentType) {
  const target = `${drivePathWith(config, path)}:/content`;
  const r = await retryGraphRequest(() => gfetchWith(env, config, target, {
    method: "PUT",
    headers: { "Content-Type": contentType || "application/octet-stream" },
    body: bytes,
  }), "upload small file");
  return r.ok;
}

export async function deleteItemWith(env, config, path) {
  const r = await gfetchWith(env, config, drivePathWith(config, path),
    { method: "DELETE" });
  return r.ok || r.status === 404;
}

export async function createUploadSessionWith(env, config, path) {
  const target = `${drivePathWith(config, path)}:/createUploadSession`;
  const r = await retryGraphRequest(() => gfetchWith(env, config, target, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
  }), "create upload session");
  if (!r.ok) throw new Error(`upload session failed: ${r.status} ${await r.text()}`);
  const uploadUrl = httpsUrl((await r.json())?.uploadUrl);
  if (!uploadUrl) throw new Error("upload session returned an invalid URL");
  return uploadUrl;
}

export async function testStorageWith(env, config) {
  try {
    const r = await gfetchWith(env, config,
      `/drives/${config.driveId}?select=owner,quota`);
    if (!r.ok) return { ok: false, error: `drive HTTP ${r.status}` };
    const d = await r.json();
    return {
      ok: true, owner: d.owner?.user?.displayName || "",
      used: d.quota?.used || 0, total: d.quota?.total || 0,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
