"""`mihonban ingest` — the inbox-to-library pipeline.

Per archive or folder in INBOX:
  1. copy/extract (nested, passwords, CP932-safe) into a private workspace
  2. repair mojibake filenames, then tag encodings (on the workspace COPY —
     the archive itself is never modified)
  3. synthesize missing basic tags from folder-name conventions
  4. beets quiet-import: MusicBrainz+Discogs match -> move into MUSIC_ROOT,
     embed art; no confident match -> album goes to the quarantine for an
     interactive `mihonban review` session
  5. original input -> _done (or _quarantine on hard failure)

Safety: dry-run produces the full report without touching anything outside
the temp workspace; the first-ever real run is forced through dry-run once.
Nothing is ever silently discarded — every file either lands in the library,
sits in quarantine, or is listed in the report.
"""

from __future__ import annotations

import filecmp
import hashlib
import logging
import re
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import beets_runner
from .albuminfo import synthesize_tags
from .config import Config
from .extract import (AUDIO_EXTS, ExtractError, find_album_dirs, is_archive,
                      prepare_inbox_item)
from .lockfile import release, try_lock
from .mb_artist import canonicalize_artists
from .tagfix import fix_tree_tags

log = logging.getLogger("mihonban.ingest")

@dataclass
class AlbumResult:
    name: str
    action: str          # imported | quarantined | dry-run
    detail: str = ""
    library_path: str = ""
    tag_fixes: int = 0
    tag_notes: int = 0


@dataclass
class ArchiveResult:
    archive: Path
    status: str          # done | quarantined | dry-run | error
    detail: str = ""
    name_fixes: int = 0
    albums: list[AlbumResult] = field(default_factory=list)


def _slug(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return s[:40].strip("_") or "archive"


def _workspace_for(cfg: Config, item: Path) -> Path:
    stat = item.stat()
    h = hashlib.md5(
        f"{item.name}|{item.is_dir()}|{stat.st_size}|{stat.st_mtime_ns}".encode()
    ).hexdigest()[:8]
    return cfg.tmp_dir / f"{_slug(item.stem)}-{h}"


def _move_with_suffix(src: Path, dest_dir: Path) -> Path | None:
    """Move ``src``, adding -1/-2 suffixes for name collisions. Return None
    instead of crashing if another process has already removed it; one file must
    never ruin the whole batch."""
    if not src.exists():
        log.warning("要移动的文件已不存在（可能被其他进程处理）：%s", src)
        return None
    dest_dir.mkdir(parents=True, exist_ok=True)
    target = dest_dir / src.name
    i = 1
    while target.exists():
        target = dest_dir / f"{src.stem}-{i}{src.suffix}"
        i += 1
    try:
        shutil.move(str(src), str(target))
    except FileNotFoundError:
        log.warning("移动途中文件消失：%s", src)
        return None
    return target


def _quarantine(cfg: Config, item: Path, group: str, reason: str) -> Path | None:
    if not item.exists():   # Another process moved it; do not leave an empty directory behind.
        log.warning("待隔离对象已不存在，跳过：%s（%s）", item.name, reason)
        return None
    qdir = cfg.quarantine_dir / group
    moved = _move_with_suffix(item, qdir)
    if moved is None:
        return None
    # Keep both a group history and an item-specific reason.  Several failed
    # albums from one archive share ``group``; overwriting a single reason.txt
    # made all but the last diagnosis disappear.
    with (qdir / "reason.txt").open("a", encoding="utf-8") as handle:
        handle.write(f"{moved.name}: {reason}\n")
    (qdir / f"{moved.name}.reason.txt").write_text(
        reason + "\n", encoding="utf-8")
    log.warning("quarantined %s: %s", item.name, reason)
    return moved


def _casefold_child(parent: Path, name: str) -> Path | None:
    if not parent.is_dir():
        return None
    key = name.rstrip(" .").casefold()
    return next((child for child in parent.iterdir()
                 if child.name.rstrip(" .").casefold() == key), None)


def _artifact_parent(target: Path, relative: Path) -> Path | None:
    """Create/reuse a case-insensitive relative directory tree.

    ``None`` means a file blocks one of the desired directory components.
    """
    current = target
    for part in relative.parts:
        child = _casefold_child(current, part)
        if child is not None:
            if not child.is_dir():
                return None
            current = child
            continue
        current = current / part
        current.mkdir()
    return current


def _new_recovery_dir(target: Path) -> Path:
    base = "_imported_artifacts"
    index = 0
    while True:
        name = base if index == 0 else f"{base}-{index}"
        if _casefold_child(target, name) is None:
            path = target / name
            path.mkdir(parents=True)
            return path
        index += 1


def _unique_artifact_path(parent: Path, name: str) -> Path:
    existing = _casefold_child(parent, name)
    if existing is None:
        return parent / name
    source = Path(name)
    index = 1
    while True:
        candidate = f"{source.stem}-{index}{source.suffix}"
        if _casefold_child(parent, candidate) is None:
            return parent / candidate
        index += 1


def _post_import_artifacts(cfg: Config, album_dir: Path) -> str:
    """Move every leftover file next to the imported album without loss.

    beets moves audio but intentionally leaves scans, cue/log/checksum files
    and other release material behind.  Preserve their relative directories;
    a conflicting different file gets a suffix, while an identical copy is
    simply de-duplicated.
    """
    files = [path for path in sorted(album_dir.rglob("*")) if path.is_file()]
    target = beets_runner.latest_album_path(cfg)
    if target is None or not target.is_dir():
        if files and album_dir.exists():
            recovery = cfg.quarantine_dir / "_imported_artifacts"
            preserved = _move_with_suffix(album_dir, recovery)
            raise RuntimeError(
                "beets imported the audio but its library path could not be "
                f"resolved; remaining files preserved at {preserved}")
        return str(target) if target else ""
    fallback: Path | None = None
    for source in files:
        relative = source.relative_to(album_dir)
        parent = _artifact_parent(target, relative.parent)
        if parent is None:
            if fallback is None:
                fallback = _new_recovery_dir(target)
            parent = fallback / relative.parent
            parent.mkdir(parents=True, exist_ok=True)

        existing = _casefold_child(parent, relative.name)
        if existing is not None and existing.is_file():
            try:
                identical = filecmp.cmp(source, existing, shallow=False)
            except OSError:
                identical = False
            if identical:
                source.unlink()
                log.info("artifact already preserved: %s", existing)
                continue
        dest = _unique_artifact_path(parent, relative.name)
        shutil.move(str(source), str(dest))
        log.info("artifact -> %s", dest)
    return str(target)


def process_item(cfg: Config, item: Path, apply: bool,
                 keep_workspace: bool = False,
                 autotag: bool = True) -> ArchiveResult:
    res = ArchiveResult(archive=item, status="dry-run" if not apply else "")
    ws = _workspace_for(cfg, item)
    if ws.exists():
        shutil.rmtree(ws)
    ws.mkdir(parents=True)
    try:
        try:
            fixes = prepare_inbox_item(item, ws, cfg)
            res.name_fixes = len(fixes)
            for fx in fixes:
                log.info("name fix: %r -> %r", fx.old, fx.new)
        except ExtractError as e:
            res.status, res.detail = "quarantined", f"extract failed: {e}"
            if apply:
                _quarantine(cfg, item, _slug(item.stem), res.detail)
            return res

        albums = find_album_dirs(ws)
        if not albums:
            res.status = "quarantined" if apply else "dry-run"
            res.detail = "no audio files found in inbox item"
            if apply:
                _quarantine(cfg, item, _slug(item.stem), res.detail)
            return res

        all_ok = True
        for album_dir in albums:
            a = AlbumResult(name=album_dir.name,
                            action="dry-run" if not apply else "")
            tag_fixes = fix_tree_tags(album_dir, apply=apply)
            a.tag_fixes = len(tag_fixes)
            for tf in tag_fixes:
                log.info("tag fix [%s] %s: %r -> %r",
                         tf.file.name, tf.field, tf.old, tf.new)
            notes = synthesize_tags(album_dir, apply=apply)
            notes += canonicalize_artists(cfg, album_dir, apply=apply)
            a.tag_notes = len(notes)
            for note in notes:
                log.info("tag synth: %s", note)

            if apply:
                outcome = beets_runner.quiet_import(cfg, album_dir,
                                                    autotag=autotag)
                if outcome.imported:
                    a.action = "imported"
                    a.library_path = _post_import_artifacts(cfg, album_dir)
                else:
                    a.action = "quarantined"
                    a.detail = outcome.detail or "no confident match"
                    _quarantine(cfg, album_dir, _slug(item.stem), a.detail)
                    all_ok = False
            res.albums.append(a)

        if apply:
            res.status = "done" if all_ok else "partial"
            res.detail = ("" if all_ok
                          else "some albums quarantined — run `mihonban review`")
            _move_with_suffix(item, cfg.done_dir)
        return res
    finally:
        if not keep_workspace:
            shutil.rmtree(ws, ignore_errors=True)

def process_archive(cfg: Config, archive: Path, apply: bool,
                    keep_workspace: bool = False,
                    autotag: bool = True) -> ArchiveResult:
    """Compatibility wrapper for callers using the former archive-only API."""
    return process_item(cfg, archive, apply, keep_workspace, autotag)


def find_inbox_items(cfg: Config) -> list[Path]:
    """Return supported top-level inputs, excluding managed directories."""
    managed = {cfg.done_dir, cfg.quarantine_dir}
    return sorted(
        p for p in cfg.inbox.iterdir()
        if p not in managed
        and not p.name.startswith(".")
        and (p.is_dir() or (p.is_file() and is_archive(p)))
    )


def find_inbox_archives(cfg: Config) -> list[Path]:
    """Compatibility alias; inbox discovery now also returns folders."""
    return find_inbox_items(cfg)


def run_ingest(cfg: Config, apply: bool, keep_workspace: bool = False,
               autotag: bool = True,
               items: list[Path] | None = None, *,
               archives: list[Path] | None = None) -> list[ArchiveResult]:
    """Process explicit stable items, or discover all supported inbox input.

    ``archives`` remains as a keyword-only compatibility alias for callers
    written before folder ingestion was supported.
    """
    cfg.ensure_dirs()
    lock = try_lock(cfg.state_dir / "ingest.lock")
    if lock is None:
        log.warning("另一个 ingest 正在运行，本轮跳过（收件箱只需要一个搬运工）")
        return []
    try:
        if items is not None and archives is not None:
            raise ValueError("pass items or archives, not both")
        if items is None:
            items = archives if archives is not None else find_inbox_items(cfg)
        results = []
        for item in items:
            if not item.exists():   # The list may be stale because another process handled the item.
                log.info("跳过已消失的 %s", item.name)
                continue
            log.info("=== %s (%s) ===", item.name,
                     "APPLY" if apply else "DRY-RUN")
            workspace = _workspace_for(cfg, item)
            try:
                results.append(process_item(cfg, item, apply, keep_workspace,
                                            autotag=autotag))
            except Exception as e:  # noqa: BLE001 — never silently drop a file
                log.exception("unexpected failure on %s", item.name)
                r = ArchiveResult(archive=item, status="error", detail=str(e))
                if apply:
                    try:   # Quarantine failure must not ruin the entire batch.
                        _quarantine(cfg, item, _slug(item.stem),
                                    f"unexpected error: {e}")
                    except Exception:  # noqa: BLE001
                        log.exception("quarantine failed for %s", item.name)
                if not keep_workspace:
                    shutil.rmtree(workspace, ignore_errors=True)
                results.append(r)
        if apply and results:
            (cfg.state_dir / "ingest_applied").write_text(
                time.strftime("%Y-%m-%d %H:%M:%S"), encoding="utf-8")
        return results
    finally:
        release(lock)
