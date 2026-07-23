import shutil

import pytest
from mutagen.id3 import ID3

from mihonban.mb_artist import canonicalize_artists

from conftest import tag_mp3


def fake_resolver(name: str):
    assert name == "Tatsuro Yamashita"
    return {"name": "山下達郎", "sort": "Yamashita, Tatsuro"}


@pytest.mark.needs_ffmpeg
def test_romaji_artist_canonicalized(cfg, tmp_path, silent_mp3):
    album = tmp_path / "album"
    album.mkdir()
    for i in (1, 2):
        f = album / f"0{i}.mp3"
        shutil.copy(silent_mp3, f)
        tag_mp3(f, title=f"Track {i}", artist="Tatsuro Yamashita",
                album="FOR YOU", track=str(i))

    notes = canonicalize_artists(cfg, album, apply=True,
                                 resolver=fake_resolver)
    assert len(notes) == 2
    tags = ID3(album / "01.mp3")
    assert str(tags["TPE1"]) == "山下達郎"
    assert str(tags["TSOP"]) == "Yamashita, Tatsuro"

    # second call hits the cache — resolver that would fail is never called
    def exploding(name):
        raise AssertionError("resolver must not be called (cache)")
    notes2 = canonicalize_artists(cfg, album, apply=False,
                                  resolver=exploding)
    assert notes2 == []  # already canonical (original script present)


@pytest.mark.needs_ffmpeg
def test_original_script_untouched(cfg, tmp_path, silent_mp3):
    album = tmp_path / "album"
    album.mkdir()
    f = album / "01.mp3"
    shutil.copy(silent_mp3, f)
    tag_mp3(f, title="夜の翼", artist="山下達郎", album="X", track="1")

    def exploding(name):
        raise AssertionError("must not resolve original-script artists")
    assert canonicalize_artists(cfg, album, apply=True,
                                resolver=exploding) == []


@pytest.mark.needs_ffmpeg
def test_multi_artist_album_untouched(cfg, tmp_path, silent_mp3):
    album = tmp_path / "album"
    album.mkdir()
    for i, artist in ((1, "Artist A"), (2, "Artist B")):
        f = album / f"0{i}.mp3"
        shutil.copy(silent_mp3, f)
        tag_mp3(f, title=f"T{i}", artist=artist, album="VA", track=str(i))
    assert canonicalize_artists(cfg, album, apply=True,
                                resolver=fake_resolver) == []


@pytest.mark.needs_ffmpeg
def test_unresolved_artist_cached_negative(cfg, tmp_path, silent_mp3):
    album = tmp_path / "album"
    album.mkdir()
    f = album / "01.mp3"
    shutil.copy(silent_mp3, f)
    tag_mp3(f, title="T", artist="Unknown Indie Band", album="X", track="1")

    calls = []
    def counting(name):
        calls.append(name)
        return None
    canonicalize_artists(cfg, album, apply=True, resolver=counting)
    canonicalize_artists(cfg, album, apply=True, resolver=counting)
    assert calls == ["Unknown Indie Band"]  # negative result cached too
