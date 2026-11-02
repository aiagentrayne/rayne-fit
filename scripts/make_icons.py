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


def _bezier(p0, p1, p2, p3, n=24):
    pts = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3
        pts.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return pts


def hardhat(d, cx, bottom, w):
    """Draws the hardhat (same shape as the web Wordmark's 68x44 SVG) with its brim
    resting on y=bottom, centred on cx, w wide."""
    u = w / 68
    x0, y0 = cx - w / 2, bottom - 44 * u
    P = lambda x, y: (x0 + x * u, y0 + y * u)
    dome = _bezier(P(8, 37), P(8, 16), P(20, 3), P(34, 3)) + _bezier(P(34, 3), P(48, 3), P(60, 16), P(60, 37))[1:]
    d.polygon(dome, fill=YELLOW)
    d.rounded_rectangle([*P(1, 34), *P(67, 44)], radius=3 * u, fill=YELLOW)
    shade = tuple(round(0.45 * a + 0.55 * b) for a, b in zip(YELLOW, YELLOW_DARK))
    d.rounded_rectangle([*P(1, 34), *P(67, 36.5)], radius=1.25 * u, fill=shade)
    ridge = max(1, round(3 * u))
    for x, top in ((25, 9), (34, 6), (43, 9)):
        d.line([P(x, top), P(x, 29)], fill=YELLOW_DARK, width=ridge)
        for y in (top, 29):
            cxp, cyp = P(x, y)
            d.ellipse([cxp - ridge / 2, cyp - ridge / 2, cxp + ridge / 2, cyp + ridge / 2], fill=YELLOW_DARK)


SS = 4  # draw at 4x and downsample for smooth edges


def mark(size, bg=CHARCOAL, fg=WHITE, padding=0.0, rounded=True):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.22, fill=bg)
    else:
        d.rectangle([0, 0, big, big], fill=bg)
    s = big * (1 - 2 * padding)
    ox = big * padding
    cx = big / 2
    f = font(int(s * 0.56))
    bbox = d.textbbox((0, 0), "R", font=f)
    rw, rh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    # The hat rests on the R (as in the brand guide's social icon): about 75% of the
    # R's width, centred on it, with the brim slightly overlapping its top edge.
    hat_w = rw * 0.75
    hat_h = hat_w * 44 / 68
    overlap = s * 0.008
    ff = font(int(s * 0.13))
    fb = d.textbbox((0, 0), "FIT", font=ff)
    fit_gap = s * 0.07
    group_h = hat_h - overlap + rh + fit_gap + (fb[3] - fb[1])
    hat_top = ox + (s - group_h) / 2
    r_top = hat_top + hat_h - overlap
    d.text((cx - rw / 2 - bbox[0], r_top - bbox[1]), "R", font=f, fill=fg)
    hardhat(d, cx, r_top + overlap, hat_w)
    fit_y = r_top + rh + fit_gap
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
    return img.resize((size, size), Image.LANCZOS)


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
