import json

import pytest
from fastapi.testclient import TestClient

from kam.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health_and_security_headers(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["ok"]
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-content-type-options"] == "nosniff"


def test_overview_counts_come_from_database(client):
    d = client.get("/api/overview").json()
    assert d["datasets"]["total"] == 3
    assert d["datasets"]["verified"] == 2
    assert d["datasets"]["broken"] == 1
    assert d["kpis"][0]["key"] == "pop"
    assert d["risks"][0]["territory"]["id"] == "obec:500001"


def test_territory_search_without_diacritics(client):
    rows = client.get("/api/territories", params={"q": "horni"}).json()
    assert rows[0]["id"] == "obec:500001"


def test_profile_and_404(client):
    assert client.get("/api/territories/obec:500001").json()["territory"]["name"] == "Horní Testov"
    assert client.get("/api/territories/obec:1").status_code == 404


def test_series_forecast_and_simulation(client):
    s = client.get("/api/territories/obec:500001/series/d_podil_65").json()
    assert s["trend"]["kind"] == "trend" and s["reference"]["id"] == "kraj:86"
    f = client.get("/api/forecast/obec:500003").json()
    assert f["available"] and f["backtest"]["available"]
    r = client.post("/api/simulate", json={"territory": "obec:500001", "interventions": [{"type": "byty", "params": {"pocet": 300}}]})
    assert r.status_code == 200 and r.json()["available"]
    assert client.post("/api/simulate", json={"territory": "x:1", "interventions": []}).status_code == 404


def test_scenarios_crud(client):
    sid = client.post("/api/scenarios", json={"name": "Test", "territory": "obec:500003", "interventions": [{"type": "ordinace", "params": {"pocet": 1}}]}).json()["id"]
    assert any(s["id"] == sid for s in client.get("/api/scenarios").json())
    assert client.delete(f"/api/scenarios/{sid}").json()["ok"]


def test_datasets_filters_and_export(client):
    d = client.get("/api/datasets", params={"pillar": "doprava"}).json()
    assert d["total"] == 1 and d["items"][0]["title"].startswith("Autobusové")
    csv = client.get("/api/datasets/export.csv")
    assert csv.status_code == 200 and "Praktičtí lékaři" in csv.text


def test_gaps_stats_methods(client):
    assert client.get("/api/gaps").json()["coverage"]["matrix"]
    st = client.get("/api/stats").json()["datasets"]
    assert st["total"] == 3 and st["verified"] == 2
    assert client.get("/api/datasets").json()["total"] == 2  # only working links by default
    assert client.get("/api/datasets", params={"status": "chyba"}).json()["items"][0]["check_code"] == 404
    assert any(m["id"] == "metoda-trend" for m in client.get("/api/methods").json())


def test_settings_endpoint_validation(client):
    assert client.put("/api/settings/ai", json={"policy": "xyz"}).status_code == 400
    assert client.put("/api/settings/nope", json={}).status_code == 404
    assert client.put("/api/settings/destinations", json={"threshold": 4}).json()["threshold"] == 4
    client.put("/api/settings/destinations", json={"threshold": 5})


def test_provider_crud_never_returns_key(client):
    p = client.post("/api/ai/providers", json={"name": "Test", "kind": "openai", "base_url": "http://localhost:1/v1", "model": "m", "api_key": "secret-9999"}).json()
    assert "secret" not in json.dumps(p) and p["key_hint"] == "••••9999"
    assert all("api_key" not in x for x in client.get("/api/ai/providers").json())
    assert client.delete(f"/api/ai/providers/{p['id']}").json()["ok"]
    assert client.post("/api/ai/providers", json={"name": "x", "kind": "evil", "model": "m"}).status_code == 422


def _sse(text: str) -> list[tuple[str, dict]]:
    out = []
    for block in text.strip().split("\n\n"):
        lines = block.split("\n")
        ev = lines[0].split(":", 1)[1].strip()
        out.append((ev, json.loads(lines[1].split(":", 1)[1])))
    return out


def test_chat_stream_command(client):
    ev = _sse(client.post("/api/chat", json={"message": "zapni tmavý režim"}).text)
    assert ev[0] == ("action", {"type": "set_pref", "key": "theme", "value": "dark"})
    assert ev[-1][0] == "done"


def test_reports_endpoint(client):
    r = client.post("/api/reports", json={"territory": "obec:500002", "category": "doprava", "text": "Zastávka nemá přístřešek, lidé moknou."})
    assert r.status_code == 200
    assert client.post("/api/reports", json={"territory": "obec:500002", "category": "doprava", "text": "x"}).status_code == 400
    assert client.get("/api/reports/stats").json()["reports"] >= 1


def test_spa_fallback_and_api_404(client):
    assert client.get("/api/neexistuje").status_code == 404
    r = client.get("/obce/obec:500001")
    assert r.status_code in (200, 503)
