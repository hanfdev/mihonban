"""`mihonban rym match` — fuzzy-match RYM records against library albums.

Handles the romaji <-> original-script gap (RYM lists Japanese artists in
romaji, the library keeps 山下達郎) by comparing BOTH the raw normalized
strings and a pykakasi romanization, with token-set ordering so
"Tatsuro Yamashita" == "Yamashita, Tatsuro" == 山下達郎.

Confidence >= AUTO_THRESHOLD persists as 'auto'; anything in the gray zone
is listed for the user to decide (interactive numbered prompt, or --yes to
defer). Decisions persist in rym.sqlite and survive re-runs.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

from ..albuminfo import strip_quality
from ..config import Config
from .. import beets_runner
from . import db

log = logging.getLogger("mihonban.rym.match")

AUTO_THRESHOLD = 0.85
ASK_THRESHOLD = 0.55

_kks = None


def _romaji(s: str) -> str:
    global _kks
    if _kks is None:
        import pykakasi
        _kks = pykakasi.kakasi()
    return " ".join(item["hepburn"] for item in _kks.convert(s))


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).casefold()
    s = re.sub(r"[^\w\s]", " ", s)
    return " ".join(s.split())


def token_key(s: str) -> str:
    return " ".join(sorted(norm(s).split()))


def _sim(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _concat_perms(s: str) -> list[str]:
    """Space-less concatenations in every token order (<=3 tokens).

    pykakasi romanizes kanji compounds as ONE unsegmented token
    (山下達郎 -> "yamashitatatsurou"), so segmented romaji like
    "tatsuro yamashita" can only be compared after collapsing spaces —
    and name order (family-first vs given-first) differs between RYM and
    MusicBrainz, hence the permutations.
    """
    toks = norm(s).split()
    if not toks:
        return []
    if len(toks) > 3:
        return ["".join(toks)]
    from itertools import permutations
    return ["".join(p) for p in permutations(toks)]


def _variants(s: str) -> list[str]:
    """Expand RYM's dual-script convention: '山下達郎 [Tatsuro Yamashita]'
    yields the full string, the bracket-stripped name, and each bracketed
    alternative — similarity uses the best pair."""
    out = [s]
    stripped = re.sub(r"\s*\[[^\]]+\]", "", s).strip()
    if stripped and stripped != s:
        out.append(stripped)
    out += [i.strip() for i in re.findall(r"\[([^\]]+)\]", s) if i.strip()]
    return out


def _pair_similarity(a: str, b: str) -> float:
    best = _sim(token_key(a), token_key(b))
    for pa in _concat_perms(_romaji(a)):
        for pb in _concat_perms(_romaji(b)):
            best = max(best, _sim(pa, pb))
    return best


def name_similarity(a: str, b: str) -> float:
    """Best pair similarity across raw/romaji and dual-script variants."""
    return max(_pair_similarity(va, vb)
               for va in _variants(a) for vb in _variants(b))


def year_similarity(rym_year: int | None, years: list[int]) -> float:
    if not rym_year or not years:
        return 0.5  # unknown — neither reward nor punish hard
    diff = min(abs(rym_year - y) for y in years)
    if diff == 0:
        return 1.0
    if diff <= 2:
        return 0.8
    return 0.3  # reissue-vs-original gaps are routine in this library


@dataclass
class LibAlbum:
    artist: str
    album: str
    years: list[int]
    path: str


def library_albums(cfg: Config) -> list[LibAlbum]:
    proc = beets_runner.run_beet(
        cfg, "ls", "-a", "-f", "$albumartist\t$album\t$year\t$original_year\t$path")
    out = []
    for line in (proc.stdout or "").splitlines():
        parts = line.split("\t")
        if len(parts) != 5:
            continue
        artist, album, year, oyear, path = parts
        years = []
        for y in (year, oyear):
            try:
                if int(y):
                    years.append(int(y))
            except ValueError:
                pass
        if Path(path).is_dir():
            out.append(LibAlbum(artist, album, years, path))
    return out


def score(rym: db.RymAlbum, lib: LibAlbum) -> float:
    artist_sim = name_similarity(rym.artist, lib.artist)
    album_sim = name_similarity(strip_quality(rym.title),
                                strip_quality(lib.album))
    return round(0.45 * artist_sim + 0.45 * album_sim
                 + 0.10 * year_similarity(rym.year, lib.years), 3)


def run_match(cfg: Config, console, auto_yes: bool = False) -> int:
    con = db.connect(cfg.rym_db)
    try:
        rym_albums = db.load_albums(con)
        if not rym_albums:
            console.print("[yellow]rym.sqlite 为空 — 先运行 mihonban rym parse[/yellow]")
            return 0
        lib = library_albums(cfg)
        if not lib:
            console.print("[yellow]beets 曲库为空 — 先运行 mihonban ingest[/yellow]")
            return 0

        pending: list[tuple[db.RymAlbum, list[tuple[float, LibAlbum]]]] = []
        n_auto = n_kept = 0
        for rym in rym_albums:
            existing = db.get_match(con, rym.id)
            if existing and existing["status"] in ("confirmed", "rejected"):
                n_kept += 1
                continue  # user decisions are final
            ranked = sorted(((score(rym, la), la) for la in lib),
                            key=lambda t: -t[0])
            best_score, best = ranked[0]
            if best_score >= AUTO_THRESHOLD:
                db.set_match(con, rym.id, best.path, best_score, "auto")
                n_auto += 1
                console.print(f"  [green]auto[/green] {best_score:.2f} "
                              f"{rym.artist} — {rym.title} → {best.path}")
            elif best_score >= ASK_THRESHOLD:
                pending.append((rym, ranked[:3]))
            else:
                db.set_match(con, rym.id, "", best_score, "pending")
                console.print(f"  [red]无候选[/red] ({best_score:.2f}) "
                              f"{rym.artist} — {rym.title}")

        if pending:
            console.print(f"\n[bold]{len(pending)} 条低置信度，需要裁决:[/bold]")
            for rym, ranked in pending:
                console.print(f"\nRYM: [bold]{rym.artist} — {rym.title}"
                              f" ({rym.year})[/bold] rating={rym.rating}")
                for i, (sc, la) in enumerate(ranked, 1):
                    console.print(f"  {i}. {sc:.2f} {la.artist} — {la.album} "
                                  f"{la.years} \n     {la.path}")
                if auto_yes:
                    db.set_match(con, rym.id, ranked[0][1].path,
                                 ranked[0][0], "pending")
                    console.print("  [yellow]--yes: 暂存为 pending，"
                                  "下次运行再裁决[/yellow]")
                    continue
                ans = console.input("选择 1-3 / [s]跳过 / [n]都不是: ").strip().lower()
                if ans in ("1", "2", "3") and int(ans) <= len(ranked):
                    sc, la = ranked[int(ans) - 1]
                    db.set_match(con, rym.id, la.path, sc, "confirmed")
                elif ans == "n":
                    db.set_match(con, rym.id, "", 0.0, "rejected")
                else:
                    db.set_match(con, rym.id, ranked[0][1].path,
                                 ranked[0][0], "pending")

        console.print(f"\n自动匹配 {n_auto}，历史保留 {n_kept}，"
                      f"待裁决 {len(pending)}；下一步: [bold]mihonban rym write[/bold]")
        return 0
    finally:
        con.close()
