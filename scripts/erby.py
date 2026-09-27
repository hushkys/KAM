"""Znaky obcí kraje do `frontend/public/erby/` a seznam do `frontend/src/erby.json`.

Spouští se ručně, jednou po sklizni území (znaky se mění zřídka):

    python scripts/erby.py              # obce kraje 86 z data/kam.db
    python scripts/erby.py --kraj 86 --db data/kam.db --znovu

Odkud: Wikidata spojují obec s jejím znakem (vlastnost P94) a s kódem obce
z RÚIAN (P7606) — tím stejným kódem, na který je klíčovaná celá aplikace,
takže se nepáruje podle jména (stejnojmenných obcí jsou v Česku desítky).
Soubor pak vydá Wikimedia Commons; SVG si nechá vykreslit do PNG přes
`Special:FilePath?width=`, takže tu není potřeba vlastní převodník SVG.

Co se s obrázkem děje:
  * ořízne se na obsah — průhledný okraj, u obrázků bez průhlednosti bílé
    pozadí napojené na okraj (to se zprůhlední, bílá uvnitř štítu zůstane),
  * vycentruje se do čtverce s malým vzduchem, takže štít a oválná pečeť
    stojí v kartě stejně velké a na stejném místě,
  * uloží se jako WebP s průhledností (kolem 6 kB na znak).

Obec bez znaku ve Wikidatech znak zpravidla opravdu nemá: při první
sklizni jich bylo 36 ze 448 a Registr komunálních symbolů Poslanecké
sněmovny (rekos.psp.cz) u žádné z nich znak neeviduje — shody podle jména
patřily stejnojmenným obcím jinde. Infobox české Wikipedie bere obrázek
z Wikidat, takže jako záložní zdroj nic nepřidá. Neúspěšné stažení se
vypíše a stačí skript pustit znovu; hotové soubory přeskočí.

ORP a okres znak nemají — mají ho ale jejich sídla, a podle nich je člověk
pozná, takže dostanou znak obce, která jim dala jméno. Kraj má vlastní.

Znaky obcí jsou úřední symboly a na Commons jsou volné (PD-CzechGov a
podobné); zdroj každého souboru se zapisuje do `erby/zdroje.json`.

Bez závislostí mimo standardní knihovnu a Pillow.
"""
from __future__ import annotations

import argparse
import io
import json
import pathlib
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw
from PIL import ImageFile

# Některé PNG na Commons mají špatný kontrolní součet v bloku barevného
# profilu (iCCP) — znak Čestic je takový. Obrazová data jsou v pořádku,
# Pillow ale soubor odmítne jako „nerozpoznaný obrázek". Tolerance vadných
# pomocných bloků je bezpečná: výsledek se stejně ořezává a kontroluje okem.
ImageFile.LOAD_TRUNCATED_IMAGES = True

KOREN = pathlib.Path(__file__).resolve().parents[1]
CIL = KOREN / "frontend" / "public" / "erby"
SEZNAM = KOREN / "frontend" / "src" / "erby.json"
UA = "KAM-hackathon/1.0 (https://github.com/hushkys/KAM; znaky obci pro krajsky analyticky model)"
STRANA = 160          # px, čtverec výsledku
VZDUCH = 0.06         # podíl strany, který zůstane kolem znaku
# Kód kraje z RÚIAN → kód ISO 3166-2 (P300 ve Wikidatech). Kraj se tak
# dohledá úředním kódem stejně jako obec, ne jménem.
KRAJE_ISO = {
    19: "CZ-10", 27: "CZ-20", 35: "CZ-31", 43: "CZ-32", 51: "CZ-41", 60: "CZ-42", 78: "CZ-51",
    86: "CZ-52", 94: "CZ-53", 108: "CZ-63", 116: "CZ-64", 124: "CZ-71", 132: "CZ-80", 141: "CZ-72",
}
# Praha má ve Wikidatech velký znak se štítonoši a klenoty; vedle třinácti
# štítů ostatních krajů by vypadal jako z jiné sady a v 24 px je z něj šum.
# Malý znak (samotný štít) je úřední stejně jako velký.
KRAJE_SOUBOR = {19: "http://commons.wikimedia.org/wiki/Special:FilePath/Praha%20CoA%20CZ%20small.svg"}


def sparql(dotaz: str) -> list[dict]:
    url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(dotaz)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["results"]["bindings"]


def stahni(url: str, pokusu: int = 5) -> bytes:
    for i in range(pokusu):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < pokusu - 1:
                time.sleep(2 + 3 * i)
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if i < pokusu - 1:
                time.sleep(2 + 3 * i)
                continue
            raise
    raise RuntimeError("nedosažitelné")


def nahled(soubor_url: str) -> str:
    """Adresa vykreslené podoby souboru z Commons (SVG → PNG) v šířce 512 px."""
    jmeno = urllib.parse.unquote(soubor_url.rsplit("/", 1)[-1])
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(jmeno) + "?width=512"


def zpruhledni_pozadi(im: Image.Image) -> Image.Image:
    """U obrázku bez průhlednosti zprůhlední světlé pozadí napojené na okraj.

    Vyplňuje se od rohů, takže bílá, která je uvnitř štítu (a od okraje ji
    odděluje obrys), zůstane. Tolerance je vůči téměř bílé, ne vůči barvě
    rohu — kdyby měl znak barevné pozadí až k okraji, nic se nestane."""
    im = im.convert("RGBA")
    a = im.getchannel("A")
    if a.getextrema()[0] < 250:
        return im   # průhlednost už má
    w, h = im.size
    rgb = im.convert("RGB")
    ZNACKA = (255, 0, 255)
    for bod in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        px = rgb.getpixel(bod)
        if min(px) >= 232:
            ImageDraw.floodfill(rgb, bod, ZNACKA, thresh=28)
    data = [(0, 0, 0, 0) if p == ZNACKA else (*p, 255) for p in rgb.getdata()]
    ven = Image.new("RGBA", (w, h))
    ven.putdata(data)
    return ven


def zpracuj(surova: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(surova))
    im.load()
    im = zpruhledni_pozadi(im)
    # Oříznutí na obsah: alfa nad prahem, ať skoro průhledný okraj z
    # vyhlazení nenafoukne rámeček.
    a = im.getchannel("A").point(lambda v: 255 if v > 24 else 0)
    box = a.getbbox()
    if box:
        im = im.crop(box)
    w, h = im.size
    uvnitr = STRANA * (1 - 2 * VZDUCH)
    k = uvnitr / max(w, h)
    im = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    platno = Image.new("RGBA", (STRANA, STRANA), (0, 0, 0, 0))
    platno.paste(im, ((STRANA - im.width) // 2, (STRANA - im.height) // 2), im)
    return platno


def bez_diakritiky(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower().strip()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--kraj", type=int, default=86)
    ap.add_argument("--db", default=str(KOREN / "data" / "kam.db"))
    ap.add_argument("--znovu", action="store_true", help="stáhnout i znaky, které už na disku jsou")
    arg = ap.parse_args()

    db = sqlite3.connect(arg.db)
    obce = db.execute("select code, name from territory where level='obec' and kraj_code=?", (arg.kraj,)).fetchall()
    vyssi = db.execute("select id, name, level from territory where level in ('orp','okres') and kraj_code=?", (arg.kraj,)).fetchall()
    print(f"obcí v kraji: {len(obce)}")

    print("Wikidata: znaky podle kódu obce…")
    znaky: dict[str, str] = {}
    for b in sparql("SELECT ?kod ?erb WHERE { ?item wdt:P7606 ?kod . ?item wdt:P94 ?erb . }"):
        znaky.setdefault(b["kod"]["value"], b["erb"]["value"])
    # Znaky všech krajů: mapa Česka a seznam krajů je potřebují všechny, ne
    # jen ten, pro který se sklízí obce.
    iso_na_kod = {v: k for k, v in KRAJE_ISO.items()}
    hodnoty = " ".join(f'"{v}"' for v in KRAJE_ISO.values())
    kraje_erb: dict[int, str] = {}
    for b in sparql(f"SELECT ?iso ?erb WHERE {{ VALUES ?iso {{ {hodnoty} }} ?item wdt:P300 ?iso ; wdt:P94 ?erb . }}"):
        kraje_erb.setdefault(iso_na_kod[b["iso"]["value"]], b["erb"]["value"])
    kraje_erb.update(KRAJE_SOUBOR)

    CIL.mkdir(parents=True, exist_ok=True)
    zdroje: dict[str, str] = {}
    hotove: list[str] = []
    chybi: list[str] = []
    ukoly = [(str(k), n, znaky.get(str(k))) for k, n in obce]
    for kod, url in sorted(kraje_erb.items()):
        ukoly.append((f"kraj-{kod}", f"kraj {kod}", url))
    for i, (kod, jmeno, url) in enumerate(ukoly, 1):
        if not url:
            chybi.append(f"{kod} {jmeno}")
            continue
        cil = CIL / f"{kod}.webp"
        zdroje[kod] = urllib.parse.unquote(url.rsplit("/", 1)[-1])
        if cil.exists() and not arg.znovu:
            hotove.append(kod)
            continue
        try:
            im = zpracuj(stahni(nahled(url)))
            im.save(cil, "WEBP", quality=90, method=6)
            hotove.append(kod)
        except Exception as e:   # noqa: BLE001 — jeden rozbitý soubor nesmí shodit ostatní
            chybi.append(f"{kod} {jmeno} ({e.__class__.__name__}: {e})")
        if i % 25 == 0:
            print(f"  {i}/{len(ukoly)}")
        time.sleep(0.15)   # ohleduplnost k Commons

    # ORP a okresy → znak sídla podle jména, jen uvnitř kraje a jen
    # jednoznačně (stejnojmenné obce v kraji by se tu minuly).
    podle_jmena: dict[str, list[str]] = {}
    for k, n in obce:
        podle_jmena.setdefault(bez_diakritiky(n), []).append(str(k))
    sidla: dict[str, str] = {}
    for tid, jmeno, _ in vyssi:
        jmeno = re.sub(r"^okres\s+", "", jmeno, flags=re.I)   # „Okres Náchod" → Náchod
        kandidati = [k for k in podle_jmena.get(bez_diakritiky(jmeno), []) if k in hotove]
        if len(kandidati) == 1:
            sidla[tid] = kandidati[0]

    obce_s = sorted(k for k in hotove if not k.startswith("kraj-"))
    seznam = {
        "obce": obce_s,
        "sidla": sidla,
        "kraj": {str(k): f"kraj-{k}" for k in KRAJE_ISO if f"kraj-{k}" in hotove},
    }
    SEZNAM.write_text(json.dumps(seznam, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (CIL / "zdroje.json").write_text(json.dumps(
        {"zdroj": "Wikimedia Commons přes Wikidata (P94, spárováno podle kódu obce P7606)", "soubory": zdroje},
        ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"hotovo: {len(obce_s)} obcí se znakem z {len(obce)}, sídel ORP/okresů: {len(sidla)}, krajů: {len(seznam['kraj'])} ze {len(KRAJE_ISO)}")
    if chybi:
        print(f"bez znaku ({len(chybi)}):")
        for c in chybi:
            print("  ", c)
    return 0


if __name__ == "__main__":
    sys.exit(main())
