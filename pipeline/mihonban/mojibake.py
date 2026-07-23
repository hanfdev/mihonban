"""Detection & repair of CP932-based mojibake in filenames and tag values.

Two classic failure modes from old Japanese rips:

1. Tag text: ID3 frames declared Latin-1 but containing Shift-JIS bytes.
   mutagen hands us the Latin-1 misdecode; re-encoding latin-1 recovers the
   original bytes, which then decode as CP932.

2. Filenames: RAR4/ZIP entries store raw CP932 bytes with no Unicode flag.
   The extractor (7-Zip) decodes them with the system codepage (GBK/936 on
   this machine, CP437 on Western systems), producing garbage-but-reversible
   names on disk.

Repair strategy: round-trip through candidate (wrong, right) codec pairs and
accept a candidate only when it *clearly* looks more Japanese than the input
(kana gain is the strongest signal — GBK-mojibake of Japanese text contains
rare hanzi and essentially no kana).
"""

from __future__ import annotations

from dataclasses import dataclass

# Chains safe for tag text: legit CJK text cannot survive .encode("latin-1")
# so these only ever fire on Latin-1-range mojibake.
TAG_CHAINS: tuple[tuple[str, str], ...] = (
    ("latin-1", "cp932"),
    ("cp437", "cp932"),
)

# Filename repair additionally tries the GBK chain (7-Zip on an ACP=936
# system decodes non-Unicode CP932 names as GBK).
NAME_CHAINS: tuple[tuple[str, str], ...] = TAG_CHAINS + (
    ("gbk", "cp932"),
    ("cp850", "cp932"),
)


def kana_count(s: str) -> int:
    return sum(1 for ch in s if 0x3040 <= ord(ch) <= 0x30FF)


def japanese_score(s: str) -> int:
    """Heuristic: positive = looks like healthy Japanese/ASCII text,
    negative = looks like mojibake garbage."""
    score = 0
    for ch in s:
        o = ord(ch)
        if 0x3040 <= o <= 0x30FF:          # hiragana / katakana
            score += 3
        elif ch in "・〜ー「」『』（）　！？":
            score += 2
        elif 0x4E00 <= o <= 0x9FFF:        # CJK ideographs
            score += 1
        elif 0xFF01 <= o <= 0xFF60:        # fullwidth forms
            score += 1
        elif ch == "�":               # replacement char
            score -= 10
        elif 0xE000 <= o <= 0xF8FF:        # private use area
            score -= 4
        elif 0x2500 <= o <= 0x25FF:        # box drawing (CP437 mojibake)
            score -= 4
        elif 0x0370 <= o <= 0x04FF:        # Greek/Cyrillic (OEM mojibake)
            score -= 3
        elif 0x00A0 <= o <= 0x036F:        # Latin-1 supplement garbage ¤Î¥
            score -= 2
        elif 0xFF61 <= o <= 0xFF9F:        # halfwidth katakana — suspicious
            score -= 1
    return score


def repair_text(s: str, chains: tuple[tuple[str, str], ...] = TAG_CHAINS,
                min_gain: int = 3) -> str:
    """Return repaired string, or the input unchanged if no candidate wins.

    Acceptance rules (conservative — false negatives over false positives):
      - candidate must round-trip losslessly through (wrong_enc -> right_enc)
      - candidate must gain kana where the input had none, OR beat the
        input's japanese_score by at least ``min_gain``.
    """
    if not s or s.isascii():
        return s
    in_score = japanese_score(s)
    in_kana = kana_count(s)
    best, best_score = s, in_score
    for wrong, right in chains:
        try:
            cand = s.encode(wrong).decode(right)
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if cand == s or "�" in cand:
            continue
        c_score = japanese_score(cand)
        kana_gain = in_kana == 0 and kana_count(cand) >= 2
        if (kana_gain and c_score > in_score) or c_score >= in_score + min_gain:
            if c_score > best_score:
                best, best_score = cand, c_score
    return best


@dataclass
class NameFix:
    old: str
    new: str


def repair_name(s: str) -> str:
    return repair_text(s, chains=NAME_CHAINS)
