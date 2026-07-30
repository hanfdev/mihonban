// WebDAV storage backend (Jianguoyun / Alist / Synology / Nextcloud / 2dland …).
// config: { baseUrl, username, password }
//
// baseUrl should point at the directory that aligns with DB relative paths.
// Example: DB path = Music/Library/Artist/Album/track.mp3
//   baseUrl = https://dav.example.com/Music  → upload under Library/Artist/…
//   baseUrl = https://dav.example.com/       → upload under Music/Library/…
// If the last path segment of baseUrl equals the first segment of `path`
// (case-insensitive), that first segment is stripped to avoid Music/Music.

import { fetchWithTimeout } from "./net.js";

const enc = (p) => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");
const MAX_PROPFIND_BYTES = 8 * 1024 * 1024;

async function readTextLimited(response, limit = MAX_PROPFIND_BYTES) {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new Error(`WebDAV PROPFIND response exceeds ${limit} bytes`);
  }
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) {
      throw new Error(`WebDAV PROPFIND response exceeds ${limit} bytes`);
    }
    return new TextDecoder().decode(bytes);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new Error(`WebDAV PROPFIND response exceeds ${limit} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released/cancelled */ }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function authHeader(conf) {
  // Basic Auth with UTF-8 user:pass (btoa needs binary string).
  const raw = `${conf.username}:${conf.password}`;
  const bytes = new TextEncoder().encode(raw);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "Basic " + btoa(bin);
}

/** Map DB-relative path onto the path under baseUrl. */
export function mapPath(conf, path) {
  let p = String(path || "").replace(/^\/+/, "").replace(/\/+$/, "");
  try {
    const u = new URL(conf.baseUrl);
    const segs = u.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1];
    if (last) {
      const first = p.split("/")[0];
      if (first && first.toLowerCase() === decodeURIComponent(last).toLowerCase()) {
        p = p.split("/").slice(1).join("/");
      }
    }
  } catch { /* keep p */ }
  return p;
}

function davUrl(conf, path) {
  const base = conf.baseUrl.replace(/\/+$/, "");
  const rel = mapPath(conf, path);
  if (!rel) return base + "/";
  return `${base}/${enc(rel)}`;
}

async function dfetch(conf, path, init = {}, timeoutMs) {
  return fetchWithTimeout(davUrl(conf, path), {
    ...init,
    headers: { Authorization: authHeader(conf), ...(init.headers || {}) },
  }, timeoutMs);
}

function streamingBody(body) {
  const init = { body };
  // Node's fetch requires duplex for a ReadableStream request body. Workers
  // follow the Fetch standard and do not need it.
  if (body && typeof body.getReader === "function"
      && typeof process !== "undefined" && process.versions?.node) {
    init.duplex = "half";
  }
  return init;
}

export async function downloadUrl() {
  return null; // always Worker-proxy
}

export async function getFile(conf, path, range) {
  const headers = {};
  if (range) headers.Range = range;
  const r = await dfetch(conf, path, { headers });
  return r.ok || r.status === 206 || r.status === 416 ? r : null;
}

export async function thumbnailUrl() { return null; }

export async function listChildren(conf, folder, strict = false) {
  const folderPath = folder ? (folder.endsWith("/") ? folder : folder + "/") : "";
  const r = await dfetch(conf, folderPath, {
    method: "PROPFIND",
    headers: { Depth: "1", "Content-Type": "application/xml" },
    body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop>` +
      `<d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>`,
  });
  if (!r.ok && r.status !== 207) {
    if (strict) throw new Error(`WebDAV PROPFIND ${r.status}: ${folder}`);
    return [];
  }
  let xml;
  try { xml = await readTextLimited(r); }
  catch (error) {
    if (strict) throw error;
    return [];
  }
  const out = [];
  let selfPath = "";
  try {
    selfPath = decodeURIComponent(new URL(davUrl(conf, folderPath)).pathname)
      .replace(/\/+$/, "");
  } catch { /* an invalid base URL is reported by the request itself */ }
  const ns = "(?:[\\w.-]+:)?";
  const responseRe = new RegExp(
    `<${ns}response\\b[^>]*>([\\s\\S]*?)<\\/${ns}response>`, "gi");
  for (const m of xml.matchAll(responseRe)) {
    const block = m[1];
    const hrefRe = new RegExp(
      `<${ns}href\\b[^>]*>([\\s\\S]*?)<\\/${ns}href>`, "i");
    const href = (block.match(hrefRe) || [])[1] || "";
    let decoded;
    try {
      const rawHref = href.replace(/&amp;/g, "&");
      // Check traversal before URL() normalizes dot segments away.
      const rawPath = rawHref.match(
        /^[a-z][a-z\d+.-]*:\/\/[^/]*(\/[^?#]*)/i)?.[1]
        || rawHref.split(/[?#]/, 1)[0];
      const rawDecoded = decodeURIComponent(rawPath || "");
      if (rawDecoded.split("/").some((part) => part === "." || part === "..")) {
        if (strict) {
          throw new Error(`WebDAV returned an unsafe child name: ${rawDecoded}`);
        }
        continue;
      }
      const hrefUrl = new URL(rawHref, conf.baseUrl);
      decoded = decodeURIComponent(hrefUrl.pathname).replace(/\/+$/, "");
    } catch (error) {
      if (strict) {
        throw new Error(`WebDAV returned an invalid href: ${String(
          error.message || error)}`);
      }
      continue;
    }
    const name = decoded.split("/").pop();
    if (!name) continue;
    if (name === "." || name === ".." || /[\\/\u0000-\u001f]/.test(name)) {
      if (strict) throw new Error(`WebDAV returned an unsafe child name: ${name}`);
      continue;
    }
    if (selfPath && decoded === selfPath) continue;
    const isDir = new RegExp(`<${ns}collection\\s*\\/?>`, "i").test(block);
    const sizeRe = new RegExp(
      `<${ns}getcontentlength\\b[^>]*>(\\d+)`, "i");
    const rawSize = Number((block.match(sizeRe) || [])[1] || 0);
    const size = Number.isSafeInteger(rawSize) && rawSize >= 0 ? rawSize : 0;
    out.push({ name, size, file: isDir ? null : {}, folder: isDir ? {} : null });
  }
  return out;
}

export async function putSmallFile(conf, path, bytes, contentType) {
  const parent = path.split("/").slice(0, -1).join("/");
  await ensureDir(conf, parent);
  const tryPut = async () => dfetch(conf, path, {
    method: "PUT",
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      // many servers treat this as "replace if exists"
      "Overwrite": "T",
    },
    body: bytes,
  });
  let r = await tryPut();
  // 409 Conflict: parent missing or name reserved — rebuild parents once and retry
  if (r.status === 409 || r.status === 404) {
    await ensureDir(conf, parent, true);
    r = await tryPut();
  }
  if (r.ok || r.status === 201 || r.status === 204) return true;
  // last resort: DELETE then PUT (empty conflict / ghost collection)
  if (r.status === 409) {
    await dfetch(conf, path, { method: "DELETE" }).catch(() => null);
    r = await tryPut();
    if (r.ok || r.status === 201 || r.status === 204) return true;
  }
  const body = await r.text().catch(() => "");
  const msg = `WebDAV PUT ${r.status} ${davUrl(conf, path)} ${body.slice(0, 160)}`;
  console.error(msg);
  throw new Error(msg);
}

/** Large-file proxy upload: stream browser bytes straight to WebDAV. */
export async function putFile(conf, path, body, contentType) {
  const parent = path.split("/").slice(0, -1).join("/");
  await ensureDir(conf, parent);
  // timeout=0: streaming a full track from browser to Worker to WebDAV depends on
  // file size and uplink speed. A 30-80MB FLAC commonly exceeds 30 seconds on a
  // home uplink. The default timeout runs until response headers arrive, which
  // for PUT means waiting for the server to consume the entire body; it would
  // abort nearly every full-track upload midstream. Metadata requests such as
  // PROPFIND, MKCOL, and DELETE retain the default timeout.
  const r = await dfetch(conf, path, {
    method: "PUT",
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      Overwrite: "T",
    },
    ...streamingBody(body),
  }, 0);
  if (r.ok || r.status === 201 || r.status === 204) return true;
  const text = await r.text().catch(() => "");
  throw new Error(
    `WebDAV streaming PUT ${r.status} ${davUrl(conf, path)} ${text.slice(0, 160)}`);
}

async function ensureDir(conf, dir, force = false) {
  if (!dir) return;
  const parts = dir.replace(/^\/+/, "").split("/").filter(Boolean);
  const acc = [];
  for (const part of parts) {
    acc.push(part);
    const p = acc.join("/");
    // Already a collection?
    if (!force) {
      const head = await dfetch(conf, p + "/", {
        method: "PROPFIND", headers: { Depth: "0" },
      });
      if (head.ok || head.status === 207) continue;
    }
    const r = await dfetch(conf, p + "/", { method: "MKCOL" });
    // 201 created; 405/409/301/302 often mean "already there"
    if (r.ok || r.status === 201 || r.status === 405
        || r.status === 301 || r.status === 302 || r.status === 409) {
      continue;
    }
    // Some servers want MKCOL without trailing slash
    const r2 = await dfetch(conf, p, { method: "MKCOL" });
    if (!(r2.ok || r2.status === 201 || r2.status === 405 || r2.status === 409)) {
      const body = await r2.text().catch(() => "");
      console.error("webdav MKCOL", r.status, r2.status, davUrl(conf, p), body.slice(0, 120));
    }
  }
}

export async function deleteItem(conf, path) {
  const r = await dfetch(conf, path, { method: "DELETE" });
  return r.ok || r.status === 204 || r.status === 404;
}

export async function test(conf) {
  try {
    const r = await dfetch(conf, "", {
      method: "PROPFIND", headers: { Depth: "0" },
    });
    if (r.ok || r.status === 207) return { ok: true };
    if (r.status === 401) return { ok: false, error: "用户名或密码不对" };
    return { ok: false, error: `WebDAV HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
