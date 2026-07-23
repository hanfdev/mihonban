"""RYM metadata layer (parse / match / write) — Phase 3.

Implemented in mihonban.rym.parse / .match / .write; this package exposes the
CLI entry points.
"""

from __future__ import annotations

from ..config import Config


def cmd_parse(cfg: Config, console) -> int:
    from .parse import run_parse
    return run_parse(cfg, console)


def cmd_match(cfg: Config, console, auto_yes: bool = False) -> int:
    from .match import run_match
    return run_match(cfg, console, auto_yes=auto_yes)


def cmd_write(cfg: Config, console, apply: bool = False) -> int:
    from .write import run_write
    return run_write(cfg, console, apply=apply)
