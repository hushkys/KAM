"""ČSÚ Městská a obecní statistika — the numeric backbone.

One CSV per year (~44 MB, every obec in Czechia, ~800 indicators). We stream
each file once and keep:

- every selected indicator for every obec of the home kraj, stored as-is,
- a small additive subset summed per kraj and for Czechia, for the national
  map and for "compared to the rest of the country".

ORP, okres and kraj values for the home kraj are aggregated from its obce with
the rule the indicator declares (`agg`), so a derived number is always
reproducible from the stored observations.
"""

from __future__ import annotations

import csv
import io
from collections import defaultdict

from sqlalchemy import delete, insert, select

from ..config import settings
from ..db import session_scope
from ..indicators import ALL_MOS_CODES, CZ_CODES, IND_BY_CODE, MOS, MOS_FILE, MOS_ORIGIN_URL, MOS_URL
from ..models import Indicator, Observation, Territory
from ..territory import HOME_KRAJ, tid
from . import geo
from .common import client, job

SOURCE_LABEL = "ČSÚ — Městská a obecní statistika (MOS)"


def _float(v: str) -> float | None:
    v = v.strip().strip('"')
    if not v or v == "i.d.":
        return None
    try:
        return float(v.replace(",", "."))
    except ValueError:
        return None


def aggregate(values: dict[str, float], agg: str, weights: dict[str, dict[str, float]]) -> float | None:
    """Roll obce up into a larger unit. `values` is obec -> value."""
    if not values:
        return None
    if agg == "sum":
        return float(sum(values.values()))
    if agg == "wavg_pop" or agg.startswith("wavg:"):
        wkey = "110900" if agg == "wavg_pop" else agg.split(":", 1)[1]
        w = weights.get(wkey, {})
        num = den = 0.0
        for obec, v in values.items():
            wt = w.get(obec)
            if wt:
                num += v * wt
                den += wt
        return num / den if den else None
    return None


def register_indicators() -> None:
    with session_scope() as s:
        for ind in MOS:
            row = s.get(Indicator, ind.code) or Indicator(code=ind.code)
            row.name, row.unit, row.pillar, row.polarity, row.agg = ind.name, ind.unit, ind.pillar, ind.polarity, ind.agg
            row.source_label, row.origin = SOURCE_LABEL, ind.origin
            row.source_url = MOS_URL
            s.merge(row)
        for code in ("420101",):
            row = s.get(Indicator, code) or Indicator(code=code)
            row.name, row.unit, row.pillar, row.polarity, row.agg = "Obyvatelé při SLDB 2021", "osob", "demografie", 0, "sum"
            row.source_label, row.origin, row.source_url = SOURCE_LABEL, "ČSÚ, SLDB 2021", MOS_URL
            s.merge(row)


def ingest(first: int | None = None, last: int | None = None) -> dict[str, int]:
    first = first or settings.mos_first_year
    last = last or settings.mos_last_year
    register_indicators()
    admin = geo.load("admin")
    if not admin:
        raise RuntimeError("Nejdřív spusť ingest hranic (geo).")
    obec_to_kraj = dict(admin["obec_to_kraj"])
    # RÚIAN leaves the okres empty for a few obce (Praha is its own okres);
    # MOS's territory codebook names the okres, so resolve the gaps through it.
    try:
        by_name = {v: int(k) for k, v in admin["okres_names"].items()}
        uz = client(60).get(f"{MOS_FILE}mos_uzemi.csv")
        for row in csv.DictReader(io.StringIO(uz.content.decode("utf-8-sig"))):
            code = row["koduzemi"].strip('"')
            okres_name = row["okres"].strip('"')
            if obec_to_kraj.get(code) or str(row.get("platido", "")).strip('"') != "9999":
                continue
            # Praha is a kraj without an okres; never resolve it by a fuzzy
            # okres name ("Praha-východ" is Středočeský kraj).
            if code == "554782" or okres_name.startswith("Hlavní město Praha"):
                obec_to_kraj[code] = 19
                continue
            okres = by_name.get(okres_name)
            kraj = admin["okres_to_kraj"].get(str(okres)) if okres else None
            if kraj:
                obec_to_kraj[code] = kraj
    except Exception as e:
        job("mos", "running", f"Číselník území MOS nedostupný: {e}")
    with session_scope() as s:
        khk = {t.code: t for t in s.scalars(select(Territory).where(Territory.level == "obec", Territory.kraj_code == HOME_KRAJ))}
    khk_codes = set(khk)
    keep_khk = set(ALL_MOS_CODES)
    keep_cz = set(CZ_CODES) | {"110900", "110930", "110990", "140100"}
    groups: dict[str, list[str]] = defaultdict(list)  # territory id -> obce
    for code, t in khk.items():
        groups[t.orp_id].append(code)
        groups[t.okres_id].append(code)
        groups[tid("kraj", HOME_KRAJ)].append(code)

    c = client(600)
    stats = {"rows": 0, "years": 0}
    for i, year in enumerate(range(first, last + 1)):
        job("mos", "running", f"MOS {year}", i / (last - first + 1))
        url = f"{MOS_FILE}mos_data_{year}.csv"
        khk_vals: dict[str, dict[str, float]] = defaultdict(dict)  # indicator -> obec -> value
        cz_vals: dict[str, dict[str, float]] = defaultdict(dict)
        try:
            with c.stream("GET", url) as resp:
                if resp.status_code != 200:
                    continue
                lines = (ln.lstrip("﻿") for ln in resp.iter_lines() if ln)
                reader = csv.reader(lines)
                next(reader, None)
                for row in reader:
                    if len(row) < 4:
                        continue
                    ind, obec = row[1], row[2]
                    if ind not in keep_khk and ind not in keep_cz:
                        continue
                    v = _float(row[3])
                    if v is None:
                        continue
                    if obec in khk_codes and ind in keep_khk:
                        khk_vals[ind][obec] = v
                    if ind in keep_cz:
                        cz_vals[ind][obec] = v
        except Exception as e:  # a missing year must not kill the others
            job("mos", "running", f"MOS {year}: {e}")
            continue
        if not khk_vals:
            continue
        stats["years"] += 1
        # pop 15–64 as weight for the unemployment share
        for store in (khk_vals, cz_vals):
            pop, kids, old = store.get("110900", {}), store.get("110930", {}), store.get("110990", {})
            store["pop1564"] = {o: pop[o] - kids.get(o, 0) - old.get(o, 0) for o in pop}
        rows: list[dict] = []
        for ind, per_obec in khk_vals.items():
            if ind == "pop1564":
                continue
            for obec, v in per_obec.items():
                rows.append({"territory_id": tid("obec", obec), "indicator_code": ind, "year": year, "value": v})
            spec = IND_BY_CODE.get(ind)
            agg = spec.agg if spec else "sum"
            for terr, members in groups.items():
                if terr.startswith("kraj:"):
                    continue  # the kraj comes from the national pass below, same numbers
                sub = {o: per_obec[o] for o in members if o in per_obec}
                val = aggregate(sub, agg, khk_vals)
                if val is not None:
                    rows.append({"territory_id": terr, "indicator_code": ind, "year": year, "value": round(val, 4)})
        # national map: every kraj + Czechia
        by_kraj: dict[int, list[str]] = defaultdict(list)
        for obec in cz_vals.get("110900", {}):
            by_kraj[obec_to_kraj.get(obec, 0)].append(obec)
        home_extra = keep_khk - keep_cz  # indicators only we aggregate for the home kraj
        for ind, per_obec in cz_vals.items():
            if ind == "pop1564":
                continue
            spec = IND_BY_CODE.get(ind)
            agg = spec.agg if spec else "sum"
            for kraj, members in by_kraj.items():
                if not kraj:
                    continue
                val = aggregate({o: per_obec[o] for o in members if o in per_obec}, agg, cz_vals)
                if val is not None:
                    rows.append({"territory_id": tid("kraj", kraj), "indicator_code": ind, "year": year, "value": round(val, 4)})
            val = aggregate(per_obec, agg, cz_vals)
            if val is not None:
                rows.append({"territory_id": "cz", "indicator_code": ind, "year": year, "value": round(val, 4)})
        for ind in home_extra:
            per_obec = khk_vals.get(ind)
            if not per_obec:
                continue
            spec = IND_BY_CODE.get(ind)
            val = aggregate(per_obec, spec.agg if spec else "sum", khk_vals)
            if val is not None:
                rows.append({"territory_id": tid("kraj", HOME_KRAJ), "indicator_code": ind, "year": year, "value": round(val, 4)})
        with session_scope() as s:
            codes = list(keep_khk | keep_cz)
            s.execute(delete(Observation).where(Observation.year == year, Observation.indicator_code.in_(codes)))
            for chunk in range(0, len(rows), 5000):
                s.execute(insert(Observation), rows[chunk:chunk + 5000])
        stats["rows"] += len(rows)
    # latest population onto the territory rows (search ranking, map sizing)
    with session_scope() as s:
        latest = s.execute(select(Observation.territory_id, Observation.year, Observation.value).where(Observation.indicator_code == "110900")).all()
        best: dict[str, tuple[int, float]] = {}
        for t, y, v in latest:
            if t not in best or y > best[t][0]:
                best[t] = (y, v)
        for t in s.scalars(select(Territory)):
            if t.id in best:
                t.population = int(best[t.id][1])
    job("mos", "done", str(stats), 1.0)
    return stats


def origin_url(origin: str) -> str:
    return MOS_ORIGIN_URL.get(origin, MOS_URL)
