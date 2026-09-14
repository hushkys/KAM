"""Query router — which intent, which tools, which model tier.

The routing decision is deterministic and takes microseconds: keyword
evidence on unaccented text decides the intent, and intent plus length and
"analytical" verbs decide complexity. Simple questions go to the local model;
complex analysis, synthesis and scenario explanation go to the cloud model
when one is configured *and* the data policy allows it. With `router_mode =
model` and a cloud model available, a small classification call can refine
the decision (bounded by a short timeout, heuristic as the fallback).
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field

INTENT_RULES: dict[str, tuple[str, ...]] = {
    "SCENARIO": ("co kdyby", "co se stane", "kdyz postavime", "kdyz pridame", "simul", "scenar", "zasah", "postavime", "pridame", "rozsirime", "otevreme"),
    "FORECAST": ("predikc", "vyhled", "prognoz", "2030", "2035", "2040", "budouc", "kam smeruje", "bude za", "vyvoj do"),
    "WHY": ("proc", "z jakeho duvodu", "cim to", "vysvetli", "jak to vite", "na cem stoji", "zdrojem"),
    "COMPARE": ("porovn", "srovn", "rozdil mezi", "oproti", "versus", " vs "),
    "TREND": ("trend", "vyvoj", "roste", "klesa", "zhorsuje", "zlepsuje", "za poslednich", "od roku", "vykyv"),
    "DATA": ("datov", "dataset", "sady", "zdroj dat", "otevren", "jaka data", "katalog", "nkod", "odkaz na data"),
    "FACT": ("kolik", "jaky je", "jaka je", "pocet", "podil", "mira", "hodnota"),
    "RISK": ("rizik", "problem", "hrozi", "ohrozen", "slabin", "pozornost"),
    "HELP": ("jak pouzit", "jak funguje", "napoveda", "co umis", "ovladani", "kde najdu", "jak nastavit"),
}

COMPLEX_MARKERS = ("analyz", "doporuc", "navrhni", "syntez", "zprav", "report", "strateg", "optimaliz", "rozpocet", "prioritiz", "komplexn", "podrobn", "detailn")


@dataclass
class Route:
    intent: str
    complexity: str
    tier: str
    reason: str
    scores: dict = field(default_factory=dict)


def _plain(text: str) -> str:
    t = unicodedata.normalize("NFKD", text)
    return " " + "".join(ch for ch in t if not unicodedata.combining(ch)).lower() + " "


def classify(query: str) -> tuple[str, dict[str, int]]:
    q = _plain(query)
    scores = {k: sum(1 for w in words if w in q) for k, words in INTENT_RULES.items()}
    if re.search(r"\d+\s*(bytu|byty|mist|luzek|spoju|zastav|ordinac|pracovnich)", q):
        scores["SCENARIO"] += 2
    best = max(scores, key=lambda k: scores[k])
    return (best if scores[best] > 0 else "GENERAL"), scores


def decide(query: str, cloud_available: bool, policy: str = "hybrid") -> Route:
    intent, scores = classify(query)
    q = _plain(query)
    words = len(query.split())
    multi = sum(1 for v in scores.values() if v) >= 3
    complex_ = (intent in ("SCENARIO", "WHY", "COMPARE") and words > 12) or words > 45 or multi or any(m in q for m in COMPLEX_MARKERS)
    complexity = "slozity" if complex_ else "jednoduchy"
    if policy == "local_only" or not cloud_available:
        tier = "local"
        reason = "pouze lokální model (politika dat)" if policy == "local_only" else "cloudový model není nastaven"
    elif policy == "cloud_preferred":
        tier, reason = "cloud", "preferován cloudový model"
    else:
        tier = "cloud" if complex_ else "local"
        reason = "složitá analýza → cloud" if complex_ else "jednoduchý dotaz → lokální model"
    return Route(intent, complexity, tier, reason, scores)


def refine_with_model(query: str, route: Route, provider) -> Route:
    """Optional LLM refinement; any failure keeps the heuristic route."""
    try:
        text = provider.complete([
            {"role": "system", "content": "Klasifikuj dotaz. Odpověz jen JSON {\"slozitost\":\"jednoduchy|slozity\"}. "
                                          "Složitý = vícekroková analýza, syntéza, doporučení, scénář s vysvětlením."},
            {"role": "user", "content": query[:600]},
        ], temperature=0, max_tokens=20, timeout=4)
        data = json.loads(text[text.find("{"): text.rfind("}") + 1])
        if data.get("slozitost") in ("jednoduchy", "slozity"):
            route.complexity = data["slozitost"]
            route.tier = "cloud" if data["slozitost"] == "slozity" else "local"
            route.reason = f"router model: {data['slozitost']}"
    except Exception:
        pass
    return route
