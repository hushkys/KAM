"""Administrative geography that the rest of the system keys on.

Codes are RÚIAN codes (ČÚZK), the same ones the boundary service and the
NKOD publisher registry use, so a kraj can be joined to its datasets and its
shape without a lookup table of our own invention. IČO is how NKOD identifies
a publisher. KHK is the first deployment, not a hard-coded assumption: every
function takes a kraj code.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Kraj:
    code: int
    name: str
    short: str
    ico: str
    nuts: str


KRAJE: tuple[Kraj, ...] = (
    Kraj(19, "Hlavní město Praha", "Praha", "00064581", "CZ010"),
    Kraj(27, "Středočeský kraj", "Středočeský", "70891095", "CZ020"),
    Kraj(35, "Jihočeský kraj", "Jihočeský", "70890650", "CZ031"),
    Kraj(43, "Plzeňský kraj", "Plzeňský", "70890366", "CZ032"),
    Kraj(51, "Karlovarský kraj", "Karlovarský", "70891168", "CZ041"),
    Kraj(60, "Ústecký kraj", "Ústecký", "70892156", "CZ042"),
    Kraj(78, "Liberecký kraj", "Liberecký", "70891508", "CZ051"),
    Kraj(86, "Královéhradecký kraj", "Královéhradecký", "70889546", "CZ052"),
    Kraj(94, "Pardubický kraj", "Pardubický", "70892822", "CZ053"),
    Kraj(108, "Kraj Vysočina", "Vysočina", "70890749", "CZ063"),
    Kraj(116, "Jihomoravský kraj", "Jihomoravský", "70888337", "CZ064"),
    Kraj(124, "Olomoucký kraj", "Olomoucký", "60609460", "CZ071"),
    Kraj(141, "Zlínský kraj", "Zlínský", "70891320", "CZ072"),
    Kraj(132, "Moravskoslezský kraj", "Moravskoslezský", "70890692", "CZ080"),
)

KRAJ_BY_CODE = {k.code: k for k in KRAJE}
KRAJ_BY_ICO = {k.ico: k for k in KRAJE}

HOME_KRAJ = 86  # Královéhradecký kraj — the reference deployment
HOME_OKRESY = {3602: "Hradec Králové", 3604: "Jičín", 3605: "Náchod", 3607: "Rychnov nad Kněžnou", 3610: "Trutnov"}


def tid(level: str, code: int | str) -> str:
    """Stable territory id, e.g. `obec:574040`, `orp:1234`, `kraj:86`."""
    return f"{level}:{code}"


def parse_tid(value: str) -> tuple[str, str]:
    level, _, code = value.partition(":")
    return level, code


LEVEL_LABEL = {"cz": "Česko", "kraj": "Kraj", "okres": "Okres", "orp": "ORP", "obec": "Obec"}
