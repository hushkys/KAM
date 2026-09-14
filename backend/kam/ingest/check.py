"""Link check: is each catalogued dataset actually reachable?

For every dataset we test the most concrete link it has — the download URL,
else the publisher's landing page, else the portal page (NKOD's own page is
skipped: it is a single-page app that answers 200 for anything, so it
proves nothing). A HEAD request first; servers that refuse HEAD get a GET
whose body is never read. 2xx and 3xx count as reachable. A server with a
broken certificate chain that still serves the file counts as reachable —
a browser user can open it — and the result says so in the code (-1).

Politeness: at most 6 concurrent requests per host, 48 overall, each URL
checked once however many datasets share it.
"""

from __future__ import annotations

import asyncio
import ssl
from collections import defaultdict
from urllib.parse import urlparse

import httpx
from sqlalchemy import select, update

from ..db import session_scope
from ..models import Dataset, now
from .common import USER_AGENT, job

PER_HOST = 6
GLOBAL = 48
TIMEOUT = httpx.Timeout(15.0, connect=8.0)


def target(d: Dataset) -> str:
    for u in (d.download_url, d.landing_url, d.alt_url, d.url):
        if u and u.startswith(("http://", "https://")) and "data.gov.cz/datová-sada" not in u and "data.gov.cz/datov%C3%A1-sada" not in u:
            return u.split("#")[0]
    return ""


async def _probe(client: httpx.AsyncClient, insecure: httpx.AsyncClient, url: str) -> int:
    for c in (client, insecure):
        try:
            r = await c.head(url)
            if r.status_code in (400, 403, 405, 406, 429, 500, 501) or r.status_code >= 500:
                async with c.stream("GET", url, headers={"Range": "bytes=0-0"}) as g:
                    return g.status_code if c is client else (-1 if g.status_code < 400 else g.status_code)
            return r.status_code if c is client else (-1 if r.status_code < 400 else r.status_code)
        except (httpx.ConnectError, ssl.SSLError) as e:
            if c is client and "CERTIFICATE" in str(e).upper():
                continue
            return 0
        except (httpx.TimeoutException, httpx.HTTPError):
            return 0
    return 0


async def _run(urls: list[str], progress) -> dict[str, int]:
    results: dict[str, int] = {}
    host_sem: dict[str, asyncio.Semaphore] = defaultdict(lambda: asyncio.Semaphore(PER_HOST))
    gsem = asyncio.Semaphore(GLOBAL)
    limits = httpx.Limits(max_connections=GLOBAL, max_keepalive_connections=GLOBAL)
    headers = {"User-Agent": USER_AGENT}
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True, limits=limits, headers=headers) as client, \
            httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True, limits=limits, headers=headers, verify=False) as insecure:
        done = 0

        async def one(u: str):
            nonlocal done
            async with gsem, host_sem[urlparse(u).netloc]:
                results[u] = await _probe(client, insecure, u)
            done += 1
            if done % 250 == 0:
                progress(done, len(urls))

        await asyncio.gather(*(one(u) for u in urls))
    return results


def check(only_unchecked: bool = False, limit: int | None = None) -> dict[str, int]:
    job("check", "running", "Ověřuji dostupnost odkazů")
    with session_scope() as s:
        q = select(Dataset)
        if only_unchecked:
            q = q.where(Dataset.check_status == "neovereno")
        rows = [(d.id, target(d)) for d in s.scalars(q)]
    if limit:
        rows = rows[:limit]
    urls = sorted({u for _, u in rows if u})
    results = asyncio.run(_run(urls, lambda d, t: job("check", "running", f"Ověřeno {d}/{t} odkazů", d / max(t, 1))))
    stats = {"ok": 0, "chyba": 0, "bez_odkazu": 0}
    updates = []
    ts = now()
    for i, u in rows:
        if not u:
            status, code = "bez_odkazu", 0
        else:
            code = results.get(u, 0)
            status = "ok" if code == -1 or 200 <= code < 400 else "chyba"
        stats[status] += 1
        updates.append({"id": i, "check_status": status, "check_code": code, "checked_at": ts})
    with session_scope() as s:
        for k in range(0, len(updates), 2000):
            s.execute(update(Dataset), updates[k:k + 2000])
    stats["urls"] = len(urls)
    job("check", "done", str(stats), 1.0)
    return stats
