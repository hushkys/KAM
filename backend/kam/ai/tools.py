"""Deterministic tools the assistant reads from.

The model never computes a number. It receives the output of these tools —
a compact, labelled text brief with its sources — and explains it.
"""

from __future__ import annotations

import re

from ..analytics import forecast, plany, simulate, store
from ..analytics.profile import PROFILE_CODES, card, reference
from ..analytics.risks import assess
from ..indicators import PILLARS
from ..territory import LEVEL_LABEL
from .rag import plain

CONNECTORS = {"nad", "pod", "u", "v", "ve", "na", "a", "kraj"}


def _stem(tok: str) -> str:
    return tok if len(tok) <= 4 else tok[: max(4, len(tok) - 2)]


def find_territory(text: str):
    q = plain(text)
    qtoks = re.findall(r"[a-z0-9]+", q)
    if not qtoks:
        return None
    if re.search(r"\b(cesk\w*|cr|republik\w*|celostatn\w*)\b", q) and not re.search(r"kralovehradeck", q):
        cz = store.territory("cz")
        if cz and re.search(r"\b(cesk\w* republik\w*|cele cesko|celostatn\w*|v cr|za cr)\b", q):
            return cz
    best, best_score = None, 0.0
    for t in store.territories().values():
        if t.level == "cz":
            continue
        ntoks = [x for x in re.findall(r"[a-z0-9]+", plain(t.name)) if x not in CONNECTORS]
        if not ntoks:
            continue
        ok = all(any((qt == n) if len(n) <= 4 else qt.startswith(_stem(n)) for qt in qtoks) for n in ntoks)
        if not ok:
            continue
        score = sum(len(n) for n in ntoks) * 1.0
        if t.level == "kraj":
            score += 6 if "kraj" in q else -20
        elif t.level == "orp":
            score += 6 if re.search(r"\borp\b|obvod|spravni", q) else -0.5
        elif t.level == "okres":
            score += 6 if "okres" in q else -30
        if score > best_score:
            best, best_score = t, score
    return best


def _fmt(v, d: int = 1) -> str:
    if v is None:
        return "—"
    if isinstance(v, float) and abs(v) >= 100:
        d = 0
    return f"{v:,.{d}f}".replace(",", " ").replace(".", ",")


def brief(tid: str, compact: bool = False) -> tuple[str, list[dict]]:
    """Labelled facts for the model. `compact` halves the text for the local
    model, whose prompt prefill is the slow part (≈14 s per 2 000 characters
    on Gemma 4 E4B), keeping the ratios, risks and outlook that answers use."""
    t = store.territory(tid)
    if t is None:
        return "", []
    ref = reference(tid)
    ref_t = store.territory(ref) if ref else None
    pop = store.latest(tid, "110900")
    parent = store.territory(t.parent_id) if t.parent_id else None
    lines = [f"ÚZEMÍ: {t.name} ({LEVEL_LABEL.get(t.level, t.level)}" + (f", {parent.name}" if parent else "") + ")"]
    if pop:
        lines.append(f"FAKT: {_fmt(pop[1], 0)} obyvatel k 31. 12. {pop[0]} (ČSÚ).")
    sources: dict[str, dict] = {}
    for pillar, codes in PROFILE_CODES.items():
        items = []
        picked = [c for c in codes if c.startswith("d_") or c == "500020"][:2] if compact else codes[:4]
        for code in picked or codes[:1]:
            c = card(tid, code, ref)
            if not c:
                continue
            tr = c["trend"]
            trend = f"; TREND: {c['text']}" if tr.get("kind") in ("trend", "vykyv") else ""
            cmp = c.get("compare")
            def show(v: float) -> str:
                if c["unit"] == "ano/ne":
                    return "ano" if v == 1 else "ne" if v == 0 else f"{_fmt(v * 100, 0)} % obyvatel"
                return f"{_fmt(v, 2)} {c['unit']}".strip()
            cmp_txt = f"; {ref_t.name if ref_t else 'srovnání'}: {show(cmp['value'])}" if cmp and cmp.get("value") is not None else ""
            items.append(f"{c['name']} = {show(c['value'])} ({c['year']}){cmp_txt}{trend}")
            if c.get("source_url"):
                sources[c["source_url"]] = {"title": c.get("source") or c["name"], "url": c["source_url"], "type": "zdroj dat"}
        if items:
            lines.append(f"{PILLARS[pillar].upper()}: " + " | ".join(items))
    rs = assess(tid)[: 4 if compact else 5]
    if rs:
        lines.append("RIZIKA (pravidla nad daty):")
        for r in rs:
            lines.append(f"- {r['level_label']}: {r['title']} — {r['text']} (důvěra {int(100 * r['confidence'])} %)")
    o = forecast.summary(tid)
    if o.get("milestones"):
        ms = "; ".join(f"{m['year']}: {_fmt(m['population'], 0)} ({_fmt(m['lower'], 0)}–{_fmt(m['upper'], 0)}), podíl 65+ {_fmt(m['share_65'])} %" for m in o["milestones"])
        lines.append(f"MODEL (výhled, pravděpodobný scénář, 90% interval): {ms}.")
    dok = plany.uzemi(tid)
    if dok:
        radky = []
        for r in dok["dokumenty"]:
            # Lokálnímu modelu se posílá jen to, co obec opravdu má: čtyři
            # řádky, z nichž dva říkají „chybí", jsou v úsporném podkladu
            # draho placená informace (prefill je na Gemmě to pomalé).
            if compact and r["stav"] == "chybi":
                continue
            kdy = f", {r['od']}–{r['do']}" if r.get("od") and r.get("do") else (f", {_den(r.get('datum'))}" if r.get("datum") else "")
            radky.append(f"{r['povinnost']}: {r['nazev']}{kdy} [{STAV_SLOVEM.get(r['stav'], r['stav'])}]")
            if r.get("url"):
                sources[r["url"]] = {"title": r["nazev"], "url": r["url"], "type": r["zdroj"]}
        if radky:
            lines.append("DOKUMENTY (co má obec zveřejněné): " + " | ".join(radky))
            # Bez téhle věty by model z „období uplynulo ze 100 %" udělal
            # „plán je splněný". Splnění nikdo strojově nezveřejňuje.
            lines.append("POZOR: uplynulý čas období není splněný plán — kolik z plánu je "
                         "hotové, nezveřejňuje strojově čitelně žádný registr a KAM to netvrdí.")

    facts = store.facts(tid)
    if facts.get("posta"):
        lines.append(f"FAKT: Pošta: {facts['posta']['value']} (Data KHK).")
    if facts.get("kanalizace"):
        lines.append(f"FAKT: Kanalizace — hodnota v datech kraje: {facts['kanalizace']['value']} (Data KHK).")
    return "\n".join(lines), list(sources.values())


def _den(iso: str | None) -> str:
    """`2025-10-24` → `24. 10. 2025`. Model dostává datum tak, jak ho napíše
    do odpovědi; ISO tvar by z podkladu opsal doslova."""
    if not iso or len(iso) < 10:
        return iso or ""
    r, m, d = iso[:4], iso[5:7], iso[8:10]
    return f"{int(d)}. {int(m)}. {r}"


#: Stavy dokumentů slovem — model dostává text, ne klíče aplikace.
STAV_SLOVEM = {"plati": "platí", "konci": "poslední rok platnosti",
               "prosly": "období doběhlo", "bez_obdobi": "bez uvedeného období",
               "chybi": "chybí, není v registru"}

NUM = r"(\d[\d\s]{0,6})"


def scenario_from_text(text: str) -> list[dict]:
    q = plain(text)
    year = re.search(r"(v roce|od roku|do roku|rok[ue]?)\s*(20[2-4]\d)", q)
    rok = {"rok": int(year.group(2))} if year else {}
    out: list[dict] = []

    def n(m) -> int:
        return int(re.sub(r"\s", "", m.group(1)))

    if m := re.search(NUM + r"\s*(novych\s+)?(bytu|byty|bytovych)", q):
        typ = "rodinne_domy" if re.search(r"rodinn\w* dom", q) else "bytove_domy"
        out.append({"type": "byty", "params": {"pocet": n(m), "typ": typ, **rok}})
    if m := re.search(NUM + r"\s*(novych\s+)?(mist|mista)\s+(v|ve|do|pro)?\s*(zs|zakladn\w*)", q):
        out.append({"type": "zs_mista", "params": {"pocet": n(m), **rok}})
    elif re.search(r"(rozsir\w*|pristav\w*|kapacit\w*)\s+(\w+\s+)?(zs|zakladn\w* skol\w*|skol\w*)", q):
        out.append({"type": "zs_mista", "params": {**rok}})
    if m := re.search(NUM + r"\s*(novych\s+)?(mist|mista)\s+(v|ve|do|pro)?\s*(ms|matersk\w*|skolk\w*)", q):
        out.append({"type": "ms_mista", "params": {"pocet": n(m), **rok}})
    if m := re.search(NUM + r"\s*(novych\s+)?(luzek|luzka|mist v domov\w*)", q):
        out.append({"type": "domov_seniori", "params": {"pocet": n(m), **rok}})
    if m := re.search(NUM + r"\s*(novych\s+)?(spoju|spoje|autobus\w*)", q):
        out.append({"type": "spoj", "params": {"spoje_den": n(m), **rok}})
    elif re.search(r"zastavk\w*|autobus\w*|spoj\b|linku", q):
        out.append({"type": "spoj", "params": {**rok}})
    if m := re.search(NUM + r"\s*(novych\s+)?(pracovnich mist|pracovni mista|mist v prumysl\w*|zamestnanc\w*)", q):
        out.append({"type": "pracovni_mista", "params": {"pocet": n(m), **rok}})
    if re.search(r"ordinac\w*|praktick\w* lekar|novy lekar|lekare", q):
        m = re.search(NUM + r"\s*(novych\s+)?(ordinac\w*|lekar\w*)", q)
        out.append({"type": "ordinace", "params": {"pocet": n(m) if m else 1, **rok}})
    return out


def sim_brief(res: dict) -> str:
    if not res.get("available"):
        return f"SCÉNÁŘ: nelze spočítat — {res.get('reason', '')}"
    lines = [f"SCÉNÁŘ (simulace KAM, {res['territory']['name']}): " + " → ".join(s["label"] + f" [{s['tag']}]" for s in res["chain"])]
    for m in res["metrics"]:
        v = m["values"][-1]
        if v["base"] is None:
            continue
        lines.append(f"- {m['label']} {v['year']}: bez zásahu {_fmt(v['base'], 1)}, se zásahem {_fmt(v['scenario'], 1)} (rozdíl {_fmt(v['delta'], 1)}) {m['unit']}")
    for w in res["warnings"]["scenario"]:
        lines.append(f"- VAROVÁNÍ ({w['level']}): {w['title']} — {w['text']}")
    c = res["costs"]
    lines.append(f"- Náklady (předpoklady): investice {_fmt(c['capex'] / 1e6, 1)} mil. Kč, provoz {_fmt(c['opex_year'] / 1e6, 2)} mil. Kč/rok; změna daňových příjmů v roce 2040 {_fmt(c['tax_delta_year'] / 1e6, 2)} mil. Kč/rok.")
    return "\n".join(lines)


def run_scenario(tid: str, interventions: list[dict]) -> dict:
    return simulate.run(tid, interventions)


def kraj_in_text(text: str) -> int:
    from ..ingest.catalog import kraj_from_text
    return kraj_from_text(text)


def asks_catalog(text: str) -> bool:
    q = plain(text)
    return bool(re.search(r"(kolik|pocet|prehled|seznam|jake|ktere)\b.*\b(datov\w*|sad\w*|zdroj\w*|dat)\b", q))


def catalog_brief(region: int = 0) -> str:
    """Counts over the whole catalogue, so the model can answer "how many…"
    and "which sources" without guessing. Only link-verified datasets count."""
    from sqlalchemy import func, select

    from ..db import SessionLocal
    from ..models import Dataset, Source
    from ..territory import KRAJ_BY_CODE
    ok = Dataset.check_status == "ok"
    with SessionLocal() as s:
        total = s.scalar(select(func.count(Dataset.id)).where(ok)) or 0
        allrows = s.scalar(select(func.count(Dataset.id))) or 0
        by_src = s.execute(select(Source.name, func.count(Dataset.id)).join(Dataset, Dataset.source_id == Source.id).where(ok)
                           .group_by(Source.name).order_by(func.count(Dataset.id).desc()).limit(8)).all()
        by_region = dict(s.execute(select(Dataset.region_code, func.count()).where(ok).group_by(Dataset.region_code)).all())
        lines = [f"KATALOG KAM: {total:,} funkčních datových sad (ověřený odkaz) z {allrows:,} evidovaných.".replace(",", " "),
                 "Největší zdroje: " + "; ".join(f"{n} ({c})" for n, c in by_src) + "."]
        if region and region in KRAJ_BY_CODE:
            rsrc = s.execute(select(Source.name, func.count(Dataset.id)).join(Dataset, Dataset.source_id == Source.id).where(ok, Dataset.region_code == region)
                             .group_by(Source.name).order_by(func.count(Dataset.id).desc()).limit(6)).all()
            lines.append(f"{KRAJ_BY_CODE[region].name}: {by_region.get(region, 0)} funkčních sad; zdroje: " + "; ".join(f"{n} ({c})" for n, c in rsrc) + ".")
        else:
            lines.append("Podle krajů: " + "; ".join(f"{KRAJ_BY_CODE[k].short} {v}" for k, v in sorted(by_region.items(), key=lambda kv: -kv[1]) if k in KRAJ_BY_CODE)
                         + f"; celostátní {by_region.get(0, 0)}.")
    lines.append("Přesný seznam s odkazy je na stránce Data (/data).")
    return "\n".join(lines)


def dataset_hits(query: str, region: int, k: int) -> list[dict]:
    """Dataset search over the whole catalogue, narrowed to a kraj when one is named."""
    from sqlalchemy import select

    from ..db import SessionLocal
    from ..models import Dataset
    from .rag import search
    hits = search(query, k=80, types=("dataset",))
    with SessionLocal() as s:
        meta = {str(i): (r, st) for i, r, st in s.execute(select(Dataset.id, Dataset.region_code, Dataset.check_status)
                                                             .where(Dataset.id.in_([int(h["id"]) for h in hits if h["id"].isdigit()])))}
    out = [h for h in hits if meta.get(h["id"], (0, ""))[1] == "ok" and (not region or meta.get(h["id"], (0, ""))[0] in (region, 0))]
    if region:
        out.sort(key=lambda h: meta.get(h["id"], (0, ""))[0] != region)
    return out[:k]
