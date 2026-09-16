"""Database engine and sessions.

One code path for SQLite (default, zero setup) and PostgreSQL (set
DATABASE_URL). The schema is created with `create_all()`; every column type
used by `kam.models` exists in both dialects, so switching is a URL change.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

log = logging.getLogger("kam")


class Base(DeclarativeBase):
    pass


def _make_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30}, future=True)

        @event.listens_for(engine, "connect")
        def _pragmas(conn, _record):  # pragma: no cover - trivial
            cur = conn.cursor()
            # WAL lets the API read while an ingest writes.
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

        return engine
    # `connect_timeout` je tu schválně: bez něj čeká libpq na TCP timeout
    # operačního systému, takže nedostupná databáze neshodí požadavek, ale
    # zasekne ho — a s ním i start serveru, který na schéma čeká.
    return create_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=20, future=True,
                         connect_args={"connect_timeout": 10})


engine: Engine = _make_engine(settings.db_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def rebind(url: str) -> None:
    """Point the module at another database (tests use a temp file)."""
    global engine
    engine.dispose()
    engine = _make_engine(url)
    SessionLocal.configure(bind=engine)


#: Poslední důvod, proč se nepodařilo sáhnout na databázi, nebo `None`.
#: Čte to `/api/health`, aby šlo poznat „server běží, ale databáze mlčí" od
#: „server neběží" — což jsou z venku dva úplně stejně vypadající stavy.
posledni_chyba: str | None = None


def init_db(pokusu: int = 2) -> bool:
    """Založí schéma. Vrací, jestli se to povedlo.

    **Neúspěch není výjimka.** Když databáze mlčí (spící instance, vyčerpaná
    kvóta, spadlá síť), nemá to shodit celý proces: kontejner, který se kvůli
    tomu nerozběhne, je z venku k nerozeznání od smazané aplikace a nejde
    nasadit ani oprava. Server se rozběhne, přizná to na `/api/health` a zkusí
    to znovu, až o to někdo požádá."""
    global posledni_chyba
    from . import models  # noqa: F401  (registers tables)

    for pokus in range(pokusu):
        try:
            Base.metadata.create_all(engine)
            _ensure_columns()
            posledni_chyba = None
            return True
        except Exception as e:
            posledni_chyba = f"{type(e).__name__}: {str(e).splitlines()[0][:200]}"
            if pokus + 1 < pokusu:
                time.sleep(1.5 * (pokus + 1))
    log.error("Databáze není dostupná: %s", posledni_chyba)
    return False


_obnova_bezi = False
_obnova_kdy = 0.0


def zkus_obnovit() -> None:
    """Zkusí na pozadí, jestli se databáze nevzpamatovala.

    Na pozadí schválně: kdo se ptá na `/api/health`, čeká odpověď hned, ne
    až vyprší připojovací limit. Nejvýš jednou za půl minuty, ať se z kontroly
    stavu nestane útok na spící databázi."""
    global _obnova_bezi, _obnova_kdy
    if _obnova_bezi or time.time() - _obnova_kdy < 30:
        return
    _obnova_bezi, _obnova_kdy = True, time.time()

    def beh() -> None:
        global _obnova_bezi
        try:
            if init_db(pokusu=1):
                log.info("Databáze je zpátky.")
        finally:
            _obnova_bezi = False

    threading.Thread(target=beh, name="kam-db-obnova", daemon=True).start()


def _ensure_columns() -> None:
    """Add columns introduced after a database was created.

    `create_all()` creates missing tables but never alters existing ones, so
    a snapshot built by an older version would lack new columns. Adding a
    nullable/defaulted column is safe on both SQLite and PostgreSQL.
    """
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl = col.type.compile(dialect=engine.dialect)
                default = col.default.arg if col.default is not None and not callable(col.default.arg) else None
                if isinstance(default, bool):
                    clause = f" DEFAULT {'TRUE' if default else 'FALSE'}"
                elif isinstance(default, (int, float)):
                    clause = f" DEFAULT {default}"
                elif isinstance(default, str):
                    clause = " DEFAULT '" + default.replace("'", "''") + "'"
                else:
                    clause = ""
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {ddl}{clause}'))


@contextmanager
def session_scope() -> Iterator[Session]:
    s = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def get_db() -> Iterator[Session]:
    s = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()
