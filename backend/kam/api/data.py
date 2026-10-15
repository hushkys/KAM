"""Read API: territories, profiles, maps, catalogue, statistics, pulse, gaps."""

from __future__ import annotations

import csv
import io
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import case, func, or_, select

from .. import crowd
from ..ai import rag
from ..analytics import dotace as dotace_mod
from ..analytics import plany
from ..analytics import finance, forecast, gaps, risks, simulate, store, vydaje as vydaje_mod
from ..analytics.profile import COMPARABLE, PROFILE_CODES, card, profile, reference
from ..analytics.trends import classify
from ..db import SessionLocal
from ..indicators import DERIVED, PILLARS
from ..ingest.common import norm
from ..ingest.geo import load as load_geo
from ..models import AuditLog, ChatMessage, Dataset, Dokument, Event, Indicator, JobState, Observation, Poi, RagChunk, Source
from ..territory import HOME_KRAJ, KRAJ_BY_CODE, KRAJE, LEVEL_LABEL

router = APIRouter(prefix="/api")


def _territory_row(t) -> dict:
    return {"id": t.id, "level": t.level, "level_label": LEVEL_LABEL.get(t.level, t.level), "code": t.code, "name": t.name,
            "population": t.population, "parent_id": t.parent_id,
            "parent": store.territory(t.parent_id).name if t.parent_id and store.territory(t.parent_id) else None}


@router.get("/health")
def health() -> dict:
    """Stav serveru. Rozlišuje „běžím a vidím na data" od „běžím, ale databáze
    mlčí" — druhý stav se z venku pozná jinak jen tím, že se aplikace tváří
    prázdně. Když se databáze mezitím vzpamatuje, pokus o schéma tady projde
    a aplikace se sama vrátí do provozu bez nasazování."""
    from .. import db as _db
    if _db.posledni_chyba:
        # Známý výpadek: odpovědět hned a o obnovu se pokusit na pozadí.
        _db.zkus_obnovit()
        return {"ok": False, "database": "nedostupná", "detail": _db.posledni_chyba,
                "time": datetime.now(UTC).isoformat()}
    try:
        with SessionLocal() as s:
            n = s.scalar(select(func.count(Observation.id))) or 0
        return {"ok": True, "observations": n, "time": datetime.now(UTC).isoformat()}
    except Exception as e:
        _db.posledni_chyba = f"{type(e).__name__}: {str(e).splitlines()[0][:200]}"
        return {"ok": False, "database": "nedostupná", "detail": _db.posledni_chyba,
                "time": datetime.now(UTC).isoformat()}


_counts_cache: dict = {}


# Zdroje, které se čtou přímo (soubory, REST služby), nemají v katalogu vlastní
# záznamy, protože jejich sady vede NKOD. Prázdné buňky by ale vypadaly, že
# se z nich nic nebere, takže se doplní tím, co se opravdu čte: počet souborů
# nebo vrstev a čas poslední sklizně. Portály, které katalog nese přes NKOD,
# ukážou počet sad téhož poskytovatele v NKOD; je to označené (`pres_nkod`).
def _doplnit_zdroje(sources: list[dict]) -> None:
    from ..config import settings
    from ..ingest.link import KHK_TITLES
    by_id = {x["id"]: x for x in sources}
    with SessionLocal() as s:
        joby = {j.name: j.updated_at for j in s.scalars(select(JobState))}
        vlastni = dict(s.execute(select(Source.id, Source.dataset_count)).all())
        ico = dict(s.execute(select(Source.id, Source.ico)).all())

    def nastav(sid: str, pocet: int, kdy) -> None:
        x = by_id.get(sid)
        if x is None or x["datasets"]:
            return
        x["datasets"], x["verified"] = pocet, pocet
        x["harvested_at"] = x["harvested_at"] or (kdy.isoformat() if kdy else None)

    nastav("csu-mos", max(0, settings.mos_last_year - settings.mos_first_year + 1), joby.get("mos"))
    nastav("cuzk-ruian", 4, joby.get("geo"))  # hranice kraje, okresů, ORP a obcí
    nastav("khk-arcgis", len(KHK_TITLES), joby.get("khk"))
    for x in sources:
        if not x["datasets"] and vlastni.get(x["id"]):
            # Portál, jehož záznamy se při sloučení s NKOD přeskočily jako duplicity.
            x["datasets"], x["pres_nkod"] = vlastni[x["id"]], True
    for sid, x in by_id.items():
        if x["datasets"] or x["kind"] not in ("portal", "api", "file"):
            continue
        n = by_id.get(f"nkod-{ico.get(sid, '')}")
        if n and n["datasets"]:
            x["datasets"], x["verified"], x["pres_nkod"] = n["datasets"], n["verified"], True
            x["harvested_at"] = x["harvested_at"] or n["harvested_at"]


def dataset_counts() -> dict:
    """Catalogue counts. `verified` (link checked and reachable) is the headline
    everywhere; `total` includes records whose link failed or is missing."""
    import time
    if _counts_cache and time.time() - _counts_cache["at"] < 60:
        return _counts_cache["data"]
    ok = Dataset.check_status == "ok"
    with SessionLocal() as s:
        total = s.scalar(select(func.count(Dataset.id))) or 0
        by_status = dict(s.execute(select(Dataset.check_status, func.count()).group_by(Dataset.check_status)).all())
        loaded = s.scalar(select(func.count(Dataset.id)).where(Dataset.loaded.is_(True))) or 0
        by_source = s.execute(select(Source.id, Source.name, Source.group, Source.portal_url, Source.url, Source.kind, Source.last_harvest_at,
                                     func.count(Dataset.id), func.sum(case((ok, 1), else_=0))).join(Dataset, Dataset.source_id == Source.id, isouter=True).group_by(Source.id)).all()
        by_pillar = dict(s.execute(select(Dataset.pillar, func.count()).where(ok).group_by(Dataset.pillar)).all())
        by_region = dict(s.execute(select(Dataset.region_code, func.count()).where(ok).group_by(Dataset.region_code)).all())
        by_fresh = dict(s.execute(select(Dataset.freshness, func.count()).where(ok).group_by(Dataset.freshness)).all())
        grouped = dict(s.execute(select(Source.group, func.count(Dataset.id)).join(Source, Source.id == Dataset.source_id).where(ok).group_by(Source.group)).all())
        api_sources = s.scalar(select(func.count(Source.id)).where(Source.kind.in_(["api", "file", "portal"]))) or 0
        # Kdy se odkazy naposledy zkoušely: „funkční" platí k tomuhle dni, ne k dnešku.
        checked_at = s.scalar(select(func.max(Dataset.checked_at)))
    sources = [{"id": i, "name": n, "group": g, "portal_url": p, "url": u, "kind": k, "harvested_at": h.isoformat() if h else None, "datasets": c, "verified": int(v or 0)}
               for i, n, g, p, u, k, h, c, v in by_source]
    poskytovatelu = sum(1 for x in sources if x["datasets"])  # jen ti, kdo mají vlastní záznamy v katalogu
    for x in sources:
        x["ma_zaznamy"] = x["datasets"] > 0  # filtr „zobrazit sady zdroje" má smysl jen pro ně
    _doplnit_zdroje(sources)
    sources.sort(key=lambda x: ({"core": 0, "kraje": 1}.get(x["group"], 2), -x["datasets"]))
    verified = by_status.get("ok", 0)
    data = {"total": total, "verified": verified, "broken": by_status.get("chyba", 0), "no_link": by_status.get("bez_odkazu", 0), "pages": by_status.get("stranka", 0),
            "unchecked": by_status.get("neovereno", 0), "core": grouped.get("core", 0), "kraje": grouped.get("kraje", 0), "other": grouped.get("ostatni", 0),
            "loaded": loaded, "api_sources": api_sources, "sources": sources, "publishers": poskytovatelu,
            "by_pillar": [{"key": k, "label": PILLARS.get(k, "Ostatní"), "count": v} for k, v in sorted(by_pillar.items(), key=lambda kv: -kv[1])],
            "by_region": {str(k): v for k, v in by_region.items()}, "by_freshness": by_fresh,
            "checked_at": checked_at.isoformat() if checked_at else None}
    _counts_cache.update(at=time.time(), data=data)
    return data


@router.get("/overview")
def overview() -> dict:
    kraj = f"kraj:{HOME_KRAJ}"
    pop = store.series(kraj, "110900")
    s65 = store.series(kraj, "d_podil_65")
    with SessionLocal() as s:
        obs = s.scalar(select(func.count(Observation.id))) or 0
        years = s.execute(select(func.min(Observation.year), func.max(Observation.year))).one()
        pois = s.scalar(select(func.count(Poi.id))) or 0
    y = max(pop) if pop else None
    kpis = []
    if pop:
        first = min(y2 for y2 in pop if y2 >= y - 10)
        kpis.append({"key": "pop", "label": "Obyvatelé kraje", "value": pop[y], "year": y, "unit": "", "change": round(100 * (pop[y] / pop[first] - 1), 2), "since": first,
                     "series": [{"year": k, "value": pop[k]} for k in sorted(pop)]})
    if s65:
        y6 = max(s65)
        kpis.append({"key": "s65", "label": "Podíl obyvatel 65+", "value": s65[y6], "year": y6, "unit": "%", "change": round(s65[y6] - s65[min(s65)], 2), "since": min(s65),
                     "series": [{"year": k, "value": s65[k]} for k in sorted(s65)]})
    un = store.series(kraj, "500020")
    if un:
        yu = max(un)
        kpis.append({"key": "un", "label": "Podíl nezaměstnaných", "value": un[yu], "year": yu, "unit": "%", "change": round(un[yu] - un[min(un)], 2), "since": min(un),
                     "series": [{"year": k, "value": un[k]} for k in sorted(un)]})
    by = store.series(kraj, "121800")
    if by:
        yb = max(by)
        kpis.append({"key": "byty", "label": "Dokončené byty", "value": by[yb], "year": yb, "unit": "", "change": None, "since": None,
                     "series": [{"year": k, "value": by[k]} for k in sorted(by)]})
    out = forecast.summary(kraj)
    counts = dataset_counts()
    return {
        "kraj": {"id": kraj, "name": KRAJ_BY_CODE[HOME_KRAJ].name},
        "kpis": kpis, "outlook": out,
        "datasets": {k: counts[k] for k in ("total", "verified", "broken", "no_link", "pages", "core", "kraje", "other", "loaded", "api_sources", "publishers")},
        "model": {"observations": obs, "years": [years[0], years[1]], "territories": len(store.territories()), "pois": pois,
                  "obce": sum(1 for t in store.territories().values() if t.level == "obec" and t.kraj_code == HOME_KRAJ),
                  "indicators": len(store.indicators()) + len(DERIVED)},
        "risks": risks.ranking("obec", HOME_KRAJ, 8), "kraj_risks": risks.assess(kraj)[:4],
    }


@router.get("/territories")
def territories(q: str = "", level: str = "", limit: int = Query(40, le=500)) -> list[dict]:
    rows = list(store.territories().values())
    if level:
        rows = [t for t in rows if t.level == level]
    if q:
        nq = norm(q)
        starts = [t for t in rows if t.name_norm.startswith(nq)]
        contains = [t for t in rows if nq in t.name_norm and t not in starts]
        rows = starts + contains
    else:
        order = {"cz": 0, "kraj": 1, "okres": 2, "orp": 3, "obec": 4}
        rows.sort(key=lambda t: (order.get(t.level, 9), -t.population))
        if not level:
            rows = [t for t in rows if t.level != "kraj" or t.kraj_code == HOME_KRAJ]
    if q:
        rows.sort(key=lambda t: (not t.name_norm.startswith(norm(q)), -t.population))
    return [_territory_row(t) for t in rows[:limit]]


@router.get("/territories/{tid}")
def territory_profile(tid: str) -> dict:
    p = profile(tid)
    if p is None:
        raise HTTPException(404, "Území nenalezeno")
    t = store.territory(tid)
    if t and t.level == "obec":
        from ..indicators import KHK_POINTS
        label = {code: name for code, name, _pillar in KHK_POINTS.values()}
        with SessionLocal() as s:
            rows = s.execute(select(Poi.kind, func.count()).where(Poi.obec_code == t.code).group_by(Poi.kind)).all()
        # Labelled here, where the registry lives: the browser had a copy of the
        # names that silently fell behind every layer added to Data KHK.
        p["pois"] = [{"kind": k, "label": label.get(k, k), "count": n} for k, n in sorted(rows, key=lambda r: -r[1])]
    return p


@router.get("/territories/{tid}/series/{code}")
def territory_series(tid: str, code: str) -> dict:
    s = store.series(tid, code)
    if not s:
        raise HTTPException(404, "Ukazatel nemá data")
    m = store.meta(code)
    ref = reference(tid)
    rs = store.series(ref, code) if ref and code in COMPARABLE else {}
    return {"meta": m, "series": [{"year": y, "value": s[y]} for y in sorted(s)], "trend": classify(s, m.get("polarity", 0)) if len(s) >= 5 else None,
            "reference": {"id": ref, "name": store.territory(ref).name if ref and store.territory(ref) else None,
                          "series": [{"year": y, "value": rs[y]} for y in sorted(rs)]} if rs else None}


@router.get("/territories/{tid}/pois")
def territory_pois(tid: str, kind: str = "") -> list[dict]:
    t = store.territory(tid)
    if t is None:
        raise HTTPException(404)
    with SessionLocal() as s:
        q = select(Poi)
        if t.level == "obec":
            q = q.where(Poi.obec_code == t.code)
        elif t.level == "orp":
            codes = [m.code for m in store.members("obec", parent=t.id)]
            q = q.where(Poi.obec_code.in_(codes))
        if kind:
            q = q.where(Poi.kind == kind)
        return [{"kind": p.kind, "name": p.name, "lon": p.lon, "lat": p.lat, "obec": p.obec_code, "attrs": {k: p.attrs[k] for k in list(p.attrs)[:12]},
                 "source_url": p.source_url} for p in s.scalars(q.limit(3000))]


@router.get("/compare")
def compare(a: str, b: str) -> dict:
    ta, tb = store.territory(a), store.territory(b)
    if not ta or not tb:
        raise HTTPException(404)
    rows = []
    for pillar, codes in PROFILE_CODES.items():
        for code in codes:
            if code not in COMPARABLE and code != "110900":
                continue
            ca, cb = card(a, code, ""), card(b, code, "")
            if ca and cb:
                rows.append({"pillar": pillar, "code": code, "name": ca["name"], "unit": ca["unit"], "polarity": ca["polarity"],
                             "a": {"value": ca["value"], "year": ca["year"], "trend": ca["trend"].get("label")},
                             "b": {"value": cb["value"], "year": cb["year"], "trend": cb["trend"].get("label")}})
    return {"a": _territory_row(ta), "b": _territory_row(tb), "rows": rows}


@router.get("/indicators")
def indicator_list() -> list[dict]:
    out = []
    for code in list(store.indicators()) + [d.code for d in DERIVED]:
        out.append(store.meta(code))
    return out


MAP_INDICATORS = ("d_podil_65", "d_podil_014", "d_index_stari", "d_migrace", "d_porodnost", "500020", "d_byty_1000", "d_pl_10k",
                  "d_ds_100_65", "d_dan_obyv", "d_les_podil", "113000", "110900", "d_zast_1000", "d_zs_trida", "khk_kanal_podil")


@router.get("/map/indicators")
def map_indicators() -> list[dict]:
    return [store.meta(c) for c in MAP_INDICATORS]


def _breaks(values: list[float], n: int = 5) -> list[float]:
    v = sorted(values)
    if not v:
        return []
    return [v[min(len(v) - 1, int(len(v) * i / n))] for i in range(1, n)]


@router.get("/map/cz")
def map_cz(indicator: str = "d_podil_65") -> dict:
    counts = dataset_counts()["by_region"]
    year, vals = store.cross_section("kraj", indicator)
    cz_val = store.latest("cz", indicator)
    rows = []
    for k in KRAJE:
        rows.append({"code": k.code, "id": f"kraj:{k.code}", "name": k.name, "datasets": counts.get(str(k.code), 0), "value": vals.get(f"kraj:{k.code}"),
                     "population": store.latest(f"kraj:{k.code}", "110900")[1] if store.latest(f"kraj:{k.code}", "110900") else None})
    return {"indicator": store.meta(indicator), "year": year, "national": cz_val[1] if cz_val else None, "national_datasets": counts.get("0", 0),
            "breaks": _breaks([r["value"] for r in rows if r["value"] is not None]), "kraje": rows}


@router.get("/map/khk")
def map_khk(indicator: str = "d_podil_65", level: str = "obec") -> dict:
    if level not in ("obec", "orp"):
        raise HTTPException(400)
    year, vals = store.cross_section(level, indicator, kraj_code=HOME_KRAJ)
    if not vals:
        # facility snapshots and census values sit in their own year
        vals = {}
        for t in store.members(level, HOME_KRAJ):
            lv = store.latest(t.id, indicator)
            if lv:
                vals[t.id], year = lv[1], lv[0]
    ref = store.latest(f"kraj:{HOME_KRAJ}", indicator)
    return {"indicator": store.meta(indicator), "year": year, "level": level, "reference": ref[1] if ref else None,
            "values": {k.split(":", 1)[1]: v for k, v in vals.items()}, "breaks": _breaks(list(vals.values()))}


@router.get("/finance/{tid}")
def finance_territory(tid: str) -> dict:
    """Hospodaření území: rozpočet po letech a hodnocení s uvedeným pravidlem."""
    t = store.territory(tid)
    if t is None:
        raise HTTPException(404, "Území neznámé.")
    data = finance.souhrn(tid)
    if not data["roky"]:
        raise HTTPException(404, "Pro toto území nemáme rozpočtová data.")
    return {"territory": {"id": t.id, "name": t.name, "level": t.level}, **data}


@router.get("/vydaje/{tid}")
def vydaje_territory(tid: str, rok: int | None = None) -> dict:
    """Za co území utrácí: výdaje po oddílech rozpočtové skladby, srovnání s obcemi stejné velikosti."""
    data = vydaje_mod.ucet(tid, rok)
    if data is None:
        raise HTTPException(404, "Území neznámé.")
    return data


@router.get("/dotace/{tid}")
def dotace_territory(tid: str) -> dict:
    """Čerpání dotací, krajské dotace do ORP a rozcestník vyhlašovatelů."""
    data = dotace_mod.prehled(tid)
    if not data:
        raise HTTPException(404, "Území neznámé.")
    return data


@router.get("/plany")
def plany_kraj() -> dict:
    """Kraj: kolik obcí má platný program rozvoje a kam vedou jejich registry."""
    return plany.prehled()


@router.get("/plany/{tid}")
def plany_uzemi(tid: str) -> dict:
    """Jedno území: plán, kolik z jeho období uplynulo, peníze a přesné odkazy."""
    data = plany.uzemi(tid)
    if data is None:
        raise HTTPException(404, "Území neznámé.")
    return data


@router.get("/geo/{name}")
def geo(name: str) -> JSONResponse:
    if name not in ("cz", "khk"):
        raise HTTPException(404)
    data = load_geo(name)
    if not data:
        raise HTTPException(503, "Hranice nejsou načtené — spusťte ingest.")
    return JSONResponse(data, headers={"Cache-Control": "public, max-age=86400"})


@router.get("/datasets")
def datasets(q: str = "", source: str = "", pillar: str = "", region: int | None = None, loaded: bool | None = None, freshness: str = "", status: str = "ok",
             page: int = Query(1, ge=1), size: int = Query(30, ge=1, le=200)) -> dict:
    with SessionLocal() as s:
        stmt = select(Dataset)
        if q:
            ids = [int(h["id"]) for h in rag.search(q, k=400, types=("dataset",), use_vectors=True)]
            if not ids:
                like = f"%{q}%"
                stmt = stmt.where(or_(Dataset.title.ilike(like), Dataset.keywords.ilike(like)))
            else:
                stmt = stmt.where(Dataset.id.in_(ids))
        if source:
            stmt = stmt.where(Dataset.source_id == source)
        if pillar:
            stmt = stmt.where(Dataset.pillar == pillar)
        if region is not None:
            stmt = stmt.where(Dataset.region_code == region)
        if loaded is not None:
            stmt = stmt.where(Dataset.loaded.is_(loaded))
        if freshness:
            stmt = stmt.where(Dataset.freshness == freshness)
        if status in ("ok", "chyba", "bez_odkazu", "neovereno"):
            stmt = stmt.where(Dataset.check_status == status)
        total = s.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        rows = s.scalars(stmt).all() if q else s.scalars(stmt.order_by(Dataset.loaded.desc(), Dataset.modified.desc()).offset((page - 1) * size).limit(size)).all()
        if q:
            order = {i: n for n, i in enumerate(ids)} if ids else {}
            rows = sorted(rows, key=lambda d: order.get(d.id, 10**6))[(page - 1) * size: page * size]
        items = [{"id": d.id, "title": d.title, "description": d.description[:300], "publisher": d.publisher, "source": d.source_id, "url": d.url,
                  "alt_url": d.alt_url, "download_url": d.download_url, "formats": d.formats, "pillar": d.pillar, "pillar_label": PILLARS.get(d.pillar, "Ostatní"),
                  "region": KRAJ_BY_CODE[d.region_code].short if d.region_code in KRAJ_BY_CODE else "ČR", "modified": d.modified, "periodicity": d.periodicity,
                  "freshness": d.freshness, "loaded": d.loaded, "usage": d.usage, "check_status": d.check_status, "check_code": d.check_code,
                  "checked_at": d.checked_at.isoformat() if d.checked_at else None} for d in rows]
    return {"total": total, "page": page, "size": size, "items": items}


@router.get("/datasets/export.csv")
def datasets_csv() -> StreamingResponse:
    def gen():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["id", "nazev", "poskytovatel", "zdroj", "oblast", "kraj", "odkaz", "odkaz_portal", "stazeni", "formaty", "aktualizace", "cerstvost", "nacteno_do_modelu", "vyuziti", "dostupnost", "http_kod"])
        yield "﻿" + buf.getvalue()
        with SessionLocal() as s:
            for d in s.scalars(select(Dataset).order_by(Dataset.source_id, Dataset.title)).yield_per(2000):
                buf.seek(0)
                buf.truncate()
                w.writerow([d.id, d.title, d.publisher, d.source_id, PILLARS.get(d.pillar, "Ostatní"), KRAJ_BY_CODE[d.region_code].name if d.region_code in KRAJ_BY_CODE else "ČR",
                            d.url, d.alt_url, d.download_url, d.formats, d.modified, d.freshness, "ano" if d.loaded else "ne", ", ".join(d.usage or []),
                            {"ok": "obsahuje data", "stranka": "webová stránka", "chyba": "prázdné nebo nedostupné", "bez_odkazu": "bez odkazu"}.get(d.check_status, "neověřeno"), d.check_code])
                yield buf.getvalue()
    return StreamingResponse(gen(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="kam-vyuzite-datove-sady.csv"'})


_aktualnost: dict = {}


@router.get("/aktualnost")
def aktualnost() -> dict:
    """Jak čerstvá jsou data: kdy proběhla obnova, kdy se zapisovaly hodnoty,
    kdy se zkoušely odkazy a za jaký rok jsou nejnovější statistiky ČSÚ.
    Postranní panel se ptá na každé stránce, proto minutová mezipaměť."""
    import time
    from ..refresh import aktualnost as spocitej
    if _aktualnost and time.time() - _aktualnost["at"] < 60:
        return _aktualnost["data"]
    data = spocitej()
    _aktualnost.update(at=time.time(), data=data)
    return data


@router.get("/sources")
def sources() -> dict:
    return dataset_counts()


@router.get("/puls")
def puls(limit: int = 30) -> dict:
    cutoff = (datetime.now(UTC) - timedelta(days=45)).date().isoformat()
    with SessionLocal() as s:
        events = s.scalars(select(Event).order_by(Event.published.desc()).limit(20)).all()
        fresh = s.execute(select(Dataset.title, Dataset.url, Dataset.modified, Dataset.publisher, Dataset.pillar).where(
            Dataset.modified >= cutoff, Dataset.region_code.in_([HOME_KRAJ, 0])).order_by(Dataset.modified.desc()).limit(limit)).all()
    items = [{"kind": "zmena_dat", "title": t, "url": u, "date": m, "publisher": p, "pillar": PILLARS.get(pl, "Ostatní")} for t, u, m, p, pl in fresh]
    ev = [{"kind": e.kind, "title": e.title, "detail": e.detail, "starts": e.starts, "ends": e.ends, "url": e.source_url, "published": e.published} for e in events]
    return {"datasets": items, "events": ev, "generated_at": datetime.now(UTC).isoformat()}


@router.get("/gaps")
def data_gaps() -> dict:
    cov = gaps.coverage()
    return {"coverage": {"matrix": cov["matrix"], "pillars": cov["pillars"], "health": cov["health"]}, "freshness": gaps.freshness(),
            "alerts": gaps.alerts(), "structural": gaps.structural()}


@router.get("/puvod")
def puvod(kody: str, rok: int | None = None, uzemi: str | None = None) -> dict:
    """Odkazy na konkrétní datové sady, ze kterých ukazatele pocházejí (štítek Fakt / Model)."""
    from ..analytics import puvod as puvod_mod
    seznam = [k.strip() for k in kody.split(",") if k.strip()][:12]
    return {"odkazy": puvod_mod.pro_vice(seznam, rok, uzemi)}


@router.get("/stats")
def stats() -> dict:
    counts = dataset_counts()
    with SessionLocal() as s:
        per_year = s.execute(select(Observation.year, func.count()).group_by(Observation.year).order_by(Observation.year)).all()
        per_pillar = s.execute(select(Indicator.pillar, func.count()).group_by(Indicator.pillar)).all()
        pois = s.execute(select(Poi.kind, func.count()).group_by(Poi.kind)).all()
        formats = s.execute(select(Dataset.formats, func.count()).group_by(Dataset.formats)).all()
        chats = s.scalar(select(func.count(ChatMessage.id)).where(ChatMessage.role == "user")) or 0
        blocked = s.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "ai_blocked")) or 0
        jobs = [{"name": j.name, "status": j.status, "detail": j.detail[:300], "progress": j.progress, "updated_at": j.updated_at.isoformat()} for j in s.scalars(select(JobState))]
        vectors = s.scalar(select(func.count(RagChunk.id)).where(RagChunk.vector.is_not(None))) or 0
        dokumenty = s.execute(select(Dokument.druh, func.count()).group_by(Dokument.druh)).all()
    fmt_counter: dict[str, int] = {}
    for f, n in formats:
        for part in (f or "").split(","):
            part = part.strip() or "neuvedeno"
            fmt_counter[part] = fmt_counter.get(part, 0) + n
    from ..indicators import KHK_POINTS
    kind_label = {v[0]: v[1] for v in KHK_POINTS.values()}
    return {
        "datasets": counts, "observations_per_year": [{"year": y, "count": n} for y, n in per_year],
        "indicators_per_pillar": [{"key": p, "label": PILLARS.get(p, p), "count": n} for p, n in per_pillar],
        "pois": [{"kind": k, "label": kind_label.get(k, k), "count": n} for k, n in sorted(pois, key=lambda x: -x[1])],
        "formats": sorted(({"format": k, "count": v} for k, v in fmt_counter.items()), key=lambda x: -x["count"])[:14],
        # Druh je klíč aplikace; popisek k němu patří sem, ne do stránky —
        # jinde by se rozešel s tím, co říká `analytics/plany.POVINNOSTI`.
        "dokumenty": [{"druh": d, "label": {"pro": "Programy rozvoje obcí",
                                            "upd": "Územní plány a jejich změny"}.get(d, d), "count": n}
                      for d, n in sorted(dokumenty, key=lambda x: -x[1])],
        "ai": {"questions": chats, "blocked": blocked, "rag": {**rag.stats(), "vectors": vectors}},
        "simulation": {"cache": simulate.cache_info(), "popular": simulate.popular(8)},
        "crowd": crowd.stats(), "jobs": jobs,
    }


@router.get("/methods")
def methods() -> list[dict]:
    from ..ai.knowledge import DOCS
    return [dict(d) for d in DOCS if d["id"].startswith(("metoda", "data", "pravni"))]


@router.get("/search")
def global_search(q: str) -> dict:
    """Jedno pole na všechno, co aplikace zná.

    Hledá se i podle kódu, ne jen podle jména: kód RÚIAN je to, čím se území
    klíčuje v API, v exportech i v cizích registrech, takže kdo ho má v ruce,
    hledá jím. Bez toho se vlastní identifikátor aplikace nedal dohledat
    v její vlastní vyhledávacím poli."""
    q = q.strip()
    if not q:
        return {"territories": [], "datasets": [], "methods": []}
    terr = territories(q=q, limit=8)
    if q.isdigit() and len(q) >= 3:
        znam = {t["id"] for t in terr}
        podle_kodu = [
            _territory_row(t) for t in store.territories().values()
            if str(t.code).startswith(q) and t.id not in znam
        ]
        podle_kodu.sort(key=lambda t: -(t["population"] or 0))
        terr = (terr + podle_kodu)[:8]
    hits = rag.search(q, k=20, types=("dataset", "method", "indicator"), use_vectors=False)
    return {"territories": terr, "datasets": [h for h in hits if h["type"] == "dataset"][:8],
            "methods": [h for h in hits if h["type"] in ("method", "indicator")][:6]}
