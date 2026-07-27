"""`mihonban rym write` — write matched RYM data into file custom tags.

Custom RYM tags are written into each audio file so metadata remains portable
across storage providers and players. A human-readable COMMENT tag is written
alongside the structured fields.

Dry-run is the default; --apply writes changed files only (idempotent).
"""

from __future__ import annotations

import logging
from pathlib import Path

import mutagen
from mutagen.id3 import COMM, ID3, ID3NoHeaderError, TCON, TXXX
from mutagen.mp4 import MP4

from ..config import Config
from ..extract import AUDIO_EXTS
from . import db

log = logging.getLogger("mihonban.rym.write")

FIELDS = ("RYM_RATING", "RYM_VOTES", "RYM_GENRES", "RYM_DESCRIPTORS",
          "RYM_URL", "RYM_RANK")


def _values(row) -> dict[str, str]:
    genres = row["primary_genres"] or ""
    sec = row["secondary_genres"] or ""
    if sec:
        genres = f"{genres}; {sec}" if genres else sec
    vals = {
        "RYM_RATING": "" if row["rating"] is None else f"{row['rating']:.2f}",
        "RYM_VOTES": "" if row["votes"] is None else str(row["votes"]),
        "RYM_GENRES": genres,
        "RYM_DESCRIPTORS": row["descriptors"] or "",
        "RYM_URL": row["rym_url"] or "",
        "RYM_RANK": (row["rank"] or "").strip(),
    }
    return {k: v for k, v in vals.items() if v}


def _comment(row) -> str:
    """Human-readable line for the album page: exact rating up front."""
    parts = []
    if row["rating"] is not None:
        votes = f" ({row['votes']:,} votes)" if row["votes"] else ""
        parts.append(f"RYM {row['rating']:.2f}{votes}")
    rank = (row["rank"] or "").split(" , ")[0].strip()
    if rank:
        parts.append(rank)
    vals = _values(row)
    if vals.get("RYM_GENRES"):
        parts.append(vals["RYM_GENRES"])
    return " · ".join(parts)


def _genre_list(row) -> list[str]:
    """RYM primary + secondary genres for the real GENRE tag."""
    vals = _values(row)
    return [g for g in vals.get("RYM_GENRES", "").split("; ") if g][:8]


def _write_id3(path: Path, vals: dict[str, str], comment: str,
               apply: bool, genres: list[str]) -> bool:
    try:
        tags = ID3(path)
    except ID3NoHeaderError:
        tags = ID3()
    changed = _apply_id3_frames(tags, vals, comment, genres)
    if changed and apply:
        tags.save(path)
    return changed


def _write_id3_container(path: Path, vals: dict[str, str], comment: str,
                         apply: bool, genres: list[str]) -> bool:
    """WAV/AIFF/DSF：ID3 藏在容器 chunk 里，须经 mutagen.File 读写。
    直接 ID3(path) 找不到 chunk，而 Vorbis 路径的纯字符串赋值会被
    ID3Tags 以 TypeError 拒绝（帧对象才合法）——两头都走不通，只能分派。"""
    audio = mutagen.File(path)
    if audio is None:
        return False
    if audio.tags is None:
        audio.add_tags()
    changed = _apply_id3_frames(audio.tags, vals, comment, genres)
    if changed and apply:
        audio.save()
    return changed


def _apply_id3_frames(tags, vals: dict[str, str], comment: str,
                      genres: list[str]) -> bool:
    changed = False
    for key in FIELDS:
        val = vals.get(key)
        frame = tags.getall(f"TXXX:{key}")
        if val:
            if frame and str(frame[0]) == val and len(frame) == 1:
                continue
            tags.setall(f"TXXX:{key}",
                        [TXXX(encoding=3, desc=key, text=[val])])
            changed = True
        elif frame:
            tags.delall(f"TXXX:{key}")
            changed = True
    if comment:
        existing = tags.getall("COMM")
        rym = [c for c in existing if str(c).lstrip().startswith("RYM ")]
        other = [c for c in existing if c not in rym]
        if len(rym) != 1 or str(rym[0]) != comment or len(other) + 1 != len(existing):
            tags.setall("COMM", other + [COMM(encoding=3, lang="eng", desc="RYM",
                                              text=[comment])])
            changed = True
    else:
        existing = tags.getall("COMM")
        other = [c for c in existing
                 if not str(c).lstrip().startswith("RYM ")]
        if len(other) != len(existing):
            tags.setall("COMM", other)
            changed = True
    if genres:
        cur = tags.getall("TCON")
        if not cur or list(cur[0].text) != genres:
            tags.setall("TCON", [TCON(encoding=3, text=genres)])
            changed = True
    return changed


def _write_vorbis(path: Path, vals: dict[str, str], comment: str,
                  apply: bool, genres: list[str]) -> bool:
    audio = mutagen.File(path)
    if audio is None:
        return False
    if audio.tags is None:
        audio.add_tags()
    changed = False
    for key in FIELDS:
        val = vals.get(key)
        current = audio.tags.get(key) or []
        if val:
            if current == [val]:
                continue
            audio.tags[key] = [val]
            changed = True
        elif current:
            del audio.tags[key]
            changed = True
    current_comments = audio.tags.get("COMMENT") or []
    if not isinstance(current_comments, list):
        current_comments = [current_comments]
    other_comments = [str(v) for v in current_comments
                      if not str(v).lstrip().startswith("RYM ")]
    wanted_comments = other_comments + ([comment] if comment else [])
    if current_comments != wanted_comments:
        audio.tags["COMMENT"] = wanted_comments
        changed = True
    if genres and audio.tags.get("GENRE") != genres:
        audio.tags["GENRE"] = genres
        changed = True
    if changed and apply:
        audio.save()
    return changed


def _write_mp4(path: Path, vals: dict[str, str], comment: str,
               apply: bool, genres: list[str]) -> bool:
    audio = MP4(path)
    if audio.tags is None:
        audio.add_tags()
    changed = False
    for key in FIELDS:
        atom = f"----:com.apple.iTunes:{key}"
        val = vals.get(key)
        data = [val.encode("utf-8")] if val else []
        if val and audio.tags.get(atom) == data:
            continue
        if val:
            audio[atom] = data
            changed = True
        elif atom in audio.tags:
            del audio[atom]
            changed = True
    current_comments = (audio.tags or {}).get("\xa9cmt") or []
    other_comments = [str(v) for v in current_comments
                      if not str(v).lstrip().startswith("RYM ")]
    wanted_comments = other_comments + ([comment] if comment else [])
    if current_comments != wanted_comments:
        audio["\xa9cmt"] = wanted_comments
        changed = True
    if genres and (audio.tags or {}).get("\xa9gen") != genres:
        audio["\xa9gen"] = genres
        changed = True
    if changed and apply:
        audio.save()
    return changed


def write_album(album_path: Path, row, apply: bool) -> tuple[int, int]:
    """Returns (files_changed, files_total)."""
    vals = _values(row)
    comment = _comment(row)
    genres = _genre_list(row)
    changed = total = 0
    for f in sorted(album_path.rglob("*")):
        if not (f.is_file() and f.suffix.lower() in AUDIO_EXTS):
            continue
        total += 1
        suffix = f.suffix.lower()
        try:
            if suffix == ".mp3":
                did = _write_id3(f, vals, comment, apply, genres)
            elif suffix in (".m4a", ".mp4"):
                did = _write_mp4(f, vals, comment, apply, genres)
            elif suffix in (".wav", ".aiff", ".dsf"):
                did = _write_id3_container(f, vals, comment, apply, genres)
            else:
                did = _write_vorbis(f, vals, comment, apply, genres)
            changed += bool(did)
        # TypeError 兜底：任何标签容器与写法不匹配的个例只跳过该文件，
        # 绝不让一个坏文件中断整轮写入（半写状态很难人工恢复）。
        except (mutagen.MutagenError, OSError, ValueError, UnicodeError,
                TypeError) as e:
            log.error("rym write failed on %s: %s", f, e)
    return changed, total


def run_write(cfg: Config, console, apply: bool = False) -> int:
    con = db.connect(cfg.rym_db)
    try:
        matches = db.confirmed_matches(con)
        if not matches:
            console.print("[yellow]没有已确认的匹配 — 先运行 mihonban rym match[/yellow]")
            return 0
        mode = "[green]APPLY[/green]" if apply else "[cyan]DRY-RUN[/cyan]"
        console.print(f"mihonban rym write {mode} — {len(matches)} 张专辑")
        for row in matches:
            album_path = Path(row["album_path"])
            if not album_path.is_dir():
                console.print(f"  [red]路径不存在[/red] {album_path} "
                              "（专辑被移动过？重跑 mihonban rym match）")
                continue
            vals = _values(row)
            changed, total = write_album(album_path, row, apply)
            console.print(
                f"  {'写入' if apply else '将写入'} {changed}/{total} 文件  "
                f"{row['artist']} — {row['title']}  "
                f"rating={vals.get('RYM_RATING', '-')} | "
                f"{vals.get('RYM_GENRES', '-')}")
        if not apply:
            console.print("\n[bold]dry-run 完成，未改动文件。[/bold]"
                          "执行写入: [green]mihonban rym write --apply[/green]")
            return 0
        console.print("完成：RYM 结构化字段和可读说明已写入音频文件。")
        return 0
    finally:
        con.close()
