import io
import shutil
import subprocess
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from mihonban import extract
from mihonban.extract import (ExtractError, extract_archive, extract_recursive,
                           find_album_dirs, prepare_inbox_item)

from conftest import (SEVENZIP, TINY_JPEG, make_encrypted_zip,
                      write_cp932_zip)


def test_cp932_zip_names_decoded(cfg, tmp_path):
    zp = tmp_path / "old_rip.zip"
    write_cp932_zip(zp, {
        "[1980.05.01] RIDE ON TIME/01. RIDE ON TIME.ogg": b"xx",
        "[1980.05.01] RIDE ON TIME/02. あまく危険な香り.ogg": b"yy",
    })
    dest = tmp_path / "out"
    extract_archive(zp, dest, cfg)
    album = dest / "[1980.05.01] RIDE ON TIME"
    assert (album / "01. RIDE ON TIME.ogg").read_bytes() == b"xx"
    assert (album / "02. あまく危険な香り.ogg").read_bytes() == b"yy"


def test_corrupt_zip_is_reported_as_extract_error(cfg, tmp_path):
    archive = tmp_path / "broken.zip"
    archive.write_bytes(b"not a zip file")
    with pytest.raises(ExtractError, match="could not extract"):
        extract_archive(archive, tmp_path / "out", cfg)


def test_zip_parent_traversal_is_rejected(cfg, tmp_path):
    archive = tmp_path / "traversal.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("../escape.mp3", b"audio")

    with pytest.raises(ExtractError, match="parent traversal"):
        extract_archive(archive, tmp_path / "out", cfg)
    assert not (tmp_path / "escape.mp3").exists()


def test_zip_casefold_collision_is_rejected_without_overwrite(cfg, tmp_path):
    archive = tmp_path / "collision.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Disc/Track.mp3", b"first")
        zf.writestr("disc/track.mp3", b"second")

    dest = tmp_path / "out"
    with pytest.raises(ExtractError, match="collide"):
        extract_archive(archive, dest, cfg)
    assert not dest.exists()


def test_zip_does_not_overwrite_casefold_equivalent_existing_file(
        cfg, tmp_path):
    archive = tmp_path / "collision.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("track.mp3", b"new")
    dest = tmp_path / "out"
    dest.mkdir()
    existing = dest / "Track.mp3"
    existing.write_bytes(b"original")

    with pytest.raises(ExtractError, match="would overwrite"):
        extract_archive(archive, dest, cfg)
    assert existing.read_bytes() == b"original"
    assert len(list(dest.iterdir())) == 1


def test_zip_declared_size_limit_is_checked_before_writing(
        cfg, tmp_path, monkeypatch):
    archive = tmp_path / "large.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("track.flac", b"12345")
    monkeypatch.setattr(extract, "MAX_EXTRACTED_BYTES", 4)

    dest = tmp_path / "out"
    with pytest.raises(ExtractError, match="exceeds 4 bytes"):
        extract_archive(archive, dest, cfg)
    assert not dest.exists()


def test_direct_folder_uses_the_same_extraction_budget(
        cfg, tmp_path, monkeypatch):
    source = tmp_path / "direct album"
    source.mkdir()
    (source / "track.flac").write_bytes(b"12345")
    monkeypatch.setattr(extract, "MAX_EXTRACTED_BYTES", 4)

    workspace = tmp_path / "workspace"
    with pytest.raises(ExtractError, match="exceeds 4 bytes"):
        prepare_inbox_item(source, workspace, cfg)
    assert not workspace.exists()


def test_nested_archives_share_one_extraction_budget(
        cfg, tmp_path, monkeypatch):
    def inner(name: str) -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as zf:
            zf.writestr(name, b"x" * 20)
        return buffer.getvalue()

    first = inner("first.flac")
    second = inner("second.flac")
    outer = tmp_path / "outer.zip"
    with zipfile.ZipFile(outer, "w") as zf:
        zf.writestr("one.zip", first)
        zf.writestr("two.zip", second)

    # Outer members + one expanded payload fit; expanding both does not.
    monkeypatch.setattr(
        extract, "MAX_EXTRACTED_BYTES", len(first) + len(second) + 30)
    with pytest.raises(ExtractError, match="archive tree exceeds"):
        extract_recursive(outer, tmp_path / "workspace", cfg)


@pytest.mark.needs_ffmpeg
def test_nested_encrypted_archive(cfg, tmp_path, silent_mp3):
    # inner zip: album folder with audio + art
    src = tmp_path / "TY 84 06 25" / "[1984.06.25] BIG WAVE (VBR)"
    src.mkdir(parents=True)
    shutil.copy(silent_mp3, src / "01. THE THEME FROM BIG WAVE.mp3")
    (src / "Folder.jpg").write_bytes(TINY_JPEG)
    inner = tmp_path / "TY 84 06 25" / "TY 84 06 25.zip"
    import zipfile
    with zipfile.ZipFile(inner, "w") as zf:
        for f in src.rglob("*"):
            zf.write(f, f.relative_to(tmp_path / "TY 84 06 25"))
    shutil.rmtree(src)
    # outer: encrypted, contains a directory with a nested archive
    outer = tmp_path / "TY 84 06 25.zip"
    make_encrypted_zip(tmp_path / "TY 84 06 25", outer, "test-password")

    ws = tmp_path / "ws"
    extract_recursive(outer, ws, cfg)
    albums = find_album_dirs(ws)
    assert len(albums) == 1
    assert albums[0].name == "[1984.06.25] BIG WAVE (VBR)"
    assert (albums[0] / "Folder.jpg").exists()
    # inner archive removed from workspace after extraction
    assert not list(ws.rglob("*.zip"))


def test_wrong_password_raises(cfg, tmp_path):
    src = tmp_path / "d"
    src.mkdir()
    (src / "a.txt").write_text("x")
    outer = tmp_path / "locked.zip"
    make_encrypted_zip(src, outer, "not-the-password")
    with pytest.raises(ExtractError):
        extract_archive(outer, tmp_path / "out", cfg)


def test_7z_external_extractor_path(cfg, tmp_path):
    if not SEVENZIP.exists():
        pytest.skip("7-Zip not available")
    source = tmp_path / "seven-source"
    source.mkdir()
    (source / "track.flac").write_bytes(b"synthetic audio")
    archive = tmp_path / "album.7z"
    subprocess.run(
        [str(SEVENZIP), "a", str(archive), str(source)],
        check=True, capture_output=True,
    )
    cfg.sevenzip = SEVENZIP

    output = tmp_path / "seven-output"
    extract_archive(archive, output, cfg)

    assert (output / source.name / "track.flac").read_bytes() == b"synthetic audio"


def test_7z_timeout_is_converted_to_extract_error(cfg, tmp_path, monkeypatch):
    archive = tmp_path / "stuck.7z"
    archive.write_bytes(b"placeholder")

    def timeout(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, kwargs["timeout"])

    monkeypatch.setattr(extract.subprocess, "run", timeout)
    with pytest.raises(ExtractError, match="listing timed out"):
        extract_archive(archive, tmp_path / "out", cfg)


def test_7z_listing_output_is_bounded(cfg, tmp_path, monkeypatch):
    archive = tmp_path / "many-entries.7z"
    archive.write_bytes(b"placeholder")

    def fake_run(_cmd, **kwargs):
        kwargs["stdout"].write(b"x" * 33)
        return SimpleNamespace(returncode=0, stdout=None, stderr=None)

    monkeypatch.setattr(extract.subprocess, "run", fake_run)
    monkeypatch.setattr(extract, "MAX_SEVENZIP_LIST_BYTES", 32)
    with pytest.raises(ExtractError, match="listing output exceeds 32 bytes"):
        extract_archive(archive, tmp_path / "out", cfg)


def test_7z_listing_rejects_excessive_entry_count(
        cfg, tmp_path, monkeypatch):
    archive = tmp_path / "many-entries.7z"
    archive.write_bytes(b"placeholder")
    listing = (
        b"Path = one.flac\nSize = 1\nPacked Size = 1\nAttributes = A\n\n"
        b"Path = two.flac\nSize = 1\nPacked Size = 1\nAttributes = A\n\n"
    )

    def fake_run(_cmd, **_kwargs):
        return SimpleNamespace(returncode=0, stdout=listing, stderr=b"")

    monkeypatch.setattr(extract.subprocess, "run", fake_run)
    monkeypatch.setattr(extract, "MAX_ARCHIVE_ENTRIES", 1)
    with pytest.raises(ExtractError, match="exceeds 1 entries"):
        extract_archive(archive, tmp_path / "out", cfg)


def test_7z_manifest_limit_blocks_extraction(cfg, tmp_path, monkeypatch):
    archive = tmp_path / "large.7z"
    archive.write_bytes(b"placeholder")
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        return SimpleNamespace(
            returncode=0,
            stdout=(b"Path = huge.flac\nSize = 100\n"
                    b"Packed Size = 10\nAttributes = A\n\n"),
            stderr=b"",
        )

    monkeypatch.setattr(extract.subprocess, "run", fake_run)
    monkeypatch.setattr(extract, "MAX_EXTRACTED_BYTES", 50)
    with pytest.raises(ExtractError, match="exceeds 50 bytes"):
        extract_archive(archive, tmp_path / "out", cfg)
    assert len(calls) == 1
    assert calls[0][1] == "l", "preflight must fail before 7z extraction"


def test_7z_missing_output_is_rejected_instead_of_imported(
        cfg, tmp_path, monkeypatch):
    archive = tmp_path / "incomplete.7z"
    archive.write_bytes(b"placeholder")

    def fake_run(cmd, **_kwargs):
        if cmd[1] == "l":
            return SimpleNamespace(
                returncode=0,
                stdout=(b"Path = one.flac\nSize = 3\nPacked Size = 3\n"
                        b"Attributes = A\n\n"
                        b"Path = two.flac\nSize = 3\nPacked Size = 3\n"
                        b"Attributes = A\n\n"),
                stderr=b"",
            )
        output = Path(next(arg[2:] for arg in cmd if arg.startswith("-o")))
        output.mkdir(parents=True, exist_ok=True)
        (output / "one.flac").write_bytes(b"one")
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr(extract.subprocess, "run", fake_run)
    dest = tmp_path / "out"
    with pytest.raises(ExtractError, match="does not match archive manifest"):
        extract_archive(archive, dest, cfg)
    assert not dest.exists()


def test_find_album_dirs_root_audio(cfg, tmp_path):
    root = tmp_path / "loose"
    root.mkdir()
    (root / "track.mp3").write_bytes(b"x")
    assert find_album_dirs(root) == [root]


def test_find_album_dirs_coalesces_conventional_multidisc_folders(tmp_path):
    root = tmp_path / "workspace"
    album = root / "[1984] MULTI DISC"
    for disc in ("Disc 1", "Disc 2"):
        folder = album / disc
        folder.mkdir(parents=True)
        (folder / "01.flac").write_bytes(b"audio")
    separate = root / "[1985] OTHER"
    separate.mkdir(parents=True)
    (separate / "01.flac").write_bytes(b"audio")

    assert find_album_dirs(root) == [album, separate]


def test_find_album_dirs_does_not_merge_bare_numbered_albums(tmp_path):
    root = tmp_path / "workspace" / "Artist"
    first = root / "01"
    second = root / "02"
    first.mkdir(parents=True)
    second.mkdir()
    (first / "track.flac").write_bytes(b"one")
    (second / "track.flac").write_bytes(b"two")

    assert find_album_dirs(root.parent) == [first, second]


def test_find_album_dirs_merges_numbered_discs_with_release_context(tmp_path):
    root = tmp_path / "workspace"
    album = root / "[1984] BOX SET"
    first = album / "01"
    second = album / "02"
    first.mkdir(parents=True)
    second.mkdir()
    (first / "track.flac").write_bytes(b"one")
    (second / "track.flac").write_bytes(b"two")

    assert find_album_dirs(root) == [album]
