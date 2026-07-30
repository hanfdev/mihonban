// Browser-side RYM album parser using the same selectors as pipeline/mihonban/rym/parse.py.
// It parses only HTML saved manually by the user and never requests rateyourmusic.com.

const directText = (el) => {
  if (!el) return "";
  let out = "";
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent;
  }
  return out.trim();
};

const stripByArtist = (title, artist) => {
  if (!artist) return title;
  const variants = [artist, artist.replace(/\s*\[[^\]]+\]/g, "").trim()];
  for (const v of variants) {
    const suffix = ` by ${v}`.toLowerCase();
    if (v && title.toLowerCase().endsWith(suffix)) {
      return title.slice(0, -suffix.length).trim();
    }
  }
  return title;
};

export function parseRymHtml(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, "text/html");

  const artistEl = doc.querySelector(".album_info a.artist")
    || doc.querySelector("a.artist");
  const artist = (artistEl?.textContent || "").trim();

  const titleEl = doc.querySelector(".album_title");
  let title = directText(titleEl) || (titleEl?.textContent || "").trim();
  title = stripByArtist(title, artist);

  const rating = parseFloat(
    doc.querySelector(".avg_rating")?.textContent?.trim() || "") || null;

  const votesTxt = doc.querySelector(".num_ratings b")?.textContent || "";
  const votes = parseInt(votesTxt.replace(/[^\d]/g, ""), 10) || null;

  let rank = "", year = null;
  for (const th of doc.querySelectorAll("th.info_hdr")) {
    const label = th.textContent.trim();
    const td = th.parentElement?.querySelector("td");
    if (!td) continue;
    if (label === "Ranked") {
      rank = td.textContent.replace(/\s+/g, " ").trim();
    } else if (label === "Released") {
      const m = td.textContent.match(/(19|20)\d\d/);
      if (m) year = Number(m[0]);
    }
  }

  const texts = (sel) =>
    [...doc.querySelectorAll(sel)].map((a) => a.textContent.trim())
      .filter(Boolean);
  const genres = texts(".release_pri_genres a.genre");
  const secondaryGenres = texts(".release_sec_genres a.genre");

  const descriptors = (doc.querySelector(".release_pri_descriptors")
    ?.textContent || "").split(",").map((s) => s.trim()).filter(Boolean);

  const rymUrl = doc.querySelector('link[rel="canonical"]')?.href
    || doc.querySelector('meta[property="og:url"]')?.content || "";

  if (!title && !rating) {
    throw new Error("解析失败：这看起来不是 RYM 音盤页的 HTML");
  }
  return { title, artist, year, rating, votes, rank, genres,
           secondaryGenres, descriptors, rymUrl };
}
