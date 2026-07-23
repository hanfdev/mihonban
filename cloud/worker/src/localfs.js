// 本地磁盘存储后端（仅 Node 部署可用：node src/node.js）。
// Cloudflare Worker 无文件系统，storage.js 在缺少 env.LOCAL_FS 时会明确报错。
//
// config: { root: absolute-or-relative-dir, odRoot?: "Music/Library" }
// root 对应曲库根（与 OD_ROOT 对齐），DB 路径若以 odRoot 开头会剥掉再拼到 root 下。
// 例：root=/data/mihonban，path=Music/Library/Artist/A/track.flac
//   → /data/mihonban/Artist/A/track.flac

import { createReadStream, createWriteStream, existsSync, mkdirSync,
         readdirSync, statSync, writeFileSync, unlinkSync, rmSync,
         realpathSync, renameSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

function odRootOf(conf) {
  return String(conf.odRoot || process.env.OD_ROOT || "Music/Library")
    .replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/** DB 相对路径 → root 下的相对段（正斜杠） */
export function mapPath(conf, path) {
  let p = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  const od = odRootOf(conf);
  if (od && (p === od || p.startsWith(od + "/"))) {
    p = p === od ? "" : p.slice(od.length + 1);
  }
  return p;
}

function absPath(conf, path) {
  const rawRoot = String(conf.root || "").trim();
  if (!rawRoot) throw new Error("local root 未配置");
  const root = resolve(rawRoot);
  const rel = mapPath(conf, path);
  const full = rel
    ? resolve(root, ...rel.split("/").filter(Boolean))
    : root;
  // 防止 .. 逃出 root
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (full !== root && !full.startsWith(rootWithSep)) {
    throw new Error("local path 越界");
  }
  // Lexical containment is not enough when a library contains a symlink or
  // Windows junction. Resolve the closest existing ancestor so reads, writes,
  // and recursive deletes cannot escape through a link inside the root.
  if (existsSync(root)) {
    const realRoot = realpathSync(root);
    let probe = full;
    while (!existsSync(probe)) {
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    if (existsSync(probe)) {
      const realProbe = realpathSync(probe);
      const rel = relative(realRoot, realProbe);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error("local path 越界（符号链接）");
      }
    }
  }
  return full;
}

export function downloadUrl() {
  return null; // 始终 Worker 代理读
}

export async function getFile(conf, path, range) {
  const full = absPath(conf, path);
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  const st = statSync(full);
  const size = st.size;
  if (size === 0) {
    if (range) {
      return new Response(null, { status: 416,
        headers: { "Content-Range": "bytes */0", "Accept-Ranges": "bytes" } });
    }
    return new Response(new Uint8Array(), { status: 200, headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": "0",
      "Accept-Ranges": "bytes",
    } });
  }
  let start = 0, end = size - 1, status = 200;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/i.exec(String(range).trim());
    if (!m) {
      return new Response(null, { status: 416,
        headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" } });
    }
    if (m) {
      if (m[1] === "" && m[2] === "") {
        return new Response(null, { status: 416,
          headers: { "Content-Range": `bytes */${size}` } });
      }
      if (m[1] !== "") {
        start = Number(m[1]);
        if (m[2] !== "") end = Number(m[2]);
      } else {
        // Suffix range: bytes=-N means the final N bytes.
        const suffix = Number(m[2]);
        if (!Number.isFinite(suffix) || suffix <= 0) {
          return new Response(null, { status: 416,
            headers: { "Content-Range": `bytes */${size}` } });
        }
        start = Math.max(size - suffix, 0);
      }
      if (!Number.isFinite(start) || !Number.isFinite(end)
          || start > end || start >= size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      end = Math.min(end, size - 1);
      status = 206;
    }
  }
  const stream = createReadStream(full, { start, end });
  const web = Readable.toWeb(stream);
  const headers = {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
  };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  return new Response(web, { status, headers });
}

export async function thumbnailUrl() {
  return null;
}

export async function listChildren(conf, folder, strict = false) {
  const full = absPath(conf, folder || "");
  if (!existsSync(full) || !statSync(full).isDirectory()) {
    if (strict) throw new Error(`local folder not found: ${folder}`);
    return [];
  }
  const out = [];
  for (const name of readdirSync(full)) {
    if (name === "." || name === "..") continue;
    try {
      const st = statSync(join(full, name));
      out.push({
        name,
        size: st.isFile() ? st.size : 0,
        file: st.isFile() ? {} : null,
        folder: st.isDirectory() ? {} : null,
      });
    } catch (error) {
      if (strict) {
        throw new Error(`local directory entry unavailable: ${name}: ` +
          String(error.message || error));
      }
    }
  }
  return out;
}

export async function putSmallFile(conf, path, bytes, contentType) {
  const full = absPath(conf, path);
  mkdirSync(dirname(full), { recursive: true });
  const buf = bytes instanceof ArrayBuffer ? Buffer.from(bytes)
    : Buffer.isBuffer(bytes) ? bytes
    : Buffer.from(bytes);
  writeFileSync(full, buf);
  return true;
}

/** Stream a large upload through a temporary file, then replace atomically. */
export async function putFile(conf, path, body, contentType) {
  if (!body || typeof body.getReader !== "function") {
    return putSmallFile(conf, path, body || new Uint8Array(), contentType);
  }
  const full = absPath(conf, path);
  mkdirSync(dirname(full), { recursive: true });
  if (existsSync(full) && statSync(full).isDirectory()) {
    throw new Error("local upload target is a directory");
  }
  const temp = `${full}.upload-${process.pid}-${Date.now()}-` +
    Math.random().toString(36).slice(2);
  try {
    await pipeline(Readable.fromWeb(body), createWriteStream(temp, { flags: "wx" }));
    renameSync(temp, full);
    return true;
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export async function deleteItem(conf, path) {
  const full = absPath(conf, path);
  if (!existsSync(full)) return true;
  const st = statSync(full);
  if (st.isDirectory()) rmSync(full, { recursive: true, force: true });
  else unlinkSync(full);
  return true;
}

export async function test(conf) {
  const root = String(conf.root || "").trim();
  if (!root) return { ok: false, error: "请填写本地曲库根目录 root" };
  try {
    const abs = resolve(root);
    mkdirSync(abs, { recursive: true });
    if (!statSync(abs).isDirectory()) {
      return { ok: false, error: "root 不是目录" };
    }
    // 写探活文件再删
    const probe = join(abs, `.mihonban-write-test-${process.pid}-` +
      `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      writeFileSync(probe, "ok", { flag: "wx" });
    } finally {
      if (existsSync(probe)) unlinkSync(probe);
    }
    return { ok: true, owner: abs, used: 0, total: 0 };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** 供 node.js 注入到 env.LOCAL_FS */
export const api = {
  downloadUrl, getFile, thumbnailUrl, listChildren, putSmallFile, putFile,
  deleteItem, test, mapPath,
};
