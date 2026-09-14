"""Open-data catalogue harvester.

Sources, in order of authority:

1. NKOD — the whole National Open Data Catalogue (every publisher), through
   its SPARQL endpoint. Each dataset is placed in a kraj by its RÚIAN
   `dcterms:spatial` (kraj, okres, ORP, obec or city part), falling back to
   the publisher when the publisher is a kraj.
2. Regional and city portals (ArcGIS Hub DCAT-AP feeds, the OFN catalogue of
   Hradec Králové) — only datasets that NKOD does not already carry; a match
   on the normalised title within the same kraj merges the two records.
3. Geoportál INSPIRE (CENIA, CSW) and the NPÚ heritage geoportal — spatial
   datasets and services.

Every dataset is really used, and the UI says how (`Dataset.usage`):
`katalog`, `rag` (the assistant can find and cite it), `pokryti`
(coverage matrix), `cerstvost` (declared update period check), `mapa`
(attached to its kraj on the national map), `model` (values loaded).
Whether its link actually works is checked separately (`ingest/check.py`).
The count shown in the app is computed from this table, never typed in.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from urllib.parse import quote

from sqlalchemy import select, update

from ..db import session_scope
from ..models import Dataset, Source, now
from ..territory import HOME_KRAJ, KRAJ_BY_CODE, KRAJ_BY_ICO
from . import geo
from .common import client, get_json, job, norm

SPARQL = "https://data.gov.cz/sparql"
PUB = "https://rpp-opendata.egon.gov.cz/odrpp/zdroj/orgán-veřejné-moci/"
NKOD_PAGE = "https://data.gov.cz/datová-sada?iri="
NKOD_PUBLISHER_PAGE = "https://data.gov.cz/datové-sady?poskytovatel="

# Publishers the brief named, plus those whose data the model reads directly.
CORE_ICO = {
    "70889546": "Královéhradecký kraj", "00025593": "Český statistický úřad", "00006947": "Ministerstvo financí",
    "17651921": "Digitální a informační agentura", "00551023": "Ministerstvo práce a sociálních věcí",
    "62933591": "Agentura ochrany přírody a krajiny ČR", "00025712": "Český úřad zeměměřický a katastrální",
    "00024341": "Ústav zdravotnických informací a statistiky ČR", "00268810": "Statutární město Hradec Králové",
    "75032333": "Národní památkový ústav", "45249130": "CENIA, česká informační agentura životního prostředí",
}
OLD_SOURCE_IDS = {
    "nkod-khk": "70889546", "nkod-csu": "00025593", "nkod-mf": "00006947", "nkod-dia": "17651921",
    "nkod-mpsv": "00551023", "nkod-aopk": "62933591",
    **{f"nkod-kraj-{k.code}": k.ico for k in KRAJ_BY_CODE.values()},
}

# (id, feed URL, name, portal page, kraj code)
DCAT_FEEDS: tuple[tuple[str, str, str, str, int], ...] = (
    ("datakhk", "https://www.datakhk.cz/api/feed/dcat-ap/2.0.1.json", "Data KHK — portál Královéhradeckého kraje", "https://www.datakhk.cz/search?collection=dataset", 86),
    ("aopk-hub", "https://gis-aopkcr.opendata.arcgis.com/api/feed/dcat-ap/2.0.1.json", "AOPK ČR — Open Data Hub", "https://gis-aopkcr.opendata.arcgis.com/", 0),
    ("chmi-hub", "https://open-data-chmi.hub.arcgis.com/api/feed/dcat-ap/2.0.1.json", "ČHMÚ — Open Data Hub", "https://open-data-chmi.hub.arcgis.com/", 0),
    ("praha-ipr", "https://opendata.geoportalpraha.cz/api/feed/dcat-ap/2.0.1.json", "Geoportál Praha — IPR Praha", "https://geoportalpraha.cz/data-a-sluzby/otevrena-data", 19),
    ("brno", "https://data.brno.cz/api/feed/dcat-ap/2.0.1.json", "data.Brno — portál města Brna", "https://data.brno.cz/", 116),
    ("msk", "https://data.msk.cz/api/feed/dcat-ap/2.0.1.json", "Datový portál Moravskoslezského kraje", "https://data.msk.cz/", 132),
    ("pardubicky", "https://data.pardubickykraj.cz/api/feed/dcat-ap/2.0.1.json", "Datový portál Pardubického kraje", "https://data.pardubickykraj.cz/", 94),
    ("datalk", "https://www.datalk.cz/api/feed/dcat-ap/2.0.1.json", "DATALK — Liberecký kraj", "https://www.datalk.cz/", 78),
    ("datazapad", "https://www.datazapad.cz/api/feed/dcat-ap/2.0.1.json", "DATAZAPAD — Karlovarský kraj", "https://www.datazapad.cz/", 51),
    ("dataok", "https://www.dataok.cz/api/feed/dcat-ap/2.0.1.json", "DATA OK — Olomoucký kraj", "https://www.dataok.cz/", 124),
    ("prerov", "https://open-data-prerov.hub.arcgis.com/api/feed/dcat-ap/2.0.1.json", "Otevřená data města Přerov", "https://open-data-prerov.hub.arcgis.com/", 124),
    ("vysocina", "https://data.kr-vysocina.cz/api/feed/dcat-ap/2.0.1.json", "Datový portál Kraje Vysočina", "https://data.kr-vysocina.cz/", 108),
    ("chomutov", "https://open-data-chomutov-cv-gis.hub.arcgis.com/api/feed/dcat-ap/2.0.1.json", "Otevřená data města Chomutov", "https://open-data-chomutov-cv-gis.hub.arcgis.com/", 60),
    ("most", "https://opendata-mestomost.hub.arcgis.com/api/feed/dcat-ap/2.0.1.json", "Otevřená data města Most", "https://opendata-mestomost.hub.arcgis.com/", 60),
    ("usti", "https://vydejdat-gismmu.hub.arcgis.com/api/feed/dcat-ap/2.0.1.json", "Geografická data Magistrátu města Ústí nad Labem", "https://vydejdat-gismmu.hub.arcgis.com/", 60),
    ("ustecky", "https://ustecky-kraj-webhub-KUUK.hub.arcgis.com/api/feed/dcat-ap/2.0.1.json", "Datový portál Ústeckého kraje", "https://ustecky-kraj-webhub-KUUK.hub.arcgis.com/", 60),
    ("olomouc", "https://opendata.olomouc.eu/api/feed/dcat-ap/2.0.1.json", "Otevřená data města Olomouc", "https://opendata.olomouc.eu/", 124),
    ("jihlava", "https://opendata.jihlava.cz/api/feed/dcat-ap/2.0.1.json", "Otevřená data města Jihlava", "https://opendata.jihlava.cz/", 108),
)
NPU_ORG = "0123456789ABCDEF"
PUBLISHER_PREFIXES = ("statutarni mesto ", "hlavni mesto ", "mestska cast ", "mestsky obvod ", "magistrat mesta ", "mestsky urad ", "obecni urad ",
                      "mesto ", "obec ", "mestys ")

MMHK_CATALOG = "https://api.opendata.mmhk.cz/lod/catalog"
CSW = "https://geoportal.gov.cz/php/micka/csw/index.php"
CSW_RECORD = "https://geoportal.gov.cz/php/micka/record/basic/"
NPU_SEARCH = "https://geoportal.npu.cz/portal/sharing/rest/search"
NPU_ITEM = "https://geoportal.npu.cz/portal/home/item.html?id="

API_SOURCES: tuple[dict, ...] = (
    {"id": "csu-mos", "name": "ČSÚ — Městská a obecní statistika (MOS), roční soubory", "publisher": "Český statistický úřad", "ico": "00025593",
     "kind": "file", "url": "https://opendata.csu.gov.cz/soubory/od/od_mos01/", "portal_url": "https://csu.gov.cz/produkty/databaze-mos-otevrena-data", "license": "CC BY 4.0"},
    {"id": "cuzk-ruian", "name": "ČÚZK — RÚIAN, prohlížecí služba (hranice územních jednotek)", "publisher": "Český úřad zeměměřický a katastrální",
     "ico": "00025712", "kind": "api", "url": "https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer",
     "portal_url": "https://cuzk.gov.cz/Uvod/Produkty-a-sluzby/Otevrena-data/Sady-otevrenych-dat.aspx", "license": "CC BY 4.0"},
    {"id": "khk-arcgis", "name": "Data KHK — ArcGIS REST služby (FeatureServer)", "publisher": "Královéhradecký kraj", "ico": "70889546",
     "kind": "api", "url": "https://services6.arcgis.com/ogJAiK65nXL1mXAW/arcgis/rest/services", "portal_url": "https://www.datakhk.cz/", "license": "CC BY 4.0"},
    {"id": "csu-open", "name": "ČSÚ — katalog otevřených dat", "publisher": "Český statistický úřad", "ico": "00025593",
     "kind": "portal", "url": "https://csu.gov.cz/otevrena_data", "portal_url": "https://csu.gov.cz/otevrena_data", "license": "CC BY 4.0"},
    {"id": "mf-open", "name": "MF ČR — portál otevřených dat", "publisher": "Ministerstvo financí", "ico": "00006947",
     "kind": "portal", "url": "https://data.mf.gov.cz/", "portal_url": "https://data.mf.gov.cz/", "license": "CC BY 4.0"},
    {"id": "mpsv-open", "name": "MPSV — otevřená data", "publisher": "Ministerstvo práce a sociálních věcí", "ico": "00551023",
     "kind": "portal", "url": "https://data.mpsv.cz/web/data", "portal_url": "https://data.mpsv.cz/web/data", "license": "CC BY 4.0"},
    {"id": "nrpzs", "name": "ÚZIS — Národní registr poskytovatelů zdravotních služeb", "publisher": "Ústav zdravotnických informací a statistiky ČR",
     "ico": "00024341", "kind": "portal", "url": "https://nrpzs.uzis.cz/index.php?pg=home--otevrena-data", "portal_url": "https://nrpzs.uzis.cz/index.php?pg=home--otevrena-data", "license": "podle NKOD"},
)

PILLAR_RULES: dict[str, tuple[str, ...]] = {
    "demografie": ("obyvatel", "demograf", "narozen", "zemrel", "umrt", "migrac", "scitani", "slbd", "vekov", "populac", "stehov", "senior"),
    "doprava": ("doprav", "autobus", "zastav", "iredo", "silnic", "zeleznic", "cyklo", "parkov", "jizdn", "komunikac", "letist", "vyluk", "gtfs", "most", "tramvaj", "mhd"),
    "skolstvi": ("skol", "zak", "vzdelav", "maturit", "univerzit", "student", "pedagog", "prijimaci", "absolvent", "materske"),
    "zdravotnictvi": ("zdravot", "lekar", "nemocnic", "lekarn", "ambulan", "pohotovost", "zachrann", "hygien", "ockovan", "stomatolog", "pacient", "luzk"),
    "socialni": ("social", "pecovat", "davk", "nezamestn", "uchazec", "zamestnan", "prace", "mzd", "chudob", "vylouceni", "exekuc", "pestoun", "azyl", "duchod"),
    "bydleni": ("byt", "bydlen", "stavebn", "uzemni plan", "zastavit", "nemovit", "budov", "parcel", "katastr", "adresn", "rozvojov", "zps", "prostorova data"),
    "kultura": ("kultur", "pamatk", "muze", "galeri", "divadl", "knihovn", "kino", "festival", "hrad", "zamek", "rozhledn",
                "turis", "cestovni ruch", "ubytovac", "sport", "volnoc", "archeolog", "pomnik", "pametihodnost"),
    "prostredi": ("zivotni prostredi", "ovzdusi", "emis", "zaplav", "vodni", "vodovod", "kanalizac", "chranen", "prirod", "les", "odpad", "hluk", "klima", "kotlik", "sucho", "pud", "biotop", "natura", "krajin", "energ", "meteo"),
    "finance": ("rozpo", "dotac", "financ", "dan", "vydaj", "prijm", "uver", "dluh", "investic", "zakazk", "smlouv", "ucetn", "poplat", "monitor", "pokladn", "rozvaha", "vykaz"),
}
THEME_FALLBACK = {"HEAL": "zdravotnictvi", "EDUC": "skolstvi", "TRAN": "doprava", "ENVI": "prostredi", "AGRI": "prostredi",
                  "ENER": "prostredi", "ECON": "finance", "SOCI": "socialni", "REGI": "bydleni"}
PERIOD_DAYS = {"CONT": 1, "UPDATE_CONT": 1, "DAILY": 2, "DAILY_2": 2, "WEEKLY": 8, "WEEKLY_2": 8, "WEEKLY_3": 8, "BIWEEKLY": 15,
               "MONTHLY": 32, "MONTHLY_2": 32, "MONTHLY_3": 32, "BIMONTHLY": 62, "QUARTERLY": 93, "ANNUAL_2": 185,
               "ANNUAL_3": 125, "ANNUAL": 366, "BIENNIAL": 731, "TRIENNIAL": 1096, "QUINQUENNIAL": 1827, "DECENNIAL": 3653}

# Kraj names as they appear inflected in titles ("Plzeňského kraje", "v Praze").
KRAJ_STEMS: tuple[tuple[int, tuple[str, ...]], ...] = (
    (19, ("hlavni mesto praha", "hl. m. prahy", "praha", "prahy", "praze", "prazsk")), (27, ("stredocesk",)), (35, ("jihocesk",)),
    (43, ("plzensk", "plzen")), (51, ("karlovarsk",)), (60, ("ustecky kraj", "usteckeho kraje", "ustecky")), (78, ("libereck",)),
    (86, ("kralovehradeck", "hradec kralove", "hradce kralove")), (94, ("pardubick",)), (108, ("vysocin",)), (116, ("jihomoravsk", "brno", "brne", "brnensk")),
    (124, ("olomouck",)), (141, ("zlinsk",)), (132, ("moravskoslezsk", "ostrava", "ostravsk")),
)


def classify(title: str, keywords: str = "", description: str = "", themes: str = "") -> str:
    t, k, d = norm(title), norm(keywords), norm(description)[:600]
    best, best_score = "ostatni", 0
    for pillar, stems in PILLAR_RULES.items():
        score = sum(3 * (s in t) + 2 * (s in k) + (s in d) for s in stems)
        if score > best_score:
            best, best_score = pillar, score
    if best_score == 0:
        for code in themes.split("|"):
            p = THEME_FALLBACK.get(code.rsplit("/", 1)[-1])
            if p:
                return p
    return best


def freshness(periodicity: str, modified: str, today: datetime | None = None) -> str:
    days = PERIOD_DAYS.get(periodicity)
    if not days or not modified:
        return "neznama"
    try:
        when = datetime.fromisoformat(modified[:10]).replace(tzinfo=UTC)
    except ValueError:
        return "neznama"
    return "aktualni" if ((today or datetime.now(UTC)) - when).days <= days * 1.5 else "zastarala"


def kraj_from_text(*texts: str) -> int:
    t = " " + norm(" ".join(texts)) + " "
    for code, stems in KRAJ_STEMS:
        if any(s in t for s in stems):
            return code
    return 0


class Regions:
    """RÚIAN spatial IRI → kraj code."""

    def __init__(self) -> None:
        admin = geo.load("admin")
        if admin and "orp_to_kraj" not in admin:
            geo.extend_admin()
            admin = geo.load("admin")
        self.obec = {k: int(v) for k, v in (admin or {}).get("obec_to_kraj", {}).items() if v}
        self.okres = {k: int(v) for k, v in (admin or {}).get("okres_to_kraj", {}).items() if v}
        self.orp = {k: int(v) for k, v in (admin or {}).get("orp_to_kraj", {}).items() if v}
        self.mc = (admin or {}).get("mc_to_obec", {})
        self.obec["554782"] = 19  # Praha: a kraj without an okres
        by_name: dict[str, set[int]] = {}
        for code, name in (admin or {}).get("obec_names", {}).items():
            k = self.obec.get(code)
            if k:
                by_name.setdefault(norm(name), set()).add(k)
        # A name is usable only when every obec of that name lies in one kraj.
        self.name_kraj = {n: next(iter(ks)) for n, ks in by_name.items() if len(ks) == 1}

    def of_publisher(self, name: str) -> int:
        """Kraj of a municipal publisher from its name ("Statutární město Kladno")."""
        n = norm(name)
        for p in PUBLISHER_PREFIXES:
            if n.startswith(p):
                n = n[len(p):]
                break
        if n in self.name_kraj:
            return self.name_kraj[n]
        return kraj_from_text(name)

    def of(self, spatials: list[str], publisher_ico: str = "", publisher_name: str = "") -> int:
        for s in spatials:
            parts = s.rstrip("/").split("/")
            if len(parts) < 2:
                continue
            kind, code = parts[-2], parts[-1]
            region = 0
            if kind == "vusc" and code.isdigit() and int(code) in KRAJ_BY_CODE:
                region = int(code)
            elif kind == "obec":
                region = self.obec.get(code, 0)
            elif kind == "orp":
                region = self.orp.get(code, 0)
            elif kind == "okres":
                region = self.okres.get(code, 0)
            elif kind in ("mestskecasti", "mestske-casti", "momc", "mop"):
                region = self.obec.get(self.mc.get(code, ""), 19 if kind == "mop" else 0)
            elif kind == "region-soudrznosti" and code == "19" or code in ("CZE_PRG", "3067695"):
                region = 19
            if region:
                return region
        k = KRAJ_BY_ICO.get(publisher_ico)
        if k:
            return k.code
        return self.of_publisher(publisher_name) if publisher_name else 0


def _usage(region: int, fresh: str) -> list[str]:
    u = ["katalog", "rag", "pokryti"]
    if fresh != "neznama":
        u.append("cerstvost")
    if region:
        u.append("mapa")
    return u


def _sparql(c, query: str) -> list[dict]:
    if len(query) < 3500:
        return get_json(c, SPARQL, {"query": query}, headers={"Accept": "application/sparql-results+json"})["results"]["bindings"]
    # Batches of explicit IRIs do not fit in a URL: send them as a form POST.
    import time
    last: Exception | None = None
    for attempt in range(4):
        try:
            r = c.post(SPARQL, data={"query": query}, headers={"Accept": "application/sparql-results+json"})
            r.raise_for_status()
            return r.json()["results"]["bindings"]
        except Exception as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"POST {SPARQL} selhal: {last}")


def _val(b: dict, k: str) -> str:
    return (b.get(k) or {}).get("value", "")


def _page_filter(_publisher_iri: str, batch: list[str], _size: int) -> str:
    """The set of datasets one query covers: an explicit batch of IRIs.

    Naming the datasets is what makes a short result harmless — the rows that
    come back are whatever had the metadata, and the batch itself decides how
    far the harvest has got. A keyset cursor over the result rows cannot tell
    "no more datasets" from "the next few had no Czech title".
    """
    return "VALUES ?d { " + " ".join(f"<{i}>" for i in batch) + " }"


def _all_iris(c, publisher_iri: str) -> list[str]:
    """Every dataset IRI of a publisher.

    The endpoint caps a result set at 10 000 rows, so a publisher above that
    is read from both ends — the first 10 000 ascending and the last 10 000
    descending — which covers anyone up to 20 000 datasets. The descending
    query is only issued when the ascending one actually hit the cap.
    """
    base = f"PREFIX dcat: <http://www.w3.org/ns/dcat#> PREFIX dcterms: <http://purl.org/dc/terms/> SELECT ?d WHERE {{ ?d a dcat:Dataset ; dcterms:publisher <{publisher_iri}> }}"
    seen: dict[str, None] = {}
    for b in _sparql(c, f"{base} ORDER BY ASC(?d) LIMIT 10000"):
        seen[_val(b, "d")] = None
    if len(seen) >= 10000:
        for b in _sparql(c, f"{base} ORDER BY DESC(?d) LIMIT 10000"):
            seen[_val(b, "d")] = None
    return list(seen)


def _page_query(publisher_iri: str, after: str, size: int) -> str:
    return f"""PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX dcterms: <http://purl.org/dc/terms/>
SELECT ?d (SAMPLE(?t) AS ?title) (SAMPLE(?ds) AS ?desc) (MAX(?m) AS ?modified) (SAMPLE(?p) AS ?periodicity) (SAMPLE(?lp) AS ?landing)
       (GROUP_CONCAT(DISTINCT ?kw; separator="|") AS ?keywords) (GROUP_CONCAT(DISTINCT ?th; separator="|") AS ?themes)
       (GROUP_CONCAT(DISTINCT ?sp; separator="|") AS ?spatial)
WHERE {{
  {_page_filter(publisher_iri, after, size)}
  ?d dcterms:title ?t . FILTER(lang(?t) = "cs" || lang(?t) = "")
  OPTIONAL {{ ?d dcterms:description ?ds . FILTER(lang(?ds) = "cs" || lang(?ds) = "") }}
  OPTIONAL {{ ?d dcterms:modified ?m }}
  OPTIONAL {{ ?d dcterms:accrualPeriodicity ?p }}
  OPTIONAL {{ ?d dcat:landingPage ?lp }}
  OPTIONAL {{ ?d dcat:keyword ?kw . FILTER(lang(?kw) = "cs") }}
  OPTIONAL {{ ?d dcat:theme ?th }}
  OPTIONAL {{ ?d dcterms:spatial ?sp }}
}} GROUP BY ?d"""


def _dist_query(publisher_iri: str, after: str, size: int) -> str:
    return f"""PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX dcterms: <http://purl.org/dc/terms/>
SELECT ?d (SAMPLE(?u) AS ?download) (SAMPLE(?a) AS ?access) (GROUP_CONCAT(DISTINCT ?f; separator="|") AS ?formats)
WHERE {{
  {_page_filter(publisher_iri, after, size)}
  ?d dcat:distribution ?x .
  OPTIONAL {{ ?x dcat:downloadURL ?u }}
  OPTIONAL {{ ?x dcat:accessURL ?a }}
  OPTIONAL {{ ?x dcterms:format ?f }}
}} GROUP BY ?d"""


# Dataset IRIs per metadata query. Large enough to keep the round trips down,
# small enough that one VALUES block does not time the endpoint out.
IRI_BATCH = 250

DATE_SUFFIX = re.compile(r"^(?P<stem>.*?)[\s,–-]*(?:za\s+)?(?:\d{1,2}[-./]\d{1,2}[-./]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{4})\s*$", re.I)
SERIES_MIN = 30


def collapse_series(rows: dict[str, dict]) -> dict[str, dict]:
    """Merge daily/monthly slices of one series into a single dataset.

    Some publishers register every day of a series as its own NKOD dataset
    ("Prohlídky vozidel STK a SME za 14-11-2019", thousands of them). Counting
    those one by one would inflate the catalogue; a group of at least
    SERIES_MIN titles that differ only by a trailing date becomes one record
    pointing at the newest slice, and its title says how many slices exist.
    """
    groups: dict[str, list[str]] = {}
    for key, r in rows.items():
        m = DATE_SUFFIX.match(r["title"])
        if m and m.group("stem").strip():
            groups.setdefault(norm(m.group("stem")), []).append(key)
    for stem, keys in groups.items():
        if len(keys) < SERIES_MIN:
            continue
        keys.sort(key=lambda k: (rows[k].get("modified") or "", rows[k]["title"]))
        keep = rows[keys[-1]]
        title = DATE_SUFFIX.match(keep["title"]).group("stem").strip()
        keep["title"] = f"{title} (řada {len(keys)} souborů)"[:2000]
        keep["keywords"] = (keep.get("keywords", "") + "|časová řada")[:2000]
        for k in keys[:-1]:
            rows.pop(k, None)
    return rows


def _ensure_source(source_id: str, kind: str, name: str) -> None:
    # Dataset.source_id is a foreign key: the source row must exist first.
    with session_scope() as s:
        if s.get(Source, source_id) is None:
            s.add(Source(id=source_id, kind=kind, name=name))


def _store(source_id: str, rows: list[dict], keep_missing: bool = False) -> None:
    with session_scope() as s:
        existing = dict(s.execute(select(Dataset.ext_id, Dataset.id).where(Dataset.source_id == source_id)).all())
        taken = {e for (e,) in s.execute(select(Dataset.ext_id).where(Dataset.ext_id.in_([r["ext_id"] for r in rows]), Dataset.source_id != source_id))} if rows else set()
        seen, inserts, updates = set(), [], []
        for r in rows:
            if r["ext_id"] in seen or r["ext_id"] in taken:
                continue
            seen.add(r["ext_id"])
            for k in ("download_url", "formats", "landing_url", "alt_url"):
                r.setdefault(k, "")
            r["harvested_at"] = now()
            if r["ext_id"] in existing:
                updates.append({**r, "id": existing[r["ext_id"]]})
            else:
                inserts.append(r)
        for i in range(0, len(inserts), 3000):
            s.bulk_insert_mappings(Dataset, inserts[i:i + 3000])
        for i in range(0, len(updates), 3000):
            s.bulk_update_mappings(Dataset, updates[i:i + 3000])
        if not keep_missing:
            gone = [i for e, i in existing.items() if e not in seen]
            if gone:
                s.query(Dataset).filter(Dataset.id.in_(gone)).delete(synchronize_session=False)


def _save_source(source_id: str, **fields) -> None:
    with session_scope() as s:
        src = s.get(Source, source_id) or Source(id=source_id, kind=fields.get("kind", "nkod"), name=fields.get("name", source_id))
        for k, v in fields.items():
            setattr(src, k, v)
        src.last_harvest_at, src.last_error = now(), fields.get("last_error", "")
        s.merge(src)


def _group_of(ico: str) -> str:
    if ico in CORE_ICO:
        return "core"
    if ico in KRAJ_BY_ICO:
        return "kraje"
    return "ostatni"


def harvest_publisher(c, regions: Regions, iri: str, name: str) -> int:
    ico = iri.rsplit("/", 1)[-1]
    source_id = f"nkod-{ico}"
    _ensure_source(source_id, "nkod", name)
    rows: dict[str, dict] = {}
    # Page over an explicit list of dataset IRIs, never over the result rows.
    #
    # The metadata query drops a dataset whose title is neither Czech nor
    # untagged, so a full window can come back short; the old "a short page is
    # the last page" rule then ended the harvest there. It cost about three
    # fifths of every publisher — NKOD reported 1 943 datasets for the
    # Královéhradecký kraj and the catalogue held 800 of them.
    ids = _all_iris(c, iri)
    batches = [ids[i:i + IRI_BATCH] for i in range(0, len(ids), IRI_BATCH)]
    while batches:
        cursor: list[str] = batches.pop(0)
        try:
            page = _sparql(c, _page_query(iri, cursor, len(cursor)))
        except Exception:
            # A batch that times out is split rather than lost; a single IRI
            # that still fails is the only thing dropped.
            if len(cursor) <= 1:
                raise
            batches[:0] = [cursor[:len(cursor) // 2], cursor[len(cursor) // 2:]]
            continue
        for b in page:
            d_iri = _val(b, "d")
            themes = _val(b, "themes")
            title = _val(b, "title").strip() or "(bez názvu)"
            desc = _val(b, "desc").strip()
            kws = _val(b, "keywords")
            period = _val(b, "periodicity").rsplit("/", 1)[-1]
            modified = _val(b, "modified")[:10]
            fresh = freshness(period, modified)
            region = regions.of([s for s in _val(b, "spatial").split("|") if s], ico, name)
            rows[d_iri] = {
                "ext_id": d_iri, "source_id": source_id, "title": title[:2000], "description": desc[:4000],
                "publisher": name, "publisher_ico": ico, "url": NKOD_PAGE + quote(d_iri, safe=""), "landing_url": _val(b, "landing")[:2000],
                "keywords": kws[:2000], "themes": "|".join(t.rsplit("/", 1)[-1] for t in themes.split("|") if t)[:255],
                "pillar": classify(title, kws, desc, themes), "region_code": region, "periodicity": period,
                "modified": modified, "freshness": fresh, "usage": _usage(region, fresh),
            }
        try:
            for b in _sparql(c, _dist_query(iri, cursor, len(cursor))):
                r = rows.get(_val(b, "d"))
                if r is not None:
                    r["download_url"] = (_val(b, "download") or _val(b, "access"))[:2000]
                    r["formats"] = ",".join(sorted({f.rsplit("/", 1)[-1].upper() for f in _val(b, "formats").split("|") if f}))[:255]
        except Exception:
            pass  # distributions are a bonus; the dataset record stands without them
    rows = collapse_series(rows)
    _store(source_id, list(rows.values()))
    _save_source(source_id, name=f"NKOD — {name}", publisher=name, ico=ico, kind="nkod", group=_group_of(ico), url=SPARQL,
                 portal_url=NKOD_PUBLISHER_PAGE + quote(iri, safe=""), license="Podle podmínek užití jednotlivých datových sad (NKOD)", dataset_count=len(rows))
    return len(rows)


def _publishers(c) -> list[tuple[str, str]]:
    q = """PREFIX dcat: <http://www.w3.org/ns/dcat#> PREFIX dcterms: <http://purl.org/dc/terms/> PREFIX foaf: <http://xmlns.com/foaf/0.1/>
SELECT ?p (SAMPLE(?nm) AS ?name) WHERE { { SELECT DISTINCT ?p WHERE { ?d a dcat:Dataset ; dcterms:publisher ?p } } OPTIONAL { ?p foaf:name ?nm } } GROUP BY ?p"""
    out = []
    for b in _sparql(c, q):
        iri = _val(b, "p")
        ico = iri.rsplit("/", 1)[-1]
        name = _val(b, "name") or CORE_ICO.get(ico) or ico
        out.append((iri, name.strip()))
    return out


def _migrate_old_sources() -> None:
    """Rename source ids from the first catalogue layout (nkod-khk…) to nkod-<IČO>, keeping dataset ids."""
    with session_scope() as s:
        for old, ico in OLD_SOURCE_IDS.items():
            src = s.get(Source, old)
            if src is None:
                continue
            new_id = f"nkod-{ico}"
            if s.get(Source, new_id) is None:
                s.add(Source(id=new_id, kind="nkod", name=src.name))
                s.flush()
            s.execute(update(Dataset).where(Dataset.source_id == old).values(source_id=new_id))
            s.delete(src)


def _titles_by_region(exclude: str = "") -> dict[int, dict[str, int]]:
    """Normalised titles of everything already in the catalogue, keyed by kraj.

    Every source is indexed, not only NKOD: two regional portals routinely
    republish the same dataset, and matching incoming rows against NKOD alone
    let those cross-portal twins through.

    `exclude` drops one source's own rows, and is not optional in practice —
    a feed indexed against its own previous harvest matches every one of its
    datasets as a duplicate of itself, keeps none of them, and `_store` then
    deletes the rows that were not re-stored.
    """
    with session_scope() as s:
        q = select(Dataset.id, Dataset.title, Dataset.region_code)
        if exclude:
            q = q.where(Dataset.source_id != exclude)
        rows = s.execute(q).all()
    out: dict[int, dict[str, int]] = {}
    for i, t, r in rows:
        out.setdefault(r, {})[norm(t)] = i
    return out


def url_key(u: str) -> str:
    """Comparable form of a download URL: scheme, case and trailing slash off."""
    u = (u or "").strip().lower()
    if len(u) < 16:
        return ""
    return re.sub(r"^https?://(www\.)?", "", u).rstrip("/")


def _urls(exclude: str = "") -> dict[str, int]:
    """Download URLs already in the catalogue, minus one source's own rows.

    The stronger duplicate signal of the two: portals retitle a dataset
    freely, but they all end up pointing at the publisher's single file.
    """
    with session_scope() as s:
        q = select(Dataset.id, Dataset.download_url).where(Dataset.download_url != "")
        if exclude:
            q = q.where(Dataset.source_id != exclude)
        rows = s.execute(q).all()
    out: dict[str, int] = {}
    for i, u in rows:
        k = url_key(u)
        if k:
            out.setdefault(k, i)
    return out


def _ld(v) -> str:
    """Pull a Czech string out of a JSON-LD / DCAT-AP value."""
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return str(v.get("cs") or v.get("@value") or next(iter(v.values()), ""))
    if isinstance(v, list) and v:
        return _ld(v[0])
    return ""


def harvest_dcat(c, source_id: str, url: str, name: str, portal: str, region: int, known: dict[int, dict[str, int]],
                 urls: dict[str, int] | None = None) -> tuple[int, int]:
    data = get_json(c, url)
    items = data.get("dcat:dataset") or data.get("dataset") or []
    _ensure_source(source_id, "dcat", name)
    local = {**known.get(region, {}), **known.get(0, {})}
    seen_urls = dict(urls or {})
    merged, rows, twins = 0, [], []
    for it in items:
        title = _ld(it.get("dct:title")).strip()
        page = it.get("@id") or _ld(it.get("dct:identifier"))
        dist = it.get("dcat:distribution") or []
        dist = dist if isinstance(dist, list) else [dist]
        dl, fmts = "", set()
        for d in dist:
            u = ((d.get("dcat:downloadURL") or d.get("dcat:accessURL") or {}) or {})
            u = u.get("@id", "") if isinstance(u, dict) else str(u)
            f = ((d.get("dct:format") or {}) or {})
            f = f.get("@id", "") if isinstance(f, dict) else str(f)
            if f:
                fmts.add(f.rsplit("/", 1)[-1].upper())
            if u and not dl and "HTML" not in f.upper():
                dl = u
        if not dist or not title:
            continue  # hub pages and documents without data are not datasets
        key = norm(title)
        uk = url_key(dl)
        twin = local.get(key) or seen_urls.get(uk)
        if twin:
            if twin > 0:  # -1 marks a twin met earlier in this same feed, which has no row yet
                twins.append({"id": twin, "alt_url": page})
            merged += 1
            continue
        local[key] = -1  # within this feed too: hubs list the same dataset in several collections
        if uk:
            seen_urls[uk] = -1
        kws = [str(k) for k in (it.get("dcat:keyword") or [])]
        desc = re.sub(r"<[^>]+>", " ", _ld(it.get("dct:description")))
        modified = str(it.get("dct:modified") or "")[:10]
        rows.append({
            "ext_id": page, "source_id": source_id, "title": title[:2000], "description": " ".join(desc.split())[:4000],
            "publisher": name.split(" — ")[0], "publisher_ico": "", "url": page, "keywords": "|".join(kws)[:2000], "themes": "",
            "pillar": classify(title, "|".join(kws), desc), "region_code": region, "periodicity": "", "modified": modified,
            "freshness": "neznama", "usage": _usage(region, "neznama"), "download_url": dl[:2000], "formats": ",".join(sorted(fmts))[:255],
        })
    _store(source_id, rows)
    # One update per row: several incoming datasets can point at the same twin,
    # and bulk_update_mappings counts the rows it expected to touch.
    twins = list({t["id"]: t for t in twins}.values())
    with session_scope() as s:
        for i in range(0, len(twins), 2000):
            s.bulk_update_mappings(Dataset, twins[i:i + 2000])
    _save_source(source_id, name=name, kind="dcat", url=url, portal_url=portal, group="kraje" if region and region != HOME_KRAJ else "core",
                 publisher=name.split(" — ")[0], license="CC BY 4.0 (pokud není u sady uvedeno jinak)", dataset_count=len(rows) + merged)
    return len(rows), merged


# Local catalogues in the OFN (DCAT-AP-CZ JSON-LD) format:
# (id, catalogue URL, name, portal page, kraj, publisher, IČO, page URL for a dataset IRI, group)
OFN_CATALOGS: tuple[tuple[str, str, str, str, int, str, str, str, str], ...] = (
    ("mmhk", MMHK_CATALOG, "Otevřená data města Hradec Králové", "https://opendata.mmhk.cz/datasets", 86,
     "Statutární město Hradec Králové", "00268810", "https://opendata.mmhk.cz/datasets/{q}", "core"),
    ("praha-lkod", "https://api.opendata.praha.eu/lod/catalog", "Otevřená data hl. m. Prahy (Golemio)", "https://opendata.praha.eu/", 19,
     "Hlavní město Praha", "00064581", "{iri}", "kraje"),
)


def _ofn_dataset(c, iri: str) -> dict | None:
    try:
        return get_json(c, iri, headers={"Accept": "application/ld+json"}, tries=2)
    except Exception:
        return None


def harvest_ofn(c, spec: tuple, known: dict[int, dict[str, int]]) -> tuple[int, int]:
    """A local OFN catalogue: one JSON-LD document listing dataset IRIs, each
    of which is fetched on its own."""
    source_id, cat_url, name, portal, region, publisher, ico, page_tpl, group = spec
    _ensure_source(source_id, "dcat", name)
    cat = get_json(c, cat_url, headers={"Accept": "application/ld+json"})
    iris = [i for i in cat.get("datová_sada", []) if isinstance(i, str)]
    local = {**known.get(region, {}), **known.get(0, {})}
    with ThreadPoolExecutor(8) as ex:
        docs = list(ex.map(lambda i: (i, _ofn_dataset(c, i)), iris))
    rows, merged, twins = [], 0, []
    for iri, d in docs:
        if not d:
            continue
        title = _ld(d.get("název")).strip()
        if not title:
            continue
        if norm(title) in local:
            twins.append({"id": local[norm(title)], "alt_url": page_tpl.format(q=quote(iri, safe=""), iri=iri)})
            merged += 1
            continue
        dists = [x for x in (d.get("distribuce") or []) if isinstance(x, dict)]
        dl = next((x.get("soubor_ke_stažení") or x.get("přístupové_url") or x.get("iri") for x in dists), "")
        if isinstance(dl, dict):
            dl = dl.get("iri", "")
        fmts = {str(x.get("formát", "")).rsplit("/", 1)[-1].upper() for x in dists if x.get("formát")}
        themes = "|".join(str(t).rsplit("/", 1)[-1] for t in d.get("téma", []) if isinstance(t, str))
        desc = _ld(d.get("popis"))
        kws = "|".join(_ld(k) for k in (d.get("klíčové_slovo") or []))
        period = str(d.get("periodicita_aktualizace") or "").rsplit("/", 1)[-1]
        rows.append({"ext_id": iri, "source_id": source_id, "title": title[:2000], "description": desc[:4000], "publisher": publisher,
                     "publisher_ico": ico, "url": page_tpl.format(q=quote(iri, safe=""), iri=iri), "keywords": kws[:2000], "themes": themes[:255],
                     "pillar": classify(title, kws, desc, themes), "region_code": region, "periodicity": period, "modified": "", "freshness": "neznama",
                     "usage": _usage(region, "neznama"), "download_url": str(dl)[:2000], "formats": ",".join(sorted(fmts))[:255]})
    _store(source_id, rows)
    # One update per row: several incoming datasets can point at the same twin,
    # and bulk_update_mappings counts the rows it expected to touch.
    twins = list({t["id"]: t for t in twins}.values())
    with session_scope() as s:
        for i in range(0, len(twins), 2000):
            s.bulk_update_mappings(Dataset, twins[i:i + 2000])
    _save_source(source_id, name=name, kind="dcat", url=cat_url, portal_url=portal, group=group, publisher=publisher, ico=ico,
                 license="Podle podmínek užití sady", dataset_count=len(rows) + merged)
    return len(rows), merged


def harvest_mmhk(c, known: dict[int, dict[str, int]]) -> tuple[int, int]:
    return harvest_ofn(c, OFN_CATALOGS[0], known)


NS = {"csw": "http://www.opengis.net/cat/csw/2.0.2", "dc": "http://purl.org/dc/elements/1.1/", "dct": "http://purl.org/dc/terms/"}


def harvest_csw(c, known: dict[int, dict[str, int]]) -> tuple[int, int]:
    """INSPIRE metadata records from the national geoportal (CENIA, Micka CSW)."""
    source_id = "geoportal-cenia"
    _ensure_source(source_id, "csw", "Národní geoportál INSPIRE (CENIA)")
    allknown: dict[str, int] = {}
    for m in known.values():
        allknown.update(m)
    rows, merged, start, total = [], 0, 1, None
    while total is None or start <= total:
        r = c.get(CSW, params={"service": "CSW", "version": "2.0.2", "request": "GetRecords", "typeNames": "csw:Record", "resultType": "results",
                               "elementSetName": "full", "maxRecords": 100, "startPosition": start, "outputSchema": "http://www.opengis.net/cat/csw/2.0.2"})
        root = ET.fromstring(r.content)
        res = root.find("csw:SearchResults", NS)
        if res is None:
            break
        total = int(res.get("numberOfRecordsMatched", "0"))
        recs = res.findall("csw:Record", NS)
        if not recs:
            break
        for rec in recs:
            ident = next((e.text for e in rec.findall("dc:identifier", NS) if e.text and not e.text.startswith("http")), None)
            titles = [e for e in rec.findall("dc:title", NS)]
            title = next((e.text for e in titles if e.get("{http://www.w3.org/XML/1998/namespace}lang") == "cs"), titles[0].text if titles else "") or ""
            if not ident or not title.strip():
                continue
            abstr = rec.findall("dct:abstract", NS)
            desc = next((e.text for e in abstr if e.get("{http://www.w3.org/XML/1998/namespace}lang") == "cs"), abstr[0].text if abstr else "") or ""
            refs = [e.text for e in rec.findall("dct:references", NS) if e.text]
            links = [e.text for e in rec.findall("dc:identifier", NS) if e.text and e.text.startswith("http")]
            publisher = (rec.findtext("dc:publisher", "", NS) or "").strip()
            kind = (rec.findtext("dc:type", "", NS) or "").strip()
            fmts = sorted({(e.text or "").strip().upper() for e in rec.findall("dc:format", NS) if e.text})
            key = norm(title)
            if key in allknown:
                merged += 1
                continue
            allknown[key] = -1
            region = kraj_from_text(title, publisher)
            rows.append({"ext_id": f"csw:{ident}", "source_id": source_id, "title": title.strip()[:2000], "description": " ".join(desc.split())[:4000],
                         "publisher": publisher[:255] or "INSPIRE", "publisher_ico": "", "url": CSW_RECORD + ident,
                         "keywords": kind, "themes": "", "pillar": classify(title, kind, desc), "region_code": region, "periodicity": "",
                         "modified": (rec.findtext("dc:date", "", NS) or "")[:10], "freshness": "neznama", "usage": _usage(region, "neznama"),
                         "download_url": (refs or links or [""])[0][:2000], "formats": ",".join(fmts)[:255]})
        start += len(recs)
    _store(source_id, rows)
    _save_source(source_id, name="Národní geoportál INSPIRE (CENIA) — katalog metadat", kind="csw", url=CSW, portal_url="https://geoportal.gov.cz/web/guest/home",
                 group="core", publisher="CENIA", ico="45249130", license="Podle metadat záznamu", dataset_count=len(rows) + merged)
    return len(rows), merged


def harvest_npu(c, known: dict[int, dict[str, int]]) -> tuple[int, int]:
    """Public map and feature services of the heritage institute's geoportal."""
    source_id = "npu-geoportal"
    _ensure_source(source_id, "api", "Geoportál NPÚ")
    try:
        org = get_json(c, "https://geoportal.npu.cz/portal/sharing/rest/portals/self", {"f": "json"}, tries=2).get("id") or NPU_ORG
    except Exception:
        org = NPU_ORG  # the portal's self endpoint answers 500 at times; its id is fixed
    q = f'orgid:{org} AND (type:"Feature Service" OR type:"Map Service" OR type:"WMS" OR type:"WFS" OR type:"Image Service" OR type:"Shapefile" OR type:"CSV" OR type:"File Geodatabase")'
    allknown: dict[str, int] = {}
    for m in known.values():
        allknown.update(m)
    rows, merged, start = [], 0, 1
    while start > 0:
        page = get_json(c, NPU_SEARCH, {"q": q, "num": 100, "start": start, "f": "json"})
        for it in page.get("results", []):
            if it.get("owner", "").startswith("esri"):
                continue
            title = (it.get("title") or "").strip()
            if not title:
                continue
            if norm(title) in allknown:
                merged += 1
                continue
            desc = re.sub(r"<[^>]+>", " ", it.get("snippet") or it.get("description") or "")
            rows.append({"ext_id": f"npu:{it['id']}", "source_id": source_id, "title": title[:2000], "description": " ".join(desc.split())[:4000],
                         "publisher": "Národní památkový ústav", "publisher_ico": "75032333", "url": NPU_ITEM + it["id"], "keywords": "|".join(it.get("tags") or [])[:2000],
                         "themes": "", "pillar": classify(title, " ".join(it.get("tags") or []), desc), "region_code": kraj_from_text(title),
                         "periodicity": "", "modified": datetime.fromtimestamp((it.get("modified") or 0) / 1000, UTC).date().isoformat() if it.get("modified") else "",
                         "freshness": "neznama", "usage": _usage(0, "neznama"), "download_url": it.get("url") or "", "formats": it.get("type", "").upper()[:255]})
        start = page.get("nextStart", -1) if page.get("results") else -1
    _store(source_id, rows)
    _save_source(source_id, name="Geoportál Národního památkového ústavu", kind="api", url=NPU_SEARCH, portal_url="https://geoportal.npu.cz/portal/apps/sites/#/geoportal-npu",
                 group="core", publisher="Národní památkový ústav", ico="75032333", license="Podle podmínek služby", dataset_count=len(rows) + merged)
    return len(rows), merged


def harvest_czechpoint(known: dict[int, dict[str, int]]) -> int:
    source_id = "czechpoint"
    _ensure_source(source_id, "file", "Czech POINT — otevřená data")
    title = "Seznam orgánů veřejné moci (Czech POINT)"
    dup = any("seznam organu verejne moci" in t for m in known.values() for t in m)
    rows = [] if dup else [{
        "ext_id": "czechpoint:seznamovm", "source_id": source_id, "title": title, "description": "Indexový soubor se seznamem všech orgánů veřejné moci a odkazy na jejich detailní záznamy.",
        "publisher": "Digitální a informační agentura", "publisher_ico": "17651921", "url": "https://www.czechpoint.gov.cz/public/vyvojari/otevrena-data/",
        "keywords": "OVM|orgány veřejné moci", "themes": "GOVE", "pillar": "ostatni", "region_code": 0, "periodicity": "DAILY", "modified": "",
        "freshness": "neznama", "usage": _usage(0, "neznama"), "download_url": "https://www.czechpoint.gov.cz/spravadat/ovm/datafile.do?format=xml&service=seznamovm", "formats": "XML"}]
    _store(source_id, rows)
    _save_source(source_id, name="Czech POINT — otevřená data (seznam OVM)", kind="file", url="https://www.czechpoint.gov.cz/spravadat/ovm/datafile.do?format=xml&service=seznamovm",
                 portal_url="https://www.czechpoint.gov.cz/public/vyvojari/otevrena-data/", group="core", publisher="Digitální a informační agentura", ico="17651921",
                 license="Podle podmínek zdroje", dataset_count=1)
    return len(rows)


def register_api_sources() -> None:
    with session_scope() as s:
        for a in API_SOURCES:
            src = s.get(Source, a["id"]) or Source(id=a["id"])
            for k, v in a.items():
                setattr(src, k, v)
            src.group = "core"
            s.merge(src)


def harvest(workers: int = 4) -> dict[str, int]:
    job("catalog", "running", "Sklízím celý NKOD")
    register_api_sources()
    _migrate_old_sources()
    regions = Regions()
    c = client(240)
    pubs = _publishers(c)
    result: dict[str, int] = {"nkod_poskytovatelu": len(pubs)}
    done = 0

    def one(p: tuple[str, str]) -> tuple[str, int]:
        iri, name = p
        cc = client(240)
        try:
            return iri, harvest_publisher(cc, regions, iri, name)
        except Exception as e:
            _save_source(f"nkod-{iri.rsplit('/', 1)[-1]}", name=f"NKOD — {name}", kind="nkod", last_error=str(e)[:500])
            return iri, -1

    with ThreadPoolExecutor(workers) as ex:
        for _iri, n in ex.map(one, pubs):
            done += 1
            result["nkod"] = result.get("nkod", 0) + max(n, 0)
            result["nkod_chyby"] = result.get("nkod_chyby", 0) + (n < 0)
            if done % 10 == 0:
                job("catalog", "running", f"NKOD: {done}/{len(pubs)} poskytovatelů", done / (len(pubs) + 16))
    # The index is rebuilt for every source, excluding that source's own rows:
    # freshly, so a feed is compared with what the feeds before it added (the
    # cross-portal twins), and without itself, so re-harvesting a feed does not
    # find its own last harvest and discard the lot.
    for sid, url, name, portal, region in DCAT_FEEDS:
        job("catalog", "running", name)
        try:
            added, merged = harvest_dcat(c, sid, url, name, portal, region, _titles_by_region(sid), _urls(sid))
            result[sid], result[f"{sid}_sloucene"] = added, merged
        except Exception as e:
            result[sid] = -1
            _save_source(sid, name=name, kind="dcat", url=url, portal_url=portal, last_error=str(e)[:500])
    for spec in OFN_CATALOGS:
        job("catalog", "running", spec[2])
        try:
            added, merged = harvest_ofn(c, spec, _titles_by_region(spec[0]))
            result[spec[0]], result[f"{spec[0]}_sloucene"] = added, merged
        except Exception as e:
            result[spec[0]] = -1
            job("catalog", "running", f"{spec[0]}: {e}")
    for label, fn in (("geoportal-cenia", harvest_csw), ("npu-geoportal", harvest_npu)):
        job("catalog", "running", label)
        try:
            added, merged = fn(c, _titles_by_region(label))
            result[label], result[f"{label}_sloucene"] = added, merged
        except Exception as e:
            result[label] = -1
            job("catalog", "running", f"{label}: {e}")
    result["czechpoint"] = harvest_czechpoint(_titles_by_region("czechpoint"))
    job("catalog", "done", str(result), 1.0)
    return result
