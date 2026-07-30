"""``mihonban watch`` inbox watcher for fully automatic archive and folder import.

Poll INBOX and, after new archives or folders become stable, run:
``ingest --apply`` -> ``mihonban cloud sync`` (rclone upload plus cloud registration).

This is a long-lived process launched at startup by VBS. No individual failure
stops the watcher; failed inbox items follow ingest's existing quarantine and
logging rules.
"""

from __future__ import annotations

import hashlib
import logging
import time
from pathlib import Path

from .config import Config

log = logging.getLogger("mihonban.watch")

POLL_SECONDS = 5
STABLE_POLLS = 3

ItemSignature = tuple[str, int, int, int, str]
StabilityState = tuple[ItemSignature, int]


def _inbox_items(cfg: Config) -> list[Path]:
    from .ingest import find_inbox_items
    return find_inbox_items(cfg)


def _item_signature(path: Path) -> ItemSignature | None:
    """Snapshot enough metadata to notice an in-progress copy."""
    try:
        if path.is_file():
            stat = path.stat()
            if stat.st_size <= 0:
                return None
            detail = hashlib.blake2b(digest_size=16)
            detail.update(
                f"{stat.st_size}:{stat.st_mtime_ns}:"
                f"{stat.st_ctime_ns}:{getattr(stat, 'st_ino', 0)}".encode())
            return ("file", 1, stat.st_size, stat.st_mtime_ns,
                    detail.hexdigest())
        if not path.is_dir():
            return None
        count = 0
        total = 0
        newest = path.stat().st_mtime_ns
        detail = hashlib.blake2b(digest_size=16)
        children = sorted(path.rglob("*"),
                          key=lambda child: child.as_posix().casefold())
        for child in children:
            if child.is_symlink() or not child.is_file():
                continue
            stat = child.stat()
            count += 1
            total += stat.st_size
            newest = max(newest, stat.st_mtime_ns)
            rel = child.relative_to(path).as_posix().encode(
                "utf-8", errors="surrogatepass")
            detail.update(len(rel).to_bytes(4, "big"))
            detail.update(rel)
            detail.update(
                f":{stat.st_size}:{stat.st_mtime_ns}:"
                f"{stat.st_ctime_ns}:{getattr(stat, 'st_ino', 0)}".encode())
        if count == 0 or total <= 0:
            return None
        return ("folder", count, total, newest, detail.hexdigest())
    except OSError:
        return None


def _stable(paths: list[Path],
            states: dict[Path, StabilityState]) -> list[Path]:
    """Require several identical polls before processing a file or tree."""
    ready: list[Path] = []
    present = set(paths)
    for stale in set(states) - present:
        states.pop(stale, None)
    for path in paths:
        signature = _item_signature(path)
        if signature is None:
            states.pop(path, None)
            continue
        previous = states.get(path)
        unchanged = previous[1] + 1 if previous and previous[0] == signature else 1
        states[path] = (signature, unchanged)
        if unchanged >= STABLE_POLLS:
            ready.append(path)
    return ready


def run_watch(cfg: Config, console) -> int:
    from .ingest import run_ingest
    from .cloud import (cloud_ready, merge_cloud_passwords, pull_quietly,
                        run_sync)
    from .lockfile import release, try_lock

    # Single instance: two watchers race for the same inbox items; the first moves
    # an item and the other crashes when it disappears.
    cfg.ensure_dirs()
    watch_lock = try_lock(cfg.state_dir / "watch.lock")
    if watch_lock is None:
        console.print("[red]另一个 mihonban watch 已经在运行——"
                      "本机只需要一个守望者，本实例退出。[/red]")
        return 1

    console.print(f"[bold]mihonban watch[/bold] — 盯着 {cfg.inbox}")
    console.print("把 RAR/ZIP/7z 或专辑文件夹丢进去；Ctrl+C 退出。")
    if not cloud_ready(cfg):
        console.print("[yellow]（未配置云端，只做本地入库）[/yellow]")

    stability: dict[Path, StabilityState] = {}
    last_heartbeat = 0.0
    # Set after a sync failure, whether a nonzero rclone/registration exit or an
    # exception. The next heartbeat performs one full reconciliation and clears
    # the flag on success. Without it, a transient network failure could leave an
    # album local-only with no automatic repair path.
    pending_sync_retry = False
    try:
        while True:
            # Every ten minutes, report a heartbeat for Admin watcher status,
            # refresh archive passwords, and pull web-uploaded albums into the
            # local library. Network instability is logged without stopping watch.
            if cloud_ready(cfg) and time.time() - last_heartbeat > 600:
                try:
                    merge_cloud_passwords(cfg)
                except Exception:  # noqa: BLE001 - the watcher must stay alive
                    log.exception("cloud password refresh failed inside watch")
                pull_quietly(cfg, console)
                if pending_sync_retry:
                    try:
                        if run_sync(cfg, console, upload=True) == 0:
                            pending_sync_retry = False
                            log.info("deferred sync retry succeeded")
                    except Exception:  # noqa: BLE001
                        log.exception("deferred sync retry crashed inside watch")
                last_heartbeat = time.time()
            # The inbox itself may become temporarily unavailable through a
            # disconnected network drive, directory recreation, or permission
            # fluctuation. The module promises that no step stops the watcher, so
            # scanning needs the same protection.
            try:
                ready = _stable(_inbox_items(cfg), stability)
            except OSError as e:
                log.warning("inbox scan failed, retrying: %s", e)
                time.sleep(POLL_SECONDS)
                continue
            if ready:
                names = ", ".join(p.name for p in ready)
                console.print(f"\n发现 {len(ready)} 个稳定收件项：{names}")
                log.info("watch picked up: %s", names)
                if cloud_ready(cfg):
                    try:
                        merge_cloud_passwords(cfg)   # Extract with the latest passwords.
                    except Exception:  # noqa: BLE001
                        log.exception("cloud password refresh failed inside watch")
                    last_heartbeat = time.time()
                imported: list[Path] = []
                need_full_sync = False
                try:
                    # Pass only items that have remained stable. Do not let ingest
                    # rescan the inbox and encounter half-copied files or trees.
                    results = run_ingest(cfg, apply=True, items=ready)
                    seen: set[str] = set()
                    for result in results:
                        # Only status="error", where an item exception is swallowed
                        # and albums cleared, can leave an album moved by beets but
                        # missing its library_path; full reconciliation covers that.
                        # "quarantined" from a wrong password or no audio imports
                        # nothing, so it must not trigger a full-library tag scan and
                        # rclone for every bad archive.
                        if result.status == "error":
                            need_full_sync = True
                        for album in result.albums:
                            if (album.action == "imported" and album.library_path
                                    and album.library_path not in seen):
                                seen.add(album.library_path)
                                imported.append(Path(album.library_path))
                except Exception:  # noqa: BLE001 - the watcher must stay alive
                    need_full_sync = True
                    log.exception("ingest crashed inside watch")
                    console.print("[red]ingest 出错（见日志），继续守望[/red]")
                if cloud_ready(cfg) and (need_full_sync or imported):
                    try:
                        if need_full_sync:
                            # An album may have entered the library without an item
                            # record; full reconciliation is the fallback.
                            if run_sync(cfg, console, upload=True) != 0:
                                pending_sync_retry = True
                        else:
                            # Sync only albums imported in this batch. Large libraries
                            # no longer reread every tag and rclone the full library
                            # per batch; `mihonban cloud sync` handles reconciliation.
                            # run_sync reports failure through its exit code rather
                            # than an exception, so capture it or one network wobble
                            # can leave an album local-only forever.
                            for directory in imported:
                                if run_sync(cfg, console, upload=True,
                                            only_dir=directory) != 0:
                                    pending_sync_retry = True
                    except Exception:  # noqa: BLE001
                        pending_sync_retry = True
                        log.exception("cloud sync crashed inside watch")
                        console.print("[red]云同步出错（见日志），继续守望[/red]")
                    if pending_sync_retry:
                        log.warning("sync incomplete; will retry a full "
                                    "reconciliation on the next heartbeat")
                stability.clear()
            time.sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        console.print("\nwatch 已停止。")
        return 0
    finally:
        release(watch_lock)
