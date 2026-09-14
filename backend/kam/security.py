"""Secrets at rest and small request-level protections.

API keys typed into Nastavení → Modely are Fernet-encrypted with a key that
lives in a file next to the database (`data/secret.key`), not in the database
itself — a copied database alone does not leak a key. Keys are never sent
back to the browser; the UI only sees whether one is set and its last four
characters.
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

from cryptography.fernet import Fernet, InvalidToken

from .config import settings

_fernet: Fernet | None = None


def _box() -> Fernet:
    global _fernet
    if _fernet is None:
        # A container has no disk that survives a deploy, so the key can also
        # come from the environment. Without it a redeploy would generate a new
        # one and every API key stored in the database would stop decrypting.
        if settings.secret_key:
            _fernet = Fernet(settings.secret_key.encode())
            return _fernet
        path = settings.data_dir / "secret.key"
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        if not path.is_file():
            path.write_bytes(Fernet.generate_key())
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
        _fernet = Fernet(path.read_bytes().strip())
    return _fernet


def encrypt(value: str) -> str:
    return _box().encrypt(value.encode()).decode() if value else ""


def decrypt(value: str) -> str:
    if not value:
        return ""
    try:
        return _box().decrypt(value.encode()).decode()
    except InvalidToken:
        return ""


def mask(value: str) -> str:
    return f"••••{value[-4:]}" if value else ""


class RateLimiter:
    """Sliding-window limiter per client key (IP). In-process by design:
    one instance per worker is enough for a single-node deployment; a
    multi-node one would move this to Redis."""

    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True


chat_limiter = RateLimiter(limit=20, window=60)
write_limiter = RateLimiter(limit=30, window=60)
