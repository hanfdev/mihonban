# -*- coding: utf-8 -*-
"""并发健壮性：两个 watch/ingest 抢同一批包不再互相打死（v2.4.1 修复）。"""

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
    assert _move_with_suffix(gone, dest) is None       # 不抛异常
    assert not (dest / "nope.rar").exists()


def test_quarantine_missing_item_leaves_no_litter(cfg):
    cfg.ensure_dirs()
    gone = cfg.inbox / "vanished.rar"
    assert _quarantine(cfg, gone, "vanished", "unexpected error: x") is None
    assert not (cfg.quarantine_dir / "vanished").exists()  # 不留空目录


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
    ghost = cfg.inbox / "ghost.rar"          # 清单里有、盘上已没有
    results = run_ingest(cfg, apply=True, archives=[ghost])
    assert results == []                     # 静默跳过，不报错不隔离
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
    held = try_lock(cfg.state_dir / "ingest.lock")     # 模拟另一个实例持锁
    assert held is not None
    try:
        (cfg.inbox / "x.rar").write_bytes(b"not really a rar")
        results = run_ingest(cfg, apply=True)
        assert results == []                 # 拿不到锁 → 本轮直接让路
        assert (cfg.inbox / "x.rar").exists()  # 文件原封不动
    finally:
        release(held)


def test_lockfile_reacquire_after_release(tmp_path: Path):
    p = tmp_path / "l.lock"
    a = try_lock(p)
    assert a is not None
    assert try_lock(p) is None               # 持有中不可重入
    release(a)
    b = try_lock(p)                          # 释放后可再拿
    assert b is not None
    release(b)
