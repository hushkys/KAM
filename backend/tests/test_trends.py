from kam.analytics.trends import classify, describe, mann_kendall, theil_sen


def test_theil_sen_ignores_one_wild_point():
    xs = list(range(10))
    ys = [2 * x + 1 for x in xs]
    ys[5] = 400
    b, a = theil_sen(xs, ys)
    assert abs(b - 2) < 1e-9 and abs(a - 1) < 1e-9


def test_mann_kendall_detects_monotonic_series():
    z, p = mann_kendall([float(i) for i in range(12)])
    assert z > 3 and p < 0.001
    z, p = mann_kendall([5, 5, 5, 5, 5, 5])
    assert p == 1.0


def test_long_term_decline_is_a_trend_with_start_year():
    s = {2010 + i: 1000 - 12 * i for i in range(16)}
    r = classify(s, polarity=1)
    assert r["kind"] == "trend"
    assert r["direction"] == "klesa"
    assert r["judgement"] == "zhorseni"
    assert r["since"] == 2010
    assert "klesá" in describe("Obyvatelé", r)


def test_last_year_spike_is_a_one_off_not_a_trend():
    s = {2010 + i: 100.0 + (i % 2) * 0.5 for i in range(15)}
    s[2024] = 160.0
    r = classify(s)
    assert r["kind"] == "vykyv"
    assert r["outliers"][-1]["year"] == 2024


def test_spike_inside_series_is_flagged_but_trend_survives():
    s = {2010 + i: 100.0 + 3 * i for i in range(15)}
    s[2016] += 60
    r = classify(s, polarity=-1)
    assert r["kind"] == "trend"
    assert any(o["year"] == 2016 for o in r["outliers"])
    assert r["judgement"] == "zhorseni"


def test_short_series_is_reported_as_too_short():
    assert classify({2020: 1, 2021: 2})["kind"] == "malo_dat"


def test_flat_series_is_stable():
    r = classify({2010 + i: 50.0 for i in range(10)})
    assert r["kind"] == "stabilni"
