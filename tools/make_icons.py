"""Generate the app's icons: a rising line that levels off ("coasting") over a
dotted target line, ivory on ink (the v2 palette).

Run from the project root:  python tools/make_icons.py
Writes icons/icon-192.png, icons/icon-512.png, icons/icon-512-maskable.png,
icons/apple-touch-icon.png and icons/icon.svg.
"""
from pathlib import Path

from PIL import Image, ImageDraw

GREEN = (29, 28, 26, 255)  # ink #1d1c1a (name kept from v1)
WHITE = (246, 243, 236, 255)  # ivory #f6f3ec
GOLD = (157, 184, 242, 255)  # light cobalt #9db8f2
OUT = Path(__file__).resolve().parent.parent / "icons"
SCALE = 4  # draw big, then shrink, for smooth edges

# The drawing, in a 100x100 box: a curve rising to meet a dotted target line.
# Growth that bends over and levels off on the target: an ease-out curve.
TARGET_Y = 28
CURVE = [(round(18 + 64 * t, 2), round(74 - 46 * (1 - (1 - t) ** 2.2), 2))
         for t in (i / 40 for i in range(41))]


def draw_icon(size: int, maskable: bool, apple: bool = False) -> Image.Image:
    s = size * SCALE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if apple:
        # iOS masks the icon itself and fills transparency with black, so the
        # apple-touch-icon is a full square with no transparent corners.
        d.rectangle([0, 0, s, s], fill=GREEN)
        k, off = 0.74, 0.13
    elif maskable:
        # Android crops maskable icons to its own shape: fill edge to edge and
        # keep the drawing inside the central safe zone.
        d.rectangle([0, 0, s, s], fill=GREEN)
        k, off = 0.62, 0.19
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.22, fill=GREEN)
        k, off = 0.86, 0.07

    def pt(x, y):
        return (s * (off + k * x / 100), s * (off + k * y / 100))

    # Dotted target line.
    w = max(2, round(s * k * 0.035))
    x = 14.0
    while x < 74:
        a, b = pt(x, TARGET_Y), pt(min(x + 4, 74), TARGET_Y)
        d.line([a, b], fill=GOLD, width=w)
        x += 8
    # Rising curve, with a dot where it reaches the target.
    lw = max(3, round(s * k * 0.075))
    pts = [pt(px, py) for px, py in CURVE]
    d.line(pts, fill=WHITE, width=lw, joint="curve")
    for p in (pts[0], pts[-1]):
        r = lw / 2
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=WHITE)
    cx, cy = pts[-1]
    r = s * k * 0.08
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


def svg() -> str:
    path = " ".join(("M" if i == 0 else "L") + f"{x},{y}" for i, (x, y) in enumerate(CURVE))
    k, off = 0.86, 7
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#1d1c1a"/>
<g transform="translate({off} {off}) scale({k})">
<line x1="14" y1="{TARGET_Y}" x2="74" y2="{TARGET_Y}" stroke="#9db8f2" stroke-width="3.5" stroke-dasharray="4 4"/>
<path d="{path}" fill="none" stroke="#f6f3ec" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="{CURVE[-1][0]}" cy="{CURVE[-1][1]}" r="8" fill="#f6f3ec"/>
</g>
</svg>
'''


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    draw_icon(192, maskable=False).save(OUT / "icon-192.png")
    draw_icon(512, maskable=False).save(OUT / "icon-512.png")
    draw_icon(512, maskable=True).save(OUT / "icon-512-maskable.png")
    draw_icon(180, maskable=False, apple=True).convert("RGB").save(OUT / "apple-touch-icon.png")
    (OUT / "icon.svg").write_text(svg(), encoding="utf-8")
    print(f"Wrote icons to {OUT}")
