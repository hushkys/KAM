"""Povinně zveřejňované dokumenty obcí: program rozvoje a identita úřadu.

Dva zdroje, oba státní a oba ověřitelné:

**obcepro.cz** — *Elektronická metodická podpora tvorby rozvojových dokumentů
obcí*, kterou provozuje Ministerstvo pro místní rozvoj. Je to jediné místo,
kde jsou programy rozvoje obcí pohromadě a strojově čitelné; jinde leží jako
PDF na webu každé obce zvlášť. Období platnosti je přímo v názvu dokumentu
(„Program rozvoje Zaloňov na roky 2016 - 2026"), takže se z něj dá spočítat,
jestli dokument ještě platí.

**Evidence ÚPD Královéhradeckého kraje** (up.khk.cz) — územní plány obcí
a všechny jejich změny, každý s datem vydání, vlastní stránkou a odkazem do
celostátní evidence eUPC. Je to zdaleka nejobjemnější zdroj: územní plán má
skoro každá obec a změn k němu přibývá, takže odsud pochází víc než devět
desetin všech dokumentů. Sloupec *Archivováno* je jediná informace o tom, že
dokument nahradil jiný — jinde se platnost územního plánu strojově nedozvíme.

**Registr práv a povinností** (Ministerstvo vnitra) — seznam orgánů veřejné
moci, a v něm ID datové schránky úřadu. Vlastní web obce nevede žádný státní
registr, takže tohle je jediná adresa úřadu, za kterou stát ručí.

**ARES** (Ministerstvo financí) — IČO úřadu a hlavně `kodObce`, což je tentýž
kód RÚIAN, kterým klíčuje území celá tahle aplikace. Díky němu se obec
z ARESu spáruje s naší obcí **na kód, ne na jméno** — v Česku jsou desítky
stejnojmenných obcí a párování podle názvu by tiše přiřadilo dokument jinam.
IČO je pak klíč do registrů, kam obec sama nic nedává: rozpočet v MONITORu
státní pokladny, smlouvy v registru smluv, zakázky ve věstníku.

Co se tu **nedělá**: nikde se netvrdí, kolik z plánu je hotové. To žádný
registr nezveřejňuje a odhadovat to z názvů kapitol by bylo vymýšlení. Drží
se jen to, co jde doložit — že dokument existuje, na jaké roky je a kam vede.
"""

from __future__ import annotations

import re
import time
from datetime import UTC, datetime

from sqlalchemy import delete, select

from ..db import session_scope
from ..models import Dokument, Territory
from ..territory import HOME_KRAJ, KRAJ_BY_CODE
from .common import client, job, log, norm

OBCEPRO = "https://www.obcepro.cz"
ARES = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat"
OVM = "https://rpp-opendata.egon.gov.cz/odrpp/datovasada/ovm.json"
UPD = "https://up.khk.cz/upd/seznam"

#: Řádek tabulky: číslo, název s obdobím, obec, datum zveřejnění, odkazy.
_RADEK = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
_BUNKA = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
_TAG = re.compile(r"<[^>]+>")
_ODKAZ = re.compile(r'href="([^"]+)"')
#: „na roky 2016 - 2026", „na období 2021–2027", „2019 - 2025"
_OBDOBI = re.compile(r"(?:na\s+(?:roky|období)\s+)?(\d{4})\s*[-–—]\s*(\d{4})")
#: Předpony, které nese název úřadu v ARESu, ale ne název obce.
_FORMY = ("Obec", "Město", "Městys", "Statutární město")


def _text(html: str) -> str:
    return re.sub(r"\s+", " ", _TAG.sub(" ", html)).strip()


def _datum(s: str) -> datetime | None:
    m = re.search(r"(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})", s or "")
    if not m:
        return None
    try:
        return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), tzinfo=UTC)
    except ValueError:
        return None


def _obce_kraje(kraj: int) -> dict[str, Territory]:
    """Obce kraje podle normalizovaného jména.

    Stejnojmenné obce uvnitř jednoho kraje se vyhodí úplně: raději dokument
    nepřiřadit, než ho přiřadit špatně. Je jich pár a v protokolu je vidět,
    kterých se to týká.
    """
    with session_scope() as s:
        rows = list(s.scalars(select(Territory).where(Territory.level == "obec", Territory.kraj_code == kraj)))
        podle: dict[str, list[Territory]] = {}
        for t in rows:
            s.expunge(t)
            podle.setdefault(norm(t.name), []).append(t)
    dvojznacne = [k for k, v in podle.items() if len(v) > 1]
    if dvojznacne:
        log.info("[dokumenty] stejnojmenné obce v kraji, přeskakuji: %s", ", ".join(dvojznacne))
    return {k: v[0] for k, v in podle.items() if len(v) == 1}


def _stranka(c, kraj_nazev: str, strana: int) -> tuple[list[dict], int]:
    """Jedna stránka výpisu. Vrací řádky a nejvyšší číslo stránky, které viděla."""
    r = c.get(f"{OBCEPRO}/publikovane-dokumenty/prehled", params={"kraj": kraj_nazev, "page": strana})
    r.raise_for_status()
    html = r.text
    ven: list[dict] = []
    for radek in _RADEK.findall(html):
        bunky = _BUNKA.findall(radek)
        if len(bunky) < 4:
            continue
        odkazy = [u for u in _ODKAZ.findall(radek) if u.endswith(".pdf")]
        ven.append({
            "zdroj_id": _text(bunky[0]),
            "nazev": _text(bunky[1]),
            "obec": _text(bunky[2]),
            "publikovano": _datum(_text(bunky[3])),
            # První odkaz je vygenerovaný souhrn z obcepro, druhý (když je)
            # vlastní dokument obce. Vlastní má přednost — je to originál.
            "url": OBCEPRO + (odkazy[-1] if odkazy else ""),
        })
    # Bez `[?&]` před `page=`: v HTML je ampersand zapsaný jako `&amp;`, takže
    # znak před parametrem je středník a přísnější vzor by našel jen stránku 1.
    stran = max((int(x) for x in re.findall(r"page=(\d+)", html)), default=strana)
    return ven, stran


#: Řádek evidence ÚPD: obec, název s odkazem na detail, datum vydání a pak
#: pět příznaků, z nichž nás zajímá jen první — archivace.
_UPD_OBEC = re.compile(r'<span class="obec"[^>]*>(.*?)</span>', re.S)
_UPD_DETAIL = re.compile(r'href="(/upd/dokumentace/detail/(\d+))"[^>]*>(.*?)</a>', re.S)
_UPD_EUPC = re.compile(r'href="(https?://[^"]*uur\.cz[^"]*)"')
#: Odkaz do mapy nese kód RÚIAN. Je jen u části řádků, ale kde je, párujeme
#: podle něj — jméno je u stejnojmenných obcí nejednoznačné.
_UPD_KOD = re.compile(r"MAP=_(\d{6})")


def _upd_stranka(c, strana: int) -> tuple[list[dict], int]:
    """Jedna stránka evidence ÚPD kraje. Vrací řádky a počet stránek."""
    r = c.get(UPD, params={"dokumentaceGrid-page": strana})
    r.raise_for_status()
    html = r.text
    ven: list[dict] = []
    for radek in _RADEK.findall(html):
        bunky = _BUNKA.findall(radek)
        obec = _UPD_OBEC.search(radek)
        detail = _UPD_DETAIL.search(radek)
        if len(bunky) < 4 or obec is None or detail is None:
            continue
        eupc = _UPD_EUPC.search(radek)
        ven.append({
            "obec": _text(obec.group(1)),
            "nazev": _text(detail.group(3)),
            "zdroj_id": detail.group(2),
            "url": "https://up.khk.cz" + detail.group(1),
            "publikovano": _datum(_text(bunky[2])),
            # Čtvrtý sloupec je „Archivováno"; obrázek nese alt="ano"/"ne".
            "archiv": 'alt="ano"' in bunky[3],
            "eupc": eupc.group(1) if eupc else "",
            "kod": (k.group(1) if (k := _UPD_KOD.search(radek)) else ""),
        })
    stran = max((int(x) for x in re.findall(r"dokumentaceGrid-page=(\d+)", html)), default=strana)
    return ven, stran


def _ico_z_ares(c, obec: Territory) -> str:
    """IČO úřadu. Ověřuje se `kodObce`, ne jméno — jinak by se trefilo do jiné obce."""
    for forma in _FORMY:
        try:
            r = c.post(ARES, json={"obchodniJmeno": f"{forma} {obec.name}", "start": 0, "pocet": 10})
            if r.status_code != 200:
                continue
            for s in r.json().get("ekonomickeSubjekty") or []:
                if str((s.get("sidlo") or {}).get("kodObce") or "") == str(obec.code):
                    return str(s.get("ico") or "")
        except Exception as e:
            log.debug("[dokumenty] ARES %s: %s", obec.name, e)
        time.sleep(0.15)  # veřejný registr, ne náš server
    return ""


def _datove_schranky(c, ica: set[str]) -> dict[str, str]:
    """ID datových schránek pro daná IČO ze seznamu OVM.

    Registr se stahuje celý (~45 MB) a filtruje se až tady: dělit ho na
    dotazy nejde, jiný odběr než celý soubor neexistuje. Běží to jednou za
    harvest, takže je to levnější než 448 dotazů, které stejně nikdo nenabízí.
    """
    r = c.get(OVM, timeout=240)
    r.raise_for_status()
    ven: dict[str, str] = {}
    for p in r.json().get("položky") or []:
        ico = str(p.get("ičo") or "")
        if ico not in ica:
            continue
        for ds in p.get("datové-schránky") or []:
            if str(ds.get("typ-ds") or "").endswith("OVM") and ds.get("identifikátor-ds"):
                ven[ico] = str(ds["identifikátor-ds"])
                break
    return ven


def ingest(kraj: int = HOME_KRAJ, s_ares: bool = True) -> dict[str, int]:
    """Stáhne povinně zveřejňované dokumenty obcí a doplní identitu úřadů.

    Idempotentní: dokumenty daného druhu se pro kraj smažou a uloží znovu,
    takže opakovaný běh nahradí, ne zdvojí."""
    kraj_nazev = KRAJ_BY_CODE[kraj].name.replace(" kraj", "")
    job("dokumenty", "running", f"Programy rozvoje obcí — {kraj_nazev}")
    obce = _obce_kraje(kraj)
    nalezeno, upd_nalezeno, neprirazeno, ico_novych, ds_novych = 0, 0, 0, 0, 0

    with client(60) as c:
        strana, strany, radky = 1, 1, []
        while strana <= strany and strana <= 40:  # pojistka proti smyčce
            davka, strany = _stranka(c, kraj_nazev, strana)
            if not davka:
                break
            radky.extend(davka)
            strana += 1
            time.sleep(0.3)

        zaznamy: list[Dokument] = []
        for r in radky:
            obec = obce.get(norm(r["obec"]))
            if obec is None:
                neprirazeno += 1
                continue
            m = _OBDOBI.search(r["nazev"])
            zaznamy.append(Dokument(
                uzemi_id=obec.id, druh="pro", nazev=r["nazev"],
                od=int(m.group(1)) if m else 0, do=int(m.group(2)) if m else 0,
                publikovano=r["publikovano"], url=r["url"],
                zdroj="obcepro", zdroj_id=r["zdroj_id"],
                zdroj_url=f"{OBCEPRO}/publikovane-dokumenty",
                zdroj_nazev="Program rozvoje obce (MMR)",
            ))
            nalezeno += 1

        with session_scope() as s:
            ids = [t.id for t in obce.values()]
            s.execute(delete(Dokument).where(Dokument.druh == "pro", Dokument.uzemi_id.in_(ids)))
            s.add_all(zaznamy)

        # --- územně plánovací dokumentace kraje ---------------------------
        job("dokumenty", "running", "Územní plány a jejich změny (up.khk.cz)")
        strana, strany, upd_radky = 1, 1, []
        while strana <= strany and strana <= 200:
            davka, strany = _upd_stranka(c, strana)
            if not davka:
                break
            upd_radky.extend(davka)
            job("dokumenty", "running", f"ÚPD {strana}/{strany}", strana / max(1, strany))
            strana += 1
            time.sleep(0.2)

        with session_scope() as s:
            podle_kodu = {str(t.code): t.id for t in s.scalars(select(Territory).where(
                Territory.level == "obec", Territory.kraj_code == kraj))}

        upd: list[Dokument] = []
        for r in upd_radky:
            # Kód RÚIAN má přednost před jménem — je jednoznačný i tam, kde
            # jsou v kraji dvě stejnojmenné obce a jméno by nestačilo.
            uzemi_id = podle_kodu.get(r["kod"]) if r["kod"] else None
            if uzemi_id is None:
                obec = obce.get(norm(r["obec"]))
                uzemi_id = obec.id if obec else None
            if uzemi_id is None:
                neprirazeno += 1
                continue
            upd.append(Dokument(
                uzemi_id=uzemi_id, druh="upd", nazev=r["nazev"],
                od=r["publikovano"].year if r["publikovano"] else 0, do=0,
                publikovano=r["publikovano"], url=r["url"],
                zdroj="upkhk", zdroj_id=r["zdroj_id"],
                # Do celostátní evidence vede odkaz jen u části záznamů; kde
                # není, zůstane adresa krajské evidence, ne prázdno.
                zdroj_url=r["eupc"] or UPD,
                zdroj_nazev="Evidence ÚPD Královéhradeckého kraje",
                stav="archiv" if r["archiv"] else "platny",
            ))
            upd_nalezeno += 1

        with session_scope() as s:
            s.execute(delete(Dokument).where(Dokument.druh == "upd", Dokument.uzemi_id.in_(ids)))
            s.add_all(upd)

        if s_ares:
            job("dokumenty", "running", "IČO úřadů z ARESu")
            with session_scope() as s:
                chybi = list(s.scalars(select(Territory).where(
                    Territory.level == "obec", Territory.kraj_code == kraj, Territory.ico == "")))
                for i, obec in enumerate(chybi):
                    ico = _ico_z_ares(c, obec)
                    if ico:
                        obec.ico = ico
                        ico_novych += 1
                    if i % 50 == 0:
                        job("dokumenty", "running", f"ARES {i}/{len(chybi)}", i / max(1, len(chybi)))

            job("dokumenty", "running", "Datové schránky úřadů (RPP)")
            with session_scope() as s:
                maji = list(s.scalars(select(Territory).where(
                    Territory.level == "obec", Territory.kraj_code == kraj, Territory.ico != "")))
                try:
                    schranky = _datove_schranky(c, {t.ico for t in maji})
                except Exception as e:
                    log.warning("[dokumenty] registr OVM nedostupný: %s", e)
                    schranky = {}
                for t in maji:
                    if schranky.get(t.ico) and t.ds != schranky[t.ico]:
                        t.ds = schranky[t.ico]
                        ds_novych += 1

    job("dokumenty", "ok", f"{nalezeno} programů rozvoje, {upd_nalezeno} ÚPD, "
        f"{ico_novych} nových IČO, {ds_novych} datových schránek")
    if neprirazeno:
        log.info("[dokumenty] %s dokumentů se nepodařilo přiřadit k obci kraje", neprirazeno)
    return {"pro": nalezeno, "upd": upd_nalezeno, "neprirazeno": neprirazeno,
            "ico": ico_novych, "ds": ds_novych}
