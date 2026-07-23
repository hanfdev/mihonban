from mihonban.mojibake import japanese_score, repair_name, repair_text


def _garble(s: str, wrong: str, right: str) -> str:
    """Produce the mojibake you get when `right`-encoded bytes are decoded
    with `wrong`."""
    return s.encode(right).decode(wrong)


class TestRepairText:
    def test_latin1_shiftjis_classic(self):
        orig = "夜の翼"
        broken = _garble(orig, "latin-1", "cp932")
        assert repair_text(broken) == orig

    def test_latin1_with_ascii_mixed(self):
        orig = "RIDE ON TIME(アカペラ)"
        broken = _garble(orig, "latin-1", "cp932")
        assert repair_text(broken) == orig

    def test_ascii_untouched(self):
        assert repair_text("Ride On Time") == "Ride On Time"

    def test_healthy_japanese_untouched(self):
        s = "山下達郎 - あまく危険な香り"
        assert repair_text(s) == s

    def test_healthy_chinese_untouched(self):
        s = "鄧麗君 - 月亮代表我的心"
        assert repair_text(s) == s

    def test_accented_european_untouched(self):
        # Latin-1 text that is legitimate (no SJIS roundtrip gain)
        s = "Café Blue — Édition spéciale"
        assert repair_text(s) == s


class TestRepairName:
    def test_gbk_mojibake_filename(self):
        orig = "02. あまく危険な香り.ogg"
        broken = _garble(orig, "gbk", "cp932")
        assert repair_name(broken) == orig

    def test_cp437_mojibake_filename(self):
        orig = "夢の続き.flac"
        broken = _garble(orig, "cp437", "cp932")
        assert repair_name(broken) == orig

    def test_ascii_filename_untouched(self):
        assert repair_name("01. RIDE ON TIME.ogg") == "01. RIDE ON TIME.ogg"


def test_score_orders_garbage_below_japanese():
    good = "あまく危険な香り"
    bad = _garble(good, "gbk", "cp932")
    assert japanese_score(good) > japanese_score(bad)
