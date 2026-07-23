"""Tag-encoding repair (Shift-JIS mojibake -> UTF-8) via mutagen.

MP3/ID3: every text frame's strings run through the repair heuristic; if
anything changed the file is rewritten as ID3v2.4 (UTF-8) and the ID3v1 tag
is dropped (v1 is where the Latin-1 lie lives).

FLAC/OGG/MP4: values are already Unicode per spec; the repair pass still
runs (rips sometimes smuggle misdecoded text in), but rarely fires.

All functions support dry-run: with apply=False nothing is written.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import mutagen
from mutagen.flac import FLAC
from mutagen.id3 import ID3, ID3FileType, Frames
from mutagen.oggvorbis import OggVorbis

from .mojibake import repair_text

log = logging.getLogger("mihonban.tagfix")


@dataclass
class TagFix:
    file: Path
    field: str
    old: str
    new: str


def _fix_id3(path: Path, apply: bool) -> list[TagFix]:
    try:
        tags = ID3(path)
    except mutagen.MutagenError:
        return []
    fixes: list[TagFix] = []
    for key, frame in list(tags.items()):
        if not hasattr(frame, "text"):
            continue
        new_text = []
        changed = False
        for value in frame.text:
            if isinstance(value, str):
                fixed = repair_text(value)
                if fixed != value:
                    fixes.append(TagFix(path, key, value, fixed))
                    changed = True
                    value = fixed
            new_text.append(value)
        if changed:
            frame.text = new_text
            frame.encoding = 3  # UTF-8
    if fixes and apply:
        tags.update_to_v24()
        tags.save(path, v1=0, v2_version=4)
    return fixes


def _fix_vorbis(path: Path, apply: bool) -> list[TagFix]:
    audio = mutagen.File(path)
    if audio is None or audio.tags is None:
        return []
    fixes: list[TagFix] = []
    for key in list(audio.tags.keys()):
        values = audio.tags[key]
        if not isinstance(values, list):
            continue
        new_values = []
        changed = False
        for v in values:
            if isinstance(v, str):
                fixed = repair_text(v)
                if fixed != v:
                    fixes.append(TagFix(path, key, v, fixed))
                    changed = True
                    v = fixed
            new_values.append(v)
        if changed:
            audio.tags[key] = new_values
    if fixes and apply:
        audio.save()
    return fixes


def fix_file_tags(path: Path, apply: bool = True) -> list[TagFix]:
    suffix = path.suffix.lower()
    if suffix == ".mp3":
        return _fix_id3(path, apply)
    if suffix in (".flac", ".ogg", ".opus", ".m4a", ".wma", ".ape", ".wv"):
        return _fix_vorbis(path, apply)
    return []


def fix_tree_tags(root: Path, apply: bool = True) -> list[TagFix]:
    fixes: list[TagFix] = []
    for f in sorted(root.rglob("*")):
        if f.is_file():
            try:
                fixes += fix_file_tags(f, apply=apply)
            except (mutagen.MutagenError, OSError, ValueError, UnicodeError) as e:
                log.warning("tagfix failed on %s: %s", f, e)
    return fixes
