"""Render the app icon (frontend/public/favicon.svg) to the PNG sizes browsers
and home screens ask for. Needs `pip install resvg_py pillow`."""

from __future__ import annotations

import io
from pathlib import Path

import resvg_py
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "frontend" / "public"
SVG = (PUBLIC / "favicon.svg").read_text(encoding="utf-8")


def render(size: int) -> Image.Image:
    data = resvg_py.svg_to_bytes(svg_string=SVG, width=size, height=size)
    return Image.open(io.BytesIO(bytes(data))).convert("RGBA")


def main() -> None:
    for name, size in (("icon-32.png", 32), ("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)):
        render(size).save(PUBLIC / name, optimize=True)
    # Maskable: the artwork inside the 80 % safe zone on the brand background.
    base = Image.new("RGBA", (512, 512), (13, 44, 29, 255))
    art = render(410)
    base.alpha_composite(art, (51, 51))
    base.save(PUBLIC / "icon-maskable-512.png", optimize=True)
    render(256).save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("ikony hotové:", sorted(p.name for p in PUBLIC.glob("*.png")))


if __name__ == "__main__":
    main()
