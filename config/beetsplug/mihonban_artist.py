"""beets 插件：把候选发行的罗马字艺人名折算回日文原名（打分前）。

**为什么需要**：jpop80ss 系源的文件标签是日文原名（"太田裕美"），而
MusicBrainz/Discogs 候选常把艺人存成罗马字（"Hiromi Ohta"）。beets 在
autotag/distance.py 里 `add_string("artist", 文件日文名, 候选罗马字名)` 逐字
比对，单这一项就把相似度从 ~90% 拉到 70%，卡在自动接受门槛下 → 正确的冷门盘
无谓进隔离区。

**介入点**：beets 2.12 已移除 album_distance 插件钩子，但 metadata_plugins
的 `candidates()` 带 @notify_info_yielded("albuminfo_received")，在候选返回、
_add_candidate 算距离**之前**触发，携带可写的 AlbumInfo。我们在此把候选的罗马字
artist 折算成日文原名，距离计算就变成"日文比日文"。

**安全**：只有能高置信度确认同一人（候选自带日文 sort/artists，或 MB alias
搜索确认）才改写；否则原样不动。折算逻辑与文件端补标签（mb_artist.
canonicalize_artists）共用 resolve_original，缓存与语义完全一致。
"""

from __future__ import annotations

import os
from pathlib import Path

from beets.plugins import BeetsPlugin

from mihonban.mb_artist import ArtistCache, has_cjk, resolve_original


def _state_dir() -> Path:
    """artist_map.json 所在的 state 目录。

    beets_runner 把 BEETSDIR 设为 <data_dir>/beets，state 是它的兄弟目录
    <data_dir>/state（见 Config.state_dir）。据此反推，无需重载 toml。
    """
    beetsdir = os.environ.get("BEETSDIR")
    if beetsdir:
        return Path(beetsdir).parent / "state"
    return Path.home() / ".mihonban-state"   # 兜底（正常路径不会走到）


class MihonbanArtist(BeetsPlugin):
    def __init__(self):
        super().__init__()
        # 缓存与文件端补标签共用同一个 artist_map.json（同一条 MB 查询不重复）
        self._cache = ArtistCache(_state_dir() / "artist_map.json")
        self.register_listener("albuminfo_received", self.canon_album)
        self.register_listener("trackinfo_received", self.canon_track)

    def _canon(self, info) -> None:
        """把 info 的罗马字 artist 折算成日文原名（原地改写）。"""
        name = getattr(info, "artist", None)
        if not name or has_cjk(name):
            return
        # 多值合作专辑不碰：主 artist 是罗马字合成名（"A & B"/"Various"），
        # 折算语义不清晰，交给人工/文件标签
        artists = getattr(info, "artists", None) or []
        if len(artists) > 1:
            return

        # 零网络优先：候选自带的 sort / 单值 artists 里若已有日文原名，直接采用
        for cand in self._sidecar_original(info):
            if cand and has_cjk(cand):
                self._apply(info, cand)
                return

        # 否则走缓存 + MB alias 搜索（resolve_original 把关，宁缺毋滥）
        entry = resolve_original(name, self._cache)
        if entry:
            self._apply(info, entry["name"], entry.get("sort"))

    @staticmethod
    def _sidecar_original(info) -> list[str]:
        """候选对象上可能自带的日文原名候选：sort 名、单值 artists。"""
        out = []
        srt = getattr(info, "artist_sort", None)
        if srt:
            out.append(srt)
        artists = getattr(info, "artists", None) or []
        if len(artists) == 1:
            out.append(artists[0])
        return out

    def _apply(self, info, name: str, sort: str | None = None) -> None:
        old = info.artist
        if name and name != old:
            info.artist = name
            if getattr(info, "artists", None) and len(info.artists) == 1:
                info.artists = [name]
            self._log.debug("artist canon: {} -> {}", old, name)
        if sort and not getattr(info, "artist_sort", None):
            info.artist_sort = sort

    def canon_album(self, info) -> None:
        self._canon(info)

    def canon_track(self, info) -> None:
        # 单曲候选也归一化（as Tracks / 单曲匹配路径）
        self._canon(info)
