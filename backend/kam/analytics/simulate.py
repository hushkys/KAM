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
from ..indicators import DEN, ZARIZENI
from . import forecast, store

INTERVENTIONS: dict[str, dict] = {
    "byty": {"label": "Nová bytová výstavba", "pillar": "bydleni", "params": {
        "pocet": {"label": "Počet bytů", "min": 1, "max": 5000, "step": 10, "default": 300},
        "rok": {"label": "Rok dokončení", "min": 2026, "max": 2038, "step": 1, "default": 2028},
        "typ": {"label": "Typ zástavby", "options": {"bytove_domy": "Bytové domy", "rodinne_domy": "Rodinné domy", "najemni": "Obecní nájemní byty"}, "default": "bytove_domy"}}},
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
    "stomatolog": {"label": "Nová zubní ordinace", "pillar": "zdravotnictvi", "params": {
        "pocet": {"label": "Počet ordinací", "min": 1, "max": 20, "step": 1, "default": 1},
        "rok": {"label": "Rok otevření", "min": 2026, "max": 2038, "step": 1, "default": 2027}}},
}

# Zařízení z tabulky `indicators.ZARIZENI` jsou zásahy stejného tvaru: počet
# a rok. Dnešní počet je v datech, dostupnost se přepočítává na obyvatele.
for _k, _z in ZARIZENI.items():
    INTERVENTIONS[_k] = {"label": _z["label"], "pillar": _z["pillar"], "params": {
        "pocet": {"label": f"Počet ({_z['jednotka']})", "min": 1, "max": _z["max"], "step": _z["step"], "default": _z["default"]},
        "rok": {"label": "Rok otevření", "min": 2026, "max": 2038, "step": 1, "default": 2028}}}

# Rozsah posuvníku podle velikosti území: horní mez = obyvatelé × podíl,
# ale aspoň `nejmene` a nejvýš `max` z parametru. 5 000 bytů pro vesnici se
# dvěma sty lidmi je číslo, které nikdo nezadá, a posuvník je pak nepoužitelný
# — každý pixel znamená desítky bytů.
ROZSAH: dict[str, tuple[float, float]] = {
    "byty": (0.12, 20), "zs_mista": (0.10, 30), "ms_mista": (0.05, 16), "pracovni_mista": (0.30, 50),
    "domov_seniori": (0.03, 10), "ordinace": (1 / 1000, 2), "stomatolog": (1 / 1500, 2),
    "lekarna": (1 / 2000, 2), "pediatr": (1 / 1500, 2), "specialista": (1 / 1000, 2), "gynekolog": (1 / 2000, 2),
    "stacionar": (0.01, 10), "dzr": (0.01, 10), "pecovatelske": (0.02, 10), "soc_sluzba": (1 / 2000, 2),
    "knihovna": (1 / 5000, 1), "kulturni_dum": (1 / 10000, 1), "hasici": (1 / 10000, 1), "komunikace": (1 / 100, 5),
}
for _k, (_podil, _nejmene) in ROZSAH.items():
    INTERVENTIONS[_k]["params"]["pocet"]["na_obyv"] = _podil
    INTERVENTIONS[_k]["params"]["pocet"]["nejmene"] = _nejmene

# Co které opatření obecně řeší. Ukazuje se u opatření, když v území model
# žádný konkrétní problém, který by řešilo, nenašel.
RESI_OBECNE: dict[str, str] = {
    "byty": "úbytek a odliv obyvatel, nedostatek bydlení pro mladé rodiny",
    "zs_mista": "plné třídy základních škol", "ms_mista": "nedostatek míst ve školkách",
    "spoj": "špatné spojení do města za prací, k lékaři a do škol",
    "pracovni_mista": "nezaměstnanost a odchod mladých za prací",
    "domov_seniori": "nedostatek míst v domovech pro seniory",
    "ordinace": "špatnou dostupnost praktického lékaře", "stomatolog": "špatnou dostupnost zubaře",
    "lekarna": "daleko do lékárny", "pediatr": "špatnou dostupnost dětského lékaře", "specialista": "dlouhé čekání na specialistu",
    "gynekolog": "špatnou dostupnost gynekologa", "stacionar": "chybějící denní péči o seniory",
    "dzr": "chybějící péči o lidi s demencí", "pecovatelske": "bydlení pro seniory, kteří potřebují pomoc",
    "soc_sluzba": "chybějící terénní sociální péči", "knihovna": "chybějící knihovnu a místo pro komunitu",
    "kulturni_dum": "chybějící prostor pro kulturu a spolky", "hasici": "dlouhý dojezd hasičů",
    "komunikace": "chybějící nebo nevyhovující místní cesty",
}
# Rizika z `risks.assess` → opatření, která je řeší (navíc k tomu, co riziko
# samo uvádí v `interventions`).
RIZIKO_RESI: dict[str, tuple[str, ...]] = {
    "starnuti": ("stacionar", "dzr", "pecovatelske", "soc_sluzba", "domov_seniori"),
    "pece_seniori": ("domov_seniori", "dzr", "pecovatelske", "stacionar"),
    "lekari": ("ordinace", "pediatr", "specialista", "lekarna"),
    "ubytek": ("byty", "pracovni_mista"), "odliv": ("byty", "pracovni_mista", "spoj"),
    "nezamestnanost": ("pracovni_mista",), "skoly": ("zs_mista",),
}


def resi(tid: str, typy: list[str], varovani: list[dict]) -> dict[str, list[dict]]:
    """Které problémy TOHOTO území dané opatření řeší: rizika i varování výhledu."""
    from . import risks
    out: dict[str, list[dict]] = {t: [] for t in typy}
    for r in risks.assess(tid):
        # vykyv je poznámka, kanalizace u bytů omezení výstavby, ne problém, který byty řeší
        if r["type"].startswith("vykyv") or r["type"] == "kanalizace":
            continue
        for t in typy:
            if t in r.get("interventions", []) or t in RIZIKO_RESI.get(r["type"], ()):
                out[t].append({"title": r["title"], "level": r["level"], "text": r["text"]})
    for w in varovani:
        if w.get("suggest") in out and not any(x["title"] == w["title"] for x in out[w["suggest"]]):
            out[w["suggest"]].append({"title": w["title"], "level": w["level"], "text": w["text"]})
    return out


# Krátký popis ke každému zásahu. Nadpis řekne co, tohle řekne, co zásah
# v modelu opravdu dělá — a tím i co od výsledku čekat a co ne.
INTERVENTION_HELP: dict[str, str] = {
    "byty": "Přivede nové obyvatele podle počtu a obsazenosti bytů. Bývá mezi nimi víc dětí, než má obec dnes.",
    "zs_mista": "Přidá místa v základních školách. Počet dětí, které do nich chodí, nemění.",
    "ms_mista": "Přidá místa v mateřských školách. Počet dětí nemění.",
    "spoj": "Přidá zastávky a náklady na provoz. Počet obyvatel nemění.",
    "pracovni_mista": "Část míst obsadí místní uchazeči, část lidé, kteří se přistěhují. Oba podíly jsou odhad a dají se změnit.",
    "domov_seniori": "Přidá lůžka pro seniory a náklady na jejich vybudování.",
    "ordinace": "Přidá ordinace praktického lékaře a přepočte je na 10 000 obyvatel.",
    "stomatolog": "Přidá zubní ordinace a přepočte je na 10 000 obyvatel.",
    **{k: z["help"] for k, z in ZARIZENI.items()},
}

ASSUMPTIONS: dict[str, dict] = {
    "obsazenost_bytu": {"label": "Obsazenost nových bytů", "value": 0.95, "unit": "podíl", "why": "Část bytů zůstane prázdná nebo poslouží k rekreaci."},
    "osob_byt_bd": {"label": "Lidí na byt v bytovém domě (× průměr území)", "value": 0.9, "unit": "×", "why": "Byty v bytových domech jsou menší než průměr (sčítání lidu 2021)."},
    "osob_byt_rd": {"label": "Lidí na byt v rodinném domě (× průměr území)", "value": 1.15, "unit": "×", "why": "V rodinných domech bydlí častěji rodiny s dětmi."},
    "osob_byt_najem": {"label": "Lidí na obecní nájemní byt (× průměr území)", "value": 0.85, "unit": "×", "why": "Obecní byty bývají menší a častěji v nich bydlí jednotlivci a senioři."},
    "deti_najem": {"label": "Děti mezi nájemníky obecních bytů (× dnešní podíl)", "value": 1.0, "unit": "×", "why": "Obecní byty nepřitahují rodiny s dětmi víc než zbytek obce."},
    "deti_nasobek": {"label": "Děti mezi nově přistěhovanými (× dnešní podíl)", "value": 1.35, "unit": "×", "why": "Do nové výstavby se stěhují hlavně mladé rodiny."},
    "seniori_nasobek": {"label": "Senioři mezi nově přistěhovanými (× dnešní podíl)", "value": 0.5, "unit": "×", "why": "Senioři se stěhují mnohem méně."},
    "max_zs_trida": {"label": "Nejvyšší počet žáků ve třídě ZŠ", "value": 30, "unit": "žáků", "why": "Vyhláška č. 48/2005 Sb., § 4."},
    "max_ms_trida": {"label": "Nejvyšší počet dětí ve třídě MŠ", "value": 24, "unit": "dětí", "why": "Vyhláška č. 14/2005 Sb., § 2."},
    "aut_na_obyvatele": {"label": "Osobních aut na obyvatele", "value": 0.6, "unit": "aut", "why": "Zhruba celostátní průměr."},
    "cest_na_auto": {"label": "Cest za den na jedno auto", "value": 2.2, "unit": "cest", "why": "Obvyklá hodnota z dopravních průzkumů."},
    "naklad_km": {"label": "Provozní náklad autobusu", "value": 55, "unit": "Kč/km", "why": "Orientační cena z veřejných zakázek na regionální dopravu. Upravte podle své smlouvy."},
    "provozni_dny": {"label": "Provozních dní v roce", "value": 250, "unit": "dní", "why": "Pracovní dny."},
    "naklad_misto_zs": {"label": "Investice na jedno místo ve škole", "value": 1.2, "unit": "mil. Kč", "why": "Orientační. Nahraďte rozpočtem projektu."},
    "naklad_luzko": {"label": "Investice na jedno lůžko", "value": 2.5, "unit": "mil. Kč", "why": "Orientační. Nahraďte rozpočtem projektu."},
    "mista_nezamestnani": {"label": "Podíl nových míst pro místní uchazeče o práci", "value": 0.35, "unit": "podíl", "why": "Zbytek obsadí dojíždějící a noví obyvatelé."},
    "mista_prichozi": {"label": "Podíl nových míst pro lidi, kteří se přistěhují", "value": 0.2, "unit": "podíl", "why": "Zbytek obsadí místní a dojíždějící."},
    "osob_domacnost": {"label": "Lidí v jedné přistěhované domácnosti", "value": 2.3, "unit": "osob", "why": "Průměrná velikost domácnosti."},
}
for _k, _z in ZARIZENI.items():
    if _z["capex"]:
        ASSUMPTIONS[f"naklad_zar_{_k}"] = {"label": f"Investice na jednotku: {_z['label'].lower()}", "value": _z["capex"], "unit": "mil. Kč", "why": "Orientační. Nahraďte rozpočtem projektu."}
    if _z["provoz"]:
        ASSUMPTIONS[f"provoz_zar_{_k}"] = {"label": f"Roční provoz na jednotku: {_z['label'].lower()}", "value": _z["provoz"], "unit": "mil. Kč/rok", "why": "Orientační. Nahraďte vlastním odhadem."}

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


# Školy se doplňují do tohoto vytížení: nad ním model hlásí varování.
CIL_VYTIZENI = 0.9


def _zaokr(v: float, step: float, lo: float, hi: float) -> int:
    """Nahoru na krok posuvníku a do jeho mezí: návrh musí jít nastavit."""
    import math
    return int(min(max(math.ceil(v / step) * step, lo), hi))


def _kusy(n: float, tvary: tuple[str, str, str]) -> str:
    """„1 lékárna, 3 lékárny, 5 lékáren“."""
    n = int(round(n))
    return f"{_fmt(n)} {tvary[0] if n == 1 else tvary[1] if 2 <= n <= 4 else tvary[2]}"


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
    zub0 = _latest(tid, "070720")
    ds0 = _latest(tid, "150160")
    unemployed0 = _latest(tid, "501000")
    tax_pc = store.latest(tid, "d_dan_obyv")
    tax_pc = tax_pc[1] if tax_pc else 0.0
    ref_gp = store.latest(ref, "d_pl_10k")
    ref_zub = store.latest(ref, "d_zubni_10k")
    ref_ds = store.latest(ref, "d_ds_100_65")
    stops0 = _latest(tid, "khk_zast_bus")
    zar = [k for k in ZARIZENI if any(iv["type"] == k for iv in payload["interventions"])]
    zar0 = {k: _latest(tid, *ZARIZENI[k]["codes"]) for k in zar}
    if t and t.level == "obec":
        from .umisteni import pasmo
        i_p = pasmo(pop0)[0]
        zar_ref = {k: (None, m) if (m := _median_pasma(t.kraj_code, k, i_p)) else None for k in zar}
        srovnani = "obvyklá obec stejné velikosti"
    else:
        zar_ref = {k: store.latest(ref, ZARIZENI[k]["derived"]) for k in zar}
        srovnani = "kraj"

    def path(with_iv: bool) -> list[dict]:
        rows = []
        for r in base_rows:
            y = r["year"]
            pop = float(r["population"])
            kids = float(r["age_0_14"] if r["age_0_14"] is not None else pop * share14)
            old = float(r["age_65"] if r["age_65"] is not None else pop * share65)
            zs_cap = zs_classes * a["max_zs_trida"]
            ms_cap = ms_classes * a["max_ms_trida"]
            gp, ds, unemployed, stops, zub = gp0, ds0, unemployed0, stops0, zub0
            opex = capex = 0.0
            zc = dict(zar0)
            if with_iv:
                for iv in payload["interventions"]:
                    p = iv["params"]
                    start = p.get("rok", 2027)
                    ramp = 0.0 if y < start else 0.5 if y == start else 1.0
                    if iv["type"] == "byty":
                        typ = p["typ"]
                        mult = {"bytove_domy": a["osob_byt_bd"], "rodinne_domy": a["osob_byt_rd"]}.get(typ, a["osob_byt_najem"])
                        # Obecní nájemní byt není developerská výstavba: bydlí v něm
                        # víc jednotlivců a seniorů, takže se s ním nepřistěhuje
                        # tolik dětí. Proto vlastní násobky, ne ty pro novou čtvrť.
                        detsky = a["deti_najem"] if typ == "najemni" else a["deti_nasobek"]
                        starsi = 1.0 if typ == "najemni" else a["seniori_nasobek"]
                        newcomers = p["pocet"] * a["obsazenost_bytu"] * persons * mult * ramp
                        pop += newcomers
                        kids += newcomers * min(share14 * detsky, 0.35)
                        old += newcomers * share65 * starsi
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
                    elif iv["type"] == "stomatolog" and y >= start:
                        zub += p["pocet"]
                    elif iv["type"] in ZARIZENI and y >= start:
                        k = iv["type"]
                        zc[k] += p["pocet"]
                        if y == start:
                            capex += p["pocet"] * a.get(f"naklad_zar_{k}", 0.0) * 1e6
                        opex += p["pocet"] * a.get(f"provoz_zar_{k}", 0.0) * 1e6
            extra = {}
            for k in zar:
                z = ZARIZENI[k]
                den = {"pop": pop, "kids": kids, "old": old}[z["den"]]
                extra[f"x_{k}"] = zc[k]
                extra[f"x_{k}_r"] = round(zc[k] / den * z["scale"], 2) if den else None
            zs_demand = kids * zs_ratio
            ms_demand = kids * ms_ratio
            rows.append({
                "year": y, "population": round(pop), "age_0_14": round(kids), "age_65": round(old),
                "zs_demand": round(zs_demand), "zs_capacity": round(zs_cap), "zs_util": round(zs_demand / zs_cap, 3) if zs_cap else None,
                "ms_demand": round(ms_demand), "ms_capacity": round(ms_cap), "ms_util": round(ms_demand / ms_cap, 3) if ms_cap else None,
                "gp": gp, "gp_10k": round(gp / pop * 10000, 2) if pop else None,
                "zub": zub, "zub_10k": round(zub / pop * 10000, 2) if pop else None,
                "ds_places": ds, "ds_100_65": round(ds / old * 100, 2) if old else None,
                "unemployed": round(unemployed), "stops": stops, "stops_1000": round(stops / pop * 1000, 2) if pop else None,
                "tax": round(pop * tax_pc), "car_trips": round((pop - r["population"]) * a["aut_na_obyvatele"] * a["cest_na_auto"]) if with_iv else 0,
                "opex": round(opex), "capex": round(capex), **extra,
            })
        return rows

    base = path(False)
    scen = path(True)

    def warnings(rows: list[dict]) -> list[dict]:
        """Varování a u každého i to, kolik čeho přidat, aby zmizelo.

        Školy se doplňují tak, aby vytížení nikde nepřekročilo 90 % (to je hranice
        varování), služby tak, aby v roce 2040 dosáhly krajského průměru na obyvatele.
        `suggest_params.pocet` je to, co chybí **navíc** k tomu, co scénář už má."""
        out = []
        last = rows[-1]
        for key, label, cap_key, typ in (("zs_util", "Základní školy", "zs_capacity", "zs_mista"), ("ms_util", "Mateřské školy", "ms_capacity", "ms_mista")):
            dem_key = key.replace("util", "demand")
            crit = next((r for r in rows if r[key] and r[key] > 1.0), None)
            warn = next((r for r in rows if r[key] and r[key] > 0.9), None)
            chybi = max((r[dem_key] / CIL_VYTIZENI - r[cap_key] for r in rows if r[cap_key]), default=0)
            spec = INTERVENTIONS[typ]["params"]["pocet"]
            navrh = {"pocet": _zaokr(chybi, spec["step"], spec["min"], spec["max"]), "rok": max(2026, (crit or warn or last)["year"] - 1)} if chybi > 0 else None
            text_navrhu = f"Aby třídy v žádném roce nebyly plné z víc než 90 %, chybí {_fmt(navrh['pocet'])} míst." if navrh else ""
            if crit:
                need = crit[dem_key] - crit[cap_key]
                out.append({"key": key, "level": "kriticke", "year": crit["year"], "title": f"{label}: v roce {crit['year']} nebudou stačit",
                            "text": f"Potřeba {_fmt(crit[dem_key])} míst, kapacita {_fmt(crit[cap_key])} ({_fmt(100 * crit[key])} %). Chybí asi {_fmt(need)} míst.",
                            "suggest": typ, "suggest_params": navrh, "suggest_text": text_navrhu})
            elif warn:
                out.append({"key": key, "level": "vysoke", "year": warn["year"], "title": f"{label}: od roku {warn['year']} plné z více než 90 %",
                            "text": f"Vytížení dosáhne {_fmt(100 * warn[key])} %.", "suggest": typ, "suggest_params": navrh, "suggest_text": text_navrhu})

        def sluzba(key, title, ratio_key, count_key, ref_v, prah, den_key, scale, unit, typ, odpovida=True):
            if not (ref_v and ref_v[1]) or not odpovida:
                return
            low = next((r for r in rows if r[ratio_key] is not None and r[ratio_key] < prah * ref_v[1]), None)
            if not low:
                return
            spec = INTERVENTIONS[typ]["params"]["pocet"]
            chybi = ref_v[1] * last[den_key] / scale - last[count_key]
            navrh = {"pocet": _zaokr(chybi, spec["step"], spec["min"], spec["max"]), "rok": max(2026, low["year"])} if chybi > 0 else None
            out.append({"key": key, "level": "stredni", "year": low["year"], "title": title,
                        "text": f"{_fmt(low[ratio_key], 1)} {unit} (kraj {_fmt(ref_v[1], 1)}).", "suggest": typ, "suggest_params": navrh,
                        "suggest_text": f"Na krajský průměr v roce 2040 chybí {_fmt(navrh['pocet'])}." if navrh else ""})

        sluzba("gp", "Dostupnost praktických lékařů", "gp_10k", "gp", ref_gp, 0.7, "population", 10000, "ordinace na 10 000 obyvatel", "ordinace", bool(gp0))
        sluzba("zub", "Dostupnost zubního lékaře", "zub_10k", "zub", ref_zub, 0.7, "population", 10000, "ordinace na 10 000 obyvatel", "stomatolog", bool(zub0))
        sluzba("ds", "Kapacita domovů pro seniory", "ds_100_65", "ds_places", ref_ds, 0.6, "age_65", 100, "míst na 100 obyvatel 65+", "domov_seniori", bool(ds0))
        for k in zar:
            ref_k = zar_ref[k]
            if not (ref_k and ref_k[1]):
                continue
            # Jen na konci horizontu: před zprovozněním zařízení je dostupnost vždycky nízká.
            if last[f"x_{k}_r"] is not None and last[f"x_{k}_r"] < 0.7 * ref_k[1]:
                z = ZARIZENI[k]
                den = {"pop": last["population"], "kids": last["age_0_14"], "old": last["age_65"]}[z["den"]]
                chybi = ref_k[1] * den / z["scale"] - last[f"x_{k}"]
                spec = INTERVENTIONS[k]["params"]["pocet"]
                kolik = _zaokr(chybi, spec["step"], spec["min"], spec["max"]) if chybi > 0 else 0
                out.append({"key": k, "level": "stredni", "year": last["year"], "title": f"Dostupnost: {z['metrika'].lower()}",
                            "text": f"{_fmt(last[f'x_{k}_r'], 2)} {z['ratio_unit']} ({srovnani} {_fmt(ref_k[1], 2)}).", "suggest": k,
                            "suggest_params": {"pocet": kolik, "rok": 2028} if kolik else None,
                            "suggest_text": f"Na úroveň, kterou má {srovnani}, chybí v roce 2040 {_kusy(kolik, z['tvary'])}." if kolik else ""})
        return out

    wb, ws = warnings(base), warnings(scen)

    def at(rows, y):
        return next((r for r in rows if r["year"] == y), rows[-1])

    metrics = []
    for key, label, unit, d in (("population", "Obyvatelé", "osob", 0), ("age_0_14", "Děti 0–14 let", "osob", 0), ("age_65", "Senioři 65+", "osob", 0),
                                ("zs_util", "Vytížení ZŠ", "%", 1), ("ms_util", "Vytížení MŠ", "%", 1), ("gp_10k", "Praktičtí lékaři na 10 tis. obyvatel", "", 2), ("zub_10k", "Zubní ordinace na 10 tis.", "", 2),
                                ("ds_100_65", "Místa v domovech pro seniory na 100 seniorů", "", 2), ("unemployed", "Uchazeči o zaměstnání", "osob", 0),
                                ("stops_1000", "Zastávky na 1 000 obyv.", "", 2), ("tax", "Daňové příjmy obce", "Kč/rok", 0), ("car_trips", "Cesty autem navíc", "za den", 0),
                                *((f"x_{k}_r", f"{ZARIZENI[k]['metrika']} ({ZARIZENI[k]['ratio_unit']})", "", 2) for k in zar)):
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
        "assumptions": [{"key": k, **v, "value": a[k]} for k, v in ASSUMPTIONS.items()
                        if not k.endswith(tuple(f"_zar_{z}" for z in ZARIZENI)) or k.split("_zar_", 1)[1] in zar],
        "inputs": {"persons_per_flat": round(persons, 2), "share_0_14": round(100 * share14, 1), "share_65": round(100 * share65, 1),
                   "zs_pupils": zs_pupils, "zs_classes": zs_classes, "ms_children": ms_kids, "ms_classes": ms_classes, "gp": gp0,
                   "ds_places": ds0, "tax_per_capita": round(tax_pc), "stops": stops0, "zub": zub0},
        "method": "Bez zásahu = nejpravděpodobnější výhled. Zásahy se k němu přičítají od roku, kdy začnou. Je to modelový odhad, ne předpověď.",
        "kind": "SCÉNÁŘ",
        "resi": resi(tid, [iv["type"] for iv in payload["interventions"]], wb),
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
                {"label": f"+{_fmt(new)} obyvatel", "tag": "MODEL", "detail": f"{_fmt(persons, 2)} osob na byt (sčítání lidu 2021) × {mult} × obsazenost {a['obsazenost_bytu']}"},
                {"label": f"+{_fmt(kids)} dětí 0–14 let", "tag": "PŘEDPOKLAD", "detail": f"podíl dětí {_fmt(100 * share14, 1)} % × {a['deti_nasobek']}"},
                {"label": f"+{_fmt(kids * zs_ratio)} žáků ZŠ", "tag": "MODEL", "detail": f"poměr žáků ZŠ k dětem v území {_fmt(zs_ratio, 2)}"},
                {"label": f"+{_fmt(new * a['aut_na_obyvatele'] * a['cest_na_auto'])} cest autem denně", "tag": "PŘEDPOKLAD"},
                {"label": f"+{_fmt(new * tax_pc / 1e6, 1)} mil. Kč daňových příjmů ročně", "tag": "MODEL", "detail": f"{_fmt(tax_pc)} Kč na obyvatele (MF ČR, přes ČSÚ)"},
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
        elif iv["type"] in ZARIZENI:
            k = iv["type"]
            z = ZARIZENI[k]
            steps += [{"label": f"{z['label']}: +{_fmt(p['pocet'])} {z['jednotka'] if k in ('stacionar', 'dzr', 'pecovatelske', 'komunikace') else 'ks'} od roku {p['rok']}", "tag": "ZÁSAH"},
                      {"label": f"{z['metrika']} {z['ratio_unit']} v roce 2040: {_fmt(b40.get(f'x_{k}_r') or 0, 2)} → {_fmt(s40.get(f'x_{k}_r') or 0, 2)}", "tag": "MODEL"}]
            if a.get(f"naklad_zar_{k}"):
                steps.append({"label": f"Investice přibližně {_fmt(p['pocet'] * a[f'naklad_zar_{k}'], 1)} mil. Kč", "tag": "PŘEDPOKLAD"})
            if a.get(f"provoz_zar_{k}"):
                steps.append({"label": f"Provoz přibližně {_fmt(p['pocet'] * a[f'provoz_zar_{k}'], 1)} mil. Kč ročně", "tag": "PŘEDPOKLAD"})
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


_PASMA_CACHE: dict[tuple, float | None] = {}


def _median_pasma(kraj_code: int, k: str, i_pasma: int) -> float | None:
    """Medián dostupnosti zařízení `k` u obcí jednoho velikostního pásma.

    Obec bez záznamu se počítá jako nula: MOS i Data KHK zařízení, které obec
    nemá, nevykazují vůbec, a medián jen z obcí, které ho mají, by „obvyklou
    úroveň" vyhnal nahoru."""
    klic = (kraj_code, k, i_pasma)
    if klic in _PASMA_CACHE:
        return _PASMA_CACHE[klic]
    from . import umisteni
    z = ZARIZENI[k]
    den_code = DEN[z["den"]][0]
    hodnoty = []
    for o in store.members("obec", kraj_code):
        pop = store.latest(o.id, "110900")
        if not pop or umisteni.pasmo(pop[1])[0] != i_pasma:
            continue
        d = store.latest(o.id, den_code)
        if not d or not d[1]:
            continue
        hodnoty.append(_latest(o.id, *z["codes"]) / d[1] * z["scale"])
    hodnoty.sort()
    med = hodnoty[len(hodnoty) // 2] if len(hodnoty) >= 5 else None
    _PASMA_CACHE[klic] = med
    return med


def navrh(tid: str, jen: str | None = None) -> dict:
    """Opatření, která vyplývají z problémů území, i s velikostí.

    Bere dvě věci: varování modelu u výhledu bez zásahu (školy, lékaři, péče
    o seniory) — ta už nesou spočítanou velikost — a rizika z `risks.assess`
    (úbytek a odliv obyvatel, nezaměstnanost). Velikost se počítá tak, aby
    problém zmizel nebo se vyrovnal kraji, a pak se celý návrh jednou spustí,
    aby bylo vidět, kolik varování zbude. `jen` omezí návrh na jedno riziko."""
    from . import risks
    t = store.territory(tid)
    if t is None:
        return {"available": False, "reason": "Území neznámé."}
    zaklad = run(tid, [], None, record=False)
    if not zaklad.get("available"):
        return {"available": False, "reason": zaklad.get("reason", "Pro území nelze spočítat výhled.")}
    a = {k: v["value"] for k, v in ASSUMPTIONS.items()}
    rows = zaklad["baseline"]
    prvni, posledni = rows[0], rows[-1]
    navrhy: list[dict] = []
    # varování → riziko, ke kterému patří (pro filtr `jen`)
    RIZIKO = {"zs_util": "skoly", "ms_util": "skoly", "gp": "lekari", "zub": "lekari", "ds": "pece_seniori"}

    def pridej(typ, params, duvod, riziko):
        if any(n["type"] == typ for n in navrhy):
            return
        navrhy.append({"type": typ, "params": params, "duvod": duvod, "riziko": riziko})

    for w in zaklad["warnings"]["baseline"]:
        if w.get("suggest") and w.get("suggest_params"):
            pridej(w["suggest"], {**{k: p["default"] for k, p in INTERVENTIONS[w["suggest"]]["params"].items()}, **w["suggest_params"]},
                   f"{w['title']}. {w.get('suggest_text') or w['text']}", RIZIKO.get(w["key"], w["key"]))

    rizika = {r["type"]: r for r in risks.assess(tid)}
    pokles = prvni["population"] - posledni["population"]
    if ("ubytek" in rizika or "odliv" in rizika) and pokles > 0:
        osob = (zaklad.get("inputs") or {}).get("persons_per_flat") or 2.3
        na_byt = osob * a["osob_byt_bd"] * a["obsazenost_bytu"]
        spec = INTERVENTIONS["byty"]["params"]["pocet"]
        pocet = _zaokr(pokles / na_byt, spec["step"], spec["min"], spec["max"])
        r = rizika.get("ubytek") or rizika.get("odliv")
        pridej("byty", {"pocet": pocet, "rok": 2028, "typ": "bytove_domy"},
               f"Do roku {posledni['year']} ubude podle výhledu asi {_fmt(pokles)} obyvatel. Tolik bytů by úbytek vyrovnalo.", r["type"])
    if "nezamestnanost" in rizika:
        un = _latest(tid, "501000")
        cur = store.latest(tid, "500020")
        ref = store.latest(f"kraj:{t.kraj_code}", "500020")
        if un and cur and ref and cur[1] > ref[1]:
            prebytek = un * (1 - ref[1] / cur[1])
            spec = INTERVENTIONS["pracovni_mista"]["params"]["pocet"]
            pridej("pracovni_mista", {"pocet": _zaokr(prebytek / a["mista_nezamestnani"], spec["step"], spec["min"], spec["max"]), "rok": 2028},
                   f"Nezaměstnanost je {_fmt(cur[1], 1)} % (kraj {_fmt(ref[1], 1)} %). Tolik míst by ji srovnalo s krajem.", "nezamestnanost")

    # Služby, kterých má obec výrazně méně než obvyklá obec STEJNÉ VELIKOSTI
    # (medián pásma z `umisteni`, pod 70 %) a kde by do té úrovně chyběla aspoň
    # jedna celá jednotka. Proti krajskému průměru by to nešlo: knihovnu má
    # skoro každá vesnice, takže na obyvatele by každé město vyšlo jako chudé.
    # Pro ORP, okres a kraj se to nedělá — o zařízení rozhoduje obec.
    if t.level == "obec":
        from . import umisteni
        obyv = posledni["population"]
        i_pasma, nazev_pasma = umisteni.pasmo(obyv)
        mezery = []
        for k, z in ZARIZENI.items():
            pr = umisteni.PRAVIDLA.get(k)
            if not pr:
                continue
            med = _median_pasma(t.kraj_code, k, i_pasma)
            if not med:
                continue
            c0 = _latest(tid, *z["codes"])
            den = {"pop": posledni["population"], "kids": posledni["age_0_14"], "old": posledni["age_65"]}[z["den"]]
            if not den:
                continue
            pomer = c0 / den * z["scale"]
            chybi = med * den / z["scale"] - c0
            if pomer < 0.7 * med and chybi >= 1:
                mezery.append((1 - pomer / med + (0.5 if z["den"] == "old" and "starnuti" in rizika else 0), k, z, chybi, med))
        for _, k, z, chybi, med in sorted(mezery, key=lambda m: -m[0])[:3]:
            spec = INTERVENTIONS[k]["params"]["pocet"]
            kolik = _zaokr(chybi, spec["step"], spec["min"], spec["max"])
            pridej(k, {"pocet": kolik, "rok": 2028},
                   f"{z['metrika']}: obec má výrazně méně než obvyklá obec stejné velikosti ({nazev_pasma}: {_fmt(med, 2)} {z['ratio_unit']}). "
                   f"Na tuto úroveň chybí {_kusy(kolik, z['tvary'])}.",
                   "starnuti" if z["den"] == "old" else z["pillar"])

    if jen:
        vybrane = [n for n in navrhy if n["riziko"] == jen]
        navrhy = vybrane or navrhy
    navrhy = navrhy[:6]
    ivs = [{"type": n["type"], "params": n["params"]} for n in navrhy]
    po = run(tid, ivs, None, record=False) if ivs else zaklad
    return {
        "available": True, "territory": {"id": tid, "name": t.name},
        "interventions": ivs,
        "duvody": [{"type": n["type"], "label": INTERVENTIONS[n["type"]]["label"], "duvod": n["duvod"]} for n in navrhy],
        "varovani_pred": len(zaklad["warnings"]["baseline"]),
        "varovani_po": len(po["warnings"]["scenario"]) if po.get("available") else None,
    }


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


# Hotové scénáře: typická zadání, se kterými obec přichází. Nejsou to
# doporučení — jsou to východiska, od kterých se dá začít, aby uživatel
# nemusel skládat pět posuvníků od nuly jen proto, aby vůbec něco viděl.
# Každý má napsáno, na jakou otázku odpovídá.
SADY: tuple[dict, ...] = (
    {"key": "nova-ctvrt", "label": "Nová čtvrť", "pillar": "bydleni",
     "otazka": "Postavíme 300 bytů. Utáhnou to školy?",
     "ivs": [{"type": "byty", "params": {"pocet": 300, "rok": 2028, "typ": "bytove_domy"}}]},
    {"key": "ctvrt-se-skolou", "label": "Čtvrť i se školou", "pillar": "skolstvi",
     "otazka": "Stejná výstavba a k ní nová místa v ZŠ a MŠ.",
     "ivs": [{"type": "byty", "params": {"pocet": 300, "rok": 2028, "typ": "bytove_domy"}},
             {"type": "zs_mista", "params": {"pocet": 120, "rok": 2029}},
             {"type": "ms_mista", "params": {"pocet": 48, "rok": 2029}}]},
    {"key": "mladi-zpet", "label": "Přitáhnout mladé", "pillar": "socialni",
     "otazka": "Nová práce a obecní byty naráz. Zastaví to odchod mladých?",
     "ivs": [{"type": "pracovni_mista", "params": {"pocet": 400, "rok": 2028}},
             {"type": "byty", "params": {"pocet": 120, "rok": 2029, "typ": "najemni"}}]},
    {"key": "starnouci-obec", "label": "Stárnoucí obec", "pillar": "socialni",
     "otazka": "Přibývá seniorů. Co je potřeba připravit?",
     "ivs": [{"type": "domov_seniori", "params": {"pocet": 60, "rok": 2029}},
             {"type": "ordinace", "params": {"pocet": 1, "rok": 2027}}]},
    {"key": "dostupnost", "label": "Dostupnost služeb", "pillar": "zdravotnictvi",
     "otazka": "Lékař, zubař a spoj do města. Jak se zlepší dostupnost?",
     "ivs": [{"type": "ordinace", "params": {"pocet": 1, "rok": 2027}},
             {"type": "stomatolog", "params": {"pocet": 1, "rok": 2028}},
             {"type": "spoj", "params": {"spoje_den": 8, "zastavky": 2, "delka_km": 15, "rok": 2027}}]},
    {"key": "spoj", "label": "Lepší spojení", "pillar": "doprava",
     "otazka": "Osm spojů denně navíc. Kolik to ročně stojí?",
     "ivs": [{"type": "spoj", "params": {"spoje_den": 8, "zastavky": 1, "delka_km": 15, "rok": 2027}}]},
)


SADY = SADY + (
    {"key": "pece-o-seniory", "label": "Péče o seniory", "pillar": "socialni",
     "otazka": "Pečovatelské byty, stacionář a místa pro lidi s demencí. Jak se zvýší dostupnost?",
     "ivs": [{"type": "pecovatelske", "params": {"pocet": 20, "rok": 2028}},
             {"type": "stacionar", "params": {"pocet": 20, "rok": 2028}},
             {"type": "dzr", "params": {"pocet": 24, "rok": 2030}}]},
    {"key": "pece-o-rodiny", "label": "Péče pro rodiny", "pillar": "zdravotnictvi",
     "otazka": "Dětský lékař, gynekolog a lékárna. Co to změní v dostupnosti?",
     "ivs": [{"type": "pediatr", "params": {"pocet": 1, "rok": 2027}},
             {"type": "gynekolog", "params": {"pocet": 1, "rok": 2028}},
             {"type": "lekarna", "params": {"pocet": 1, "rok": 2028}}]},
    {"key": "kultura-obec", "label": "Kultura a spolkový život", "pillar": "kultura",
     "otazka": "Knihovna a kulturní dům. Kolik to stojí a jak se změní dostupnost?",
     "ivs": [{"type": "knihovna", "params": {"pocet": 1, "rok": 2028}},
             {"type": "kulturni_dum", "params": {"pocet": 1, "rok": 2030}}]},
    {"key": "bezpecnost-obec", "label": "Bezpečí a silnice", "pillar": "doprava",
     "otazka": "Hasičská stanice a nové místní komunikace.",
     "ivs": [{"type": "hasici", "params": {"pocet": 1, "rok": 2028}},
             {"type": "komunikace", "params": {"pocet": 5, "rok": 2027}}]},
)


def presets(tid: str) -> list[list[dict]]:
    """Zásahy hotových sad — používá je předpočítání mezipaměti."""
    return [list(s["ivs"]) for s in SADY]


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
    _PASMA_CACHE.clear()
    with _cache_lock:
        _cache.clear()
