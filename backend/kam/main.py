"""KAM application server.

Serves the JSON API under /api and the built single-page frontend for every
other path. Startup is instant: heavy warm-ups (simulation cache, local model
load, missing embeddings, scheduled catalogue refresh) run on a background
thread so the first request never waits for them.
"""

from __future__ import annotations

import base64
import logging
import secrets
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__, prefs
from .config import ROOT, settings
from .db import init_db

log = logging.getLogger("kam")
DIST = ROOT / "frontend" / "dist"

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")


def _warm() -> None:
    from .ai import assistant, providers, rag
    from .analytics import simulate, store
    try:
        rag.reload()
        store.territories()
        if store.territories():
            from .analytics import risks
            risks.ranking("obec", 86, 50)  # every obec's risks, so the first overview is instant
            n = simulate.precompute()
            log.info("Rizika a simulační cache předpočítány (%s scénářů)", n)
        assistant.purge_old()
    except Exception as e:
        log.warning("Zahřívání selhalo: %s", e)
    local = providers.pick("local")
    if local is not None:
        try:
            # First request to LM Studio loads the model (~20 s); do it now, not on the user's first question.
            local.complete([{"role": "user", "content": "ok"}], max_tokens=1, timeout=90)
            log.info("Lokální model připraven: %s", local.model)
        except Exception as e:
            log.info("Lokální model zatím nedostupný: %s", e)
    try:
        if rag.stats()["vector_coverage"] < 0.99:
            rag.embed_pending()
    except Exception as e:
        log.info("Embedding přeskočen: %s", e)


def _scheduler() -> None:
    while True:
        cfg = prefs.get("data")
        time.sleep(max(1, cfg["refresh_hours"]) * 3600)
        if not prefs.get("data")["auto_refresh"]:
            continue
        try:
            from .ai import rag
            from .analytics import risks, simulate, store
            from .ingest import catalog, khk, link
            catalog.harvest()
            khk.ingest()
            link.link()
            store.reset()
            risks.reset()
            simulate.reset()
            rag.build_index(embed=True)
            log.info("Plánovaná aktualizace dat dokončena")
        except Exception as e:
            log.warning("Plánovaná aktualizace selhala: %s", e)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    from .ai.providers import seed_defaults
    seed_defaults()
    if settings.background_jobs:
        threading.Thread(target=_warm, name="kam-warm", daemon=True).start()
        threading.Thread(target=_scheduler, name="kam-refresh", daemon=True).start()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="KAM — Krajský analytický model", version=__version__, lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.add_middleware(GZipMiddleware, minimum_size=1200)

    if settings.auth_password:
        @app.middleware("http")
        async def gate(request: Request, call_next):
            """HTTP Basic over the whole site when KAM_AUTH_PASSWORD is set.

            One shared password, because the deployment is a demo behind a link
            and not a service with accounts. `/api/health` stays open so the
            hosting platform can probe the container without credentials.
            """
            if request.url.path == "/api/health":
                return await call_next(request)
            header = request.headers.get("authorization", "")
            if header.startswith("Basic "):
                try:
                    user, _, password = base64.b64decode(header[6:]).decode("utf-8").partition(":")
                except (ValueError, UnicodeDecodeError):
                    user = password = ""
                # compare_digest on both halves: a plain == leaks the password
                # one character at a time to anyone who can time the response.
                if secrets.compare_digest(user, settings.auth_user) and secrets.compare_digest(password, settings.auth_password):
                    return await call_next(request)
            return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="KAM", charset="UTF-8"'})

    @app.middleware("http")
    async def headers(request: Request, call_next):
        response: Response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        response.headers.setdefault("X-Frame-Options", "DENY")
        if not request.url.path.startswith("/api/docs"):
            response.headers.setdefault("Content-Security-Policy", CSP)
        return response

    from .api import ai, data, model, reports
    for r in (data.router, model.router, ai.router, reports.router):
        app.include_router(r)

    @app.exception_handler(Exception)
    async def unhandled(_request: Request, exc: Exception):
        log.exception("Neošetřená chyba: %s", exc)
        return JSONResponse({"detail": "Interní chyba serveru."}, status_code=500)

    if (DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse({"detail": "Nenalezeno"}, status_code=404)
        target = (DIST / path).resolve()
        if path and target.is_file() and DIST.resolve() in target.parents:
            return FileResponse(target, headers={"Cache-Control": "public, max-age=86400"})
        index = DIST / "index.html"
        if index.is_file():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return JSONResponse({"detail": "Frontend není sestaven. Spusťte start skript nebo `npm run build` ve složce frontend."}, status_code=503)

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S")
app = create_app()


def run() -> None:  # pragma: no cover - entry point
    import uvicorn
    uvicorn.run("kam.main:app", host=settings.host, port=settings.port, log_level="info", app_dir=str(Path(__file__).resolve().parents[1]))
