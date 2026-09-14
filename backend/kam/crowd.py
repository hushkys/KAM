"""Layer 3 — citizens' reports, clustered into formal submissions.

A single report is an observation, not a fact. Reports from the same obec
and area that share enough vocabulary join one cluster (Jaccard ≥ 0.18 on
stemmed terms); when a cluster reaches the configured threshold it becomes a
formal submission to the regional authority, generated from the cluster and
the obec's own data. Personal data is masked on the way in, exact repeats of
the same text within a day are refused (spam), and nothing here ever feeds
back into `Observation`.
"""

from __future__ import annotations

import hashlib
from collections import Counter
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import func, select

from . import prefs
from .ai.guard import mask_pii
from .ai.rag import plain, tokens
from .analytics import store
from .db import session_scope
from .indicators import PILLARS
from .models import Cluster, Report, now

CATEGORIES = {**PILLARS, "bezpecnost": "Bezpečnost", "sluzby": "Služby a úřady", "jine": "Jiné"}
JOIN_THRESHOLD = 0.18


def _terms(text: str) -> list[str]:
    return [t for t in tokens(text) if len(t) >= 4]


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def _serialize(c: Cluster, reports: list[Report] | None = None) -> dict:
    t = store.territory(c.territory_id)
    out = {"id": c.id, "territory": {"id": c.territory_id, "name": t.name if t else c.territory_id}, "category": c.category,
           "category_label": CATEGORIES.get(c.category, c.category), "title": c.title, "count": c.count, "status": c.status,
           "reference": c.reference, "terms": c.terms[:8], "created_at": c.created_at.isoformat(), "updated_at": c.updated_at.isoformat(),
           "submitted_at": c.submitted_at.isoformat() if c.submitted_at else None, "channel": (c.submission or {}).get("channel")}
    if reports is not None:
        out["reports"] = [{"id": r.id, "text": r.text, "kind": r.kind, "created_at": r.created_at.isoformat()} for r in reports]
    return out


def submit(territory_id: str, category: str, text: str, kind: str = "problem") -> dict:
    if store.territory(territory_id) is None:
        raise ValueError("Neznámé území.")
    if category not in CATEGORIES:
        raise ValueError("Neznámá oblast.")
    text = mask_pii(" ".join((text or "").split()))
    if not 10 <= len(text) <= 1000:
        raise ValueError("Popis musí mít 10 až 1000 znaků.")
    kind = "chybejici_data" if kind == "chybejici_data" else "problem"
    fp = hashlib.sha256(f"{territory_id}|{plain(text)}".encode()).hexdigest()
    terms = _terms(text)
    cfg = prefs.get("destinations")
    with session_scope() as s:
        dup = s.scalar(select(Report.id).where(Report.fingerprint == fp, Report.created_at >= datetime.now(UTC) - timedelta(days=1)))
        if dup:
            raise ValueError("Stejný podnět už byl dnes zaznamenán.")
        candidates = s.scalars(select(Cluster).where(Cluster.territory_id == territory_id, Cluster.category == category, Cluster.status != "odeslano")).all()
        best, best_sim = None, 0.0
        for c in candidates:
            sim = _jaccard(set(terms), set(c.terms))
            if sim > best_sim:
                best, best_sim = c, sim
        if best is None or best_sim < JOIN_THRESHOLD:
            first = text.split(".")[0].strip()
            best = Cluster(territory_id=territory_id, category=category, title=(first[:90] + ("…" if len(first) > 90 else "")), terms=terms[:12], count=0)
            s.add(best)
            s.flush()
            joined = False
        else:
            joined = True
        r = Report(territory_id=territory_id, category=category, kind=kind, text=text, cluster_id=best.id, fingerprint=fp)
        s.add(r)
        best.count += 1
        all_terms = Counter(best.terms) + Counter(terms)
        best.terms = [t for t, _ in all_terms.most_common(12)]
        best.updated_at = now()
        became_ready = False
        if best.status == "sber" and best.count >= cfg["threshold"]:
            best.status = "pripraveno"
            best.reference = f"KAM-P-{datetime.now(UTC).year}-{best.id:05d}"
            became_ready = True
        cid, status = best.id, best.status
    result = {"report_id": r.id, "cluster_id": cid, "joined": joined, "similarity": round(best_sim, 2), "status": status, "became_ready": became_ready}
    if became_ready and cfg["auto_submit"]:
        try:
            deliver(cid)
            result["status"] = "odeslano"
        except Exception as e:  # delivery failure keeps the cluster ready for a manual retry
            result["delivery_error"] = str(e)[:200]
    return result


def document(cluster_id: int) -> dict:
    with session_scope() as s:
        c = s.get(Cluster, cluster_id)
        if c is None:
            raise KeyError(cluster_id)
        reports = s.scalars(select(Report).where(Report.cluster_id == cluster_id).order_by(Report.created_at)).all()
        data = _serialize(c, list(reports))
    t = store.territory(data["territory"]["id"])
    from .analytics.profile import card, reference
    context = []
    if t and data["category"] in PILLARS:
        from .analytics.profile import PROFILE_CODES
        ref = reference(t.id)
        for code in PROFILE_CODES[data["category"]][:4]:
            k = card(t.id, code, ref)
            if k:
                context.append({"name": k["name"], "value": k["value"], "unit": k["unit"], "year": k["year"], "trend": k["trend"].get("label"),
                                "compare": k.get("compare"), "source": k.get("source", "")})
    first = data["reports"][0]["created_at"][:10] if data["reports"] else ""
    last = data["reports"][-1]["created_at"][:10] if data["reports"] else ""
    body = (f"Věc: Souhrnný podnět občanů — {data['category_label']}, {data['territory']['name']}\n\n"
            f"Krajský analytický model KAM zaznamenal v období {first} až {last} celkem {data['count']} "
            f"obdobných podnětů obyvatel k tématu „{data['title']}“ v území {data['territory']['name']}. "
            "Podněty byly automaticky seskupeny podle obsahové podobnosti a anonymizovány.\n\n"
            "Předkládáme je jako formální vstup k posouzení příslušným odborem. Souhrn relevantních otevřených dat k území je přiložen; "
            "podněty samy o sobě nejsou ověřenými fakty a vyžadují prověření.")
    return {**data, "addressee": "Krajský úřad Královéhradeckého kraje", "body": body, "context": context,
            "generated_at": datetime.now(UTC).isoformat(), "note": "Dokument vygenerován aplikací KAM. Nejde o úřední dokument kraje."}


def deliver(cluster_id: int) -> dict:
    cfg = prefs.get("destinations")
    doc = document(cluster_id)
    if doc["status"] == "sber":
        raise ValueError("Podnět ještě nedosáhl prahu pro odeslání.")
    channel = cfg["reports_target"]
    info: dict = {"channel": channel}
    if channel == "webhook":
        if not cfg["webhook_url"]:
            raise ValueError("V nastavení chybí adresa webhooku.")
        prefs.assert_safe_url(cfg["webhook_url"])
        r = httpx.post(cfg["webhook_url"], json=doc, timeout=10)
        r.raise_for_status()
        info["status_code"] = r.status_code
    elif channel == "email":
        if not cfg["email"]:
            raise ValueError("V nastavení chybí e-mail příjemce.")
        info["mailto"] = cfg["email"]
    with session_scope() as s:
        c = s.get(Cluster, cluster_id)
        c.status = "odeslano"
        c.submitted_at = now()
        c.submission = info
    return {**info, "reference": doc["reference"]}


def clusters(territory_id: str | None = None, status: str | None = None, category: str | None = None, limit: int = 100) -> list[dict]:
    with session_scope() as s:
        q = select(Cluster)
        if territory_id:
            q = q.where(Cluster.territory_id == territory_id)
        if status:
            q = q.where(Cluster.status == status)
        if category:
            q = q.where(Cluster.category == category)
        rows = s.scalars(q.order_by(Cluster.count.desc(), Cluster.updated_at.desc()).limit(limit)).all()
        return [_serialize(c) for c in rows]


def stats() -> dict:
    with session_scope() as s:
        by_status = dict(s.execute(select(Cluster.status, func.count()).group_by(Cluster.status)).all())
        reports = s.scalar(select(func.count(Report.id))) or 0
        missing = s.scalar(select(func.count(Report.id)).where(Report.kind == "chybejici_data")) or 0
    return {"reports": reports, "clusters": sum(by_status.values()), "by_status": by_status, "missing_data_reports": missing,
            "threshold": prefs.get("destinations")["threshold"]}
