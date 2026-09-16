"""Povinně zveřejňované dokumenty a odkazy do registrů.

Testy tu hlídají hlavně jednu věc: aby aplikace nikdy neřekla víc, než na co
má doklad. Uplynulý čas období není splněný plán a odkaz do registru se buď
složí z IČO té konkrétní obce, nebo se nenabídne vůbec.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from kam.analytics import plany
from kam.db import session_scope
from kam.main import app
from kam.models import Dokument, Territory


@pytest.fixture(scope="module", autouse=True)
def dokumenty():
    """Tři plány: jeden běží, jednomu letos končí, jeden dávno prošel."""
    letos = datetime.now(UTC).year
    with session_scope() as s:
        s.execute(delete(Dokument))
        s.add_all([
            Dokument(uzemi_id="obec:500001", druh="pro", nazev=f"Program rozvoje Horní Testov na roky {letos - 3} - {letos + 3}",
                     od=letos - 3, do=letos + 3, url="https://www.obcepro.cz/program-rozvoje-obce-1.pdf",
                     zdroj="obcepro", zdroj_id="1", zdroj_url="https://www.obcepro.cz/publikovane-dokumenty",
                     zdroj_nazev="Program rozvoje obce (MMR)"),
            Dokument(uzemi_id="obec:500002", druh="pro", nazev=f"Program rozvoje Dolní Lhota na roky {letos - 5} - {letos}",
                     od=letos - 5, do=letos, url="https://www.obcepro.cz/program-rozvoje-obce-2.pdf",
                     zdroj="obcepro", zdroj_id="2", zdroj_url="https://www.obcepro.cz/publikovane-dokumenty",
                     zdroj_nazev="Program rozvoje obce (MMR)"),
            Dokument(uzemi_id="obec:500003", druh="pro", nazev=f"Program rozvoje Velké Město na roky {letos - 9} - {letos - 2}",
                     od=letos - 9, do=letos - 2, url="https://www.obcepro.cz/program-rozvoje-obce-3.pdf",
                     zdroj="obcepro", zdroj_id="3", zdroj_url="https://www.obcepro.cz/publikovane-dokumenty",
                     zdroj_nazev="Program rozvoje obce (MMR)"),
        ])
        s.get(Territory, "obec:500001").ico = "00268810"
        s.get(Territory, "obec:500003").ico = ""
    yield
    with session_scope() as s:
        s.execute(delete(Dokument))


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_uplynuly_cas_pocita_krajni_roky_a_nepreteche():
    letos = datetime.now(UTC).year
    # Jednoletý plán platný letos je celý za námi, ne z poloviny.
    assert plany._uplynulo(letos, letos, letos) == 1.0
    # Období, které teprve začne, je na nule; prošlé se zastaví na jedné.
    assert plany._uplynulo(letos + 1, letos + 4, letos) == 0.0
    assert plany._uplynulo(letos - 9, letos - 2, letos) == 1.0
    assert 0.4 < (plany._uplynulo(letos - 3, letos + 3, letos) or 0) < 0.6


def test_stav_rozlisuje_posledni_rok_od_prosleho():
    letos = datetime.now(UTC).year
    assert plany._stav(letos - 3, letos + 3, letos) == "plati"
    assert plany._stav(letos - 5, letos, letos) == "konci"
    assert plany._stav(letos - 9, letos - 2, letos) == "prosly"
    assert plany._stav(0, 0, letos) == "bez_obdobi"


def test_odkazy_do_registru_miri_na_konkretni_obec():
    d = plany.uzemi("obec:500001")
    assert d is not None and d["ico"] == "00268810"
    assert {r["klic"] for r in d["registry"]} == {"monitor", "smlouvy", "ares"}
    for r in d["registry"]:
        # Odkaz musí nést IČO té obce — rozcestník na vyhledávací formulář
        # by po člověku chtěl práci, kterou za něj měla udělat aplikace.
        assert "00268810" in r["url"], r["klic"]
        assert r["url"].startswith("https://")


def test_bez_ica_se_odkaz_radeji_nenabidne():
    d = plany.uzemi("obec:500003")
    assert d is not None and d["ico"] == ""
    assert d["registry"] == []


def test_plan_nikde_netvrdi_splneni():
    d = plany.uzemi("obec:500003")
    assert d is not None and d["plan"] is not None
    # Prošlý plán má uplynulý celý čas, ale nic v odpovědi netvrdí, že je hotový.
    assert d["plan"]["uplynulo"] == 1.0
    assert not any(k in d["plan"] for k in ("splneno", "hotovo", "realizovano", "plneni"))
    assert "netvrdí" in d["poznamka"] or "nezveřejňuje" in d["poznamka"]


def test_investice_se_pocitaji_jen_z_let_ktera_mame():
    d = plany.uzemi("obec:500001")
    inv = d["plan"]["investice"]
    assert inv is not None
    # Fixtura má rozpočet do roku 2025, plán sahá dál — souhrn se o to nesmí
    # opřít a musí přiznat, kolik roků období opravdu pokrývá.
    assert inv["do_dat"] <= 2025
    assert inv["roky"] <= d["plan"]["do"] - d["plan"]["od"] + 1
    assert inv["kapital"] > 0


def test_prehled_kraje_scita_vsechny_obce():
    p = plany.prehled(86)
    assert p["kraj"]["obci"] == len(p["seznam"]) == 3
    assert sum(p["pocty"].values()) == p["kraj"]["obci"]
    assert p["s_planem"] == 3 and p["pocty"]["chybi"] == 0
    assert p["pocty"] == {"plati": 1, "konci": 1, "prosly": 1, "bez_obdobi": 0, "chybi": 0}


def test_api_vraci_prehled_i_detail(client):
    r = client.get("/api/plany")
    assert r.status_code == 200 and r.json()["seznam"]
    d = client.get("/api/plany/obec:500001")
    assert d.status_code == 200 and d.json()["plan"]["od"]
    assert client.get("/api/plany/obec:999999").status_code == 404
