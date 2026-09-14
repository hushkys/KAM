"""Shared helpers for harvesters: HTTP with retries and job bookkeeping."""

from __future__ import annotations

import logging
import time
import unicodedata
from typing import Any

import httpx

from ..db import session_scope
from ..models import JobState, now

log = logging.getLogger("kam.ingest")

USER_AGENT = "KAM-Krajsky-analyticky-model/1.0 (+hackathon KHK; open data harvester)"


def client(timeout: float = 120) -> httpx.Client:
    return httpx.Client(timeout=timeout, follow_redirects=True, headers={"User-Agent": USER_AGENT})


def get_json(c: httpx.Client, url: str, params: dict[str, Any] | None = None, tries: int = 4, headers: dict | None = None) -> Any:
    last: Exception | None = None
    for attempt in range(tries):
        try:
            r = c.get(url, params=params, headers=headers)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # network hiccups on public endpoints are normal
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET {url} selhal: {last}")


def norm(text: str) -> str:
    """Lowercase, strip diacritics — Czech users type without háčky."""
    t = unicodedata.normalize("NFKD", text or "")
    return "".join(ch for ch in t if not unicodedata.combining(ch)).lower().strip()


def job(name: str, status: str, detail: str = "", progress: float = 0.0) -> None:
    with session_scope() as s:
        row = s.get(JobState, name) or JobState(name=name)
        row.status, row.detail, row.progress, row.updated_at = status, detail[:2000], progress, now()
        s.merge(row)
    log.info("[%s] %s %s", name, status, detail)
