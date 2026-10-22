"""Generates the Rayne Fit PWA icons (dark "R + hardhat + FIT" mark) into public/icons.

Usage: python3 scripts/make_icons.py   (needs Pillow and a heavy sans font; see FONT_CANDIDATES)
"""
import os
from PIL import Image, ImageDraw, ImageFont

CHARCOAL = (26, 26, 26)
WHITE = (255, 255, 255)
LIME = (217, 255, 0)
YELLOW = (255, 195, 0)
YELLOW_DARK = (214, 150, 0)
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/inter/InterDisplay-Black.otf",
    "/usr/share/fonts/opentype/inter/Inter-Black.otf",
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
]


def font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    raise SystemExit("No heavy font found; edit FONT_CANDIDATES")


def hardhat(d, cx, top, w):
    """Draws a hardhat of width w whose dome top is at y=top."""
    h = w * 0.62
    dome = [cx - w * 0.40, top, cx + w * 0.40, top + h * 1.5]
    d.pieslice(dome, 180, 360, fill=YELLOW)
    brim_y = top + h * 0.75
    d.rounded_rectangle([cx - w * 0.5, brim_y - w * 0.04, cx + w * 0.5, brim_y + w * 0.09], radius=w * 0.05, fill=YELLOW)
    ridge = max(2, int(w * 0.035))
    for dx in (-0.12, 0.0, 0.12):
        x = cx + dx * w
        d.line([x, top + h * 0.10, x, brim_y - w * 0.05], fill=YELLOW_DARK, width=ridge)


def mark(size, bg=CHARCOAL, fg=WHITE, padding=0.0, rounded=True):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size * 0.22, fill=bg)
    else:
        d.rectangle([0, 0, size, size], fill=bg)
    s = size * (1 - 2 * padding)
    ox = size * padding
    cx = size / 2
    f = font(int(s * 0.56))
    bbox = d.textbbox((0, 0), "R", font=f)
    rw, rh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    r_top = ox + s * 0.27
    d.text((cx - rw / 2 - bbox[0], r_top - bbox[1]), "R", font=f, fill=fg)
    hardhat(d, cx + s * 0.02, ox + s * 0.10, s * 0.34)
    ff = font(int(s * 0.13))
    fb = d.textbbox((0, 0), "FIT", font=ff)
    fw = fb[2] - fb[0]
    fit_y = r_top + rh + s * 0.07
    spacing = s * 0.035
    letters = "FIT"
    total = sum(d.textbbox((0, 0), c, font=ff)[2] - d.textbbox((0, 0), c, font=ff)[0] for c in letters) + spacing * 2
    x = cx - total / 2
    for c in letters:
        cb = d.textbbox((0, 0), c, font=ff)
        d.text((x - cb[0], fit_y - fb[1]), c, font=ff, fill=LIME)
        x += cb[2] - cb[0] + spacing
    line_y = fit_y + (fb[3] - fb[1]) / 2
    lw = max(2, int(s * 0.022))
    gap = s * 0.04
    d.line([ox + s * 0.12, line_y, cx - total / 2 - gap, line_y], fill=LIME, width=lw)
    d.line([cx + total / 2 + gap, line_y, ox + s * 0.88, line_y], fill=LIME, width=lw)
    _ = fw
    return img


def badge(size):
    """Monochrome status-bar badge (Android): white hardhat + R on transparent."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(int(size * 0.7))
    b = d.textbbox((0, 0), "R", font=f)
    d.text(((size - (b[2] - b[0])) / 2 - b[0], size * 0.24 - b[1]), "R", font=f, fill=WHITE)
    return img


os.makedirs(OUT, exist_ok=True)
mark(512).save(f"{OUT}/icon-512.png")
mark(192).save(f"{OUT}/icon-192.png")
# Maskable: full-bleed background, artwork inside the 80% safe zone
mark(512, padding=0.1, rounded=False).save(f"{OUT}/maskable-512.png")
mark(192, padding=0.1, rounded=False).save(f"{OUT}/maskable-192.png")
# iOS ignores transparency and applies its own corner mask
mark(180, rounded=False).convert("RGB").save(f"{OUT}/apple-touch-icon.png")
mark(64).save(f"{OUT}/favicon-64.png")
mark(32).save(f"{OUT}/favicon-32.png")
badge(96).save(f"{OUT}/badge-96.png")
mark(1024, rounded=False).convert("RGB").save(f"{OUT}/icon-1024.png")
print("icons written to", os.path.abspath(OUT))
