"""Provozní log aplikace — jediné místo, kudy se do `audit_log` zapisuje.

Proč vlastní log a ne jen `logging` do konzole: kontejner na Cloud Runu se
restartuje a stdout je pryč, přitom právě tyhle záznamy člověk potřebuje
zpětně — kdo smazal podnět, proč se asistentovi zablokoval dotaz, jestli
plánovaná sklizeň dat doběhla. Zápis do databáze to přežije a dá se filtrovat
přímo v aplikaci.

Co se sem **nezapisuje**: nic, co by z logu udělalo druhou databázi. Žádné
texty podnětů, žádné dotazy na asistenta, žádné IP adresy. Do `detail` patří
počty, identifikátory a důvody — tedy to, co stačí k pochopení, co se stalo,
a co se nemusí mazat kvůli soukromí. Jediná výjimka je useknutý text chyby,
bez kterého je záznam k ničemu.

Log se maže sám: `uklid()` nechá jen posledních N dní podle nastavení. Bez
toho by tabulka rostla donekonečna, což je přesně ten problém, kvůli kterému
vznikla.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, or_, select

from . import prefs
from .db import session_scope
from .models import AuditLog

log = logging.getLogger(__name__)

UROVNE = ("info", "varovani", "chyba")
ZDROJE = ("system", "podnety", "asistent", "data", "nastaveni")
MAX_DETAIL = 400


def _orez(detail: dict) -> dict:
    """Dlouhá hodnota v detailu je skoro vždy text chyby nebo cizí odpověď.
    Useknutá pořád nese, co se stalo, a nenafoukne tabulku."""
    out: dict = {}
    for k, v in list(detail.items())[:12]:
        out[str(k)[:40]] = v[:MAX_DETAIL] if isinstance(v, str) else v
    return out


def zapis(action: str, detail: dict | None = None, *, uroven: str = "info", zdroj: str = "system") -> None:
    """Zapíše jeden záznam. Nikdy nevyhodí výjimku — log je pozorovatel, ne
    účastník, a rozbít kvůli němu operaci, kterou zaznamenává, by byla
    absurdní záměna priorit."""
    try:
        with session_scope() as s:
            s.add(AuditLog(
                action=action[:64],
                detail=_orez(detail or {}),
                level=uroven if uroven in UROVNE else "info",
                source=zdroj if zdroj in ZDROJE else "system",
            ))
    except Exception as e:  # noqa: BLE001 — viz docstring
        log.debug("Zápis do provozního logu selhal: %s", e)


def seznam(*, uroven: str = "", zdroj: str = "", hledat: str = "", limit: int = 50, offset: int = 0) -> dict:
    limit = max(1, min(limit, 200))
    with session_scope() as s:
        q = select(AuditLog)
        if uroven:
            q = q.where(AuditLog.level == uroven)
        if zdroj:
            q = q.where(AuditLog.source == zdroj)
        if hledat:
            # `detail` je JSON a přenositelné `LIKE` nad ním nemáme; hledá se
            # proto v akci, což je to, podle čeho člověk stejně hledá.
            jehla = f"%{hledat.lower()}%"
            q = q.where(or_(func.lower(AuditLog.action).like(jehla)))
        celkem = s.scalar(select(func.count()).select_from(q.subquery())) or 0
        rows = s.scalars(q.order_by(AuditLog.at.desc(), AuditLog.id.desc()).limit(limit).offset(max(0, offset))).all()
        return {
            "celkem": celkem,
            "polozky": [{
                "id": r.id,
                "at": r.at.isoformat() if r.at else None,
                "action": r.action,
                "level": r.level or "info",
                "source": r.source or "system",
                "detail": r.detail or {},
            } for r in rows],
        }


def souhrn() -> dict:
    with session_scope() as s:
        celkem = s.scalar(select(func.count(AuditLog.id))) or 0
        podle_urovne = dict(s.execute(select(AuditLog.level, func.count()).group_by(AuditLog.level)).all())
        podle_zdroje = dict(s.execute(select(AuditLog.source, func.count()).group_by(AuditLog.source)).all())
        nejstarsi = s.scalar(select(func.min(AuditLog.at)))
        nejnovejsi = s.scalar(select(func.max(AuditLog.at)))
    return {
        "celkem": celkem,
        "podle_urovne": {k or "info": v for k, v in podle_urovne.items()},
        "podle_zdroje": {k or "system": v for k, v in podle_zdroje.items()},
        "nejstarsi": nejstarsi.isoformat() if nejstarsi else None,
        "nejnovejsi": nejnovejsi.isoformat() if nejnovejsi else None,
        "drzi_dni": prefs.get("provoz")["log_dni"],
    }


def uklid(*, starsi_nez_dni: int | None = None, uroven: str = "", vse: bool = False) -> int:
    """Smaže záznamy a vrátí jejich počet. `vse=True` vyprázdní log úplně —
    to je vědomé rozhodnutí člověka, proto se samo nikdy nestane."""
    with session_scope() as s:
        q = delete(AuditLog)
        if not vse:
            dni = prefs.get("provoz")["log_dni"] if starsi_nez_dni is None else starsi_nez_dni
            if dni <= 0:
                return 0
            q = q.where(AuditLog.at < datetime.now(UTC) - timedelta(days=dni))
        if uroven:
            q = q.where(AuditLog.level == uroven)
        smazano = s.execute(q).rowcount or 0
    # Zápis až po commitu, aby ho úklid sám nesmazal.
    if smazano:
        zapis("log_uklid", {"smazano": smazano, "vse": vse}, zdroj="nastaveni")
    return smazano
