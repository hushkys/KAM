"""Dotace Královéhradeckého kraje po ORP a okresech.

Kraj zveřejňuje, kolik schválených dotací a v jaké výši šlo do každého ORP
a okresu za roky 2021–2025 — zvlášť programové (vyhlášený program, do kterého
se podává žádost) a zvlášť individuální (jednotlivé žádosti mimo program).
Z toho se dá říct dvě věci, které starosta jinde nenajde: kolik k němu
doteklo a jak si v tom stojí proti srovnatelným územím.

Jde o **pětiletý součet, ne roční řadu** — kraj to takhle publikuje. Hodnota
se proto zapisuje k poslednímu roku období a název ukazatele období nese,
aby se nedala splést s ročním číslem. Roční čerpání jednotlivých obcí je
jinde: MOS 200302 „Přijaté dotace", a to je roční.

Kolik z toho území mělo dostat, tahle data neříkají. Srovnání na obyvatele je
popis, ne nárok — malé ORP může mít vysokou částku kvůli jedné velké akci.
"""

from __future__ import annotations

import json

from sqlalchemy import delete, select

from ..db import session_scope
from ..models import Indicator, Observation, Territory
from ..territory import HOME_KRAJ, tid
from .common import client, job, norm
from .khk import SOURCE_LABEL, _fetch, _layer_url

# (služba, úroveň, kód ukazatele pro částku, kód pro počet)
VRSTVY: tuple[tuple[str, str, str, str], ...] = (
    ("Schválené_programové_dotace_do_ORP", "orp", "dot_prog_castka", "dot_prog_pocet"),
    ("Schválené_individuální_dotace_do_ORP", "orp", "dot_indiv_castka", "dot_indiv_pocet"),
    ("Schválené_programové_dotace_do_okresů", "okres", "dot_prog_castka", "dot_prog_pocet"),
    ("Schválené_individuální_dotace_do_okresů", "okres", "dot_indiv_castka", "dot_indiv_pocet"),
)
OBDOBI = (2021, 2025)
ROK = OBDOBI[1]

UKAZATELE: tuple[tuple[str, str, str], ...] = (
    ("dot_prog_castka", f"Programové dotace kraje {OBDOBI[0]}–{OBDOBI[1]}", "Kč"),
    ("dot_prog_pocet", f"Počet programových dotací kraje {OBDOBI[0]}–{OBDOBI[1]}", "počet"),
    ("dot_indiv_castka", f"Individuální dotace kraje {OBDOBI[0]}–{OBDOBI[1]}", "Kč"),
    ("dot_indiv_pocet", f"Počet individuálních dotací kraje {OBDOBI[0]}–{OBDOBI[1]}", "počet"),
)

# ORP nese kód RÚIAN (5205), okres kód NUTS (CZ0521) — a ten se s naším
# číselníkem RÚIAN nepotkává. Okresy se proto párují jménem: v jednom kraji
# je jich pět a jsou jednoznačné.
KOD_POLE = {"orp": "kod_orp", "okres": "kod_okresu"}
NAZEV_POLE = {"orp": "nazev_orp", "okres": "nazev_okresu"}


def register_indicators() -> None:
    with session_scope() as s:
        for code, name, unit in UKAZATELE:
            row = s.get(Indicator, code) or Indicator(code=code)
            row.name, row.unit, row.pillar = name, unit, "finance"
            row.polarity, row.source, row.origin = 0, "khk", "Královéhradecký kraj"
            row.source_url = "https://www.datakhk.cz/"
            s.merge(row)


def _kod(attrs: dict, level: str) -> str:
    pole = KOD_POLE[level]
    v = attrs.get(pole) or attrs.get(pole.upper()) or ""
    return str(v).strip()


def ingest() -> dict[str, int]:
    job("dotace", "running", "Stahuji dotace kraje z Data KHK")
    register_indicators()
    with session_scope() as s:
        orp = list(s.scalars(select(Territory).where(Territory.level == "orp", Territory.kraj_code == HOME_KRAJ)))
        okres = list(s.scalars(select(Territory).where(Territory.level == "okres", Territory.kraj_code == HOME_KRAJ)))
    # Kód se nedá použít: kraj publikuje ORP v číselníku ČSÚ (5205) a okresy
    # v NUTS (CZ0521), my držíme RÚIAN (1112, 3602). Páruje se proto jménem —
    # patnáct ORP a pět okresů v jednom kraji jsou jednoznačné množiny, a
    # u okresu se odřízne naše předpona „Okres ".
    znama = {"orp": {t.code: t.id for t in orp}, "okres": {t.code: t.id for t in okres}}
    podle_jmena = {
        "orp": {norm(t.name): t.id for t in orp},
        "okres": {norm(t.name.removeprefix("Okres ")): t.id for t in okres},
    }
    c = client(180)
    rows: list[dict] = []
    nenalezene: list[str] = []
    for i, (service, level, kod_castka, kod_pocet) in enumerate(VRSTVY):
        job("dotace", "running", service.replace("_", " "), i / len(VRSTVY))
        feats, _meta = _fetch(c, service, geometry=False)
        for f in feats:
            a = f.get("attributes") or {}
            kod = _kod(a, level)
            jmeno = str(a.get(NAZEV_POLE[level]) or "").strip()
            t = podle_jmena[level].get(norm(jmeno)) or znama[level].get(kod)
            if not t:
                nenalezene.append(f"{level}:{kod or jmeno or '?'}")
                continue
            castka = a.get("finance")
            pocet = a.get("poc_dotaci")
            if castka is not None:
                rows.append({"territory_id": t, "indicator_code": kod_castka, "year": ROK, "value": float(castka)})
            if pocet is not None:
                rows.append({"territory_id": t, "indicator_code": kod_pocet, "year": ROK, "value": float(pocet)})

    # Jeden řádek na (území, ukazatel, rok) — jinak spadne unikátní index.
    rows = list({(r["territory_id"], r["indicator_code"], r["year"]): r for r in rows}.values())
    kody = [u[0] for u in UKAZATELE]
    with session_scope() as s:
        s.execute(delete(Observation).where(Observation.indicator_code.in_(kody), Observation.year == ROK))
        s.bulk_insert_mappings(Observation, rows)
    counts = {"hodnot": len(rows), "vrstev": len(VRSTVY), "bez_uzemi": len(set(nenalezene))}
    job("dotace", "done", json.dumps(counts), 1.0)
    return counts


def source_url(service: str = VRSTVY[0][0]) -> str:
    return _layer_url(service)


SOURCE = SOURCE_LABEL
