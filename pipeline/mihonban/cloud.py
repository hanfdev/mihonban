"""Synchronize the local mihonban library with the Cloudflare Worker.

``mihonban cloud sync``:
  1. ``rclone copy`` incrementally uploads MUSIC_ROOT to OneDrive, transferring
     only new or changed files.
  2. Read each album's file tags, including custom RYM tags, and register it
     idempotently through ``POST /api/albums``.

Album IDs match the Worker: ``sha1(NFC(folder))[:16]``. A folder resembles
``Music/Library/Artist/[1978] GO AHEAD!``.
"""

from __future__ import annotations

import hashlib
import logging
import math
import subprocess
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

import mutagen
import requests

from .config import Config
from .extract import AUDIO_EXTS
from .mb_artist import ArtistCache, resolve_sort_name

log = logging.getLogger("mihonban.cloud")

OD_PREFIX = "Music/Library"
MAX_STORAGE_PATH = 400
MAX_STORAGE_PART = 255
MAX_TRACKS = 20_000
MAX_SAFE_INTEGER = 2**53 - 1


def _js_len(value: str) -> int:
    """Return JavaScript's UTF-16 string length for Worker limit parity."""
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def _storage_path(value: object, root: str = OD_PREFIX) -> str | None:
    """Normalize and validate a path exactly as the Worker safePath helper."""
    if not isinstance(value, str):
        return None
    normalized = unicodedata.normalize("NFC", value).replace("\\", "/")
    while "//" in normalized:
        normalized = normalized.replace("//", "/")
    normalized = normalized.strip("/")
    if (_js_len(normalized) > MAX_STORAGE_PATH
            or any(ord(char) < 32 for char in normalized)):
        return None
    parts = normalized.split("/")
    if any(part in (".", "..") or _js_len(part) > MAX_STORAGE_PART
           for part in parts):
        return None
    normalized_root = unicodedata.normalize("NFC", root).replace("\\", "/")
    normalized_root = normalized_root.strip("/")
    if not normalized.startswith(normalized_root + "/"):
        return None
    return normalized


def _bounded_text(value: object, maximum: int,
                  *, allow_empty: bool = True) -> bool:
    if value is None:
        return allow_empty
    if not isinstance(value, str):
        return False
    text = value.strip()
    return (allow_empty or bool(text)) and _js_len(text) <= maximum


def _bounded_number(value: object, *, integer: bool = False,
                    minimum: float = -math.inf,
                    maximum: float = math.inf) -> bool:
    if value is None or value == "":
        return True
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return False
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return False
    if (not math.isfinite(number) or number < minimum or number > maximum
            or (integer and not number.is_integer())):
        return False
    if isinstance(value, int) and abs(value) > sys.float_info.max:
        return False
    return True


def _text_list(value: object, *, max_items: int = 200,
               max_item_length: int = 200) -> bool:
    if value is None:
        return True
    if not isinstance(value, list) or len(value) > max_items:
        return False
    return all(isinstance(item, str) and bool(item.strip())
               and _js_len(item.strip()) <= max_item_length
               for item in value)


def _http_url(value: object, maximum: int = 2048) -> bool:
    if value is None or value == "":
        return True
    if not isinstance(value, str) or _js_len(value) > maximum:
        return False
    try:
        parsed = urlsplit(value)
        return (parsed.scheme.lower() in ("http", "https")
                and bool(parsed.netloc)
                and parsed.username is None and parsed.password is None)
    except ValueError:
        return False


def validate_album_payload(payload: object) -> str | None:
    """Return the first local error using the Worker's album API limits."""
    if not isinstance(payload, dict):
        return "专辑数据必须是对象"

    def artist_list_error(value: object, *, allow_empty: bool) -> str | None:
        if (not isinstance(value, list) or len(value) > 24
                or (not allow_empty and not value)):
            return "必须包含 1 到 24 位艺人" if not allow_empty else "最多包含 24 位艺人"
        seen: set[str] = set()
        names: list[str] = []
        for item in value:
            if not isinstance(item, dict):
                return "中的每位艺人必须是对象"
            name = item.get("name")
            sort = item.get("sort", name)
            if (not _bounded_text(name, 500, allow_empty=False)
                    or not _bounded_text(sort, 500)):
                return "中的艺人名称或罗马音无效"
            normalized_name = unicodedata.normalize("NFC", name.strip())
            key = normalized_name.casefold()
            if key in seen:
                return "中不能有重复艺人"
            seen.add(key)
            names.append(normalized_name)
        separator = " × " if len(names) == 2 else ", "
        if _js_len(separator.join(names)) > 500:
            return "组合名称不能超过 500 字符"
        return None

    folder = _storage_path(payload.get("folder"))
    if folder is None:
        return f"folder 路径无效或超过 {MAX_STORAGE_PATH} 字符"
    artists = payload.get("artists")
    if artists is not None:
        if error := artist_list_error(artists, allow_empty=False):
            return f"artists {error}"
    elif not _bounded_text(payload.get("artist"), 500, allow_empty=False):
        return "artist 不能为空且不能超过 500 字符"
    if not _bounded_text(payload.get("title"), 1000, allow_empty=False):
        return "title 不能为空且不能超过 1000 字符"
    if ("artistSort" in payload
            and not _bounded_text(payload.get("artistSort"), 500)):
        return "artistSort 不能超过 500 字符"
    if not _bounded_number(payload.get("year"), integer=True,
                           minimum=1, maximum=9999):
        return "year 必须是 1 到 9999 的整数"
    if not _bounded_number(payload.get("rymRating"), minimum=0, maximum=5):
        return "rymRating 必须在 0 到 5 之间"
    if not _bounded_number(payload.get("rymVotes"), integer=True, minimum=0,
                           maximum=MAX_SAFE_INTEGER):
        return "rymVotes 必须是非负安全整数"
    if not _bounded_text(payload.get("rymRank"), 500):
        return "rymRank 不能超过 500 字符"
    if not _http_url(payload.get("rymUrl")):
        return "rymUrl 必须是无账号信息的 HTTP/HTTPS URL"
    if not _text_list(payload.get("genres")):
        return "genres 最多 200 项，每项 1 到 200 字符"
    if not _text_list(payload.get("secondaryGenres")):
        return "secondaryGenres 最多 200 项，每项 1 到 200 字符"
    if not _text_list(payload.get("descriptors"), max_items=500,
                      max_item_length=500):
        return "descriptors 最多 500 项，每项 1 到 500 字符"

    cover = payload.get("coverPath")
    if cover not in (None, ""):
        normalized_cover = _storage_path(cover)
        if normalized_cover is None or not normalized_cover.startswith(folder + "/"):
            return "coverPath 必须位于该专辑目录内"

    tracks = payload.get("tracks")
    if not isinstance(tracks, list) or not tracks or len(tracks) > MAX_TRACKS:
        return f"tracks 必须包含 1 到 {MAX_TRACKS} 项"
    paths: set[str] = set()
    ids: set[str] = set()
    for index, track_data in enumerate(tracks, 1):
        if not isinstance(track_data, dict):
            return f"第 {index} 首曲目的数据必须是对象"
        path = _storage_path(track_data.get("path"))
        if path is None or not path.startswith(folder + "/"):
            return f"第 {index} 首曲目的 path 必须位于该专辑目录内"
        if path in paths:
            return f"第 {index} 首曲目的 path 重复: {path}"
        paths.add(path)
        track_id = hashlib.sha1(path.encode("utf-8")).hexdigest()[:16]
        if track_id in ids:
            return f"第 {index} 首曲目的路径哈希冲突: {path}"
        ids.add(track_id)
        if not _bounded_text(track_data.get("title"), 1000):
            return f"第 {index} 首曲目的 title 不能超过 1000 字符"
        if not _bounded_text(track_data.get("format"), 64):
            return f"第 {index} 首曲目的 format 不能超过 64 字符"
        for field in ("track", "disc"):
            if not _bounded_number(track_data.get(field), integer=True,
                                   minimum=1, maximum=MAX_SAFE_INTEGER):
                return f"第 {index} 首曲目的 {field} 必须是正安全整数"
        for field in ("duration", "bitrate"):
            if not _bounded_number(track_data.get(field), minimum=0):
                return f"第 {index} 首曲目的 {field} 必须是非负有限数"
        if not _bounded_number(track_data.get("size"), integer=True, minimum=0,
                               maximum=MAX_SAFE_INTEGER):
            return f"第 {index} 首曲目的 size 必须是非负安全整数"
        if "artists" in track_data:
            if error := artist_list_error(track_data["artists"], allow_empty=True):
                return f"第 {index} 首曲目的 artists {error}"
    return None


def cloud_ready(cfg: Config) -> bool:
    return bool(cfg.cloud_url and cfg.cloud_key)


def fetch_cloud_settings(cfg: Config) -> dict:
    """Fetch Admin-editable settings such as archive passwords and source URLs,
    while reporting a heartbeat. Return an empty dict when offline or undeployed
    so callers continue with local configuration."""
    if not cloud_ready(cfg):
        return {}
    try:
        r = requests.get(f"{cfg.cloud_url}/api/companion/settings",
                         headers={"X-Api-Key": cfg.cloud_key}, timeout=15)
        if r.status_code == 200:
            data = r.json()
            return data if isinstance(data, dict) else {}
        log.warning("companion settings HTTP %s", r.status_code)
    except (requests.RequestException, ValueError) as e:
        log.warning("companion settings unreachable: %s", e)
    return {}


def merge_cloud_passwords(cfg: Config) -> None:
    """Prefer archive passwords from Admin and fall back to local TOML, updating ``cfg.passwords`` in place."""
    remote = fetch_cloud_settings(cfg).get("archivePasswords") or []
    if not isinstance(remote, list):
        log.warning("cloud archivePasswords is not a list; keeping local values")
        remote = []
    remote = [value for value in remote if isinstance(value, str) and value]
    merged = list(dict.fromkeys([*remote, *cfg.passwords]))
    if merged != cfg.passwords:
        log.info("archive passwords refreshed from cloud (%d total)",
                 len(merged))
        cfg.passwords = merged


def od_folder(cfg: Config, album_dir: Path) -> str:
    root = cfg.music_root.resolve()
    rel = album_dir.resolve().relative_to(root).as_posix()
    return unicodedata.normalize("NFC", f"{OD_PREFIX}/{rel}")


def _first(tags: dict, *keys) -> str:
    for k in keys:
        v = tags.get(k)
        if v:
            return str(v[0] if isinstance(v, list) else v)
    return ""


def _tag_values(tags: dict, *keys) -> list[str]:
    """Return one tag's distinct values without guessing delimiters.

    Mutagen exposes a real multi-artist credit as multiple values. Commas and
    semicolons are also valid inside artist names, so a single value is never
    split heuristically.
    """
    for key in keys:
        value = tags.get(key)
        if not value:
            continue
        raw = value if isinstance(value, (list, tuple)) else [value]
        out: list[str] = []
        seen: set[str] = set()
        for item in raw:
            text = unicodedata.normalize("NFC", str(item).strip())
            marker = text.casefold()
            if text and marker not in seen:
                seen.add(marker)
                out.append(text)
        if out:
            return out
    return []


def _tag_year(tags: dict) -> str:
    """Return the first valid four-digit year, preferring originaldate.

    Some taggers store ``originaldate=0000`` as an unknown-date sentinel while
    keeping the real release year in ``date``. Treating that truthy string as
    authoritative produces year 0, which the Worker correctly rejects.
    """
    for key in ("originaldate", "date"):
        prefix = _first(tags, key).strip()[:4]
        if len(prefix) == 4 and prefix.isdigit() and 1 <= int(prefix) <= 9999:
            return prefix
    return ""


def _tag_index(text: str, default: int | None) -> int | None:
    """Normalize track/disc fractions and ignore zero/oversized sentinels."""
    token = text.strip().split("/", 1)[0]
    if token.isdigit():
        value = int(token)
        if 1 <= value <= MAX_SAFE_INTEGER:
            return value
    return default


def _audio_files(album_dir: Path) -> list[Path]:
    return sorted(f for f in album_dir.rglob("*")
                  if f.is_file() and f.suffix.lower() in AUDIO_EXTS)


def payload_for_album(cfg: Config, album_dir: Path) -> dict | None:
    """Build an ``/api/albums`` registration payload from file tags."""
    try:
        folder = od_folder(cfg, album_dir)
    except (OSError, ValueError) as exc:
        log.warning("refusing album outside music root: %s (%s)",
                    album_dir, exc)
        return None
    if _storage_path(folder) is None:
        log.warning("refusing album with invalid cloud folder: %s (%s)",
                    album_dir, folder)
        return None
    files = _audio_files(album_dir)
    if not files:
        return None
    if len(files) > MAX_TRACKS:
        log.warning("refusing album with too many tracks: %s (%d > %d)",
                    album_dir, len(files), MAX_TRACKS)
        return None
    tracks: list[dict] = []
    album_artist_groups: list[tuple[str, ...]] = []
    album_artist_sort_groups: list[tuple[str, ...]] = []
    track_artist_groups: list[tuple[str, ...]] = []
    track_artist_sort_groups: list[tuple[str, ...]] = []
    albums_t: list[str] = []
    years: list[str] = []
    rym: dict = {}
    genres: list[str] = []
    for f in files:
        try:
            audio = mutagen.File(f, easy=True)
        except Exception as exc:  # a damaged file must not abort the whole sync
            log.warning("metadata read failed for %s: %s", f, exc)
            continue
        if audio is None:
            continue
        t = audio.tags or {}
        title = (_first(t, "title") or f.stem).strip() or f.stem
        tno = _first(t, "tracknumber").split("/")[0]
        dno = _first(t, "discnumber").split("/")[0]
        album_names = _tag_values(t, "albumartist") or _tag_values(t, "artist")
        album_sorts = (_tag_values(t, "albumartistsort")
                       or _tag_values(t, "artistsort"))
        track_names = _tag_values(t, "artist") or album_names
        track_sorts = _tag_values(t, "artistsort") or album_sorts
        if not genres:
            g = t.get("genre")
            if g:
                values = list(g) if isinstance(g, list) else [str(g)]
                genres = [str(value).strip() for value in values
                          if str(value).strip()]
        duration = getattr(audio.info, "length", None) if audio.info else None
        duration = round(duration, 2) if isinstance(duration, (int, float)) \
            and math.isfinite(duration) and duration >= 0 else None
        bitrate = getattr(audio.info, "bitrate", None) if audio.info else None
        bitrate = round(bitrate / 1000) if isinstance(bitrate, (int, float)) \
            and math.isfinite(bitrate) and bitrate > 0 else None
        rel = unicodedata.normalize(
            "NFC", f.relative_to(album_dir).as_posix())
        try:
            size = f.stat().st_size
        except OSError as exc:
            log.warning("audio disappeared during metadata scan: %s: %s", f, exc)
            continue
        tracks.append({
            "path": f"{folder}/{rel}",
            "title": title,
            "track": _tag_index(tno, None),
            "disc": _tag_index(dno, 1),
            "duration": duration,
            "bitrate": bitrate,
            "format": f.suffix.lstrip(".").lower(),
            "size": size,
        })
        album_artist_groups.append(tuple(album_names))
        album_artist_sort_groups.append(tuple(album_sorts))
        track_artist_groups.append(tuple(track_names))
        track_artist_sort_groups.append(tuple(track_sorts))
        albums_t.append(_first(t, "album").strip())
        years.append(_tag_year(t))
        if not rym:
            try:
                raw = mutagen.File(f)  # Custom tags require the non-Easy interface.
                candidate = _rym_from_tags(raw)
                if any(candidate.get(key) not in (None, "", []) for key in (
                        "rating", "votes", "rank", "url", "descriptors",
                        "genres", "secondaryGenres")):
                    rym = candidate
            except Exception as exc:
                log.warning("custom tag read failed for %s: %s", f, exc)
    if not tracks:
        return None

    def common(vals: list[str]) -> str:
        vals = [v.strip() for v in vals if v and v.strip()]
        return Counter(vals).most_common(1)[0][0] if vals else ""

    def common_group(vals: list[tuple[str, ...]]) -> list[str]:
        groups = [group for group in vals if group]
        return list(Counter(groups).most_common(1)[0][0]) if groups else []

    cover = ""
    preferred_covers = ("cover.jpg", "cover.png", "folder.jpg", "front.jpg")
    try:
        by_name = {child.name.casefold(): child.name
                   for child in album_dir.iterdir() if child.is_file()}
    except OSError:
        by_name = {}
    for wanted in preferred_covers:
        if actual := by_name.get(wanted):
            cover = f"{folder}/{actual}"
            break

    year = common(years)
    artist_names = common_group(album_artist_groups) or [album_dir.parent.name]
    tagged_sorts = common_group(album_artist_sort_groups)
    cache = ArtistCache(cfg.state_dir / "artist_map.json")

    def artist_credits(names: list[str], sorts: list[str]) -> list[dict]:
        credits: list[dict] = []
        for index, name in enumerate(names):
            artist_sort = sorts[index] if len(sorts) == len(names) else ""
            if not artist_sort:
                try:
                    artist_sort = resolve_sort_name(name, cache=cache)
                except Exception as exc:
                    log.warning("artist sort lookup failed for %s: %s", name, exc)
            credits.append({"name": name, "sort": artist_sort or name})
        return credits

    album_credits = artist_credits(artist_names, tagged_sorts)
    for track, names_group, sorts_group in zip(
            tracks, track_artist_groups, track_artist_sort_groups):
        track_names = list(names_group)
        if not track_names or track_names == artist_names:
            continue
        track["artists"] = artist_credits(track_names, list(sorts_group))
    credit_separator = " × " if len(artist_names) == 2 else ", "
    artist = credit_separator.join(artist_names)
    payload = {
        "folder": folder,
        "artist": artist,
        "artistSort": album_credits[0]["sort"],
        "artists": album_credits,
        "title": common(albums_t) or album_dir.name,
        "year": int(year) if year.isdigit() else None,
        "coverPath": cover,
        "genres": rym.get("genres") or genres[:8],
        "secondaryGenres": rym.get("secondaryGenres", []),
        "descriptors": rym.get("descriptors", []),
        "rymRating": rym.get("rating"),
        "rymVotes": rym.get("votes"),
        "rymRank": rym.get("rank", ""),
        "rymUrl": rym.get("url", ""),
        "tracks": tracks,
    }
    if error := validate_album_payload(payload):
        log.warning("refusing invalid album payload for %s: %s", album_dir, error)
        return None
    return payload


def _rym_from_tags(audio) -> dict:
    """Read RYM data from custom TXXX/Vorbis tags."""
    def get(key: str) -> str:
        if audio is None or audio.tags is None:
            return ""
        tags = audio.tags
        if hasattr(tags, "getall"):  # ID3
            fr = tags.getall(f"TXXX:{key}")
            return str(fr[0]) if fr else ""
        v = tags.get(key)
        if not v:
            v = tags.get(f"----:com.apple.iTunes:{key}")
        if not v:
            return ""
        value = v[0] if isinstance(v, (list, tuple)) else v
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return str(value)

    def number(text: str, cast):
        try:
            value = cast(text) if text else None
            if isinstance(value, float) and not math.isfinite(value):
                return None
            return value
        except (TypeError, ValueError):
            return None

    rating = get("RYM_RATING")
    genres = [g for g in get("RYM_GENRES").split("; ") if g]
    secondary = [g for g in get("RYM_SECONDARY_GENRES").split("; ") if g]
    secondary_keys = {g.casefold() for g in secondary}
    out = {
        "rating": number(rating, float),
        "votes": number(get("RYM_VOTES"), int),
        "rank": get("RYM_RANK").split(" , ")[0],
        "url": get("RYM_URL"),
        "descriptors": [d for d in get("RYM_DESCRIPTORS").split("; ") if d],
    }
    if genres:
        out["genres"] = [g for g in genres if g.casefold() not in secondary_keys]
        out["secondaryGenres"] = secondary
    return out


def rclone_upload(cfg: Config, album_dir: Path | None, console) -> bool:
    """Run incremental ``rclone copy``; ``album_dir=None`` means the full library."""
    if not cfg.rclone:
        console.print("[red]未找到 rclone，无法上传[/red]")
        return False
    if album_dir is None:
        src, dst = str(cfg.music_root), cfg.rclone_remote
    else:
        try:
            rel = album_dir.resolve().relative_to(cfg.music_root.resolve()).as_posix()
        except ValueError:
            console.print("[red]拒绝上传曲库目录之外的路径[/red]")
            return False
        src, dst = str(album_dir), f"{cfg.rclone_remote}/{rel}"
    cmd = [str(cfg.rclone), "copy", src, dst,
           "--transfers", "4", "--checkers", "8", "-q"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace",
                           timeout=6 * 3600)
    except subprocess.TimeoutExpired:
        console.print("[red]rclone 上传超时（6 小时）[/red]")
        log.error("rclone upload timed out: %s", src)
        return False
    except OSError as exc:
        console.print(f"[red]无法启动 rclone[/red]: {exc}")
        log.error("rclone upload could not start: %s", exc)
        return False
    if r.returncode != 0:
        console.print(f"[red]rclone 上传失败[/red]: {r.stderr.strip()[:300]}")
        log.error("rclone failed: %s", r.stderr)
        return False
    return True


def register_album(cfg: Config, payload: dict) -> tuple[bool, str]:
    if error := validate_album_payload(payload):
        return False, f"本地专辑数据无效: {error}"
    try:
        r = requests.post(f"{cfg.cloud_url}/api/albums", json=payload,
                          headers={"X-Api-Key": cfg.cloud_key}, timeout=30)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, dict) and data.get("id"):
                return True, str(data["id"])
            return False, "云端返回缺少专辑 id"
        return False, f"HTTP {r.status_code}: {r.text[:200]}"
    except (requests.RequestException, ValueError) as e:
        return False, str(e)


def album_dirs(cfg: Config) -> list[Path]:
    # beets places compilations under _compilations/ (see the comp path in
    # beets.yaml.tmpl), and watch registers them individually by library_path. If
    # full sync skipped that directory, those albums could never be reconciled
    # after a D1 rebuild or tag change. Other underscore directories remain
    # internal, such as quarantine, and should still be skipped.
    included_underscore = {"_compilations"}
    out = []
    for artist in sorted(cfg.music_root.iterdir()):
        if not artist.is_dir():
            continue
        if artist.name.startswith("_") and artist.name not in included_underscore:
            continue
        for album in sorted(artist.iterdir()):
            if album.is_dir() and _audio_files(album):
                out.append(album)
    return out


# ------------------------------------------------------------------ pull
# Albums imported on the web initially exist only in the cloud; pulling them into
# the local library makes them available to local players and other tools.


def cloud_library(cfg: Config) -> list[dict]:
    """Return every cloud-registered album through ``/api/library`` using the companion key."""
    r = requests.get(f"{cfg.cloud_url}/api/library?hidden=1",
                     headers={"X-Api-Key": cfg.cloud_key}, timeout=30)
    r.raise_for_status()
    data = r.json()
    if not isinstance(data, list) or any(not isinstance(row, dict)
                                         for row in data):
        raise ValueError("云端 library 响应格式无效")
    return data


def cloud_album_detail(cfg: Config, album_id: str) -> dict | None:
    try:
        r = requests.get(f"{cfg.cloud_url}/api/album/{album_id}",
                         headers={"X-Api-Key": cfg.cloud_key}, timeout=30)
        if r.status_code != 200:
            return None
        data = r.json()
        return data if isinstance(data, dict) else None
    except (requests.RequestException, ValueError) as exc:
        log.warning("cloud album detail unavailable for %s: %s", album_id, exc)
        return None


def _local_dir_for(cfg: Config, folder: str) -> Path | None:
    """Convert ``Music/Library/Artist/[1980] Album`` to a local path; return None for a mismatched prefix."""
    folder = unicodedata.normalize("NFC", str(folder or ""))
    if "\\" in folder or not folder.startswith(OD_PREFIX + "/"):
        return None
    rel = folder[len(OD_PREFIX) + 1:]
    parts = rel.split("/")
    if not parts or any(
        not part or part in (".", "..")
        or any(ord(ch) < 32 for ch in part)
        or (len(part) >= 2 and part[1] == ":")
        for part in parts
    ):
        return None
    root = cfg.music_root.resolve()
    dest = root.joinpath(*parts).resolve()
    try:
        dest.relative_to(root)
    except ValueError:
        return None
    return dest


def rclone_download(cfg: Config, folder: str, dest: Path, console) -> bool:
    """Incrementally copy one OneDrive album locally; ``folder`` is relative to OneDrive."""
    if not cfg.rclone:
        console.print("[red]未找到 rclone，无法下载[/red]")
        return False
    safe_dest = _local_dir_for(cfg, folder)
    if safe_dest is None or safe_dest != dest.resolve():
        log.error("refusing unsafe cloud folder: %r", folder)
        return False
    rel = folder[len(OD_PREFIX) + 1:]
    cmd = [str(cfg.rclone), "copy", f"{cfg.rclone_remote}/{rel}", str(dest),
           "--transfers", "4", "--checkers", "8", "-q"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace",
                           timeout=6 * 3600)
    except subprocess.TimeoutExpired:
        console.print("[red]rclone 下载超时（6 小时）[/red]")
        log.error("rclone pull timed out for %s", folder)
        return False
    except OSError as exc:
        console.print(f"[red]无法启动 rclone[/red]: {exc}")
        log.error("rclone pull could not start: %s", exc)
        return False
    if r.returncode != 0:
        console.print(f"[red]rclone 下载失败[/red]: {r.stderr.strip()[:300]}")
        log.error("rclone pull failed for %s: %s", folder, r.stderr)
        return False
    return True


def _pull_marker(cfg: Config, folder: str) -> Path:
    """Persistent marker for a cloud pull that has not finished end to end."""
    normalized = unicodedata.normalize("NFC", folder)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return cfg.state_dir / "cloud_pull_incomplete" / f"{digest}.pending"


def _mark_pull_incomplete(cfg: Config, folder: str) -> bool:
    marker = _pull_marker(cfg, folder)
    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(unicodedata.normalize("NFC", folder), encoding="utf-8")
    except OSError as exc:
        log.error("could not persist cloud pull marker for %s: %s", folder, exc)
        return False
    return True


def _clear_pull_marker(cfg: Config, folder: str) -> bool:
    marker = _pull_marker(cfg, folder)
    try:
        marker.unlink(missing_ok=True)
    except OSError as exc:
        log.error("could not clear cloud pull marker for %s: %s", folder, exc)
        return False
    return True


def _has_partial_files(dest: Path) -> bool:
    try:
        return any(path.is_file() and path.name.lower().endswith(".partial")
                   for path in dest.rglob("*"))
    except OSError:
        return True


def _download_tree_complete(dest: Path) -> bool:
    """A finished album has audio and no rclone temporary files."""
    return dest.is_dir() and bool(_audio_files(dest)) and not _has_partial_files(dest)


def _pull_needs_download(cfg: Config, folder: str, dest: Path) -> bool:
    """Recover both marked pulls and legacy interrupted rclone directories."""
    return (_pull_marker(cfg, folder).exists()
            or not _download_tree_complete(dest))


# --- Write cloud metadata into file tags ------------------------------------
# Web uploads often lack good tags, leaving metadata only in the cloud database.
# Because OneDrive is authoritative, files must be self-describing: after pulling
# them down, add standard tags from cloud data and upload changed files again so
# either copy remains recognizable by any player.


def _desired_tags(album: dict, track: dict | None) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    album_credits = album.get("artists")
    if isinstance(album_credits, list) and album_credits:
        album_names = [str(item.get("name") or "").strip() for item in album_credits
                 if isinstance(item, dict) and str(item.get("name") or "").strip()]
        album_sorts = [str(item.get("sort") or item.get("name") or "").strip()
                 for item in album_credits if isinstance(item, dict)
                 and str(item.get("name") or "").strip()]
    else:
        album_names = ([str(album.get("artist") or "").strip()]
                       if album.get("artist") else [])
        album_sorts = ([str(album.get("artistSort") or album_names[0]).strip()]
                       if album_names else [])
    track_credits = track.get("artists") if track else None
    if isinstance(track_credits, list) and track_credits:
        track_names = [str(item.get("name") or "").strip() for item in track_credits
                       if isinstance(item, dict)
                       and str(item.get("name") or "").strip()]
        track_sorts = [str(item.get("sort") or item.get("name") or "").strip()
                       for item in track_credits if isinstance(item, dict)
                       and str(item.get("name") or "").strip()]
    else:
        track_names, track_sorts = album_names, album_sorts
    if album_names:
        out["albumartist"] = album_names
        if (len(album_sorts) == len(album_names)
                and any(sort_name != name for sort_name, name
                        in zip(album_sorts, album_names))):
            out["albumartistsort"] = album_sorts
    if track_names:
        out["artist"] = track_names
        if (len(track_sorts) == len(track_names)
                and any(sort_name != name for sort_name, name
                        in zip(track_sorts, track_names))):
            out["artistsort"] = track_sorts
    if album.get("title"):
        out["album"] = [album["title"]]
    if album.get("year"):
        out["date"] = [str(album["year"])]
    genres = album.get("genres") or []
    if genres:
        out["genre"] = [str(g) for g in genres]
    if track:
        if track.get("title"):
            out["title"] = [track["title"]]
        if track.get("track"):
            out["tracknumber"] = [str(track["track"])]
        if track.get("disc"):
            out["discnumber"] = [str(track["disc"])]
    return out


def _tag_satisfied(key: str, current: list[str], want: list[str]) -> bool:
    """Return whether an existing value is equivalent to the target, preserving
    carefully edited tags when possible. A full date such as 1978-06-25 satisfies
    year 1978; ``3/10`` satisfies track 3; per-track artists such as featured
    performers are added only when entirely absent."""
    cur = [str(v) for v in current]
    if key == "artist":
        return bool(cur)                      # Preserve any existing value.
    if key == "discnumber" and not cur:
        return want[0].lstrip("0") in ("", "1")  # Do not force disc=1 for a single-disc album.
    if not cur:
        return False
    if key == "date":
        return cur[0][:4] == want[0][:4]
    if key in ("tracknumber", "discnumber"):
        return cur[0].split("/")[0].lstrip("0") == want[0].lstrip("0")
    return cur == want


def retag_album(cfg: Config, album_dir: Path, album: dict,
                tracks: list[dict]) -> int:
    """Complete file tags from cloud metadata and return the number of changed files; zero means they already matched."""
    if not album_dir.exists():
        return 0
    track_paths = [
        (unicodedata.normalize("NFC", str(t.get("path") or "").replace("\\", "/")), t)
        for t in tracks
    ]
    changed = 0
    for f in _audio_files(album_dir):
        try:
            audio = mutagen.File(f, easy=True)
            if audio is None:
                continue
            if audio.tags is None:
                audio.add_tags()
            rel = unicodedata.normalize("NFC", f.relative_to(album_dir).as_posix())
            matches = [t for path, t in track_paths
                       if path == rel or path.endswith("/" + rel)]
            track = matches[0] if len(matches) == 1 else None
            want = _desired_tags(album, track)
            dirty = False
            for key, vals in want.items():
                if not _tag_satisfied(key, audio.tags.get(key) or [], vals):
                    audio.tags[key] = vals
                    dirty = True
            if dirty:
                audio.save()
                changed += 1
        except Exception as e:  # noqa: BLE001 - one file failure must not sink the whole album
            log.warning("retag failed for %s: %s", f, e)
    return changed


def run_pull(cfg: Config, console, quiet: bool = False,
             retag_existing: bool = False) -> int:
    """Pull albums present in the cloud but missing locally into MUSIC_ROOT. Fill
    their tags from cloud metadata and upload the changes because authoritative
    OneDrive files must be self-describing. With ``retag_existing=True``, repair
    tags for cloud albums that already exist locally as well."""
    if not cloud_ready(cfg):
        if not quiet:
            console.print("[yellow]未配置 [cloud] — 无法拉取。[/yellow]")
        return 1
    try:
        remote = cloud_library(cfg)
    except (requests.RequestException, ValueError) as e:
        if not quiet:
            console.print(f"[red]云端不可达[/red]: {e}")
        log.warning("cloud pull: library unreachable: %s", e)
        return 1
    todo: list[tuple[dict, Path, bool]] = []  # (album, dest, need_download)
    invalid = 0
    for a in remote:
        if not isinstance(a.get("folder"), str) or not a.get("id"):
            invalid += 1
            log.error("skipping malformed cloud album row: %r", a)
            continue
        dest = _local_dir_for(cfg, a["folder"])
        if dest is None:
            invalid += 1
            log.error("skipping unsafe cloud album folder: %r", a.get("folder"))
            continue
        if _pull_needs_download(cfg, a["folder"], dest):
            todo.append((a, dest, True))
        elif retag_existing:
            todo.append((a, dest, False))
    if not todo:
        if not quiet:
            console.print("本地库已是最新（云端没有本地缺失的专辑）。")
        return 1 if invalid else 0
    news = sum(1 for _, _, dl in todo if dl)
    if news or not quiet:
        console.print(f"云端 {len(todo)} 张待处理（{news} 张本地缺失）…")
    ok = retagged = 0
    fail = invalid
    for a, dest, need_download in todo:
        if need_download:
            if not _mark_pull_incomplete(cfg, a["folder"]):
                fail += 1
                console.print(f"  [red]无法保存拉取状态[/red] {a.get('title', '')}")
                continue
            if not rclone_download(cfg, a["folder"], dest, console):
                # Keep completed files and rclone artifacts so a later
                # watcher/process retries the album instead of silently
                # treating the half-tree as complete. Rclone itself does not
                # resume bytes from a previous .partial file across runs.
                fail += 1
                continue
            if not _download_tree_complete(dest):
                fail += 1
                console.print(f"  [red]下载内容不完整[/red] {a.get('title', '')}")
                continue
        detail = cloud_album_detail(cfg, a["id"])
        if detail is None:
            fail += 1
            console.print(f"  [red]无法读取云端专辑详情[/red]: {a.get('title', '')}")
            continue
        changed = retag_album(cfg, dest, a, detail.get("tracks") or [])
        if changed:
            retagged += 1
            # Tags changed: upload to keep authoritative OneDrive self-describing,
            # then refresh cloud registration.
            payload = payload_for_album(cfg, dest)
            if not payload:
                fail += 1
                console.print(f"  [red]无法重新登记[/red] {a.get('title', '')}")
                continue
            if not rclone_upload(cfg, dest, console):
                fail += 1
                console.print(f"  [red]回传失败[/red] {a.get('title', '')}")
                continue
            registered, info = register_album(cfg, payload)
            if not registered:
                fail += 1
                console.print(f"  [red]重新登记失败[/red]: {info}")
                continue
        if need_download and not _clear_pull_marker(cfg, a["folder"]):
            fail += 1
            console.print(f"  [red]无法清除拉取状态[/red] {a.get('title', '')}")
            continue
        if need_download or changed:
            ok += 1
            mark = "↓" if need_download else "写"  # The GBK console cannot render more decorative symbols.
            console.print(f"  [green]{mark}[/green] {a['artist']} — "
                          f"{a['title']}"
                          + (f"（补写 {changed} 个文件的 tag）" if changed else ""))
    if ok:
        console.print(
            f"完成：{ok} 张就绪（其中补 tag {retagged} 张）。"
            + (f"（{fail} 张失败）" if fail else ""))
    return 1 if fail else 0


def pull_quietly(cfg: Config, console) -> None:
    """Heartbeat helper for watch: log failures without ever stopping the watcher."""
    try:
        run_pull(cfg, console, quiet=True)
    except Exception:  # noqa: BLE001
        log.exception("cloud pull crashed inside watch")


def run_sync(cfg: Config, console, upload: bool = True,
             only_dir: Path | None = None) -> int:
    if not cloud_ready(cfg):
        console.print("[yellow]未配置 [cloud]（url / api_key）— 跳过云同步。"
                      "运行 tools\\deploy-cloud.cmd 部署后会自动写入。[/yellow]")
        return 0
    dirs = [only_dir] if only_dir else album_dirs(cfg)
    console.print(f"mihonban cloud sync — {len(dirs)} 张专辑 → {cfg.cloud_url}")
    prepared: list[tuple[Path, dict]] = []
    invalid = 0
    for directory in dirs:
        payload = payload_for_album(cfg, directory)
        if payload is None:
            invalid += 1
            console.print(f"  [red]预检失败[/red] {directory}")
        else:
            prepared.append((directory, payload))
    if invalid:
        console.print(f"已停止：{invalid} 张专辑未通过本地预检，未开始上传。")
        return 1
    if not prepared:
        console.print("没有需要同步的专辑。")
        return 0
    if upload:
        console.print("  rclone 增量上传中…")
        if not rclone_upload(cfg, only_dir, console):
            return 1
    ok = fail = 0
    for d, payload in prepared:
        good, info = register_album(cfg, payload)
        if good:
            ok += 1
            console.print(f"  [green]OK[/green] {payload['artist']} — "
                          f"{payload['title']}")
        else:
            fail += 1
            console.print(f"  [red]失败[/red] {d.name}: {info}")
    console.print(f"完成：{ok} 登记成功，{fail} 失败。")
    return 1 if fail else 0
