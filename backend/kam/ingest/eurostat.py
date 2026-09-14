"""Eurostat: evropská statistika, která opravdu obsahuje náš kraj.

NKOD je prakticky celá česká otevřená data a máme z něj všechno, co v něm je.
Zbytek rezervy leží mimo něj — a nejvíc jí je u Eurostatu, který publikuje
regionální statistiku po jednotkách NUTS. Královéhradecký kraj je NUTS3
`CZ052` a leží v regionu soudržnosti Severovýchod `CZ05`.

Katalog Eurostatu má přes osm tisíc datových sad, ale drtivá většina končí u
států. Proto se **každá sada ověřuje dotazem** na `geo=CZ052` a `geo=CZ05`:
zapíše se jen ta, která na tom dotazu vrátí aspoň jednu hodnotu. Ověření je
pomalé (jeden dotaz na sadu), ale je to jediný způsob, jak nesypat do katalogu
tisíce položek, které o kraji nic neříkají. Sady bez hodnot se tiše zahodí.

`download_url` míří na týž dotaz, který ověření prošel, takže odkaz v aplikaci
vrací data o kraji, ne celoevropskou tabulku.
"""

from __future__ import annotations

import csv
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from ..territory import HOME_KRAJ
from .catalog import _save_source, _store, _usage
from .common import USER_AGENT, client, job, norm

TOC = "https://ec.europa.eu/eurostat/api/dissemination/catalogue/toc/txt"
DATA = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
BROWSER = "https://ec.europa.eu/eurostat/databrowser/view/{code}/default/table"
PORTAL = "https://ec.europa.eu/eurostat/web/regions/database"
SOURCE_ID = "eurostat"
WORKERS = 12

# NUTS jednotky, na kterých kraj poznáme, od nejbližší po nejširší.
GEOS = (
    ("CZ052", HOME_KRAJ, "Královéhradecký kraj (NUTS3 CZ052)"),
    ("CZ05", 0, "region soudržnosti Severovýchod (NUTS2 CZ05) — Královéhradecký, Liberecký a Pardubický kraj"),
)

# Názvy u Eurostatu jsou anglicky, takže české kmeny z `catalog.PILLAR_RULES`
# na nich neseberou nic. Tady je jejich anglický protějšek — o dost kratší,
# protože stačí rozlišit devět pilířů.
EN_RULES: dict[str, tuple[str, ...]] = {
    "demografie": ("population", "demograph", "fertility", "mortality", "births", "deaths", "migration", "life expectancy", "age group", "census", "household"),
    "doprava": ("transport", "road", "rail", "vehicle", "passenger", "freight", "airport", "maritime", "traffic", "mobility"),
    "skolstvi": ("education", "school", "pupil", "student", "training", "learning", "literacy", "graduat", "tertiary"),
    "zdravotnictvi": ("health", "hospital", "physician", "medical", "disease", "mortality by", "care bed", "healthcare"),
    "socialni": ("employment", "unemploy", "labour", "poverty", "social", "income", "earnings", "wage", "pension", "job", "activity rate", "exclusion"),
    "bydleni": ("housing", "dwelling", "building", "construction", "land use", "urban", "settlement"),
    "kultura": ("tourism", "tourist", "culture", "cultural", "museum", "accommodation", "nights spent", "sport", "recreation", "heritage"),
    "prostredi": ("environment", "emission", "waste", "water", "air", "climate", "energy", "forest", "agricultur", "farm", "soil", "biodiversity", "livestock", "crop", "organic"),
    "finance": ("gdp", "gross domestic", "gross value", "investment", "expenditure", "account", "business", "enterprise", "turnover", "r&d", "research and development", "innovation", "patent", "productivity"),
}


def classify_en(title: str) -> str:
    t = norm(title)
    best, score = "ostatni", 0
    for pillar, stems in EN_RULES.items():
        n = sum(1 for s in stems if s in t)
        if n > score:
            best, score = pillar, n
    return best


def _toc(c: httpx.Client) -> list[tuple[str, str]]:
    r = c.get(TOC, params={"lang": "en"})
    r.raise_for_status()
    rows = csv.reader(io.StringIO(r.text), delimiter="\t")
    return [(row[1], row[0].strip()) for row in rows if len(row) > 2 and row[2] == "dataset" and row[1]]


def _probe(session: httpx.Client, code: str, title: str) -> dict | None:
    """Vrátí popis sady, pokud má hodnoty pro kraj nebo pro Severovýchod.

    Na velké sady odpoví Eurostat 413 i po zúžení na jedno území — obsahují
    tolik členění, že se celá řada nevejde do odpovědi. Takovou sadu se ještě
    jednou zeptáme jen na poslední období: ke zjištění, že o kraji data má,
    to stačí, a `download_url` pak nese stejné zúžení, aby odkaz fungoval.
    """
    for geo, region, coverage in GEOS:
        narrow = False
        for attempt in range(4):
            try:
                params = {"format": "JSON", "lang": "en", "geo": geo}
                if narrow:
                    params["lastTimePeriod"] = 1
                r = session.get(DATA + code, params=params)
                if r.status_code == 429:
                    time.sleep(2 + 3 * attempt)
                    continue
                if r.status_code == 413 and not narrow:
                    narrow = True
                    continue
                if r.status_code != 200:
                    break
                j = r.json()
                if not (j.get("value") or {}):
                    break  # sada existuje, ale o tomhle území mlčí
                dim = j.get("dimension", {})
                years = list((dim.get("time", {}).get("category", {}).get("index") or {}).keys())
                dims = [dim.get(k, {}).get("label") or k for k in (j.get("id") or []) if k not in ("geo", "time", "freq")]
                return {
                    "code": code, "title": j.get("label") or title, "geo": geo, "region": region, "coverage": coverage,
                    "values": len(j["value"]), "updated": str(j.get("updated") or "")[:10], "narrow": narrow,
                    "first": years[0] if years else "", "last": years[-1] if years else "", "dims": dims,
                }
            except Exception:
                time.sleep(1 + attempt)
    return None


def harvest() -> dict[str, int]:
    job("eurostat", "running", "Stahuji katalog Eurostatu")
    c = client(180)
    codes = _toc(c)
    job("eurostat", "running", f"Ověřuji {len(codes)} sad na území kraje", 0.05)

    session = httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": USER_AGENT},
                           limits=httpx.Limits(max_connections=WORKERS + 4, max_keepalive_connections=WORKERS))
    found: list[dict] = []
    try:
        with ThreadPoolExecutor(WORKERS) as ex:
            for i, res in enumerate(ex.map(lambda t: _probe(session, *t), codes), 1):
                if res:
                    found.append(res)
                if i % 500 == 0:
                    job("eurostat", "running", f"{i}/{len(codes)} ověřeno, {len(found)} má data o kraji", 0.05 + 0.9 * i / len(codes))
    finally:
        session.close()

    rows = []
    for f in found:
        narrow = f.get("narrow")
        period = (f"poslední zveřejněné období {f['last']}" if narrow
                  else f"období {f['first']}–{f['last']}" if f["first"] else "bez určení období")
        dims = ", ".join(f["dims"][:4])
        rows.append({
            "ext_id": f"eurostat:{f['code']}", "source_id": SOURCE_ID, "title": f["title"][:2000],
            "description": (f"Evropská statistika za {f['coverage']}. Odkaz vrací {period}, {f['values']} hodnot"
                            + (f"; členění: {dims}." if dims else ".")
                            + (" Celá řada se do jedné odpovědi nevejde, proto je odkaz zúžený na poslední období."
                               if narrow else "")
                            + " Název a popis sady vydává Eurostat anglicky.")[:4000],
            "publisher": "Eurostat", "publisher_ico": "",
            "url": BROWSER.format(code=f["code"]),
            "download_url": f"{DATA}{f['code']}?format=JSON&lang=en&geo={f['geo']}" + ("&lastTimePeriod=1" if narrow else ""),
            "formats": "JSON,TSV",
            "keywords": "|".join(["eurostat", "regionální statistika", f["geo"], "NUTS", *f["dims"][:8]])[:2000],
            "themes": "", "pillar": classify_en(f["title"]), "region_code": f["region"],
            "periodicity": "", "modified": f["updated"], "freshness": "neznama",
            "usage": _usage(f["region"], "neznama"),
        })

    _store(SOURCE_ID, rows)
    _save_source(SOURCE_ID, name="Eurostat — regionální statistika pro Královéhradecký kraj", kind="api",
                 url=DATA, portal_url=PORTAL, group="core", publisher="Eurostat",
                 license="Eurostat — volné užití s uvedením zdroje", dataset_count=len(rows))
    counts = {"proverenych": len(codes), "s_daty": len(rows),
              "kraj": sum(1 for r in rows if r["region_code"] == HOME_KRAJ),
              "severovychod": sum(1 for r in rows if r["region_code"] == 0)}
    job("eurostat", "done", json.dumps(counts), 1.0)
    return counts
