"""Run beets as a subprocess with an isolated, generated config.

The beets home is {data_dir}/beets (BEETSDIR); its config.yaml is rendered
from the repo template on every run so the repo stays the single source of
truth and the Discogs token never lands in version control.

Outcome detection relies on the filesystem, not on parsing beets chatter:
``import.move: yes`` means an imported album's source dir is emptied of
audio; anything still holding audio afterwards was skipped (no confident
match, or duplicate).
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from .config import Config, repo_root
from .extract import AUDIO_EXTS

log = logging.getLogger("mihonban.beets")

_DISC_FOLDER_RE = re.compile(
    r"^(?:disc|cd|disk|vol(?:ume)?|side)[ _.-]*"
    r"(?:[0-9]+|[ivxlcdm]+)$",
    re.IGNORECASE,
)


@dataclass
class ImportOutcome:
    album_dir: Path
    imported: bool
    duplicate: bool = False
    detail: str = ""


def _render_config(cfg: Config) -> Path:
    tmpl_path = cfg.beets_template or repo_root() / "config" / "beets.yaml.tmpl"
    tmpl = tmpl_path.read_text(encoding="utf-8")
    # mihonban_artist 插件所在目录。beets 2.12 把 pluginpath 的每一项直接并进
    # beetsplug.__path__（plugins.py: beetsplug.__path__ = paths + ...），
    # 所以这里要指向 beetsplug/ 目录**本身**。绝对路径，两种运行场景都对。
    pluginpath = (repo_root() / "config" / "beetsplug").as_posix()
    rendered = tmpl.format(
        music_root=cfg.music_root.as_posix(),
        library_db=(cfg.beets_dir / "library.db").as_posix(),
        import_log=(cfg.logs_dir / "beets_import.log").as_posix(),
        token=cfg.discogs_token,
        art_sources=cfg.art_sources,
        pluginpath=pluginpath,
        # without a token the discogs plugin starts an interactive OAuth
        # flow on EVERY beets invocation — only load it when configured
        discogs_plugin=" discogs" if cfg.discogs_token else "",
    )
    cfg.beets_dir.mkdir(parents=True, exist_ok=True)
    out = cfg.beets_dir / "config.yaml"
    out.write_text(rendered, encoding="utf-8")
    return out


def _beets_env(cfg: Config) -> dict[str, str]:
    env = os.environ.copy()
    env["BEETSDIR"] = str(cfg.beets_dir)
    env["NO_COLOR"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def run_beet(cfg: Config, *args: str, capture: bool = True,
             timeout: int = 1800) -> subprocess.CompletedProcess:
    _render_config(cfg)
    cmd = [sys.executable, "-m", "beets", *args]
    log.debug("beet %s", " ".join(args))
    return subprocess.run(
        cmd, env=_beets_env(cfg), capture_output=capture,
        text=capture, encoding="utf-8", errors="replace", timeout=timeout,
    )


def _has_audio(d: Path) -> bool:
    return d.exists() and any(
        f.suffix.lower() in AUDIO_EXTS for f in d.rglob("*") if f.is_file()
    )


def _is_multidisc_tree(album_dir: Path) -> bool:
    """Return true when audio is split across conventional disc folders."""
    children = [
        child for child in album_dir.iterdir()
        if child.is_dir() and _has_audio(child)
    ]
    return (len(children) >= 2
            and all(_DISC_FOLDER_RE.match(child.name.strip())
                    for child in children))


def quiet_import(cfg: Config, album_dir: Path,
                 autotag: bool = True) -> ImportOutcome:
    """Non-interactive import of one album directory."""
    args = ["import", "-q"]
    # Without --flat, beets treats Disc I and Disc II as two albums. The
    # second disc then trips duplicate handling and leaves a half-imported
    # release behind.
    if _is_multidisc_tree(album_dir):
        args.append("--flat")
    if not autotag:
        args.append("-A")
    args.append(str(album_dir))
    proc = run_beet(cfg, *args)
    out = (proc.stdout or "") + (proc.stderr or "")
    imported = not _has_audio(album_dir)
    duplicate = "duplicate" in out.lower()
    detail = ""
    if not imported:
        for line in out.splitlines():
            line = line.strip()
            if line.startswith(("Skipping", "No files imported")):
                detail = line
                break
        detail = detail or f"beets rc={proc.returncode}"
        if duplicate:
            detail = f"duplicate of existing library album; {detail}"
        elif detail.startswith("Skipping"):
            # 自动匹配不自信（MusicBrainz 多半没有这张碟——现场盘/私录常见），
            # 属设计内流程：进隔离区等 `mihonban review` 人工裁决
            detail = ("beets 无自信匹配（MB 可能无此发行），"
                      "运行 `mihonban review` 人工裁决入库")
    log.info("beets import %s -> %s %s",
             album_dir.name, "OK" if imported else "SKIP", detail)
    return ImportOutcome(album_dir, imported, duplicate, detail)


def latest_album_path(cfg: Config) -> Path | None:
    """Library path of the most recently added album.

    Called immediately after a successful sequential import, this is the
    album that import produced. (beets 2.12's `import --set` is a silent
    no-op — optparse callback without a type — so flexible-attr provenance
    is not an option.)
    """
    proc = run_beet(cfg, "ls", "-a", "added-", "-f", "$path")
    for line in (proc.stdout or "").strip().splitlines():
        p = Path(line.strip())
        # plugin chatter can precede real output — only trust lines that
        # are actual library paths
        if p.is_absolute() and p.exists():
            return p
    return None


def interactive_import(cfg: Config, target: Path) -> int:
    """Interactive beets session (used by `mihonban review`)."""
    _render_config(cfg)
    cmd = [sys.executable, "-m", "beets", "import", str(target)]
    return subprocess.call(cmd, env=_beets_env(cfg))
