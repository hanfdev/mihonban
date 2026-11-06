"""Check bundled display-font coverage without installing build dependencies."""
import json
import re
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]


def characters(path):
    data = path.read_bytes()
    u16 = lambda offset: struct.unpack_from(">H", data, offset)[0]
    u32 = lambda offset: struct.unpack_from(">I", data, offset)[0]
    tables = {data[12 + i * 16:16 + i * 16]: u32(20 + i * 16) for i in range(u16(4))}
    cmap = tables[b"cmap"]
    result = set()
    for i in range(u16(cmap + 2)):
        record = cmap + 4 + i * 8
        platform, encoding = u16(record), u16(record + 2)
        if platform != 0 and not (platform == 3 and encoding in (1, 10)):
            continue
        start = cmap + u32(record + 4)
        if u16(start) == 12:
            for j in range(u32(start + 12)):
                first, last, glyph = struct.unpack_from(">III", data, start + 16 + j * 12)
                result.update(range(first + (glyph == 0), last + 1))
        elif u16(start) == 4:
            count = u16(start + 6) // 2
            ends = start + 14
            starts = ends + count * 2 + 2
            deltas = starts + count * 2
            offsets = deltas + count * 2
            for j in range(count):
                offset = u16(offsets + j * 2)
                for code in range(u16(starts + j * 2), u16(ends + j * 2) + 1):
                    if code == 0xFFFF:
                        continue
                    glyph = u16(offsets + j * 2 + offset + 2 * (code - u16(starts + j * 2))) if offset else code
                    if glyph or not offset:
                        glyph = (glyph + u16(deltas + j * 2)) & 0xFFFF
                    if glyph:
                        result.add(code)
    return result


def main():
    available = characters(ROOT / "desktop/assets/ShipporiMincho-SemiBold.ttf")
    available |= characters(ROOT / "ios/Resources/GenRyuMincho-Fallback.ttf")
    catalogs = json.loads((ROOT / "ios/Resources/Localizations.json").read_text(encoding="utf-8"))
    failures = []
    for path in [ROOT / "desktop/assets/ShipporiMincho-SemiBold.ttf", ROOT / "ios/Resources/GenRyuMincho-Fallback.ttf"]:
        data = path.read_bytes()
        count = struct.unpack_from(">H", data, 4)[0]
        tables = {data[12 + i * 16:16 + i * 16]: struct.unpack_from(">I", data, 20 + i * 16)[0] for i in range(count)}
        weight = struct.unpack_from(">H", data, tables[b"OS/2"] + 4)[0]
        if weight != 600:
            failures.append(f"{path.name}: expected semibold 600, got {weight}")
    for language, catalog in catalogs.items():
        required = {ord(c) for text in catalog.values() for c in text if not c.isspace()}
        missing = required - available
        if missing:
            failures.append(f"{language}: " + ", ".join(f"U+{code:04X}" for code in sorted(missing)))
    # Display headings must use the central cascade; raw custom-font calls
    # silently reintroduce per-glyph system fallback.
    for source in (ROOT / "ios/Sources").rglob("*.swift"):
        code = source.read_text(encoding="utf-8")
        if source.name != "Typography.swift" and "ShipporiMincho-SemiBold" in code:
            failures.append(f"{source.name}: use Typography/displayFont for display text")
        if re.search(r"\.font\(\.(?:body|callout|subheadline|footnote|caption2?|headline)\b", code):
            failures.append(f"{source.name}: use Theme.body for app text")
    for failure in failures:
        print(failure)
    print(f"Checked {len(catalogs)} languages and display font usage; {len(failures)} problems")
    return bool(failures)


if __name__ == "__main__":
    raise SystemExit(main())
