"""Data KHK ArcGIS services — facilities, stops, per-obec attributes, events.

These layers carry RÚIAN obec codes (`kod_obce`) on most records, so a
facility is attached to its obec without geocoding. Point layers that lack the
code are placed by geometry (point inside our ČÚZK boundary) rather than by
name, because Czech obec names repeat — there are over a hundred Lhotas — and
a name join across the country would silently mix them.

The per-obec polygon layers are the one exception: they publish one row per
obec of this kraj and only its name, and within a single kraj the name is
decisive, so those join by name first and fall back to the label point. That
join is kept injective (see `_one_per_obec`) — the mean vertex of an L-shaped
obec can land in a neighbour, and two rows landing on one obec would break the
one-value-per-territory-and-year rule the table enforces.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime

from sqlalchemy import delete, insert, select

from ..db import session_scope
from ..indicators import DATAKHK_ARCGIS, KHK_INDICATORS, KHK_POINTS
from ..models import Event, Fact, Indicator, Observation, Poi, Territory
from ..territory import HOME_KRAJ, tid
from . import geo
from .common import client, get_json, job, norm

SOURCE_LABEL = "Data KHK — ArcGIS REST služby Královéhradeckého kraje"

NAME_FIELDS = ("nazev", "nazev_zarizeni", "nazev_poskytovatele", "provozovatel", "NAZEV", "Obec", "obec")
KANAL_LAYER = "Podíl_obydlených_domů_dle_připojení_na_kanalizaci"


def _layer_url(service: str) -> str:
    return f"{DATAKHK_ARCGIS}{service}/FeatureServer/0"


def _fetch(c, service: str, geometry: bool = True) -> tuple[list[dict], dict]:
    meta = get_json(c, _layer_url(service), {"f": "json"})
    out: list[dict] = []
    offset = 0
    page = int(meta.get("maxRecordCount") or 1000)
    while True:
        params = {"where": "1=1", "outFields": "*", "returnGeometry": str(geometry).lower(), "outSR": 4326, "f": "json",
                  "resultOffset": offset, "resultRecordCount": page}
        data = get_json(c, _layer_url(service) + "/query", params)
        feats = data.get("features", [])
        out.extend(feats)
        if not feats or not data.get("exceededTransferLimit"):
            break
        offset += len(feats)
    return out, meta


def _edit_date(meta: dict) -> datetime | None:
    ms = (meta.get("editingInfo") or {}).get("lastEditDate") or (meta.get("editingInfo") or {}).get("dataLastEditDate")
    return datetime.fromtimestamp(ms / 1000, UTC) if ms else None


def _point(feature: dict) -> tuple[float, float]:
    g = feature.get("geometry") or {}
    if "x" in g:
        return float(g["x"]), float(g["y"])
    if g.get("rings"):
        ring = g["rings"][0]
        return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
    if g.get("paths"):
        path = g["paths"][0]
        mid = path[len(path) // 2]
        return float(mid[0]), float(mid[1])
    return 0.0, 0.0


def _label_point(feature: dict) -> tuple[float, float]:
    """Mean vertex of the largest ring — good enough to land inside an obec."""
    g = feature.get("geometry") or {}
    rings = g.get("rings") or []
    if not rings:
        return _point(feature)
    ring = max(rings, key=len)
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def _spatial_obec(lon: float, lat: float, raw: dict) -> str:
    for code, r in raw.items():
        if geo.point_in_rings(lon, lat, r["rings"]):
            return code
    return ""


def _date(v) -> str:
    if isinstance(v, (int, float)) and v > 10**11:
        return datetime.fromtimestamp(v / 1000, UTC).date().isoformat()
    return str(v or "")[:32]


def register_indicators() -> None:
    with session_scope() as s:
        for ind in KHK_INDICATORS:
            row = s.get(Indicator, ind.code) or Indicator(code=ind.code)
            row.name, row.unit, row.pillar, row.polarity, row.agg = ind.name, ind.unit, ind.pillar, ind.polarity, ind.agg
            row.source_label, row.origin = SOURCE_LABEL, "Královéhradecký kraj"
            svc = next((k for k, v in KHK_POINTS.items() if v[0] == ind.code), "")
            row.source_url = _layer_url(svc) if svc else "https://www.datakhk.cz/"
            s.merge(row)


def ingest() -> dict[str, int]:
    job("khk", "running", "Stahuji vrstvy Data KHK")
    register_indicators()
    raw = geo.load("khk_raw")
    with session_scope() as s:
        obce = {t.code: t for t in s.scalars(select(Territory).where(Territory.level == "obec", Territory.kraj_code == HOME_KRAJ))}
    c = client(180)
    stats: dict[str, int] = {}
    poi_rows: list[dict] = []
    obs_rows: list[dict] = []
    fact_rows: list[dict] = []
    for i, (service, (code, _label, _pillar)) in enumerate(KHK_POINTS.items()):
        job("khk", "running", service.replace("_", " "), i / (len(KHK_POINTS) + 6))
        try:
            feats, meta = _fetch(c, service)
        except Exception as e:
            stats[service] = -1
            job("khk", "running", f"{service}: {e}")
            continue
        edited = _edit_date(meta)
        year = edited.year if edited else datetime.now(UTC).year
        counts: Counter[str] = Counter()
        for f in feats:
            a = f.get("attributes") or {}
            obec = str(a.get("kod_obce") or "")
            lon, lat = _point(f)
            if not obec and raw and lon:
                obec = _spatial_obec(lon, lat, raw)
            if obec not in obce:
                continue
            counts[obec] += 1
            name = next((str(a[k]) for k in NAME_FIELDS if a.get(k)), code)
            keep = {k: v for k, v in a.items() if k not in ("wkt", "x", "y", "OBJECTID", "FID", "dp_id") and v not in (None, "")}
            poi_rows.append({"kind": code, "name": name[:500], "obec_code": obec, "orp_code": str(a.get("kod_orp") or ""),
                             "lon": lon, "lat": lat, "attrs": keep, "source_url": _layer_url(service)})
        stats[service] = len(feats)
        # every obec gets a value, including zero: "no GP registered here" is information
        per_group: dict[str, float] = defaultdict(float)
        for obec_code, t in obce.items():
            n = counts.get(obec_code, 0)
            obs_rows.append({"territory_id": t.id, "indicator_code": code, "year": year, "value": n})
            per_group[t.orp_id] += n
            per_group[t.okres_id] += n
            per_group[tid("kraj", HOME_KRAJ)] += n
        obs_rows.extend({"territory_id": k, "indicator_code": code, "year": year, "value": v} for k, v in per_group.items())

    # Per-obec attribute layers.
    def attr_layer(service: str, handler) -> None:
        try:
            feats, meta = _fetch(c, service, geometry=True)
        except Exception as e:
            stats[service] = -1
            job("khk", "running", f"{service}: {e}")
            return
        edited = _edit_date(meta)
        stats[service] = len(feats)
        for f in feats:
            handler(f.get("attributes") or {}, f, edited)

    def isv(a, _f, edited):
        code = str(a.get("kod_obce") or a.get("K_ob") or "")
        if code in obce and a.get("navrh_kat") not in (None, ""):
            fact_rows.append({"territory_id": tid("obec", code), "key": "isv_kategorie", "value": str(a["navrh_kat"]),
                              "source_url": _layer_url("Index_sociálního_vyloučení"), "as_of": edited.date().isoformat() if edited else ""})
            try:
                obs_rows.append({"territory_id": tid("obec", code), "indicator_code": "khk_isv", "year": edited.year if edited else 2024,
                                 "value": float(str(a["navrh_kat"]).replace(",", "."))})
            except ValueError:
                pass

    def dane(a, _f, edited):
        code = str(a.get("K_ob") or "")
        if code in obce and a.get("dan") not in (None, ""):
            try:
                obs_rows.append({"territory_id": tid("obec", code), "indicator_code": "khk_dan_prijmy", "year": edited.year if edited else 2024,
                                 "value": float(a["dan"])})
            except (TypeError, ValueError):
                pass

    def spatial_fact(key: str, field: str, service: str):
        def handler(a, f, edited):
            val = a.get(field)
            if val in (None, ""):
                return
            lon, lat = _label_point(f)
            code = _spatial_obec(lon, lat, raw) if raw else ""
            if not code:
                name = norm(str(a.get("Obec") or a.get("obec") or ""))
                matches = [k for k, t in obce.items() if t.name_norm == name]
                code = matches[0] if len(matches) == 1 else ""
            if code:
                fact_rows.append({"territory_id": tid("obec", code), "key": key, "value": str(val)[:500],
                                  "source_url": _layer_url(service), "as_of": edited.date().isoformat() if edited else ""})
        return handler

    def kanal(a, _f, edited):
        code = str(a.get("kod_obce") or "")
        if code not in obce or a.get("kanal_sit") in (None, ""):
            return
        def pct(v) -> float | None:
            # The layer publishes shares as fractions (0.753); we store percent.
            try:
                x = float(str(v).replace(",", "."))
            except (TypeError, ValueError):
                return None
            return round(x * 100, 1) if x <= 1.0 else round(x, 1)

        share = pct(a["kanal_sit"])
        if share is None:
            return
        year = edited.year if edited else 2024
        obs_rows.append({"territory_id": tid("obec", code), "indicator_code": "khk_kanal_podil", "year": year, "value": share})
        parts = [f"kanalizační síť {share:g} %".replace(".", ",")]
        for key, label in (("cov", "vlastní ČOV"), ("zumpa", "žumpa"), ("bez_a_nezj", "bez odkanalizování / nezjištěno")):
            v = pct(a.get(key))
            if v is not None:
                parts.append(f"{label} {v:g} %".replace(".", ","))
        fact_rows.append({"territory_id": tid("obec", code), "key": "kanalizace", "value": ", ".join(parts),
                          "source_url": _layer_url(KANAL_LAYER), "as_of": edited.date().isoformat() if edited else ""})

    # Three more per-obec layers. Two of them publish only the obec's name, so
    # they are joined by geometry like the others — there are four Lhotas in
    # this kraj alone and a name join would quietly pick the wrong one.
    exek: dict[str, float] = {}
    vyd: dict[str, dict[int, float]] = {}
    years: dict[str, int] = {}

    def _one_per_obec(a, f, name_field: str, claimed: set[str]) -> str:
        """Attach a row of a one-row-per-obec layer to its obec, exactly once.

        These layers publish the obec's name but no code. Inside a single kraj
        the name is decisive (the national ambiguity the module docstring warns
        about — the hundred Lhotas — is between krajs, and `obce` here holds
        only this one), so the name decides and the label point is the
        fallback. `claimed` makes the join injective: the mean vertex of an
        L-shaped obec can land in its neighbour, and without this the
        neighbour would take two rows and one obec none.
        """
        matches = [k for k, t in obce.items() if t.name_norm == norm(str(a.get(name_field) or "")) and k not in claimed]
        code = matches[0] if len(matches) == 1 else ""
        if not code and raw:
            hit = _spatial_obec(*_label_point(f), raw)
            code = hit if hit in obce and hit not in claimed else ""
        if code:
            claimed.add(code)
        return code

    claimed_up: set[str] = set()
    claimed_vyd: set[str] = set()

    def exekuce(a, _f, edited):
        code = str(a.get("Kod_obce") or a.get("K_ob") or "")
        if code not in obce:
            return
        try:
            val = round(float(a["Exekuce"]), 2)
        except (TypeError, ValueError, KeyError):
            return
        years["khk_exekuce"] = edited.year if edited else 2024
        exek[code] = val
        obs_rows.append({"territory_id": tid("obec", code), "indicator_code": "khk_exekuce", "year": years["khk_exekuce"], "value": val})

    def hsoo(a, _f, edited):
        code = str(a.get("kod_obce") or "")
        flag = str(a.get("hsoo") or "").strip().lower()
        if code not in obce or flag not in ("ano", "ne"):
            return
        level = str(a.get("urov_ohr") or "").strip()
        obs_rows.append({"territory_id": tid("obec", code), "indicator_code": "khk_hsoo",
                         "year": edited.year if edited else 2024, "value": 1.0 if flag == "ano" else 0.0})
        fact_rows.append({"territory_id": tid("obec", code), "key": "hsoo",
                          "value": f"ano — {level}" if flag == "ano" and level else flag,
                          "source_url": _layer_url("Hospodářsky_a_sociálně_ohrožené_oblasti"),
                          "as_of": edited.date().isoformat() if edited else ""})

    def uzemni_plan(a, f, edited):
        code = _one_per_obec(a, f, "obec", claimed_up)
        has = str(a.get("Územní_p") or "").strip().lower()
        if not code or has not in ("ano", "ne"):
            return
        ucinnost = _date(a.get("Účinnost"))[:10]
        fact_rows.append({"territory_id": tid("obec", code), "key": "uzemni_plan",
                          "value": f"ano, účinný od {ucinnost}" if has == "ano" and ucinnost else has,
                          "source_url": _layer_url("Územní_plány_obcí"),
                          "as_of": edited.date().isoformat() if edited else ""})

    def vydaje(a, f, _edited):
        code = _one_per_obec(a, f, "Obec", claimed_vyd)
        if not code:
            return
        for field, year in (("F2_018", 2018), ("F2_019", 2019), ("F2_020", 2020), ("F2_021", 2021), ("F2_022", 2022)):
            try:
                val = float(a.get(field))
            except (TypeError, ValueError):
                continue
            if val <= 0:
                continue
            vyd.setdefault(code, {})[year] = val
            obs_rows.append({"territory_id": tid("obec", code), "indicator_code": "khk_vydaje_obce", "year": year, "value": round(val, 2)})

    attr_layer("Index_sociálního_vyloučení", isv)
    attr_layer("Daňové_příjmy_obcí", dane)
    attr_layer(KANAL_LAYER, kanal)
    attr_layer("Pošta_v_obcích", spatial_fact("posta", "pošta", "Pošta_v_obcích"))
    attr_layer("Podíl_exekuce", exekuce)
    attr_layer("Hospodářsky_a_sociálně_ohrožené_oblasti", hsoo)
    attr_layer("Územní_plány_obcí", uzemni_plan)
    attr_layer("Výdaje_rozpočtů_obcí_v_letech_2018_až_2022", vydaje)

    # Roll the two new per-obec series up the administrative tree, each the way
    # its unit allows: koruny add up, a share of residents is weighted by the
    # population it describes (averaging 448 percentages would let a hamlet of
    # 40 people count as much as Hradec Králové).
    if exek:
        groups: dict[str, list[tuple[float, float]]] = defaultdict(list)
        for obec_code, v in exek.items():
            t = obce[obec_code]
            for parent in (t.orp_id, t.okres_id, tid("kraj", HOME_KRAJ)):
                if parent:
                    groups[parent].append((v, float(t.population or 0)))
        for parent, pairs in groups.items():
            weight = sum(w for _v, w in pairs)
            if weight:
                obs_rows.append({"territory_id": parent, "indicator_code": "khk_exekuce",
                                 "year": years.get("khk_exekuce", 2024), "value": round(sum(v * w for v, w in pairs) / weight, 2)})
    if vyd:
        sums: dict[tuple[str, int], float] = defaultdict(float)
        for obec_code, per_year in vyd.items():
            t = obce[obec_code]
            for year, v in per_year.items():
                for parent in (t.orp_id, t.okres_id, tid("kraj", HOME_KRAJ)):
                    if parent:
                        sums[(parent, year)] += v
        obs_rows.extend({"territory_id": p, "indicator_code": "khk_vydaje_obce", "year": y, "value": round(v, 2)} for (p, y), v in sums.items())

    # Road surface condition per okres: share of length in the worst classes.
    try:
        feats, meta = _fetch(c, "Stav_povrchu_silnic", geometry=False)
        stats["Stav_povrchu_silnic"] = len(feats)
        edited = _edit_date(meta)
        total: dict[str, float] = defaultdict(float)
        bad: dict[str, float] = defaultdict(float)
        classes: Counter[str] = Counter()
        for f in feats:
            a = f.get("attributes") or {}
            okres = str(a.get("kod_okresu") or "")
            length = float(a.get("delka") or 0)
            stav = norm(str(a.get("stav_sil") or ""))
            classes[stav] += 1
            total[okres] += length
            if any(w in stav for w in ("nevyhov", "havar", "spatn", "kritick")):
                bad[okres] += length
        fact_rows.append({"territory_id": tid("kraj", HOME_KRAJ), "key": "silnice_tridy", "value": ", ".join(f"{k or '—'}: {v}" for k, v in classes.most_common(8)),
                          "source_url": _layer_url("Stav_povrchu_silnic"), "as_of": edited.date().isoformat() if edited else ""})
        if any(bad.values()):
            y = edited.year if edited else 2025
            for okres, tot in total.items():
                if tot and okres:
                    obs_rows.append({"territory_id": tid("okres", okres), "indicator_code": "khk_silnice_spatne", "year": y, "value": round(100 * bad[okres] / tot, 2)})
            all_tot = sum(total.values())
            if all_tot:
                obs_rows.append({"territory_id": tid("kraj", HOME_KRAJ), "indicator_code": "khk_silnice_spatne", "year": y, "value": round(100 * sum(bad.values()) / all_tot, 2)})
    except Exception as e:
        stats["Stav_povrchu_silnic"] = -1
        job("khk", "running", f"silnice: {e}")

    # Traffic restrictions → Puls kraje.
    events: list[dict] = []
    for service, kind in (("Omezení_v_autobusové_dopravě", "omezeni_bus"), ("Výluky_v_železniční_dopravě", "vyluka_vlak")):
        try:
            feats, meta = _fetch(c, service, geometry=False)
            edited = _edit_date(meta)
            stats[service] = len(feats)
            for f in feats:
                a = f.get("attributes") or {}
                events.append({"kind": kind, "title": str(a.get("lokalizace") or "Omezení dopravy")[:500], "detail": str(a.get("poznamka") or "")[:2000],
                               "territory_id": tid("kraj", HOME_KRAJ), "starts": _date(a.get("zacatek")), "ends": _date(a.get("konec")),
                               "source_url": str(a.get("www") or _layer_url(service)), "published": edited.date().isoformat() if edited else ""})
        except Exception as e:
            stats[service] = -1
            job("khk", "running", f"{service}: {e}")

    codes = [v[0] for v in KHK_POINTS.values()] + ["khk_isv", "khk_dan_prijmy", "khk_silnice_spatne", "khk_kanal_podil",
                                                   "khk_exekuce", "khk_hsoo", "khk_vydaje_obce"]
    with session_scope() as s:
        s.execute(delete(Poi))
        s.execute(delete(Observation).where(Observation.indicator_code.in_(codes)))
        s.execute(delete(Fact).where(Fact.key.in_(["isv_kategorie", "kanalizace", "posta", "silnice_tridy", "hsoo", "uzemni_plan"])))
        s.execute(delete(Event).where(Event.kind.in_(["omezeni_bus", "vyluka_vlak"])))
        # One value per territory, indicator and year — the table says so with a
        # unique constraint, and a layer that lists an obec twice would
        # otherwise abort the whole ingest instead of losing one duplicate row.
        obs_rows = list({(r["territory_id"], r["indicator_code"], r["year"]): r for r in obs_rows}.values())
        for rows, model in ((poi_rows, Poi), (obs_rows, Observation), (events, Event)):
            for i in range(0, len(rows), 4000):
                if rows[i:i + 4000]:
                    s.execute(insert(model), rows[i:i + 4000])
        dedup: dict[tuple[str, str], dict] = {(r["territory_id"], r["key"]): r for r in fact_rows}
        if dedup:
            s.execute(insert(Fact), list(dedup.values()))
    stats.update(pois=len(poi_rows), observations=len(obs_rows), facts=len(fact_rows), events=len(events))
    job("khk", "done", str(stats), 1.0)
    return stats
