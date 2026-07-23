"""SQLite storage for the local RYM metadata layer."""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS rym_albums (
  id INTEGER PRIMARY KEY,
  rym_url TEXT UNIQUE,
  title TEXT NOT NULL,
  artist TEXT,
  year INTEGER,
  rating REAL,
  votes INTEGER,
  rank TEXT,
  primary_genres TEXT,
  secondary_genres TEXT,
  descriptors TEXT,
  source_file TEXT,
  parsed_at TEXT
);
CREATE TABLE IF NOT EXISTS rym_matches (
  rym_id INTEGER PRIMARY KEY REFERENCES rym_albums(id) ON DELETE CASCADE,
  album_path TEXT NOT NULL,
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TEXT
);
"""


def _migrate(con: sqlite3.Connection) -> None:
    cols = {r[1] for r in con.execute("PRAGMA table_info(rym_matches)")}
    if "stars_pushed" in cols:
        # Remove state owned by the retired player integration from old DBs.
        con.execute("ALTER TABLE rym_matches DROP COLUMN stars_pushed")
        con.commit()


@dataclass
class RymAlbum:
    title: str
    artist: str = ""
    year: int | None = None
    rating: float | None = None
    votes: int | None = None
    rank: str = ""
    primary_genres: list[str] = field(default_factory=list)
    secondary_genres: list[str] = field(default_factory=list)
    descriptors: list[str] = field(default_factory=list)
    rym_url: str = ""
    source_file: str = ""
    id: int | None = None

    @property
    def all_genres(self) -> list[str]:
        return self.primary_genres + [g for g in self.secondary_genres
                                      if g not in self.primary_genres]


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    _migrate(con)
    return con


def upsert_album(con: sqlite3.Connection, a: RymAlbum) -> int:
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    cur = con.execute(
        """INSERT INTO rym_albums (rym_url, title, artist, year, rating,
             votes, rank, primary_genres, secondary_genres, descriptors,
             source_file, parsed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(rym_url) DO UPDATE SET
             title=excluded.title, artist=excluded.artist,
             year=excluded.year, rating=excluded.rating,
             votes=excluded.votes, rank=excluded.rank,
             primary_genres=excluded.primary_genres,
             secondary_genres=excluded.secondary_genres,
             descriptors=excluded.descriptors,
             source_file=excluded.source_file, parsed_at=excluded.parsed_at
           RETURNING id""",
        (a.rym_url or f"file://{a.source_file}", a.title, a.artist, a.year,
         a.rating, a.votes, a.rank,
         "; ".join(a.primary_genres), "; ".join(a.secondary_genres),
         "; ".join(a.descriptors), a.source_file, now))
    row = cur.fetchone()
    con.commit()
    return row["id"]


def load_albums(con: sqlite3.Connection) -> list[RymAlbum]:
    out = []
    for r in con.execute("SELECT * FROM rym_albums ORDER BY artist, title"):
        out.append(RymAlbum(
            id=r["id"], title=r["title"], artist=r["artist"] or "",
            year=r["year"], rating=r["rating"], votes=r["votes"],
            rank=r["rank"] or "",
            primary_genres=[g for g in (r["primary_genres"] or "").split("; ") if g],
            secondary_genres=[g for g in (r["secondary_genres"] or "").split("; ") if g],
            descriptors=[d for d in (r["descriptors"] or "").split("; ") if d],
            rym_url=r["rym_url"] or "", source_file=r["source_file"] or ""))
    return out


def set_match(con: sqlite3.Connection, rym_id: int, album_path: str,
              confidence: float, status: str) -> None:
    con.execute(
        """INSERT INTO rym_matches (rym_id, album_path, confidence, status,
                                    decided_at)
           VALUES (?,?,?,?,datetime('now','localtime'))
           ON CONFLICT(rym_id) DO UPDATE SET
             album_path=excluded.album_path,
             confidence=excluded.confidence, status=excluded.status,
             decided_at=excluded.decided_at""",
        (rym_id, album_path, confidence, status))
    con.commit()


def get_match(con: sqlite3.Connection, rym_id: int) -> sqlite3.Row | None:
    return con.execute("SELECT * FROM rym_matches WHERE rym_id=?",
                       (rym_id,)).fetchone()


def confirmed_matches(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return con.execute(
        """SELECT m.*, a.title, a.artist, a.year, a.rating, a.votes,
                  a.rank, a.primary_genres, a.secondary_genres,
                  a.descriptors, a.rym_url
           FROM rym_matches m JOIN rym_albums a ON a.id = m.rym_id
           WHERE m.status IN ('auto','confirmed')""").fetchall()
