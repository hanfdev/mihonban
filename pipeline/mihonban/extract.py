"""Inbox preparation: folders and nested RAR/ZIP/7z archives.

- ZIP goes through Python's zipfile with manual per-entry filename decoding
  (cp932 -> gbk -> utf-8 -> cp437 candidate scoring), because 7-Zip decodes
  non-Unicode zip names with the system codepage and garbles them.
- RAR/7z go through 7z.exe (handles RAR Unicode names natively); afterwards a
  filename-repair pass fixes anything that was stored without Unicode names.
- Nested archives are extracted recursively (depth-capped) and the inner
  archive file is deleted from the *workspace copy* — the original archive in
  the inbox is never touched.
"""

from __future__ import annotations

import logging
import math
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path

from .config import Config
from .mojibake import NameFix, japanese_score, repair_name

log = logging.getLogger("mihonban.extract")

ARCHIVE_EXTS = {".rar", ".zip", ".7z"}
AUDIO_EXTS = {
    ".mp3", ".flac", ".ogg", ".m4a", ".ape", ".wv", ".wav", ".aiff",
    ".opus", ".wma", ".tak", ".tta", ".dsf", ".mpc",
}
MAX_DEPTH = 3

# These limits are deliberately generous for hi-res box sets, while still
# preventing a malformed or hostile archive from exhausting a workstation.
# A single recursive extraction shares one budget, so nesting cannot multiply
# the allowance at every layer.
MAX_EXTRACTED_FILES = 20_000
MAX_ARCHIVE_ENTRIES = 25_000
MAX_EXTRACTED_BYTES = 64 * 1024 ** 3
MAX_SINGLE_FILE_BYTES = 16 * 1024 ** 3
MAX_COMPRESSION_RATIO = 10_000
MIN_RATIO_CHECK_BYTES = 100 * 1024 ** 2
MAX_SEVENZIP_LIST_BYTES = 32 * 1024 ** 2
SEVENZIP_LIST_TIMEOUT = 5 * 60
SEVENZIP_EXTRACT_TIMEOUT = 6 * 3600


class ExtractError(RuntimeError):
    pass


@dataclass(frozen=True)
class _ArchiveEntry:
    path: Path
    size: int
    packed_size: int | None
    is_dir: bool = False


@dataclass
class _ExtractBudget:
    files: int = 0
    size: int = 0

    def reserve(self, entries: list[_ArchiveEntry], archive: Path) -> None:
        files = [entry for entry in entries if not entry.is_dir]
        if any(entry.size < 0 for entry in files):
            raise ExtractError(f"negative member size in {archive.name}")
        largest = max((entry.size for entry in files), default=0)
        if largest > MAX_SINGLE_FILE_BYTES:
            raise ExtractError(
                f"member exceeds {MAX_SINGLE_FILE_BYTES} bytes in "
                f"{archive.name}")
        count = self.files + len(files)
        size = self.size + sum(entry.size for entry in files)
        if count > MAX_EXTRACTED_FILES:
            raise ExtractError(
                f"archive tree exceeds {MAX_EXTRACTED_FILES} files: "
                f"{archive.name}")
        if size > MAX_EXTRACTED_BYTES:
            raise ExtractError(
                f"archive tree exceeds {MAX_EXTRACTED_BYTES} bytes: "
                f"{archive.name}")

        packed = [entry.packed_size for entry in files]
        unpacked_here = sum(entry.size for entry in files)
        if (unpacked_here >= MIN_RATIO_CHECK_BYTES and packed
                and all(value is not None and value >= 0 for value in packed)):
            packed_here = sum(value or 0 for value in packed)
            ratio = (unpacked_here / packed_here
                     if packed_here else math.inf)
            if ratio > MAX_COMPRESSION_RATIO:
                raise ExtractError(
                    f"suspicious compression ratio in {archive.name}: "
                    f"{ratio:.0f}:1")
        self.files = count
        self.size = size


def is_archive(p: Path) -> bool:
    return p.suffix.lower() in ARCHIVE_EXTS


# ---------------------------------------------------------------- zip


def _decode_zip_name(zi: zipfile.ZipInfo) -> str:
    if zi.flag_bits & 0x800:  # UTF-8 flag set — trust it
        return zi.filename
    raw = zi.filename.encode("cp437")  # zipfile's lossless fallback decode
    candidates = []
    for enc in ("cp932", "gbk", "utf-8", "cp437"):
        try:
            candidates.append(raw.decode(enc))
        except UnicodeDecodeError:
            continue
    if not candidates:
        return zi.filename
    return max(candidates, key=japanese_score)


def _safe_relpath(name: str) -> Path | None:
    """Normalize an archive member path and reject unsafe transformations."""
    name = unicodedata.normalize("NFC", name)
    normalized = name.replace("\\", "/")
    if normalized.startswith("/"):
        raise ExtractError(f"absolute archive member path: {name!r}")
    parts = []
    for part in normalized.split("/"):
        part = part.strip()
        if part in ("", "."):
            continue
        if part == "..":
            raise ExtractError(f"parent traversal in archive member: {name!r}")
        if ":" in part:
            raise ExtractError(f"drive or stream path in archive member: {name!r}")
        if any(ord(ch) < 32 for ch in part):
            raise ExtractError(f"control character in archive member: {name!r}")
        if not part.rstrip(" ."):
            raise ExtractError(f"empty archive member component: {name!r}")
        parts.append(part)
    return Path(*parts) if parts else None


def _member_key(path: Path) -> str:
    """Cross-platform collision key (Windows/OneDrive are case-insensitive)."""
    return "/".join(unicodedata.normalize("NFC", part.rstrip(" .")).casefold()
                    for part in path.parts)


def _validate_entries(entries: list[_ArchiveEntry], archive: Path) -> None:
    if len(entries) > MAX_ARCHIVE_ENTRIES:
        raise ExtractError(
            f"archive tree exceeds {MAX_ARCHIVE_ENTRIES} entries: "
            f"{archive.name}")
    seen: dict[str, _ArchiveEntry] = {}
    for entry in entries:
        key = _member_key(entry.path)
        if key in seen:
            raise ExtractError(
                f"archive members collide after filename normalization: "
                f"{seen[key].path} / {entry.path} in {archive.name}")
        seen[key] = entry
    for key, entry in seen.items():
        parts = key.split("/")
        for end in range(1, len(parts)):
            parent = seen.get("/".join(parts[:end]))
            if parent is not None and not parent.is_dir:
                raise ExtractError(
                    f"archive member is both a file and directory: "
                    f"{parent.path} in {archive.name}")


def _is_link(path: Path) -> bool:
    if path.is_symlink():
        return True
    is_junction = getattr(path, "is_junction", None)
    if is_junction and is_junction():
        return True
    # Python 3.11 has no Path.is_junction().  A Windows directory reparse
    # point is a junction (or equivalent redirect); do not traverse it while
    # copying an inbox folder or validating extracted output.
    try:
        attrs = getattr(path.lstat(), "st_file_attributes", 0)
    except OSError:
        return False
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    directory = getattr(stat, "FILE_ATTRIBUTE_DIRECTORY", 0)
    return bool(reparse and directory
                and attrs & reparse and attrs & directory)


def _verify_extracted_tree(root: Path, entries: list[_ArchiveEntry]) -> None:
    """Reject links and require output to match the archive manifest exactly."""
    actual: dict[str, int] = {}
    for current, dirs, files in os.walk(root, followlinks=False):
        here = Path(current)
        for name in dirs:
            if _is_link(here / name):
                raise ExtractError(f"archive extracted a link: {name}")
        for name in files:
            path = here / name
            if _is_link(path):
                raise ExtractError(f"archive extracted a link: {name}")
            size = path.stat().st_size
            if size > MAX_SINGLE_FILE_BYTES:
                raise ExtractError(f"extracted member is too large: {path.name}")
            key = _member_key(path.relative_to(root))
            if key in actual:
                raise ExtractError(
                    f"extracted paths collide after normalization: {path.name}")
            actual[key] = size
    declared = {
        _member_key(entry.path): entry.size
        for entry in entries if not entry.is_dir
    }
    missing = declared.keys() - actual.keys()
    extra = actual.keys() - declared.keys()
    wrong_size = [key for key in declared.keys() & actual.keys()
                  if declared[key] != actual[key]]
    if missing or extra or wrong_size:
        details = []
        if missing:
            details.append(f"missing {len(missing)}")
        if extra:
            details.append(f"extra {len(extra)}")
        if wrong_size:
            details.append(f"wrong size {len(wrong_size)}")
        raise ExtractError(
            "extracted output does not match archive manifest: "
            + ", ".join(details))


def _ensure_mergeable(source: Path, dest: Path) -> None:
    if not dest.exists():
        return
    existing = {
        _member_key(path.relative_to(dest)): path
        for path in dest.rglob("*")
    }
    for path in source.rglob("*"):
        rel = path.relative_to(source)
        target = existing.get(_member_key(rel))
        if target is None:
            continue
        if path.is_dir() and target.is_dir() and not _is_link(target):
            continue
        raise ExtractError(f"archive would overwrite existing path: {target}")


def _merge_tree(source: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    existing = {
        child.name.rstrip(" .").casefold(): child
        for child in dest.iterdir()
    }
    for child in sorted(source.iterdir(), key=lambda path: path.name.casefold()):
        target = existing.get(child.name.rstrip(" .").casefold())
        if target is not None:
            _merge_tree(child, target)
            child.rmdir()
        else:
            shutil.move(str(child), str(dest / child.name))


def _zip_entries(zf: zipfile.ZipFile,
                 archive: Path) -> list[tuple[zipfile.ZipInfo, _ArchiveEntry]]:
    members = []
    for zi in zf.infolist():
        rel = _safe_relpath(_decode_zip_name(zi))
        if rel is None:
            continue
        if len(members) >= MAX_ARCHIVE_ENTRIES:
            raise ExtractError(
                f"archive tree exceeds {MAX_ARCHIVE_ENTRIES} entries: "
                f"{archive.name}")
        mode = (zi.external_attr >> 16) & 0xFFFF
        if stat.S_ISLNK(mode):
            raise ExtractError(f"archive contains a symbolic link: {rel}")
        members.append((zi, _ArchiveEntry(
            path=rel,
            size=0 if zi.is_dir() else zi.file_size,
            packed_size=0 if zi.is_dir() else zi.compress_size,
            is_dir=zi.is_dir(),
        )))
    _validate_entries([entry for _, entry in members], archive)
    return members


def _extract_zip(archive: Path, dest: Path, passwords: list[str],
                 budget: _ExtractBudget) -> list[_ArchiveEntry]:
    with zipfile.ZipFile(archive) as zf:
        members = _zip_entries(zf, archive)
        entries = [entry for _, entry in members]
        budget.reserve(entries, archive)
        encrypted_files = [zi for zi, entry in members
                           if zi.flag_bits & 0x1 and not entry.is_dir]
        pwd: bytes | None = None
        if encrypted_files:
            probe = encrypted_files[0]
            for cand in passwords:
                try:
                    with zf.open(probe, pwd=cand.encode()) as f:
                        f.read(1)
                    pwd = cand.encode()
                    break
                except (EOFError, RuntimeError, zipfile.BadZipFile):
                    continue
            if pwd is None:
                raise ExtractError(f"no working password for {archive.name}")
        for zi, entry in members:
            target = dest / entry.path
            if entry.is_dir:
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(zi, pwd=pwd) as src, open(target, "wb") as out:
                written = 0
                while chunk := src.read(1024 * 1024):
                    written += len(chunk)
                    if written > entry.size or written > MAX_SINGLE_FILE_BYTES:
                        raise ExtractError(
                            f"member expanded beyond its declared size: "
                            f"{entry.path}")
                    out.write(chunk)
                if written != entry.size:
                    raise ExtractError(
                        f"member size mismatch: {entry.path} in {archive.name}")
        return entries


# ---------------------------------------------------------------- 7z


def _parse_7z_listing(output: bytes, archive: Path) -> list[_ArchiveEntry]:
    entries: list[_ArchiveEntry] = []
    current: dict[str, str] = {}

    def append_current() -> None:
        nonlocal current
        if not current:
            return
        name = current.get("Path")
        if not name:
            current = {}
            return
        rel = _safe_relpath(name)
        if rel is None:
            current = {}
            return
        if current.get("Symbolic Link") or current.get("Hard Link"):
            raise ExtractError(f"archive contains a link: {rel}")
        attrs = current.get("Attributes", "")
        is_dir = current.get("Folder") == "+" or attrs.startswith("D")
        try:
            size = 0 if is_dir else int(current.get("Size") or 0)
            packed_raw = current.get("Packed Size")
            packed = (0 if is_dir else
                      (int(packed_raw)
                       if packed_raw not in (None, "") else None))
        except ValueError as exc:
            raise ExtractError(
                f"invalid 7z member size in {archive.name}: {rel}") from exc
        if len(entries) >= MAX_ARCHIVE_ENTRIES:
            raise ExtractError(
                f"archive tree exceeds {MAX_ARCHIVE_ENTRIES} entries: "
                f"{archive.name}")
        entries.append(_ArchiveEntry(rel, size, packed, is_dir))
        current = {}

    for line in output.decode("utf-8", errors="replace").splitlines():
        if not line.strip():
            append_current()
            continue
        key, sep, value = line.partition(" = ")
        if sep:
            current[key] = value
    append_current()
    _validate_entries(entries, archive)
    return entries


def _list_7z(archive: Path, cfg: Config,
             passwords: list[str]) -> list[_ArchiveEntry]:
    last_err = ""
    for attempt, pw in enumerate(passwords, start=1):
        cmd = [str(cfg.sevenzip), "l", "-slt", "-ba", "-bd",
               f"-p{pw}", "--", str(archive)]
        try:
            # 7z -slt output is controlled by the archive manifest. Redirect it
            # to disk so a file with millions of entries cannot fill RAM before
            # the entry-count checks get a chance to run.
            with tempfile.TemporaryFile() as listing:
                proc = subprocess.run(
                    cmd, stdout=listing, stderr=subprocess.STDOUT,
                    timeout=SEVENZIP_LIST_TIMEOUT)
                captured = getattr(proc, "stdout", None)
                if isinstance(captured, (bytes, bytearray)):
                    output = bytes(captured)
                    stderr = getattr(proc, "stderr", None)
                    if isinstance(stderr, (bytes, bytearray)):
                        output += bytes(stderr)
                else:
                    size = listing.tell()
                    if size > MAX_SEVENZIP_LIST_BYTES:
                        raise ExtractError(
                            f"7z listing output exceeds "
                            f"{MAX_SEVENZIP_LIST_BYTES} bytes: {archive.name}")
                    listing.seek(0)
                    output = listing.read(MAX_SEVENZIP_LIST_BYTES + 1)
        except subprocess.TimeoutExpired as exc:
            raise ExtractError(
                f"7z listing timed out on {archive.name}") from exc
        except OSError as exc:
            raise ExtractError(f"could not run 7z: {exc}") from exc
        if len(output) > MAX_SEVENZIP_LIST_BYTES:
            raise ExtractError(
                f"7z listing output exceeds {MAX_SEVENZIP_LIST_BYTES} bytes: "
                f"{archive.name}")
        if proc.returncode in (0, 1):
            return _parse_7z_listing(output, archive)
        text = output.decode("utf-8", errors="replace")
        last_err = text.strip().splitlines()[-1] if text.strip() else "unknown"
        log.debug("7z listing attempt %s failed rc=%s: %s",
                  attempt, proc.returncode, last_err)
    raise ExtractError(
        f"7z could not list {archive.name} (all passwords tried): {last_err}")


def _extract_7z(archive: Path, dest: Path, cfg: Config,
                passwords: list[str],
                budget: _ExtractBudget) -> list[_ArchiveEntry]:
    entries = _list_7z(archive, cfg, passwords)
    budget.reserve(entries, archive)
    last_err = ""
    for attempt, pw in enumerate(passwords, start=1):
        shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir(parents=True, exist_ok=True)
        cmd = [str(cfg.sevenzip), "x", f"-p{pw}", f"-o{dest}", "-y",
               "-bd", "-bb0", "--", str(archive)]
        try:
            proc = subprocess.run(cmd, capture_output=True,
                                  timeout=SEVENZIP_EXTRACT_TIMEOUT)
        except subprocess.TimeoutExpired as exc:
            raise ExtractError(
                f"7z extraction timed out on {archive.name}") from exc
        except OSError as exc:
            raise ExtractError(f"could not run 7z: {exc}") from exc
        out = (proc.stdout + proc.stderr).decode("utf-8", errors="replace")
        if proc.returncode == 0:
            return entries
        last_err = out.strip().splitlines()[-1] if out.strip() else "unknown"
        log.debug("7z extraction attempt %s failed rc=%s: %s",
                  attempt, proc.returncode, last_err)
    raise ExtractError(
        f"7z failed on {archive.name} (all passwords tried): {last_err}")


# ---------------------------------------------------------------- api


def extract_archive(archive: Path, dest: Path, cfg: Config,
                    _budget: _ExtractBudget | None = None) -> None:
    """Extract one archive into dest, trying configured passwords."""
    # Empty password FIRST: 7z passes passwords as `-p{pw}` argv elements,
    # visible to same-user processes for the whole run. Most archives are
    # unencrypted, so leading with "" keeps real passwords (including ones
    # merged from the cloud backend) off the command line in the common case;
    # encrypted archives simply fail the first attempt and continue.
    passwords = list(dict.fromkeys(["", *cfg.passwords]))
    budget = _budget or _ExtractBudget()
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(
                prefix=".mihonban-extract-", dir=dest.parent) as temp:
            stage = Path(temp)
            if archive.suffix.lower() == ".zip":
                entries = _extract_zip(archive, stage, passwords, budget)
            else:
                entries = _extract_7z(
                    archive, stage, cfg, passwords, budget)
            _verify_extracted_tree(stage, entries)
            _ensure_mergeable(stage, dest)
            _merge_tree(stage, dest)
    except ExtractError:
        raise
    except (EOFError, NotImplementedError, OSError, RuntimeError, ValueError,
            zipfile.BadZipFile, zipfile.LargeZipFile) as exc:
        raise ExtractError(
            f"could not extract {archive.name}: {exc}") from exc


def repair_tree_names(root: Path) -> list[NameFix]:
    """Rename mojibake files/dirs in-place (bottom-up). Returns fixes."""
    fixes: list[NameFix] = []
    entries = sorted(root.rglob("*"), key=lambda p: len(p.parts),
                     reverse=True)
    for p in entries:
        fixed = repair_name(p.name)
        if fixed == p.name:
            continue
        target = p.with_name(fixed)
        if target.exists():
            log.warning("name-fix collision, keeping original: %s", p)
            continue
        p.rename(target)
        fixes.append(NameFix(old=p.name, new=fixed))
    return fixes


def extract_recursive(archive: Path, workspace: Path, cfg: Config,
                      depth: int = 0,
                      _budget: _ExtractBudget | None = None) -> list[NameFix]:
    """Extract archive + any nested archives into workspace."""
    if depth > MAX_DEPTH:
        raise ExtractError(f"nesting deeper than {MAX_DEPTH}: {archive}")
    budget = _budget or _ExtractBudget()
    extract_archive(archive, workspace, cfg, budget)
    return _expand_nested_archives(workspace, cfg, depth + 1, budget)


def _expand_nested_archives(root: Path, cfg: Config,
                            depth: int,
                            budget: _ExtractBudget | None = None) -> list[NameFix]:
    """Repair names and recursively expand every archive below ``root``."""
    budget = budget or _ExtractBudget()
    fixes = repair_tree_names(root)
    for nested in sorted(root.rglob("*")):
        if nested.is_file() and is_archive(nested):
            inner_dest = nested.parent / nested.stem
            log.info("nested archive: %s", nested.name)
            fixes += extract_recursive(nested, inner_dest, cfg, depth, budget)
            nested.unlink()  # workspace copy only; inbox original untouched
    return fixes


def _folder_entries(root: Path) -> list[_ArchiveEntry]:
    """Scan a direct-folder submission without following redirected paths."""
    entries: list[_ArchiveEntry] = []
    pending: list[tuple[Path, Path]] = [(root, Path())]
    while pending:
        current, relative = pending.pop()
        try:
            with os.scandir(current) as scan:
                children = sorted(scan, key=lambda entry: entry.name.casefold())
        except OSError as exc:
            raise ExtractError(
                f"could not scan folder {root.name}: {exc}") from exc
        for child in children:
            path = Path(child.path)
            rel = relative / child.name
            if child.is_symlink() or _is_link(path):
                raise ExtractError(f"folder contains a symbolic link: {rel}")
            try:
                if child.is_dir(follow_symlinks=False):
                    entries.append(_ArchiveEntry(rel, 0, 0, True))
                    pending.append((path, rel))
                elif child.is_file(follow_symlinks=False):
                    size = child.stat(follow_symlinks=False).st_size
                    entries.append(_ArchiveEntry(rel, size, size, False))
                else:
                    raise ExtractError(
                        f"folder contains an unsupported file type: {rel}")
            except OSError as exc:
                raise ExtractError(
                    f"could not inspect folder entry {rel}: {exc}") from exc
            if len(entries) > MAX_ARCHIVE_ENTRIES:
                raise ExtractError(
                    f"folder tree exceeds {MAX_ARCHIVE_ENTRIES} entries: "
                    f"{root.name}")
    _validate_entries(entries, root)
    return entries


def prepare_inbox_item(item: Path, workspace: Path,
                       cfg: Config) -> list[NameFix]:
    """Copy/extract an inbox archive or folder into a private workspace.

    A folder is copied with its top-level name intact so folder-name tag
    synthesis behaves exactly as it does for an archive containing that
    folder. Symbolic links are rejected rather than copying data from outside
    the submitted tree.
    """
    if item.is_file() and is_archive(item):
        return extract_recursive(item, workspace, cfg)
    if not item.is_dir():
        raise ExtractError(f"unsupported inbox item: {item.name}")
    try:
        if _is_link(item):
            raise ExtractError(f"folder contains a symbolic link: {item.name}")
        entries = _folder_entries(item)
        budget = _ExtractBudget()
        budget.reserve(entries, item)
        copied = workspace / item.name
        shutil.copytree(item, copied, symlinks=True)
        _verify_extracted_tree(copied, entries)
    except ExtractError:
        raise
    except OSError as e:
        raise ExtractError(f"could not copy folder {item.name}: {e}") from e
    return _expand_nested_archives(workspace, cfg, 0, budget)


def find_album_dirs(root: Path) -> list[Path]:
    """Find album roots, coalescing conventional multi-disc subfolders.

    A/B/C releases often contain ``Album/Disc 1/*.flac`` and
    ``Album/Disc 2/*.flac``. Treating each disc as an album loses the shared
    title/artifacts and makes beets import duplicate albums. Two unrelated
    albums under one artist directory are not merged because their child names
    do not look like disc labels.
    """
    direct = {
        d for d in [root, *root.rglob("*")]
        if d.is_dir()
        and any(f.suffix.lower() in AUDIO_EXTS
                for f in d.iterdir() if f.is_file())
    }

    def disc_label(name: str) -> bool:
        return bool(re.match(
            r"^(?:disc|cd|disk|vol(?:ume)?|side)[ _.-]*[0-9]+$|^[0-9]+$",
            name.strip(), re.IGNORECASE))

    def explicit_disc_label(name: str) -> bool:
        return bool(re.match(
            r"^(?:disc|cd|disk|vol(?:ume)?|side)[ _.-]*[0-9]+$",
            name.strip(), re.IGNORECASE))

    def has_shared_album_context(parent: Path) -> bool:
        """Require evidence before treating bare ``01``/``02`` as discs.

        Bare numbered folders are also a common way to store separate albums
        below an artist. A release-level date/title or a shared non-audio
        artifact makes the multi-disc interpretation materially safer.
        """
        if re.search(r"(?:19|20)\d{2}|\[[^\]]+\]", parent.name):
            return True
        try:
            return any(child.is_file()
                       and child.suffix.lower() not in AUDIO_EXTS
                       for child in parent.iterdir())
        except OSError:
            return False

    grouped: set[Path] = set()
    consumed: set[Path] = set()
    for parent in {d.parent for d in direct}:
        children = sorted(d for d in direct if d.parent == parent)
        labels = [d.name for d in children]
        explicit = all(explicit_disc_label(name) for name in labels)
        numbered = all(disc_label(name) and name.strip().isdigit()
                       for name in labels)
        if (len(children) >= 2 and
                (explicit or (numbered and has_shared_album_context(parent)))):
            grouped.add(parent)
            consumed.update(children)
    albums = (direct - consumed) | grouped
    return sorted(albums)
