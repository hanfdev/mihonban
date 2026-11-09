import argparse
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("checkouts", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
sections = ["Mihonban iOS — third-party notices\n\n"
            "SFBAudioEngine includes a small FLAC decoder fix: a terminal read abort exits decoding instead of "
            "looping without producing frames. The exact revision, source verification and patch are recorded in "
            "ios/tools/apply-audio-engine-fixes.py in the Mihonban source repository. "
            "Its codec dependencies are unmodified. Some optional codecs are LGPL-licensed. "
            "Dependency versions are recorded in Package.resolved; source is available at each package's "
            "GitHub URL. The CI build also provides application object files for relinking with modified libraries.\n"]
for package in sorted(args.checkouts.iterdir()):
    if not package.is_dir():
        continue
    sections.append(f"\n{'=' * 60}\n{package.name}\nhttps://github.com/sbooth/{package.name}\n")
    for file in sorted(package.rglob("*")):
        if not file.is_file() or ".git" in file.parts or file.stat().st_size > 200000:
            continue
        name = file.name.lower()
        if name.startswith(("license", "copying", "copyright")) or "LICENSES" in file.parts:
            try:
                sections.append(f"\n{file.relative_to(package)}\n\n{file.read_text(encoding='utf-8')}\n")
            except UnicodeDecodeError:
                pass
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text("\n".join(sections), encoding="utf-8")
