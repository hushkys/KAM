"""Citizen reports (crowdsourcing layer)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import crowd
from ..security import write_limiter

router = APIRouter(prefix="/api/reports")


class ReportIn(BaseModel):
    territory: str = Field(max_length=32)
    category: str = Field(max_length=32)
    text: str = Field(max_length=1200)
    kind: str = Field(default="problem", pattern="^(problem|chybejici_data)$")


@router.get("/categories")
def categories() -> dict:
    return crowd.CATEGORIES


@router.post("")
def create(r: ReportIn, request: Request) -> dict:
    if not write_limiter.allow(request.client.host if request.client else "?"):
        raise HTTPException(429, "Příliš mnoho podnětů za minutu.")
    try:
        return crowd.submit(r.territory, r.category, r.text, r.kind)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/clusters")
def clusters(territory: str = "", status: str = "", category: str = "") -> list[dict]:
    return crowd.clusters(territory or None, status or None, category or None)


@router.get("/clusters/{cid}")
def cluster(cid: int) -> dict:
    try:
        return crowd.document(cid)
    except KeyError as e:
        raise HTTPException(404) from e


@router.post("/clusters/{cid}/submit")
def submit(cid: int) -> dict:
    try:
        return crowd.deliver(cid)
    except KeyError as e:
        raise HTTPException(404) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(502, f"Odeslání selhalo: {e}") from e


@router.post("/clusters/{cid}/hlas")
def hlas(cid: int, request: Request) -> dict:
    """Mám stejný problém: přidá hlas ke skupině hlášení."""
    if not write_limiter.allow(request.client.host if request.client else "?"):
        raise HTTPException(429, "Příliš mnoho hlasů za minutu.")
    try:
        return crowd.hlas(cid)
    except KeyError as e:
        raise HTTPException(404) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.delete("/clusters/{cid}")
def smaz(cid: int, request: Request) -> dict:
    """Smaže skupinu i hlášení pod ní. Jediná operace v API, po které data
    nejdou vrátit — proto rychlostní limit a záznam v provozním logu."""
    if not write_limiter.allow(request.client.host if request.client else "?"):
        raise HTTPException(429, "Příliš mnoho požadavků za minutu.")
    try:
        return crowd.smaz(cid)
    except KeyError as e:
        raise HTTPException(404) from e


@router.get("/stats")
def stats() -> dict:
    return crowd.stats()
