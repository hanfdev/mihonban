"""Cross-process single-instance lock.

Use an OS-level file lock (Windows msvcrt or POSIX flock). The lock remains valid
while its owner lives and the OS releases it after any process exit, including a
crash or kill, so stale lock files are not a concern.

This prevents two watch/ingest processes from racing for the same inbox batch,
moving files out from under one another and crashing the loser.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

log = logging.getLogger("mihonban.lock")


def try_lock(path: Path):
    """Try to acquire an exclusive lock. Return a handle that the caller retains
    and releases on exit, or None when another process already owns it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(path), os.O_CREAT | os.O_RDWR)
    except OSError as e:
        log.warning("无法打开锁文件 %s: %s", path, e)
        return None
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return None
    try:  # Record the owner's PID solely to aid manual diagnosis.
        os.ftruncate(fd, 0)
        os.lseek(fd, 0, os.SEEK_SET)
        os.write(fd, str(os.getpid()).encode())
    except OSError:
        pass
    return fd


def release(fd) -> None:
    if fd is None:
        return
    try:
        if os.name == "nt":
            import msvcrt
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        os.close(fd)
    except OSError:
        pass
