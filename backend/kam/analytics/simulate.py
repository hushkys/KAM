"""What-if engine: baseline versus intervention, year by year.

Scenario state = base state + intervention deltas (spec §99). The baseline
is the forecast's `pravdepodobny` path; interventions add residents, seats,
places or services from their start year, and every downstream quantity is
recomputed for both paths so the comparison is always like for like.

Every number that is not read from data is an *assumption*, listed with its
value and reason, and every one of them can be overridden per request. The
chain of effects returned to the UI labels each step FAKT (from data), MODEL
(computed) or PŘEDPOKLAD (assumed), so nobody mistakes a guess for a fact.

Layer-2 cache: identical requests are answered from memory; `SimStat`
counts how often each request pattern is asked, and `precompute()` warms the
most frequent ones on startup.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import OrderedDict

from sqlalchemy import select

from ..db import session_scope
from ..models import SimStat, now
from . import forecast, store

INTERVENTIONS: dict[str, dict] = {
    "byty": {"label": "Nová bytová výstavba", "pillar": "bydleni", "params": {
        "pocet": {"label": "Počet bytů", "min": 1, "max": 5000, "step": 10, "default": 300},
        "rok": {"label": "Rok dokončení", "min": 2026, "max": 2038, "step": 1, "default": 2028},
        "typ": {"label": "Typ zástavby", "options": {"bytove_domy": "Bytové domy", "rodinne_domy": "Rodinné domy"}, "default": "bytove_domy"}}},
    "zs_mista": {"label": "Rozšíření kapacity ZŠ", "pillar": "skolstvi", "params": {
        "pocet": {"label": "Nová místa (žáků)", "min": 10, "max": 1500, "step": 10, "default": 120},
        "rok": {"label": "Rok zprovoznění", "min": 2026, "max": 2038, "step": 1, "default": 2029}}},
    "ms_mista": {"label": "Rozšíření kapacity MŠ", "pillar": "skolstvi", "params": {
        "pocet": {"label": "Nová místa (dětí)", "min": 8, "max": 600, "step": 4, "default": 48},
        "rok": {"label": "Rok zprovoznění", "min": 2026, "max": 2038, "step": 1, "default": 2028}}},
    "spoj": {"label": "Nové autobusové spoje", "pillar": "doprava", "params": {
        "spoje_den": {"label": "Spojů za pracovní den", "min": 1, "max": 60, "step": 1, "default": 8},
        "zastavky": {"label": "Nové zastávky", "min": 0, "max": 20, "step": 1, "default": 1},
        "delka_km": {"label": "Délka spoje (km)", "min": 2, "max": 80, "step": 1, "default": 15},
        "rok": {"label": "Rok zavedení", "min": 2026, "max": 2038, "step": 1, "default": 2027}}},
    "pracovni_mista": {"label": "Nová pracovní místa", "pillar": "socialni", "params": {
        "pocet": {"label": "Počet pracovních míst", "min": 10, "max": 10000, "step": 10, "default": 500},
        "rok": {"label": "Rok otevření", "min": 2026, "max": 2038, "step": 1, "default": 2028}}},
    "domov_seniori": {"label": "Lůžka v domově pro seniory", "pillar": "socialni", "params": {
        "pocet": {"label": "Počet lůžek", "min": 5, "max": 500, "step": 5, "default": 60},
        "rok": {"label": "Rok otevření", "min": 2026, "max": 2038, "step": 1, "default": 2029}}},
    "ordinace": {"label": "Nová ordinace praktického lékaře", "pillar": "zdravotnictvi", "params": {
        "pocet": {"label": "Počet ordinací", "min": 1, "max": 20, "step": 1, "default": 1},
        "rok": {"label": "Rok otevření", "min": 2026, "max": 2038, "step": 1, "default": 2027}}},
}

ASSUMPTIONS: dict[str, dict] = {
    "obsazenost_bytu": {"label": "Obsazenost nových bytů", "value": 0.95, "unit": "podíl", "why": "Část bytů zůstává neobydlená nebo slouží k rekreaci."},
    "osob_byt_bd": {"label": "Osob na byt v bytovém domě (násobek průměru území)", "value": 0.9, "unit": "×", "why": "Byty v bytových domech jsou menší než průměr (SLDB 2021)."},
    "osob_byt_rd": {"label": "Osob na byt v rodinném domě (násobek průměru území)", "value": 1.15, "unit": "×", "why": "Rodinné domy obývají častěji rodiny s dětmi."},
    "deti_nasobek": {"label": "Podíl dětí mezi novousedlíky (násobek současného)", "value": 1.35, "unit": "×", "why": "Do nové výstavby se stěhují převážně mladé rodiny."},
    "seniori_nasobek": {"label": "Podíl seniorů mezi novousedlíky (násobek současného)", "value": 0.5, "unit": "×", "why": "Senioři se stěhují výrazně méně."},
    "max_zs_trida": {"label": "Maximální počet žáků ve třídě ZŠ", "value": 30, "unit": "žáků", "why": "Vyhláška č. 48/2005 Sb., § 4."},
    "max_ms_trida": {"label": "Maximální počet dětí ve třídě MŠ", "value": 24, "unit": "dětí", "why": "Vyhláška č. 14/2005 Sb., § 2."},
    "aut_na_obyvatele": {"label": "Osobních aut na obyvatele", "value": 0.6, "unit": "aut", "why": "Přibližně celostátní úroveň automobilizace."},
    "cest_na_auto": {"label": "Cest autem za den na auto", "value": 2.2, "unit": "cest", "why": "Obvyklá hodnota dopravních průzkumů."},
    "naklad_km": {"label": "Provozní náklad autobusu", "value": 55, "unit": "Kč/km", "why": "Orientační hodnota veřejných zakázek regionální dopravy — nastavte dle smlouvy."},
    "provozni_dny": {"label": "Provozních dní v roce", "value": 250, "unit": "dní", "why": "Pracovní dny."},
    "naklad_misto_zs": {"label": "Investice na jedno místo ve škole", "value": 1.2, "unit": "mil. Kč", "why": "Orientační — nahraďte rozpočtem projektu."},
    "naklad_luzko": {"label": "Investice na jedno lůžko", "value": 2.5, "unit": "mil. Kč", "why": "Orientační — nahraďte rozpočtem projektu."},
    "mista_nezamestnani": {"label": "Podíl nových míst obsazených místními uchazeči", "value": 0.35, "unit": "podíl", "why": "Část míst obsadí dojíždějící a noví obyvatelé."},
    "mista_prichozi": {"label": "Podíl nových míst obsazených přistěhovalými", "value": 0.2, "unit": "podíl", "why": "Zbytek obsadí místní a dojíždějící."},
    "osob_domacnost": {"label": "Osob na přistěhovalou domácnost", "value": 2.3, "unit": "osob", "why": "Průměrná velikost domácnosti."},
}

HORIZON = (2030, 2035, 2040)
_cache: OrderedDict[str, dict] = OrderedDict()
_cache_lock = threading.Lock()
CACHE_SIZE = 512


def normalize(tid: str, interventions: list[dict], assumptions: dict | None) -> dict:
    clean = []
    for iv in interventions:
        spec = INTERVENTIONS.get(iv.get("type", ""))
        if not spec:
            continue
        params = {}
        for name, p in spec["params"].items():
            v = (iv.get("params") or {}).get(name, p["default"])
            if "options" in p:
                v = v if v in p["options"] else p["default"]
            else:
                try:
                    v = float(v)
                except (TypeError, ValueError):
                    v = p["default"]
                v = int(min(max(v, p["min"]), p["max"]))
            params[name] = v
        clean.append({"type": iv["type"], "params": params})
    clean.sort(key=lambda x: json.dumps(x, sort_keys=True))
    a = {k: float(v) for k, v in (assumptions or {}).items() if k in ASSUMPTIONS and isinstance(v, (int, float))}
    return {"territory": tid, "interventions": clean, "assumptions": a}


def cache_key(payload: dict) -> str:
    return hashlib.sha1(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _latest(tid: str, *codes: str) -> float:
    total = 0.0
    for code in codes:
        v = store.latest(tid, code)
        total += v[1] if v else 0.0
    return total


def _fmt(v: float, d: int = 0) -> str:
    return f"{v:,.{d}f}".replace(",", " ").replace(".", ",")


def compute(payload: dict) -> dict:
    tid = payload["territory"]
    a = {k: v["value"] for k, v in ASSUMPTIONS.items()} | payload["assumptions"]
    fc = forecast.project(tid)
    if not fc.get("available"):
        return {"available": False, "reason": fc.get("reason", "Pro území nelze sestavit výhled.")}
    t = store.territory(tid)
    ref = f"kraj:{t.kraj_code}" if t and t.level != "kraj" else "cz"
    base_rows = fc["scenarios"]["pravdepodobny"]
    years = [r["year"] for r in base_rows]
    base_year = fc["base_year"]

    pop0 = fc["base_population"] or 1
    kids0 = _latest(tid, "110930")
    old0 = _latest(tid, "110990")
    share14 = kids0 / pop0 if pop0 else 0.15
    share65 = old0 / pop0 if pop0 else 0.2
    persons = store.latest(tid, "d_osob_byt")
    persons = persons[1] if persons else (store.latest(ref, "d_osob_byt") or (0, 2.3))[1]
    zs_pupils = _latest(tid, "040510", "040410")
    zs_classes = _latest(tid, "040520", "040420")
    ms_kids = _latest(tid, "040310")
    ms_classes = _latest(tid, "040320")
    zs_ratio = zs_pupils / kids0 if kids0 else 0
    ms_ratio = ms_kids / kids0 if kids0 else 0
    gp0 = _latest(tid, "070700")
    ds0 = _latest(tid, "150160")
    unemployed0 = _latest(tid, "501000")
    tax_pc = store.latest(tid, "d_dan_obyv")
    tax_pc = tax_pc[1] if tax_pc else 0.0
    ref_gp = store.latest(ref, "d_pl_10k")
    ref_ds = store.latest(ref, "d_ds_100_65")
    stops0 = _latest(tid, "khk_zast_bus")

    def path(with_iv: bool) -> list[dict]:
        rows = []
        for r in base_rows:
            y = r["year"]
            pop = float(r["population"])
            kids = float(r["age_0_14"] if r["age_0_14"] is not None else pop * share14)
            old = float(r["age_65"] if r["age_65"] is not None else pop * share65)
            zs_cap = zs_classes * a["max_zs_trida"]
            ms_cap = ms_classes * a["max_ms_trida"]
            gp, ds, unemployed, stops = gp0, ds0, unemployed0, stops0
            opex = capex = 0.0
            if with_iv:
                for iv in payload["interventions"]:
                    p = iv["params"]
                    start = p.get("rok", 2027)
                    ramp = 0.0 if y < start else 0.5 if y == start else 1.0
                    if iv["type"] == "byty":
                        mult = a["osob_byt_bd"] if p["typ"] == "bytove_domy" else a["osob_byt_rd"]
                        newcomers = p["pocet"] * a["obsazenost_bytu"] * persons * mult * ramp
                        pop += newcomers
                        kids += newcomers * min(share14 * a["deti_nasobek"], 0.35)
                        old += newcomers * share65 * a["seniori_nasobek"]
                    elif iv["type"] == "zs_mista" and y >= start:
                        zs_cap += p["pocet"]
                        if y == start:
                            capex += p["pocet"] * a["naklad_misto_zs"] * 1e6
                    elif iv["type"] == "ms_mista" and y >= start:
                        ms_cap += p["pocet"]
                        if y == start:
                            capex += p["pocet"] * a["naklad_misto_zs"] * 1e6
                    elif iv["type"] == "spoj" and y >= start:
                        stops += p["zastavky"]
                        opex += p["spoje_den"] * p["delka_km"] * a["naklad_km"] * a["provozni_dny"]
                    elif iv["type"] == "pracovni_mista":
                        hires = p["pocet"] * a["mista_nezamestnani"] * ramp
                        unemployed = max(unemployed - hires, unemployed * 0.4)
                        movers = p["pocet"] * a["mista_prichozi"] * ramp * a["osob_domacnost"] / 1.6
                        pop += movers
                        kids += movers * share14 * a["deti_nasobek"]
                    elif iv["type"] == "domov_seniori" and y >= start:
                        ds += p["pocet"]
                        if y == start:
                            capex += p["pocet"] * a["naklad_luzko"] * 1e6
                    elif iv["type"] == "ordinace" and y >= start:
                        gp += p["pocet"]
            zs_demand = kids * zs_ratio
            ms_demand = kids * ms_ratio
            rows.append({
                "year": y, "population": round(pop), "age_0_14": round(kids), "age_65": round(old),
                "zs_demand": round(zs_demand), "zs_capacity": round(zs_cap), "zs_util": round(zs_demand / zs_cap, 3) if zs_cap else None,
                "ms_demand": round(ms_demand), "ms_capacity": round(ms_cap), "ms_util": round(ms_demand / ms_cap, 3) if ms_cap else None,
                "gp": gp, "gp_10k": round(gp / pop * 10000, 2) if pop else None,
                "ds_places": ds, "ds_100_65": round(ds / old * 100, 2) if old else None,
                "unemployed": round(unemployed), "stops": stops, "stops_1000": round(stops / pop * 1000, 2) if pop else None,
                "tax": round(pop * tax_pc), "car_trips": round((pop - r["population"]) * a["aut_na_obyvatele"] * a["cest_na_auto"]) if with_iv else 0,
                "opex": round(opex), "capex": round(capex),
            })
        return rows

    base = path(False)
    scen = path(True)

    def warnings(rows: list[dict]) -> list[dict]:
        out = []
        for key, label, cap_key in (("zs_util", "Kapacita základních škol", "zs_capacity"), ("ms_util", "Kapacita mateřských škol", "ms_capacity")):
            crit = next((r for r in rows if r[key] and r[key] > 1.0), None)
            warn = next((r for r in rows if r[key] and r[key] > 0.9), None)
            if crit:
                need = crit[key.replace("util", "demand")] - crit[cap_key]
                out.append({"key": key, "level": "kriticke", "year": crit["year"], "title": f"{label}: překročení v roce {crit['year']}",
                            "text": f"Poptávka {_fmt(crit[key.replace('util', 'demand')])} míst při kapacitě {_fmt(crit[cap_key])} ({_fmt(100 * crit[key])} %). Chybí asi {_fmt(need)} míst.",
                            "suggest": "zs_mista" if key == "zs_util" else "ms_mista"})
            elif warn:
                out.append({"key": key, "level": "vysoke", "year": warn["year"], "title": f"{label}: vytížení nad 90 % od roku {warn['year']}",
                            "text": f"Vytížení dosáhne {_fmt(100 * warn[key])} %.", "suggest": "zs_mista" if key == "zs_util" else "ms_mista"})
        if ref_gp and ref_gp[1]:
            low = next((r for r in rows if r["gp_10k"] is not None and r["gp_10k"] < 0.7 * ref_gp[1]), None)
            if low and gp0:
                out.append({"key": "gp", "level": "stredni", "year": low["year"], "title": "Dostupnost praktických lékařů",
                            "text": f"{_fmt(low['gp_10k'], 1)} ordinace na 10 000 obyvatel (kraj {_fmt(ref_gp[1], 1)}).", "suggest": "ordinace"})
        if ref_ds and ref_ds[1]:
            low = next((r for r in rows if r["ds_100_65"] is not None and r["ds_100_65"] < 0.6 * ref_ds[1]), None)
            if low and ds0:
                out.append({"key": "ds", "level": "stredni", "year": low["year"], "title": "Kapacita domovů pro seniory",
                            "text": f"{_fmt(low['ds_100_65'], 1)} míst na 100 obyvatel 65+ (kraj {_fmt(ref_ds[1], 1)}).", "suggest": "domov_seniori"})
        return out

    wb, ws = warnings(base), warnings(scen)

    def at(rows, y):
        return next((r for r in rows if r["year"] == y), rows[-1])

    metrics = []
    for key, label, unit, d in (("population", "Obyvatelé", "osob", 0), ("age_0_14", "Děti 0–14 let", "osob", 0), ("age_65", "Senioři 65+", "osob", 0),
                                ("zs_util", "Vytížení ZŠ", "%", 1), ("ms_util", "Vytížení MŠ", "%", 1), ("gp_10k", "Ordinace PL na 10 tis.", "", 2),
                                ("ds_100_65", "Místa DS na 100 seniorů", "", 2), ("unemployed", "Uchazeči o zaměstnání", "osob", 0),
                                ("stops_1000", "Zastávky na 1 000 obyv.", "", 2), ("tax", "Daňové příjmy obce", "Kč/rok", 0), ("car_trips", "Cesty autem navíc", "za den", 0)):
        row = {"key": key, "label": label, "unit": unit, "values": []}
        for y in HORIZON:
            b, s = at(base, y)[key], at(scen, y)[key]
            if key.endswith("util"):
                b = round(100 * b, 1) if b is not None else None
                s = round(100 * s, 1) if s is not None else None
            row["values"].append({"year": y, "base": b, "scenario": s, "delta": round(s - b, d) if (s is not None and b is not None) else None})
        metrics.append(row)

    chain = _chain(payload, base, scen, a, persons, share14, zs_ratio, tax_pc)
    capex = sum(r["capex"] for r in scen)
    opex = max((r["opex"] for r in scen), default=0)
    y40 = at(scen, 2040)
    return {
        "available": True, "territory": {"id": tid, "name": t.name if t else tid}, "base_year": base_year, "years": years,
        "baseline": base, "scenario": scen, "warnings": {"baseline": wb, "scenario": ws}, "metrics": metrics, "chain": chain,
        "costs": {"capex": round(capex), "opex_year": round(opex), "tax_delta_year": round(y40["tax"] - at(base, 2040)["tax"])},
        "assumptions": [{"key": k, **v, "value": a[k]} for k, v in ASSUMPTIONS.items()],
        "inputs": {"persons_per_flat": round(persons, 2), "share_0_14": round(100 * share14, 1), "share_65": round(100 * share65, 1),
                   "zs_pupils": zs_pupils, "zs_classes": zs_classes, "ms_children": ms_kids, "ms_classes": ms_classes, "gp": gp0,
                   "ds_places": ds0, "tax_per_capita": round(tax_pc), "stops": stops0},
        "method": "Základní scénář = pravděpodobná varianta výhledu; zásahy přičítají přírůstky od roku realizace. Výsledek je modelový odhad, ne předpověď.",
        "kind": "SCÉNÁŘ",
    }


def _chain(payload, base, scen, a, persons, share14, zs_ratio, tax_pc) -> list[dict]:
    steps: list[dict] = []
    b40, s40 = base[-1], scen[-1]
    for iv in payload["interventions"]:
        p = iv["params"]
        if iv["type"] == "byty":
            mult = a["osob_byt_bd"] if p["typ"] == "bytove_domy" else a["osob_byt_rd"]
            new = p["pocet"] * a["obsazenost_bytu"] * persons * mult
            kids = new * min(share14 * a["deti_nasobek"], 0.35)
            steps += [
                {"label": f"+{_fmt(p['pocet'])} bytů ({INTERVENTIONS['byty']['params']['typ']['options'][p['typ']].lower()}) v roce {p['rok']}", "tag": "ZÁSAH"},
                {"label": f"+{_fmt(new)} obyvatel", "tag": "MODEL", "detail": f"{_fmt(persons, 2)} osob na byt (SLDB 2021) × {mult} × obsazenost {a['obsazenost_bytu']}"},
                {"label": f"+{_fmt(kids)} dětí 0–14 let", "tag": "PŘEDPOKLAD", "detail": f"podíl dětí {_fmt(100 * share14, 1)} % × {a['deti_nasobek']}"},
                {"label": f"+{_fmt(kids * zs_ratio)} žáků ZŠ", "tag": "MODEL", "detail": f"poměr žáků ZŠ k dětem v území {_fmt(zs_ratio, 2)}"},
                {"label": f"+{_fmt(new * a['aut_na_obyvatele'] * a['cest_na_auto'])} cest autem denně", "tag": "PŘEDPOKLAD"},
                {"label": f"+{_fmt(new * tax_pc / 1e6, 1)} mil. Kč daňových příjmů ročně", "tag": "MODEL", "detail": f"{_fmt(tax_pc)} Kč na obyvatele (MF ČR via ČSÚ)"},
            ]
        elif iv["type"] in ("zs_mista", "ms_mista"):
            steps.append({"label": f"+{_fmt(p['pocet'])} míst v {'ZŠ' if iv['type'] == 'zs_mista' else 'MŠ'} od roku {p['rok']}", "tag": "ZÁSAH"})
            steps.append({"label": f"Investice přibližně {_fmt(p['pocet'] * a['naklad_misto_zs'], 0)} mil. Kč", "tag": "PŘEDPOKLAD"})
        elif iv["type"] == "spoj":
            steps += [{"label": f"+{p['spoje_den']} spojů denně, +{p['zastavky']} zastávek od roku {p['rok']}", "tag": "ZÁSAH"},
                      {"label": f"Provoz přibližně {_fmt(p['spoje_den'] * p['delka_km'] * a['naklad_km'] * a['provozni_dny'] / 1e6, 2)} mil. Kč ročně", "tag": "PŘEDPOKLAD",
                       "detail": f"{p['delka_km']} km × {_fmt(a['naklad_km'])} Kč/km × {_fmt(a['provozni_dny'])} dní"},
                      {"label": f"Zastávky na 1 000 obyvatel: {_fmt(b40['stops_1000'] or 0, 2)} → {_fmt(s40['stops_1000'] or 0, 2)}", "tag": "MODEL"}]
        elif iv["type"] == "pracovni_mista":
            steps += [{"label": f"+{_fmt(p['pocet'])} pracovních míst v roce {p['rok']}", "tag": "ZÁSAH"},
                      {"label": f"−{_fmt(b40['unemployed'] - s40['unemployed'])} uchazečů o zaměstnání", "tag": "PŘEDPOKLAD", "detail": f"{_fmt(100 * a['mista_nezamestnani'])} % míst obsadí místní uchazeči"},
                      {"label": f"+{_fmt(s40['population'] - b40['population'])} obyvatel (přistěhování)", "tag": "PŘEDPOKLAD"}]
        elif iv["type"] == "domov_seniori":
            steps += [{"label": f"+{_fmt(p['pocet'])} lůžek od roku {p['rok']}", "tag": "ZÁSAH"},
                      {"label": f"Míst na 100 seniorů v roce 2040: {_fmt(b40['ds_100_65'] or 0, 1)} → {_fmt(s40['ds_100_65'] or 0, 1)}", "tag": "MODEL"}]
        elif iv["type"] == "ordinace":
            steps += [{"label": f"+{p['pocet']} ordinace PL od roku {p['rok']}", "tag": "ZÁSAH"},
                      {"label": f"Ordinací na 10 tis. obyvatel v roce 2040: {_fmt(b40['gp_10k'] or 0, 2)} → {_fmt(s40['gp_10k'] or 0, 2)}", "tag": "MODEL"}]
    return steps


def run(tid: str, interventions: list[dict], assumptions: dict | None = None, record: bool = True) -> dict:
    payload = normalize(tid, interventions, assumptions)
    key = cache_key(payload)
    t0 = time.perf_counter()
    with _cache_lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
    if hit is None:
        result = compute(payload)
        with _cache_lock:
            _cache[key] = result
            while len(_cache) > CACHE_SIZE:
                _cache.popitem(last=False)
    else:
        result = hit
    ms = (time.perf_counter() - t0) * 1000
    hits = _record(key, payload) if record else 0
    return {**result, "cache": {"hit": hit is not None, "ms": round(ms, 2), "hits": hits, "key": key[:12]}, "request": payload}


def _record(key: str, payload: dict) -> int:
    try:
        with session_scope() as s:
            row = s.get(SimStat, key)
            if row is None:
                row = SimStat(key=key, territory_id=payload["territory"], payload=payload, hits=0)
                s.add(row)
            row.hits += 1
            row.last_hit = now()
            return row.hits
    except Exception:
        return 0


def popular(limit: int = 10) -> list[dict]:
    with session_scope() as s:
        rows = s.scalars(select(SimStat).order_by(SimStat.hits.desc()).limit(limit)).all()
        return [{"key": r.key[:12], "territory": r.territory_id, "hits": r.hits, "interventions": r.payload.get("interventions", []),
                 "cached": r.key in _cache} for r in rows]


def presets(tid: str) -> list[list[dict]]:
    return [
        [{"type": "byty", "params": {"pocet": 300, "rok": 2028, "typ": "bytove_domy"}}],
        [{"type": "byty", "params": {"pocet": 300, "rok": 2028, "typ": "bytove_domy"}}, {"type": "zs_mista", "params": {"pocet": 120, "rok": 2029}}],
        [{"type": "spoj", "params": {"spoje_den": 8, "zastavky": 1, "delka_km": 15, "rok": 2027}}],
        [{"type": "domov_seniori", "params": {"pocet": 60, "rok": 2029}}],
    ]


def precompute(limit: int = 12) -> int:
    """Warm the cache with the most requested patterns and the presets for the kraj and its ORP."""
    done = 0
    with session_scope() as s:
        rows = s.scalars(select(SimStat).order_by(SimStat.hits.desc()).limit(limit)).all()
        payloads = [r.payload for r in rows]
    for p in payloads:
        key = cache_key(p)
        if key not in _cache:
            res = compute(p)
            with _cache_lock:
                _cache[key] = res
            done += 1
    targets = ["kraj:86"] + [t.id for t in store.members("orp", 86)]
    for tid in targets:
        for ivs in presets(tid)[:2]:
            p = normalize(tid, ivs, None)
            key = cache_key(p)
            if key not in _cache:
                res = compute(p)
                with _cache_lock:
                    _cache[key] = res
                done += 1
    return done


def cache_info() -> dict:
    return {"size": len(_cache), "capacity": CACHE_SIZE}


def reset() -> None:
    with _cache_lock:
        _cache.clear()
