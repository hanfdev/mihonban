// 资源站更新扫描器 —— 只读公开的文章列表（Blogger Atom/RSS feed），
// 把新帖的标题+链接记进 source_posts 表供后台展示。
// 明确不做的事：不下载任何音频/压缩包文件（GOAL 红线 #1 + 版权边界）。

import { getSetting, setSetting } from "./auth.js";
import { discardResponse } from "./net.js";

export const SOURCE_FETCH_TIMEOUT_MS = 15_000;
export const MAX_FEED_BYTES = 8 * 1024 * 1024;

/** Abort a feed request that a dead origin leaves hanging indefinitely. */
export async function fetchWithTimeout(input, init = {},
  timeoutMs = SOURCE_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readTextLimited(response, limit = MAX_FEED_BYTES) {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new Error(`feed 超过 ${limit} 字节上限`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new Error(`feed 超过 ${limit} 字节上限`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function safeEntry(entry) {
  const title = String(entry?.title || "").trim().slice(0, 1000) || "(untitled)";
  const rawUrl = typeof entry?.url === "string" ? entry.url.trim() : "";
  if (!rawUrl || rawUrl.length > 2048) return null;
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)
        || url.username || url.password) return null;
    return {
      title,
      url: url.toString(),
      published: String(entry?.published || "").slice(0, 32),
    };
  } catch {
    return null;
  }
}

async function sha16(s) {
  const d = await crypto.subtle.digest("SHA-1",
    new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0"))
    .join("").slice(0, 16);
}

/** Blogger JSON feed 一页（start-index 从 1 开始）。返回 {entries, total} 或 null。 */
async function fetchBloggerPage(base, startIndex, pageSize) {
  const r = await fetchWithTimeout(
    `${base}/feeds/posts/default?alt=json&max-results=${pageSize}` +
    `&start-index=${startIndex}`,
    { headers: { "User-Agent": "mihonban-feed-reader/1.0" } });
  if (!r.ok) { await discardResponse(r); return null; }
  const j = JSON.parse(await readTextLimited(r));
  const entries = (j.feed?.entry || []).map((e) => safeEntry({
    title: e.title?.$t || "(untitled)",
    url: (e.link || []).find((l) => l.rel === "alternate")?.href || "",
    published: (e.published?.$t || "").slice(0, 10),
  })).filter(Boolean);
  const total = Number(j.feed?.openSearch$totalResults?.$t) || null;
  return { entries, total };
}

/** Blogger JSON feed 优先，退化到通用 RSS/Atom 正则解析。
 *  deep=true 时按 start-index 分页把全部历史帖翻完（仅 Blogger 支持）。 */
async function fetchEntries(sourceUrl, deep = false) {
  const base = sourceUrl.replace(/\/+$/, "");
  // 1) Blogger JSON（唯一支持分页回溯的通道）
  try {
    const PAGE = deep ? 150 : 40;
    const MAX_PAGES = deep ? 45 : 1;   // 45×150 = 最多回溯 6750 帖
    const all = [];
    let total = null;
    let start = 1;
    for (let p = 0; p < MAX_PAGES; p++) {
      const page = await fetchBloggerPage(base, start, PAGE);
      if (!page) break;
      total = page.total ?? total;
      if (!page.entries.length) break;             // 翻到底了
      all.push(...page.entries);
      // 注意：Blogger 第一页可能返回少于 max-results 的条数（观察到的真实行为），
      // 所以按「实际收到多少就前进多少」翻页，不能用「不满一页」判断结尾。
      start += page.entries.length;
      if (total && all.length >= total) break;
    }
    if (all.length) return { entries: all, total };
  } catch { /* fall through */ }
  // 2) 通用 RSS/Atom（无分页，只有最近若干条）
  for (const path of ["/feeds/posts/default", "/rss.xml", "/feed", "/atom.xml"]) {
    try {
      const r = await fetchWithTimeout(base + path,
        { headers: { "User-Agent": "mihonban-feed-reader/1.0" } });
      if (!r.ok) { await discardResponse(r); continue; }
      const xml = await readTextLimited(r);
      const items = [...xml.matchAll(
        /<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/g)].map((m) => m[0]);
      const entries = items.map((it) => {
        const title = (it.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
        const url = (it.match(/<link[^>]*href="([^"]+)"/) || [])[1]
          || (it.match(/<link[^>]*>([^<]+)<\/link>/) || [])[1] || "";
        const published = ((it.match(/<(?:pubDate|published|updated)[^>]*>([^<]+)</) || [])[1] || "").slice(0, 16);
        return safeEntry({ title: title.trim(), url: url.trim(), published });
      }).filter(Boolean);
      if (entries.length) return { entries, total: null };
    } catch { /* try next */ }
  }
  throw new Error("拿不到文章列表：确认网址正确且站点提供 RSS/Atom feed");
}

/** 扫一次；deep=true 时分页翻完全部历史（手动触发用，定时扫只看最新一页）。
 *  返回 {added, total, feedTotal}。错误记录到 settings 供后台显示。 */
export async function scanSource(env, deep = false) {
  const sourceUrl = await getSetting(env, "source_url");
  if (!sourceUrl) {
    await setSetting(env, "source_last_error", "未设置资源站网址");
    return { added: 0, total: 0, error: "未设置资源站网址" };
  }
  try {
    const { entries, total: feedTotal } = await fetchEntries(sourceUrl, deep);
    const now = Date.now();
    let added = 0;
    // 深度回溯可能有几千条：按 80 条一批写库
    for (let i = 0; i < entries.length; i += 80) {
      const chunk = entries.slice(i, i + 80);
      const stmts = await Promise.all(chunk.map(async (e) =>
        env.DB.prepare(`
          INSERT INTO source_posts (id, title, url, published, status, created_at)
          VALUES (?, ?, ?, ?, 'new', ?)
          ON CONFLICT(id) DO NOTHING`)
          .bind(await sha16(e.url), e.title, e.url, e.published, now)));
      const results = await env.DB.batch(stmts);
      for (const r of results) added += r.meta?.changes || 0;
    }
    await setSetting(env, "source_last_scan", String(now));
    await setSetting(env, "source_last_error", "");
    return { added, total: entries.length, feedTotal };
  } catch (e) {
    await setSetting(env, "source_last_error", String(e.message || e));
    return { added: 0, total: 0, error: String(e.message || e) };
  }
}
