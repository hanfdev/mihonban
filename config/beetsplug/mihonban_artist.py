"""beets plugin that restores romanized candidate artists to original Japanese
script before scoring.

Why it is needed: files from jpop80ss-derived sources use original Japanese artist
tags, while MusicBrainz and Discogs candidates often use romanization. In
``autotag/distance.py``, beets compares the file's Japanese name against the
candidate's romanized name character by character. That field alone can reduce a
roughly 90% match to 70%, below automatic acceptance, sending a correct obscure
release to quarantine unnecessarily.

Integration point: beets 2.12 removed the ``album_distance`` plugin hook, but
``metadata_plugins.candidates()`` carries
``@notify_info_yielded("albuminfo_received")``. It fires after a candidate is
returned but before ``_add_candidate`` calculates distance, with a mutable
``AlbumInfo``. Restoring the candidate artist here makes the comparison
Japanese-to-Japanese.

Safety: rewrite only when the identity is confirmed with high confidence through
Japanese ``sort``/``artists`` data on the candidate or a MusicBrainz alias search.
Otherwise leave it unchanged. Candidate conversion and file-side tag completion
(``mb_artist.canonicalize_artists``) share ``resolve_original``, keeping their
cache and semantics identical.
"""

from __future__ import annotations

import os
from pathlib import Path

from beets.plugins import BeetsPlugin

from mihonban.mb_artist import ArtistCache, has_cjk, resolve_original


def _state_dir() -> Path:
    """Return the state directory that contains ``artist_map.json``.

    ``beets_runner`` sets ``BEETSDIR`` to ``<data_dir>/beets``; state is its
    sibling ``<data_dir>/state`` (see ``Config.state_dir``). Derive it from that
    relationship without reloading TOML.
    """
    beetsdir = os.environ.get("BEETSDIR")
    if beetsdir:
        return Path(beetsdir).parent / "state"
    return Path.home() / ".mihonban-state"   # Defensive fallback; normal execution never reaches it.


class MihonbanArtist(BeetsPlugin):
    def __init__(self):
        super().__init__()
        # Cache and file-side tag completion share one artist_map.json, avoiding
        # duplicate MusicBrainz queries for the same artist.
        self._cache = ArtistCache(_state_dir() / "artist_map.json")
        self.register_listener("albuminfo_received", self.canon_album)
        self.register_listener("trackinfo_received", self.canon_track)

    def _canon(self, info) -> None:
        """Replace ``info``'s romanized artist with the original Japanese name in place."""
        name = getattr(info, "artist", None)
        if not name or has_cjk(name):
            return
        # Leave multi-artist collaborations alone. Their primary artist is a
        # composite romanized value such as "A & B" or "Various", whose conversion
        # is ambiguous and belongs to manual review or file tags.
        artists = getattr(info, "artists", None) or []
        if len(artists) > 1:
            return

        # Prefer a zero-network path: use a Japanese original already present in
        # candidate sort data or a single-value artists field.
        for cand in self._sidecar_original(info):
            if cand and has_cjk(cand):
                self._apply(info, cand)
                return

        # Otherwise use the cache and MusicBrainz alias search. resolve_original
        # applies the confidence gate and favors no conversion over a wrong one.
        entry = resolve_original(name, self._cache)
        if entry:
            self._apply(info, entry["name"], entry.get("sort"))

    @staticmethod
    def _sidecar_original(info) -> list[str]:
        """Yield possible original Japanese names already present in candidate sort or single-value artists data."""
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
        # Normalize track candidates too, covering the as-Tracks and single-track paths.
        self._canon(info)
