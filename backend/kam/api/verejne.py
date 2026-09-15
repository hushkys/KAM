"""Veřejné API nad daty, která KAM posbíral — `/api/v1`.

Zbytek `/api` obsluhuje tuhle aplikaci: vrací hotové profily, rizika, výhledy.
Tohle je něco jiného. Je to jedno místo, odkud si kdokoli — úřad, novinář,
student — stáhne **samotná data** a udělá si s nimi své, bez toho, aby musel
obcházet dvacet katalogů a luštit dvacet formátů.

Tři věci, které z toho dělají použitelné API a ne jen další endpoint:

*Samopopisné.* `GET /api/v1` vypíše, co tu je, kolik toho je a jak se na to
ptát. Kdo API nezná, nemusí číst dokumentaci, aby začal.

*Otevřené i z prohlížeče.* Hlavička CORS je jen na `/api/v1`, protože právě
tohle má kdokoli volat ze svého webu nebo notebooku. Zbytek API zůstává jen
pro aplikaci.

*Ve formátu, který si vyberete.* `?format=csv` pro tabulkový procesor,
`?format=ndjson` pro velké dávky po řádcích, jinak JSON. CSV a NDJSON se
streamují, takže i stažení všech čtyř set tisíc hodnot drží paměť u nuly.

Ke každé hodnotě patří původ. `Observation` nese ukazatel, ten nese `origin`
(skutečného původce, protože ČSÚ MOS přebírá data jiných úřadů) a odkaz na
zdroj. Data bez původu jsou tvrzení, ne data.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Any, Iterator

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from .. import __version__
from ..db import SessionLocal
from ..indicators import PILLARS
from ..models import Dataset, Fact, Indicator, Observation, Poi, Territory
from ..territory import HOME_KRAJ

router = APIRouter(prefix="/api/v1")

FORMATY = ("json", "csv", "ndjson")
STROP = 50_000          # nejvýš na jednu stránku JSON; CSV a NDJSON stropy nemají
VYCHOZI = 1_000


# ------------------------------------------------------------------- výstup
def _csv(radky: Iterator[dict], hlavicka: list[str], jmeno: str) -> StreamingResponse:
    def gen() -> Iterator[str]:
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(hlavicka)
        # BOM: bez něj Excel na Windows přečte diakritiku jako paskvil.
        yield "﻿" + buf.getvalue()
        for r in radky:
            buf.seek(0)
            buf.truncate()
            w.writerow([r.get(k, "") for k in hlavicka])
            yield buf.getvalue()

    return StreamingResponse(gen(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{jmeno}.csv"'})


def _ndjson(radky: Iterator[dict], jmeno: str) -> StreamingResponse:
    def gen() -> Iterator[str]:
        for r in radky:
            yield json.dumps(r, ensure_ascii=False) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson",
                             headers={"Content-Disposition": f'inline; filename="{jmeno}.ndjson"'})


def _odpoved(radky: list[dict] | Iterator[dict], hlavicka: list[str], jmeno: str,
             format: str, obal: dict | None = None):
    """JSON vrací obálku s počtem a odkazem na další stránku, CSV a NDJSON
    holá data — v tabulce ani v proudu není obálka k ničemu."""
    if format == "csv":
        return _csv(iter(radky), hlavicka, jmeno)
    if format == "ndjson":
        return _ndjson(iter(radky), jmeno)
    return {**(obal or {}), "polozky": list(radky)}


def _format(format: str) -> str:
    if format not in FORMATY:
        raise HTTPException(400, f"Neznámý formát '{format}'. Na výběr je {', '.join(FORMATY)}.")
    return format


def _dalsi(request: Request, offset: int, limit: int, celkem: int) -> str | None:
    if offset + limit >= celkem:
        return None
    q = dict(request.query_params)
    q["offset"] = str(offset + limit)
    q["limit"] = str(limit)
    return f"{request.url.path}?{'&'.join(f'{k}={v}' for k, v in q.items())}"


# -------------------------------------------------------------------- index
@router.get("")
@router.get("/")
def index(request: Request) -> dict:
    """Rozcestník. Kdo API nezná, začne tady a nemusí číst dokumentaci."""
    with SessionLocal() as s:
        pocty = {
            "hodnoty": s.scalar(select(func.count(Observation.id))) or 0,
            "ukazatele": s.scalar(select(func.count(Indicator.code))) or 0,
            "uzemi": s.scalar(select(func.count(Territory.id))) or 0,
            "zarizeni": s.scalar(select(func.count(Poi.id))) or 0,
            "fakta": s.scalar(select(func.count(Fact.id))) or 0,
            "katalog": s.scalar(select(func.count(Dataset.id))) or 0,
        }
        roky = s.execute(select(func.min(Observation.year), func.max(Observation.year))).first()
    zaklad = str(request.base_url).rstrip("/")
    return {
        "nazev": "KAM — otevřené API",
        "verze": __version__,
        "popis": "Data, která KAM posbíral z otevřených zdrojů, k volnému stažení a použití. "
                 "Bez klíče, bez registrace, bez omezení na počet dotazů.",
        "licence": {"data": "Podle licence původního zdroje, uvedené u každé datové sady.",
                    "api": "MIT (kód aplikace)"},
        "rozsah": {"kraj": HOME_KRAJ, "roky": list(roky) if roky else [], **pocty},
        "formaty": list(FORMATY),
        "cesty": {
            "ukazatele": f"{zaklad}/api/v1/ukazatele",
            "uzemi": f"{zaklad}/api/v1/uzemi",
            "hodnoty": f"{zaklad}/api/v1/hodnoty",
            "fakta": f"{zaklad}/api/v1/fakta",
            "zarizeni": f"{zaklad}/api/v1/zarizeni",
            "katalog": f"{zaklad}/api/v1/katalog",
            "zdroje": f"{zaklad}/api/v1/zdroje",
        },
        "priklady": [
            f"{zaklad}/api/v1/hodnoty?ukazatel=110900&uroven=obec&od=2020&format=csv",
            f"{zaklad}/api/v1/hodnoty?uzemi=obec:569810",
            f"{zaklad}/api/v1/uzemi?uroven=orp",
            f"{zaklad}/api/v1/katalog?hledat=doprava",
        ],
        "dokumentace": f"{zaklad}/api/docs",
    }


# --------------------------------------------------------------- ukazatele
@router.get("/ukazatele")
def ukazatele(oblast: str = "", hledat: str = "", format: str = "json") -> Any:
    """Registr ukazatelů: co která zkratka znamená, v čem se měří a odkud je.

    `polarita` říká, jestli je vyšší hodnota lepší (1), horší (-1), nebo to
    tak nejde říct (0) — bez toho se z čísla nedá dělat závěr."""
    format = _format(format)
    with SessionLocal() as s:
        q = select(Indicator).order_by(Indicator.pillar, Indicator.code)
        if oblast:
            q = q.where(Indicator.pillar == oblast)
        rows = list(s.scalars(q))
        roky = dict(s.execute(
            select(Observation.indicator_code, func.count(Observation.id)).group_by(Observation.indicator_code)).all())
    if hledat:
        h = hledat.lower()
        rows = [i for i in rows if h in i.name.lower() or h in i.code.lower()]
    polozky = [{
        "kod": i.code, "nazev": i.name, "jednotka": i.unit,
        "oblast": i.pillar, "oblast_nazev": PILLARS.get(i.pillar, i.pillar),
        "polarita": i.polarity, "agregace": i.agg,
        "puvodce": i.origin, "zdroj": i.source_label, "odkaz": i.source_url,
        "hodnot": roky.get(i.code, 0),
    } for i in rows]
    hlavicka = ["kod", "nazev", "jednotka", "oblast", "oblast_nazev", "polarita", "agregace", "puvodce", "zdroj", "odkaz", "hodnot"]
    return _odpoved(polozky, hlavicka, "kam-ukazatele", format, {"celkem": len(polozky)})


# -------------------------------------------------------------------- území
@router.get("/uzemi")
def uzemi(uroven: str = "", hledat: str = "", format: str = "json") -> Any:
    """Území i s kódy RÚIAN — tedy s identifikátory, na které se dá napojit
    jiný registr. `id` je to, čím se ptáte na hodnoty."""
    format = _format(format)
    with SessionLocal() as s:
        q = select(Territory).order_by(Territory.level, Territory.name)
        if uroven:
            q = q.where(Territory.level == uroven)
        rows = list(s.scalars(q))
    if hledat:
        h = hledat.lower()
        rows = [t for t in rows if h in t.name.lower()]
    polozky = [{
        "id": t.id, "uroven": t.level, "kod_ruian": t.code, "nazev": t.name,
        "nadrazene": t.parent_id, "orp": t.orp_id, "okres": t.okres_id,
        "kraj": t.kraj_code, "obyvatel": t.population,
        "lon": round(t.lon, 6) if t.lon else None, "lat": round(t.lat, 6) if t.lat else None,
    } for t in rows]
    hlavicka = ["id", "uroven", "kod_ruian", "nazev", "nadrazene", "orp", "okres", "kraj", "obyvatel", "lon", "lat"]
    return _odpoved(polozky, hlavicka, "kam-uzemi", format, {"celkem": len(polozky)})


# ------------------------------------------------------------------ hodnoty
@router.get("/hodnoty")
def hodnoty(request: Request,
            ukazatel: str = Query("", description="Kód ukazatele, víc oddělte čárkou."),
            uzemi: str = Query("", description="ID území, víc oddělte čárkou."),
            uroven: str = Query("", description="obec, orp, okres, kraj"),
            od: int | None = None, do: int | None = None,
            limit: int = Query(VYCHOZI, ge=1, le=STROP), offset: int = Query(0, ge=0),
            format: str = "json") -> Any:
    """Naměřené hodnoty — jádro celého API.

    Jeden řádek je jedno číslo: území, ukazatel, rok, hodnota. Nic se tu
    nedopočítává; podíly a poměry si aplikace počítá až při čtení a do
    databáze je nikdy nezapisuje, takže tady najdete jen to, co někdo
    doopravdy zveřejnil.

    CSV a NDJSON nemají strop — přes ně se stahují celé dávky."""
    format = _format(format)
    with SessionLocal() as s:
        q = select(Observation, Territory, Indicator).join(
            Territory, Territory.id == Observation.territory_id).join(
            Indicator, Indicator.code == Observation.indicator_code)
        if ukazatel:
            q = q.where(Observation.indicator_code.in_([k.strip() for k in ukazatel.split(",") if k.strip()]))
        if uzemi:
            q = q.where(Observation.territory_id.in_([u.strip() for u in uzemi.split(",") if u.strip()]))
        if uroven:
            q = q.where(Territory.level == uroven)
        if od is not None:
            q = q.where(Observation.year >= od)
        if do is not None:
            q = q.where(Observation.year <= do)
        q = q.order_by(Observation.indicator_code, Observation.territory_id, Observation.year)

        hlavicka = ["uzemi", "uzemi_nazev", "uroven", "kod_ruian", "ukazatel", "ukazatel_nazev",
                    "jednotka", "rok", "hodnota", "puvodce"]

        def radek(o: Observation, t: Territory, i: Indicator) -> dict:
            return {"uzemi": o.territory_id, "uzemi_nazev": t.name, "uroven": t.level, "kod_ruian": t.code,
                    "ukazatel": o.indicator_code, "ukazatel_nazev": i.name, "jednotka": i.unit,
                    "rok": o.year, "hodnota": o.value, "puvodce": i.origin}

        if format in ("csv", "ndjson"):
            # Proud: řádky se posílají, jak chodí z databáze, takže se do paměti
            # nikdy nevejde víc než jedna dávka.
            def proud() -> Iterator[dict]:
                with SessionLocal() as s2:
                    for o, t, i in s2.execute(q).yield_per(2000):
                        yield radek(o, t, i)
            return _odpoved(proud(), hlavicka, "kam-hodnoty", format)

        celkem = s.scalar(select(func.count()).select_from(q.subquery())) or 0
        polozky = [radek(o, t, i) for o, t, i in s.execute(q.limit(limit).offset(offset))]
    return {"celkem": celkem, "limit": limit, "offset": offset,
            "dalsi": _dalsi(request, offset, limit, celkem), "polozky": polozky}


# -------------------------------------------------------------------- fakta
@router.get("/fakta")
def fakta(uzemi: str = "", klic: str = "", format: str = "json") -> Any:
    """Nečíselné údaje o území — text s datem platnosti a odkazem na zdroj."""
    format = _format(format)
    with SessionLocal() as s:
        q = select(Fact, Territory).join(Territory, Territory.id == Fact.territory_id)
        if uzemi:
            q = q.where(Fact.territory_id.in_([u.strip() for u in uzemi.split(",") if u.strip()]))
        if klic:
            q = q.where(Fact.key == klic)
        polozky = [{"uzemi": f.territory_id, "uzemi_nazev": t.name, "klic": f.key,
                    "hodnota": f.value, "platnost": f.as_of, "odkaz": f.source_url}
                   for f, t in s.execute(q.order_by(Fact.territory_id, Fact.key))]
    hlavicka = ["uzemi", "uzemi_nazev", "klic", "hodnota", "platnost", "odkaz"]
    return _odpoved(polozky, hlavicka, "kam-fakta", format, {"celkem": len(polozky)})


# ----------------------------------------------------------------- zařízení
@router.get("/zarizeni")
def zarizeni(druh: str = "", obec: str = "", format: str = "json") -> Any:
    """Body v území — zastávky, školy, ordinace — i se souřadnicemi."""
    format = _format(format)
    with SessionLocal() as s:
        q = select(Poi).order_by(Poi.kind, Poi.name)
        if druh:
            q = q.where(Poi.kind == druh)
        if obec:
            q = q.where(Poi.obec_code == obec.replace("obec:", ""))
        polozky = [{"druh": p.kind, "nazev": p.name, "obec_kod": p.obec_code, "orp_kod": p.orp_code,
                    "lon": round(p.lon, 6) if p.lon else None, "lat": round(p.lat, 6) if p.lat else None,
                    "odkaz": p.source_url}
                   for p in s.scalars(q)]
    hlavicka = ["druh", "nazev", "obec_kod", "orp_kod", "lon", "lat", "odkaz"]
    return _odpoved(polozky, hlavicka, "kam-zarizeni", format, {"celkem": len(polozky)})


# ------------------------------------------------------------------ katalog
@router.get("/katalog")
def katalog(request: Request, hledat: str = "", oblast: str = "", poskytovatel: str = "",
            jen_funkcni: bool = True, limit: int = Query(VYCHOZI, ge=1, le=STROP),
            offset: int = Query(0, ge=0), format: str = "json") -> Any:
    """Katalog datových sad, ze kterých KAM čerpá — i s odkazy na originál.

    `nacteno_do_modelu` odlišuje sady, jejichž hodnoty se opravdu čtou, od
    těch, které slouží jako katalog nebo podklad pro vyhledávání. Bez toho
    rozlišení by počet vypadal větší, než jaký doopravdy je."""
    format = _format(format)
    with SessionLocal() as s:
        q = select(Dataset)
        if jen_funkcni:
            q = q.where(Dataset.check_status == "ok")
        if oblast:
            q = q.where(Dataset.pillar == oblast)
        if poskytovatel:
            q = q.where(Dataset.publisher.ilike(f"%{poskytovatel}%"))
        if hledat:
            q = q.where(Dataset.title.ilike(f"%{hledat}%"))
        q = q.order_by(Dataset.title)

        hlavicka = ["id", "nazev", "popis", "poskytovatel", "oblast", "odkaz", "stazeni",
                    "formaty", "aktualizace", "nacteno_do_modelu", "vyuziti"]

        def radek(d: Dataset) -> dict:
            return {"id": d.id, "nazev": d.title, "popis": (d.description or "")[:500],
                    "poskytovatel": d.publisher, "oblast": PILLARS.get(d.pillar, d.pillar),
                    "odkaz": d.url, "stazeni": d.download_url, "formaty": d.formats,
                    "aktualizace": d.modified, "nacteno_do_modelu": "ano" if d.loaded else "ne",
                    "vyuziti": ", ".join(d.usage or [])}

        if format in ("csv", "ndjson"):
            def proud() -> Iterator[dict]:
                with SessionLocal() as s2:
                    for d in s2.scalars(q).yield_per(1000):
                        yield radek(d)
            return _odpoved(proud(), hlavicka, "kam-katalog", format)

        celkem = s.scalar(select(func.count()).select_from(q.subquery())) or 0
        polozky = [radek(d) for d in s.scalars(q.limit(limit).offset(offset))]
    return {"celkem": celkem, "limit": limit, "offset": offset,
            "dalsi": _dalsi(request, offset, limit, celkem), "polozky": polozky}


# ------------------------------------------------------------------- zdroje
@router.get("/zdroje")
def zdroje(format: str = "json") -> Any:
    """Odkud se sklízí a kdy naposledy."""
    from ..api.data import dataset_counts

    format = _format(format)
    d = dataset_counts()
    polozky = [{"id": z["id"], "nazev": z["name"], "druh": z["kind"], "skupina": z["group"],
                "portal": z["portal_url"], "endpoint": z["url"],
                "sklizeno": z["harvested_at"], "sad": z["datasets"], "funkcnich": z["verified"]}
               for z in d["sources"]]
    hlavicka = ["id", "nazev", "druh", "skupina", "portal", "endpoint", "sklizeno", "sad", "funkcnich"]
    return _odpoved(polozky, hlavicka, "kam-zdroje", format, {"celkem": len(polozky)})
