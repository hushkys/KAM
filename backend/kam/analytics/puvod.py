"""Původ čísla: ze kterých konkrétních datových sad hodnota pochází.

Každé číslo v aplikaci nese štítek Fakt / Model. Tady se k ukazateli (a roku)
skládají odkazy, které si člověk může otevřít a hodnotu ověřit sám:

* statistika ČSÚ (MOS) — záznam sady za daný rok v Národním katalogu
  otevřených dat a přímo soubor CSV, ze kterého sklizeň četla, a k tomu
  původce dat (ČSÚ jen přebírá data ÚZIS, MŠMT, MPSV…);
* vrstvy Data KHK — stránka sady na portálu kraje a mapová služba (ArcGIS
  REST), ze které se počty počítají;
* rozpočty obcí — Výdaje.com a MONITOR státní pokladny pro dané IČO;
* odvozený ukazatel (podíl, na 1 000 obyvatel…) — odkazy všech vstupů.

Odkaz se skládá jen z toho, co je v databázi; co neznáme, nenabízíme. Rok,
pro který v katalogu není záznam (letošek se teprve plní), dostane odkaz na
celou databázi MOS místo konkrétního souboru.
"""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy import select

from ..db import SessionLocal
from ..indicators import DERIVED_BY_CODE, KHK_POINTS, MOS_FILE, MOS_ORIGIN_URL
from ..ingest.common import norm
from ..models import Dataset, Indicator, Territory

MOS_PRODUKT = "https://csu.gov.cz/produkty/databaze-mos-otevrena-data"
CSU_SOURCES = ("nkod-00025593", "nkod-csu")
KHK_SOURCES = ("nkod-70889546", "nkod-khk", "datakhk")
PUVODCE_URL = {**MOS_ORIGIN_URL, "ČSÚ": "https://csu.gov.cz/", "Královéhradecký kraj": "https://www.datakhk.cz/"}


@lru_cache(maxsize=1)
def _mos_roky() -> dict[int, tuple[str, str]]:
    """Rok → (stránka sady v NKOD, soubor CSV) pro „Databáze MOS - data RRRR“."""
    out: dict[int, tuple[str, str]] = {}
    with SessionLocal() as s:
        for title, url, dl in s.execute(select(Dataset.title, Dataset.url, Dataset.download_url)
                                        .where(Dataset.source_id.in_(CSU_SOURCES), Dataset.title.like("Databáze MOS - data %"))):
            try:
                out[int(title.rsplit(" ", 1)[1])] = (url, dl)
            except ValueError:
                continue
    return out


@lru_cache(maxsize=1)
def _khk_sady() -> dict[str, str]:
    """Normalizovaný název vrstvy → stránka sady v katalogu kraje."""
    with SessionLocal() as s:
        return {norm(t): u for t, u in s.execute(select(Dataset.title, Dataset.url).where(Dataset.source_id.in_(KHK_SOURCES))) if u}


@lru_cache(maxsize=512)
def _indikator(code: str) -> tuple[str, str, str, str] | None:
    with SessionLocal() as s:
        i = s.get(Indicator, code)
        return (i.name, i.source_label, i.source_url, i.origin) if i else None


def _ico(tid: str | None) -> str:
    if not tid:
        return ""
    with SessionLocal() as s:
        t = s.get(Territory, tid)
        return (t.ico or "") if t else ""


def odkazy(code: str, rok: int | None = None, tid: str | None = None, _hloubka: int = 0) -> list[dict]:
    d = DERIVED_BY_CODE.get(code)
    if d is not None and _hloubka < 3:
        out = [{"nazev": f"Výpočet: {d.explain or d.name}", "url": "", "druh": "vypocet"}]
        for vstup in (d.num, d.den):
            out += odkazy(vstup, rok, tid, _hloubka + 1)
        return _bez_duplicit(out)
    meta = _indikator(code)
    if meta is None:
        return []
    nazev, zdroj, url, puvodce = meta
    out: list[dict] = []
    if "MOS" in (zdroj or "") or url == MOS_PRODUKT:
        roky = _mos_roky()
        if rok in roky:
            nkod, csv = roky[rok]
            out.append({"nazev": f"Databáze MOS – data {rok} (Národní katalog)", "url": nkod, "druh": "sada", "ukazatel": nazev})
            if csv:
                out.append({"nazev": f"Soubor CSV za rok {rok} (ČSÚ)", "url": csv, "druh": "soubor", "ukazatel": nazev})
        elif rok:
            # Novější ročníky v Národním katalogu nejsou; sklizeň je stahuje přímo
            # z ČSÚ, takže odkaz vede na tentýž soubor, který četla.
            out.append({"nazev": f"Soubor CSV za rok {rok} (ČSÚ, MOS)", "url": f"{MOS_FILE}mos_data_{rok}.csv", "druh": "soubor", "ukazatel": nazev})
            out.append({"nazev": "Databáze MOS – popis a číselníky (ČSÚ)", "url": MOS_PRODUKT, "druh": "sada", "ukazatel": nazev})
        else:
            out.append({"nazev": "Databáze MOS (ČSÚ)", "url": MOS_PRODUKT, "druh": "sada", "ukazatel": nazev})
    elif code.startswith("vyd_"):
        out.append({"nazev": "Výdaje.com – rozpočty obcí", "url": "https://vydaje.com/", "druh": "sada", "ukazatel": nazev})
        ico = _ico(tid)
        out.append({"nazev": "MONITOR státní pokladny" + (" – rozpočet obce" if ico else ""),
                    "url": f"https://monitor.statnipokladna.gov.cz/ucetni-jednotka/{ico}/rozpocet-obce" if ico else "https://monitor.statnipokladna.gov.cz/",
                    "druh": "sada", "ukazatel": nazev})
    else:
        sluzba = next((k for k, v in KHK_POINTS.items() if v[0] == code), None)
        if sluzba:
            stranka = _khk_sady().get(norm(sluzba.replace("_", " ")))
            if stranka:
                out.append({"nazev": f"{sluzba.replace('_', ' ')} (Data KHK)", "url": stranka, "druh": "sada", "ukazatel": nazev})
        if url:
            out.append({"nazev": ("Mapová služba ArcGIS – " + sluzba.replace("_", " ")) if sluzba else (zdroj or "Zdroj dat"),
                        "url": url, "druh": "sluzba" if sluzba else "sada", "ukazatel": nazev})
    if puvodce and PUVODCE_URL.get(puvodce) and puvodce != "ČSÚ":
        out.append({"nazev": f"Původce dat: {puvodce}", "url": PUVODCE_URL[puvodce], "druh": "puvodce", "ukazatel": nazev})
    return out


def _bez_duplicit(radky: list[dict]) -> list[dict]:
    videno, out = set(), []
    for r in radky:
        klic = r["url"] or r["nazev"]
        if klic in videno:
            continue
        videno.add(klic)
        out.append(r)
    return out


def pro_vice(kody: list[str], rok: int | None = None, tid: str | None = None) -> list[dict]:
    out: list[dict] = []
    for k in kody:
        out += odkazy(k, rok, tid)
    return _bez_duplicit(out)


def reset() -> None:
    _mos_roky.cache_clear()
    _khk_sady.cache_clear()
    _indikator.cache_clear()
