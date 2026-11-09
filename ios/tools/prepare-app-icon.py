"""Build the approved iOS record icon and its system appearance variants.

The square source has no baked-in outer mask. Asset Catalog supplies system
rounding; the tinted variant is grayscale so the user's chosen tint stays clean.
"""
import json
from pathlib import Path
from math import hypot, exp
from PIL import Image, ImageDraw, ImageFilter

SIZE = 768
STYLE = {'bg1': (39, 40, 38), 'bg2': (10, 11, 12), 'disc': (22, 23, 23),
         'rim': (145, 145, 132), 'label': (235, 229, 208), 'badge': (238, 83, 49)}

def mix(a, b, t):
    t = max(0, min(1, t))
    return tuple(round(a[i] * (1-t) + b[i] * t) for i in range(3))

def icon(s):
    n = SIZE
    pixels = []
    for y in range(n):
        v = y / (n-1)
        for x in range(n):
            u = x / (n-1)
            r = hypot(u-.5, v-.5)
            color = mix(s['bg1'], s['bg2'], .18*u+.82*v)
            glow = exp(-((u-.19)**2+(v-.12)**2)/.09)
            color = mix(color, (255, 252, 237), glow*.10)
            shadow = exp(-((r-.328)/.023)**2) * max(0, v-.37)*.9
            color = mix(color, (0, 0, 0), shadow*.7)
            if r < .324:
                color = s['disc']
                sheen = exp(-((u-.32)**2+(v-.24)**2)/.037)
                color = mix(color, (213, 212, 192), sheen*.12)
                rim = exp(-((r-.317)/.0045)**2)
                light = .35+.65*max(0, (.5-u)*1.4+(.5-v)*1.6)
                color = mix(color, s['rim'], rim*light)
                for radius, strength in [(.285,.12),(.25,.21),(.218,.08)]:
                    color = mix(color, s['rim'], exp(-((r-radius)/.0013)**2)*strength)
                highlight = exp(-((u-v+.08)/.11)**2) * max(0, (.5-v)*2)
                color = mix(color, (245, 247, 235), highlight*.045)
            if r < .125:
                color = mix(s['label'], tuple(max(0,c-19) for c in s['label']), .2+.5*v)
                color = mix(color,(255,253,238),exp(-((r-.122)/.003)**2)*max(0,(.5-v)*3))
            if r < .031:
                color = mix((9, 11, 11), (31, 33, 32), v)
            pixels.append(color)
    im = Image.new('RGB', (n,n)); im.putdata(pixels); im = im.convert('RGBA')
    badge = Image.new('RGBA',(round(n*.23),round(n*.14)))
    d = ImageDraw.Draw(badge)
    box=(n*.022,n*.028,n*.198,n*.104)
    d.rounded_rectangle(box,radius=n*.020,fill=(*s['badge'],255))
    d.line((n*.042,n*.031,n*.174,n*.031),fill=(255,199,157,130),width=2)
    d.line((n*.066,n*.063,n*.151,n*.063),fill=(255,244,219,255),width=round(n*.009))
    badge=badge.rotate(13,resample=Image.Resampling.BICUBIC,expand=True)
    bx,by=round(n*.478),round(n*.324)
    shadow=Image.new('RGBA',im.size)
    alpha=badge.getchannel('A').filter(ImageFilter.GaussianBlur(n*.008))
    shadow.paste((0,0,0,100),(bx,by+round(n*.008),bx+badge.width,by+round(n*.008)+badge.height),alpha)
    im=Image.alpha_composite(im,shadow);im.alpha_composite(badge,(bx,by))
    return im


def prepare_logo(root: Path):
    # Reuse the approved native icon at the startup mark's maximum 3x size.
    icons = root / "ios/Resources/Assets.xcassets/AppIcon.appiconset"
    folder = root / "ios/Resources/Assets.xcassets/Logo.imageset"
    folder.mkdir(parents=True, exist_ok=True)
    images = []
    for appearance, source, filename in [(None, "AppIcon.png", "logo.png"),
                                         ("dark", "AppIcon-dark.png", "logo-dark.png")]:
        with Image.open(icons / source) as image:
            image.convert("RGB").resize((312, 312), Image.Resampling.LANCZOS).save(folder / filename, optimize=True)
        entry = {"filename": filename, "idiom": "universal"}
        if appearance:
            entry["appearances"] = [{"appearance": "luminosity", "value": appearance}]
        images.append(entry)
    (folder / "Contents.json").write_text(json.dumps({"images": images,
        "info": {"author": "xcode", "version": 1}}, indent=2) + "\n", encoding="utf-8")


def prepare(root: Path):
    folder = root / "ios/Resources/Assets.xcassets/AppIcon.appiconset"
    folder.mkdir(parents=True, exist_ok=True)
    normal = icon(STYLE).convert("RGB")
    dark = normal.copy()
    pixels = list(dark.getdata())
    for y in range(SIZE):
        for x in range(SIZE):
            distance = hypot(x / (SIZE-1) - .5, y / (SIZE-1) - .5)
            # Keep the foreground intact while the dark canvas recedes.
            shade = min(1, max(0, (distance - .33) / .07)) * .22
            i = y * SIZE + x
            pixels[i] = tuple(round(c * (1-shade)) for c in pixels[i])
    dark.putdata(pixels)
    tinted = normal.convert("L")
    # Preserve a neutral luminance map for the system's selected tint.
    tinted = tinted.point(lambda value: min(255, round(value * 1.08))).convert("RGB")
    images = []
    for appearance, filename, image in [(None, "AppIcon.png", normal),
                                       ("dark", "AppIcon-dark.png", dark),
                                       ("tinted", "AppIcon-tinted.png", tinted)]:
        image.resize((1024, 1024), Image.Resampling.LANCZOS).save(folder / filename, optimize=True)
        entry = {"filename": filename, "idiom": "universal", "platform": "ios", "size": "1024x1024"}
        if appearance:
            entry["appearances"] = [{"appearance": "luminosity", "value": appearance}]
        images.append(entry)
    (folder / "Contents.json").write_text(json.dumps({"images": images,
        "info": {"author": "xcode", "version": 1}}, indent=2) + "\n", encoding="utf-8")
    prepare_logo(root)


if __name__ == "__main__":
    prepare(Path(__file__).resolve().parents[2])
