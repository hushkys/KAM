"""Mark catalogue rows whose values the model actually ingested.

`loaded` is set only when a harvester really read the dataset's data: the
MOS yearly files we streamed (and the MOS database record itself), and the
Data KHK layers read through their FeatureServer. Matching is on the
published title, so if a portal renames a dataset the flag simply drops
rather than pointing at the wrong row.
"""

from __future__ import annotations

import re

from sqlalchemy import select, update

from ..config import settings
from ..db import session_scope
from ..indicators import KHK_POINTS
from ..models import Dataset
from .common import norm

# Titles as published in NKOD / Data KHK for the layers `khk.py` reads.
KHK_TITLES = {norm(s.replace("_", " ")) for s in KHK_POINTS} | {norm(t) for t in (
    "Podíl obydlených domů dle připojení na kanalizaci",
    "Daňové příjmy obcí královéhradeckého kraje",
    "Index sociálního vyloučení",
    "Pošta v obcích",
    "Stav povrchu silnic",
    "Omezení v autobusové dopravě",
    "Výluky v železniční dopravě",
    "Hranice obcí v Královéhradeckém kraji",
)}
MOS_YEAR = re.compile(r"^databaze mos(?: - data (\d{4}))?$")


CSU_SOURCES = ("nkod-00025593", "nkod-csu")
KHK_SOURCES = ("nkod-70889546", "nkod-khk", "datakhk")


def is_loaded(source_id: str, title: str) -> bool:
    t = norm(title)
    if source_id in CSU_SOURCES:
        m = MOS_YEAR.match(t)
        if m:
            year = m.group(1)
            return year is None or settings.mos_first_year <= int(year) <= settings.mos_last_year
        return False
    if source_id == "vydaje":
        return True
    return source_id in KHK_SOURCES and t in KHK_TITLES


def link() -> int:
    marked = 0
    with session_scope() as s:
        s.execute(update(Dataset).values(loaded=False))
        rows = s.execute(select(Dataset.id, Dataset.title, Dataset.source_id, Dataset.usage)).all()
        for i, title, src, usage in rows:
            base = [u for u in (usage or []) if u != "model"]
            if is_loaded(src, title):
                s.execute(update(Dataset).where(Dataset.id == i).values(loaded=True, usage=[*base, "model"]))
                marked += 1
    return marked
