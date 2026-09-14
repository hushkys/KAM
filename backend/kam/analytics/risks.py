"""Risk engine — rules over real series, each risk with its evidence.

Rules, not a prompt. Each rule reads named indicators, compares them with the
reference territory and with their own history, and produces a severity on a
five-step scale with an explanation built from the same numbers. The
confidence drops for small populations (a village of 150 can swing any rate
by chance) and for short series.

Severity scale (spec §12): nízké · sledovat · střední · vysoké · kritické.
"""

from __future__ import annotations

from statistics import median

from . import store
from .forecast import summary as outlook
from .trends import classify

LEVELS = ((0.8, "kriticke", "Kritické"), (0.6, "vysoke", "Vysoké"), (0.4, "stredni", "Střední"), (0.2, "sledovat", "Sledovat"))

_cache: dict[str, list[dict]] = {}


def reset() -> None:
    _cache.clear()


def level(score: float) -> tuple[str, str]:
    for threshold, key, label in LEVELS:
        if score >= threshold:
            return key, label
    return "nizke", "Nízké"


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def _fmt(v: float, d: int = 1) -> str:
    return f"{v:,.{d}f}".replace(",", " ").replace(".", ",")


def evidence(tid: str, code: str) -> dict | None:
    s = store.series(tid, code)
    if not s:
        return None
    m = store.meta(code)
    y = max(s)
    return {"code": code, "name": m["name"], "unit": m["unit"], "year": y, "value": s[y], "from": min(s), "to": y,
            "source": m.get("source") or "odvozeno z: " + ", ".join(store.meta(c)["name"] for c in m.get("inputs", [])),
            "url": m.get("source_url", ""), "formula": m.get("formula", "")}


def _confidence(tid: str, points: int) -> float:
    pop = store.latest(tid, "110900")
    p = pop[1] if pop else 0
    c = 0.9 if points >= 10 else 0.75 if points >= 6 else 0.55
    if p < 500:
        c -= 0.2
    elif p < 2000:
        c -= 0.1
    return round(max(0.3, c), 2)


def _risk(tid, key, title, pillar, score, kind, text, why, codes, interventions=(), trend=None, points=10) -> dict:
    lv, label = level(score)
    ev = [e for c in codes if (e := evidence(tid, c))]
    period = f"{min(e['from'] for e in ev)}–{max(e['to'] for e in ev)}" if ev else ""
    return {"id": f"{tid}:{key}", "type": key, "title": title, "pillar": pillar, "score": round(score, 3), "level": lv, "level_label": label,
            "kind": kind, "text": text, "why": why, "evidence": ev, "period": period, "confidence": _confidence(tid, points),
            "interventions": list(interventions), "trend": trend}


def assess(tid: str) -> list[dict]:
    if tid in _cache:
        return _cache[tid]
    t = store.territory(tid)
    if t is None:
        return []
    ref = "cz" if t.level == "kraj" else f"kraj:{t.kraj_code}" if t.level != "cz" else ""
    ctx = store.territory(t.orp_id) if t.level == "obec" and t.orp_id else None
    out: list[dict] = []

    def ref_latest(code: str, target: str = ref) -> float | None:
        v = store.latest(target, code) if target else None
        return v[1] if v else None

    # 1 — ageing
    s65 = store.series(tid, "d_podil_65")
    if len(s65) >= 5:
        tr = classify(s65, -1)
        cur = s65[max(s65)]
        r = ref_latest("d_podil_65")
        excess = (cur / r - 1) if r else 0
        slope = tr["slope"]
        score = _clamp(0.25 + 1.6 * excess + 0.35 * max(slope, 0))
        if excess > 0.05 or slope > 0.25:
            since = f" od roku {tr['since']}" if tr.get("since") else ""
            out.append(_risk(tid, "starnuti", "Stárnutí populace", "demografie", score, "trend" if tr["kind"] == "trend" else "stav",
                             f"Podíl obyvatel 65+ je {_fmt(cur)} %" + (f" (kraj {_fmt(r)} %)" if r else "") + f" a mění se o {_fmt(slope, 2)} p. b. ročně{since}.",
                             ["Vyšší poptávka po zdravotní a sociální péči", "Větší citlivost na dostupnost veřejné dopravy"],
                             ["d_podil_65", "110990", "110900"], ["domov_seniori", "ordinace", "spoj"], tr, tr["points"]))

    # 2 — depopulation
    pop = store.series(tid, "110900")
    if len(pop) >= 8:
        tr = classify(pop, 1)
        if tr["kind"] == "trend" and tr["slope"] < 0:
            o = outlook(tid)
            m35 = next((m for m in o.get("milestones", []) if m["year"] == 2035), None) if o.get("base_year") else None
            extra = f" Při zachování trendů model odhaduje v roce 2035 {_fmt(m35['population'], 0)} obyvatel ({_fmt(m35['lower'], 0)}–{_fmt(m35['upper'], 0)})." if m35 else ""
            score = _clamp(0.3 + abs(tr["pct_per_year"]) / 1.2)
            out.append(_risk(tid, "ubytek", "Dlouhodobý úbytek obyvatel", "demografie", score, "trend",
                             f"Počet obyvatel klesá od roku {tr['since']} o {_fmt(abs(tr['pct_per_year']), 2)} % ročně.{extra}",
                             ["Klesající základna daňových příjmů", "Nižší využití škol a služeb"], ["110900", "110700"],
                             ["byty", "pracovni_mista"], tr, tr["points"]))

    # 3 — out-migration
    mig = store.series(tid, "d_migrace")
    if len(mig) >= 5:
        recent = [mig[y] for y in sorted(mig)[-5:]]
        med = median(recent)
        if med < -2.0:
            negative_years = sum(1 for v in recent if v < 0)
            score = _clamp(0.25 + abs(med) / 12)
            kind = "opakovany" if negative_years >= 4 else "stav"
            out.append(_risk(tid, "odliv", "Odliv obyvatel", "demografie", score, kind,
                             f"Saldo migrace bylo záporné v {negative_years} z posledních 5 let (medián {_fmt(med)} ‰).",
                             ["Odcházejí převážně mladší obyvatelé", "Zrychluje stárnutí"], ["d_migrace", "110600"], ["byty", "pracovni_mista", "spoj"],
                             classify(mig, 1), len(mig)))

    # 4 — GP availability (read at ORP level for an obec: a GP serves the area)
    area = ctx.id if ctx else tid
    gp = store.latest(area, "d_pl_10k")
    rgp = ref_latest("d_pl_10k") if ref else None
    if gp and rgp and gp[1] < 0.8 * rgp:
        gap = 1 - gp[1] / rgp
        where = f"ve správním obvodu {ctx.name}" if ctx else ""
        out.append(_risk(area if ctx else tid, "lekari", "Dostupnost praktických lékařů", "zdravotnictvi", _clamp(0.3 + 1.4 * gap), "stav",
                         f"Na 10 000 obyvatel připadá {_fmt(gp[1])} ordinací praktického lékaře {where} (kraj {_fmt(rgp)}).",
                         ["Delší dojíždění k lékaři", "Riziko roste se stárnutím populace"], ["d_pl_10k", "070700"], ["ordinace", "spoj"],
                         classify(store.series(area, "d_pl_10k"), 1), len(store.series(area, "d_pl_10k"))))
        out[-1]["id"] = f"{tid}:lekari"

    # 5 — school class size (capacity pressure)
    cls = store.series(tid, "d_zs_trida")
    if len(cls) >= 5:
        cur = cls[max(cls)]
        tr = classify(cls, -1)
        if cur >= 24 or (cur >= 21 and tr["kind"] == "trend" and tr["slope"] > 0):
            score = _clamp((cur - 18) / 12 + (0.1 if tr["slope"] > 0 else 0))
            out.append(_risk(tid, "skoly", "Tlak na kapacitu základních škol", "skolstvi", score, "vznikajici" if tr["slope"] > 0 else "stav",
                             f"Průměrná třída ZŠ má {_fmt(cur)} žáků (zákonné maximum 30).",
                             ["Při nové výstavbě hrozí překročení kapacity"], ["d_zs_trida", "040510", "040520"], ["zs_mista"], tr, tr["points"]))

    # 6 — unemployment
    un = store.series(tid, "500020")
    run = ref_latest("500020")
    if un and run:
        cur = un[max(un)]
        if cur > 1.3 * run and cur >= 3.0:
            tr = classify(un, -1) if len(un) >= 5 else None
            out.append(_risk(tid, "nezamestnanost", "Nadprůměrná nezaměstnanost", "socialni", _clamp(0.25 + (cur / run - 1) * 0.6), "stav",
                             f"Podíl nezaměstnaných je {_fmt(cur)} % (kraj {_fmt(run)} %).", ["Vyšší potřeba sociální podpory"],
                             ["500020", "501000", "504010"], ["pracovni_mista"], tr, len(un)))

    # 7 — residential care for seniors (ORP scale)
    ds = store.latest(area, "d_ds_100_65")
    rds = ref_latest("d_ds_100_65")
    old = store.series(area, "110990")
    if ds and rds and ds[1] < 0.6 * rds and len(old) >= 5:
        growing = classify(old, 0)["slope"] > 0
        out.append(_risk(tid, "pece_seniori", "Kapacita pobytové péče o seniory", "socialni", _clamp(0.35 + (1 - ds[1] / rds) * 0.6 + (0.1 if growing else 0)),
                         "vznikajici" if growing else "stav",
                         f"Na 100 obyvatel 65+ připadá {_fmt(ds[1])} míst v domovech pro seniory (kraj {_fmt(rds)})" + (" a počet seniorů roste." if growing else "."),
                         ["Poptávka po péči poroste rychleji než kapacity"], ["d_ds_100_65", "150160", "110990"], ["domov_seniori"], None, len(old)))
        out[-1]["evidence"] = [e for c in ("d_ds_100_65", "150160", "110990") if (e := evidence(area, c))]

    # 8 — sewerage (obec infrastructure)
    if t.level == "obec":
        sew = store.latest(tid, "600201")
        p = store.latest(tid, "110900")
        if sew is not None and sew[1] == 0 and p and p[1] >= 300:
            out.append(_risk(tid, "kanalizace", "Chybí veřejná kanalizace", "prostredi", 0.45 if p[1] >= 1000 else 0.3, "stav",
                             f"Obec s {_fmt(p[1], 0)} obyvateli nemá podle ČSÚ veřejnou kanalizaci ({sew[0]}).",
                             ["Omezení další výstavby", "Závislost na septicích a DČOV"], ["600201", "600301"], ["byty"], None, 1))

    # 9 — public finances
    sal = store.series(tid, "200802")
    if len(sal) >= 4:
        last3 = [sal[y] for y in sorted(sal)[-3:]]
        tax = store.latest(tid, "d_dan_obyv")
        rtax = ref_latest("d_dan_obyv")
        if all(v < 0 for v in last3) and tax and rtax and tax[1] < 0.85 * rtax:
            out.append(_risk(tid, "finance", "Opakovaný rozpočtový schodek", "finance", 0.35, "opakovany",
                             f"Saldo rozpočtu bylo záporné tři roky po sobě a daňové příjmy na obyvatele jsou {_fmt(tax[1], 0)} Kč (kraj {_fmt(rtax, 0)} Kč).",
                             ["Schodek může odrážet investice — nutné posoudit s rozpočtem obce"], ["200802", "d_dan_obyv"], [], None, len(sal)))

    # 10 — one-off spikes worth a note, explicitly not a trend
    for code in ("110900", "110300", "500020", "121800", "110600"):
        s = store.series(tid, code)
        if len(s) < 6:
            continue
        tr = classify(s, store.meta(code).get("polarity", 0))
        if tr["kind"] == "vykyv":
            o = tr["outliers"][-1]
            out.append(_risk(tid, f"vykyv_{code}", f"Jednorázový výkyv: {store.meta(code)['name']}", store.meta(code)["pillar"], 0.2, "vykyv",
                             f"Hodnota v roce {o['year']} ({_fmt(o['value'], 0)}) se odchyluje od dlouhodobého vývoje o {_fmt(abs(o['z']))} robustních σ. "
                             "Jde o jednorázovou odchylku, ne o trend.", ["Ověřit příčinu (metodická změna, jednorázová událost)"], [code], [], tr, tr["points"]))
    out.sort(key=lambda r: -r["score"])
    _cache[tid] = out
    return out


def ranking(level_name: str = "obec", kraj_code: int = 86, limit: int = 50) -> list[dict]:
    rows = []
    for t in store.members(level_name, kraj_code):
        risks = assess(t.id)
        if not risks:
            continue
        top = risks[0]
        rows.append({"territory": {"id": t.id, "name": t.name, "population": t.population}, "top": {k: top[k] for k in ("type", "title", "level", "level_label", "score", "text")},
                     "count": len(risks), "score": round(sum(r["score"] for r in risks[:3]), 3)})
    rows.sort(key=lambda r: -r["score"])
    return rows[:limit]
