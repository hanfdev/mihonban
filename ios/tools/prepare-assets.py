import argparse
from pathlib import Path
import runpy

parser = argparse.ArgumentParser()
parser.add_argument("repository", type=Path)
args = parser.parse_args()
root = args.repository.resolve()
runpy.run_path(str(Path(__file__).with_name("prepare-app-icon.py")))["prepare"](root)

runpy.run_path(str(Path(__file__).with_name("prepare-display-font.py")))["prepare"](root)
print("Generated iOS icon, logo, and fallback font")
