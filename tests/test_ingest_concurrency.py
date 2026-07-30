# -*- coding: utf-8 -*-
"""Concurrency resilience: two watch/ingest processes no longer crash each other while racing for one batch."""

from __future__ import annotations

from pathlib import Path

import pytest

from mihonban import ingest
from mihonban.ingest import (_move_with_suffix, _post_import_artifacts,
                          _quarantine, _workspace_for, process_item,
                          run_ingest)
from mihonban.lockfile import release, try_lock


def test_move_with_suffix_tolerates_missing_source(tmp_path: Path):
    gone = tmp_path / "nope.rar"
    dest = tmp_path / "done"
    assert _move_with_suffix(gone, dest) is None       # Must not raise.
    assert not (dest / "nope.rar").exists()


def test_quarantine_missing_item_leaves_no_litter(cfg):
    cfg.ensure_dirs()
    gone = cfg.inbox / "vanished.rar"
    assert _quarantine(cfg, gone, "vanished", "unexpected error: x") is None
    assert not (cfg.quarantine_dir / "vanished").exists()  # Leave no empty directory.


def test_quarantine_keeps_reason_for_each_item(cfg):
    cfg.ensure_dirs()
    first = cfg.inbox / "first.zip"
    second = cfg.inbox / "second.zip"
    first.write_bytes(b"one")
    second.write_bytes(b"two")

    moved_first = _quarantine(cfg, first, "batch", "first failure")
    moved_second = _quarantine(cfg, second, "batch", "second failure")

    qdir = cfg.quarantine_dir / "batch"
    history = (qdir / "reason.txt").read_text("utf-8")
    assert "first.zip: first failure" in history
    assert "second.zip: second failure" in history
    assert (qdir / f"{moved_first.name}.reason.txt").read_text(
        "utf-8").strip() == "first failure"
    assert (qdir / f"{moved_second.name}.reason.txt").read_text(
        "utf-8").strip() == "second failure"


def test_post_import_preserves_relative_paths_and_unknown_files(
        cfg, tmp_path, monkeypatch):
    source = tmp_path / "workspace" / "Album"
    target = tmp_path / "library" / "Artist" / "Album"
    target.mkdir(parents=True)
    for relative, content in {
        "Disc 1/scans/page.jpg": b"disc one",
        "Disc 2/scans/page.jpg": b"disc two",
        "checksums/release.sfv": b"checksum",
    }.items():
        path = source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    monkeypatch.setattr(
        ingest.beets_runner, "latest_album_path", lambda config: target)

    assert _post_import_artifacts(cfg, source) == str(target)
    assert (target / "Disc 1/scans/page.jpg").read_bytes() == b"disc one"
    assert (target / "Disc 2/scans/page.jpg").read_bytes() == b"disc two"
    assert (target / "checksums/release.sfv").read_bytes() == b"checksum"


def test_post_import_suffixes_different_conflicting_artifact(
        cfg, tmp_path, monkeypatch):
    source = tmp_path / "workspace" / "Album"
    target = tmp_path / "library" / "Artist" / "Album"
    (source / "scans").mkdir(parents=True)
    (target / "scans").mkdir(parents=True)
    (source / "scans/page.jpg").write_bytes(b"new")
    (target / "scans/page.jpg").write_bytes(b"old")
    monkeypatch.setattr(
        ingest.beets_runner, "latest_album_path", lambda config: target)

    _post_import_artifacts(cfg, source)

    assert (target / "scans/page.jpg").read_bytes() == b"old"
    assert (target / "scans/page-1.jpg").read_bytes() == b"new"


def test_post_import_recovers_files_when_library_path_is_unknown(
        cfg, tmp_path, monkeypatch):
    source = tmp_path / "workspace" / "Album"
    (source / "scans").mkdir(parents=True)
    (source / "scans/page.jpg").write_bytes(b"scan")
    monkeypatch.setattr(
        ingest.beets_runner, "latest_album_path", lambda config: None)

    with pytest.raises(RuntimeError, match="remaining files preserved"):
        _post_import_artifacts(cfg, source)

    recovered = list((cfg.quarantine_dir / "_imported_artifacts").rglob(
        "page.jpg"))
    assert len(recovered) == 1
    assert recovered[0].read_bytes() == b"scan"


def test_run_ingest_skips_archives_gone_from_list(cfg):
    cfg.ensure_dirs()
    ghost = cfg.inbox / "ghost.rar"          # Listed, but already gone from disk.
    results = run_ingest(cfg, apply=True, archives=[ghost])
    assert results == []                     # Skip silently without error or quarantine.
    assert not (cfg.quarantine_dir / "ghost").exists()


def test_process_item_cleans_workspace_after_unexpected_failure(cfg, monkeypatch):
    item = cfg.inbox / "unexpected.zip"
    item.write_bytes(b"placeholder")
    workspace = _workspace_for(cfg, item)

    def fail(*_args, **_kwargs):
        raise RuntimeError("synthetic failure")

    monkeypatch.setattr(ingest, "prepare_inbox_item", fail)
    with pytest.raises(RuntimeError, match="synthetic failure"):
        process_item(cfg, item, apply=False)
    assert not workspace.exists()


def test_ingest_lock_blocks_second_runner(cfg):
    cfg.ensure_dirs()
    held = try_lock(cfg.state_dir / "ingest.lock")     # Simulate another process owning the lock.
    assert held is not None
    try:
        (cfg.inbox / "x.rar").write_bytes(b"not really a rar")
        results = run_ingest(cfg, apply=True)
        assert results == []                 # No lock: yield this run immediately.
        assert (cfg.inbox / "x.rar").exists()  # Leave the file untouched.
    finally:
        release(held)


def test_lockfile_reacquire_after_release(tmp_path: Path):
    p = tmp_path / "l.lock"
    a = try_lock(p)
    assert a is not None
    assert try_lock(p) is None               # Cannot re-enter while held.
    release(a)
    b = try_lock(p)                          # Can acquire again after release.
    assert b is not None
    release(b)
