"""Nafotí obrazovky aplikace do `docs/screenshots` pro README.

Spouští se proti běžící aplikaci:  python scripts/screenshots.py
Potřebuje Chrome (proměnná CHROME) a Pillow.

Vynucené `prefers-reduced-motion` je tu kvůli spolehlivosti: aplikace na něj
reaguje tím, že zkrátí nájezdové animace na nulu, takže snímek nepadne
doprostřed prolnutí a karty na něm nejsou poloprůhledné. Výjimkou je úvodní
stránka — tam animace naopak potřebujeme, aby maskot doskákal na místo tečky.

Fotí se na dvojnásobek a zmenšuje zpátky: text je pak ostrý i po zmenšení.
"""
import os
import pathlib
import subprocess
import sys

# Cesta k prohlížeči i adresa aplikace jdou přebít proměnnou prostředí,
# aby skript nebyl přivázaný k jednomu počítači.
CHROME = os.environ.get("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
OUT = pathlib.Path(__file__).resolve().parents[1] / "docs" / "screenshots"
BASE = os.environ.get("KAM_URL", "http://localhost:8000")

# (soubor, cesta, šířka, výška, nechat běžet animace)
SCENAR_URL = (
    "/scenare?t=obec:574121&iv=W3sidHlwZSI6ImJ5dHkiLCJwYXJhbXMiOnsicG9jZXQiOjMwMCwicm9rIjoy"
    "MDI4LCJ0eXAiOiJieXRvdmVfZG9teSJ9fSx7InR5cGUiOiJ6c19taXN0YSIsInBhcmFtcyI6eyJwb2NldCI6MTIwLCJyb2siOjIwMjl9fV0="
)
ZABERY: list[tuple[str, str, int, int, bool]] = [
    ("uvod", "/", 1440, 900, True),
    ("prehled", "/prehled", 1440, 980, False),
    ("mapa-3d", "/mapa?view=khk&3d=1&ind=d_podil_65", 1440, 1000, False),
    ("obce", "/obce", 1440, 760, False),
    ("profil", "/obce/obec:569810", 1440, 1080, False),
    ("scenare", SCENAR_URL, 1440, 1180, False),
    ("hospodareni", "/hospodareni?t=obec:569810", 1440, 980, False),
    ("dotace", "/dotace?t=obec:573868", 1440, 980, False),
    ("vyhled", "/vyhled?t=kraj:86", 1440, 980, False),
    ("podnety", "/podnety", 1440, 900, False),
    ("data", "/data", 1440, 980, False),
    ("statistiky", "/statistiky", 1440, 900, False),
]


def snap(jmeno: str, cesta: str, w: int, h: int, pohyb: bool) -> pathlib.Path:
    cil = OUT / f"{jmeno}.png"
    args = [
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=2", f"--window-size={w},{h}",
        "--virtual-time-budget=" + ("20000" if pohyb else "12000"),
        "--run-all-compositor-stages-before-draw",
    ]
    if not pohyb:
        args.append("--force-prefers-reduced-motion")
    args += [f"--screenshot={cil}", BASE + cesta]
    subprocess.run(args, capture_output=True, timeout=180)
    return cil


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    from PIL import Image
    for jmeno, cesta, w, h, pohyb in ZABERY:
        cil = snap(jmeno, cesta, w, h, pohyb)
        if not cil.is_file():
            print(f"  CHYBA {jmeno}")
            continue
        im = Image.open(cil)
        im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
        im.save(cil, optimize=True)
        print(f"  {jmeno:12} {im.width}x{im.height}  {cil.stat().st_size // 1024} kB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
