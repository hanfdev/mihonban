"""Pre-import artist canonicalization via MusicBrainz artist search.

jpop80ss-style rips are tagged with romaji artist names ("Tatsuro Yamashita")
while MusicBrainz canonical names are in original script (山下達郎). That
string distance wrecks beets' match similarity for every album. Before beets
sees an album we:

  1. look up the album's common artist on MB (cached in _data/state),
  2. rewrite artist/albumartist to the canonical (original-script) name,
  3. write the MB sort-name (romaji, "Yamashita, Tatsuro") into
     artistsort/albumartistsort.

This simultaneously fixes matching and implements the naming policy
(original script as primary tag, romaji in sort tags) even for albums that
end up imported as-is. Only fires on confident lookups (search score >= 95).
Never touches multi-artist albums.
"""

from __future__ import annotations

import json
import logging
import socket
from pathlib import Path
from typing import Callable

import mutagen

from .config import Config
from .extract import AUDIO_EXTS

log = logging.getLogger("mihonban.mb_artist")

MIN_SCORE = 95
MB_TIMEOUT_SECONDS = 30

Resolver = Callable[[str], dict | None]


def _lucene_escape(s: str) -> str:
    return s.replace("\\", r"\\").replace('"', r"\"")


def _sortname_variants(sort: str) -> set[str]:
    """"Yamashita, Tatsuro" -> {"yamashita, tatsuro", "tatsuro yamashita"}."""
    out = {sort.lower()}
    if "," in sort:
        last, _, first = sort.partition(",")
        out.add(f"{first.strip()} {last.strip()}".lower())
    return out


def _default_resolver(name: str) -> dict | None:
    import musicbrainzngs as mb

    mb.set_useragent("mihonban", "0.1", "local pipeline")
    # the plain `artist` search field does NOT cover aliases — romaji names
    # of Japanese artists only surface through an explicit alias clause
    esc = _lucene_escape(name)
    # musicbrainzngs 没有 timeout 参数，底层 opener.open() 不限时：断网/静默
    # 防火墙会让常驻的 watch 守望者永久卡死。临时设 socket 级默认超时兜底；
    # 超时以 socket.timeout 抛出，走下面的 best-effort 分支缓存为「未命中」。
    old_timeout = socket.getdefaulttimeout()
    socket.setdefaulttimeout(MB_TIMEOUT_SECONDS)
    try:
        res = mb.search_artists(query=f'artist:"{esc}" OR alias:"{esc}"',
                                limit=5)
    except Exception as e:  # noqa: BLE001 — network best-effort
        log.warning("MB artist search failed for %r: %s", name, e)
        return None
    finally:
        socket.setdefaulttimeout(old_timeout)
    want = name.lower()
    for top in (res.get("artist-list") or []):
        if int(top.get("ext:score", 0)) < MIN_SCORE:
            break
        known = {top["name"].lower()}
        known |= {al["alias"].lower() for al in top.get("alias-list", [])}
        known |= _sortname_variants(top.get("sort-name", ""))
        if want in known:
            return {"name": top["name"], "sort": top.get("sort-name", "")}
        log.info("MB artist %r: top hit %r does not list the query as "
                 "name/alias — rejected", name, top["name"])
    return None


class ArtistCache:
    def __init__(self, path: Path):
        self.path = path
        try:
            loaded = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            loaded = {}
        self.data: dict = {
            str(key): value for key, value in loaded.items()
            if value is None or isinstance(value, dict)
        } if isinstance(loaded, dict) else {}

    def get(self, name: str) -> dict | None:
        return self.data.get(name.lower())

    def __contains__(self, name: str) -> bool:
        return name.lower() in self.data

    def put(self, name: str, entry: dict | None) -> None:
        self.data[name.lower()] = entry
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=1), "utf-8")


def has_cjk(s: str) -> bool:
    """原文汉字/日文假名（CJK 基本区 + 假名）——判定是否"已是原名"。"""
    return any(0x3000 <= ord(c) <= 0x9FFF for c in s)


# ---------- 人工精选的别名库（repo 内，单一事实源，web 端同吃这份 JSON） ----------

ALIAS_PATH = (Path(__file__).resolve().parents[2]
              / "cloud" / "web" / "src" / "artist-aliases.json")
_ALIAS_MISS = object()   # 库里没有这个键（区别于「明确保留拉丁名」的 null）
_alias_cache: dict | None = None


def norm_alias_key(name: str) -> str:
    """别名键归一：小写、去重音、折叠空白、×→x。"""
    import unicodedata
    s = unicodedata.normalize("NFKD", str(name))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("×", "x").lower()
    return " ".join(s.split())


def _alias_map() -> dict:
    global _alias_cache
    if _alias_cache is None:
        try:
            raw = json.loads(ALIAS_PATH.read_text("utf-8"))["aliases"]
        except (OSError, ValueError, KeyError):
            log.warning("别名库不可读：%s", ALIAS_PATH)
            raw = {}
        _alias_cache = {norm_alias_key(k): v for k, v in raw.items()}
    return _alias_cache


def alias_lookup(name: str):
    """查别名库。命中返回 {name, sort} 或 None（明确保留拉丁名）；
    没这个键返回 _ALIAS_MISS 哨兵。自动尝试「名 姓」/「姓 名」两种词序。"""
    m = _alias_map()
    key = norm_alias_key(name)
    if key in m:
        return m[key]
    parts = key.split(" ")
    if len(parts) == 2:   # GOTO KUMIKO ↔ KUMIKO GOTO 同一人
        rev = f"{parts[1]} {parts[0]}"
        if rev in m:
            return m[rev]
    return _ALIAS_MISS


def resolve_original(name: str, cache: ArtistCache,
                     resolver: Resolver | None = None) -> dict | None:
    """把一个（可能是罗马字的）艺人名折算成 {name: 原名, sort: 罗马字}。

    查找顺序：人工别名库（零网络、可版本控制）→ 本机缓存 → MB alias 搜索。
    别名库里显式的 null = 官方拉丁名，直接放行不再问 MB。
    仅在能高置信度确认时返回；否则返回 None（宁可不改不可错改）。
    文件端补写标签（canonicalize_artists）和匹配端改写候选（beets 插件）
    共用这一个入口，语义与缓存完全一致。
    """
    if not name or has_cjk(name):
        return None                      # 已是原名，无需折算
    hit = alias_lookup(name)
    if hit is not _ALIAS_MISS:
        return hit if (hit and has_cjk(hit.get("name", ""))) else None
    entry = cache.get(name)
    if entry is None and name not in cache:
        entry = (resolver or _default_resolver)(name)
        cache.put(name, entry)
    if not isinstance(entry, dict) or not isinstance(entry.get("name"), str):
        return None
    if not has_cjk(entry["name"]):
        # 折算必须"获得原文"；罗马字→另一种罗马字不值得改
        return None
    return {
        "name": entry["name"],
        "sort": entry.get("sort", "")
        if isinstance(entry.get("sort", ""), str) else "",
    }


def canonicalize_artists(cfg: Config, album_dir: Path, apply: bool = True,
                         resolver: Resolver | None = None) -> list[str]:
    """Rewrite romaji artist tags to canonical script + sort names."""
    resolver = resolver or _default_resolver
    cache = ArtistCache(cfg.state_dir / "artist_map.json")

    files = [f for f in sorted(album_dir.rglob("*"))
             if f.is_file() and f.suffix.lower() in AUDIO_EXTS]
    artists: set[str] = set()
    handles = []
    for f in files:
        try:
            audio = mutagen.File(f, easy=True)
        except (mutagen.MutagenError, OSError, ValueError, UnicodeError):
            continue
        if audio is None:
            continue
        handles.append((f, audio))
        artists.update(str(value).strip() for value in audio.get("artist", [])
                       if str(value).strip())

    if len(artists) != 1:
        return []
    (name,) = artists
    if has_cjk(name):
        return []  # already original script

    entry = resolve_original(name, cache, resolver)
    if not entry:
        return []

    notes = []
    for f, audio in handles:
        changed = []
        if entry["name"] != name:
            audio["artist"] = entry["name"]
            if audio.get("albumartist"):
                audio["albumartist"] = entry["name"]
            changed.append(f"artist {name!r} -> {entry['name']!r}")
        sort = entry.get("sort", "")
        if sort and not audio.get("artistsort"):
            audio["artistsort"] = sort
            audio["albumartistsort"] = sort
            changed.append(f"sort <- {sort!r}")
        if not changed:
            continue
        if apply:
            try:
                audio.save()
            except (mutagen.MutagenError, OSError, ValueError, UnicodeError) as e:
                log.warning("cannot save canonical artist tags for %s: %s", f, e)
                continue
        notes.append(f"{f.name}: " + ", ".join(changed))
    return notes
