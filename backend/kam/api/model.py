"""Forecast, simulation and saved scenarios."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from ..analytics import forecast, simulate, store, umisteni
from ..db import session_scope
from ..models import Scenario
from ..indicators import PILLARS
from ..security import write_limiter
from ..territory import HOME_KRAJ

router = APIRouter(prefix="/api")


class Intervention(BaseModel):
    type: str
    params: dict = Field(default_factory=dict)


class SimRequest(BaseModel):
    territory: str
    interventions: list[Intervention] = Field(default_factory=list, max_length=12)
    assumptions: dict = Field(default_factory=dict)


class ScenarioSave(SimRequest):
    name: str = Field(min_length=1, max_length=120)


@router.get("/forecast/{tid}")
def get_forecast(tid: str) -> dict:
    if store.territory(tid) is None:
        raise HTTPException(404)
    res = forecast.project(tid)
    res["backtest"] = forecast.backtest(tid)
    return res


class MistoRequest(BaseModel):
    """Které obce uživatel vybral a kolik míst se porovnává."""

    zasah: str
    obce: list[str] = Field(default_factory=list, max_length=30)
    pocet: int | None = Field(default=None, ge=1, le=30)
    kraj: int = HOME_KRAJ
    uvnitr: str | None = Field(default=None, max_length=32)


@router.get("/umisteni/pravidla")
def umisteni_pravidla() -> dict:
    """Zásahy, u kterých umíme posoudit umístění, a ukazatel, podle kterého."""
    return {"zasahy": {k: {"ukazatel": v["code"], "co": v["co"],
                           "label": simulate.INTERVENTIONS.get(k, {}).get("label", k)}
                       for k, v in umisteni.PRAVIDLA.items()}}


@router.post("/umisteni")
def umisteni_porovnani(req: MistoRequest) -> dict:
    return umisteni.porovnej(req.kraj, req.zasah, req.obce, req.pocet, req.uvnitr)


@router.get("/simulate/catalog")
def sim_catalog() -> dict:
    # Název oblasti posílá server, ať se devět popisků nepíše podruhé
    # v prohlížeči — pilíře jsou jeden číselník a ten žije v indicators.py.
    ivs = {k: {**v, "pillar_label": PILLARS.get(v["pillar"], "Ostatní")} for k, v in simulate.INTERVENTIONS.items()}
    return {"interventions": ivs, "assumptions": simulate.ASSUMPTIONS,
            "help": simulate.INTERVENTION_HELP, "sady": simulate.SADY, "resi": simulate.RESI_OBECNE}


@router.get("/simulate/navrh/{tid}")
def sim_navrh(tid: str, jen: str | None = None) -> dict:
    """Opatření spočítaná z problémů území: co, kolik a proč."""
    return simulate.navrh(tid, jen)


@router.post("/simulate")
def run_sim(req: SimRequest) -> dict:
    if store.territory(req.territory) is None:
        raise HTTPException(404, "Neznámé území")
    return simulate.run(req.territory, [i.model_dump() for i in req.interventions], req.assumptions)


@router.get("/simulate/popular")
def sim_popular() -> dict:
    return {"popular": simulate.popular(10), "cache": simulate.cache_info()}


@router.get("/scenarios")
def list_scenarios() -> list[dict]:
    with session_scope() as s:
        rows = s.scalars(select(Scenario).order_by(Scenario.created_at.desc()).limit(100)).all()
        return [{"id": r.id, "name": r.name, "territory": r.territory_id, "territory_name": (store.territory(r.territory_id).name if store.territory(r.territory_id) else r.territory_id),
                 "interventions": r.interventions, "created_at": r.created_at.isoformat(),
                 "summary": {"warnings": len((r.result or {}).get("warnings", {}).get("scenario", []))}} for r in rows]


@router.post("/scenarios")
def save_scenario(req: ScenarioSave, request: Request) -> dict:
    if not write_limiter.allow(request.client.host if request.client else "?"):
        raise HTTPException(429, "Příliš mnoho požadavků")
    if store.territory(req.territory) is None:
        raise HTTPException(404)
    res = simulate.run(req.territory, [i.model_dump() for i in req.interventions], req.assumptions, record=False)
    sid = str(uuid.uuid4())
    slim = {k: res.get(k) for k in ("warnings", "metrics", "chain", "costs", "request")}
    with session_scope() as s:
        s.add(Scenario(id=sid, name=req.name.strip(), territory_id=req.territory, interventions=[i.model_dump() for i in req.interventions], result=slim))
    return {"id": sid}


@router.get("/scenarios/{sid}")
def get_scenario(sid: str) -> dict:
    with session_scope() as s:
        r = s.get(Scenario, sid)
        if r is None:
            raise HTTPException(404)
        return {"id": r.id, "name": r.name, "territory": r.territory_id, "interventions": r.interventions, "result": r.result, "created_at": r.created_at.isoformat()}


@router.delete("/scenarios/{sid}")
def delete_scenario(sid: str) -> dict:
    with session_scope() as s:
        s.execute(delete(Scenario).where(Scenario.id == sid))
    return {"ok": True}
