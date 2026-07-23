"""`mihonban rym parse` — parse hand-saved RYM release pages into SQLite.

Strictly offline: reads HTML files the user saved from their browser into
RYM_PAGES. No code here (or anywhere in mihonban) performs requests to
rateyourmusic.com — that is a project red line.

Extraction strategy, most-robust first:
  1. JSON-LD (``<script type="application/ld+json">`` MusicAlbum object):
     title, artist, rating, vote count, date. Survives most redesigns.
  2. CSS classes for what JSON-LD lacks: genres, descriptors, rank, URL.
Every file is parsed independently; failures are reported per-file and
never abort the batch.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from bs4 import BeautifulSoup

from ..config import Config
from . import db

log = logging.getLogger("mihonban.rym.parse")


class ParseFailure(RuntimeError):
    pass


def _jsonld_album(soup: BeautifulSoup) -> dict:
    fallback = {}
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (ValueError, TypeError):
            continue
        candidates = data if isinstance(data, list) else [data]
        for obj in candidates:
            if not isinstance(obj, dict):
                continue
            kind = obj.get("@type")
            if kind in ("MusicAlbum", "MusicRelease"):
                return obj
            if kind == "MusicRecording" and not fallback:
                fallback = obj
    # Some saved pages expose only a recording object; keep it as a last
    # resort, but never let it win over the album-level object when both are
    # present in the JSON-LD graph.
    return fallback


def _text(el) -> str:
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)) if el else ""


def _genres(soup: BeautifulSoup, cls: str) -> list[str]:
    span = soup.find(class_=cls)
    if not span:
        return []
    return [
        _text(a) for a in span.find_all("a", class_="genre")
    ] or [g.strip() for g in _text(span).split(",") if g.strip()]


def _album_title(soup: BeautifulSoup, artist: str) -> str:
    """Album title from the .album_title heading.

    Real RYM pages nest the artist credit ("By <artist>") inside the same
    heading element, so get_text() would yield "Go Ahead! By Tatsu
    Yamashita". Prefer the heading's DIRECT text nodes; strip a trailing
    "By <artist>" as a second line of defense.
    """
    el = soup.find(class_="album_title")
    title = ""
    if el:
        direct = "".join(s for s in el.find_all(string=True, recursive=False))
        title = re.sub(r"\s+", " ", direct).strip()
        if not title:
            title = _text(el)
    for cand in (artist, re.sub(r"\s*\[[^\]]+\]", "", artist).strip()):
        suffix = f" by {cand}".lower()
        if cand and title.lower().endswith(suffix):
            title = title[: -len(suffix)].rstrip()
            break
    return title


def _ranked(soup: BeautifulSoup) -> str:
    """'Ranked' row of the release info table -> '#185 for 1978'."""
    for th in soup.find_all("th", class_="info_hdr"):
        if _text(th).strip().lower() == "ranked":
            td = th.find_next_sibling("td")
            if td:
                return re.sub(r"#\s+", "#", _text(td)).strip()
    el = soup.select_one(".release_ranking, .album_rank")
    return _text(el)


def parse_html(path: Path) -> db.RymAlbum:
    soup = BeautifulSoup(path.read_text("utf-8", errors="replace"), "lxml")
    ld = _jsonld_album(soup)

    artist = ""
    by = ld.get("byArtist")
    if isinstance(by, dict):
        artist = by.get("name", "")
    elif isinstance(by, list) and by:
        artist = ", ".join(a.get("name", "") for a in by if isinstance(a, dict))
    if not artist:
        artist = _text(soup.select_one(".album_info a.artist")
                       or soup.find("a", class_="artist"))

    title = (ld.get("name") or _album_title(soup, artist) or "").strip()
    if not title:
        raise ParseFailure("no album title found (JSON-LD and CSS both)")

    rating = votes = None
    agg = ld.get("aggregateRating") or {}
    try:
        rating = float(agg.get("ratingValue"))
    except (TypeError, ValueError):
        el = soup.find(class_="avg_rating")
        if el:
            try:
                rating = float(_text(el))
            except ValueError:
                pass
    try:
        votes = int(str(agg.get("ratingCount")).replace(",", ""))
    except (TypeError, ValueError):
        el = soup.find(class_="num_ratings")
        if el:
            m = re.search(r"[\d,]+", _text(el))
            if m:
                votes = int(m.group().replace(",", ""))

    year = None
    date = ld.get("datePublished") or ""
    m = re.search(r"(19|20)\d{2}", str(date))
    if not m:
        info = soup.find(class_="issue_year") or soup.find(
            string=re.compile(r"Released"))
        m = re.search(r"(19|20)\d{2}", _text(getattr(info, "parent", None))
                      if info and not isinstance(info, str) else str(info or ""))
    if m:
        year = int(m.group())

    rank = _ranked(soup)

    url = ""
    canon = soup.find("link", rel="canonical") or soup.find(
        "meta", property="og:url")
    if canon:
        url = canon.get("href") or canon.get("content") or ""
    if not url:
        url = str(ld.get("@id") or ld.get("url") or "")

    return db.RymAlbum(
        title=title, artist=artist, year=year, rating=rating, votes=votes,
        rank=rank,
        primary_genres=_genres(soup, "release_pri_genres"),
        secondary_genres=_genres(soup, "release_sec_genres"),
        descriptors=[d for d in _text(
            soup.find(class_="release_pri_descriptors")).split(", ") if d],
        rym_url=url, source_file=path.name)


def run_parse(cfg: Config, console) -> int:
    pages = sorted(p for p in cfg.rym_pages.glob("*.htm*") if p.is_file())
    if not pages:
        console.print(f"[yellow]RYM_PAGES 目录没有 HTML：{cfg.rym_pages}[/yellow]\n"
                      "在浏览器打开 RYM 专辑页 → Ctrl+S 保存到该目录"
                      "（仅 HTML 即可）。")
        return 0
    con = db.connect(cfg.rym_db)
    try:
        ok, failed = 0, []
        for p in pages:
            try:
                album = parse_html(p)
                db.upsert_album(con, album)
            except Exception as e:  # noqa: BLE001 — per-file tolerance by design
                failed.append((p.name, str(e)))
                log.warning("parse failed %s: %s", p.name, e)
                continue
            ok += 1
            # NB: cosmetic output stays OUTSIDE the try — a console encoding
            # hiccup must never be recorded as a parse failure
            console.print(
                f"  [green]OK[/green] {album.artist} — {album.title} "
                f"({album.year}) rating={album.rating} ({album.votes} votes) "
                f"[{'; '.join(album.all_genres[:3])}]")
        if failed:
            console.print(f"\n[red]{len(failed)} 个文件解析失败:[/red]")
            for name, err in failed:
                console.print(f"  FAIL {name}: {err}")
        console.print(f"\n入库 {ok}/{len(pages)} → {cfg.rym_db}；"
                      "下一步: [bold]mihonban rym match[/bold]")
        return 0 if not failed else 1
    finally:
        con.close()
