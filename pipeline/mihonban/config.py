"""Configuration loading for mihonban.

The runtime config lives OUTSIDE the repo (and outside any OneDrive-synced
folder) because it contains tokens and sits next to mutable data.

Lookup order for the config file:
  1. explicit --config / load(path=...)
  2. $MIHONBAN_CONFIG
  3. ./mihonban.toml (cwd)
  4. $XDG_CONFIG_HOME/mihonban/config.toml
  5. %APPDATA%\\mihonban\\config.toml
  6. ~/.config/mihonban/config.toml

Paths inside the TOML ([paths] music_root / inbox / rym_pages / data_dir)
are fully user-defined — never hard-coded to a drive letter for new installs.
"""

from __future__ import annotations

import os
import shutil
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


class ConfigError(RuntimeError):
    pass


def cloud_sync_component(path: Path) -> str | None:
    """Return a known consumer-sync directory component, if present."""
    for part in path.expanduser().parts:
        compact = part.casefold().replace(" ", "").replace("-", "").replace("_", "")
        if compact.startswith(("onedrive", "dropbox", "icloud")):
            return part
    return None


def default_config_candidates() -> list[Path]:
    """Ordered list of places we look for a config file."""
    cands: list[Path] = [Path.cwd() / "mihonban.toml"]
    if xdg := os.environ.get("XDG_CONFIG_HOME"):
        cands.append(Path(xdg) / "mihonban" / "config.toml")
    if appdata := os.environ.get("APPDATA"):
        cands.append(Path(appdata) / "mihonban" / "config.toml")
    cands.append(Path.home() / ".config" / "mihonban" / "config.toml")
    return cands


def resolve_config_path(path: str | os.PathLike | None = None) -> Path:
    if path:
        return Path(path)
    if env := os.environ.get("MIHONBAN_CONFIG"):
        return Path(env)
    for p in default_config_candidates():
        if p.exists():
            return p
    # Prefer a writable per-user location for the error message / setup target.
    if appdata := os.environ.get("APPDATA"):
        return Path(appdata) / "mihonban" / "config.toml"
    if xdg := os.environ.get("XDG_CONFIG_HOME"):
        return Path(xdg) / "mihonban" / "config.toml"
    return Path.home() / ".config" / "mihonban" / "config.toml"


def default_data_home() -> Path:
    """Suggested root for music/data when running the setup wizard."""
    return Path.home() / "Music" / "mihonban"


def find_sevenzip() -> Path | None:
    """Locate 7-Zip / 7z / 7zz on PATH or common install dirs."""
    for name in ("7z", "7zz", "7za"):
        if found := shutil.which(name):
            return Path(found)
    if sys.platform == "win32":
        for p in (
            Path(r"C:\Program Files\7-Zip\7z.exe"),
            Path(r"C:\Program Files (x86)\7-Zip\7z.exe"),
        ):
            if p.exists():
                return p
    return None


def find_rclone() -> Path | None:
    if found := shutil.which("rclone"):
        return Path(found)
    if sys.platform == "win32":
        for p in (
            Path.home() / "scoop" / "shims" / "rclone.exe",
            Path(r"C:\Program Files\rclone\rclone.exe"),
        ):
            if p.exists():
                return p
    return None


@dataclass
class Config:
    music_root: Path
    inbox: Path
    rym_pages: Path
    data_dir: Path
    passwords: list[str] = field(default_factory=list)
    naming_primary: str = "original"  # "original" | "romaji"
    discogs_token: str = ""
    sevenzip: Path | None = None
    art_sources: str = "filesystem, coverart, itunes"
    beets_template: Path | None = None
    cloud_url: str = ""
    cloud_key: str = ""
    rclone: Path | None = None
    rclone_remote: str = "mihonban:Music/Library"

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "tmp"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def done_dir(self) -> Path:
        return self.inbox / "_done"

    @property
    def quarantine_dir(self) -> Path:
        return self.inbox / "_quarantine"

    @property
    def beets_dir(self) -> Path:
        return self.data_dir / "beets"

    @property
    def rym_db(self) -> Path:
        return self.data_dir / "rym.sqlite"

    @property
    def state_dir(self) -> Path:
        return self.data_dir / "state"

    def ensure_dirs(self) -> None:
        for p in (
            self.music_root, self.inbox, self.done_dir, self.quarantine_dir,
            self.rym_pages, self.data_dir, self.tmp_dir, self.logs_dir,
            self.beets_dir, self.state_dir,
        ):
            p.mkdir(parents=True, exist_ok=True)

    def validate(self) -> None:
        for label, p in (("music_root", self.music_root),
                         ("data_dir", self.data_dir)):
            if component := cloud_sync_component(p):
                raise ConfigError(
                    f"{label} ({p}) is inside the cloud-sync folder "
                    f"{component!r}; OneDrive, Dropbox, and iCloud folders "
                    "cannot safely hold the live library or mutable data."
                )
        if self.sevenzip is None or not Path(self.sevenzip).exists():
            raise ConfigError(
                "7-Zip / 7z not found. Install 7-Zip (Windows) or p7zip "
                "(macOS/Linux), put it on PATH, or set [archive] sevenzip "
                "in your config."
            )


def repo_root() -> Path:
    """Repo root, assuming editable install (pipeline/mihonban/config.py)."""
    return Path(__file__).resolve().parents[2]


def load(path: str | os.PathLike | None = None) -> Config:
    p = resolve_config_path(path)
    if not p.exists():
        raise ConfigError(
            f"Config not found: {p}\n"
            "Run `mihonban setup` for an interactive wizard, or copy\n"
            "  config/mihonban.toml.example  →  that path\n"
            "and set MIHONBAN_CONFIG if you keep it elsewhere."
        )
    if component := cloud_sync_component(p.parent):
        raise ConfigError(
            f"Config file {p} is inside the cloud-sync folder {component!r}; "
            "move it outside OneDrive, Dropbox, or iCloud before continuing."
        )
    with open(p, "rb") as f:
        raw = tomllib.load(f)

    paths = raw.get("paths", {})
    try:
        cfg = Config(
            music_root=Path(paths["music_root"]).expanduser(),
            inbox=Path(paths["inbox"]).expanduser(),
            rym_pages=Path(paths["rym_pages"]).expanduser(),
            data_dir=Path(paths["data_dir"]).expanduser(),
        )
    except KeyError as e:
        raise ConfigError(f"Missing required [paths] key: {e}") from e

    arch = raw.get("archive", {})
    cfg.passwords = list(arch.get("passwords", []))
    if sz := arch.get("sevenzip"):
        cfg.sevenzip = Path(sz).expanduser()
    else:
        cfg.sevenzip = find_sevenzip()

    cfg.naming_primary = raw.get("naming", {}).get("primary", "original")
    cfg.discogs_token = raw.get("discogs", {}).get("token", "")

    cl = raw.get("cloud", {})
    cfg.cloud_url = cl.get("url", "").rstrip("/")
    cfg.cloud_key = cl.get("api_key", "")
    if rc := cl.get("rclone"):
        cfg.rclone = Path(rc).expanduser()
    else:
        cfg.rclone = find_rclone()
    cfg.rclone_remote = cl.get("remote", cfg.rclone_remote)

    cfg.validate()
    return cfg


# Back-compat alias used by older docs / scripts
DEFAULT_CONFIG_PATH = resolve_config_path()
