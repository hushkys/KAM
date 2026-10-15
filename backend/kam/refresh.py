"""Plánovaná obnova dat — jedna funkce pro plánovač v serveru i pro běh zvenku.

    python -m kam.ingest refresh      # totéž, co pustí plánovač

Dřív obnova sklízela jen katalog a vrstvy kraje. Statistiky ČSÚ (obyvatelé,
rozpočty, školy — jádro všech výpočtů) a kontrolu odkazů neobnovovala vůbec,
takže nová roční data by se do aplikace sama nikdy nedostala. A odpočítávala
od startu serveru: kontejner, který se restartuje častěji než jednou za
interval (každé nasazení), se obnovy nedočkal nikdy.

Teď:
  * poslední obnova je v databázi (`job_state` „refresh“), ne v paměti
    procesu, takže ji restart nevynuluje a pozná ji i jiný proces;
  * denně: katalog, vrstvy kraje, **poslední roky statistik ČSÚ** (MOS se
    zveřejňuje po letech, takže stačí stáhnout loňský, letošní a příští
    soubor — celá řada od roku 2005 by byla 380 tisíc řádků a zbytečně by
    pálila datovou kvótu databáze), párování sad a index asistenta;
  * jednou za týden: kontrola odkazů, dotace a dokumenty obcí — mění se
    pomalu a kontrola dvaceti tisíc odkazů je nejdražší krok;
  * Eurostat (deset minut ověřování) se pouští ručně.

Obnova běžící v jiném procesu (Cloud Run Job, ruční `kam.ingest`) mezipaměti
běžícího serveru nevyprázdní; plánovač v serveru proto hlídá čas poslední
obnovy a při změně je vyprázdní sám (`main.py::_scheduler`).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from .db import SessionLocal
from .models import JobState, Observation

log = logging.getLogger("kam")

TYDENNI = {"obsah": 7, "dotace": 7, "vydaje": 7, "dokumenty": 7}   # krok → po kolika dnech
BEZI_NEJVYS = timedelta(hours=3)   # „running“ starší než tohle je mrtvý běh, ne běžící


def _utc(t: datetime | None) -> datetime | None:
    if t is None:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def stav(jmeno: str) -> tuple[str | None, datetime | None]:
    with SessionLocal() as s:
        row = s.get(JobState, jmeno)
        return (row.status, _utc(row.updated_at)) if row else (None, None)


def naposledy() -> datetime | None:
    """Kdy naposledy doběhla celá obnova (kýmkoli)."""
    st, kdy = stav("refresh")
    return kdy if st == "done" else None


def je_cas(hodin: int) -> bool:
    st, kdy = stav("refresh")
    ted = datetime.now(timezone.utc)
    if st == "running" and kdy and ted - kdy < BEZI_NEJVYS:
        return False   # právě běží — třeba v jiné instanci
    hotovo = naposledy()
    return hotovo is None or ted - hotovo >= timedelta(hours=max(1, hodin))


def _tydenni_na_rade(krok: str) -> bool:
    st, kdy = stav(krok)
    return kdy is None or st not in ("done", "ok") or datetime.now(timezone.utc) - kdy >= timedelta(days=TYDENNI[krok])


def _mos_od() -> int:
    """Od kterého roku stahovat MOS: rok před posledním, který v databázi je
    (ČSÚ opravuje i předchozí rok), a když tam nic není, celá řada."""
    from .config import settings
    from .indicators import ALL_MOS_CODES
    with SessionLocal() as s:
        rok = s.scalar(select(func.max(Observation.year)).where(Observation.indicator_code.in_(list(ALL_MOS_CODES))))
    return max(settings.mos_first_year, (rok or settings.mos_first_year) - 1)


def vyprazdni_mezipameti() -> None:
    from .ai import rag
    from .analytics import risks, simulate, store
    store.reset()
    risks.reset()
    simulate.reset()
    rag.reload()


def obnov(duvod: str = "plán", v_serveru: bool = False) -> dict:
    """Projde kroky obnovy. Každý krok selže sám za sebe — výpadek jednoho
    zdroje nesmí zastavit ostatní — a výsledek i chyby jdou do `job_state`
    a do provozního logu."""
    from . import logs
    from .config import settings
    from .ingest.common import job

    job("refresh", "running", f"Obnova dat ({duvod})")
    vysledek: dict[str, object] = {}
    chyby: dict[str, str] = {}

    def krok(jmeno: str, fn) -> None:
        try:
            vysledek[jmeno] = fn()
        except Exception as e:   # noqa: BLE001
            chyby[jmeno] = str(e)[:300]
            log.warning("Obnova: krok %s selhal: %s", jmeno, e)

    from .ingest import catalog, khk, link, mos
    krok("catalog", catalog.harvest)
    krok("khk", khk.ingest)
    od, do = _mos_od(), max(settings.mos_last_year, datetime.now().year)
    krok("mos", lambda: mos.ingest(od, do))
    if _tydenni_na_rade("dotace"):
        from .ingest import dotace
        krok("dotace", dotace.ingest)
    if _tydenni_na_rade("vydaje"):
        from .ingest import vydaje
        krok("vydaje", vydaje.ingest)
    if _tydenni_na_rade("dokumenty"):
        from .ingest import dokumenty
        krok("dokumenty", lambda: dokumenty.ingest(s_ares=False))
    krok("link", link.link)
    if _tydenni_na_rade("obsah"):
        from .ingest import check
        # Kontrola obsahu nahrazuje kontrolu odkazů: odkaz, který odpověděl,
        # ještě není soubor s daty (ingest/obsah.py).
        from .ingest import obsah
        krok("check", obsah.obsah)
    from .ai import rag
    krok("rag", lambda: rag.build_index(embed=True))

    souhrn = {"duvod": duvod, "mos_roky": f"{od}–{do}", "kroky": sorted(vysledek), "chyby": chyby}
    job("refresh", "done", json.dumps(souhrn, ensure_ascii=False, default=str), 1.0)
    logs.zapis("data_aktualizovana" if not chyby else "data_aktualizace_castecna",
               {"kroky": len(vysledek), "chyby": sorted(chyby), "mos_roky": souhrn["mos_roky"]},
               uroven="info" if not chyby else "varovani", zdroj="data")
    if v_serveru:
        vyprazdni_mezipameti()
    return souhrn


def aktualnost() -> dict:
    """Jak čerstvá data jsou, řečeno tak, aby se to dalo napsat do aplikace:
    kdy proběhla obnova, kdy se naposledy zapisovaly hodnoty, kdy se
    zkoušely odkazy a za jaký nejnovější rok ČSÚ údaje vydal."""
    from .indicators import ALL_MOS_CODES
    from .models import Dataset
    with SessionLocal() as s:
        zapsano = s.scalar(select(func.max(Observation.ingested_at)))
        odkazy = s.scalar(select(func.max(Dataset.checked_at)))
        rok = s.scalar(select(func.max(Observation.year)).where(Observation.indicator_code.in_(list(ALL_MOS_CODES))))
    obn = naposledy()
    iso = lambda t: _utc(t).isoformat() if t else None   # noqa: E731
    return {"obnoveno": iso(obn), "hodnoty_zapsany": iso(zapsano), "odkazy_overeny": iso(odkazy), "rok_statistik": rok}
