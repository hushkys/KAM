"""Výškový model Královéhradeckého kraje z ČÚZK DMR 5G.

Mapa kraje je kreslená, ne dlaždicová (viz `geo.py`), a stejně tak je kreslený
i její reliéf: jednou se z ImageServeru ČÚZK stáhne mřížka výšek nad bboxem
kraje a uloží se vedle hranic. Aplikace pak nepotřebuje žádnou externí
dlaždicovou službu ani klíč a 3D mapa funguje i offline.

Mřížka je v **téže projekci jako SVG hranice** — `geo.py` uloží do `khk.json`
parametry `projection`, takže vrchol mřížky a obrys obce sedí na sebe na
pixel. Kdyby se mřížka vzorkovala v zeměpisných stupních a hranice v SVG
souřadnicích, terén by se vůči obcím posouval tím víc, čím dál od středu.

Výšky jsou celé metry v `uint16`; DMR 5G má v kraji rozsah zhruba 200–1600 m,
takže půl metru přesnosti navíc by jen zdvojnásobilo přenos. Nula znamená
„mimo republiku" — ImageServer tam vrací prázdno.
"""

from __future__ import annotations

import base64
import io
import json

import numpy as np
from PIL import Image

from ..config import settings
from .common import client, job

DMR = "https://ags.cuzk.gov.cz/arcgis/rest/services/3D/dmr5g/ImageServer"
DMR_EXPORT = f"{DMR}/exportImage"
# 384 × 250 vyjde na zhruba 310 × 310 m na buňku: hřeben Krkonoš i údolí Labe
# jsou zřetelné a přenos zůstane pod 200 kB po zabalení.
GRID_W, GRID_H = 384, 250
# ImageServer umí vrátit nejvýš pár megapixelů naráz; kraj se vejde do jednoho
# požadavku, ale dělení na pásy drží odezvu krátkou a jde opakovat po částech.
BANDS = 5


def _bbox_of(khk: dict) -> tuple[float, float, float, float]:
    """Zeměpisný obdélník kraje z obrysu v `khk.json` přes inverzní projekci."""
    p = khk["projection"]
    w, h = (float(v) for v in khk["viewBox"].split()[2:])
    lon0, lat1, k, kx, pad = p["lon0"], p["lat1"], p["k"], p["kx"], p["pad"]
    def inv(x: float, y: float) -> tuple[float, float]:
        return lon0 + (x - pad) / (k * kx), lat1 - (y - pad) / k
    lon_a, lat_a = inv(0, 0)
    lon_b, lat_b = inv(w, h)
    return min(lon_a, lon_b), min(lat_a, lat_b), max(lon_a, lon_b), max(lat_a, lat_b)


def _band(c, west: float, south: float, east: float, north: float, w: int, h: int) -> np.ndarray:
    params = {
        "bbox": f"{west},{south},{east},{north}", "bboxSR": 4326, "imageSR": 4326,
        "size": f"{w},{h}", "format": "tiff", "pixelType": "F32",
        "interpolation": "RSP_BilinearInterpolation", "noDataInterpretation": "esriNoDataMatchAny", "f": "image",
    }
    last: Exception | None = None
    for attempt in range(4):
        try:
            r = c.get(DMR_EXPORT, params=params)
            r.raise_for_status()
            if not r.headers.get("content-type", "").startswith("image"):
                raise RuntimeError(r.text[:200])
            a = np.array(Image.open(io.BytesIO(r.content)), dtype="float32")
            if a.shape != (h, w):
                raise RuntimeError(f"ImageServer vrátil {a.shape}, čekali jsme {(h, w)}")
            return a
        except Exception as e:  # veřejná služba ČÚZK občas odmítne souběh
            last = e
    raise RuntimeError(f"DMR 5G selhal pro pás {south}–{north}: {last}")


def build() -> dict[str, float | int]:
    geo_path = settings.geo_dir / "khk.json"
    if not geo_path.is_file():
        raise RuntimeError("Chybí khk.json — nejdřív spusťte krok `geo`.")
    khk = json.loads(geo_path.read_text(encoding="utf-8"))
    west, south, east, north = _bbox_of(khk)
    job("relief", "running", f"Vzorkuji DMR 5G {GRID_W}×{GRID_H} nad krajem")

    c = client(180)
    rows = np.zeros((GRID_H, GRID_W), dtype="float32")
    # Pásy jdou odshora dolů, protože rastr má první řádek na severu.
    edges = [round(GRID_H * i / BANDS) for i in range(BANDS + 1)]
    for i in range(BANDS):
        y0, y1 = edges[i], edges[i + 1]
        if y1 <= y0:
            continue
        top = north - (north - south) * y0 / GRID_H
        bot = north - (north - south) * y1 / GRID_H
        rows[y0:y1] = _band(c, west, bot, east, top, GRID_W, y1 - y0)
        job("relief", "running", f"Pás {i + 1}/{BANDS}", (i + 1) / BANDS * 0.9)

    # Mimo republiku vrací služba nulu nebo zápornou výplň; oboje je „nic".
    valid = rows > 0
    if not valid.any():
        raise RuntimeError("DMR 5G nevrátil žádné platné výšky.")
    grid = np.where(valid, np.rint(rows), 0).clip(0, 65535).astype("<u2")

    out = {
        "w": GRID_W, "h": GRID_H,
        "bbox": [round(west, 6), round(south, 6), round(east, 6), round(north, 6)],
        "min": int(rows[valid].min()), "max": int(rows[valid].max()),
        "mean": round(float(rows[valid].mean()), 1),
        "unit": "m n. m. (Bpv)",
        "encoding": "uint16-le-base64",
        "data": base64.b64encode(grid.tobytes()).decode("ascii"),
        "source": DMR,
        "source_name": "ČÚZK — Digitální model reliéfu ČR 5. generace (DMR 5G)",
        "license": "CC BY 4.0",
    }
    settings.geo_dir.mkdir(parents=True, exist_ok=True)
    (settings.geo_dir / "khk_relief.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    counts = {"body": GRID_W * GRID_H, "platnych": int(valid.sum()), "min": out["min"], "max": out["max"]}
    job("relief", "done", json.dumps(counts), 1.0)
    return counts
