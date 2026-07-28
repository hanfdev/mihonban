from pathlib import Path
from types import SimpleNamespace

from mihonban import beets_runner


def test_quiet_import_flattens_roman_numeral_multidisc_tree(
        cfg, tmp_path, monkeypatch):
    album = tmp_path / "album"
    for disc in ("Disc I", "Disc II"):
        folder = album / disc
        folder.mkdir(parents=True)
        (folder / "01.mp3").write_bytes(b"audio")
    calls = []

    def fake_run(_cfg, *args, **_kwargs):
        calls.append(args)
        for path in album.rglob("*.mp3"):
            path.unlink()
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(beets_runner, "run_beet", fake_run)

    outcome = beets_runner.quiet_import(cfg, album, autotag=False)

    assert outcome.imported
    assert calls == [("import", "-q", "--flat", "-A", str(album))]


def test_quiet_import_does_not_flatten_unrelated_album_folders(
        cfg, tmp_path, monkeypatch):
    artist = tmp_path / "artist"
    for name in ("First Album", "Second Album"):
        folder = artist / name
        folder.mkdir(parents=True)
        (folder / "01.mp3").write_bytes(b"audio")
    calls = []

    def fake_run(_cfg, *args, **_kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(beets_runner, "run_beet", fake_run)

    beets_runner.quiet_import(cfg, artist, autotag=False)

    assert "--flat" not in calls[0]
