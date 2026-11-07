import argparse
import json
from pathlib import Path
from PIL import Image
import runpy

parser = argparse.ArgumentParser()
parser.add_argument("repository", type=Path)
args = parser.parse_args()
root = args.repository.resolve()
resources = root / "ios" / "Resources"
runpy.run_path(str(Path(__file__).with_name("prepare-app-icon.py")))["prepare"](root)

# The in-app brand mark is the project logo used by the web client, so the
# connection screen shows the same record sleeve the site does.
logo_set = resources / "Assets.xcassets" / "Logo.imageset"
logo_set.mkdir(parents=True, exist_ok=True)
logo = Image.open(root / "cloud/web/public/icon-512.png").convert("RGBA").resize((512, 512), Image.Resampling.LANCZOS)
logo.save(logo_set / "logo.png")
(logo_set / "Contents.json").write_text(json.dumps({"images": [{"filename": "logo.png", "idiom": "universal"}], "info": {"author": "xcode", "version": 1}}, indent=2) + "\n")

runpy.run_path(str(Path(__file__).with_name("prepare-display-font.py")))["prepare"](root)
print("Generated iOS icon, logo, and fallback font")
