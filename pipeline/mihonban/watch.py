"""`mihonban watch` —— 收件箱守望者：压缩包或文件夹全自动上架。

轮询 INBOX，发现新压缩包或文件夹（内容稳定后）自动执行：
  ingest --apply → mihonban cloud sync（rclone 上传 + 云端登记）

设计为常驻进程（开机自启 vbs），任何一步失败都不会中断守望，
失败的收件项会按 ingest 的既有规则进隔离区并写日志。
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

    # 单实例：两个守望者会抢同一批收件项（谁先搬走谁赢，输家崩溃）
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
    # 有过同步失败（rclone/登记非零退出或异常）时置位：下个心跳周期做一次
    # 全量对账重试，成功即清。否则一次瞬时网络故障会让专辑本地有、云端无，
    # 且没有任何自动补救路径。
    pending_sync_retry = False
    try:
        while True:
            # 每 10 分钟报一次心跳（后台「守望在线」状态），顺带拉新解压密码，
            # 并把网页上传的新专辑拉回本地库。网络抖动只记日志，不中断守望。
            if cloud_ready(cfg) and time.time() - last_heartbeat > 600:
                try:
                    merge_cloud_passwords(cfg)
                except Exception:  # noqa: BLE001 — 守望不能死
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
            # 收件箱本身也可能瞬时不可用（网络盘断连、目录被重建、权限抖动）；
            # 模块契约是「任何一步失败都不会中断守望」，扫描同样要兜住。
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
                        merge_cloud_passwords(cfg)   # 用最新密码解压
                    except Exception:  # noqa: BLE001
                        log.exception("cloud password refresh failed inside watch")
                    last_heartbeat = time.time()
                imported: list[Path] = []
                need_full_sync = False
                try:
                    # 只喂内容已连续稳定的清单，别让 ingest 自己重扫收件箱
                    # 撞上还在拷贝的半截文件或目录树。
                    results = run_ingest(cfg, apply=True, items=ready)
                    seen: set[str] = set()
                    for result in results:
                        # 只有 status="error"（逐项异常被吞、albums 被清空）才可能
                        # 存在「已被 beets 搬进库却拿不到 library_path」的专辑，
                        # 需要全量对账兜底。"quarantined"（密码不对/没有音频）根本
                        # 没有东西入库，绝不能为它扫全库——那会让每个坏压缩包都
                        # 触发一次全库重读 tag + 全库 rclone。
                        if result.status == "error":
                            need_full_sync = True
                        for album in result.albums:
                            if (album.action == "imported" and album.library_path
                                    and album.library_path not in seen):
                                seen.add(album.library_path)
                                imported.append(Path(album.library_path))
                except Exception:  # noqa: BLE001 — 守望不能死
                    need_full_sync = True
                    log.exception("ingest crashed inside watch")
                    console.print("[red]ingest 出错（见日志），继续守望[/red]")
                if cloud_ready(cfg) and (need_full_sync or imported):
                    try:
                        if need_full_sync:
                            # 有专辑可能已落库但未被逐项记录：全量对账兜底
                            if run_sync(cfg, console, upload=True) != 0:
                                pending_sync_retry = True
                        else:
                            # 只同步本批新入库的专辑；大库不再每批全库重读
                            # tag / 全库 rclone。全量对账走 `mihonban cloud sync`。
                            # run_sync 失败以退出码表达而非异常：必须接住，
                            # 否则一次网络抖动就让这张专辑永远漂在本地。
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
