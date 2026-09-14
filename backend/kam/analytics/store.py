"""Read side of the observation table, with the derived ratios on top.

Every profile, risk and forecast reads through here, so there is one
definition of "the value of indicator X in territory T in year Y" —
including derived ratios, which are computed per year from their numerator
and denominator series and never stored.

Per-territory series are cached in memory; the cache is dropped whenever an
ingest finishes (`reset()`), so a fresh harvest is visible without restart.
"""

from __future__ import annotations

import threading
from collections import defaultdict

from sqlalchemy import func, select

from ..db import SessionLocal
from ..indicators import DERIVED_BY_CODE, IND_BY_CODE
from ..models import Fact, Indicator, Observation, Territory

_lock = threading.Lock()
_series: dict[str, dict[str, dict[int, float]]] = {}
_cross: dict[tuple[str, str, int], dict[str, float]] = {}
_territories: dict[str, Territory] = {}
_indicators: dict[str, Indicator] = {}


def reset() -> None:
    with _lock:
        _series.clear()
        _cross.clear()
        _territories.clear()
        _indicators.clear()


def territories() -> dict[str, Territory]:
    if not _territories:
        with SessionLocal() as s:
            rows = {t.id: t for t in s.scalars(select(Territory))}
        with _lock:
            _territories.update(rows)
    return _territories


def territory(tid: str) -> Territory | None:
    return territories().get(tid)


def indicators() -> dict[str, Indicator]:
    if not _indicators:
        with SessionLocal() as s:
            rows = {i.code: i for i in s.scalars(select(Indicator))}
        with _lock:
            _indicators.update(rows)
    return _indicators


def _load(tid: str) -> dict[str, dict[int, float]]:
    cached = _series.get(tid)
    if cached is not None:
        return cached
    out: dict[str, dict[int, float]] = defaultdict(dict)
    with SessionLocal() as s:
        for code, year, value in s.execute(
            select(Observation.indicator_code, Observation.year, Observation.value).where(Observation.territory_id == tid)
        ):
            out[code][year] = value
    with _lock:
        _series[tid] = dict(out)
    return _series[tid]


def raw_series(tid: str, code: str) -> dict[int, float]:
    return dict(_load(tid).get(code, {}))


def series(tid: str, code: str) -> dict[int, float]:
    d = DERIVED_BY_CODE.get(code)
    if d is None:
        return raw_series(tid, code)
    num, den = raw_series(tid, d.num), raw_series(tid, d.den)
    if d.den == "420101" and not den:
        # SLDB 2021 denominator: fall back to the resident count of that year
        den = {y: v for y, v in raw_series(tid, "110900").items() if y == 2021}
    out = {}
    for y, n in num.items():
        dv = den.get(y)
        if dv is None and d.num.startswith("khk_"):
            # facility layers are a snapshot; divide by the latest population
            if den:
                dv = den[max(den)]
        if dv:
            out[y] = round(n / dv * d.scale, 4)
    return out


def latest(tid: str, code: str) -> tuple[int, float] | None:
    s = series(tid, code)
    if not s:
        return None
    y = max(s)
    return y, s[y]


def value(tid: str, code: str, year: int) -> float | None:
    return series(tid, code).get(year)


def all_codes(tid: str) -> list[str]:
    return list(_load(tid).keys())


def members(level: str, kraj_code: int | None = None, parent: str | None = None) -> list[Territory]:
    out = [t for t in territories().values() if t.level == level]
    if kraj_code is not None:
        out = [t for t in out if t.kraj_code == kraj_code]
    if parent:
        out = [t for t in out if parent in (t.parent_id, t.orp_id, t.okres_id)]
    return out


def cross_section(level: str, code: str, year: int | None = None, kraj_code: int | None = None) -> tuple[int | None, dict[str, float]]:
    """Value of one indicator for every territory of a level (latest common year)."""
    d = DERIVED_BY_CODE.get(code)
    base_code = d.num if d else code
    if year is None:
        with SessionLocal() as s:
            year = s.scalar(select(func.max(Observation.year)).where(Observation.indicator_code == base_code))
        if year is None:
            return None, {}
    key = (level, code, year)
    if key in _cross and kraj_code is None:
        return year, _cross[key]
    ids = {t.id for t in members(level, kraj_code)}
    if d is None:
        with SessionLocal() as s:
            rows = s.execute(select(Observation.territory_id, Observation.value).where(
                Observation.indicator_code == code, Observation.year == year)).all()
        out = {t: v for t, v in rows if t in ids}
    else:
        out = {}
        for t in ids:
            v = value(t, code, year)
            if v is None and d.num.startswith("khk_"):
                lt = latest(t, code)
                v = lt[1] if lt else None
            if v is not None:
                out[t] = v
    if kraj_code is None:
        _cross[key] = out
    return year, out


def facts(tid: str) -> dict[str, dict]:
    with SessionLocal() as s:
        return {f.key: {"value": f.value, "source_url": f.source_url, "as_of": f.as_of}
                for f in s.scalars(select(Fact).where(Fact.territory_id == tid))}


def meta(code: str) -> dict:
    d = DERIVED_BY_CODE.get(code)
    if d:
        return {"code": code, "name": d.name, "unit": d.unit, "pillar": d.pillar, "polarity": d.polarity,
                "derived": True, "formula": d.explain, "inputs": [d.num, d.den]}
    ind = indicators().get(code)
    spec = IND_BY_CODE.get(code)
    if ind:
        return {"code": code, "name": ind.name, "unit": ind.unit, "pillar": ind.pillar, "polarity": ind.polarity,
                "derived": False, "source": ind.source_label, "origin": ind.origin, "source_url": ind.source_url}
    if spec:
        return {"code": code, "name": spec.name, "unit": spec.unit, "pillar": spec.pillar, "polarity": spec.polarity, "derived": False}
    return {"code": code, "name": code, "unit": "", "pillar": "ostatni", "polarity": 0, "derived": False}
