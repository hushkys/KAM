from datetime import UTC, datetime

import pytest

from kam import crowd, prefs
from kam.ingest.catalog import classify, freshness
from kam.ingest.geo import _dp, point_in_rings
from kam.ingest.link import is_loaded
from kam.ingest.mos import aggregate
from kam.security import RateLimiter, decrypt, encrypt, mask


def test_catalog_classification():
    assert classify("Autobusové zastávky IREDO") == "doprava"
    assert classify("Praktičtí lékaři pro dospělé") == "zdravotnictvi"
    assert classify("Rozpočet obce 2024") == "finance"
    assert classify("Nic", themes="http://publications.europa.eu/resource/authority/data-theme/HEAL") == "zdravotnictvi"
    assert classify("Hackathon 2026 partneři") == "ostatni"


def test_freshness_against_periodicity():
    now = datetime(2026, 9, 11, tzinfo=UTC)
    assert freshness("ANNUAL", "2026-01-10", now) == "aktualni"
    assert freshness("ANNUAL", "2023-01-10", now) == "zastarala"
    assert freshness("IRREG", "2023-01-10", now) == "neznama"
    assert freshness("MONTHLY", "", now) == "neznama"


def test_loaded_flag_only_for_really_ingested_datasets():
    assert is_loaded("nkod-00025593", "Databáze MOS - data 2018")
    assert is_loaded("nkod-00025593", "Databáze MOS")
    assert not is_loaded("nkod-00025593", "Databáze MOS - data 2001")
    assert is_loaded("nkod-70889546", "Praktičtí lékaři pro dospělé")
    assert not is_loaded("nkod-70892156", "Praktičtí lékaři pro dospělé")


def test_region_from_ruian_spatial():
    from kam.ingest.catalog import Regions, kraj_from_text
    r = Regions.__new__(Regions)
    r.obec, r.okres, r.orp, r.mc = {"574121": 86, "554782": 19}, {"3605": 86}, {"1961": 116}, {"500054": "554782"}
    base = "https://linked.cuzk.cz/resource/ruian/"
    assert r.of([base + "vusc/86"]) == 86
    assert r.of([base + "stat/1", base + "obec/574121"]) == 86
    assert r.of([base + "orp/1961"]) == 116
    assert r.of([base + "mestskecasti/500054"]) == 19
    assert r.of([base + "stat/1"], "70892822") == 94
    assert r.of([base + "stat/1"]) == 0
    assert kraj_from_text("Územní plán Plzeňského kraje") == 43
    assert kraj_from_text("Hranice obcí ČR") == 0


def test_aggregation_rules():
    vals = {"a": 10.0, "b": 30.0}
    w = {"110900": {"a": 100, "b": 300}}
    assert aggregate(vals, "sum", w) == 40
    assert aggregate(vals, "wavg:110900", w) == 25
    assert aggregate({"a": 1.0, "b": 0.0}, "wavg_pop", w) == 0.25
    assert aggregate({}, "sum", w) is None


def test_douglas_peucker_keeps_closed_rings():
    ring = [(0, 0), (5, 0.01), (10, 0), (10, 10), (0, 10), (0, 0)]
    out = _dp(ring, 0.5)
    assert len(out) >= 4 and out[0] == out[-1]
    assert (5, 0.01) not in out


def test_point_in_polygon():
    sq = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
    assert point_in_rings(5, 5, sq)
    assert not point_in_rings(15, 5, sq)


def test_key_encryption_roundtrip():
    token = encrypt("tajny-klic-1234")
    assert token != "tajny-klic-1234" and decrypt(token) == "tajny-klic-1234"
    assert mask("abcdef1234") == "••••1234"
    assert decrypt("neplatne") == ""


def test_rate_limiter():
    rl = RateLimiter(limit=2, window=60)
    assert rl.allow("x") and rl.allow("x") and not rl.allow("x")
    assert rl.allow("y")


@pytest.mark.parametrize("url", ["http://example.com/hook", "https://127.0.0.1/hook", "https://localhost/x", "ftp://x"])
def test_webhook_ssrf_protection(url):
    with pytest.raises(ValueError):
        prefs.assert_safe_url(url)


def test_settings_validation():
    assert prefs.update("ai", {"policy": "local_only", "retention_days": 9999})["retention_days"] == 365
    with pytest.raises(ValueError):
        prefs.update("ai", {"policy": "nevim"})
    with pytest.raises(KeyError):
        prefs.update("neni", {})
    prefs.update("ai", {"policy": "hybrid"})


def test_crowd_clusters_similar_reports_and_reaches_threshold():
    texts = [
        "Večer nejede žádný autobus do Hradce, lidé nemají jak domů.",
        "Večerní autobus do Hradce chybí, nemám jak se dostat domů.",
        "Po osmé večer nejede autobus do Hradce, domů pěšky.",
        "Chybí večerní autobus do Hradce, domů se nedostanu.",
        "Večer žádný autobus do Hradce, domů taxíkem.",
    ]
    results = [crowd.submit("obec:500001", "doprava", t) for t in texts]
    assert len({r["cluster_id"] for r in results}) == 1
    assert results[-1]["became_ready"] and results[-1]["status"] == "pripraveno"
    doc = crowd.document(results[-1]["cluster_id"])
    assert doc["reference"].startswith("KAM-P-") and doc["count"] == 5
    sent = crowd.deliver(results[-1]["cluster_id"])
    assert sent["channel"] == "local"


def test_crowd_separates_unrelated_and_refuses_duplicates_and_masks_pii():
    a = crowd.submit("obec:500003", "zdravotnictvi", "Nový praktický lékař nebere pacienty, čekáme měsíce.")
    b = crowd.submit("obec:500003", "zdravotnictvi", "Chodník u školy je rozbitý a kluzký, hrozí úraz dětí.")
    assert a["cluster_id"] != b["cluster_id"]
    with pytest.raises(ValueError):
        crowd.submit("obec:500003", "zdravotnictvi", "Nový praktický lékař nebere pacienty, čekáme měsíce.")
    r = crowd.submit("obec:500003", "jine", "Kontaktujte mě na petr@example.com prosím, děkuji.")
    doc = crowd.document(r["cluster_id"])
    assert "example.com" not in doc["reports"][0]["text"]
    with pytest.raises(ValueError):
        crowd.submit("obec:500003", "jine", "krátké")
    with pytest.raises(ValueError):
        crowd.submit("obec:999", "jine", "neexistující obec v kraji")


def test_basic_auth_gate_protects_everything_but_health(monkeypatch):
    """A password turns the whole site into HTTP Basic — except the health
    probe, which the hosting platform has to reach without credentials."""
    import base64
    from dataclasses import replace

    from fastapi.testclient import TestClient

    from kam import main

    monkeypatch.setattr(main, "settings", replace(main.settings, auth_user="kam", auth_password="tajne"))
    client = TestClient(main.create_app())
    header = {"Authorization": "Basic " + base64.b64encode(b"kam:tajne").decode()}

    assert client.get("/api/health").status_code == 200
    assert client.get("/api/overview").status_code == 401
    assert client.get("/api/overview", headers=header).status_code == 200
    assert client.get("/api/overview", headers={"Authorization": "Basic " + base64.b64encode(b"kam:jine").decode()}).status_code == 401
    assert "Basic" in client.get("/").headers.get("www-authenticate", "")


def test_no_password_means_no_gate(monkeypatch):
    from dataclasses import replace

    from fastapi.testclient import TestClient

    from kam import main

    monkeypatch.setattr(main, "settings", replace(main.settings, auth_password=""))
    assert TestClient(main.create_app()).get("/api/overview").status_code == 200


def test_eurostat_classification_uses_english_stems():
    from kam.ingest.eurostat import classify_en

    assert classify_en("Population on 1 January by age group, sex and NUTS 3 region") == "demografie"
    assert classify_en("Gross domestic product (GDP) at current market prices by NUTS 3 region") == "finance"
    assert classify_en("Nights spent at tourist accommodation establishments by NUTS 2 region") == "kultura"
    assert classify_en("Železniční přejezdy") == "ostatni"


def test_relief_bbox_matches_the_map_projection():
    """The elevation grid has to sit in the same frame as the SVG paths."""
    from kam.ingest.geo import KX, Projector
    from kam.ingest.relief import _bbox_of

    p = Projector((15.2, 50.1, 16.6, 50.7), 1000, 16)
    khk = {"viewBox": f"0 0 {p.width:.0f} {p.height:.0f}",
           "projection": {"lon0": p.lon0, "lat1": p.lat1, "k": p.k, "kx": KX, "pad": p.pad}}
    west, south, east, north = _bbox_of(khk)
    # The corners of the drawing, projected back, are the corners of the grid.
    x0, y0 = p(west, north)
    x1, y1 = p(east, south)
    assert (round(x0), round(y0)) == (0, 0)
    assert (round(x1), round(y1)) == (round(p.width), round(p.height))
    # And the kraj itself is inside, with the padding around it.
    assert west < 15.2 and east > 16.6 and south < 50.1 and north > 50.7
