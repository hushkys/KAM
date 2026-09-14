"""Population outlook 2026–2040 in three scenarios.

A component model, not a curve fit: next year's population is this year's
plus births, minus deaths, plus net migration, each as a rate of the
population. The rates are not frozen — they move with the age structure the
territory is heading into, which is what bends the curve:

- births scale with the share of people aged 15–64 (fewer adults of
  child-bearing age, fewer births),
- deaths scale with the share aged 65+ (an older population has a higher
  crude death rate),
- net migration drifts from its recent median towards its long-term median.

Scenario rates come from the territory's own last ten years:
pravděpodobný = medians, optimistický / rizikový = favourable / unfavourable
quartile of each rate. Small obce are shrunk towards their ORP with weight
P / (P + 2 000).

Years are not smooth in reality, so the band is not a formula: 400 Monte
Carlo runs re-draw each year's rates from the territory's own historical
year-to-year deviations (bootstrap, seeded per territory so results repeat).
The 5th–95th percentile of those runs is the 90 % band, and three of the runs
are returned as example paths with realistic yearly swings. `backtest()`
re-runs the model as if it were 2020 and scores it on the published years.
"""

from __future__ import annotations

import math
import zlib
from statistics import median

import numpy as np

from . import store
from .trends import theil_sen

LAST_YEAR = 2040
HISTORY_WINDOW = 10
LONG_WINDOW = 15
SHRINK_K = 2000.0
RUNS = 400
MIGRATION_HALF_LIFE = 8.0


def _quantile(values: list[float], q: float) -> float:
    v = sorted(values)
    if not v:
        return 0.0
    pos = (len(v) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return v[lo] + (v[hi] - v[lo]) * (pos - lo)


def _rates(tid: str, until: int | None = None, window: int = HISTORY_WINDOW) -> dict[str, list[float]]:
    pop_mid = store.raw_series(tid, "111000") or store.raw_series(tid, "110900")
    comp = {"b": store.raw_series(tid, "110200"), "d": store.raw_series(tid, "110300"), "m": store.raw_series(tid, "110600")}
    years = [y for y in sorted(pop_mid) if (until is None or y <= until) and all(y in s for s in comp.values())][-window:]
    return {k: [comp[k][y] / pop_mid[y] for y in years if pop_mid.get(y)] for k in comp}


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def _inv_logit(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def _share_trend(tid: str, code: str, until: int | None) -> tuple[float, float, int] | None:
    num, den = store.raw_series(tid, code), store.raw_series(tid, "110900")
    pts = [(y, num[y] / den[y]) for y in sorted(num) if den.get(y) and (until is None or y <= until)][-HISTORY_WINDOW:]
    if len(pts) < 4:
        return None
    xs = [float(y) for y, _ in pts]
    ys = [_logit(v) for _, v in pts]
    b, a = theil_sen(xs, ys)
    return a, b, pts[-1][0]


def _paths(p0: float, years: list[int], b: float, d: float, m: float, m_long: float, s14: list[float], s65: list[float],
           shocks: np.ndarray | None = None, parts: list[dict] | None = None) -> np.ndarray:
    """Vectorised component model. `shocks` is (runs, years, 3) or None.

    `parts` collects each year's three components as people rather than rates,
    for the deterministic run only. The model knows why a population moves —
    births, deaths, migration — and without this the API published only the
    result, so the UI could show the curve but never what made it.
    """
    s1564 = [1 - k - o for k, o in zip(s14, s65, strict=True)]
    base1564, base65 = s1564[0], s65[0]
    runs = 1 if shocks is None else shocks.shape[0]
    pop = np.full(runs, float(p0))
    out = np.zeros((runs, len(years) - 1))
    for i in range(1, len(years)):
        h = years[i] - years[0]
        bt = b * (s1564[i] / base1564)
        dt = d * (s65[i] / base65) ** 0.9
        mt = m + (m_long - m) * (1 - math.exp(-h / MIGRATION_HALF_LIFE))
        rate = bt - dt + mt
        if shocks is not None:
            rate = rate + shocks[:, i - 1, 0] - shocks[:, i - 1, 1] + shocks[:, i - 1, 2]
        before = float(pop[0])
        pop = np.maximum(pop * (1 + rate), 0.0)
        out[:, i - 1] = pop
        if parts is not None:
            parts.append({"year": years[i], "births": round(before * bt),
                          "deaths": round(before * dt), "migration": round(before * mt)})
    return out


def project(tid: str, until: int | None = None, last_year: int = LAST_YEAR) -> dict:
    t = store.territory(tid)
    pop = store.raw_series(tid, "110900")
    base_years = sorted(y for y in pop if until is None or y <= until)
    if len(base_years) < 5:
        return {"available": False, "reason": "Pro území chybí dostatečná časová řada počtu obyvatel."}
    y0 = base_years[-1]
    p0 = pop[y0]
    rates = _rates(tid, until)
    if min(len(v) for v in rates.values()) < 3:
        return {"available": False, "reason": "Chybí složky pohybu obyvatel (narození, zemřelí, migrace)."}

    parent = t.orp_id if t and t.level == "obec" else ""
    parent_rates = _rates(parent, until) if parent else None
    use_parent = parent_rates is not None and min(len(v) for v in parent_rates.values()) >= 3
    w = p0 / (p0 + SHRINK_K) if use_parent else 1.0

    def blend(key: str, q: float, src: dict[str, list[float]] = rates, par: dict[str, list[float]] | None = parent_rates) -> float:
        own = _quantile(src[key], q)
        return own if w >= 1.0 or par is None else w * own + (1 - w) * _quantile(par[key], q)

    long = _rates(tid, until, LONG_WINDOW)
    long_parent = _rates(parent, until, LONG_WINDOW) if use_parent else None
    m_long = blend("m", 0.5, long, long_parent)

    scen = {
        "pravdepodobny": {"b": blend("b", 0.5), "d": blend("d", 0.5), "m": blend("m", 0.5)},
        "optimisticky": {"b": blend("b", 0.75), "d": blend("d", 0.25), "m": blend("m", 0.75)},
        "rizikovy": {"b": blend("b", 0.25), "d": blend("d", 0.75), "m": blend("m", 0.25)},
    }

    kids = _share_trend(tid, "110930", until)
    old = _share_trend(tid, "110990", until)
    years = list(range(y0, last_year + 1))
    last_kids = store.raw_series(tid, "110930").get(y0)
    last_old = store.raw_series(tid, "110990").get(y0)
    s14 = [_inv_logit(kids[0] + kids[1] * y) if kids else (last_kids / p0 if last_kids else 0.15) for y in years]
    s65 = [_inv_logit(old[0] + old[1] * y) if old else (last_old / p0 if last_old else 0.2) for y in years]

    # Year-to-year deviations of the three rates, for the Monte Carlo band.
    # One-off shocks (the 2022 refugee wave pushed migration to six times its
    # usual rate) would otherwise be redrawn as if they could recur any year,
    # so deviations are taken from the median and clipped at 2.5 robust
    # standard deviations, then re-centred so the band sits on the main path.
    n = min(len(rates["b"]), len(rates["d"]), len(rates["m"]))
    cols = []
    for k in ("b", "d", "m"):
        v = np.array(rates[k][:n])
        d = v - np.median(v)
        spread = 1.4826 * np.median(np.abs(d)) or float(np.std(d))
        d = np.clip(d, -2.5 * spread, 2.5 * spread)
        cols.append(d - d.mean())
    dev = np.stack(cols, axis=1)
    if w < 1.0:
        dev = dev * math.sqrt(w)  # shrunk rates are less volatile than the raw village series
    rng = np.random.default_rng(zlib.crc32(f"{tid}|{until}".encode()))
    shocks = dev[rng.integers(0, n, size=(RUNS, len(years) - 1))]
    r = scen["pravdepodobny"]
    mc = _paths(p0, years, r["b"], r["d"], r["m"], m_long, s14, s65, shocks)
    lo_band = np.percentile(mc, 5, axis=0)
    hi_band = np.percentile(mc, 95, axis=0)

    out_scen: dict[str, list[dict]] = {}
    for name, rr in scen.items():
        parts: list[dict] = []
        det = _paths(p0, years, rr["b"], rr["d"], rr["m"], m_long, s14, s65, parts=parts)[0]
        by_year = {p["year"]: p for p in parts}
        rows = []
        for i, year in enumerate(years[1:]):
            p = float(det[i])
            c = by_year.get(year, {})
            rows.append({
                "year": year, "population": round(p),
                "lower": round(min(p, float(lo_band[i]))), "upper": round(max(p, float(hi_band[i]))),
                "age_65": round(p * s65[i + 1]), "age_0_14": round(p * s14[i + 1]),
                "share_65": round(100 * s65[i + 1], 1), "share_0_14": round(100 * s14[i + 1], 1),
                "births": c.get("births", 0), "deaths": c.get("deaths", 0), "migration": c.get("migration", 0),
            })
        out_scen[name] = rows

    # Three example runs: the ones ending nearest the 20th, 50th and 80th percentile.
    finals = mc[:, -1]
    picks = [int(np.argmin(np.abs(finals - np.percentile(finals, q)))) for q in (20, 50, 80)]
    paths = [[{"year": years[i + 1], "population": round(float(mc[k, i]))} for i in range(len(years) - 1)] for k in picks]

    history = [{"year": y, "population": pop[y], "age_65": store.raw_series(tid, "110990").get(y),
                "age_0_14": store.raw_series(tid, "110930").get(y)} for y in base_years]

    def fmt(v: float) -> str:
        return f"{1000 * v:.2f} ‰".replace(".", ",")

    growth = [(pop[b] - pop[a]) / pop[a] for a, b in zip(base_years, base_years[1:], strict=False) if pop[a]][-15:]
    assumptions = [
        f"Výchozí stav: {int(p0):,} obyvatel k 31. 12. {y0} (ČSÚ, MOS).".replace(",", " "),
        f"Míry z posledních {n} let (medián): porodnost {fmt(r['b'])}, úmrtnost {fmt(r['d'])}, saldo migrace {fmt(r['m'])}.",
        "Porodnost se mění s podílem obyvatel 15–64 let, úmrtnost s podílem 65+; migrace se postupně vrací k dlouhodobému mediánu "
        f"({fmt(m_long)}, poločas {int(MIGRATION_HALF_LIFE)} let).",
        "Optimistický a rizikový scénář používají příznivý / nepříznivý kvartil každé míry.",
        "Věková struktura se posouvá podle trendu podílů 0–14 a 65+ (Theil–Sen na logitové škále).",
        f"Pásmo je 5.–95. percentil z {RUNS} simulací Monte Carlo, které každý rok losují odchylky měr z historie území.",
    ]
    if w < 1.0:
        assumptions.append(f"Malé území: míry kombinovány s mírami ORP (váha vlastních dat {w:.0%}).")
    return {
        "available": True, "territory": tid, "base_year": y0, "base_population": p0, "history": history,
        "scenarios": out_scen, "paths": paths,
        "rates": {k: {m: round(v, 6) for m, v in rr.items()} for k, rr in scen.items()},
        "assumptions": assumptions, "method": "Komponentní model s měrami závislými na věkové struktuře a pásmem z Monte Carlo simulace",
        "kind": "MODEL", "sd_growth": round(float(np.std(growth)) if len(growth) > 2 else 0.0, 5), "shrink_weight": round(w, 3),
    }


def at(result: dict, scenario: str, year: int) -> dict | None:
    for row in result.get("scenarios", {}).get(scenario, []):
        if row["year"] == year:
            return row
    return None


def backtest(tid: str, cutoff: int = 2020) -> dict:
    """Pretend it is `cutoff`, project, compare with what ČSÚ later published."""
    pop = store.raw_series(tid, "110900")
    actual_years = [y for y in sorted(pop) if y > cutoff]
    if not actual_years:
        return {"available": False}
    res = project(tid, until=cutoff, last_year=max(actual_years))
    if not res.get("available"):
        return {"available": False}
    rows = {r["year"]: r for r in res["scenarios"]["pravdepodobny"]}
    errs, inside = [], 0
    points = []
    for y in actual_years:
        r = rows.get(y)
        if not r:
            continue
        errs.append(abs(r["population"] - pop[y]) / pop[y])
        inside += r["lower"] <= pop[y] <= r["upper"]
        points.append({"year": y, "actual": pop[y], "predicted": r["population"], "lower": r["lower"], "upper": r["upper"]})
    if not errs:
        return {"available": False}
    return {"available": True, "cutoff": cutoff, "mape": round(100 * sum(errs) / len(errs), 2),
            "max_error": round(100 * max(errs), 2), "coverage": round(inside / len(errs), 2), "points": points}


def summary(tid: str) -> dict:
    res = project(tid)
    if not res.get("available"):
        return res
    out = {"base_year": res["base_year"], "base_population": res["base_population"], "milestones": []}
    for y in (2030, 2035, 2040):
        row = {s: at(res, s, y) for s in ("pravdepodobny", "optimisticky", "rizikovy")}
        mid = row["pravdepodobny"]
        if mid:
            out["milestones"].append({
                "year": y, "population": mid["population"], "lower": mid["lower"], "upper": mid["upper"],
                "optimistic": row["optimisticky"]["population"] if row["optimisticky"] else None,
                "risk": row["rizikovy"]["population"] if row["rizikovy"] else None,
                "share_65": mid["share_65"], "change_pct": round(100 * (mid["population"] / res["base_population"] - 1), 1),
            })
    return out
