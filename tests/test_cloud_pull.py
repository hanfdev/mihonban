"""mihonban cloud pull：云端有、本地没有的专辑要被拉回本地库，并按云端
元数据补写文件 tag（OneDrive 主源必须自描述——网页上传的文件常没 tag）。

不碰网络也不碰 rclone —— requests 与 subprocess 全部打桩。
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
    assert called == []  # 本地已有且未要求 retag，不该下载也不该动


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
    """拉回的专辑 tag 有改动 → 回传 OneDrive + 重新登记。"""
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
    """--retag：本地已有的云端专辑也补 tag（修存量），没改动就不回传。"""
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
    cloud.pull_quietly(cloud_cfg, _console())  # 不应抛出


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
    """无 tag 的文件按云端元数据补齐；第二遍幂等（0 改动）。"""
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
    # 幂等：没有差异就不写
    assert cloud.retag_album(cloud_cfg, album_dir, album, tracks) == 0


@pytest.mark.needs_ffmpeg
def test_retag_preserves_curated_tags(cloud_cfg, silent_mp3):
    """精修过的 tag 不被裸年份/专辑艺人清洗掉：
    完整日期满足年份、"3/10" 满足音轨号、feat 艺人保留。"""
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
    assert audio["date"] == ["1978-12-25"]          # 完整日期没被清洗
    assert audio["artist"] == ["山下達郎 feat. 吉田美奈子"]  # feat 保留
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
