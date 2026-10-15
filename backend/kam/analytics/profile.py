"""Live territory profile: what is happening, compared to what, since when.

A card per indicator carries its latest value, the year it is from, the
trend verdict, the comparison with the kraj (or Czechia for a kraj) and the
dataset it came from. Pillar status is a count of those verdicts — never an
opaque score.
"""

from __future__ import annotations

from datetime import UTC, datetime

from ..indicators import PILLARS
from . import store
from .trends import classify, describe

PROFILE_CODES: dict[str, tuple[str, ...]] = {
    "demografie": ("110900", "d_podil_65", "d_podil_014", "d_index_stari", "d_migrace", "d_porodnost", "113000"),
    "doprava": ("khk_zast_bus", "d_zast_1000", "khk_zast_vlak", "d_vyjizdka", "600501", "khk_silnice_spatne"),
    "skolstvi": ("040510", "d_zs_trida", "040310", "d_ms_trida", "040500", "040300"),
    "zdravotnictvi": ("d_pl_10k", "070700", "khk_pl_dosp", "d_zubni_10k", "071000", "070320"),
    "socialni": ("500020", "d_dlouhodobi", "khk_exekuce", "150160", "d_ds_100_65", "khk_soc", "d_podniky_1000"),
    "bydleni": ("121800", "d_byty_1000", "d_osob_byt", "420713"),
    "prostredi": ("142000", "d_les_podil", "600201", "600301", "141300"),
    "kultura": ("khk_knihovny", "d_knihovny_10k", "khk_muzea", "khk_kina", "khk_infocentra", "khk_cirk_pam", "khk_rozhledny"),
    "finance": ("d_dan_obyv", "200402", "200702", "d_invest_podil", "d_vydaje_obyv", "200802"),
}

# Shares/ratios can be compared across territories of different size; counts cannot.
COMPARABLE = {
    "d_podil_65", "d_podil_014", "d_index_stari", "d_migrace", "d_porodnost", "113000", "d_zast_1000", "d_vyjizdka",
    "d_zs_trida", "d_ms_trida", "d_pl_10k", "d_zubni_10k", "500020", "d_dlouhodobi", "d_ds_100_65", "d_podniky_1000",
    "d_byty_1000", "d_osob_byt", "142000", "d_les_podil", "600201", "600301", "d_dan_obyv", "d_invest_podil", "khk_silnice_spatne",
    "khk_exekuce", "d_knihovny_10k", "d_cirk_pam_1000", "d_vydaje_obyv",
}


def reference(tid: str) -> str:
    t = store.territory(tid)
    if t is None or t.level == "cz":
        return ""
    if t.level == "kraj":
        return "cz"
    return f"kraj:{t.kraj_code}"


def card(tid: str, code: str, ref: str) -> dict | None:
    s = store.series(tid, code)
    if not s:
        return None
    m = store.meta(code)
    year = max(s)
    val = s[year]
    trend = classify(s, m.get("polarity", 0)) if len(s) >= 5 else {"kind": "malo_dat", "label": "Jednorázový údaj" if len(s) == 1 else "Málo dat"}
    ref_val = None
    cmp = None
    if ref and code in COMPARABLE:
        rs = store.series(ref, code)
        ref_val = rs.get(year) if rs else None
        if ref_val is None and rs:
            ref_val = rs[max(rs)]
        if ref_val:
            ratio = val / ref_val if ref_val else None
            pol = m.get("polarity", 0)
            verdict = "srovnatelne"
            if ratio is not None and pol and abs(ratio - 1) >= 0.1:
                verdict = "lepsi" if (ratio > 1) == (pol > 0) else "horsi"
            cmp = {"ref": ref, "value": ref_val, "ratio": round(ratio, 3) if ratio else None, "verdict": verdict}
    age = datetime.now(UTC).year - year
    return {
        **m,
        "year": year, "value": val, "series": [{"year": y, "value": s[y]} for y in sorted(s)],
        "trend": trend, "compare": cmp, "text": describe(m["name"], trend) if trend.get("kind") != "malo_dat" else "",
        "freshness": "aktualni" if age <= 2 else "starsi" if age <= 4 else "zastarale",
    }


def pillar_status(cards: list[dict]) -> tuple[str, str]:
    better = sum(1 for c in cards if (c.get("compare") or {}).get("verdict") == "lepsi")
    worse = sum(1 for c in cards if (c.get("compare") or {}).get("verdict") == "horsi")
    improving = sum(1 for c in cards if c["trend"].get("judgement") == "zlepseni")
    worsening = sum(1 for c in cards if c["trend"].get("judgement") == "zhorseni")
    bad, good = worse + worsening, better + improving
    if not cards:
        return "bez_dat", "Bez dat"
    if bad >= 3 or (bad >= 2 and good == 0):
        return "problem", "Nepříznivý vývoj"
    if bad > good:
        return "sledovat", "Mírně nepříznivý vývoj"
    if good > bad:
        return "dobre", "Příznivý vývoj"
    return "stabilni", "Stabilní vývoj"


def profile(tid: str, with_risks: bool = True) -> dict | None:
    t = store.territory(tid)
    if t is None:
        return None
    ref = reference(tid)
    pillars = []
    sources: dict[str, dict] = {}
    for key, codes in PROFILE_CODES.items():
        cards = [c for code in codes if (c := card(tid, code, ref))]
        status, label = pillar_status(cards)
        for c in cards:
            if c.get("source_url"):
                sources[c["source_url"]] = {"label": c.get("source", ""), "origin": c.get("origin", ""), "url": c["source_url"]}
        pillars.append({"key": key, "label": PILLARS[key], "status": status, "status_label": label, "cards": cards})
    parent = store.territory(t.parent_id) if t.parent_id else None
    pop = store.latest(tid, "110900")
    area = store.latest(tid, "140100")
    out = {
        "territory": {
            "id": t.id, "level": t.level, "code": t.code, "name": t.name, "parent": {"id": parent.id, "name": parent.name} if parent else None,
            "okres": store.territory(t.okres_id).name if t.okres_id and store.territory(t.okres_id) else None,
            "population": pop[1] if pop else None, "population_year": pop[0] if pop else None,
            "area_km2": round(area[1] / 100, 1) if area else None, "lon": t.lon, "lat": t.lat,
        },
        "reference": {"id": ref, "name": store.territory(ref).name if ref and store.territory(ref) else None},
        "pillars": pillars,
        "facts": store.facts(tid),
        "sources": list(sources.values()),
    }
    if with_risks:
        from .forecast import summary
        from .risks import assess
        out["risks"] = assess(tid)
        out["outlook"] = summary(tid)
    return out
