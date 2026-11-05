import argparse
import json
from pathlib import Path
from PIL import Image
from fontTools.ttLib import TTFont

parser = argparse.ArgumentParser()
parser.add_argument("repository", type=Path)
args = parser.parse_args()
root = args.repository.resolve()
resources = root / "ios" / "Resources"
icons = resources / "Assets.xcassets" / "AppIcon.appiconset"
icons.mkdir(parents=True, exist_ok=True)

icon = Image.open(root / "cloud/web/public/icon-maskable-512.png").convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)
icon.save(icons / "AppIcon.png")
(icons / "Contents.json").write_text(json.dumps({"images": [{"filename": "AppIcon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}], "info": {"author": "xcode", "version": 1}}, indent=2) + "\n")

# The in-app brand mark is the project logo used by the web client, so the
# connection screen shows the same record sleeve the site does.
logo_set = resources / "Assets.xcassets" / "Logo.imageset"
logo_set.mkdir(parents=True, exist_ok=True)
logo = Image.open(root / "cloud/web/public/icon-512.png").convert("RGBA").resize((512, 512), Image.Resampling.LANCZOS)
logo.save(logo_set / "logo.png")
(logo_set / "Contents.json").write_text(json.dumps({"images": [{"filename": "logo.png", "idiom": "universal"}], "info": {"author": "xcode", "version": 1}}, indent=2) + "\n")

# The fallback matches the semibold display face; regular glyphs looked too
# light inside headings such as the simplified Chinese playback queue label.
font = TTFont(root / "cloud/web/public/fonts/genryu-mincho-shippori-fallback-bold.woff2")
font.flavor = None
font.save(resources / "GenRyuMincho-Fallback.ttf")
print("Generated iOS icon, logo, and fallback font")
