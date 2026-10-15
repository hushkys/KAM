"""Model providers behind one interface.

Two wire formats cover everything we need: the OpenAI-compatible one (LM
Studio, Ollama, llama.cpp, vLLM, OpenAI, OpenRouter…) and Google's Gemini REST
API. Providers are rows in `model_provider`, editable in the UI; the first
start seeds a local Gemma (LM Studio) and — if GEMINI_API_KEY is set — a
Gemini row.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Iterator
from dataclasses import dataclass

import httpx
from sqlalchemy import select

from ..config import settings
from ..db import session_scope
from ..models import ModelProvider
from ..security import decrypt, encrypt

THINK = re.compile(r"<think>.*?</think>", re.S)


@dataclass
class Provider:
    id: int
    name: str
    kind: str
    base_url: str
    model: str
    api_key: str
    tier: str
    temperature: float
    max_tokens: int

    # -- chat ---------------------------------------------------------------
    def stream(self, messages: list[dict], temperature: float | None = None, max_tokens: int | None = None, timeout: float = 120) -> Iterator[str]:
        if self.kind == "gemini":
            yield from self._gemini(messages, temperature, max_tokens, timeout)
        else:
            yield from self._openai(messages, temperature, max_tokens, timeout)

    def complete(self, messages: list[dict], temperature: float | None = None, max_tokens: int | None = None, timeout: float = 60) -> str:
        return THINK.sub("", "".join(self.stream(messages, temperature, max_tokens, timeout))).strip()

    @property
    def is_local_server(self) -> bool:
        return any(h in self.base_url for h in ("localhost", "127.0.0.1", "0.0.0.0", "[::1]"))

    def _openai(self, messages, temperature, max_tokens, timeout) -> Iterator[str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        body: dict = {"model": self.model, "messages": messages, "stream": True,
                      "temperature": self.temperature if temperature is None else temperature,
                      "max_tokens": max_tokens or self.max_tokens}
        if self.is_local_server:
            # Reasoning models (Gemma 4, Qwen 3…) otherwise spend the whole
            # token budget thinking in `reasoning_content` and never answer;
            # measured on Gemma 4 E4B: empty answer after 43 s vs. first word
            # after 8 s with thinking off. Servers that do not know the field
            # reject it, so we retry once without it.
            body["reasoning_effort"] = "none"
        url = self.base_url.rstrip("/") + "/chat/completions"
        yield from self._openai_stream(url, body, headers, timeout, retry=self.is_local_server)

    def _openai_stream(self, url: str, body: dict, headers: dict, timeout: float, retry: bool) -> Iterator[str]:
        in_think = False
        reasoning = 0
        produced = False
        with httpx.Client(timeout=httpx.Timeout(timeout, connect=4.0)) as c, c.stream("POST", url, json=body, headers=headers) as r:
            if r.status_code >= 400:
                r.read()
                if retry and r.status_code in (400, 422) and "reasoning_effort" in body:
                    rest = {k: v for k, v in body.items() if k != "reasoning_effort"}
                    yield from self._openai_stream(url, rest, headers, timeout, retry=False)
                    return
                raise RuntimeError(f"{self.name}: HTTP {r.status_code} {r.text[:200]}")
            for line in r.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    delta = json.loads(data)["choices"][0].get("delta") or {}
                except (ValueError, KeyError, IndexError):
                    continue
                reasoning += len(delta.get("reasoning_content") or delta.get("reasoning") or "")
                piece = delta.get("content") or ""
                if not piece:
                    continue
                produced = True
                # Reasoning models sometimes inline their scratchpad; the user never sees it.
                if "<think>" in piece:
                    in_think = True
                    piece = piece.split("<think>", 1)[0]
                if in_think:
                    if "</think>" in piece:
                        in_think = False
                        piece = piece.split("</think>", 1)[1]
                    else:
                        continue
                if piece:
                    yield piece
        if not produced and reasoning:
            # Out of budget while still thinking: say so, so the caller falls back.
            raise RuntimeError(f"{self.name}: model vyčerpal limit tokenů přemýšlením")

    # Strop výstupu u cloudu: odpověď má mít kolem 150 slov, ale model
    # s 1 400 tokeny se rád rozepíše, a limity bezplatných klíčů se počítají
    # na tokeny i na dotazy.
    GEMINI_MAX_VYSTUP = 700

    def _klice(self) -> list[str]:
        """Klíče podle toho, který se dá použít: ty, které právě nevyčerpaly
        limit, napřed. Pořadí v nastavení se jinak drží."""
        vse: list[str] = []
        for k in [*settings.gemini_api_keys, self.api_key]:
            if k and k not in vse:
                vse.append(k)
        ted = time.time()
        return sorted(vse, key=lambda k: KLIC_DO.get(k, 0) > ted)

    @staticmethod
    def _vertex(klic: str) -> bool:
        # Klíče „AQ.…“ jsou klíče Vertex AI (Google Cloud); „AIza…“ jsou z AI Studia.
        return klic.startswith("AQ.")

    def _gemini(self, messages, temperature, max_tokens, timeout) -> Iterator[str]:
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                    for m in messages if m["role"] != "system"]
        body: dict = {"contents": contents, "generationConfig": {
            "temperature": self.temperature if temperature is None else temperature, "maxOutputTokens": min(max_tokens or self.max_tokens, self.GEMINI_MAX_VYSTUP),
            # The same reason the local servers get reasoning_effort "none":
            # Gemini 3.x flash spends the whole output budget thinking and the
            # answer arrives truncated mid-sentence. Measured on
            # gemini-3.5-flash: "Královéhradecký kraj je jeden" after 2.7 s
            # with thinking on, a complete sentence after 1.3 s with it off.
            # Models that do not know the field reject it, so we retry once.
            "thinkingConfig": {"thinkingBudget": 0}}}
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        base = self.base_url.rstrip("/") or "https://generativelanguage.googleapis.com/v1beta"
        posledni: Exception | None = None
        for klic in self._klice():
            url = (f"https://aiplatform.googleapis.com/v1/publishers/google/models/{self.model}:streamGenerateContent"
                   if self._vertex(klic) else f"{base}/models/{self.model}:streamGenerateContent")
            try:
                yield from self._gemini_stream(url, body, timeout, retry=True, klic=klic)
                return
            except KlicVycerpan as e:
                posledni = e   # tenhle klíč je na chvíli mimo, zkusí se další
        raise RuntimeError(str(posledni) if posledni else f"{self.name}: žádný klíč k dispozici")

    # A shared model is busy sometimes: Gemini answers 503 "high demand" (or 429)
    # and the same request succeeds moments later. Two short waits are worth it
    # — without them the assistant drops to the no-model brief over a hiccup —
    # and the caller's own fallback still covers a real outage.
    BUSY_BACKOFF = (1.2, 3.0)

    def _gemini_stream(self, url: str, body: dict, timeout: float, retry: bool, busy: int = 0, klic: str = "") -> Iterator[str]:
        klic = klic or self.api_key
        params = {"alt": "sse", **({"key": klic} if self._vertex(klic) else {})}
        hlavicky = {} if self._vertex(klic) else {"x-goog-api-key": klic}
        with httpx.Client(timeout=httpx.Timeout(timeout, connect=5.0)) as c, c.stream(
            "POST", url, params=params, json=body, headers=hlavicky) as r:
            if r.status_code >= 400:
                r.read()
                # Limit, zrušený nebo nepovolený klíč: tenhle klíč se na chvíli
                # odloží a zkusí se další. Čekat s týmž klíčem nemá smysl.
                if r.status_code in (401, 403, 429):
                    KLIC_DO[klic] = time.time() + (90 if r.status_code == 429 else 900)
                    raise KlicVycerpan(f"{self.name}: HTTP {r.status_code} {r.text[:160]}")
                if retry and r.status_code == 400 and "thinkingConfig" in body.get("generationConfig", {}):
                    cfg = {k: v for k, v in body["generationConfig"].items() if k != "thinkingConfig"}
                    yield from self._gemini_stream(url, {**body, "generationConfig": cfg}, timeout, retry=False, klic=klic)
                    return
                if r.status_code in (429, 503) and busy < len(self.BUSY_BACKOFF):
                    time.sleep(self.BUSY_BACKOFF[busy])
                    yield from self._gemini_stream(url, body, timeout, retry, busy + 1, klic)
                    return
                raise RuntimeError(f"{self.name}: HTTP {r.status_code} {r.text[:200]}")
            for line in r.iter_lines():
                if not line.startswith("data:"):
                    continue
                try:
                    cand = json.loads(line[5:])["candidates"][0]
                except (ValueError, KeyError, IndexError):
                    continue
                for part in (cand.get("content") or {}).get("parts", []):
                    if part.get("text") and not part.get("thought"):
                        yield part["text"]

    # -- health -------------------------------------------------------------
    def check(self) -> dict:
        t = time.perf_counter()
        try:
            if self.kind == "gemini":
                base = self.base_url.rstrip("/") or "https://generativelanguage.googleapis.com/v1beta"
                klice = self._klice() or [self.api_key]
                chyba = ""
                for k in klice:
                    if self._vertex(k):
                        r = httpx.get(f"https://aiplatform.googleapis.com/v1/publishers/google/models/{self.model}", params={"key": k}, timeout=6)
                    else:
                        r = httpx.get(f"{base}/models/{self.model}", headers={"x-goog-api-key": k}, timeout=6)
                    if r.status_code == 200:
                        break
                ok = r.status_code == 200
                models = [self.model] if ok else []
            else:
                headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
                r = httpx.get(self.base_url.rstrip("/") + "/models", headers=headers, timeout=4)
                ok = r.status_code == 200
                models = [m.get("id") for m in r.json().get("data", [])] if ok else []
            return {"ok": ok, "ms": round((time.perf_counter() - t) * 1000), "models": models,
                    "model_loaded": self.model in models if models else None, "error": "" if ok else f"HTTP {r.status_code}"}
        except Exception as e:
            return {"ok": False, "ms": round((time.perf_counter() - t) * 1000), "models": [], "model_loaded": None, "error": str(e)[:200]}


class KlicVycerpan(RuntimeError):
    """Klíč k Gemini je na chvíli (nebo napořád) nepoužitelný — limit, zrušení, nepovolené API."""


# Do kdy se který klíč nepoužívá (unixový čas); drží se v paměti procesu.
KLIC_DO: dict[str, float] = {}


def _row_to_provider(r: ModelProvider) -> Provider:
    key = decrypt(r.api_key_enc)
    if r.kind == "gemini" and settings.gemini_api_keys:
        # Klíče z prostředí mají přednost před uloženým: uložený zašifroval
        # jiný klíč (jiný stroj) nebo už byl zrušen.
        key = settings.gemini_api_keys[0]
    return Provider(r.id, r.name, r.kind, r.base_url, r.model, key, r.tier, r.temperature, r.max_tokens)


def seed_defaults() -> None:
    """Seed the rows a fresh install needs, and only those.

    Runs on every start, not just the first one: a GEMINI_API_KEY added to
    `.env` after the database already existed would otherwise never produce a
    cloud provider, and the router would stay local forever with no hint why.
    An existing cloud row is left alone — it may have been edited in the UI.
    """
    with session_scope() as s:
        if s.scalar(select(ModelProvider.id).where(ModelProvider.tier == "local").limit(1)) is None:
            s.add(ModelProvider(name="Gemma 4 (LM Studio)", kind="openai", base_url=settings.local_llm_url, model=settings.local_chat_model,
                                tier="local", enabled=True, is_default=True, temperature=0.2, max_tokens=900))
        if not settings.gemini_api_keys:
            return
        row = s.scalar(select(ModelProvider).where(ModelProvider.kind == "gemini").order_by(ModelProvider.id))
        if row is None:
            s.add(ModelProvider(name=f"Gemini ({settings.gemini_model})", kind="gemini", base_url="https://generativelanguage.googleapis.com/v1beta",
                                model=settings.gemini_model, api_key_enc=encrypt(settings.gemini_api_key),
                                tier="cloud", enabled=True, is_default=True, temperature=0.2, max_tokens=1400))
        elif not row.api_key_enc and not row.enabled:
            # A placeholder seeded before any key existed. Adopt it rather than
            # adding a second Gemini row; a row somebody configured in the UI
            # (its own key, or deliberately switched off) is never touched.
            row.model = settings.gemini_model
            row.name = f"Gemini ({settings.gemini_model})"
            row.api_key_enc = encrypt(settings.gemini_api_key)
            row.enabled = True


def providers(enabled_only: bool = True) -> list[Provider]:
    with session_scope() as s:
        q = select(ModelProvider)
        if enabled_only:
            q = q.where(ModelProvider.enabled.is_(True))
        rows = s.scalars(q.order_by(ModelProvider.is_default.desc(), ModelProvider.id)).all()
        out = [_row_to_provider(r) for r in rows]
    return [p for p in out if p.kind != "gemini" or p.api_key]


def pick(tier: str) -> Provider | None:
    for p in providers():
        if p.tier == tier:
            return p
    return None


def embed(texts: list[str], timeout: float = 120) -> list[list[float]]:
    """Embeddings from the local server (nomic-embed-text by default)."""
    url = settings.local_llm_url.rstrip("/") + "/embeddings"
    r = httpx.post(url, json={"model": settings.embed_model, "input": texts}, timeout=timeout)
    r.raise_for_status()
    data = sorted(r.json()["data"], key=lambda d: d["index"])
    return [d["embedding"] for d in data]
