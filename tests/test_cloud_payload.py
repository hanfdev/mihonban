"""Local cloud payload validation and upload ordering."""

from __future__ import annotations

from copy import deepcopy
from io import StringIO

import pytest
from rich.console import Console

from mihonban import cloud


def _payload() -> dict:
    folder = "Music/Library/Artist/Album"
    return {
        "folder": folder,
        "artist": "Artist",
        "artistSort": "Artist",
        "title": "Album",
        "year": 2024,
        "coverPath": f"{folder}/cover.jpg",
        "genres": ["Pop"],
        "secondaryGenres": [],
        "descriptors": ["melodic"],
        "rymRating": 4.25,
        "rymVotes": 123,
        "rymRank": "#1",
        "rymUrl": "https://rateyourmusic.com/release/album/example/",
        "tracks": [{
            "path": f"{folder}/01.flac",
            "title": "First",
            "track": 1,
            "disc": 1,
            "duration": 240.5,
            "bitrate": 900,
            "format": "flac",
            "size": 123_456,
        }],
    }


def _assign(payload: dict, path: str, value: object) -> None:
    current: object = payload
    parts = path.split(".")
    for part in parts[:-1]:
        current = current[int(part)] if isinstance(current, list) else current[part]
    last = parts[-1]
    if isinstance(current, list):
        current[int(last)] = value
    else:
        current[last] = value


def _console() -> Console:
    return Console(file=StringIO(), force_terminal=False)


def test_valid_album_payload_matches_worker_contract():
    assert cloud.validate_album_payload(_payload()) is None


@pytest.mark.parametrize(("path", "value", "message"), [
    ("folder", f"Music/Library/{'A' * 256}/Album", "folder"),
    ("artist", "😀" * 251, "artist"),
    ("title", "T" * 1001, "title"),
    ("year", 0, "year"),
    ("rymRating", 5.01, "rymRating"),
    ("rymVotes", cloud.MAX_SAFE_INTEGER + 1, "rymVotes"),
    ("rymUrl", "https://user:secret@example.test/release", "rymUrl"),
    ("genres", [""], "genres"),
    ("descriptors", ["tag"] * 501, "descriptors"),
    ("coverPath", "Music/Library/Other/cover.jpg", "coverPath"),
    ("tracks.0.path", "Music/Library/Other/01.flac", "path"),
    ("tracks.0.track", 0, "track"),
    ("tracks.0.disc", cloud.MAX_SAFE_INTEGER + 1, "disc"),
    ("tracks.0.title", "T" * 1001, "title"),
    ("tracks.0.format", "f" * 65, "format"),
    ("tracks.0.duration", float("inf"), "duration"),
    ("tracks.0.bitrate", -1, "bitrate"),
    ("tracks.0.size", cloud.MAX_SAFE_INTEGER + 1, "size"),
])
def test_invalid_album_payload_is_rejected(path, value, message):
    payload = deepcopy(_payload())
    _assign(payload, path, value)
    assert message in cloud.validate_album_payload(payload)


def test_normalized_duplicate_track_paths_are_rejected():
    payload = _payload()
    payload["tracks"].append({
        **payload["tracks"][0],
        "path": "Music\\Library\\Artist\\Album\\01.flac",
    })
    assert "重复" in cloud.validate_album_payload(payload)


def test_register_album_rejects_locally_before_network(cfg, monkeypatch):
    cfg.cloud_url = "https://example.test"
    cfg.cloud_key = "key"
    payload = _payload()
    payload["artist"] = "A" * 501

    def unexpected_post(*args, **kwargs):
        raise AssertionError("invalid payload must not reach the network")

    monkeypatch.setattr(cloud.requests, "post", unexpected_post)
    ok, info = cloud.register_album(cfg, payload)
    assert not ok
    assert "artist" in info


def test_sync_preflights_every_album_before_upload(cfg, monkeypatch):
    cfg.cloud_url = "https://example.test"
    cfg.cloud_key = "key"
    first = cfg.music_root / "Artist" / "First"
    second = cfg.music_root / "Artist" / "Second"
    seen = []

    monkeypatch.setattr(cloud, "album_dirs", lambda _cfg: [first, second])
    monkeypatch.setattr(cloud, "payload_for_album", lambda _cfg, directory:
                        seen.append(directory) or (_payload() if directory == first else None))
    monkeypatch.setattr(cloud, "rclone_upload", lambda *args:
                        (_ for _ in ()).throw(
                            AssertionError("upload must wait for all preflight checks")))
    monkeypatch.setattr(cloud, "register_album", lambda *args:
                        (_ for _ in ()).throw(
                            AssertionError("registration must wait for preflight")))

    assert cloud.run_sync(cfg, _console()) == 1
    assert seen == [first, second]


def test_pull_preflights_retagged_album_before_upload(cfg, monkeypatch):
    cfg.cloud_url = "https://example.test"
    cfg.cloud_key = "key"
    cfg.rclone = cfg.music_root / "rclone.exe"
    remote = {
        "id": "a" * 16,
        "folder": "Music/Library/Artist/Album",
        "artist": "Artist",
        "title": "Album",
    }
    monkeypatch.setattr(cloud, "cloud_library", lambda _cfg: [remote])
    monkeypatch.setattr(cloud, "rclone_download", lambda *args: True)
    monkeypatch.setattr(cloud, "cloud_album_detail", lambda *args: {"tracks": []})
    monkeypatch.setattr(cloud, "retag_album", lambda *args: 1)
    monkeypatch.setattr(cloud, "payload_for_album", lambda *args: None)
    monkeypatch.setattr(cloud, "rclone_upload", lambda *args:
                        (_ for _ in ()).throw(
                            AssertionError("invalid retagged album must not upload")))

    assert cloud.run_pull(cfg, _console(), quiet=True) == 1
