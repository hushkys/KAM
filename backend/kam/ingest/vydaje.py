"""Rozpočty obcí podle rozpočtové skladby z vydaje.com (data MF ČR, MONITOR státní pokladny).

ČSÚ MOS nese za obec jen součty (příjmy, výdaje, kapitálové výdaje). Výdaje.com
přebírá výkaz FIN 2-12 M z MONITORu a rozepisuje ho podle **oddílů rozpočtové
skladby**: za co obec utratila (doprava, školství, odpady…), na co (platy,
nákupy, investice) a odkud měla dotace (stát, kraj, fondy). To je přesně ta
vrstva, kterou MOS nemá, a proto ji čteme zvlášť.

Služba vydává statické soubory: `data/obce.json` je seznam obcí, `data/d/<kód>.json`
rozpočet jedné obce. Kód je RÚIAN, tedy stejný jako náš `Territory.code`, takže
se páruje kódem, ne jménem (stejnojmenných obcí je v Česku desítky).

Částky jsou v celých korunách (ne v tisících jako u MOS). Hodnoty ukládáme jako
pozorování s prefixem `vyd_`; nic se nedopočítává, kromě součtů nad obcemi, které
dělá `analytics/store.py` stejně jako u každého jiného ukazatele.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import delete, select

from ..db import session_scope
from ..models import Dataset, Indicator, Observation, Source, Territory, now
from ..territory import HOME_KRAJ
from .common import client, get_json, job

ZAKLAD = "https://vydaje.com"
SOURCE_ID = "vydaje"
SOURCE_LABEL = "Výdaje.com — rozpočty obcí z MONITORu státní pokladny (MF ČR)"
ORIGIN = "MF ČR, MONITOR státní pokladny (výkaz FIN 2-12 M)"
EXT_ID = "vydaje:rozpocty-obci"

# Polarita je všude 0: kolik obec kam utrácí není dobré ani špatné samo o sobě,
# záleží na velikosti obce a na tom, co potřebuje.
CATS: tuple[tuple[str, str], ...] = (
    ("doprava", "Doprava"),
    ("skolstvi", "Školství"),
    ("kultura", "Kultura a církve"),
    ("sport", "Sport a volný čas"),
    ("zdravi", "Zdravotnictví"),
    ("bydleni", "Bydlení a komunální služby"),
    ("zivotni", "Životní prostředí a odpady"),
    ("voda", "Vodní hospodářství"),
    ("socialni", "Sociální věci"),
    ("bezpecnost", "Bezpečnost a požární ochrana"),
    ("sprava", "Veřejná správa"),
    ("hospodarstvi", "Zemědělství a hospodářství"),
    ("ostatni", "Ostatní a finanční operace"),
)
DRUH: tuple[tuple[str, str], ...] = (
    ("platy", "Platy a odvody"),
    ("nakupy", "Nákupy a služby"),
    ("transfery", "Transfery"),
    ("investice", "Investice"),
    ("ostatni_bezne", "Ostatní běžné výdaje"),
)
DOTACE: tuple[tuple[str, str], ...] = (
    ("stat", "ze státního rozpočtu"),
    ("fondy", "ze státních fondů"),
    ("kraje", "od kraje"),
    ("eu", "z EU"),
    ("obce", "od jiných obcí"),
)

# (kód ukazatele, název, jednotka, blok v souboru, klíč v bloku)
UKAZATELE: tuple[tuple[str, str, str, str, str], ...] = (
    ("vyd_celkem", "Výdaje obce celkem (rozpočtová skladba)", "Kč", "exp", ""),
    *((f"vyd_{k}", f"Výdaje: {n}", "Kč", "cats", k) for k, n in CATS),
    *((f"vyd_druh_{k}", f"Výdaje podle druhu: {n}", "Kč", "druh", k) for k, n in DRUH),
    *((f"vyd_dot_{k}", f"Přijaté dotace {n}", "Kč", "dsrc", k) for k, n in DOTACE),
)
KODY = tuple(u[0] for u in UKAZATELE)
CATEGORIE = {f"vyd_{k}": n for k, n in CATS}
DRUHY = {f"vyd_druh_{k}": n for k, n in DRUH}
ZDROJE_DOTACI = {f"vyd_dot_{k}": n for k, n in DOTACE}


def register() -> None:
    with session_scope() as s:
        if s.get(Source, SOURCE_ID) is None:
            s.add(Source(id=SOURCE_ID, kind="api", name="Výdaje.com — rozpočty obcí", publisher="Ministerstvo financí ČR (zpracování vydaje.com)",
                         ico="00006947", url=ZAKLAD + "/data/summary.json", portal_url=ZAKLAD, license="Otevřená data MF ČR (MONITOR)", group="core"))
        for code, name, unit, _blok, _klic in UKAZATELE:
            row = s.get(Indicator, code) or Indicator(code=code)
            row.name, row.unit, row.pillar, row.polarity, row.agg = name, unit, "finance", 0, "sum"
            row.source_label, row.origin, row.source_url = SOURCE_LABEL, ORIGIN, ZAKLAD
            s.merge(row)


def _stahni(kod: str) -> tuple[str, dict | None]:
    try:
        with client(60) as c:
            return kod, get_json(c, f"{ZAKLAD}/data/d/{kod}.json", tries=3)
    except Exception:
        return kod, None


def ingest() -> dict[str, int]:
    job("vydaje", "running", "Stahuji rozpočty obcí z vydaje.com")
    register()
    with session_scope() as s:
        obce = {t.code: t.id for t in s.scalars(select(Territory).where(Territory.level == "obec", Territory.kraj_code == HOME_KRAJ))}
    rows: list[dict] = []
    chybi: list[str] = []
    roky: set[int] = set()
    hotovo = 0
    with ThreadPoolExecutor(8) as pool:
        for kod, data in pool.map(_stahni, list(obce)):
            hotovo += 1
            if hotovo % 50 == 0:
                job("vydaje", "running", f"{hotovo}/{len(obce)} obcí", hotovo / len(obce))
            bud = (data or {}).get("bud")
            if not bud:
                chybi.append(kod)
                continue
            for rok_txt, y in (bud.get("years") or {}).items():
                rok = int(rok_txt)
                roky.add(rok)
                for code, _n, _u, blok, klic in UKAZATELE:
                    v = y.get("exp") if blok == "exp" else (y.get(blok) or {}).get(klic)
                    if v is None:
                        continue
                    rows.append({"territory_id": obce[kod], "indicator_code": code, "year": rok, "value": float(v)})
    rows = list({(r["territory_id"], r["indicator_code"], r["year"]): r for r in rows}.values())
    if not rows:
        job("vydaje", "error", "vydaje.com nevrátilo žádná data")
        return {"hodnot": 0, "obci": 0, "bez_dat": len(chybi)}
    with session_scope() as s:
        s.execute(delete(Observation).where(Observation.indicator_code.in_(KODY)))
        s.bulk_insert_mappings(Observation, rows)
        # Záznam v katalogu: ukazuje, že tahle sada se opravdu čte, a z čeho.
        d = s.scalar(select(Dataset).where(Dataset.ext_id == EXT_ID))
        pole = dict(
            source_id=SOURCE_ID, title="Rozpočty obcí podle rozpočtové skladby (Výdaje.com)",
            description="Výdaje obcí po oddílech rozpočtové skladby, podle druhu výdaje a přijaté dotace podle zdroje. Přebíráno z výkazu FIN 2-12 M (MONITOR státní pokladny, MF ČR), v celých korunách po letech.",
            publisher="Ministerstvo financí ČR", publisher_ico="00006947", url=ZAKLAD, landing_url=ZAKLAD, download_url=f"{ZAKLAD}/data/obce.json",
            formats="JSON", themes="Veřejné finance", pillar="finance", region_code=0, periodicity="měsíčně", modified=now().date().isoformat(),
            freshness="aktualni", loaded=True, usage=["model"], check_status="ok", check_code=200, content_status="data", content_kind="json", content_code=200,
            checked_at=now(), content_at=now(), harvested_at=now(), keywords="rozpočet obce výdaje MONITOR FIN 2-12 M účtenka",
        )
        if d:
            for k, v in pole.items():
                setattr(d, k, v)
        else:
            s.add(Dataset(ext_id=EXT_ID, **pole))
        src = s.get(Source, SOURCE_ID)
        if src:
            src.dataset_count, src.last_harvest_at, src.last_error = 1, now(), ""
    out = {"hodnot": len(rows), "obci": len(obce) - len(chybi), "bez_dat": len(chybi), "let": len(roky)}
    job("vydaje", "done", json.dumps(out), 1.0)
    return out
