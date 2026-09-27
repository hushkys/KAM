"""Plánovaná obnova: kdy je na řadě, kdy ne, a co se o čerstvosti dat řekne ven."""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from kam import refresh
from kam.db import session_scope
from kam.main import app
from kam.models import JobState


def _nastav(status: str | None, stari: timedelta = timedelta(0)) -> None:
    with session_scope() as s:
        row = s.get(JobState, "refresh")
        if status is None:
            if row:
                s.delete(row)
            return
        row = row or JobState(name="refresh")
        row.status, row.detail, row.progress = status, "", 1.0
        row.updated_at = datetime.now(timezone.utc) - stari
        s.merge(row)


def test_obnova_bez_zaznamu_je_na_rade():
    _nastav(None)
    assert refresh.naposledy() is None
    assert refresh.je_cas(24)


def test_cerstva_obnova_na_rade_neni():
    _nastav("done", timedelta(hours=2))
    assert not refresh.je_cas(24)
    assert refresh.naposledy() is not None


def test_stara_obnova_na_rade_je():
    # Počítá se od poslední obnovy v databázi, ne od startu procesu: restart
    # kontejneru uprostřed intervalu obnovu nesmí odsunout.
    _nastav("done", timedelta(hours=25))
    assert refresh.je_cas(24)


def test_bezici_obnova_se_nezdvoji_ale_mrtva_ano():
    _nastav("running", timedelta(minutes=20))
    assert not refresh.je_cas(1)
    _nastav("running", timedelta(hours=5))   # proces umřel uprostřed
    assert refresh.je_cas(1)


def test_aktualnost_rika_rok_i_cas():
    _nastav("done", timedelta(hours=1))
    d = TestClient(app).get("/api/aktualnost").json()
    assert set(d) == {"obnoveno", "hodnoty_zapsany", "odkazy_overeny", "rok_statistik"}
    assert d["obnoveno"] and d["hodnoty_zapsany"]
    assert isinstance(d["rok_statistik"], int)
    _nastav(None)
