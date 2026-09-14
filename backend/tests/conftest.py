"""Test fixtures: an isolated data directory and a small synthetic kraj.

The environment is set before any `kam` import, because configuration and
the database engine are created at import time. The synthetic territories
are shaped to trigger known behaviour: Horní Testov is ageing, shrinking,
losing people to migration and has no sewerage; Velké Město is stable.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="kam-test-")
os.environ["KAM_DATA_DIR"] = TMP
os.environ["KAM_BACKGROUND"] = "0"
os.environ["DATABASE_URL"] = f"sqlite:///{Path(TMP, 'test.db').as_posix()}"
os.environ["LOCAL_LLM_BASE_URL"] = "http://127.0.0.1:9/v1"  # nothing listens: tests never reach a model
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from sqlalchemy import insert  # noqa: E402

from kam.db import init_db, session_scope  # noqa: E402
from kam.models import Dataset, Fact, Observation, Source, Territory  # noqa: E402

YEARS = range(2010, 2026)


def _series(start: float, end: float) -> dict[int, float]:
    n = len(YEARS) - 1
    return {y: start + (end - start) * i / n for i, y in enumerate(YEARS)}


def _town(tid: str, pop: dict[int, float], share65: dict[int, float], mig_rate: float, gp: float, classes: float, pupils_per_class: float, sewer: float) -> list[dict]:
    rows = []
    for y in YEARS:
        p = pop[y]
        vals = {
            "110900": p, "111000": p, "110930": p * 0.14, "110990": p * share65[y] / 100,
            "110200": p * 0.009, "110300": p * 0.0115, "110600": p * mig_rate, "110700": p * (0.009 - 0.0115 + mig_rate),
            "040510": classes * pupils_per_class, "040520": classes, "040310": classes * 10, "040320": classes / 2,
            "070700": gp, "150160": p * 0.01, "500020": 3.5, "501000": p * 0.02, "504010": p * 0.005,
            "200002": p * 18, "200702": p * 20, "200602": p * 4, "200802": -p * 0.5, "121800": p * 0.002,
            # Příjmy po konsolidaci drží identitu příjmy = výdaje + saldo,
            # aby na nich šlo počítat provozní přebytek i krytí investic.
            "200402": p * 19.5, "200302": p * 3,
            "600201": sewer, "140100": 1500, "141000": 400, "142000": 1.2,
        }
        if y == 2021:
            vals.update({"420105": p * 0.98, "420702": p / 2.4, "420101": p})
        rows.extend({"territory_id": tid, "indicator_code": k, "year": y, "value": float(v)} for k, v in vals.items())
    return rows


@pytest.fixture(scope="session", autouse=True)
def synthetic_db():
    init_db()
    from kam.ingest import khk, mos
    mos.register_indicators()
    khk.register_indicators()
    with session_scope() as s:
        s.add_all([
            Territory(id="cz", level="cz", code="CZ", name="Česko", name_norm="cesko"),
            Territory(id="kraj:86", level="kraj", code="86", name="Královéhradecký kraj", name_norm="kralovehradecky kraj", parent_id="cz", kraj_code=86, population=550000),
            Territory(id="kraj:27", level="kraj", code="27", name="Středočeský kraj", name_norm="stredocesky kraj", parent_id="cz", kraj_code=27, population=1400000),
            Territory(id="orp:100", level="orp", code="100", name="Testov", name_norm="testov", parent_id="kraj:86", kraj_code=86, population=22500),
            Territory(id="obec:500001", level="obec", code="500001", name="Horní Testov", name_norm="horni testov", parent_id="orp:100", orp_id="orp:100", kraj_code=86, population=1200),
            Territory(id="obec:500002", level="obec", code="500002", name="Dolní Lhota", name_norm="dolni lhota", parent_id="orp:100", orp_id="orp:100", kraj_code=86, population=300),
            Territory(id="obec:500003", level="obec", code="500003", name="Velké Město", name_norm="velke mesto", parent_id="orp:100", orp_id="orp:100", kraj_code=86, population=21000),
        ])
        rows = []
        rows += _town("obec:500001", _series(1450, 1200), _series(18, 27), -0.008, 0, 9, 27, 0)
        rows += _town("obec:500002", _series(300, 300), _series(20, 21), 0.0, 0, 1, 10, 1)
        rows += _town("obec:500003", _series(20800, 21000), _series(19, 21), 0.002, 12, 40, 24, 1)
        rows += _town("orp:100", _series(22550, 22500), _series(19, 21.5), 0.001, 12, 50, 24, 1)
        rows += _town("kraj:86", _series(551000, 554000), _series(17, 21), 0.001, 240, 1600, 22, 1)
        rows += _town("kraj:27", _series(1300000, 1400000), _series(16, 19), 0.004, 600, 3000, 23, 1)
        rows += _town("cz", _series(10.4e6, 10.9e6), _series(17, 21), 0.002, 5000, 30000, 22, 1)
        # a one-off spike in deaths for Velké Město, 2020
        for r in rows:
            if r["territory_id"] == "obec:500003" and r["indicator_code"] == "110300" and r["year"] == 2020:
                r["value"] *= 2.2
        s.execute(insert(Observation), rows)
        s.add(Source(id="nkod-khk", name="NKOD — Královéhradecký kraj", kind="nkod", group="core"))
        s.flush()
        s.add_all([
            Dataset(ext_id="d1", source_id="nkod-khk", title="Autobusové zastávky IREDO", description="Zastávky veřejné dopravy v kraji", pillar="doprava", region_code=86, url="https://data.gov.cz/x1", usage=["katalog"], check_status="ok"),
            Dataset(ext_id="d2", source_id="nkod-khk", title="Praktičtí lékaři pro dospělé", description="Seznam ordinací", pillar="zdravotnictvi", region_code=86, url="https://data.gov.cz/x2", usage=["katalog"], freshness="zastarala", periodicity="ANNUAL", modified="2020-01-01", check_status="ok"),
            Dataset(ext_id="d3", source_id="nkod-khk", title="Rozbitá sada", description="Odkaz vrací 404", pillar="ostatni", region_code=86, url="https://data.gov.cz/x3", usage=["katalog"], check_status="chyba", check_code=404),
        ])
        s.add(Fact(territory_id="obec:500001", key="posta", value="obec bez České pošty"))
    from kam.analytics import risks, simulate, store
    store.reset()
    risks.reset()
    simulate.reset()
    yield
