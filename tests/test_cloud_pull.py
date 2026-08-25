"""Test mihonban cloud pull: albums present in the cloud but missing locally are
downloaded and tagged from cloud metadata. Authoritative OneDrive files must be
self-describing because web uploads often have no tags.

No real network or rclone access; requests and subprocess are fully stubbed.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from types import SimpleNamespace

import mutagen
import pytest
from rich.console import Console

from mihonban import cloud


@pytest.fixture
def cloud_cfg(cfg):
    cfg.cloud_url = "https://mihonban.example.workers.dev"
    cfg.cloud_key = "test-key"
    cfg.rclone = Path("C:/fake/rclone.exe")
    cfg.rclone_remote = "mihonban:Music/Library"
    return cfg


def _console():
    return Console(file=open("nul", "w", encoding="utf-8"), force_terminal=False)


def _remote(folder, artist="山下達郎", title="X"):
    return {"id": "a" * 16, "folder": folder, "artist": artist, "title": title}


def _stub_retag(monkeypatch, changed=0):
    calls = []
    monkeypatch.setattr(cloud, "cloud_album_detail",
                        lambda cfg, aid: {"tracks": []})
    monkeypatch.setattr(cloud, "retag_album",
                        lambda cfg, d, a, ts: calls.append(d) or changed)
    return calls


def _stub_download(monkeypatch, calls=None):
    def download(cfg, folder, dest, console):
        if calls is not None:
            calls.append((folder, dest))
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "01.mp3").write_bytes(b"audio")
        return True

    monkeypatch.setattr(cloud, "rclone_download", download)


def test_local_dir_for_maps_od_folder(cloud_cfg):
    p = cloud._local_dir_for(cloud_cfg, "Music/Library/山下達郎/[1978] GO AHEAD!")
    assert p == cloud_cfg.music_root / "山下達郎" / "[1978] GO AHEAD!"
    assert cloud._local_dir_for(cloud_cfg, "Other/evil") is None


@pytest.mark.parametrize("folder", [
    "Music/Library/../../escape",
    r"Music/Library/A\..\escape",
    "Music/Library/C:/escape",
    "Music/Library/A//B",
    "Music/Library/",
])
def test_local_dir_for_rejects_unsafe_paths(cloud_cfg, folder):
    assert cloud._local_dir_for(cloud_cfg, folder) is None


def test_payload_preserves_multidisc_relative_paths(cloud_cfg, monkeypatch):
    album_dir = cloud_cfg.music_root / "Artist" / "Album"
    files = []
    for disc in (1, 2):
        path = album_dir / f"Disc {disc}" / "01.mp3"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"audio")
        files.append(path)

    def fake_mutagen(path, easy=False):
        disc = int(Path(path).parent.name.rsplit(" ", 1)[-1])
        return SimpleNamespace(
            tags={
                "title": [f"Disc {disc} opener"],
                "albumartist": ["Artist"],
                "album": ["Album"],
                "tracknumber": ["1"],
                "discnumber": [str(disc)],
            },
            info=SimpleNamespace(length=10.0 + disc, bitrate=320_000),
        )

    monkeypatch.setattr(cloud.mutagen, "File", fake_mutagen)
    payload = cloud.payload_for_album(cloud_cfg, album_dir)

    assert payload is not None
    assert [track["path"] for track in payload["tracks"]] == [
        "Music/Library/Artist/Album/Disc 1/01.mp3",
        "Music/Library/Artist/Album/Disc 2/01.mp3",
    ]
    assert [track["disc"] for track in payload["tracks"]] == [1, 2]


def test_payload_copies_artist_sort_tag(cloud_cfg, monkeypatch):
    album_dir = cloud_cfg.music_root / "石川秀美" / "Summer Breeze"
    album_dir.mkdir(parents=True)
    (album_dir / "01.mp3").write_bytes(b"audio")

    def fake_mutagen(_path, easy=False):
        return SimpleNamespace(
            tags={
                "title": ["Song"], "albumartist": ["石川秀美"],
                "albumartistsort": ["Ishikawa, Hidemi"],
                "album": ["Summer Breeze"], "tracknumber": ["1"],
            },
            info=SimpleNamespace(length=10.0, bitrate=320_000),
        )

    monkeypatch.setattr(cloud.mutagen, "File", fake_mutagen)
    payload = cloud.payload_for_album(cloud_cfg, album_dir)

    assert payload["artistSort"] == "Ishikawa, Hidemi"


def test_payload_preserves_ordered_multi_artist_tags(cloud_cfg, monkeypatch):
    album_dir = cloud_cfg.music_root / "山下達郎" / "Pacific"
    album_dir.mkdir(parents=True)
    (album_dir / "01.mp3").write_bytes(b"audio")

    def fake_mutagen(_path, easy=False):
        return SimpleNamespace(
            tags={
                "title": ["Music Book"],
                "albumartist": ["山下達郎", "竹内まりや"],
                "albumartistsort": ["Yamashita, Tatsuro", "Takeuchi, Mariya"],
                "album": ["Pacific"], "tracknumber": ["1"],
            },
            info=SimpleNamespace(length=10.0, bitrate=320_000),
        )

    monkeypatch.setattr(cloud.mutagen, "File", fake_mutagen)
    payload = cloud.payload_for_album(cloud_cfg, album_dir)

    assert payload["artist"] == "山下達郎 × 竹内まりや"
    assert payload["artists"] == [
        {"name": "山下達郎", "sort": "Yamashita, Tatsuro"},
        {"name": "竹内まりや", "sort": "Takeuchi, Mariya"},
    ]


def test_payload_uses_track_artist_values_only_for_collaboration_overrides(
        cloud_cfg, monkeypatch):
    album_dir = cloud_cfg.music_root / "山下達郎" / "For You"
    album_dir.mkdir(parents=True)
    (album_dir / "01.mp3").write_bytes(b"audio")
    (album_dir / "02.mp3").write_bytes(b"audio")

    def fake_mutagen(path, easy=False):
        name = Path(path).name
        artists = (["山下達郎", "竹内まりや"]
                   if name == "02.mp3" else ["山下達郎"])
        sorts = (["Yamashita, Tatsuro", "Takeuchi, Mariya"]
                 if name == "02.mp3" else ["Yamashita, Tatsuro"])
        return SimpleNamespace(
            tags={
                "title": ["Collaboration" if name == "02.mp3" else "Solo"],
                "albumartist": ["山下達郎"],
                "albumartistsort": ["Yamashita, Tatsuro"],
                "artist": artists,
                "artistsort": sorts,
                "album": ["For You"],
                "tracknumber": ["2" if name == "02.mp3" else "1"],
            },
            info=SimpleNamespace(length=10.0, bitrate=320_000),
        )

    monkeypatch.setattr(cloud.mutagen, "File", fake_mutagen)
    payload = cloud.payload_for_album(cloud_cfg, album_dir)

    assert payload["artists"] == [
        {"name": "山下達郎", "sort": "Yamashita, Tatsuro"},
    ]
    assert "artists" not in payload["tracks"][0]
    assert payload["tracks"][1]["artists"] == [
        {"name": "山下達郎", "sort": "Yamashita, Tatsuro"},
        {"name": "竹内まりや", "sort": "Takeuchi, Mariya"},
    ]


def test_structured_artists_override_display_joiners_and_stale_sort_text(
        cloud_cfg, monkeypatch):
    album_dir = cloud_cfg.music_root / "Various Artists" / "Compilation"
    album_dir.mkdir(parents=True)
    (album_dir / "01.flac").write_bytes(b"audio")

    def fake_mutagen(_path, easy=False):
        return SimpleNamespace(
            tags={
                "title": ["WINDY AFTERNOON"],
                "albumartist": ["Various Artists"],
                "artist": ["microtone feat. Nakamura Megumi"],
                "artists": ["microtone", "Nakamura Megumi"],
                "artistsort": [
                    "microtone & Fujiiwa, Satoko", "Nakamura Megumi",
                ],
                "musicbrainz_artistid": ["one", "two"],
                "album": ["Compilation"], "tracknumber": ["1"],
            },
            info=SimpleNamespace(length=10.0, bitrate=320_000),
        )

    monkeypatch.setattr(cloud.mutagen, "File", fake_mutagen)
    monkeypatch.setattr(cloud, "resolve_sort_name",
                        lambda name, cache: name)
    payload = cloud.payload_for_album(cloud_cfg, album_dir)

    assert payload["tracks"][0]["artists"] == [
        {"name": "microtone", "sort": "microtone"},
        {"name": "Nakamura Megumi", "sort": "Nakamura Megumi"},
    ]


def test_artist_text_splits_only_with_explicit_or_identity_backed_evidence():
    assert cloud._split_artist_text(
        "GROOVE UNCHANT feat. pecombo") == ["GROOVE UNCHANT", "pecombo"]
    assert cloud._split_artist_text(
        "yellow mellow kite town, yummy & Shun", 3,
    ) == ["yellow mellow kite town", "yummy", "Shun"]
    assert cloud._split_artist_text("Neil & Iraiza", 1) == ["Neil & Iraiza"]
    assert cloud._split_artist_text(
        "Round Table Featuring Nino", 0, allow_explicit=False,
    ) == ["Round Table Featuring Nino"]


def test_desired_tags_keep_album_credit_and_write_track_credit_separately():
    album = {
        "artists": [{"name": "山下達郎", "sort": "Yamashita, Tatsuro"}],
        "title": "For You",
    }
    track = {
        "artists": [
            {"name": "山下達郎", "sort": "Yamashita, Tatsuro"},
            {"name": "竹内まりや", "sort": "Takeuchi, Mariya"},
        ],
        "title": "Collaboration",
        "track": 2,
    }

    tags = cloud._desired_tags(album, track)

    assert tags["albumartist"] == ["山下達郎"]
    assert tags["albumartistsort"] == ["Yamashita, Tatsuro"]
    assert tags["artist"] == ["山下達郎", "竹内まりや"]
    assert tags["artistsort"] == ["Yamashita, Tatsuro", "Takeuchi, Mariya"]


def test_desired_tags_falls_back_when_structured_album_credit_is_empty():
    tags = cloud._desired_tags({
        "artist": "山下達郎",
        "artistSort": "Yamashita, Tatsuro",
        "artists": [],
        "title": "For You",
    }, {"title": "Sparkle"})

    assert tags["albumartist"] == ["山下達郎"]
    assert tags["albumartistsort"] == ["Yamashita, Tatsuro"]
    assert tags["artist"] == ["山下達郎"]


def test_payload_fills_known_artist_sort_when_tag_is_missing(
        cloud_cfg, monkeypatch):
    album_dir = cloud_cfg.music_root / "流線形" / "City Music"
    album_dir.mkdir(parents=True)
    (album_dir / "01.mp3").write_bytes(b"audio")

    def fake_mutagen(_path, easy=False):
        return SimpleNamespace(
            tags={
                "title": ["Song"], "albumartist": ["流線形"],
                "album": ["City Music"], "tracknumber": ["1"],
            },
            info=SimpleNamespace(length=10.0, bitrate=320_000),
        )

    monkeypatch.setattr(cloud.mutagen, "File", fake_mutagen)
    payload = cloud.payload_for_album(cloud_cfg, album_dir)

    assert payload["artistSort"] == "Ryusenkei"


def test_payload_ignores_zero_originaldate_and_uses_release_date(
        cloud_cfg, monkeypatch):
    album_dir = cloud_cfg.music_root / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    (album_dir / "01.mp3").write_bytes(b"audio")

    def fake_mutagen(_path, easy=False):
        return SimpleNamespace(
            tags={
                "title": ["Song"],
                "albumartist": ["Artist"],
                "album": ["Album"],
                "originaldate": ["0000"],
                "date": ["1978"],
                "tracknumber": ["1/0"],
                "discnumber": ["0/0"],
            },
            info=SimpleNamespace(length=10.0, bitrate=320_000),
        )

    monkeypatch.setattr(cloud.mutagen, "File", fake_mutagen)

    payload = cloud.payload_for_album(cloud_cfg, album_dir)

    assert payload is not None
    assert payload["year"] == 1978
    assert payload["tracks"][0]["track"] == 1
    assert payload["tracks"][0]["disc"] == 1


@pytest.mark.parametrize("rating", ["not-a-number", "NaN", "Infinity"])
def test_rym_invalid_rating_is_ignored(rating):
    audio = SimpleNamespace(tags={
        "RYM_RATING": [rating],
        "RYM_VOTES": ["also-invalid"],
    })
    rym = cloud._rym_from_tags(audio)
    assert rym["rating"] is None
    assert rym["votes"] is None


def test_rym_mp4_freeform_tags_are_read():
    audio = SimpleNamespace(tags={
        "----:com.apple.iTunes:RYM_RATING": [b"3.87"],
        "----:com.apple.iTunes:RYM_VOTES": [b"12345"],
        "----:com.apple.iTunes:RYM_GENRES": [b"City Pop; Funk"],
    })

    rym = cloud._rym_from_tags(audio)
    assert rym["rating"] == 3.87
    assert rym["votes"] == 12345
    assert rym["genres"] == ["City Pop", "Funk"]


def test_rym_secondary_genres_are_restored_from_portable_tags():
    audio = SimpleNamespace(tags={
        "RYM_GENRES": ["Shibuya-kei; Indietronica; Acid Jazz"],
        "RYM_SECONDARY_GENRES": ["Acid Jazz"],
    })

    rym = cloud._rym_from_tags(audio)

    assert rym["genres"] == ["Shibuya-kei", "Indietronica"]
    assert rym["secondaryGenres"] == ["Acid Jazz"]


def test_payload_checks_later_tracks_for_rym_and_preserves_cover_case(
        cloud_cfg, monkeypatch):
    album_dir = cloud_cfg.music_root / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    first = album_dir / "01.mp3"
    second = album_dir / "02.mp3"
    first.write_bytes(b"one")
    second.write_bytes(b"two")
    (album_dir / "Cover.JPG").write_bytes(b"image")

    def fake_mutagen(path, easy=False):
        path = Path(path)
        if easy:
            return SimpleNamespace(
                tags={"title": [path.stem], "albumartist": ["Artist"],
                      "album": ["Album"]},
                info=SimpleNamespace(length=10.0, bitrate=320_000),
            )
        tags = {} if path == first else {
            "----:com.apple.iTunes:RYM_RATING": [b"4.20"],
            "----:com.apple.iTunes:RYM_GENRES": [b"City Pop"],
        }
        return SimpleNamespace(tags=tags)

    monkeypatch.setattr(cloud.mutagen, "File", fake_mutagen)
    payload = cloud.payload_for_album(cloud_cfg, album_dir)

    assert payload["rymRating"] == 4.2
    assert payload["genres"] == ["City Pop"]
    assert payload["coverPath"].endswith("/Cover.JPG")


def test_payload_rejects_album_outside_music_root(cloud_cfg, tmp_path):
    album = tmp_path / "outside" / "Album"
    album.mkdir(parents=True)
    (album / "01.mp3").write_bytes(b"audio")

    assert cloud.payload_for_album(cloud_cfg, album) is None


def test_merge_cloud_passwords_ignores_malformed_remote_values(
        cloud_cfg, monkeypatch):
    cloud_cfg.passwords = ["local"]
    monkeypatch.setattr(cloud, "fetch_cloud_settings",
                        lambda _cfg: {"archivePasswords": "not-a-list"})
    cloud.merge_cloud_passwords(cloud_cfg)
    assert cloud_cfg.passwords == ["local"]

    monkeypatch.setattr(cloud, "fetch_cloud_settings", lambda _cfg: {
        "archivePasswords": ["remote", {"bad": True}, "", "local"],
    })
    cloud.merge_cloud_passwords(cloud_cfg)
    assert cloud_cfg.passwords == ["remote", "local"]


def test_pull_skips_existing_albums(cloud_cfg, monkeypatch):
    local = cloud_cfg.music_root / "山下達郎" / "[1978] GO AHEAD!"
    local.mkdir(parents=True)
    (local / "01.mp3").write_bytes(b"audio")
    monkeypatch.setattr(cloud, "cloud_library", lambda cfg: [
        _remote("Music/Library/山下達郎/[1978] GO AHEAD!")])
    called = []
    monkeypatch.setattr(cloud, "rclone_download",
                        lambda *a, **k: called.append(a) or True)
    rc = cloud.run_pull(cloud_cfg, _console(), quiet=True)
    assert rc == 0
    assert called == []  # Already local without retag requested; do not download or modify it.


def test_pull_downloads_missing(cloud_cfg, monkeypatch):
    monkeypatch.setattr(cloud, "cloud_library", lambda cfg: [
        _remote("Music/Library/竹内まりや/[1984] VARIETY", "竹内まりや", "VARIETY")])
    downloaded = []

    _stub_download(monkeypatch, downloaded)
    _stub_retag(monkeypatch, changed=0)
    rc = cloud.run_pull(cloud_cfg, _console())
    assert rc == 0
    assert downloaded == [(
        "Music/Library/竹内まりや/[1984] VARIETY",
        cloud_cfg.music_root / "竹内まりや" / "[1984] VARIETY")]


def test_pull_retags_and_uploads_back(cloud_cfg, monkeypatch):
    """Changed tags on a pulled album are uploaded to OneDrive and registered again."""
    monkeypatch.setattr(cloud, "cloud_library", lambda cfg: [
        _remote("Music/Library/jenny01/Cluster", "jenny01", "Cluster")])
    _stub_download(monkeypatch)
    _stub_retag(monkeypatch, changed=3)
    uploads, registers = [], []
    monkeypatch.setattr(cloud, "rclone_upload",
                        lambda cfg, d, con: uploads.append(d) or True)
    monkeypatch.setattr(cloud, "payload_for_album",
                        lambda cfg, d: {"folder": "x", "tracks": []})
    monkeypatch.setattr(cloud, "register_album",
                        lambda cfg, p: registers.append(p) or (True, "id"))
    rc = cloud.run_pull(cloud_cfg, _console())
    assert rc == 0
    assert len(uploads) == 1 and len(registers) == 1


def test_pull_retag_existing_repairs_local(cloud_cfg, monkeypatch):
    """--retag repairs existing local cloud albums and uploads nothing when unchanged."""
    local = cloud_cfg.music_root / "jenny01" / "Cluster"
    local.mkdir(parents=True)
    (local / "01.mp3").write_bytes(b"audio")
    monkeypatch.setattr(cloud, "cloud_library", lambda cfg: [
        _remote("Music/Library/jenny01/Cluster", "jenny01", "Cluster")])
    monkeypatch.setattr(cloud, "rclone_download",
                        lambda *a: (_ for _ in ()).throw(AssertionError("不该下载")))
    retagged = _stub_retag(monkeypatch, changed=0)
    rc = cloud.run_pull(cloud_cfg, _console(), quiet=True, retag_existing=True)
    assert rc == 0
    assert retagged == [local]


def test_pull_reports_failure(cloud_cfg, monkeypatch):
    monkeypatch.setattr(cloud, "cloud_library", lambda cfg: [
        _remote("Music/Library/A/B")])
    monkeypatch.setattr(cloud, "rclone_download", lambda *a: False)
    rc = cloud.run_pull(cloud_cfg, _console(), quiet=True)
    assert rc == 1


def test_pull_preserves_partial_download_and_marker_on_failure(
        cloud_cfg, monkeypatch):
    remote = _remote("Music/Library/A/B")
    monkeypatch.setattr(cloud, "cloud_library", lambda cfg: [remote])

    def partial_download(cfg, folder, dest, console):
        dest.mkdir(parents=True)
        (dest / "partial.flac").write_bytes(b"partial")
        return False

    monkeypatch.setattr(cloud, "rclone_download", partial_download)
    assert cloud.run_pull(cloud_cfg, _console(), quiet=True) == 1
    dest = cloud_cfg.music_root / "A" / "B"
    assert (dest / "partial.flac").read_bytes() == b"partial"
    assert cloud._pull_marker(cloud_cfg, remote["folder"]).exists()


def test_pull_retries_legacy_directory_containing_rclone_partial(
        cloud_cfg, monkeypatch):
    remote = _remote("Music/Library/A/B")
    dest = cloud_cfg.music_root / "A" / "B"
    dest.mkdir(parents=True)
    partial = dest / "01.flac.12345678.partial"
    partial.write_bytes(b"partial")
    monkeypatch.setattr(cloud, "cloud_library", lambda cfg: [remote])
    calls = []

    def finish_download(cfg, folder, album_dir, console):
        calls.append(folder)
        partial.unlink()
        (album_dir / "01.flac").write_bytes(b"audio")
        return True

    monkeypatch.setattr(cloud, "rclone_download", finish_download)
    _stub_retag(monkeypatch)
    assert cloud.run_pull(cloud_cfg, _console(), quiet=True) == 0
    assert calls == [remote["folder"]]


def test_pull_retries_existing_directory_without_audio(cloud_cfg, monkeypatch):
    remote = _remote("Music/Library/A/B")
    dest = cloud_cfg.music_root / "A" / "B"
    dest.mkdir(parents=True)
    (dest / "cover.jpg").write_bytes(b"image")
    monkeypatch.setattr(cloud, "cloud_library", lambda cfg: [remote])
    calls = []
    _stub_download(monkeypatch, calls)
    _stub_retag(monkeypatch)

    assert cloud.run_pull(cloud_cfg, _console(), quiet=True) == 0
    assert calls == [(remote["folder"], dest)]


def test_pull_marker_recovers_interrupted_process_with_complete_files(
        cloud_cfg, monkeypatch):
    remote = _remote("Music/Library/A/B")
    dest = cloud_cfg.music_root / "A" / "B"
    dest.mkdir(parents=True)
    (dest / "01.flac").write_bytes(b"audio")
    assert cloud._mark_pull_incomplete(cloud_cfg, remote["folder"])
    monkeypatch.setattr(cloud, "cloud_library", lambda cfg: [remote])
    calls = []
    _stub_download(monkeypatch, calls)
    _stub_retag(monkeypatch)

    assert cloud.run_pull(cloud_cfg, _console(), quiet=True) == 0
    assert calls == [(remote["folder"], dest)]
    assert not cloud._pull_marker(cloud_cfg, remote["folder"]).exists()


def test_pull_keeps_marker_until_retag_upload_and_registration_succeed(
        cloud_cfg, monkeypatch):
    remote = _remote("Music/Library/A/B")
    monkeypatch.setattr(cloud, "cloud_library", lambda cfg: [remote])
    _stub_download(monkeypatch)
    _stub_retag(monkeypatch, changed=1)
    monkeypatch.setattr(cloud, "payload_for_album",
                        lambda *a: {"tracks": []})
    monkeypatch.setattr(cloud, "rclone_upload", lambda *a: True)
    monkeypatch.setattr(cloud, "register_album",
                        lambda *a: (False, "D1 unavailable"))

    assert cloud.run_pull(cloud_cfg, _console(), quiet=True) == 1
    assert cloud._pull_marker(cloud_cfg, remote["folder"]).exists()

    monkeypatch.setattr(cloud, "register_album", lambda *a: (True, "id"))
    assert cloud.run_pull(cloud_cfg, _console(), quiet=True) == 0
    assert not cloud._pull_marker(cloud_cfg, remote["folder"]).exists()


def test_pull_marks_upload_failure_instead_of_reporting_success(
        cloud_cfg, monkeypatch):
    monkeypatch.setattr(cloud, "cloud_library", lambda cfg: [
        _remote("Music/Library/A/B")])
    _stub_download(monkeypatch)
    _stub_retag(monkeypatch, changed=1)
    monkeypatch.setattr(cloud, "rclone_upload", lambda *a: False)
    monkeypatch.setattr(cloud, "payload_for_album",
                        lambda *a: {"tracks": []})
    assert cloud.run_pull(cloud_cfg, _console(), quiet=True) == 1


def test_pull_marks_registration_failure(cloud_cfg, monkeypatch):
    monkeypatch.setattr(cloud, "cloud_library", lambda cfg: [
        _remote("Music/Library/A/B")])
    _stub_download(monkeypatch)
    _stub_retag(monkeypatch, changed=1)
    monkeypatch.setattr(cloud, "rclone_upload", lambda *a: True)
    monkeypatch.setattr(cloud, "payload_for_album",
                        lambda *a: {"tracks": []})
    monkeypatch.setattr(cloud, "register_album",
                        lambda *a: (False, "D1 unavailable"))
    assert cloud.run_pull(cloud_cfg, _console(), quiet=True) == 1


def test_pull_rejects_malformed_cloud_rows(cloud_cfg, monkeypatch):
    monkeypatch.setattr(cloud, "cloud_library", lambda cfg: [
        {"folder": "Music/Library/A/B"},
        {"id": "ok", "folder": "Other/A"},
    ])
    assert cloud.run_pull(cloud_cfg, _console(), quiet=True) == 1


def test_rclone_missing_is_reported_without_spawning_process(cfg):
    cfg.rclone = None
    assert not cloud.rclone_upload(cfg, None, _console())
    assert not cloud.rclone_download(
        cfg, "Music/Library/A/B", cfg.music_root / "A" / "B", _console())


def test_pull_without_cloud_config(cfg):
    assert cloud.run_pull(cfg, _console(), quiet=True) == 1


def test_pull_quietly_never_raises(cloud_cfg, monkeypatch):
    def boom(cfg):
        raise RuntimeError("network down")
    monkeypatch.setattr(cloud, "cloud_library", boom)
    cloud.pull_quietly(cloud_cfg, _console())  # Must not raise.


def test_rclone_download_builds_correct_command(cloud_cfg, monkeypatch):
    calls = []

    class R:
        returncode = 0
        stderr = ""

    def fake_run(cmd, **kw):
        calls.append(cmd)
        return R()

    monkeypatch.setattr(cloud.subprocess, "run", fake_run)
    dest = cloud_cfg.music_root / "A" / "B"
    ok = cloud.rclone_download(cloud_cfg, "Music/Library/A/B", dest, _console())
    assert ok
    cmd = calls[0]
    assert cmd[0] == str(cloud_cfg.rclone)
    assert cmd[1] == "copy"
    assert cmd[2] == "mihonban:Music/Library/A/B"
    assert cmd[3] == str(dest)


def test_rclone_download_timeout_is_reported(cloud_cfg, monkeypatch):
    def timeout(cmd, **kwargs):
        assert kwargs["timeout"] == 6 * 3600
        raise cloud.subprocess.TimeoutExpired(cmd, kwargs["timeout"])

    monkeypatch.setattr(cloud.subprocess, "run", timeout)
    dest = cloud_cfg.music_root / "A" / "B"
    assert not cloud.rclone_download(
        cloud_cfg, "Music/Library/A/B", dest, _console())


def test_rclone_upload_timeout_is_reported(cloud_cfg, monkeypatch):
    def timeout(cmd, **kwargs):
        assert kwargs["timeout"] == 6 * 3600
        raise cloud.subprocess.TimeoutExpired(cmd, kwargs["timeout"])

    monkeypatch.setattr(cloud.subprocess, "run", timeout)
    album_dir = cloud_cfg.music_root / "A" / "B"
    album_dir.mkdir(parents=True)
    assert not cloud.rclone_upload(cloud_cfg, album_dir, _console())


@pytest.mark.needs_ffmpeg
def test_retag_album_writes_cloud_metadata(cloud_cfg, silent_mp3):
    """Fill an untagged file from cloud metadata; the second pass is idempotent with zero changes."""
    album_dir = cloud_cfg.music_root / "jenny01" / "Cluster"
    album_dir.mkdir(parents=True)
    f = album_dir / "01 opener.mp3"
    shutil.copy(silent_mp3, f)

    album = {"artist": "jenny01", "title": "Cluster", "year": 2024,
             "genres": ["Dream Pop", "Shoegaze"]}
    tracks = [{"path": "Music/Library/jenny01/Cluster/01 opener.mp3",
               "title": "Opener", "track": 1, "disc": 1}]

    changed = cloud.retag_album(cloud_cfg, album_dir, album, tracks)
    assert changed == 1
    audio = mutagen.File(f, easy=True)
    assert audio["albumartist"] == ["jenny01"]
    assert audio["album"] == ["Cluster"]
    assert audio["title"] == ["Opener"]
    assert audio["tracknumber"] == ["1"]
    assert audio["date"] == ["2024"]
    assert audio["genre"] == ["Dream Pop", "Shoegaze"]
    # Idempotent: write nothing when there is no difference.
    assert cloud.retag_album(cloud_cfg, album_dir, album, tracks) == 0


@pytest.mark.needs_ffmpeg
def test_retag_preserves_curated_tags(cloud_cfg, silent_mp3):
    """Preserve curated tags rather than flattening them to a bare year or album
    artist: a full date satisfies year, ``3/10`` satisfies track number, and a
    featured artist remains intact."""
    album_dir = cloud_cfg.music_root / "山下達郎" / "[1978] GO AHEAD!"
    album_dir.mkdir(parents=True)
    f = album_dir / "03 song.mp3"
    shutil.copy(silent_mp3, f)
    audio = mutagen.File(f, easy=True)
    audio.tags["albumartist"] = ["山下達郎"]
    audio.tags["artist"] = ["山下達郎 feat. 吉田美奈子"]
    audio.tags["album"] = ["GO AHEAD!"]
    audio.tags["title"] = ["BOMBER"]
    audio.tags["date"] = ["1978-12-25"]
    audio.tags["tracknumber"] = ["3/10"]
    audio.tags["genre"] = ["City Pop", "Funk"]
    audio.save()

    album = {"artist": "山下達郎", "title": "GO AHEAD!", "year": 1978,
             "genres": ["City Pop", "Funk"]}
    tracks = [{"path": "Music/Library/山下達郎/[1978] GO AHEAD!/03 song.mp3",
               "title": "BOMBER", "track": 3, "disc": 1}]
    assert cloud.retag_album(cloud_cfg, album_dir, album, tracks) == 0
    audio = mutagen.File(f, easy=True)
    assert audio["date"] == ["1978-12-25"]          # Preserve the full date.
    assert audio["artist"] == ["山下達郎 feat. 吉田美奈子"]  # Preserve the featured artist.
    assert audio["tracknumber"] == ["3/10"]


@pytest.mark.needs_ffmpeg
def test_retag_multidisc_tracks_with_same_basename(cloud_cfg, silent_mp3):
    album_dir = cloud_cfg.music_root / "Artist" / "Album"
    first = album_dir / "Disc 1" / "01.mp3"
    second = album_dir / "Disc 2" / "01.mp3"
    first.parent.mkdir(parents=True)
    second.parent.mkdir(parents=True)
    shutil.copy(silent_mp3, first)
    shutil.copy(silent_mp3, second)

    album = {"artist": "Artist", "title": "Album", "year": 2024,
             "genres": []}
    tracks = [
        {"path": "Music/Library/Artist/Album/Disc 1/01.mp3",
         "title": "First disc", "track": 1, "disc": 1},
        {"path": "Music/Library/Artist/Album/Disc 2/01.mp3",
         "title": "Second disc", "track": 1, "disc": 2},
    ]

    assert cloud.retag_album(cloud_cfg, album_dir, album, tracks) == 2
    assert mutagen.File(first, easy=True)["title"] == ["First disc"]
    second_audio = mutagen.File(second, easy=True)
    assert second_audio["title"] == ["Second disc"]
    assert second_audio["discnumber"] == ["2"]
