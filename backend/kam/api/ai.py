"""Assistant (SSE), model providers, server settings."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from .. import prefs
from ..ai import assistant, providers, rag, router as ai_router
from ..db import session_scope
from ..models import ModelProvider
from ..security import chat_limiter, encrypt, mask, decrypt, write_limiter

router = APIRouter(prefix="/api")


class ChatRequest(BaseModel):
    message: str = Field(max_length=4000)
    session_id: str | None = Field(default=None, max_length=64)
    context: dict = Field(default_factory=dict)
    history: list[dict] = Field(default_factory=list, max_length=12)


@router.post("/chat")
def chat(req: ChatRequest, request: Request) -> StreamingResponse:
    ip = request.client.host if request.client else "?"
    if not chat_limiter.allow(ip):
        raise HTTPException(429, "Příliš mnoho dotazů za minutu. Zkuste to prosím za chvíli.")
    ctx = {k: str(v)[:64] for k, v in req.context.items() if k in ("territory", "route")}

    def gen():
        try:
            for event, data in assistant.stream(req.message, req.session_id, ctx, req.history):
                yield f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        except Exception as e:  # the stream must end with an event, never a dropped socket
            yield f"event: error\ndata: {json.dumps({'text': 'Asistent narazil na chybu.', 'detail': str(e)[:200]}, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/chat/sessions")
def chat_sessions() -> list[dict]:
    return assistant.sessions()


@router.get("/chat/sessions/{sid}")
def chat_session(sid: str) -> list[dict]:
    return assistant.session_messages(sid)


@router.delete("/chat/sessions/{sid}")
def chat_delete(sid: str) -> dict:
    assistant.delete_session(sid)
    return {"ok": True}


@router.post("/ai/route")
def route_preview(req: ChatRequest) -> dict:
    cloud = providers.pick("cloud") is not None
    r = ai_router.decide(req.message, cloud, prefs.get("ai")["policy"])
    return {"intent": r.intent, "complexity": r.complexity, "tier": r.tier, "reason": r.reason, "scores": r.scores}


def _provider_row(r: ModelProvider) -> dict:
    key = decrypt(r.api_key_enc)
    return {"id": r.id, "name": r.name, "kind": r.kind, "base_url": r.base_url, "model": r.model, "tier": r.tier, "enabled": r.enabled,
            "is_default": r.is_default, "temperature": r.temperature, "max_tokens": r.max_tokens, "has_key": bool(key), "key_hint": mask(key)}


class ProviderIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str = Field(pattern="^(openai|gemini)$")
    base_url: str = Field(default="", max_length=300)
    model: str = Field(min_length=1, max_length=200)
    tier: str = Field(default="local", pattern="^(local|cloud)$")
    enabled: bool = True
    is_default: bool = False
    temperature: float = Field(default=0.2, ge=0, le=1.5)
    max_tokens: int = Field(default=900, ge=64, le=8192)
    api_key: str | None = Field(default=None, max_length=300)


def _clear_default(s, tier: str, keep: int | None) -> None:
    for r in s.scalars(select(ModelProvider).where(ModelProvider.tier == tier, ModelProvider.is_default.is_(True))):
        if r.id != keep:
            r.is_default = False


@router.get("/ai/providers")
def list_providers() -> list[dict]:
    with session_scope() as s:
        return [_provider_row(r) for r in s.scalars(select(ModelProvider).order_by(ModelProvider.tier, ModelProvider.id))]


@router.post("/ai/providers")
def create_provider(p: ProviderIn, request: Request) -> dict:
    if not write_limiter.allow(request.client.host if request.client else "?"):
        raise HTTPException(429)
    if p.kind == "openai" and not p.base_url.startswith(("http://", "https://")):
        raise HTTPException(400, "Zadejte adresu serveru (http://… nebo https://…)")
    with session_scope() as s:
        row = ModelProvider(**p.model_dump(exclude={"api_key"}), api_key_enc=encrypt(p.api_key or ""))
        s.add(row)
        s.flush()
        if p.is_default:
            _clear_default(s, p.tier, row.id)
        return _provider_row(row)


@router.put("/ai/providers/{pid}")
def update_provider(pid: int, p: ProviderIn) -> dict:
    with session_scope() as s:
        row = s.get(ModelProvider, pid)
        if row is None:
            raise HTTPException(404)
        for k, v in p.model_dump(exclude={"api_key"}).items():
            setattr(row, k, v)
        if p.api_key is not None:
            row.api_key_enc = encrypt(p.api_key) if p.api_key else ""
        if p.is_default:
            _clear_default(s, p.tier, row.id)
        return _provider_row(row)


@router.delete("/ai/providers/{pid}")
def delete_provider(pid: int) -> dict:
    with session_scope() as s:
        row = s.get(ModelProvider, pid)
        if row is None:
            raise HTTPException(404)
        s.delete(row)
    return {"ok": True}


@router.post("/ai/providers/{pid}/test")
def test_provider(pid: int) -> dict:
    with session_scope() as s:
        row = s.get(ModelProvider, pid)
        if row is None:
            raise HTTPException(404)
        prov = providers._row_to_provider(row)
    health = prov.check()
    if health["ok"]:
        try:
            import time
            t = time.perf_counter()
            text = prov.complete([{"role": "user", "content": "Odpověz jedním slovem: funguješ?"}], max_tokens=12, timeout=60)
            health["sample"] = text[:80]
            health["reply_ms"] = round((time.perf_counter() - t) * 1000)
        except Exception as e:
            health["ok"] = False
            health["error"] = str(e)[:200]
    return health


@router.get("/ai/status")
def ai_status() -> dict:
    out = []
    for p in providers.providers():
        h = p.check() if p.tier == "local" else {"ok": bool(p.api_key), "models": [], "error": "" if p.api_key else "chybí klíč"}
        out.append({"name": p.name, "tier": p.tier, "model": p.model, **{k: h.get(k) for k in ("ok", "ms", "error", "model_loaded")}})
    return {"providers": out, "policy": prefs.get("ai")["policy"], "rag": rag.stats()}


@router.get("/settings")
def get_settings() -> dict:
    return prefs.all_settings()


@router.put("/settings/{section}")
def put_settings(section: str, values: dict) -> dict:
    try:
        return prefs.update(section, values)
    except KeyError as e:
        raise HTTPException(404, "Neznámá sekce") from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
