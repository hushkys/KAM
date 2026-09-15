"""Provozní log: co se v aplikaci stalo a jak se to uklízí.

Čtení i mazání je za stejnou branou jako zbytek aplikace (HTTP Basic přes
`main.py::gate`), takže se tu nic dalšího neověřuje. Mazání má rychlostní
limit, protože je to jediná operace v celém API, po které data nejdou vrátit.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import crowd, logs
from ..security import write_limiter

router = APIRouter(prefix="/api/provoz")


class Uklid(BaseModel):
    starsi_nez_dni: int | None = Field(default=None, ge=0, le=3650)
    uroven: str = Field(default="", max_length=16)
    vse: bool = False


class UklidPodnetu(BaseModel):
    stav: str = Field(default="", max_length=16)
    starsi_nez_dni: int | None = Field(default=None, ge=1, le=3650)


def _limit(request: Request) -> None:
    if not write_limiter.allow(request.client.host if request.client else "?"):
        raise HTTPException(429, "Příliš mnoho požadavků za minutu.")


@router.get("/log")
def log(uroven: str = "", zdroj: str = "", hledat: str = "", limit: int = 50, offset: int = 0) -> dict:
    return logs.seznam(uroven=uroven, zdroj=zdroj, hledat=hledat, limit=limit, offset=offset)


@router.get("/log/souhrn")
def souhrn() -> dict:
    return {**logs.souhrn(), "urovne": list(logs.UROVNE), "zdroje": list(logs.ZDROJE)}


@router.post("/log/uklid")
def log_uklid(u: Uklid, request: Request) -> dict:
    _limit(request)
    return {"smazano": logs.uklid(starsi_nez_dni=u.starsi_nez_dni, uroven=u.uroven, vse=u.vse)}


@router.post("/podnety/uklid")
def podnety_uklid(u: UklidPodnetu, request: Request) -> dict:
    _limit(request)
    return crowd.uklid(stav=u.stav or None, starsi_nez_dni=u.starsi_nez_dni)
