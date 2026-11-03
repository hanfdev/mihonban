import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw
from fontTools.ttLib import TTFont

parser = argparse.ArgumentParser()
parser.add_argument("repository", type=Path)
args = parser.parse_args()
root = args.repository.resolve()
resources = root / "ios" / "Resources"
icons = resources / "Assets.xcassets" / "AppIcon.appiconset"
icons.mkdir(parents=True, exist_ok=True)
image = Image.open(root / "cloud/web/public/icon-maskable-512.png").convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)
image.save(icons / "AppIcon.png")
(icons / "Contents.json").write_text(json.dumps({"images": [{"filename": "AppIcon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}], "info": {"author": "xcode", "version": 1}}, indent=2) + "\n")
font = TTFont(root / "cloud/web/public/fonts/genryu-mincho-shippori-fallback.woff2")
font.flavor = None
font.save(resources / "GenRyuMincho-Fallback.ttf")
print("Generated iOS icon and fallback font")
