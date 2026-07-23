"""mihonban cloud —— 本地曲库与 Cloudflare Worker 同步。

`mihonban cloud sync`：
  1. rclone copy 把 MUSIC_ROOT 增量上传到 OneDrive（只传新增/变化）；
  2. 逐专辑读文件 tag（含 RYM 自定义 tag）→ POST /api/albums 幂等登记。

album id 与 Worker 端一致：sha1(NFC(folder))[:16]，folder 形如
"Music/Library/山下達郎/[1978] GO AHEAD!"。
"""

from __future__ import annotations

import hashlib
import logging
import math
import shutil
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
    folder = _storage_path(payload.get("folder"))
    if folder is None:
        return f"folder 路径无效或超过 {MAX_STORAGE_PATH} 字符"
    if not _bounded_text(payload.get("artist"), 500, allow_empty=False):
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
    return None


def cloud_ready(cfg: Config) -> bool:
    return bool(cfg.cloud_url and cfg.cloud_key)


def fetch_cloud_settings(cfg: Config) -> dict:
    """拉取后台可改的设置（解压密码、资源站网址）；顺带向后台报心跳。
    离线/未部署时返回空 dict，调用方按本地配置继续。"""
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
    """后台配置的解压密码优先，本地 toml 的兜底（就地更新 cfg.passwords）。"""
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


def _audio_files(album_dir: Path) -> list[Path]:
    return sorted(f for f in album_dir.rglob("*")
                  if f.is_file() and f.suffix.lower() in AUDIO_EXTS)


def payload_for_album(cfg: Config, album_dir: Path) -> dict | None:
    """从文件 tag 构造 /api/albums 的登记 payload。"""
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
    tracks, artists, albums_t, years = [], [], [], []
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
        artists.append((_first(t, "albumartist")
                        or _first(t, "artist")).strip())
        albums_t.append(_first(t, "album").strip())
        years.append((_first(t, "originaldate") or _first(t, "date"))[:4])
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
            "track": int(tno) if tno.isdigit() else None,
            "disc": int(dno) if dno.isdigit() else 1,
            "duration": duration,
            "bitrate": bitrate,
            "format": f.suffix.lstrip(".").lower(),
            "size": size,
        })
        if not rym:
            try:
                raw = mutagen.File(f)  # 自定义 tag 要走非 easy 接口
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
    payload = {
        "folder": folder,
        "artist": common(artists) or album_dir.parent.name,
        "artistSort": "",
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
    """从 TXXX/Vorbis 自定义 tag 读回 RYM 数据。"""
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
    out = {
        "rating": number(rating, float),
        "votes": number(get("RYM_VOTES"), int),
        "rank": get("RYM_RANK").split(" , ")[0],
        "url": get("RYM_URL"),
        "descriptors": [d for d in get("RYM_DESCRIPTORS").split("; ") if d],
    }
    if genres:
        out["genres"] = genres
        out["secondaryGenres"] = []
    return out


def rclone_upload(cfg: Config, album_dir: Path | None, console) -> bool:
    """rclone copy（增量）。album_dir=None 表示整库。"""
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
    out = []
    for artist in sorted(cfg.music_root.iterdir()):
        if not artist.is_dir() or artist.name.startswith("_"):
            continue
        for album in sorted(artist.iterdir()):
            if album.is_dir() and _audio_files(album):
                out.append(album)
    return out


# ------------------------------------------------------------------ pull
# 网页导入的专辑只存在于云端；拉回本地库后可由本机播放器或其他工具使用。


def cloud_library(cfg: Config) -> list[dict]:
    """云端登记的全部专辑（伴侣 key 走 /api/library）。"""
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
    """'Music/Library/Artist/[1980] Album' → 本地路径；前缀不符返回 None。"""
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
    """OneDrive 单张专辑 → 本地（增量）。folder 是 OneDrive 相对路径。"""
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


# --- 把云端元数据写进文件 tag ---------------------------------------
# 网页上传的文件往往没有（好）tag，元数据只在云端 DB 里。OneDrive 既是
# 主源，文件就必须自描述：拉回后按云端数据补写标准 tag，再把改过的
# 文件传回去，让两份副本都是"拿到任何播放器都能认"的状态。


def _desired_tags(album: dict, track: dict | None) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    if album.get("artist"):
        out["albumartist"] = [album["artist"]]
        out["artist"] = [album["artist"]]
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
    """已有值是否等价于目标值 —— 等价就不动，保护精修 tag：
    完整日期 1978-06-25 满足年份 1978；"3/10" 满足音轨 3；
    per-track artist（feat 等）只在完全缺失时才补。"""
    cur = [str(v) for v in current]
    if key == "artist":
        return bool(cur)                      # 有就不动
    if key == "discnumber" and not cur:
        return want[0].lstrip("0") in ("", "1")  # 单碟不强写 disc=1
    if not cur:
        return False
    if key == "date":
        return cur[0][:4] == want[0][:4]
    if key in ("tracknumber", "discnumber"):
        return cur[0].split("/")[0].lstrip("0") == want[0].lstrip("0")
    return cur == want


def retag_album(cfg: Config, album_dir: Path, album: dict,
                tracks: list[dict]) -> int:
    """按云端元数据补写文件 tag；返回实际改动的文件数（0 = 本来就对）。"""
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
        except Exception as e:  # noqa: BLE001 — 单文件失败不拖累整张
            log.warning("retag failed for %s: %s", f, e)
    return changed


def run_pull(cfg: Config, console, quiet: bool = False,
             retag_existing: bool = False) -> int:
    """把云端有、本地没有的专辑拉回 MUSIC_ROOT；拉回的文件按云端元数据
    补写 tag 并回传（OneDrive 主源必须自描述）。retag_existing=True 时
    对本地已有的云端专辑也做一遍补 tag（修存量）。"""
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
        if not dest.exists():
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
        if need_download and not rclone_download(cfg, a["folder"], dest,
                                                 console):
            # rclone may create the destination before a network/error exit.
            # Leaving that half-tree makes the next run mistake it for a
            # complete album and skip the download forever.
            if dest.exists():
                shutil.rmtree(dest, ignore_errors=True)
            fail += 1
            continue
        detail = cloud_album_detail(cfg, a["id"])
        if detail is None:
            if need_download and dest.exists():
                shutil.rmtree(dest, ignore_errors=True)
            fail += 1
            console.print(f"  [red]无法读取云端专辑详情[/red]: {a.get('title', '')}")
            continue
        changed = retag_album(cfg, dest, a, detail.get("tracks") or [])
        if changed:
            retagged += 1
            # tag 变了：回传 OneDrive 让主源同样自描述，并刷新云端登记
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
        if need_download or changed:
            ok += 1
            mark = "↓" if need_download else "写"  # GBK 控制台放不下花哨符号
            console.print(f"  [green]{mark}[/green] {a['artist']} — "
                          f"{a['title']}"
                          + (f"（补写 {changed} 个文件的 tag）" if changed else ""))
    if ok:
        console.print(
            f"完成：{ok} 张就绪（其中补 tag {retagged} 张）。"
            + (f"（{fail} 张失败）" if fail else ""))
    return 1 if fail else 0


def pull_quietly(cfg: Config, console) -> None:
    """watch 心跳用：失败只写日志，绝不打断守望。"""
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
