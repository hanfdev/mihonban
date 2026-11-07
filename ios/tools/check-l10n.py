"""Fail when a localization key referenced by the iOS sources is missing.

The catalog is exported from the web locales, so a key renamed or removed on
the web side silently falls back to the raw key on iOS. This gate scans every
string literal that looks like a catalog key and requires it in all languages.
Keys built at runtime (sort labels) are covered by ContractTests instead.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Literals in these positions are identifiers or file names, not catalog keys.
# SwiftUI modifiers and UIKit identifier assignments are not localized text.
NOT_KEYS = re.compile(r'(?:\b(?:accessibilityIdentifier|appendingPathComponent|forResource)\(\s*|\baccessibilityIdentifier\s*=\s*)$')
LANGUAGES = ["en", "ja", "ko", "fr", "es", "zh-Hans", "zh-Hant"]
# Only literals under catalog namespaces count, which skips identifiers such as "track.<id>".
LITERAL = re.compile(r'"([a-z][A-Za-z0-9]*\.[A-Za-z0-9.]+)"')


def main() -> int:
    catalogs = json.loads((ROOT / "Resources/Localizations.json").read_text(encoding="utf-8"))
    missing_languages = [language for language in LANGUAGES if language not in catalogs]
    if missing_languages:
        print(f"missing catalogs: {missing_languages}")
        return 1
    english = catalogs["en"]
    namespaces = {key.split(".", 1)[0] for key in english}
    problems = []
    for source in sorted((ROOT / "Sources").rglob("*.swift")):
        text = source.read_text(encoding="utf-8")
        for match in LITERAL.finditer(text):
            key = match.group(1)
            if key.split(".", 1)[0] not in namespaces or key.endswith("."):
                continue
            before = text[text.rfind("\n", 0, match.start()) + 1:match.start()]
            after = text[match.end():match.end() + 3]
            # A literal followed by "+" is a prefix for a runtime key (checked in ContractTests).
            if NOT_KEYS.search(before) or after.lstrip().startswith("+"):
                continue
            line = text.count("\n", 0, match.start()) + 1
            absent = [language for language in LANGUAGES if not catalogs[language].get(key)]
            if absent:
                problems.append(f"{source.relative_to(ROOT)}:{line}: {key} missing in {', '.join(absent)}")
    for language in LANGUAGES[1:]:
        extra = set(catalogs[language]) - set(english)
        if extra:
            problems.append(f"{language} has keys absent from en: {sorted(extra)[:10]}")
    for problem in problems:
        print(problem)
    print(f"checked {len(LANGUAGES)} catalogs, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
