import json
import sqlite3

import pytest

from mihonban.rym import db
from mihonban.rym.parse import ParseFailure, parse_html, run_parse

RYM_LIKE = """<!DOCTYPE html>
<html><head>
<link rel="canonical" href="https://rateyourmusic.com/release/album/tatsuro-yamashita/for-you/">
<script type="application/ld+json">
{js}
</script>
</head><body>
<div class="album_title">FOR YOU
  <span class="credited_name">By <a class="artist" href="/artist/tatsuro-yamashita">Tatsuro Yamashita</a></span>
</div>
<div class="album_info">
  <a class="artist" href="/artist/tatsuro-yamashita">Tatsuro Yamashita</a>
</div>
<span class="avg_rating"> 3.87 </span>
<span class="num_ratings"><b>12,345</b></span>
<table><tr><th class="info_hdr">Ranked</td>
<td>#<b>185</b> for <a href="/charts/top/album/1982/">1982</a></td></tr></table>
<span class="release_pri_genres">
  <a class="genre" href="/genre/city-pop/">City Pop</a>
</span>
<span class="release_sec_genres">
  <a class="genre" href="/genre/funk/">Funk</a>,
  <a class="genre" href="/genre/boogie/">Boogie</a>
</span>
<span class="release_pri_descriptors">summer, warm, rhythmic, urban</span>
</body></html>
"""


def test_rym_db_removes_retired_player_state(tmp_path):
    path = tmp_path / "rym.sqlite"
    con = sqlite3.connect(path)
    con.executescript("""
      CREATE TABLE rym_albums (id INTEGER PRIMARY KEY, rym_url TEXT);
      CREATE TABLE rym_matches (
        rym_id INTEGER PRIMARY KEY, album_path TEXT NOT NULL,
        confidence REAL, status TEXT NOT NULL, decided_at TEXT,
        stars_pushed INTEGER
      );
    """)
    con.close()

    con = db.connect(path)
    columns = [row[1] for row in con.execute("PRAGMA table_info(rym_matches)")]
    assert "stars_pushed" not in columns
    con.close()

JSONLD = {
    "@type": "MusicAlbum",
    "name": "FOR YOU",
    "byArtist": {"@type": "MusicGroup", "name": "Tatsuro Yamashita"},
    "datePublished": "1982-01-21",
    "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": "3.87",
        "ratingCount": "12345",
    },
}


@pytest.fixture
def rym_page(tmp_path):
    p = tmp_path / "for you.html"
    p.write_text(RYM_LIKE.format(js=json.dumps(JSONLD)), "utf-8")
    return p


def test_parse_full_page(rym_page):
    a = parse_html(rym_page)
    assert a.title == "FOR YOU"
    assert a.artist == "Tatsuro Yamashita"
    assert a.year == 1982
    assert a.rating == 3.87
    assert a.votes == 12345
    assert a.rank == "#185 for 1982"
    assert a.primary_genres == ["City Pop"]
    assert a.secondary_genres == ["Funk", "Boogie"]
    assert "summer" in a.descriptors and "urban" in a.descriptors
    assert a.rym_url.endswith("/for-you/")


def test_parse_css_fallback_without_jsonld(tmp_path):
    """Real saved RYM pages carry no JSON-LD: title must come from the
    heading's direct text (By-credit is nested inside the same element)."""
    p = tmp_path / "no-ld.html"
    p.write_text(RYM_LIKE.format(js="not json at all"), "utf-8")
    a = parse_html(p)
    assert a.title == "FOR YOU"
    assert a.artist == "Tatsuro Yamashita"
    assert a.rating == 3.87
    assert a.votes == 12345
    assert a.rank == "#185 for 1982"


def test_parse_prefers_album_jsonld_over_recording_jsonld(tmp_path):
    recording = {
        "@type": "MusicRecording",
        "name": "Wrong Track",
        "byArtist": {"@type": "MusicGroup", "name": "Wrong Artist"},
    }
    p = tmp_path / "graph.html"
    p.write_text(RYM_LIKE.format(js=json.dumps([recording, JSONLD])), "utf-8")

    album = parse_html(p)
    assert album.title == "FOR YOU"
    assert album.artist == "Tatsuro Yamashita"


def test_parse_by_artist_suffix_stripped(tmp_path):
    """Even when the heading yields 'Title By Artist' (older saves), the
    suffix is stripped — including dual-script artists."""
    body = RYM_LIKE.format(js="x").replace(
        '<div class="album_title">FOR YOU',
        '<div class="album_title">Ride on Time By 山下達郎 [Tatsuro Yamashita]'
    ).replace('class="artist" href="/artist/tatsuro-yamashita">Tatsuro Yamashita<',
              'class="artist" href="/artist/x">山下達郎 [Tatsuro Yamashita]<')
    p = tmp_path / "dual.html"
    p.write_text(body, "utf-8")
    a = parse_html(p)
    assert a.title == "Ride on Time"
    assert a.artist == "山下達郎 [Tatsuro Yamashita]"


def test_parse_garbage_reports_failure(tmp_path):
    p = tmp_path / "garbage.html"
    p.write_text("<html><body><h1>Access denied</h1></body></html>", "utf-8")
    with pytest.raises(ParseFailure):
        parse_html(p)


def test_db_roundtrip_and_upsert(tmp_path, rym_page):
    con = db.connect(tmp_path / "rym.sqlite")
    a = parse_html(rym_page)
    id1 = db.upsert_album(con, a)
    a.rating = 3.9
    id2 = db.upsert_album(con, a)  # same URL -> update, not duplicate
    assert id1 == id2
    loaded = db.load_albums(con)
    assert len(loaded) == 1
    assert loaded[0].rating == 3.9
    assert loaded[0].all_genres == ["City Pop", "Funk", "Boogie"]

    db.set_match(con, id1, "/library/FOR YOU", 0.93, "auto")
    db.set_match(con, id1, "/library/FOR YOU", 0.93, "confirmed")  # upsert
    rows = db.confirmed_matches(con)
    assert len(rows) == 1
    assert rows[0]["status"] == "confirmed"


def test_run_parse_closes_database_when_output_fails(cfg, rym_page, monkeypatch):
    cfg.rym_pages.mkdir(parents=True, exist_ok=True)
    target = cfg.rym_pages / rym_page.name
    target.write_bytes(rym_page.read_bytes())

    class FakeConnection:
        closed = False

        def close(self):
            self.closed = True

    connection = FakeConnection()
    monkeypatch.setattr("mihonban.rym.parse.db.connect", lambda _: connection)
    monkeypatch.setattr("mihonban.rym.parse.db.upsert_album", lambda *_: 1)

    class FailingConsole:
        def print(self, *_args, **_kwargs):
            raise RuntimeError("console failed")

    with pytest.raises(RuntimeError, match="console failed"):
        run_parse(cfg, FailingConsole())
    assert connection.closed
