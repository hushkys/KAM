"""Vygeneruje QR kód na aplikaci ve vizuálu KAM — PNG i PDF.

    python scripts/qr.py [adresa]

Proč vlastní kreslení a ne hotový obrázek z generátoru: logo uprostřed je
skutečná geometrie značky, tytéž dráhy, kterými se KAM. kreslí v aplikaci
(`components/Logo.tsx`), a tečka je maskot s obličejem z `WordmarkHop.tsx`.
Kdyby se obkreslovalo od oka, rozejde se to s aplikací při první úpravě.

Dvě rozhodnutí, která drží QR čitelný, i když je hezký:

*Tmavé moduly na světlém podkladu.* Obrácená polarita by vypadala líp na
tmavé kartě, jenže starší čtečky ji neumí. Krásný QR, který se nenačte, je
k ničemu — světlý panel je proto uvnitř tmavé karty.

*Korekce chyb H (30 %) a malý výřez.* Logo zabírá kolem pěti procent plochy,
takže na opravu zbývá šestinásobná rezerva. Okolo kódu zůstává klidová zóna
čtyř modulů, jak vyžaduje norma.
"""

from __future__ import annotations

import pathlib
import sys

import segno
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ADRESA = "https://hack-a-ton-hushkys.web.app/prehled"
VEN = pathlib.Path(__file__).resolve().parents[1] / "docs"

# Barvy z `styles/base.css`; drží se motivu aplikace.
POZADI_1, POZADI_2 = (15, 21, 18), (9, 12, 11)
PANEL = (242, 245, 242)
MODUL = (13, 44, 28)
ZNACKA = (18, 58, 36)
LIME = (127, 217, 87)
INKOUST = (10, 18, 12)
TEXT = (231, 238, 233)
TEXT_TLUMENY = (139, 155, 145)

SS = 3           # kreslí se ve trojnásobku a zmenšuje: hladké oblouky bez knihovny
SIRKA, VYSKA = 1800, 2250


# ------------------------------------------------------------------ dráhy SVG
# Písmena značky jsou samé úsečky, takže stačí parser na M/L/H/V/h/v/l/z.
K_PATH = "M0 0h24v41L58 0h30L46 47l44 53H59L32 66l-8 8.6V100H0z"
A_PATH = "M97 100L133 0h27l36 100h-25l-7.2-21h-37L119.6 100zM133.6 58h23l-11.5-34.5z"
M_PATH = "M205 100V0h29l23.5 57L281 0h29v100h-23V43l-19.8 47h-15.4L228 43v57z"


def _dratky(d: str) -> list[list[tuple[float, float]]]:
    """Rozloží dráhu na uzavřené polygony. Zvládá jen úsečky — víc tu není."""
    import re

    out: list[list[tuple[float, float]]] = []
    cesta: list[tuple[float, float]] = []
    x = y = 0.0
    for prikaz, argy in re.findall(r"([MmLlHhVvZz])([^MmLlHhVvZz]*)", d):
        cisla = [float(c) for c in re.findall(r"-?\d*\.?\d+", argy)]
        if prikaz in "Zz":
            if cesta:
                out.append(cesta)
                cesta = []
            continue
        i = 0
        while i < len(cisla) or (prikaz in "Hh Vv" and i < len(cisla)):
            if prikaz in "MmLl":
                nx, ny = cisla[i], cisla[i + 1]
                i += 2
                x, y = (x + nx, y + ny) if prikaz.islower() else (nx, ny)
            elif prikaz in "Hh":
                x = x + cisla[i] if prikaz == "h" else cisla[i]
                i += 1
            else:
                y = y + cisla[i] if prikaz == "v" else cisla[i]
                i += 1
            cesta.append((x, y))
            if prikaz == "M":
                prikaz = "L"
            elif prikaz == "m":
                prikaz = "l"
    if cesta:
        out.append(cesta)
    return out


def _kvadratika(a, b, c, kroku=24):
    """Vzorkuje kvadratickou Bézierovu křivku — obličej maskota je z nich."""
    return [(
        (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0],
        (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1],
    ) for t in (i / kroku for i in range(kroku + 1))]


def znacka(kresba: ImageDraw.ImageDraw, x0: float, y0: float, sirka: float, podklad) -> None:
    """Nakreslí KAM. i s vysmátou tečkou. Souřadnice jsou z `Logo.tsx`
    (viewBox 346×100), maskot z `WordmarkHop.tsx` — obojí se jen přeškáluje."""
    k = sirka / 346.0
    prevod = lambda b: [(x0 + px * k, y0 + py * k) for px, py in b]  # noqa: E731

    for d in (K_PATH, M_PATH):
        for poly in _dratky(d):
            kresba.polygon(prevod(poly), fill=ZNACKA)
    vnejsi, dira = _dratky(A_PATH)
    kresba.polygon(prevod(vnejsi), fill=ZNACKA)
    kresba.polygon(prevod(dira), fill=podklad)   # protilehlá plocha v „A"

    # Tečka je maskot: poloměr 17 podle `mascot-engine.ts`, ne 14 ze statického loga.
    cx, cy, r = x0 + 331 * k, y0 + 86 * k, 17 * k
    kresba.ellipse([cx - r, cy - r, cx + r, cy + r], fill=LIME)

    tah = max(1, round(2.3 * k))
    mistni = lambda b: [(cx + px * k, cy + py * k) for px, py in b]  # noqa: E731
    # Radostné obloučky místo očí — stav `radost` v maskotovi.
    for dx in (-8.4, 3.2):
        kresba.line(mistni(_kvadratika((dx, -1.6), (dx + 2.6, -5.0), (dx + 5.2, -1.6))),
                    fill=INKOUST, width=tah, joint="curve")
    # Pusa při plném úsměvu: u = 1.6 + 1 × 2.6.
    kresba.line(mistni(_kvadratika((-4.2, 3.4), (0, 7.6), (4.2, 3.4))),
                fill=INKOUST, width=max(1, round(2.0 * k)), joint="curve")


# ------------------------------------------------------------------- kreslení
def pozadi() -> Image.Image:
    """Tmavá karta se zeleným nádechem — stejná nálada jako hooky v aplikaci."""
    img = Image.new("RGB", (SIRKA * SS, VYSKA * SS), POZADI_2)
    kresba = ImageDraw.Draw(img)
    for y in range(img.height):
        t = y / img.height
        kresba.line([(0, y), (img.width, y)],
                    fill=tuple(round(a + (b - a) * t) for a, b in zip(POZADI_1, POZADI_2)))

    zare = Image.new("RGB", img.size, (0, 0, 0))
    d = ImageDraw.Draw(zare)
    d.ellipse([int(img.width * 0.42), int(-img.height * 0.12),
               int(img.width * 1.25), int(img.height * 0.42)], fill=(64, 150, 74))
    d.ellipse([int(-img.width * 0.2), int(img.height * 0.66),
               int(img.width * 0.5), int(img.height * 1.1)], fill=(30, 92, 58))
    zare = zare.filter(ImageFilter.GaussianBlur(radius=120 * SS))
    return Image.blend(img, Image.blend(img, zare, 0.55), 0.55)


def moduly(kresba: ImageDraw.ImageDraw, mat, x0: int, y0: int, krok: float) -> None:
    """Datové moduly jako kolečka, hledáčky jako rámečky s kulatými rohy.

    Hledáčky se kreslí zvlášť: kdyby se poskládaly z koleček jako zbytek, čtečka
    je hůř najde a kód se hledá pomaleji nebo vůbec."""
    n = len(mat)
    hledacky = [(0, 0), (0, n - 7), (n - 7, 0)]

    def v_hledacku(r: int, c: int) -> bool:
        return any(hr <= r < hr + 7 and hc <= c < hc + 7 for hr, hc in hledacky)

    tecka = krok * 0.42
    for r in range(n):
        for c in range(n):
            if not mat[r][c] or v_hledacku(r, c):
                continue
            cx, cy = x0 + (c + 0.5) * krok, y0 + (r + 0.5) * krok
            kresba.ellipse([cx - tecka, cy - tecka, cx + tecka, cy + tecka], fill=MODUL)

    for hr, hc in hledacky:
        x, y = x0 + hc * krok, y0 + hr * krok
        s = 7 * krok
        kresba.rounded_rectangle([x, y, x + s, y + s], radius=krok * 2.1, fill=MODUL)
        kresba.rounded_rectangle([x + krok, y + krok, x + s - krok, y + s - krok],
                                 radius=krok * 1.4, fill=PANEL)
        kresba.rounded_rectangle([x + 2 * krok, y + 2 * krok, x + s - 2 * krok, y + s - 2 * krok],
                                 radius=krok * 1.0, fill=MODUL)


def pismo(velikost: int, tucne: bool = False) -> ImageFont.FreeTypeFont:
    for jmeno in (("seguisb.ttf", "segoeuib.ttf", "arialbd.ttf") if tucne
                  else ("segoeui.ttf", "arial.ttf")):
        try:
            return ImageFont.truetype(jmeno, velikost)
        except OSError:
            continue
    return ImageFont.load_default(velikost)


def vytvor(adresa: str) -> Image.Image:
    qr = segno.make(adresa, error="h", boost_error=False)
    mat = [[bool(b) for b in radek] for radek in qr.matrix]
    n = len(mat)

    img = pozadi()
    kresba = ImageDraw.Draw(img)

    panel_s = int(1460 * SS)
    panel_x = (img.width - panel_s) // 2
    panel_y = int(250 * SS)
    kresba.rounded_rectangle([panel_x, panel_y, panel_x + panel_s, panel_y + panel_s],
                             radius=int(56 * SS), fill=PANEL)

    # Klidová zóna čtyř modulů kolem kódu je norma, ne ozdoba.
    krok = panel_s / (n + 8)
    x0 = panel_x + krok * 4
    y0 = panel_y + krok * 4
    moduly(kresba, mat, x0, y0, krok)

    # Výřez pro značku. Kulatý obdélník v barvě panelu, aby logo nesedělo na modulech.
    log_s = panel_s * 0.42
    log_v = log_s / 3.46
    cx, cy = panel_x + panel_s / 2, panel_y + panel_s / 2
    okraj = krok * 0.9
    kresba.rounded_rectangle([cx - log_s / 2 - okraj, cy - log_v / 2 - okraj * 1.6,
                              cx + log_s / 2 + okraj, cy + log_v / 2 + okraj * 1.6],
                             radius=int(22 * SS), fill=PANEL)
    znacka(kresba, cx - log_s / 2, cy - log_v / 2, log_s, PANEL)

    pod = panel_y + panel_s
    kresba.text((img.width / 2, pod + int(118 * SS)), "Krajský analytický model",
                font=pismo(int(62 * SS), True), fill=TEXT, anchor="mm")
    kresba.text((img.width / 2, pod + int(196 * SS)), "Vidět, kam to směřuje.",
                font=pismo(int(44 * SS)), fill=TEXT_TLUMENY, anchor="mm")
    kresba.text((img.width / 2, pod + int(286 * SS)), adresa.replace("https://", ""),
                font=pismo(int(38 * SS)), fill=LIME, anchor="mm")

    return img.resize((SIRKA, VYSKA), Image.LANCZOS)


def main() -> int:
    adresa = sys.argv[1] if len(sys.argv) > 1 else ADRESA
    VEN.mkdir(parents=True, exist_ok=True)
    img = vytvor(adresa)
    png = VEN / "kam-qr.png"
    pdf = VEN / "kam-qr.pdf"
    img.save(png, optimize=True)
    img.save(pdf, "PDF", resolution=220.0)
    print(f"{png}  {img.size[0]}×{img.size[1]}  {png.stat().st_size // 1024} kB")
    print(f"{pdf}  {pdf.stat().st_size // 1024} kB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
