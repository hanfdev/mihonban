"""Fallback album metadata synthesized from rip folder names.

Rare/bootleg rips often carry folders like ``[1980.05.01] RIDE ON TIME (VBR)``
while the files inside lack album/date tags. Before beets sees the album we
fill ONLY missing basic tags from the folder name so that:
  - matched albums give beets better search hints,
  - unmatched albums imported as-is still land in a sane
    ``AlbumArtist/[Year] Album/`` path.
Existing tag values are never overwritten.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

import mutagen
from mutagen.id3 import ID3, TALB, TDRC, TPE1, TPE2

from .extract import AUDIO_EXTS

log = logging.getLogger("mihonban.albuminfo")

_DATE_TITLE = re.compile(
    r"^\s*[\[(](\d{4})(?:[.\-/](\d{1,2})(?:[.\-/](\d{1,2}))?)?[\])]\s*(.+?)\s*$"
)
_TITLE_DATE = re.compile(
    r"^\s*(.+?)\s*[\[(](\d{4})(?:[.\-/](\d{1,2})(?:[.\-/](\d{1,2}))?)?[\])]\s*$"
)
_QUALITY_SUFFIX = re.compile(
    r"\s*[\[(](?:VBR|CBR|ABR|V\d|\d{2,3}\s*kbps|\d{2,3}k?|FLAC|MP3|OGG|AAC|"
    r"M4A|APE|WV|WAV|EAC|LAME|lossless|web|vinyl|24bit|16bit|"
    r"\d{2,3}(?:\.\d)?kHz)[\])]\s*$",
    re.IGNORECASE,
)


@dataclass
class AlbumGuess:
    album: str | None = None
    year: str | None = None
    date: str | None = None  # YYYY-MM-DD when full date known


def strip_quality(title: str) -> str:
    prev = None
    while prev != title:
        prev = title
        title = _QUALITY_SUFFIX.sub("", title).strip()
    return title


def guess_from_folder(name: str) -> AlbumGuess:
    g = AlbumGuess()
    m = _DATE_TITLE.match(name) or None
    if m:
        y, mo, d, title = m.groups()
    else:
        m2 = _TITLE_DATE.match(name)
        if not m2:
            g.album = strip_quality(name) or None
            return g
        title, y, mo, d = m2.groups()
    g.year = y
    if y and mo and d:
        g.date = f"{y}-{int(mo):02d}-{int(d):02d}"
    g.album = strip_quality(title) or None
    return g


def synthesize_tags(album_dir: Path, apply: bool = True) -> list[str]:
    """Fill missing album/date/albumartist tags. Returns change notes."""
    guess = guess_from_folder(album_dir.name)
    audio_files = sorted(
        f for f in album_dir.rglob("*")
        if f.is_file() and f.suffix.lower() in AUDIO_EXTS
    )
    if not audio_files:
        return []

    notes: list[str] = []
    artists: set[str] = set()
    handles = []
    for f in audio_files:
        try:
            audio = mutagen.File(f, easy=True)
        except (mutagen.MutagenError, OSError, ValueError, UnicodeError) as e:
            log.warning("cannot read %s: %s", f, e)
            continue
        if audio is None:
            continue
        handles.append((f, audio))
        artists.update(value.strip() for value in _get_tag(audio, "artist")
                       if value.strip())

    common_artist = artists.pop() if len(artists) == 1 else None

    for f, audio in handles:
        changed = False
        file_notes: list[str] = []
        try:
            if guess.album and not _get_tag(audio, "album"):
                _set_tag(audio, "album", guess.album)
                file_notes.append(f"{f.name}: album <- {guess.album!r}")
                changed = True
            if not _get_tag(audio, "date") and (guess.date or guess.year):
                _set_tag(audio, "date", guess.date or guess.year)
                file_notes.append(f"{f.name}: date <- {guess.date or guess.year}")
                changed = True
            if not _get_tag(audio, "albumartist"):
                aa = common_artist or (_get_tag(audio, "artist") or [None])[0]
                if aa:
                    _set_tag(audio, "albumartist", aa)
                    file_notes.append(f"{f.name}: albumartist <- {aa!r}")
                    changed = True
        except (mutagen.MutagenError, ValueError, TypeError, KeyError) as e:
            # Skip a file whose tag container rejects the operation. Never let a
            # TypeError escape this function or the entire inbox item enters
            # quarantine; this once prevented WAV albums from ever importing.
            log.warning("cannot synthesize tags for %s: %s", f, e)
            continue
        if changed and apply:
            try:
                audio.save()
            except (mutagen.MutagenError, OSError, ValueError, UnicodeError,
                    TypeError) as e:
                log.warning("cannot save synthesized tags for %s: %s", f, e)
                continue
        notes.extend(file_notes)
    return notes


# WAV/AIFF/DSF have no Easy wrapper for easy=True: mutagen.File returns the raw
# container, whose .tags is an ID3-family object accepting Frame instances rather
# than plain string assignment. Dispatch reads and writes by container here while
# preserving Easy-key semantics in both worlds.
_ID3_FRAME = {"album": TALB, "date": TDRC, "albumartist": TPE2, "artist": TPE1}


def _get_tag(audio, key: str) -> list[str]:
    tags = getattr(audio, "tags", None)
    if isinstance(tags, ID3):
        frames = tags.getall(_ID3_FRAME[key].__name__)
        return [str(text) for frame in frames for text in frame.text
                if str(text)]
    return [str(value) for value in (audio.get(key) or []) if str(value)]


def _set_tag(audio, key: str, value) -> None:
    if getattr(audio, "tags", None) is None:
        audio.add_tags()
    tags = audio.tags
    if isinstance(tags, ID3):
        frame = _ID3_FRAME[key]
        tags.setall(frame.__name__, [frame(encoding=3, text=[str(value)])])
    else:
        audio[key] = value
