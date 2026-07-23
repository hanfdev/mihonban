# -*- coding: utf-8 -*-
"""mihonban_artist beets 插件 + resolve_original 折算逻辑（离线单测）。

不联网：注入假 resolver / 预填缓存 / 用简单对象假扮 AlbumInfo。
覆盖插件把候选罗马字艺人名折算回日文原名的各条路径与保护边界。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from mihonban.mb_artist import ArtistCache, has_cjk, resolve_original

# 让 beetsplug.mihonban_artist 可导入（仓库 config/beetsplug 是 pluginpath 目录）
REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "config"))


class FakeInfo:
    """假扮 beets AlbumInfo / TrackInfo，只带插件会碰的字段。"""
    def __init__(self, artist, artist_sort=None, artists=None):
        self.artist = artist
        self.artist_sort = artist_sort
        self.artists = artists


# ---------- resolve_original（共享折算核心） ----------

def test_resolve_uses_cache(tmp_path: Path):
    cache = ArtistCache(tmp_path / "m.json")
    cache.put("hiromi ohta", {"name": "太田裕美", "sort": "Ohta, Hiromi"})
    entry = resolve_original("Hiromi Ohta", cache,
                             resolver=lambda n: pytest.fail("不该联网"))
    assert entry["name"] == "太田裕美"


def test_resolve_skips_already_original(tmp_path: Path):
    cache = ArtistCache(tmp_path / "m.json")
    assert resolve_original("太田裕美", cache,
                            resolver=lambda n: pytest.fail("不该联网")) is None


def test_resolve_negative_cached_no_refetch(tmp_path: Path):
    cache = ArtistCache(tmp_path / "m.json")
    cache.put("unknown romaji", None)   # 上次查过、没结果
    assert resolve_original("Unknown Romaji", cache,
                            resolver=lambda n: pytest.fail("不该再查")) is None


def test_resolve_rejects_romaji_to_romaji(tmp_path: Path):
    cache = ArtistCache(tmp_path / "m.json")
    # resolver 返回的还是罗马字（没拿到原文）→ 不折算
    entry = resolve_original("Some Band", cache,
                             resolver=lambda n: {"name": "Some Band JP",
                                                 "sort": ""})
    assert entry is None


def test_artist_cache_tolerates_valid_json_with_wrong_shape(tmp_path: Path):
    path = tmp_path / "m.json"
    path.write_text(json.dumps([]), encoding="utf-8")
    cache = ArtistCache(path)
    entry = resolve_original(
        "Cache Shape Test", cache,
        resolver=lambda _name: {"name": "测试歌手", "sort": "Test, Cache"},
    )
    assert entry["name"] == "测试歌手"


def test_artist_cache_ignores_malformed_cached_entry(tmp_path: Path):
    path = tmp_path / "m.json"
    path.write_text(json.dumps({"broken artist": {"name": 123}}),
                    encoding="utf-8")
    cache = ArtistCache(path)
    assert resolve_original(
        "Broken Artist", cache,
        resolver=lambda _name: pytest.fail("cached entry should not refetch"),
    ) is None


# ---------- 插件行为 ----------

@pytest.fixture
def plugin(tmp_path, monkeypatch):
    monkeypatch.setenv("BEETSDIR", str(tmp_path / "data" / "beets"))
    from beetsplug.mihonban_artist import MihonbanArtist
    p = MihonbanArtist()
    return p


def test_plugin_folds_via_sidecar_kanji(plugin):
    # 候选自带日文（Discogs 常把原名放 artists 里）→ 零网络直接采用
    info = FakeInfo("Hiromi Ohta", artists=["太田裕美"])
    plugin.canon_album(info)
    assert info.artist == "太田裕美"


def test_plugin_folds_via_sort_kanji(plugin):
    info = FakeInfo("Misato", artist_sort="渡辺美里")
    plugin.canon_album(info)
    assert info.artist == "渡辺美里"


def test_plugin_folds_via_cache(plugin, tmp_path):
    # 无 sidecar 日文 → 走缓存
    plugin._cache.put("hiromi ohta", {"name": "太田裕美", "sort": "Ohta, Hiromi"})
    info = FakeInfo("Hiromi Ohta")
    plugin.canon_album(info)
    assert info.artist == "太田裕美"


def test_plugin_leaves_unresolvable_untouched(plugin):
    # 缓存没有、sidecar 没日文、resolver 默认查不到 → 原样不动
    plugin._cache.put("nobody", None)
    info = FakeInfo("Nobody")
    plugin.canon_album(info)
    assert info.artist == "Nobody"


def test_plugin_idempotent_on_original(plugin):
    info = FakeInfo("太田裕美")
    plugin.canon_album(info)
    assert info.artist == "太田裕美"


def test_plugin_does_not_touch_multi_artist(plugin):
    # 多值合作专辑：主 artist 罗马字但有多个 artists → 不折算（语义不清）
    info = FakeInfo("Various", artists=["山下達郎", "竹内まりや"])
    plugin.canon_album(info)
    assert info.artist == "Various"        # 原样不动
    assert len(info.artists) == 2
