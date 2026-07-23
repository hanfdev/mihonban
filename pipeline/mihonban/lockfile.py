"""跨进程单实例锁。

用 OS 级文件锁（Windows msvcrt / POSIX flock）：持有者存活期间锁有效，
进程无论怎么死（崩溃、被杀）OS 都会自动释放——没有"陈旧锁文件"问题。

用途：防止两个 watch / ingest 同时抢收件箱里的同一批收件项
（两个实例会互相把对方正在处理的文件搬走，输家崩溃）。
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

log = logging.getLogger("mihonban.lock")


def try_lock(path: Path):
    """尝试拿独占锁。成功返回句柄（调用方保持引用，退出时可 release），
    已被其他进程持有则返回 None。"""
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
    try:  # 记下持有者 PID，纯粹为了人肉排查方便
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
