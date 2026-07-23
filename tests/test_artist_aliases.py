# -*- coding: utf-8 -*-
"""艺人别名库（cloud/web/src/artist-aliases.json）+ resolve_original 分层查找。"""

from __future__ import annotations

from pathlib import Path

from mihonban.mb_artist import (ALIAS_PATH, _ALIAS_MISS, ArtistCache,
                             alias_lookup, norm_alias_key, resolve_original)


def test_alias_file_exists_and_loads():
    assert ALIAS_PATH.exists(), ALIAS_PATH
    assert alias_lookup("tatsuro yamashita")["name"] == "山下達郎"


def test_lookup_is_case_and_order_insensitive():
    a = alias_lookup("GOTO KUMIKO")
    b = alias_lookup("Kumiko Goto")
    assert a and b and a["name"] == b["name"] == "後藤久美子"


def test_lookup_strips_accents():
    assert alias_lookup("MÁRCIA")["name"] == "マルシア"


def test_norm_key_folds_x_sign():
    assert norm_alias_key("EAST END × YURI") == "east end x yuri"


def test_unknown_name_returns_miss_sentinel():
    assert alias_lookup("Totally Unknown Artist 42") is _ALIAS_MISS


def test_resolve_prefers_alias_and_skips_resolver(tmp_path: Path):
    calls = []
    def resolver(name):
        calls.append(name)
        return None
    cache = ArtistCache(tmp_path / "cache.json")
    entry = resolve_original("Miki Matsubara", cache, resolver)
    assert entry["name"] == "松原みき"
    assert calls == []            # 别名命中，绝不联网


def test_explicit_null_keeps_latin_without_network(tmp_path: Path):
    calls = []
    def resolver(name):
        calls.append(name)
        return {"name": "偽物", "sort": "x"}
    cache = ArtistCache(tmp_path / "cache.json")
    # zard 在库里显式 null = 官方拉丁名
    assert resolve_original("ZARD", cache, resolver) is None
    assert calls == []            # 不问 MB，也不落缓存


def test_miss_falls_through_to_resolver(tmp_path: Path):
    def resolver(name):
        return {"name": "架空アーティスト", "sort": "Kakuu, Artist"}
    cache = ArtistCache(tmp_path / "cache.json")
    entry = resolve_original("Totally Unknown Artist 42", cache, resolver)
    assert entry["name"] == "架空アーティスト"
