"""Server-side settings: AI data policy, chat history, where reports go.

Visual preferences live in the browser (they are per person and must apply
before the first paint); these live on the server because they decide what
leaves the machine. Every write is validated against the defaults' shape,
and a webhook target must resolve to a public address (no SSRF into the
local network).
"""

from __future__ import annotations

import copy
import ipaddress
import socket
from urllib.parse import urlparse

from .db import session_scope
from .models import AppSetting

DEFAULTS: dict[str, dict] = {
    "ai": {"policy": "hybrid", "router_mode": "heuristic", "history": True, "retention_days": 30, "max_sources": 6, "answer_length": "stredni"},
    "destinations": {"reports_target": "local", "webhook_url": "", "email": "", "threshold": 5, "auto_submit": False},
    "data": {"auto_refresh": True, "refresh_hours": 24},
}

CHOICES = {
    ("ai", "policy"): {"local_only", "hybrid", "cloud_preferred"},
    ("ai", "router_mode"): {"heuristic", "model"},
    ("ai", "answer_length"): {"kratka", "stredni", "podrobna"},
    ("destinations", "reports_target"): {"local", "webhook", "email"},
}
RANGES = {("ai", "retention_days"): (1, 365), ("ai", "max_sources"): (2, 12), ("destinations", "threshold"): (2, 50), ("data", "refresh_hours"): (1, 168)}


def get(section: str) -> dict:
    base = copy.deepcopy(DEFAULTS.get(section, {}))
    with session_scope() as s:
        row = s.get(AppSetting, section)
        if row and isinstance(row.value, dict):
            base.update({k: v for k, v in row.value.items() if k in base})
    return base


def all_settings() -> dict:
    return {k: get(k) for k in DEFAULTS}


def assert_safe_url(url: str) -> None:
    p = urlparse(url)
    if p.scheme != "https" or not p.hostname:
        raise ValueError("Adresa musí začínat https://")
    try:
        infos = socket.getaddrinfo(p.hostname, None)
    except socket.gaierror as e:
        raise ValueError("Adresu nelze přeložit.") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ValueError("Adresa míří do vnitřní sítě.")


def update(section: str, values: dict) -> dict:
    if section not in DEFAULTS:
        raise KeyError(section)
    current = get(section)
    for key, value in values.items():
        if key not in current:
            continue
        default = DEFAULTS[section][key]
        if (section, key) in CHOICES and value not in CHOICES[(section, key)]:
            raise ValueError(f"Neplatná hodnota {key}")
        if isinstance(default, bool):
            value = bool(value)
        elif isinstance(default, int):
            lo, hi = RANGES.get((section, key), (-10**9, 10**9))
            value = max(lo, min(hi, int(value)))
        elif isinstance(default, str):
            value = str(value).strip()[:300]
            if key == "webhook_url" and value:
                assert_safe_url(value)
            if key == "email" and value and "@" not in value:
                raise ValueError("Neplatný e-mail")
        current[key] = value
    with session_scope() as s:
        s.merge(AppSetting(key=section, value=current))
    return current
