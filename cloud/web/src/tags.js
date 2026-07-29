// 客户端读取音频 tag（上传建专辑用）：music-metadata 优先，失败降级为
// 文件名解析 + <audio> 时长探测，保证任何情况下都能继续上传。

const fromFilename = (name) => {
  const stem = name.replace(/\.[^.]+$/, "");
  const m = stem.match(/^(\d{1,3})[\s._-]+(.+)$/);
  return { track: m ? Number(m[1]) : null, title: m ? m[2] : stem };
};

const probeDuration = (file) => new Promise((resolve) => {
  let url = ""
  try { url = URL.createObjectURL(file) } catch { resolve(null); return }
  const a = new Audio()
  a.preload = "metadata";
  let done = false
  const finish = (value) => {
    if (done) return
    done = true
    clearTimeout(timer)
    a.removeAttribute("src")
    URL.revokeObjectURL(url)
    resolve(value)
  }
  const timer = setTimeout(() => finish(null), 10_000)
  a.onloadedmetadata = () => finish(a.duration || null)
  a.onerror = () => finish(null)
  a.src = url
});

export async function readTags(file) {
  const fallback = fromFilename(file.name);
  const base = {
    file,
    filename: file.name,
    size: file.size,
    format: file.name.split(".").pop().toLowerCase(),
    title: fallback.title,
    track: fallback.track,
    disc: 1,
    duration: null,
    artist: "", artists: [], albumArtist: "",
    artistSort: "", artistSorts: [], albumArtistSort: "",
    album: "", year: null,
    picture: null, // {blob, type}
  };
  try {
    const mm = await import("music-metadata");
    const meta = await mm.parseBlob(file, { duration: true });
    const c = meta.common;
    base.title = c.title || base.title;
    base.track = c.track?.no ?? base.track;
    base.disc = c.disk?.no ?? 1;
    base.artist = c.artist || "";
    base.artists = (Array.isArray(c.artists) && c.artists.length
      ? c.artists : (c.artist ? [c.artist] : []))
      .map((value) => String(value || '').trim()).filter(Boolean);
    base.albumArtist = c.albumartist || c.artist || "";
    base.artistSort = c.artistsort || "";
    base.artistSorts = (Array.isArray(c.artistsort)
      ? c.artistsort : (c.artistsort ? [c.artistsort] : []))
      .map((value) => String(value || '').trim()).filter(Boolean);
    base.albumArtistSort = c.albumartistsort || c.artistsort || "";
    base.album = c.album || "";
    base.year = c.year || null;
    base.duration = meta.format.duration || null;
    base.bitrate = Math.round((meta.format.bitrate || 0) / 1000) || null;
    const pic = c.picture?.[0];
    if (pic) {
      const bytes = pic.data instanceof Uint8Array ? pic.data
        : new Uint8Array(pic.data);
      base.picture = {
        blob: new Blob([bytes], { type: pic.format || "image/jpeg" }),
        type: pic.format || "image/jpeg",
      };
    }
  } catch {
    base.duration = await probeDuration(file);
  }
  return base;
}
