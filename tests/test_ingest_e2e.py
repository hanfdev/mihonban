"""End-to-end ingest over a synthetic jpop80ss-style archive, fully offline
(beets autotag disabled; art from filesystem only)."""

import shutil
import zipfile

import pytest
from mutagen.id3 import ID3

from mihonban.ingest import run_ingest

from conftest import TINY_JPEG, make_encrypted_zip, tag_mp3, write_cp932_zip


@pytest.fixture
def synthetic_archive(cfg, tmp_path, silent_mp3):
    """outer encrypted zip -> dir -> inner zip -> album dir (like the rars).

    Album folder carries date+title; track 2 has a broken Shift-JIS title;
    track 1 lacks album/date tags (synthesized from folder name); a scan
    image rides along. Inner zip stores CP932 filenames.
    """
    stage = tmp_path / "stage" / "TY 84 06 25"
    stage.mkdir(parents=True)

    t1 = tmp_path / "01. 高気圧ガール.mp3"
    shutil.copy(silent_mp3, t1)
    tag_mp3(t1, title="高気圧ガール", artist="山下達郎", track="1")
    t2 = tmp_path / "02. 夜の翼.mp3"
    shutil.copy(silent_mp3, t2)
    tag_mp3(t2, broken_title="夜の翼", artist="山下達郎", album=None,
            track="2")

    album = "[1984.06.25] テスト・アルバム (VBR)"
    inner = stage / "TY 84 06 25.zip"
    write_cp932_zip(inner, {
        f"{album}/01. 高気圧ガール.mp3": t1.read_bytes(),
        f"{album}/02. 夜の翼.mp3": t2.read_bytes(),
        f"{album}/Folder.jpg": TINY_JPEG,
        f"{album}/scans/booklet01.jpg": TINY_JPEG,
    })

    outer = cfg.inbox / "TY 84 06 25.zip"
    make_encrypted_zip(tmp_path / "stage" / "TY 84 06 25", outer, "test-password")
    return outer


@pytest.mark.needs_ffmpeg
def test_dry_run_touches_nothing(cfg, synthetic_archive):
    results = run_ingest(cfg, apply=False, autotag=False)
    assert len(results) == 1
    assert results[0].status == "dry-run"
    assert results[0].albums[0].tag_fixes >= 1   # broken title reported
    assert results[0].albums[0].tag_notes >= 1   # album/date synth reported
    assert synthetic_archive.exists()            # archive untouched
    assert not any(cfg.music_root.rglob("*"))    # library untouched
    assert not (cfg.state_dir / "ingest_applied").exists()


@pytest.mark.needs_ffmpeg
def test_apply_imports_double_nested_archive(cfg, synthetic_archive):
    results = run_ingest(cfg, apply=True, autotag=False)
    assert results[0].status == "done", results[0]
    assert results[0].albums[0].action == "imported"

    album_dir = cfg.music_root / "山下達郎" / "[1984] テスト・アルバム"
    files = sorted(p.name for p in album_dir.glob("*.mp3"))
    assert files == ["01 高気圧ガール.mp3", "02 夜の翼.mp3"]

    # mojibake repaired and art embedded
    tags = ID3(album_dir / "02 夜の翼.mp3")
    assert str(tags["TIT2"]) == "夜の翼"
    assert tags.getall("APIC"), "cover should be embedded"
    # loose scan (non-cover artifact) preserved next to the album
    assert (album_dir / "scans/booklet01.jpg").exists(), \
        "artifact mover must relocate scans into the library"

    # archive archived, workspace cleaned, state recorded
    assert not synthetic_archive.exists()
    assert any(cfg.done_dir.iterdir())
    assert not any(cfg.tmp_dir.iterdir())
    assert (cfg.state_dir / "ingest_applied").exists()


@pytest.mark.needs_ffmpeg
def test_apply_imports_single_archive(cfg, tmp_path, silent_mp3):
    album = tmp_path / "single" / "[1991.04.10] Single Archive"
    album.mkdir(parents=True)
    track = album / "01. One Layer.mp3"
    shutil.copy(silent_mp3, track)
    tag_mp3(track, title="One Layer", artist="Test Artist",
            album="Single Archive", track="1")

    archive = cfg.inbox / "single.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.write(track, track.relative_to(album.parent))

    results = run_ingest(cfg, apply=True, autotag=False)

    assert len(results) == 1
    assert results[0].status == "done", results[0]
    assert results[0].albums[0].action == "imported"
    assert not archive.exists()
    assert (cfg.done_dir / "single.zip").exists()
    assert any(p.name == "01 One Layer.mp3"
               for p in cfg.music_root.rglob("*.mp3"))


@pytest.mark.needs_ffmpeg
def test_apply_imports_direct_folder(cfg, silent_mp3):
    album = cfg.inbox / "[1992.05.20] Direct Folder"
    album.mkdir()
    track = album / "01. No Archive.mp3"
    shutil.copy(silent_mp3, track)
    tag_mp3(track, title="No Archive", artist="Folder Artist",
            album="Direct Folder", track="1")

    results = run_ingest(cfg, apply=True, autotag=False)

    assert len(results) == 1
    assert results[0].status == "done", results[0]
    assert results[0].albums[0].action == "imported"
    assert not album.exists()
    assert (cfg.done_dir / album.name).is_dir()
    assert any(p.name == "01 No Archive.mp3"
               for p in cfg.music_root.rglob("*.mp3"))
    assert not any(cfg.tmp_dir.iterdir())


@pytest.mark.needs_ffmpeg
def test_reingest_duplicate_is_safe(cfg, synthetic_archive, tmp_path,
                                    silent_mp3):
    run_ingest(cfg, apply=True, autotag=False)
    # same album arrives again in a new archive
    again = tmp_path / "again" / "TY 84 06 25"
    again.mkdir(parents=True)
    album = "[1984.06.25] テスト・アルバム (VBR)"
    t1 = tmp_path / "dup.mp3"
    shutil.copy(silent_mp3, t1)
    tag_mp3(t1, title="高気圧ガール", artist="山下達郎", album=None,
            track="1")
    inner = again / "TY 84 06 25.zip"
    with zipfile.ZipFile(inner, "w") as zf:
        zf.writestr(f"{album}/01. 高気圧ガール.mp3", t1.read_bytes())
    outer = cfg.inbox / "TY 84 06 25 (2).zip"
    make_encrypted_zip(tmp_path / "again" / "TY 84 06 25", outer, "test-password")

    results = run_ingest(cfg, apply=True, autotag=False)
    # duplicate must not corrupt the library: original files still there
    album_dir = cfg.music_root / "山下達郎" / "[1984] テスト・アルバム"
    assert len(list(album_dir.glob("*.mp3"))) == 2
    # and nothing silently dropped: dup album either quarantined or skipped
    a = results[0].albums[0]
    assert a.action in ("quarantined", "imported")


def test_bad_password_quarantines_archive(cfg, tmp_path):
    src = tmp_path / "s"
    src.mkdir()
    (src / "x.mp3").write_bytes(b"not really audio")
    bad = cfg.inbox / "locked.zip"
    make_encrypted_zip(src, bad, "wrong-password")

    results = run_ingest(cfg, apply=True, autotag=False)
    assert results[0].status == "quarantined"
    assert not bad.exists()
    q = list(cfg.quarantine_dir.rglob("locked*.zip"))
    assert q, "archive must be preserved in quarantine"
    reasons = list(cfg.quarantine_dir.rglob("reason.txt"))
    assert reasons and "extract failed" in reasons[0].read_text("utf-8")
