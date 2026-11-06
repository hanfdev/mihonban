"""Subset the pinned semibold fallback without shipping a second CJK family."""
import argparse
import hashlib
from pathlib import Path
import tempfile
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont

REVISION = "030cd4fa3dd6b0607c5e7f35f13977a2e0a10522"
SHA256 = "812bf95684fd3a9d486ff9531c86ab7841a8d31d22046cf2487d45a877486a1c"
URL = f"https://raw.githubusercontent.com/ButTaiwan/genryu-font/{REVISION}/otf/PJP/GenRyuMin2PJP-SB.otf"


def prepare(root, source=None):
    if source is None:
        source = Path(tempfile.gettempdir()) / "mihonban-GenRyuMin2PJP-SB.otf"
        if not source.exists() or hashlib.sha256(source.read_bytes()).hexdigest() != SHA256:
            with urllib.request.urlopen(URL, timeout=60) as response:
                source.write_bytes(response.read())
    if hashlib.sha256(source.read_bytes()).hexdigest() != SHA256:
        raise ValueError("Unexpected fallback font source")
    # Retain the existing language coverage, including dynamic song metadata.
    coverage = TTFont(root / "cloud/web/public/fonts/genryu-mincho-shippori-fallback.woff2").getBestCmap()
    font = TTFont(source, recalcTimestamp=False)
    options = subset.Options()
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.name_legacy = True
    options.name_languages = [0x409]
    worker = subset.Subsetter(options=options)
    worker.populate(unicodes=coverage)
    worker.subset(font)
    assert font['OS/2'].usWeightClass == 600
    assert set(coverage) <= set(font.getBestCmap())
    output = root / "ios/Resources/GenRyuMincho-Fallback.ttf"
    font.save(output)
    print(f"Semibold fallback: {len(coverage)} code points, {output.stat().st_size} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("repository", type=Path)
    parser.add_argument("--source", type=Path)
    args = parser.parse_args()
    prepare(args.repository.resolve(), args.source)
