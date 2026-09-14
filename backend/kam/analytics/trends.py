"""One-off spike or long-term trend?

The brief asks the system to tell a single bad year from a direction of
travel. Three robust tools do that without assuming normal residuals, which
small-obec counts never have:

- Theil–Sen slope (median of pairwise slopes) for the direction and speed,
  immune to one wild year;
- Mann–Kendall test for whether that direction is real or noise;
- robust z-score of each residual (MAD-scaled) for the spikes.

A point is a *výkyv* when it sits more than 3 robust σ off the trend line
while its neighbours do not. The series is a *trend* when Mann–Kendall is
significant at 5 %. Everything else is *stabilní*.
"""

from __future__ import annotations

import math
from statistics import median

MIN_POINTS = 5


def theil_sen(xs: list[float], ys: list[float]) -> tuple[float, float]:
    slopes = [(ys[j] - ys[i]) / (xs[j] - xs[i]) for i in range(len(xs)) for j in range(i + 1, len(xs)) if xs[j] != xs[i]]
    if not slopes:
        return 0.0, (ys[0] if ys else 0.0)
    b = median(slopes)
    a = median(y - b * x for x, y in zip(xs, ys, strict=True))
    return b, a


def mann_kendall(ys: list[float]) -> tuple[float, float]:
    """Returns (z, two-sided p) with the tie correction."""
    n = len(ys)
    if n < 3:
        return 0.0, 1.0
    s = sum((ys[j] > ys[i]) - (ys[j] < ys[i]) for i in range(n) for j in range(i + 1, n))
    ties: dict[float, int] = {}
    for y in ys:
        ties[y] = ties.get(y, 0) + 1
    var = (n * (n - 1) * (2 * n + 5) - sum(t * (t - 1) * (2 * t + 5) for t in ties.values())) / 18
    if var <= 0:
        return 0.0, 1.0
    z = (s - 1) / math.sqrt(var) if s > 0 else (s + 1) / math.sqrt(var) if s < 0 else 0.0
    p = math.erfc(abs(z) / math.sqrt(2))
    return z, p


def robust_scale(values: list[float]) -> float:
    if not values:
        return 0.0
    m = median(values)
    mad = median(abs(v - m) for v in values)
    return 1.4826 * mad


def classify(series: dict[int, float], polarity: int = 0) -> dict:
    years = sorted(series)
    if len(years) < MIN_POINTS:
        return {"kind": "malo_dat", "label": "Nedostatek dat", "points": len(years)}
    xs = [float(y) for y in years]
    ys = [float(series[y]) for y in years]
    slope, intercept = theil_sen(xs, ys)
    resid = [y - (intercept + slope * x) for x, y in zip(xs, ys, strict=True)]
    scale = robust_scale(resid)
    mean_abs = sum(abs(y) for y in ys) / len(ys) or 1.0
    floor = 0.01 * mean_abs  # a perfectly straight series must not make every wiggle a spike
    scale = max(scale, floor, 1e-9)
    z = [r / scale for r in resid]

    outliers = []
    for i, zi in enumerate(z):
        if abs(zi) < 3.0:
            continue
        neighbours = [abs(z[k]) for k in (i - 1, i + 1) if 0 <= k < len(z)]
        if all(n < 2.0 for n in neighbours):
            outliers.append({"year": years[i], "value": ys[i], "z": round(zi, 2)})

    clean_idx = [i for i in range(len(ys)) if not any(o["year"] == years[i] for o in outliers)]
    mk_z, p = mann_kendall([ys[i] for i in clean_idx])
    pct = 100.0 * slope / mean_abs
    significant = p < 0.05 and abs(pct) >= 0.3

    last_is_spike = bool(outliers) and outliers[-1]["year"] == years[-1]
    if last_is_spike:
        kind, label = "vykyv", "Jednorázový výkyv"
    elif significant:
        kind = "trend"
        label = "Dlouhodobý růst" if slope > 0 else "Dlouhodobý pokles"
    else:
        kind, label = "stabilni", "Stabilní"

    direction = "roste" if slope > 0 else "klesa" if slope < 0 else "beze_zmeny"
    judgement = "neutralni"
    if kind == "trend" and polarity:
        judgement = "zlepseni" if (slope > 0) == (polarity > 0) else "zhorseni"

    since = _run_start(years, ys, slope, scale) if kind == "trend" else None
    return {
        "kind": kind,
        "label": label,
        "direction": direction,
        "judgement": judgement,
        "slope": round(slope, 4),
        "pct_per_year": round(pct, 2),
        "p_value": round(p, 4),
        "mk_z": round(mk_z, 2),
        "since": since,
        "outliers": outliers,
        "fit": [{"year": y, "value": round(intercept + slope * y, 3)} for y in (years[0], years[-1])],
        "points": len(years),
    }


def _run_start(years: list[int], ys: list[float], slope: float, scale: float) -> int:
    """First year of the current uninterrupted run in the trend's direction.

    Steps against the direction smaller than half a robust σ are tolerated —
    a flat year inside a decline is still the decline.
    """
    sign = 1 if slope > 0 else -1
    start = len(ys) - 1
    for i in range(len(ys) - 1, 0, -1):
        step = (ys[i] - ys[i - 1]) * sign
        if step < -0.5 * scale:
            break
        start = i - 1
    # A "run" of one or two years is not a start of anything: fall back to
    # the first year the fitted line covers, which is what the trend is.
    if len(ys) - start < 3:
        return years[0]
    return years[start]


def describe(name: str, result: dict, unit: str = "") -> str:
    """Plain-language one-liner used by the profile and the assistant."""
    k = result.get("kind")
    if k == "malo_dat":
        return f"{name}: málo dat pro určení trendu."
    if k == "vykyv":
        o = result["outliers"][-1]
        return f"{name}: poslední hodnota ({o['year']}) je jednorázový výkyv mimo dlouhodobý vývoj."
    if k == "trend":
        verb = "roste" if result["direction"] == "roste" else "klesá"
        since = f" od roku {result['since']}" if result.get("since") else ""
        pct = f"{abs(result['pct_per_year']):.1f}".replace(".", ",")
        return f"{name} {verb}{since}, v průměru o {pct} % ročně."
    return f"{name}: bez statisticky významného trendu."
