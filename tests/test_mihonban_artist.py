# -*- coding: utf-8 -*-
"""Offline tests for the mihonban_artist beets plugin and ``resolve_original``.

Avoid network access by injecting a fake resolver, preloading the cache, and using
simple AlbumInfo stand-ins. Cover conversion of candidate romanized artist names
to original Japanese script and all associated safety boundaries.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from mihonban.mb_artist import ArtistCache, has_cjk, resolve_original

# Make beetsplug.mihonban_artist importable; repository config/beetsplug is the pluginpath directory.
REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "config"))


class FakeInfo:
    """Stand in for beets AlbumInfo/TrackInfo with only fields the plugin touches."""
    def __init__(self, artist, artist_sort=None, artists=None):
        self.artist = artist
        self.artist_sort = artist_sort
        self.artists = artists


# ---------- resolve_original: shared conversion core ----------

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
    cache.put("unknown romaji", None)   # A previous lookup returned no result.
    assert resolve_original("Unknown Romaji", cache,
                            resolver=lambda n: pytest.fail("不该再查")) is None


def test_resolve_rejects_romaji_to_romaji(tmp_path: Path):
    cache = ArtistCache(tmp_path / "m.json")
    # A still-romanized resolver result did not recover original script, so do not convert.
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


# ---------- Plugin behavior ----------

@pytest.fixture
def plugin(tmp_path, monkeypatch):
    monkeypatch.setenv("BEETSDIR", str(tmp_path / "data" / "beets"))
    from beetsplug.mihonban_artist import MihonbanArtist
    p = MihonbanArtist()
    return p


def test_plugin_folds_via_sidecar_kanji(plugin):
    # The candidate already carries Japanese, often from Discogs artists; use it without network access.
    info = FakeInfo("Hiromi Ohta", artists=["太田裕美"])
    plugin.canon_album(info)
    assert info.artist == "太田裕美"


def test_plugin_folds_via_sort_kanji(plugin):
    info = FakeInfo("Misato", artist_sort="渡辺美里")
    plugin.canon_album(info)
    assert info.artist == "渡辺美里"


def test_plugin_folds_via_cache(plugin, tmp_path):
    # No Japanese sidecar data; use the cache.
    plugin._cache.put("hiromi ohta", {"name": "太田裕美", "sort": "Ohta, Hiromi"})
    info = FakeInfo("Hiromi Ohta")
    plugin.canon_album(info)
    assert info.artist == "太田裕美"


def test_plugin_leaves_unresolvable_untouched(plugin):
    # No cache, no Japanese sidecar data, and the default resolver misses; leave it unchanged.
    plugin._cache.put("nobody", None)
    info = FakeInfo("Nobody")
    plugin.canon_album(info)
    assert info.artist == "Nobody"


def test_plugin_idempotent_on_original(plugin):
    info = FakeInfo("太田裕美")
    plugin.canon_album(info)
    assert info.artist == "太田裕美"


def test_plugin_does_not_touch_multi_artist(plugin):
    # Multi-artist collaboration with a romanized primary artist is ambiguous; do not convert.
    info = FakeInfo("Various", artists=["山下達郎", "竹内まりや"])
    plugin.canon_album(info)
    assert info.artist == "Various"        # Leave unchanged.
    assert len(info.artists) == 2
