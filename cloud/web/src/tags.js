// Read audio tags client-side when creating an album. Prefer music-metadata, then fall back to filename parsing
// and <audio> duration probing so an upload can continue even when metadata extraction fails.

const fromFilename = (name) => {
  const stem = name.replace(/\.[^.]+$/, "");
  const m = stem.match(/^(\d{1,3})[\s._-]+(.+)$/);
  return { track: m ? Number(m[1]) : null, title: m ? m[2] : stem };
};

const AUDIO_EXTENSIONS = new Set(["mp3", "flac", "m4a", "ogg", "opus", "wav"]);

const extensionOf = (name) => {
  const match = /\.([^.]+)$/.exec(String(name || ""));
  return match ? match[1].toLowerCase() : "";
};

const ascii = (bytes, start, length) => String.fromCharCode(
  ...bytes.slice(start, start + length));

function audioFormatFromHeader(bytes) {
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === "fLaC") return "flac";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF"
      && ascii(bytes, 8, 4) === "WAVE") return "wav";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") return "m4a";
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === "OggS") {
    return ascii(bytes, 0, Math.min(bytes.length, 96)).includes("OpusHead")
      ? "opus" : "ogg";
  }
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === "ID3") return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff
      && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  return "";
}

export async function audioFileFormat(file) {
  const extension = extensionOf(file?.name);
  if (AUDIO_EXTENSIONS.has(extension)) return extension;
  if (!file || typeof file.slice !== "function") return "";
  try {
    const bytes = new Uint8Array(await file.slice(0, 96).arrayBuffer());
    return audioFormatFromHeader(bytes);
  } catch {
    return "";
  }
}

export function normalizedAudioFilename(name, format) {
  const extension = extensionOf(name);
  if ((extension === "fla" && format === "flac")
      || (extension === "opu" && format === "opus")) {
    return String(name).replace(/\.[^.]+$/, `.${format}`);
  }
  return String(name || "");
}

export async function recognizedAudioFiles(fileList) {
  const checked = await Promise.all([...fileList].map(async (file) => ({
    file,
    format: await audioFileFormat(file),
  })));
  return checked.filter((entry) => entry.format);
}

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

export async function readTags(file, detectedFormat = "") {
  const format = detectedFormat || await audioFileFormat(file);
  if (!format) throw new Error("unsupported audio file");
  const filename = normalizedAudioFilename(file.name, format);
  const fallback = fromFilename(filename);
  const base = {
    file,
    filename,
    size: file.size,
    format,
    title: fallback.title,
    track: fallback.track,
    disc: 1,
    duration: null,
    artist: "", artists: [], artistIds: [], hasStructuredArtists: false,
    albumArtist: "", albumArtists: [],
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
    const nativeArtistValues = Object.values(meta.native || {}).flat()
      .filter((tag) => String(tag?.id || '').toUpperCase() === 'ARTISTS');
    base.hasStructuredArtists = nativeArtistValues.length > 0
      || (Array.isArray(c.artists) && c.artists.length > 1);
    base.artists = (base.hasStructuredArtists
      ? c.artists : (c.artist ? [c.artist] : []))
      .map((value) => String(value || '').trim()).filter(Boolean);
    base.artistIds = (Array.isArray(c.musicbrainz_artistid)
      ? c.musicbrainz_artistid
      : (c.musicbrainz_artistid ? [c.musicbrainz_artistid] : []))
      .map((value) => String(value || '').trim()).filter(Boolean);
    base.albumArtist = c.albumartist || c.artist || "";
    base.albumArtists = (Array.isArray(c.albumartists) && c.albumartists.length
      ? c.albumartists : (base.albumArtist ? [base.albumArtist] : []))
      .map((value) => String(value || '').trim()).filter(Boolean);
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
