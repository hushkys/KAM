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
    gemini_api_key: str = os.environ.get("GEMINI_API_KEY", "")
    gemini_model: str = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

    mos_first_year: int = _int("KAM_MOS_FIRST_YEAR", 2005)
    mos_last_year: int = _int("KAM_MOS_LAST_YEAR", 2025)

    # Background jobs (catalogue refresh, embeddings). Off in tests.
    background_jobs: bool = os.environ.get("KAM_BACKGROUND", "1") != "0"

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
