from pathlib import Path
import urllib.parse
import urllib.request

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SOURCES = ROOT / "target" / "font-sources"
BASE_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl"


def download(family, filename, destination):
    if not destination.exists():
        url = f"{BASE_URL}/{family}/{urllib.parse.quote(filename)}"
        with urllib.request.urlopen(url, timeout=60) as response:
            destination.write_bytes(response.read())


def static_font(family, source_name, output_name, axes):
    source = SOURCES / source_name
    download(family, source_name, source)
    font = TTFont(source)
    font = instantiateVariableFont(font, axes, inplace=True)
    font.save(ASSETS / output_name)


def main():
    ASSETS.mkdir(exist_ok=True)
    SOURCES.mkdir(parents=True, exist_ok=True)
    for family, prefix in [
        ("shipporimincho", "ShipporiMincho"),
        ("inter", "Inter"),
        ("notosanssc", "NotoSansSC"),
        ("notoserifsc", "NotoSerifSC"),
        ("notosanskr", "NotoSansKR"),
        ("notoserifkr", "NotoSerifKR"),
    ]:
        download(family, "OFL.txt", ASSETS / f"{prefix}-OFL.txt")
    for weight in ["SemiBold", "Bold"]:
        filename = f"ShipporiMincho-{weight}.ttf"
        download("shipporimincho", filename, ASSETS / filename)
    static_font("inter", "Inter[opsz,wght].ttf", "Inter-Regular.ttf", {"opsz": 14, "wght": 400})
    static_font("inter", "Inter[opsz,wght].ttf", "Inter-SemiBold.ttf", {"opsz": 14, "wght": 600})
    static_font("notosanssc", "NotoSansSC[wght].ttf", "NotoSansSC-Regular.ttf", {"wght": 400})
    static_font("notoserifsc", "NotoSerifSC[wght].ttf", "NotoSerifSC-SemiBold.ttf", {"wght": 600})
    static_font("notosanskr", "NotoSansKR[wght].ttf", "NotoSansKR-Regular.ttf", {"wght": 400})
    static_font("notoserifkr", "NotoSerifKR[wght].ttf", "NotoSerifKR-SemiBold.ttf", {"wght": 600})


if __name__ == "__main__":
    main()
