import shutil

import pytest
from mutagen.id3 import ID3

from mihonban.tagfix import fix_file_tags

from conftest import tag_mp3


@pytest.mark.needs_ffmpeg
def test_broken_sjis_title_repaired(tmp_path, silent_mp3):
    mp3 = tmp_path / "t.mp3"
    shutil.copy(silent_mp3, mp3)
    tag_mp3(mp3, broken_title="夜の翼", artist="山下達郎")

    fixes = fix_file_tags(mp3, apply=True)
    assert any(f.new == "夜の翼" for f in fixes)

    tags = ID3(mp3)
    assert str(tags["TIT2"]) == "夜の翼"
    assert tags.version[:2] == (2, 4)
    # healthy field untouched
    assert str(tags["TPE1"]) == "山下達郎"


@pytest.mark.needs_ffmpeg
def test_dry_run_reports_without_writing(tmp_path, silent_mp3):
    mp3 = tmp_path / "t.mp3"
    shutil.copy(silent_mp3, mp3)
    tag_mp3(mp3, broken_title="恋するカレン")

    fixes = fix_file_tags(mp3, apply=False)
    assert len(fixes) == 1 and fixes[0].new == "恋するカレン"
    # file unchanged
    broken = "恋するカレン".encode("cp932").decode("latin-1")
    assert str(ID3(mp3)["TIT2"]) == broken


@pytest.mark.needs_ffmpeg
def test_clean_file_no_fixes(tmp_path, silent_mp3):
    mp3 = tmp_path / "t.mp3"
    shutil.copy(silent_mp3, mp3)
    tag_mp3(mp3, title="SPARKLE", artist="山下達郎", album="FOR YOU")
    assert fix_file_tags(mp3, apply=True) == []
