import shutil
import sqlite3

import mutagen
import pytest
from mutagen.id3 import COMM, ID3, TXXX

from mihonban.rym import write as write_module
from mihonban.rym.write import (_write_mp4, run_write, write_album)

from conftest import tag_mp3


@pytest.fixture
def match_row():
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.execute("""CREATE TABLE t (album_path, title, artist, year, rating,
                   votes, rank, primary_genres, secondary_genres,
                   descriptors, rym_url)""")
    con.execute("INSERT INTO t VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
        "", "FOR YOU", "Tatsuro Yamashita", 1982, 3.87, 12345,
        "#25 for 1982 , #1,234 overall",
        "City Pop", "Funk; Boogie", "summer; warm; urban",
        "https://rateyourmusic.com/release/album/tatsuro-yamashita/for-you/"))
    return con.execute("SELECT * FROM t").fetchone()


@pytest.mark.needs_ffmpeg
def test_write_dry_run_and_apply(tmp_path, silent_mp3, match_row):
    album = tmp_path / "album"
    album.mkdir()
    f = album / "01.mp3"
    shutil.copy(silent_mp3, f)
    tag_mp3(f, title="SPARKLE", artist="山下達郎", album="FOR YOU", track="1")

    # dry-run: reports change, writes nothing
    changed, total = write_album(album, match_row, apply=False)
    assert (changed, total) == (1, 1)
    assert not ID3(f).getall("TXXX:RYM_RATING")

    # apply
    changed, _ = write_album(album, match_row, apply=True)
    assert changed == 1
    tags = ID3(f)
    assert str(tags.getall("TXXX:RYM_RATING")[0]) == "3.87"
    assert str(tags.getall("TXXX:RYM_VOTES")[0]) == "12345"
    assert str(tags.getall("TXXX:RYM_GENRES")[0]) == "City Pop; Funk; Boogie"
    assert str(tags.getall("TXXX:RYM_RANK")[0]) == \
        "#25 for 1982 , #1,234 overall"
    assert "urban" in str(tags.getall("TXXX:RYM_DESCRIPTORS")[0])
    assert str(tags.getall("TXXX:RYM_URL")[0]).endswith("/for-you/")
    # The portable GENRE tag receives the RYM genres.
    assert list(tags.getall("TCON")[0].text) == ["City Pop", "Funk", "Boogie"]
    # human-visible comment: exact rating + first rank + genres
    comment = str(tags.getall("COMM")[0])
    assert comment == ("RYM 3.87 (12,345 votes) · #25 for 1982 · "
                       "City Pop; Funk; Boogie")
    # original tags intact
    assert str(tags["TIT2"]) == "SPARKLE"

    # idempotent: second apply changes nothing
    changed, _ = write_album(album, match_row, apply=True)
    assert changed == 0


def test_write_preserves_non_rym_comments(tmp_path, silent_mp3, match_row):
    f = tmp_path / "track.mp3"
    shutil.copy(silent_mp3, f)
    tags = ID3(f)
    tags.add(COMM(encoding=3, lang="eng", desc="user", text=["Keep this"]))
    tags.save(f)

    write_album(tmp_path, match_row, apply=True)
    comments = ID3(f).getall("COMM")
    assert any(str(comment) == "Keep this" for comment in comments)
    assert sum(str(comment).startswith("RYM ") for comment in comments) == 1


def test_write_creates_tags_on_audio_without_id3_header(
        tmp_path, silent_mp3, match_row):
    f = tmp_path / "headerless.mp3"
    shutil.copy(silent_mp3, f)
    ID3(f).delete(f)

    changed, total = write_album(tmp_path, match_row, apply=True)
    assert (changed, total) == (1, 1)
    assert ID3(f).getall("TXXX:RYM_RATING")


def test_write_removes_stale_rym_fields_without_touching_other_tags(
        tmp_path, silent_mp3):
    f = tmp_path / "stale.mp3"
    shutil.copy(silent_mp3, f)
    tags = ID3(f)
    tags.add(TXXX(encoding=3, desc="RYM_RATING", text=["old"]))
    tags.add(COMM(encoding=3, lang="eng", desc="user", text=["Keep this"]))
    tags.add(COMM(encoding=3, lang="eng", desc="RYM", text=["RYM old"]))
    tags.save(f)
    empty = {
        "rating": None, "votes": None, "rank": "",
        "primary_genres": "", "secondary_genres": "",
        "descriptors": "", "rym_url": "",
    }

    changed, _ = write_album(tmp_path, empty, apply=True)
    assert changed == 1
    current = ID3(f)
    assert not current.getall("TXXX:RYM_RATING")
    assert not any(str(comment).startswith("RYM ")
                   for comment in current.getall("COMM"))
    assert any(str(comment) == "Keep this" for comment in current.getall("COMM"))


def test_write_handles_multiple_disc_directories(tmp_path, silent_mp3,
                                                 match_row):
    for disc in ("Disc 1", "Disc 2"):
        folder = tmp_path / disc
        folder.mkdir()
        shutil.copy(silent_mp3, folder / "01.mp3")

    changed, total = write_album(tmp_path, match_row, apply=True)
    assert (changed, total) == (2, 2)


def test_write_embeds_rym_id3_frames_in_wav(tmp_path, silent_wav, match_row):
    album = tmp_path / "album"
    album.mkdir()
    path = album / "track.wav"
    shutil.copy(silent_wav, path)

    changed, total = write_album(album, match_row, apply=True)

    assert (changed, total) == (1, 1)
    tags = mutagen.File(path).tags
    assert str(tags.getall("TXXX:RYM_RATING")[0]) == "3.87"
    assert list(tags.getall("TCON")[0].text) == ["City Pop", "Funk", "Boogie"]
    assert str(tags.getall("COMM:RYM:eng")[0]).startswith("RYM 3.87")

    # The container-specific save path must remain idempotent.
    assert write_album(album, match_row, apply=True) == (0, 1)


def test_mp4_writer_is_idempotent_when_optional_fields_are_empty(monkeypatch):
    class FakeMP4:
        def __init__(self, _path):
            self.tags = {}
            self.saved = 0

        def add_tags(self):
            self.tags = {}

        def __setitem__(self, key, value):
            self.tags[key] = value

        def __delitem__(self, key):
            del self.tags[key]

        def save(self):
            self.saved += 1

    fake = FakeMP4(None)
    monkeypatch.setattr(write_module, "MP4", lambda _path: fake)
    vals = {"RYM_RATING": "3.87"}

    assert _write_mp4(None, vals, "", True, [])
    assert not _write_mp4(None, vals, "", True, [])
    assert fake.saved == 1


def test_run_write_closes_database_when_there_are_no_matches(cfg, monkeypatch):
    class FakeConnection:
        closed = False

        def close(self):
            self.closed = True

    connection = FakeConnection()
    monkeypatch.setattr("mihonban.rym.write.db.connect", lambda _: connection)
    monkeypatch.setattr("mihonban.rym.write.db.confirmed_matches", lambda _: [])

    class Console:
        def print(self, *_args, **_kwargs):
            return None

    assert run_write(cfg, Console()) == 0
    assert connection.closed
