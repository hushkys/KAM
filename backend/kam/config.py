"""Runtime configuration.

Everything is read from the environment (optionally seeded from a `.env` file in
the project root) so the same code runs on a laptop with SQLite and LM Studio and
on a server with PostgreSQL and a cloud model. Nothing here is a secret by
default; API keys entered in the UI live encrypted in the database instead
(see `kam.security`), never in this module.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv(path: Path) -> None:
    # A tiny parser instead of python-dotenv: KEY=VALUE lines, # comments,
    # optional quotes. Real environment variables always win.
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


_load_dotenv(ROOT / ".env")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _klice_gemini() -> list[str]:
    surove = os.environ.get("GEMINI_API_KEY", "") + "," + os.environ.get("GEMINI_API_KEYS", "")
    out: list[str] = []
    for k in surove.replace("\n", ",").replace(";", ",").split(","):
        k = k.strip().strip("\"'")
        if k and k not in out:
            out.append(k)
    return out


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("KAM_DATA_DIR", ROOT / "data")))
    database_url: str = os.environ.get("DATABASE_URL", "")
    host: str = os.environ.get("KAM_HOST", "127.0.0.1")
    port: int = _int("KAM_PORT", 8000)

    # Local model server (LM Studio, Ollama, llama.cpp — anything OpenAI-compatible).
    local_llm_url: str = os.environ.get("LOCAL_LLM_BASE_URL", "http://localhost:1234/v1")
    local_chat_model: str = os.environ.get("LOCAL_LLM_MODEL", "google/gemma-4-e4b")
    embed_model: str = os.environ.get("LOCAL_EMBED_MODEL", "text-embedding-nomic-embed-text-v1.5")

    # Cloud model. Empty key = cloud tier disabled, the router stays local.
    # Klíčů může být víc (GEMINI_API_KEYS, oddělené čárkou): když jednomu dojdou
    # limity, `ai/providers.py` přepne na další. GEMINI_API_KEY je první z nich.
    gemini_api_keys: list[str] = field(default_factory=lambda: _klice_gemini())
    gemini_api_key: str = field(default_factory=lambda: (_klice_gemini() or [""])[0])
    gemini_model: str = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    # OpenRouter (OpenAI-kompatibilní). Bezplatné modely jsou sdílené a občas
    # přetížené, proto se posílá celý seznam: OpenRouter zkusí další, když
    # první vrátí 429. Klíč bez kreditu umí jen modely s příponou :free.
    openrouter_api_key: str = os.environ.get("OPENROUTER_API_KEY", "")
    openrouter_models: list[str] = field(default_factory=lambda: [m.strip() for m in os.environ.get(
        "OPENROUTER_MODELS",
        "google/gemma-4-31b-it:free,dots-studio/dots-3-note-preview:free,nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-26b-a4b-it:free",
    ).split(",") if m.strip()])

    mos_first_year: int = _int("KAM_MOS_FIRST_YEAR", 2005)
    mos_last_year: int = _int("KAM_MOS_LAST_YEAR", 2025)

    # Background jobs (catalogue refresh, embeddings). Off in tests.
    background_jobs: bool = os.environ.get("KAM_BACKGROUND", "1") != "0"
    # Smí server obnovu dat spustit sám? S více procesy (uvicorn --workers)
    # má plánovač každý z nich a všechny by sklízely naráz; tam se obnova
    # pouští cronem jednou a server si ji jen všimne (KAM_OBNOVA_V_SERVERU=0).
    refresh_in_server: bool = os.environ.get("KAM_OBNOVA_V_SERVERU", "1") != "0"

    # Deployment. Aplikace je veřejná a žádné heslo nemá; Fernet klíč se
    # drží mimo disk, aby redeploy kontejneru nezneplatnil API klíče uložené
    # v databázi.
    secret_key: str = os.environ.get("KAM_SECRET_KEY", "")

    @property
    def db_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_dir / 'kam.db').as_posix()}"

    @property
    def geo_dir(self) -> Path:
        return self.data_dir / "geo"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"


settings = Settings()
