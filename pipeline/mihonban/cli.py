"""mihonban command-line interface."""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

from rich.console import Console
from rich.table import Table

from . import __version__, config as config_mod
from .config import Config, ConfigError

console = Console()


def _setup_logging(cfg: Config, name: str) -> Path:
    cfg.logs_dir.mkdir(parents=True, exist_ok=True)
    logfile = cfg.logs_dir / f"{name}-{time.strftime('%Y%m%d-%H%M%S')}.log"
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    fh = logging.FileHandler(logfile, encoding="utf-8")
    fh.setFormatter(fmt)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(fh)
    sh = logging.StreamHandler(sys.stderr)
    sh.setLevel(logging.WARNING)
    sh.setFormatter(fmt)
    root.addHandler(sh)
    return logfile


# ------------------------------------------------------------------ ingest


def cmd_ingest(cfg: Config, args: argparse.Namespace) -> int:
    from .ingest import find_inbox_items, run_ingest

    logfile = _setup_logging(cfg, "ingest")
    first_run = not (cfg.state_dir / "ingest_applied").exists()
    apply = args.apply or (not args.dry_run and not first_run)
    if first_run and not args.apply:
        apply = False

    items = find_inbox_items(cfg)
    if not items:
        console.print(f"[yellow]INBOX 中没有压缩包或文件夹：{cfg.inbox}[/yellow]")
        return 0

    mode = "[green]APPLY[/green]" if apply else "[cyan]DRY-RUN[/cyan]"
    console.print(f"mihonban ingest {mode} — {len(items)} 个收件项，"
                  f"日志: {logfile}")
    results = run_ingest(cfg, apply=apply, keep_workspace=args.keep_workspace,
                         items=items)

    table = Table(title="Ingest 结果", show_lines=True)
    table.add_column("收件项", overflow="fold")
    table.add_column("状态")
    table.add_column("专辑 / 明细", overflow="fold")
    for r in results:
        lines = []
        for a in r.albums:
            line = f"{a.name} → {a.action}"
            if a.library_path:
                line += f"\n  {a.library_path}"
            if a.detail:
                line += f"\n  {a.detail}"
            if a.tag_fixes or a.tag_notes:
                line += f"\n  tag修复 {a.tag_fixes} / 补全 {a.tag_notes}"
            lines.append(line)
        if r.name_fixes:
            lines.append(f"文件名修复 {r.name_fixes} 处")
        if r.detail:
            lines.append(r.detail)
        table.add_row(r.archive.name, r.status, "\n".join(lines) or "-")
    console.print(table)

    if not apply:
        console.print(
            "\n[bold]以上为 dry-run 报告，未改动任何文件。[/bold] "
            "确认无误后执行: [green]mihonban ingest --apply[/green]")
    else:
        quarantined = [a for r in results for a in r.albums
                       if a.action == "quarantined"]
        if quarantined:
            console.print(
                f"\n[yellow]{len(quarantined)} 张专辑进入隔离区，"
                "运行 [bold]mihonban review[/bold] 逐张裁决。[/yellow]")
    return 0


def cmd_review(cfg: Config, args: argparse.Namespace) -> int:
    from .beets_runner import interactive_import
    from .extract import AUDIO_EXTS

    _setup_logging(cfg, "review")
    q = cfg.quarantine_dir
    targets = [d for d in sorted(q.glob("*/*")) if d.is_dir()]
    has_audio = [d for d in targets if any(
        f.suffix.lower() in AUDIO_EXTS for f in d.rglob("*") if f.is_file())]
    if not has_audio:
        console.print("[green]隔离区没有待裁决的专辑。[/green]")
        return 0
    console.print(f"隔离区共 {len(has_audio)} 张专辑，逐张进入 beets 交互匹配。\n"
                  "常用按键: A=接受候选 / U=按现有 tag 入库(as-is) / "
                  "S=跳过 / E=手动输入检索词 / B=中止")
    for d in has_audio:
        console.rule(d.name)
        interactive_import(cfg, d)
    # prune emptied dirs
    for d in sorted(q.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    return 0


def cmd_cloud_sync(cfg: Config, args: argparse.Namespace) -> int:
    from .cloud import run_sync
    return run_sync(cfg, console, upload=not args.no_upload)


def cmd_cloud_pull(cfg: Config, args: argparse.Namespace) -> int:
    from .cloud import run_pull
    return run_pull(cfg, console, retag_existing=args.retag)


def cmd_watch(cfg: Config, args: argparse.Namespace) -> int:
    from .watch import run_watch
    return run_watch(cfg, console)


def cmd_setup(cfg: Config | None, args: argparse.Namespace) -> int:
    """Interactive first-run wizard for a portable mihonban config."""
    from .config import (
        cloud_sync_component, default_data_home, find_rclone, find_sevenzip,
        resolve_config_path,
    )

    target = Path(args.config) if args.config else resolve_config_path()
    if component := cloud_sync_component(target.parent):
        console.print(
            f"[red]Refusing config inside cloud-sync folder {component!r}:[/red] "
            f"{target}")
        return 2
    if target.exists() and not args.force:
        console.print(f"[yellow]Config already exists:[/yellow] {target}")
        console.print("Pass --force to overwrite, or edit the file directly.")
        return 0

    home = default_data_home()
    console.print("[bold]mihonban setup[/bold] — portable config wizard\n")
    console.print("Paths below become your local music home.")
    console.print("They must NOT sit inside OneDrive/iCloud/Dropbox.\n")

    def ask(label: str, default: Path) -> Path:
        raw = input(f"{label} [{default}]: ").strip()
        return Path(raw).expanduser() if raw else default

    root = ask("Music home (Library / _inbox / _data live under this)", home)
    music_root = root / "Library"
    inbox = root / "_inbox"
    rym_pages = root / "_rym_pages"
    data_dir = root / "_data"

    music_root = ask("Library (music files)", music_root)
    inbox = ask("Inbox (drop archives or album folders here)", inbox)
    rym_pages = ask("RYM pages folder", rym_pages)
    data_dir = ask("Data dir (venv, logs, sqlite — not cloud-synced)", data_dir)

    passwords_raw = input("Archive passwords (comma-separated, optional): ").strip()
    passwords = [p.strip() for p in passwords_raw.split(",") if p.strip()]
    discogs = input("Discogs personal token (optional): ").strip()
    cloud_url = input("Cloud URL after deploy (optional, blank ok): ").strip()
    remote = input(
        "rclone remote path [mihonban:Music/Library]: ").strip() \
        or "mihonban:Music/Library"

    seven = find_sevenzip()
    rclone = find_rclone()
    target.parent.mkdir(parents=True, exist_ok=True)

    def toml_string(value: object) -> str:
        return json.dumps(str(value), ensure_ascii=False)

    def toml_path(path: Path | None) -> str:
        return toml_string(str(path).replace("\\", "/") if path else "")

    lines = [
        "# mihonban runtime config — keep OUT of cloud-sync folders",
        f"# generated by `mihonban setup` on {time.strftime('%Y-%m-%d')}",
        "",
        "[paths]",
        f"music_root = {toml_path(music_root)}",
        f"inbox      = {toml_path(inbox)}",
        f"rym_pages  = {toml_path(rym_pages)}",
        f"data_dir   = {toml_path(data_dir)}",
        "",
        "[archive]",
        "passwords = [" + ", ".join(toml_string(p) for p in passwords) + "]",
    ]
    if seven:
        lines.append(f"sevenzip = {toml_path(seven)}")
    lines += [
        "",
        "[naming]",
        'primary = "original"',
        "",
        "[discogs]",
        f"token = {toml_string(discogs)}",
        "[cloud]",
        f"url = {toml_string(cloud_url)}",
        'api_key = ""',
        f"rclone = {toml_path(rclone)}",
        f"remote = {toml_string(remote)}",
        "",
    ]
    target.write_text("\n".join(lines), encoding="utf-8")

    # create dirs
    for p in (music_root, inbox, inbox / "_done", inbox / "_quarantine",
              rym_pages, data_dir, data_dir / "tmp", data_dir / "logs",
              data_dir / "beets", data_dir / "state"):
        p.mkdir(parents=True, exist_ok=True)

    console.print(f"\n[green]Wrote[/green] {target}")
    console.print("Set this for every shell session (or put it in your profile):")
    if sys.platform == "win32":
        console.print(f'  setx MIHONBAN_CONFIG "{target}"')
        console.print(f'  # then open a new terminal, or: set MIHONBAN_CONFIG={target}')
    else:
        console.print(f'  export MIHONBAN_CONFIG="{target}"')
        console.print(f'  # add the export line to ~/.bashrc / ~/.zshrc')
    console.print("\nNext:")
    console.print("  1. Create a Python venv and: pip install -e ./pipeline")
    console.print("  2. mihonban doctor")
    console.print("  3. Deploy cloud: see docs/install.md")
    return 0


def cmd_doctor(cfg: Config, args: argparse.Namespace) -> int:
    import shutil as _sh
    import subprocess

    checks: list[tuple[str, bool, str]] = []
    checks.append(("config", True, str(config_mod.DEFAULT_CONFIG_PATH)))
    checks.append(("7-Zip", cfg.sevenzip.exists(), str(cfg.sevenzip)))
    for tool in ("ffmpeg", "git"):
        p = _sh.which(tool)
        checks.append((tool, p is not None, p or "not on PATH"))
    try:
        import beets  # noqa: F401
        checks.append(("beets", True, beets.__version__))
    except ImportError:
        checks.append(("beets", False, "missing"))
    for name, p in (("MUSIC_ROOT", cfg.music_root), ("INBOX", cfg.inbox),
                    ("RYM_PAGES", cfg.rym_pages), ("DATA", cfg.data_dir)):
        checks.append((name, p.exists(), str(p)))
    checks.append(("discogs token", bool(cfg.discogs_token),
                   "configured" if cfg.discogs_token else "missing"))
    table = Table(title=f"mihonban doctor (v{__version__})")
    table.add_column("检查项")
    table.add_column("状态")
    table.add_column("说明", overflow="fold")
    for name, ok, detail in checks:
        table.add_row(name, "[green]OK[/green]" if ok else "[red]FAIL[/red]",
                      detail)
    console.print(table)
    return 0


# ------------------------------------------------------------------ rym


def cmd_rym(cfg: Config, args: argparse.Namespace) -> int:
    _setup_logging(cfg, f"rym-{args.rym_cmd}")
    from . import rym
    if args.rym_cmd == "parse":
        return rym.cmd_parse(cfg, console)
    if args.rym_cmd == "match":
        return rym.cmd_match(cfg, console, auto_yes=args.yes)
    if args.rym_cmd == "write":
        return rym.cmd_write(cfg, console, apply=args.apply)
    return 2


# ------------------------------------------------------------------ main


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="mihonban",
        description="Private rare-music library pipeline "
                    "(ingest / review / rym / cloud)")
    ap.add_argument("--config", help="config TOML path (default: "
                    "$MIHONBAN_CONFIG, ./mihonban.toml, or per-user config)")
    ap.add_argument("--version", action="version", version=__version__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_setup = sub.add_parser(
        "setup", help="Interactive wizard: write portable mihonban config")
    p_setup.add_argument("--force", action="store_true",
                         help="Overwrite existing config")
    p_setup.set_defaults(func=cmd_setup, needs_config=False)

    p_ing = sub.add_parser("ingest", help="处理 INBOX 中的压缩包或文件夹")
    p_ing.add_argument("--apply", action="store_true",
                       help="执行改动（首次运行默认只出 dry-run 报告）")
    p_ing.add_argument("--dry-run", action="store_true",
                       help="只出报告，不改动文件")
    p_ing.add_argument("--keep-workspace", action="store_true",
                       help="保留解压工作目录（调试用）")
    p_ing.set_defaults(func=cmd_ingest)

    p_rev = sub.add_parser("review", help="交互裁决隔离区中的低置信度专辑")
    p_rev.set_defaults(func=cmd_review)

    p_cloud = sub.add_parser("cloud", help="云端（Cloudflare + OneDrive）")
    cloud_sub = p_cloud.add_subparsers(dest="cloud_cmd", required=True)
    p_csync = cloud_sub.add_parser("sync", help="上传曲库到 OneDrive 并登记到云端")
    p_csync.add_argument("--no-upload", action="store_true",
                         help="只登记元数据，跳过 rclone 上传")
    p_csync.set_defaults(func=cmd_cloud_sync)
    p_cpull = cloud_sub.add_parser(
        "pull", help="把网页上传的专辑从云存储拉回本地库")
    p_cpull.add_argument("--retag", action="store_true",
                         help="本地已有的云端专辑也按云端元数据补写文件 tag（修存量）")
    p_cpull.set_defaults(func=cmd_cloud_pull)

    p_watch = sub.add_parser(
        "watch", help="守望收件箱：压缩包或文件夹全自动上架")
    p_watch.set_defaults(func=cmd_watch)

    p_doc = sub.add_parser("doctor", help="环境与配置体检")
    p_doc.set_defaults(func=cmd_doctor)

    p_rym = sub.add_parser("rym", help="RYM 元数据层")
    rym_sub = p_rym.add_subparsers(dest="rym_cmd", required=True)
    rym_sub.add_parser("parse", help="解析 RYM_PAGES 中手存的 HTML")
    p_match = rym_sub.add_parser("match", help="RYM 记录与曲库模糊匹配")
    p_match.add_argument("--yes", action="store_true",
                         help="低置信度全部跳过（不询问）")
    p_write = rym_sub.add_parser("write", help="把匹配结果写入文件 tag")
    p_write.add_argument("--apply", action="store_true",
                         help="执行写入（默认 dry-run 报告）")
    p_rym.set_defaults(func=cmd_rym)

    args = ap.parse_args(argv)
    if getattr(args, "needs_config", True) is False:
        return args.func(None, args)
    try:
        cfg = config_mod.load(args.config)
    except ConfigError as e:
        console.print(f"[red]配置错误:[/red] {e}")
        console.print("Hint: run [bold]mihonban setup[/bold] for a portable config.")
        return 2
    cfg.ensure_dirs()
    return args.func(cfg, args)


if __name__ == "__main__":
    sys.exit(main())
