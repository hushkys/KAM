"""Za co obec utrácí: rozpočet po oddílech rozpočtové skladby (data z Výdaje.com / MF ČR).

Číslo samo říká málo: doprava za 14 milionů je pro obec s dvěma tisíci lidí
jiná věc než pro tři sta. Každou položku proto vedle částky stavíme na
obyvatele a **porovnáváme s mediánem obcí stejné velikosti** (pásma z
`umisteni.PASMA`), ne s krajem: kraj tahají nahoru největší města.

Co z toho nevyplývá: že vyšší výdaj je lepší nebo horší. Obec s vysokými
výdaji na dopravu může mít dlouhé silnice, obec s nízkými může mít dobrou
smlouvu — rozpočet neví, co se za peníze pořídilo. Proto tu není žádné
hodnocení, jen „víc / méně než srovnatelné obce".

Pro ORP, okres a kraj se částky sečtou přes obce; srovnání s pásmem se tam
nedělá (nemá co srovnávat) a ukazuje se podíl na výdajích.
"""

from __future__ import annotations

from statistics import median

from ..ingest.vydaje import CATEGORIE, DRUHY, ZDROJE_DOTACI
from ..territory import HOME_KRAJ
from . import store
from .umisteni import MIN_V_PASMU, PASMA, pasmo

OBYV = "110900"
# Ke srovnání s pásmem se bere rozdíl větší než tahle mez; menší je šum.
PRAH = 0.15


def _soucet(tid: str, code: str) -> dict[int, float]:
    t = store.territory(tid)
    if t is None:
        return {}
    if t.level == "obec":
        return store.raw_series(tid, code)
    out: dict[int, float] = {}
    for o in store.members("obec", t.kraj_code, parent=None if t.level == "kraj" else tid):
        for y, v in store.raw_series(o.id, code).items():
            out[y] = out.get(y, 0.0) + v
    return out


def _obyv(tid: str) -> dict[int, float]:
    t = store.territory(tid)
    if t is None:
        return {}
    if t.level == "obec":
        return store.raw_series(tid, OBYV)
    out: dict[int, float] = {}
    for o in store.members("obec", t.kraj_code, parent=None if t.level == "kraj" else tid):
        for y, v in store.raw_series(o.id, OBYV).items():
            out[y] = out.get(y, 0.0) + v
    return out


def _stav_srovnani(pomer: float | None) -> str:
    if pomer is None:
        return "nelze"
    if pomer > 1 + PRAH:
        return "vice"
    if pomer < 1 - PRAH:
        return "mene"
    return "stejne"


def _mediany_pasma(rok: int) -> dict[str, dict[int, float]]:
    """code → pásmo → medián výdaje na obyvatele u obcí kraje v daném roce."""
    skupiny: dict[str, dict[int, list[float]]] = {c: {} for c in CATEGORIE}
    for o in store.members("obec", HOME_KRAJ):
        obyv = store.raw_series(o.id, OBYV).get(rok) or o.population
        if not obyv:
            continue
        i, _ = pasmo(obyv)
        for code in CATEGORIE:
            v = store.raw_series(o.id, code).get(rok)
            if v is not None:
                skupiny[code].setdefault(i, []).append(v / obyv)
    return {c: {i: median(v) for i, v in d.items() if len(v) >= MIN_V_PASMU} for c, d in skupiny.items()}


def roky_dostupne(tid: str) -> list[int]:
    return sorted(_soucet(tid, "vyd_celkem"))


def ucet(tid: str, rok: int | None = None) -> dict | None:
    t = store.territory(tid)
    if t is None:
        return None
    celkem = _soucet(tid, "vyd_celkem")
    if not celkem:
        return {"available": False, "reason": "Pro tohle území nemáme rozpis rozpočtu podle oddílů."}
    roky = sorted(celkem)
    rok = rok if rok in celkem else roky[-1]
    obyv = _obyv(tid).get(rok) or t.population or 0
    total = celkem[rok]
    predchozi = celkem.get(rok - 1)
    mediany = _mediany_pasma(rok) if t.level == "obec" and obyv else {}
    i_pasma, nazev_pasma = pasmo(obyv) if obyv else (None, "")

    polozky = []
    for code, label in CATEGORIE.items():
        s = _soucet(tid, code)
        v = s.get(rok)
        if v is None:
            continue
        pred = s.get(rok - 1)
        na_obyv = v / obyv if obyv else None
        med = mediany.get(code, {}).get(i_pasma) if i_pasma is not None else None
        pomer = (na_obyv / med) if (na_obyv is not None and med) else None
        polozky.append({
            "code": code, "label": label, "castka": v, "podil": v / total if total else None,
            "na_obyvatele": na_obyv, "median_pasma": med, "pomer": pomer, "srovnani": _stav_srovnani(pomer),
            "zmena": ((v - pred) / pred) if pred else None,
            "rada": [{"year": y, "value": s[y]} for y in sorted(s)],
        })
    polozky.sort(key=lambda p: p["castka"], reverse=True)

    druh = [{"code": c, "label": n, "castka": v, "podil": v / total if total else None}
            for c, n in DRUHY.items() if (v := _soucet(tid, c).get(rok)) is not None]
    dotace = [{"code": c, "label": n, "castka": v}
              for c, n in ZDROJE_DOTACI.items() if (v := _soucet(tid, c).get(rok)) is not None]
    dotace_celkem = sum(d["castka"] for d in dotace)

    return {
        "available": True, "territory": {"id": t.id, "name": t.name, "level": t.level},
        "rok": rok, "roky": roky, "obyvatele": obyv or None,
        "celkem": total, "na_obyvatele": (total / obyv) if obyv else None,
        "zmena_celkem": ((total - predchozi) / predchozi) if predchozi else None,
        "pasmo": nazev_pasma or None,
        "polozky": polozky, "druh": druh, "dotace": dotace, "dotace_celkem": dotace_celkem or None,
        "pasma": [p[2] for p in PASMA],
        "pozn": ("Částky jsou skutečné výdaje z výkazu FIN 2-12 M (MONITOR státní pokladny, MF ČR), v celých korunách. "
                 "Srovnání je s mediánem obcí kraje ve stejné velikostní skupině; rozpočet neříká, co se za peníze pořídilo, "
                 "takže vyšší výdaj není automaticky horší ani lepší."),
    }
