import shutil

import mutagen
import pytest
from mutagen.id3 import TALB, TDRC, TPE1, TPE2

from conftest import tag_mp3
from mihonban.albuminfo import guess_from_folder, strip_quality, synthesize_tags


def test_bracket_date_title_vbr():
    g = guess_from_folder("[1980.05.01] RIDE ON TIME (VBR)")
    assert g.year == "1980"
    assert g.date == "1980-05-01"
    assert g.album == "RIDE ON TIME"


def test_year_only():
    g = guess_from_folder("[1982] FOR YOU (FLAC)")
    assert g.year == "1982"
    assert g.date is None
    assert g.album == "FOR YOU"


def test_title_then_year():
    g = guess_from_folder("Big Wave (1984)")
    assert g.year == "1984"
    assert g.album == "Big Wave"


def test_japanese_title():
    g = guess_from_folder("[1983.04.23] メロディーズ (320)")
    assert g.album == "メロディーズ"
    assert g.date == "1983-04-23"


def test_no_pattern_falls_back_to_name():
    g = guess_from_folder("GO AHEAD!")
    assert g.album == "GO AHEAD!"
    assert g.year is None


def test_strip_quality_variants():
    assert strip_quality("X (VBR)") == "X"
    assert strip_quality("X [FLAC]") == "X"
    assert strip_quality("X (320kbps)") == "X"
    assert strip_quality("X (EAC) (FLAC)") == "X"
    assert strip_quality("X (Live)") == "X (Live)"  # not a quality marker


@pytest.mark.needs_ffmpeg
def test_synthesize_tags_reaches_multidisc_subdirectories(tmp_path, silent_mp3):
    album = tmp_path / "[1984] MULTI DISC"
    files = []
    for disc in (1, 2):
        path = album / f"Disc {disc}" / "01.mp3"
        path.parent.mkdir(parents=True)
        shutil.copy(silent_mp3, path)
        tag_mp3(path, title=f"Disc {disc}", artist="Test Artist", track="1")
        files.append(path)

    notes = synthesize_tags(album, apply=True)

    assert notes
    for path in files:
        audio = mutagen.File(path, easy=True)
        assert audio["album"] == ["MULTI DISC"]
        assert audio["date"] == ["1984"]
        assert audio["albumartist"] == ["Test Artist"]


def test_synthesize_tags_writes_id3_frames_inside_wav(tmp_path, silent_wav):
    album = tmp_path / "[1984] WAV ALBUM"
    album.mkdir()
    path = album / "01.wav"
    shutil.copy(silent_wav, path)

    audio = mutagen.File(path)
    audio.add_tags()
    audio.tags.add(TPE1(encoding=3, text=["Test Artist"]))
    audio.save()

    notes = synthesize_tags(album, apply=True)

    assert len(notes) == 3
    tags = mutagen.File(path).tags
    assert str(tags.getall(TALB.__name__)[0]) == "WAV ALBUM"
    assert str(tags.getall(TDRC.__name__)[0]) == "1984"
    assert str(tags.getall(TPE2.__name__)[0]) == "Test Artist"
    assert str(tags.getall(TPE1.__name__)[0]) == "Test Artist"
