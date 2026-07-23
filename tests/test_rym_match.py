from mihonban.rym.db import RymAlbum
from mihonban.rym.match import (AUTO_THRESHOLD, LibAlbum, name_similarity,
                             run_match, score, year_similarity)


def test_romaji_vs_kanji_artist():
    assert name_similarity("Tatsuro Yamashita", "山下達郎") > 0.8


def test_dual_script_bracket_variant():
    assert name_similarity("山下達郎 [Tatsuro Yamashita]", "山下達郎") > 0.95


def test_rym_short_romanization():
    # RYM romanizes him as "Tatsu Yamashita" — must stay well above the
    # ASK threshold when combined with an exact album title
    assert name_similarity("Tatsu Yamashita", "山下達郎") > 0.75


def test_sortname_order_irrelevant():
    assert name_similarity("Yamashita, Tatsuro", "Tatsuro Yamashita") > 0.95


def test_different_artists_low():
    assert name_similarity("Mariya Takeuchi", "山下達郎") < 0.6


def test_album_title_exact():
    assert name_similarity("FOR YOU", "For You") == 1.0


def test_year_similarity_reissue_tolerance():
    assert year_similarity(1980, [1980]) == 1.0
    assert year_similarity(1980, [1981]) == 0.8
    assert year_similarity(1980, [2003]) == 0.3   # reissue gap
    assert year_similarity(None, [1980]) == 0.5


def _rym(title, artist, year):
    return RymAlbum(title=title, artist=artist, year=year)


def test_score_auto_accepts_true_match():
    rym = _rym("GO AHEAD!", "Tatsuro Yamashita", 1978)
    lib = LibAlbum("山下達郎", "GO AHEAD!", [1978], "/library/GO AHEAD!")
    assert score(rym, lib) >= AUTO_THRESHOLD


def test_score_real_rym_trio_auto():
    """The exact artist/title/year combinations from the user's first three
    real RYM pages must all auto-match."""
    cases = [
        (_rym("Go Ahead!", "Tatsu Yamashita", 1978),
         LibAlbum("山下達郎", "GO AHEAD!", [1978], "p1")),
        (_rym("Moonglow", "Tatsu Yamashita", 1979),
         LibAlbum("山下達郎", "MOONGLOW", [1979], "p2")),
        (_rym("Ride on Time", "山下達郎 [Tatsuro Yamashita]", 1980),
         LibAlbum("山下達郎", "Ride On Time", [2003], "p3")),
    ]
    for rym, lib in cases:
        assert score(rym, lib) >= AUTO_THRESHOLD, (rym.title, score(rym, lib))


def test_score_reissue_year_gap_still_matches():
    rym = _rym("Ride On Time", "Tatsuro Yamashita", 1980)
    lib = LibAlbum("山下達郎", "Ride On Time", [2003], "/library/ROT")
    assert score(rym, lib) >= AUTO_THRESHOLD


def test_score_rejects_wrong_album():
    rym = _rym("VARIETY", "Mariya Takeuchi", 1984)
    lib = LibAlbum("山下達郎", "MOONGLOW", [1979], "/library/MOONGLOW")
    assert score(rym, lib) < 0.55


def test_run_match_closes_database_on_empty_library(cfg, monkeypatch):
    class FakeConnection:
        closed = False

        def close(self):
            self.closed = True

    connection = FakeConnection()
    monkeypatch.setattr("mihonban.rym.match.db.connect", lambda _: connection)
    monkeypatch.setattr("mihonban.rym.match.db.load_albums", lambda _: [])

    class Console:
        def print(self, *_args, **_kwargs):
            return None

    assert run_match(cfg, Console()) == 0
    assert connection.closed
