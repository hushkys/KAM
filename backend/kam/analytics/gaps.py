"""Layer 4 — watching the data itself.

Three independent signals, none of them hand-written:

1. Coverage — for every ORP × pillar, the share of its obce that have a
   value for the pillar's indicators in the latest published year.
2. Freshness — datasets whose declared update period has lapsed, per pillar,
   from the catalogue harvest.
3. Structural gaps — questions the model has to answer with an assumption
   because no open dataset carries the fact (listed explicitly with the
   assumption that stands in for it), plus what citizens reported as missing.

Alerts are raised before a gap bites: an indicator whose latest year is two
or more years behind the others, a pillar whose regional datasets are mostly
past their update date, a sudden drop in coverage.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime

from sqlalchemy import func, select

from ..db import SessionLocal
from ..indicators import PILLARS
from ..models import Cluster, Dataset, Observation, Report
from ..territory import HOME_KRAJ
from . import store
from .profile import PROFILE_CODES

STRUCTURAL_GAPS = (
    {"pillar": "skolstvi", "title": "Povolené kapacity škol", "text": "Model zná počet tříd a žáků (MŠMT přes ČSÚ), ne kapacitu zapsanou v rejstříku škol. Kapacitu odhaduje jako počet tříd × zákonné maximum.", "assumption": "max_zs_trida"},
    {"pillar": "doprava", "title": "Jízdní řády a dojezdové časy", "text": "Model zatím nevyužívá jízdní řády. Dostupnost dopravy měří hustotou zastávek a daty o vyjížďce, ne dojezdovým časem.", "assumption": ""},
    {"pillar": "bydleni", "title": "Rozpracovaná výstavba a územní rezervy", "text": "Dokončené byty jsou známé, rozestavěné a plánované ne. Scénáře výstavby zadává uživatel.", "assumption": ""},
    {"pillar": "zdravotnictvi", "title": "Kapacita ordinací (registrovaní pacienti)", "text": "Počet ordinací je známý, počet registrovaných pacientů a volná kapacita ne.", "assumption": ""},
    {"pillar": "socialni", "title": "Čekatelé na sociální služby", "text": "Kapacity domovů jsou známé, pořadníky čekatelů nejsou publikovány jako otevřená data.", "assumption": ""},
)


def _raw_codes(pillar: str) -> list[str]:
    from ..indicators import DERIVED_BY_CODE
    out = []
    for c in PROFILE_CODES.get(pillar, ()):
        d = DERIVED_BY_CODE.get(c)
        out.extend([d.num, d.den] if d else [c])
    return list(dict.fromkeys(out))


def coverage(kraj_code: int = HOME_KRAJ) -> dict:
    obce = store.members("obec", kraj_code)
    by_orp: dict[str, list[str]] = defaultdict(list)
    for t in obce:
        by_orp[t.orp_id].append(t.id)
    ids = {t.id for t in obce}
    this_year = datetime.now(UTC).year
    with SessionLocal() as s:
        latest_year = dict(s.execute(select(Observation.indicator_code, func.max(Observation.year)).group_by(Observation.indicator_code)).all())
        have: dict[str, set[str]] = defaultdict(set)
        for code, year in latest_year.items():
            for (terr,) in s.execute(select(Observation.territory_id).where(Observation.indicator_code == code, Observation.year == year)):
                if terr in ids:
                    have[code].add(terr)
    matrix = []
    pillar_scores: dict[str, list[float]] = defaultdict(list)
    for orp_id, members in sorted(by_orp.items(), key=lambda kv: store.territory(kv[0]).name if store.territory(kv[0]) else kv[0]):
        row = {"territory": {"id": orp_id, "name": store.territory(orp_id).name if store.territory(orp_id) else orp_id}, "cells": []}
        for pillar in PILLARS:
            codes = [c for c in _raw_codes(pillar) if c in latest_year]
            if not codes:
                row["cells"].append({"pillar": pillar, "score": 0, "missing": _raw_codes(pillar)})
                pillar_scores[pillar].append(0)
                continue
            parts, missing = [], []
            for c in codes:
                share = len(have[c] & set(members)) / len(members)
                age = this_year - latest_year[c]
                fresh = 1.0 if age <= 2 else 0.75 if age <= 3 else 0.5 if age <= 5 else 0.3
                parts.append(share * fresh)
                if share < 0.9:
                    missing.append(c)
            score = round(100 * sum(parts) / len(parts))
            row["cells"].append({"pillar": pillar, "score": score, "missing": missing})
            pillar_scores[pillar].append(score)
        matrix.append(row)
    pillars = [{"key": p, "label": PILLARS[p], "score": round(sum(v) / len(v)) if v else 0} for p, v in pillar_scores.items()]
    health = round(sum(p["score"] for p in pillars) / len(pillars)) if pillars else 0
    return {"matrix": matrix, "pillars": pillars, "health": health, "latest_year": latest_year}


def freshness() -> dict:
    with SessionLocal() as s:
        rows = s.execute(select(Dataset.pillar, Dataset.region_code, Dataset.freshness, func.count()).group_by(Dataset.pillar, Dataset.region_code, Dataset.freshness)).all()
        stale = s.execute(select(Dataset.title, Dataset.url, Dataset.pillar, Dataset.modified, Dataset.periodicity).where(
            Dataset.region_code == HOME_KRAJ, Dataset.freshness == "zastarala").order_by(Dataset.modified).limit(400)).all()
    agg: dict[str, Counter] = defaultdict(Counter)
    for pillar, region, fresh, n in rows:
        if region == HOME_KRAJ:
            agg[pillar][fresh] += n
    out = []
    for p in list(PILLARS) + ["ostatni"]:
        c = agg.get(p, Counter())
        known = c["aktualni"] + c["zastarala"]
        out.append({"pillar": p, "label": PILLARS.get(p, "Ostatní"), "total": sum(c.values()), "fresh": c["aktualni"], "stale": c["zastarala"],
                    "unknown": c["neznama"], "fresh_share": round(c["aktualni"] / known, 3) if known else None})
    by_pillar: dict[str, list[dict]] = defaultdict(list)
    for title, url, pillar, modified, period in stale:
        if len(by_pillar[pillar]) < 6:
            by_pillar[pillar].append({"title": title, "url": url, "modified": modified, "periodicity": period})
    return {"pillars": out, "stale_examples": by_pillar}


def alerts() -> list[dict]:
    cov = coverage()
    fr = freshness()
    out: list[dict] = []
    latest = cov["latest_year"]
    newest = max(latest.values()) if latest else 0
    from ..indicators import IND_BY_CODE
    for code, y in sorted(latest.items(), key=lambda kv: kv[1]):
        spec = IND_BY_CODE.get(code)
        if not spec or code.startswith("42"):
            continue  # census indicators are a 2021 snapshot by design
        if newest - y >= 2:
            out.append({"level": "vysoke" if newest - y >= 3 else "stredni", "pillar": spec.pillar, "kind": "zpozdeni",
                        "title": f"Zpožděná data: {spec.name}", "text": f"Poslední hodnota je z roku {y}, ostatní ukazatele už mají rok {newest}."})
    for p in fr["pillars"]:
        if p["fresh_share"] is not None and p["total"] >= 10 and p["fresh_share"] < 0.5:
            out.append({"level": "stredni", "pillar": p["pillar"], "kind": "cerstvost",
                        "title": f"{p['label']}: většina sad kraje po termínu aktualizace",
                        "text": f"{p['stale']} z {p['fresh'] + p['stale']} datových sad Královéhradeckého kraje s deklarovanou periodicitou nebylo aktualizováno včas."})
    for cell_row in cov["matrix"]:
        for cell in cell_row["cells"]:
            if cell["score"] < 50:
                out.append({"level": "sledovat", "pillar": cell["pillar"], "kind": "pokryti",
                            "title": f"{cell_row['territory']['name']}: nízké pokrytí ({PILLARS[cell['pillar']]})",
                            "text": f"Pokrytí {cell['score']} %. Chybí data pro část obcí správního obvodu."})
    with SessionLocal() as s:
        wanted = s.execute(select(Cluster.title, Cluster.count, Cluster.category).join(Report, Report.cluster_id == Cluster.id).where(
            Report.kind == "chybejici_data").group_by(Cluster.id)).all()
    for title, count, category in wanted:
        out.append({"level": "stredni" if count >= 3 else "sledovat", "pillar": category, "kind": "podnet",
                    "title": f"Občané hlásí chybějící data: {title}", "text": f"{count} podnětů."})
    order = {"kriticke": 0, "vysoke": 1, "stredni": 2, "sledovat": 3, "nizke": 4}
    out.sort(key=lambda a: order.get(a["level"], 5))
    return out


def structural() -> list[dict]:
    from .simulate import ASSUMPTIONS
    return [{**g, "pillar_label": PILLARS[g["pillar"]], "assumption_value": ASSUMPTIONS.get(g["assumption"], {}).get("value") if g["assumption"] else None}
            for g in STRUCTURAL_GAPS]
