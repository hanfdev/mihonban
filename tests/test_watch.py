import os

from mihonban.watch import (STABLE_POLLS, _inbox_items, _item_signature, _stable,
                         run_watch)


class _Console:
    def __init__(self):
        self.messages = []

    def print(self, message):
        self.messages.append(str(message))


def test_watch_discovers_archives_and_folders_only(cfg):
    archive = cfg.inbox / "album.zip"
    archive.write_bytes(b"not extracted in this discovery test")
    folder = cfg.inbox / "direct album"
    folder.mkdir()
    (folder / "track.flac").write_bytes(b"audio")
    (cfg.inbox / "notes.txt").write_text("ignore me", encoding="utf-8")
    hidden = cfg.inbox / ".copying"
    hidden.mkdir()
    (hidden / "partial.mp3").write_bytes(b"partial")

    assert _inbox_items(cfg) == [archive, folder]


def test_watch_waits_for_complete_archive_and_folder_copy(cfg):
    archive = cfg.inbox / "album.zip"
    archive.write_bytes(b"archive")
    folder = cfg.inbox / "direct album"
    folder.mkdir()
    track = folder / "track.flac"
    track.write_bytes(b"first")
    items = [archive, folder]
    states = {}

    for _ in range(STABLE_POLLS - 1):
        assert _stable(items, states) == []
    assert _stable(items, states) == items

    track.write_bytes(b"copy continued")
    assert _stable(items, states) == [archive]
    for _ in range(STABLE_POLLS - 1):
        ready = _stable(items, states)
    assert folder in ready

    _stable([folder], states)
    assert archive not in states


def test_watch_does_not_process_empty_inputs(cfg):
    archive = cfg.inbox / "empty.zip"
    archive.touch()
    folder = cfg.inbox / "empty folder"
    folder.mkdir()
    states = {}

    for _ in range(STABLE_POLLS + 1):
        assert _stable([archive, folder], states) == []


def test_watch_signature_detects_same_total_size_changes(cfg):
    folder = cfg.inbox / "changing folder"
    folder.mkdir()
    first = folder / "first.flac"
    second = folder / "second.flac"
    first.write_bytes(b"aa")
    second.write_bytes(b"bbbb")
    timestamp = 1_700_000_000_000_000_000
    os.utime(first, ns=(timestamp, timestamp))
    os.utime(second, ns=(timestamp, timestamp))
    before = _item_signature(folder)

    first.write_bytes(b"aaaa")
    second.write_bytes(b"bb")
    os.utime(first, ns=(timestamp, timestamp))
    os.utime(second, ns=(timestamp, timestamp))
    after = _item_signature(folder)

    assert before[:4] == after[:4]
    assert before != after


def test_watch_dispatches_a_stable_folder_and_releases_lock(cfg, monkeypatch):
    folder = cfg.inbox / "watched album"
    folder.mkdir()
    (folder / "track.flac").write_bytes(b"audio")
    calls = []
    sleeps = 0

    def fake_ingest(received_cfg, **kwargs):
        calls.append((received_cfg, kwargs))
        return []

    def fake_sleep(_seconds):
        nonlocal sleeps
        sleeps += 1
        if sleeps >= STABLE_POLLS:
            raise KeyboardInterrupt

    monkeypatch.setattr("mihonban.cloud.cloud_ready", lambda _cfg: False)
    monkeypatch.setattr("mihonban.ingest.run_ingest", fake_ingest)
    monkeypatch.setattr("mihonban.watch.time.sleep", fake_sleep)

    console = _Console()
    assert run_watch(cfg, console) == 0
    assert len(calls) == 1
    assert calls[0][0] is cfg
    assert calls[0][1] == {"apply": True, "items": [folder]}

    from mihonban.lockfile import release, try_lock
    lock = try_lock(cfg.state_dir / "watch.lock")
    assert lock is not None
    release(lock)
