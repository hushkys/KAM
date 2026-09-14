"""Boundaries from ČÚZK RÚIAN, projected once into SVG paths.

The map is our own drawing, not a tile layer: nothing outside the Czech
Republic exists in it, it needs no API key and it works offline once built.
ČÚZK generalises the geometry server-side (`maxAllowableOffset`), we project
with an equirectangular projection corrected by cos(φ₀) — at the size of
Czechia the distortion against a conformal projection is well under a pixel
of the rendered map — and thin the result again with Douglas–Peucker in
screen space so every path is only as detailed as it can be drawn.
"""

from __future__ import annotations

import json
import math
from typing import Any

from sqlalchemy import delete

from ..config import settings
from ..db import session_scope
from ..models import Territory
from ..territory import HOME_KRAJ, HOME_OKRESY, KRAJE, tid
from .common import client, get_json, job, norm

CUZK = "https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/"
CUZK_SOURCE = "https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer"
PHI0 = math.radians(49.8)
KX = math.cos(PHI0)


def _query(c, layer: int, where: str, fields: str, geometry: bool, offset: float | None = None) -> list[dict]:
    out: list[dict] = []
    start = 0
    while True:
        params: dict[str, Any] = {
            "where": where, "outFields": fields, "returnGeometry": str(geometry).lower(),
            "f": "geojson" if geometry else "json", "resultOffset": start, "resultRecordCount": 2000,
        }
        if geometry:
            params.update(outSR=4326, geometryPrecision=5)
            if offset:
                params["maxAllowableOffset"] = offset
        data = get_json(c, f"{CUZK}{layer}/query", params)
        feats = data.get("features", [])
        if geometry:
            out.extend(feats)
        else:
            out.extend({"properties": f["attributes"]} for f in feats)
        more = data.get("exceededTransferLimit") or (data.get("properties") or {}).get("exceededTransferLimit")
        if not feats or not more:
            break
        start += len(feats)
    return out


def _rings(geom: dict) -> list[list[list[float]]]:
    if not geom:
        return []
    if geom["type"] == "Polygon":
        return geom["coordinates"]
    if geom["type"] == "MultiPolygon":
        return [ring for poly in geom["coordinates"] for ring in poly]
    return []


def _dp(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        seg = math.hypot(dx, dy)
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            # A closed ring starts and ends on the same vertex: the "segment"
            # has no length, so measure plain distance from that vertex.
            d = abs(dy * px - dx * py + bx * ay - by * ax) / seg if seg > 1e-9 else math.hypot(px - ax, py - ay)
            if d > best:
                best, idx = d, i
        if best > eps and idx > 0:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(pts, keep, strict=True) if k]


class Projector:
    def __init__(self, bbox: tuple[float, float, float, float], width: float = 1000.0, pad: float = 12.0):
        lon0, lat0, lon1, lat1 = bbox
        self.lon0, self.lat1 = lon0, lat1
        span_x = (lon1 - lon0) * KX
        span_y = lat1 - lat0
        self.k = (width - 2 * pad) / span_x
        self.pad = pad
        self.width = width
        self.height = span_y * self.k + 2 * pad

    def __call__(self, lon: float, lat: float) -> tuple[float, float]:
        return ((lon - self.lon0) * KX * self.k + self.pad, (self.lat1 - lat) * self.k + self.pad)

    def inverse(self, x: float, y: float) -> tuple[float, float]:
        return ((x - self.pad) / (KX * self.k) + self.lon0, self.lat1 - (y - self.pad) / self.k)


def _bbox(features: list[dict]) -> tuple[float, float, float, float]:
    xs, ys = [], []
    for f in features:
        for ring in _rings(f.get("geometry")):
            for lon, lat in ring:
                xs.append(lon)
                ys.append(lat)
    return min(xs), min(ys), max(xs), max(ys)


def _ring_area(pts: list[tuple[float, float]]) -> float:
    return 0.5 * sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1], strict=True))


def _path(feature: dict, proj: Projector, eps: float) -> tuple[str, float, float, float]:
    parts: list[str] = []
    best_area, cx, cy, total = 0.0, 0.0, 0.0, 0.0
    for ring in _rings(feature.get("geometry")):
        pts = _dp([proj(lon, lat) for lon, lat in ring], eps)
        if len(pts) < 4:
            continue
        a = _ring_area(pts)
        total += a
        if abs(a) > best_area:
            best_area = abs(a)
            # centroid of the largest ring is where the label goes
            s = sum((x0 + x1) * (x0 * y1 - x1 * y0) for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1], strict=True))
            t = sum((y0 + y1) * (x0 * y1 - x1 * y0) for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1], strict=True))
            if a:
                cx, cy = s / (6 * a), t / (6 * a)
        parts.append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts[:-1]) + "Z")
    return "".join(parts), round(cx, 1), round(cy, 1), abs(total)


def _raw_rings(feature: dict, eps_deg: float = 0.0004) -> list[list[list[float]]]:
    # Lon/lat rings kept for point-in-polygon joins (Data KHK layers without codes).
    out = []
    for ring in _rings(feature.get("geometry")):
        pts = _dp([(lon, lat) for lon, lat in ring], eps_deg)
        out.append([[round(x, 5), round(y, 5)] for x, y in pts])
    return out


def build() -> dict[str, int]:
    job("geo", "running", "Stahuji hranice z ČÚZK RÚIAN")
    settings.geo_dir.mkdir(parents=True, exist_ok=True)
    c = client(180)
    kraje = _query(c, 17, "1=1", "kod,nazev", True, 0.003)
    stat = _query(c, 19, "1=1", "kod,nazev", True, 0.002)
    okresy_all = _query(c, 15, "1=1", "kod,nazev,vusc", False)
    job("geo", "running", "Obce Česka (číselník)", 0.3)
    obce_all = _query(c, 12, "1=1", "kod,nazev,okres,pou", False)
    okres_where = ",".join(str(k) for k in HOME_OKRESY)
    khk_obce = _query(c, 12, f"okres in ({okres_where})", "kod,nazev,okres,pou", True, 0.0006)
    pou_codes = sorted({f["properties"]["pou"] for f in khk_obce if f["properties"].get("pou")})
    pou = _query(c, 13, f"kod in ({','.join(map(str, pou_codes))})", "kod,nazev,orp", False)
    pou_to_orp = {p["properties"]["kod"]: p["properties"]["orp"] for p in pou}
    orp_codes = sorted({v for v in pou_to_orp.values() if v})
    orp = _query(c, 14, f"kod in ({','.join(map(str, orp_codes))})", "kod,nazev,okres", True, 0.001)
    job("geo", "running", "Projekce a zjednodušení", 0.7)

    okres_to_kraj = {o["properties"]["kod"]: o["properties"]["vusc"] for o in okresy_all}
    obec_to_kraj = {str(o["properties"]["kod"]): okres_to_kraj.get(o["properties"]["okres"], 0) for o in obce_all}
    obec_to_okres = {str(o["properties"]["kod"]): o["properties"]["okres"] for o in obce_all}

    cz_proj = Projector(_bbox(stat))
    cz = {
        "viewBox": f"0 0 {cz_proj.width:.0f} {cz_proj.height:.0f}",
        "outline": _path(stat[0], cz_proj, 0.5)[0],
        "kraje": [],
        "source": CUZK_SOURCE,
    }
    for f in kraje:
        d, cx, cy, _ = _path(f, cz_proj, 0.5)
        cz["kraje"].append({"code": f["properties"]["kod"], "name": f["properties"]["nazev"], "d": d, "cx": cx, "cy": cy})

    khk_feature = next(f for f in kraje if f["properties"]["kod"] == HOME_KRAJ)
    kp = Projector(_bbox([khk_feature]), 1000, 16)
    khk: dict[str, Any] = {"viewBox": f"0 0 {kp.width:.0f} {kp.height:.0f}", "outline": _path(khk_feature, kp, 0.35)[0], "orp": [], "obce": [], "source": CUZK_SOURCE,
                           "projection": {"lon0": kp.lon0, "lat1": kp.lat1, "k": kp.k, "kx": KX, "pad": kp.pad}}
    for f in orp:
        d, cx, cy, _ = _path(f, kp, 0.35)
        khk["orp"].append({"code": f["properties"]["kod"], "name": f["properties"]["nazev"], "okres": f["properties"]["okres"], "d": d, "cx": cx, "cy": cy})
    raw: dict[str, Any] = {}
    for f in khk_obce:
        p = f["properties"]
        d, cx, cy, _ = _path(f, kp, 0.3)
        orp_code = pou_to_orp.get(p.get("pou"), 0)
        khk["obce"].append({"code": p["kod"], "name": p["nazev"], "okres": p["okres"], "orp": orp_code, "d": d, "cx": cx, "cy": cy})
        lon, lat = kp.inverse(cx, cy)
        raw[str(p["kod"])] = {"rings": _raw_rings(f), "lon": round(lon, 5), "lat": round(lat, 5)}

    (settings.geo_dir / "cz.json").write_text(json.dumps(cz, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (settings.geo_dir / "khk.json").write_text(json.dumps(khk, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (settings.geo_dir / "khk_raw.json").write_text(json.dumps(raw, separators=(",", ":")), encoding="utf-8")
    admin = {"obec_to_kraj": obec_to_kraj, "obec_to_okres": obec_to_okres, "okres_to_kraj": {str(k): v for k, v in okres_to_kraj.items()},
             "okres_names": {str(o["properties"]["kod"]): o["properties"]["nazev"] for o in okresy_all}}
    (settings.geo_dir / "admin.json").write_text(json.dumps(admin, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # Territory registry: Česko, 14 krajů, the home kraj's okresy, ORP and obce.
    with session_scope() as s:
        s.execute(delete(Territory))
        s.add(Territory(id="cz", level="cz", code="CZ", name="Česko", name_norm="cesko"))
        for k in KRAJE:
            s.add(Territory(id=tid("kraj", k.code), level="kraj", code=str(k.code), name=k.name, name_norm=norm(k.name), parent_id="cz", kraj_code=k.code))
        okres_names = admin["okres_names"]
        for code in HOME_OKRESY:
            s.add(Territory(id=tid("okres", code), level="okres", code=str(code), name=f"Okres {okres_names.get(str(code), HOME_OKRESY[code])}",
                            name_norm=norm(okres_names.get(str(code), "")), parent_id=tid("kraj", HOME_KRAJ), kraj_code=HOME_KRAJ))
        for o in khk["orp"]:
            s.add(Territory(id=tid("orp", o["code"]), level="orp", code=str(o["code"]), name=o["name"], name_norm=norm(o["name"]),
                            parent_id=tid("kraj", HOME_KRAJ), okres_id=tid("okres", o["okres"]), kraj_code=HOME_KRAJ))
        for o in khk["obce"]:
            r = raw[str(o["code"])]
            s.add(Territory(id=tid("obec", o["code"]), level="obec", code=str(o["code"]), name=o["name"], name_norm=norm(o["name"]),
                            parent_id=tid("orp", o["orp"]), orp_id=tid("orp", o["orp"]), okres_id=tid("okres", o["okres"]),
                            kraj_code=HOME_KRAJ, lon=r["lon"], lat=r["lat"]))
    extend_admin(c)
    counts = {"kraje": len(kraje), "orp": len(orp), "obce": len(khk_obce), "obce_cz": len(obce_all)}
    job("geo", "done", json.dumps(counts), 1.0)
    return counts


def extend_admin(c=None) -> dict:
    """Add ORP → kraj and city part → obec lookups to admin.json.

    Catalogue records point at RÚIAN units of every level (NKOD
    `dcterms:spatial`); these two tables let any of them be placed in a kraj.
    Kept separate from `build()` so it can run without rewriting territories.
    """
    admin = load("admin")
    if not admin:
        return {}
    c = c or client(180)
    orp_all = _query(c, 14, "1=1", "kod,vusc,okres,spravniobeckod", False)
    mc_all = _query(c, 8, "1=1", "kod,obec", False)
    obce_all = _query(c, 12, "1=1", "kod,nazev", False)
    o2k = admin.get("obec_to_kraj", {})
    ok2k = admin.get("okres_to_kraj", {})
    orp_to_kraj = {}
    for o in orp_all:
        p = o["properties"]
        # The ORP layer rarely fills `vusc`; the seat obec (or okres) always places it.
        kraj = p.get("vusc") or o2k.get(str(p.get("spravniobeckod") or "")) or ok2k.get(str(p.get("okres") or ""))
        if kraj:
            orp_to_kraj[str(p["kod"])] = kraj
    admin["orp_to_kraj"] = orp_to_kraj
    admin["mc_to_obec"] = {str(m["properties"]["kod"]): str(m["properties"]["obec"]) for m in mc_all if m["properties"].get("obec")}
    admin["obec_names"] = {str(o["properties"]["kod"]): o["properties"]["nazev"] for o in obce_all}
    (settings.geo_dir / "admin.json").write_text(json.dumps(admin, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {"orp": len(orp_to_kraj), "mestske_casti": len(admin["mc_to_obec"]), "obce": len(admin["obec_names"])}


def load(name: str) -> dict:
    path = settings.geo_dir / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def point_in_rings(lon: float, lat: float, rings: list[list[list[float]]]) -> bool:
    inside = False
    for ring in rings:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
                inside = not inside
            j = i
    return inside
