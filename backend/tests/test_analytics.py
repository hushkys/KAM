import pytest

from kam.analytics import forecast, gaps, profile, risks, simulate, store
from kam.indicators import PILLARS


def test_derived_ratio_is_computed_per_year():
    s = store.series("obec:500001", "d_podil_65")
    assert round(s[2010], 2) == 18.0
    assert round(s[2025], 2) == 27.0


def test_profile_covers_every_pillar_with_sources_and_comparison():
    p = profile.profile("obec:500001")
    assert p is not None
    assert len(p["pillars"]) == len(PILLARS)
    demo = next(x for x in p["pillars"] if x["key"] == "demografie")
    card = next(c for c in demo["cards"] if c["code"] == "d_podil_65")
    assert card["compare"]["verdict"] == "horsi"
    assert card["trend"]["kind"] == "trend"
    assert p["reference"]["id"] == "kraj:86"


def test_forecast_scenarios_are_ordered_and_banded():
    r = forecast.project("obec:500003")
    assert r["available"]
    last = {k: v[-1] for k, v in r["scenarios"].items()}
    assert last["optimisticky"]["population"] >= last["pravdepodobny"]["population"] >= last["rizikovy"]["population"]
    for row in r["scenarios"]["pravdepodobny"]:
        assert row["lower"] <= row["population"] <= row["upper"]
    assert r["scenarios"]["pravdepodobny"][0]["year"] == 2026
    assert r["scenarios"]["pravdepodobny"][-1]["year"] == 2040
    assert r["assumptions"]


def test_small_obec_rates_are_shrunk_towards_orp():
    r = forecast.project("obec:500002")
    assert 0 < r["shrink_weight"] < 0.2


def test_backtest_scores_against_published_years():
    b = forecast.backtest("obec:500003", cutoff=2020)
    assert b["available"]
    assert [p["year"] for p in b["points"]] == [2021, 2022, 2023, 2024, 2025]
    assert b["mape"] < 5


def test_forecast_reports_missing_history():
    assert forecast.project("kraj:999")["available"] is False


def test_risk_engine_finds_expected_risks_with_evidence():
    found = {r["type"]: r for r in risks.assess("obec:500001")}
    assert {"starnuti", "ubytek", "kanalizace"} <= set(found)
    assert found["starnuti"]["evidence"]
    assert found["ubytek"]["kind"] == "trend"
    assert all(r["level"] in {"nizke", "sledovat", "stredni", "vysoke", "kriticke"} for r in found.values())


def test_one_off_spike_is_reported_as_vykyv_not_trend():
    types = {r["type"]: r for r in risks.assess("obec:500003")}
    assert "vykyv_110300" not in types or types["vykyv_110300"]["kind"] == "vykyv"


def test_ranking_orders_by_score():
    rows = risks.ranking("obec", 86)
    assert rows[0]["territory"]["id"] == "obec:500001"
    assert rows == sorted(rows, key=lambda r: -r["score"])


def test_simulation_housing_raises_population_and_school_load():
    r = simulate.run("obec:500001", [{"type": "byty", "params": {"pocet": 400, "rok": 2027, "typ": "rodinne_domy"}}], record=False)
    assert r["available"]
    b, s = r["baseline"][-1], r["scenario"][-1]
    assert s["population"] > b["population"]
    assert s["zs_util"] > b["zs_util"]
    assert r["chain"][0]["tag"] == "ZÁSAH"
    assert any(w["key"] == "zs_util" for w in r["warnings"]["scenario"])


def test_simulation_does_not_touch_observations():
    before = store.raw_series("obec:500001", "110900")
    simulate.run("obec:500001", [{"type": "byty", "params": {"pocet": 900}}], record=False)
    store.reset()
    assert store.raw_series("obec:500001", "110900") == before


def test_simulation_school_expansion_resolves_capacity():
    ivs = [{"type": "byty", "params": {"pocet": 400, "rok": 2027}}, {"type": "zs_mista", "params": {"pocet": 300, "rok": 2027}}]
    r = simulate.run("obec:500001", ivs, record=False)
    assert not any(w["key"] == "zs_util" and w["level"] == "kriticke" for w in r["warnings"]["scenario"])
    assert r["costs"]["capex"] > 0


def test_simulation_normalizes_and_caches():
    p = simulate.normalize("obec:500003", [{"type": "byty", "params": {"pocet": 10**9}}, {"type": "neexistuje"}], {"obsazenost_bytu": 0.9, "bad": 1})
    assert p["interventions"][0]["params"]["pocet"] == 5000
    assert len(p["interventions"]) == 1
    assert p["assumptions"] == {"obsazenost_bytu": 0.9}
    ivs = [{"type": "ordinace", "params": {"pocet": 2}}]
    first = simulate.run("obec:500003", ivs, record=False)
    second = simulate.run("obec:500003", ivs, record=False)
    assert not first["cache"]["hit"] and second["cache"]["hit"]


def test_assumption_override_changes_result():
    iv = [{"type": "byty", "params": {"pocet": 300}}]
    a = simulate.run("obec:500003", iv, record=False)
    b = simulate.run("obec:500003", iv, {"obsazenost_bytu": 0.5}, record=False)
    assert a["scenario"][-1]["population"] > b["scenario"][-1]["population"]


def test_gaps_coverage_matrix_and_alerts():
    cov = gaps.coverage()
    assert cov["matrix"] and len(cov["matrix"][0]["cells"]) == len(PILLARS)
    assert 0 <= cov["health"] <= 100
    fr = gaps.freshness()
    assert any(p["stale"] >= 1 for p in fr["pillars"])
    assert isinstance(gaps.alerts(), list)
    assert gaps.structural()


def test_forecast_components_add_up_to_the_projection():
    """Narození, zemřelí a migrace jsou to, z čeho se změna skládá — takže
    jejich součet musí dát projekci. Bez toho by graf „z čeho se změna skládá"
    ukazoval čísla, která k výsledku nevedou."""
    r = forecast.project("obec:500003")
    rows = r["scenarios"]["pravdepodobny"]
    assert rows and all(k in rows[0] for k in ("births", "deaths", "migration"))
    total = r["base_population"] + sum(x["births"] - x["deaths"] + x["migration"] for x in rows)
    # Po letech se zaokrouhluje, takže pár lidí rozdílu je v pořádku; řádový
    # nesoulad by znamenal, že se skládá něco jiného, než se kreslí.
    assert abs(total - rows[-1]["population"]) <= len(rows)


def test_finance_separates_running_the_place_from_investing(synthetic_db):
    """Provozní přebytek je příjmy minus běžné výdaje, ne minus všechny."""
    from kam.analytics import finance, store

    store.reset()
    roky = finance.rocni("obec:500001")
    if not roky:
        pytest.skip("syntetický kraj nemá rozpočtová data")
    r = roky[-1]
    assert r["bezne"] == r["vydaje"] - r["kapital"]
    assert r["provozni"] == r["prijmy"] - r["bezne"]
    # Krytí je poměr, ne rozdíl: 100 % znamená, že přebytek přesně stačil.
    if r["kapital"] > 0:
        assert abs(r["kryti"] - r["provozni"] / r["kapital"] * 100) < 0.1
    else:
        assert r["kryti"] is None
    # Kumulované saldo je opravdu kumulované.
    assert roky[-1]["kumul"] == sum(x["saldo"] for x in roky)


def test_finance_verdict_states_its_own_rule(synthetic_db):
    from kam.analytics import finance, store

    store.reset()
    d = finance.souhrn("obec:500001")
    if not d["souhrn"]:
        pytest.skip("syntetický kraj nemá rozpočtová data")
    s = d["souhrn"]
    assert s["stav"] in ("dobre", "neutral", "pozor", "riziko")
    assert "%" in s["pravidlo"]
    assert d["zdroj"].startswith("ČSÚ MOS")


def test_umisteni_compares_within_a_size_band(synthetic_db):
    """Ukazatel na tisíc obyvatel by jinak označil za nejpotřebnější největší obec."""
    from kam.analytics import store, umisteni

    store.reset()
    assert umisteni.pasmo(300)[0] == 0
    assert umisteni.pasmo(1500)[0] == 1
    assert umisteni.pasmo(5000)[0] == 2
    assert umisteni.pasmo(50000)[0] == 3

    r = umisteni.porovnej(86, "zs_mista", ["obec:500001"])
    if not r.get("available"):
        pytest.skip(r.get("reason", ""))
    # Nejlepší sada je stejně velká jako ta vybraná a nemůže být horší.
    assert len(r["nejlepsi"]["obce"]) == len(r["vase"]["obce"])
    assert r["nejlepsi"]["prinos"] >= r["vase"]["prinos"]
    assert r["rozdil"] >= 0
    # Mezera nikdy není záporná a nepřeroste strop.
    for o in r["zebricek"]:
        assert 0 <= o["mezera"] <= umisteni.STROP_MEZERY * 100 + 0.01
    assert "medián obcí své velikosti" in r["pravidlo"]


def test_umisteni_refuses_what_it_cannot_judge():
    from kam.analytics import umisteni

    r = umisteni.porovnej(86, "neznamy_zasah", [])
    assert r["available"] is False and "ukazatel" in r["reason"]
