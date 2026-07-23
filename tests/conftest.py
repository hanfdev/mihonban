"""Shared fixtures: synthetic audio, mojibake archives, isolated Config.

Everything is generated — no real downloaded files are ever touched.
"""

from __future__ import annotations

import base64
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest
from mutagen.id3 import ID3, TALB, TIT2, TPE1, TRCK

from mihonban.config import Config

FFMPEG = shutil.which("ffmpeg")
SEVENZIP = Path(r"C:\Program Files\7-Zip\7z.exe")

# valid 1x1 white JPEG
TINY_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof"
    "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh"
    "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR"
    "CAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA"
    "AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK"
    "FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG"
    "h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl"
    "5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA"
    "AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk"
    "NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE"
    "hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk"
    "5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q=="
)


def pytest_collection_modifyitems(config, items):
    if FFMPEG is None:
        skip = pytest.mark.skip(reason="ffmpeg not available")
        for item in items:
            if "needs_ffmpeg" in item.keywords:
                item.add_marker(skip)


@pytest.fixture
def cfg(tmp_path: Path) -> Config:
    c = Config(
        music_root=tmp_path / "Library",
        inbox=tmp_path / "inbox",
        rym_pages=tmp_path / "rym_pages",
        data_dir=tmp_path / "data",
    )
    c.passwords = ["test-password"]
    c.art_sources = "filesystem"  # offline
    c.ensure_dirs()
    return c


@pytest.fixture(scope="session")
def silent_mp3(tmp_path_factory) -> Path:
    """One cached silent MP3, copied per use."""
    if FFMPEG is None:
        pytest.skip("ffmpeg not available")
    base = tmp_path_factory.mktemp("media") / "silence.mp3"
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "lavfi",
         "-i", "anullsrc=r=44100:cl=stereo", "-t", "0.3", "-q:a", "9",
         str(base)],
        check=True)
    return base


def tag_mp3(path: Path, title: str | None = None, artist: str | None = None,
            album: str | None = None, track: str | None = None,
            broken_title: str | None = None) -> None:
    """Write ID3 tags; broken_title simulates Latin-1-declared Shift-JIS."""
    tags = ID3()
    if broken_title is not None:
        garbage = broken_title.encode("cp932").decode("latin-1")
        tags.add(TIT2(encoding=0, text=[garbage]))
    elif title:
        tags.add(TIT2(encoding=3, text=[title]))
    if artist:
        tags.add(TPE1(encoding=3, text=[artist]))
    if album:
        tags.add(TALB(encoding=3, text=[album]))
    if track:
        tags.add(TRCK(encoding=3, text=[track]))
    tags.save(path)


class _RawNameZipInfo(zipfile.ZipInfo):
    """ZipInfo that stores pre-encoded raw filename bytes (no UTF-8 flag),
    reproducing archives created by old Japanese tools (CP932 names)."""
    raw: bytes = b""

    def _encodeFilenameFlags(self):  # noqa: N802 (zipfile private API)
        return self.raw, 0


def write_cp932_zip(zip_path: Path, files: dict[str, bytes]) -> None:
    with zipfile.ZipFile(zip_path, "w") as zf:
        for name, data in files.items():
            zi = _RawNameZipInfo(name.encode("cp932").decode("cp437"))
            zi.raw = name.encode("cp932")
            zf.writestr(zi, data)


def make_encrypted_zip(src_dir: Path, zip_path: Path, password: str) -> None:
    """7-Zip creates the password-protected outer archive (ZipCrypto)."""
    if not SEVENZIP.exists():
        pytest.skip("7-Zip not available")
    subprocess.run(
        [str(SEVENZIP), "a", "-tzip", f"-p{password}", "-mem=ZipCrypto",
         str(zip_path), str(src_dir)],
        check=True, capture_output=True)
