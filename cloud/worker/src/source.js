// Source-site update scanner. It reads only public post listings from Blogger
// Atom/RSS feeds and records new titles and links in source_posts for Admin.
// It explicitly never downloads audio or archive files, respecting GOAL boundary
// #1 and copyright constraints.

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

/** Fetch one Blogger JSON feed page with a 1-based start-index.
 *  Return {entries, total} or null. */
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

/** Prefer the Blogger JSON feed and fall back to generic RSS/Atom regex parsing.
 *  With deep=true, paginate all historical posts by start-index; only Blogger
 *  supports this mode. */
async function fetchEntries(sourceUrl, deep = false) {
  const base = sourceUrl.replace(/\/+$/, "");
  // 1) Blogger JSON, the only source that supports historical pagination.
  try {
    const PAGE = deep ? 150 : 40;
    const MAX_PAGES = deep ? 45 : 1;   // 45 x 150 reaches at most 6,750 historical posts.
    const all = [];
    let total = null;
    let start = 1;
    for (let p = 0; p < MAX_PAGES; p++) {
      const page = await fetchBloggerPage(base, start, PAGE);
      if (!page) break;
      total = page.total ?? total;
      if (!page.entries.length) break;             // Reached the end.
      all.push(...page.entries);
      // Blogger may return fewer than max-results on the first page in practice.
      // Advance by the number actually received rather than treating a short page
      // as the end of the feed.
      start += page.entries.length;
      if (total && all.length >= total) break;
    }
    if (all.length) return { entries: all, total };
  } catch { /* fall through */ }
  // 2) Generic RSS/Atom: no pagination, only a recent subset.
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

/** Run one scan. deep=true paginates all history for manual runs; scheduled scans
 *  inspect only the latest page. Return {added, total, feedTotal}; record errors
 *  in settings for display in Admin. */
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
    // Deep history may contain thousands of entries; write them in batches of 80.
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
