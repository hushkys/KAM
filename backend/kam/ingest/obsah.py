"""Kontrola obsahu: je v datové sadě opravdu soubor s daty?

`check.py` ověřuje jen to, že odkaz odpověděl. Server ale umí na neexistující
soubor vrátit stránku „nenalezeno“ s kódem 200, prázdný soubor, přihlašovací
formulář nebo soubor jiného druhu, než katalog slibuje. Tady se proto stáhne
začátek souboru (nejvýš 8 kB) a posoudí se podle **prvních bajtů**, ne podle
přípony ani hlavičky:

  ZIP / XLSX / ODS / DOCX   začíná `PK\\x03\\x04`
  GZIP                     `\\x1f\\x8b`
  PDF                      `%PDF`
  JSON / GeoJSON           první znak `{` nebo `[`
  XML / GML / KML / WFS    `<?xml` nebo `<` a hlavička není HTML
  CSV / TSV / TXT          text, v prvních řádcích oddělovač a víc sloupců
  SHP / GPKG / GDB         `SQLite format 3` (GPKG) nebo hlavička shapefile
  HTML                     stránka — u sady, která HTML slibuje, je to
                           v pořádku jen jako **vizualizace**, ne jako data

Výsledek (`obsah_status`):
  data         odpovídá tomu, co sada slibuje, a není prázdný
  stranka      vrátila HTML místo dat (vizualizace, rozcestník, chybová stránka)
  prazdne      0 bajtů nebo jen mezery
  nedostupne   odpověď 4xx/5xx nebo spojení selhalo

Soubor jiného formátu, než katalog slíbil, se počítá jako data (druh je v
`content_kind`); ArcGIS REST služby se zeptají na `f=json`.

Politeness stejná jako u `check.py`: nejvýš 6 souběžných dotazů na server.
Pouští se zvlášť (`python -m kam.ingest obsah`), protože trvá desítky minut.
"""

from __future__ import annotations

import asyncio
import json
from collections import Counter, defaultdict
from urllib.parse import urlparse

import httpx
from sqlalchemy import select, update

from ..db import session_scope
from ..models import Dataset, now
from .common import job

# Hlavička běžného prohlížeče. Část státních serverů (volby.cz, data.mzcr.cz)
# vrací 500 klientovi, který se hlásí jako robot, a prohlížeči stejný soubor
# normálně vydají. Kontrola má odpovědět na otázku „otevře to člověk?“, takže
# se ptá jako člověk.
PROHLIZEC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

PER_HOST = 6
GLOBAL = 64
TIMEOUT = httpx.Timeout(25.0, connect=10.0)
BAJTU = 8192


def _text(b: bytes) -> str | None:
    for kod in ("utf-8-sig", "cp1250", "latin-1"):
        try:
            return b.decode(kod)
        except UnicodeDecodeError:
            continue
    return None


def rozpoznej(zacatek: bytes) -> str:
    """Druh souboru podle prvních bajtů."""
    h = zacatek[:16]
    if not zacatek.strip(b"\x00 \r\n\t"):
        return "prazdne"
    if h.startswith(b"PK\x03\x04") or h.startswith(b"PK\x05\x06"):
        return "zip"
    if h.startswith(b"\x1f\x8b"):
        return "gzip"
    if h.startswith(b"%PDF"):
        return "pdf"
    if h.startswith(b"SQLite format 3"):
        return "gpkg"
    if h[:4] == b"\x00\x00\x27\x0a":
        return "shp"
    if h[:4] in (b"\x89PNG", b"GIF8") or h[:3] == b"\xff\xd8\xff":
        return "obrazek"
    t = _text(zacatek[:BAJTU])
    if t is None:
        return "binarni"
    s = t.lstrip()
    nizke = s[:600].lower()
    if nizke.startswith(("<!doctype html", "<html")) or "<html" in nizke or "<body" in nizke:
        return "html"
    if s.startswith(("{", "[")):
        return "json"
    if s.startswith("<?xml") or s.startswith("<"):
        return "xml"
    radky = [r for r in s.splitlines()[:8] if r.strip()]
    if radky and any(r.count(d) >= 1 for r in radky[:3] for d in (",", ";", "\t", "|")):
        return "csv"
    return "text"


# Který rozpoznaný druh uspokojí který slíbený formát. HTML mezi nimi
# schválně není: sada, která slibuje CSV, a dostane stránku, data nemá.
PRIJATELNE = {
    "CSV": {"csv", "text", "zip", "gzip"},
    "TSV": {"csv", "text", "zip", "gzip"},
    "TXT": {"text", "csv", "json", "xml", "zip", "gzip"},
    "JSON": {"json", "zip", "gzip"},
    "JSON_LD": {"json"},
    "GEOJSON": {"json", "zip", "gzip"},
    "XML": {"xml", "zip", "gzip"},
    "GML": {"xml", "zip", "gzip"},
    "KML": {"xml", "zip", "gzip"},
    "RDF": {"xml", "text", "json", "zip", "gzip"},
    "TTL": {"text", "zip", "gzip"},
    "WFS": {"xml"}, "WMS": {"xml"}, "WMTS": {"xml"}, "CSW": {"xml"}, "ATOM": {"xml"},
    "ZIP": {"zip", "gzip"}, "GZ": {"gzip", "zip"}, "7Z": {"binarni"},
    "XLSX": {"zip"}, "XLS": {"binarni", "zip", "csv"}, "ODS": {"zip"}, "DOCX": {"zip"}, "DOC": {"binarni", "zip"},
    "PDF": {"pdf"},
    "GPKG": {"gpkg"}, "SHP": {"zip", "shp"}, "GDB": {"zip"}, "DXF": {"text", "zip"}, "DGN": {"binarni", "zip"},
}
# Vizualizace a rozcestníky: HTML je tu správná odpověď, jen to nejsou data
# ke stažení — vykazují se zvlášť a do „použitelných“ se nepočítají.
JEN_STRANKA = {"HTML", "HTM", "XHTML"}


def posud(formaty: list[str], rozpoznano: str, velikost: int, kod: int) -> str:
    """Neprázdný soubor, který není webová stránka, jsou data — i když je to
    jiný formát, než katalog uvádí (slíbené CSV, a přišlo XML). Rozpoznaný druh
    se ukládá zvlášť (`content_kind`), takže nesoulad je vidět, ale sada kvůli
    němu data mít nepřestane."""
    if kod == 0 or kod >= 400:
        return "nedostupne"
    if rozpoznano == "prazdne" or velikost == 0:
        return "prazdne"
    if rozpoznano == "html":
        return "stranka"
    return "data"


async def _sonda(klient: httpx.AsyncClient, nebezpecny: httpx.AsyncClient, url: str, formaty: list[str]) -> tuple[str, int, str]:
    """(obsah_status, http_kod, rozpoznany_druh)."""
    for c in (klient, nebezpecny):
        try:
            async with c.stream("GET", url, headers={"Range": f"bytes=0-{BAJTU - 1}", "Accept": "*/*"}) as r:
                zacatek = b""
                async for kus in r.aiter_bytes():
                    zacatek += kus
                    if len(zacatek) >= BAJTU:
                        break
                kod = r.status_code
                # 416 = soubor má 0 bajtů (rozsah mimo obsah); jinak chyba je chyba.
                if kod == 416:
                    return "prazdne", 200, "prazdne"
                druh = rozpoznej(zacatek[:BAJTU]) if zacatek else "prazdne"
                # Webová služba (ArcGIS REST, WFS…) vrací bez dotazu HTML popis.
                # Data dá, až když se zeptáme na JSON — a to je to, co by
                # udělal každý klient, takže se zeptáme taky.
                if druh == "html" and kod < 400 and "/rest/services/" in url and "f=" not in url:
                    sluzba = url + ("&" if "?" in url else "?") + "f=json"
                    async with c.stream("GET", sluzba, headers={"Accept": "application/json"}) as r2:
                        z2 = b""
                        async for kus in r2.aiter_bytes():
                            z2 += kus
                            if len(z2) >= BAJTU:
                                break
                        if r2.status_code < 400 and rozpoznej(z2) == "json" and b'"error"' not in z2[:300]:
                            return "data", r2.status_code, "sluzba"
                return posud(formaty, druh, len(zacatek), kod), kod, druh
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            if c is klient and "CERTIFICATE" in str(e).upper():
                continue
            return "nedostupne", 0, ""
        except httpx.HTTPError:
            return "nedostupne", 0, ""
    return "nedostupne", 0, ""


async def _beh(ukoly: list[tuple[int, str, list[str]]], prubeh) -> dict[int, tuple[str, int, str]]:
    vysledky: dict[int, tuple[str, int, str]] = {}
    host: dict[str, asyncio.Semaphore] = defaultdict(lambda: asyncio.Semaphore(PER_HOST))
    gsem = asyncio.Semaphore(GLOBAL)
    limity = httpx.Limits(max_connections=GLOBAL, max_keepalive_connections=GLOBAL)
    hlavicky = {"User-Agent": PROHLIZEC}
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True, limits=limity, headers=hlavicky) as k, \
            httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True, limits=limity, headers=hlavicky, verify=False) as n:
        hotovo = 0

        async def jedna(i: int, url: str, fm: list[str]):
            nonlocal hotovo
            async with gsem, host[urlparse(url).netloc]:
                vysledky[i] = await _sonda(k, n, url, fm)
            hotovo += 1
            if hotovo % 500 == 0:
                prubeh(hotovo, len(ukoly))

        await asyncio.gather(*(jedna(i, u, f) for i, u, f in ukoly))
    return vysledky


def _formaty(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        v = json.loads(raw)
        if isinstance(v, str):
            v = [v]
    except Exception:
        v = [x for x in raw.replace(";", ",").split(",")]
    out = []
    for x in v:
        x = str(x).strip().rsplit("/", 1)[-1].rsplit("#", 1)[-1].upper()
        out.extend(p for p in x.replace("+", ",").split(",") if p)
    return out


def obsah(limit: int | None = None) -> dict[str, int]:
    job("obsah", "running", "Kontroluji obsah souborů")
    with session_scope() as s:
        # Všechny sady s odkazem, ne jen ty, které dřív „odpověděly": část
        # z nich selhala jen kvůli hlavičce robota (viz PROHLIZEC).
        rows = [(d.id, d.download_url or "", _formaty(d.formats)) for d in s.scalars(select(Dataset))]
    ukoly = [(i, u, f) for i, u, f in rows if u.startswith(("http://", "https://"))]
    bez_souboru = len(rows) - len(ukoly)
    if limit:
        ukoly = ukoly[:limit]
    vys = asyncio.run(_beh(ukoly, lambda d, t: job("obsah", "running", f"Zkontrolováno {d}/{t} souborů", d / max(t, 1))))
    ts = now()
    # Konečný verdikt jde i do `check_status`, kterého se drží všechny počty,
    # filtry a exporty: „ok“ od teď znamená, že sada obsahuje data (ne jen že
    # odkaz odpověděl), „stranka“ webovou stránku, „chyba“ prázdný nebo
    # nedostupný soubor.
    stav = {"data": "ok", "stranka": "stranka", "prazdne": "chyba", "nedostupne": "chyba"}
    aktualizace = [{"id": i, "content_status": st, "content_kind": druh, "content_code": kod, "content_at": ts,
                    "check_status": stav[st], "check_code": kod, "checked_at": ts} for i, (st, kod, druh) in vys.items()]
    with session_scope() as s:
        for k in range(0, len(aktualizace), 2000):
            s.execute(update(Dataset), aktualizace[k:k + 2000])
    if not limit:
        # Sada bez souboru ke stažení (jen stránka vydavatele) data k pobrání nenabízí.
        with session_scope() as s:
            s.execute(update(Dataset).where(Dataset.check_status == "ok", ~Dataset.download_url.like("http%")).values(check_status="stranka", content_status="stranka", content_at=ts))
    c = Counter(st for st, _, _ in vys.values())
    stat = dict(c) | {"bez_souboru_ke_stazeni": bez_souboru, "celkem": len(vys)}
    job("obsah", "done", json.dumps(stat, ensure_ascii=False), 1.0)
    return stat
