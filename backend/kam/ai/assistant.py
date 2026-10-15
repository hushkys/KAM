"""Chat orchestration: guard → commands → route → tools + retrieval → model.

Yields server-sent events:

- `meta`    route, model, territory and numbered sources (sent before the
            first token, so the UI can show them while the answer streams),
- `action`  an allow-listed app action, applied by the browser immediately,
- `token`   a piece of the answer,
- `done`    timings and final bookkeeping.

If no model answers (LM Studio closed, network down), the user still gets a
grounded reply assembled from the tool output, marked as such — the
assistant degrades to a report, never to silence.
"""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import Iterator

from sqlalchemy import delete, select

from .. import prefs
from ..analytics import store
from ..db import session_scope
from ..models import ChatMessage, ChatSession, now
from . import commands, guard, providers, rag, router, tools
from .prompts import system_prompt

AKCE = "AKCE:"


# Mezipaměť odpovědí. Při soutěži se stejné otázky ptá spousta lidí a každý
# dotaz stojí dotaz u Gemini, jehož limity jsou malé; odpověď na stejnou
# otázku nad stejnými daty se proto na chvíli drží. Jen u samostatné otázky
# (bez předchozí konverzace) a jen u odpovědi od modelu — záložní podklad
# a odpovědi, které něco ovládají, se neukládají.
_ODPOVEDI: dict[tuple, tuple[float, str, dict]] = {}
_ODPOVEDI_TTL = 20 * 60
_ODPOVEDI_MAX = 300


def _klic_odpovedi(zprava: str, terr_ids: list[str], delka: str, tier: str) -> tuple:
    return (" ".join(zprava.lower().split()), tuple(terr_ids), delka, tier)


def _history(session_id: str, limit: int = 4) -> list[dict]:
    with session_scope() as s:
        rows = s.scalars(select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.id.desc()).limit(limit)).all()
        return [{"role": r.role, "content": r.content[:1500]} for r in reversed(rows)]


def _save(session_id: str, user: str, answer: str, meta: dict) -> None:
    with session_scope() as s:
        sess = s.get(ChatSession, session_id)
        if sess is None:
            sess = ChatSession(id=session_id, title=guard.mask_pii(user)[:80])
            s.add(sess)
            s.flush()
        sess.updated_at = now()
        s.add(ChatMessage(session_id=session_id, role="user", content=guard.mask_pii(user)))
        s.add(ChatMessage(session_id=session_id, role="assistant", content=answer, meta=meta))


def purge_old() -> int:
    from datetime import UTC, datetime, timedelta
    days = prefs.get("ai")["retention_days"]
    cutoff = datetime.now(UTC) - timedelta(days=days)
    with session_scope() as s:
        old = [i for (i,) in s.execute(select(ChatSession.id).where(ChatSession.updated_at < cutoff))]
        if old:
            s.execute(delete(ChatMessage).where(ChatMessage.session_id.in_(old)))
            s.execute(delete(ChatSession).where(ChatSession.id.in_(old)))
    return len(old)


def _audit(action: str, detail: dict, uroven: str = "info") -> None:
    """Jeden zapisovač pro celou aplikaci — viz `logs.zapis`."""
    from .. import logs
    logs.zapis(action, detail, uroven=uroven, zdroj="asistent")


def _fallback(brief: str, hits: list[dict], sources: list[dict]) -> str:
    parts = ["Jazykový model teď není dostupný, proto posílám podklady přímo z dat KAM:"]
    if brief:
        parts.append(brief)
    if hits:
        parts.append("Nalezené zdroje: " + "; ".join(f"{h['title']} [{i + 1}]" for i, h in enumerate(hits[:5])))
    if not brief and not hits:
        parts.append("K dotazu jsem v datech nic nenašel.")
    return "\n\n".join(parts)


def stream(message: str, session_id: str | None = None, context: dict | None = None, client_history: list[dict] | None = None) -> Iterator[tuple[str, dict]]:
    t0 = time.perf_counter()
    context = context or {}
    session_id = session_id or str(uuid.uuid4())
    cfg = prefs.get("ai")

    ok, category, refusal = guard.check_input(message)
    if not ok:
        _audit("ai_blocked", {"category": category}, "varovani")
        yield "meta", {"session_id": session_id, "route": {"intent": "GUARD", "tier": "none", "reason": f"blokováno: {category}"}, "model": None, "sources": []}
        yield "token", {"text": refusal}
        yield "done", {"ms": round((time.perf_counter() - t0) * 1000), "blocked": True}
        return

    raw_actions, confirmation, remaining = commands.parse(message)
    actions = [a for a in (commands.validate(x) for x in raw_actions) if a]
    for a in actions:
        if a["type"] != "search_data":
            yield "action", a

    if not remaining:
        yield "meta", {"session_id": session_id, "route": {"intent": "ACTION", "tier": "rules", "reason": "příkaz aplikace — bez jazykového modelu"}, "model": None, "sources": []}
        text = confirmation or "Hotovo."
        yield "token", {"text": text}
        if cfg["history"]:
            _save(session_id, message, text, {"route": "rules"})
        yield "done", {"ms": round((time.perf_counter() - t0) * 1000), "tier": "rules"}
        return

    cloud = providers.pick("cloud")
    local = providers.pick("local")
    if cfg["policy"] == "local_only":
        # The policy decides what may leave the machine, so the cloud provider
        # stops existing here — before the router can classify with it, before
        # a failed local model can fall back to it.
        cloud = None
    route = router.decide(remaining, cloud is not None, cfg["policy"])
    if cfg["router_mode"] == "model" and cloud is not None:
        route = router.refine_with_model(remaining, route, cloud)

    terr = tools.find_territory(remaining)
    if terr is None and guard.off_topic(remaining):
        _audit("ai_off_topic", {})
        yield "meta", {"session_id": session_id, "route": {"intent": "OFFTOPIC", "tier": "none", "reason": "mimo zaměření aplikace"}, "model": None, "sources": []}
        yield "token", {"text": guard.REFUSAL_OFF_TOPIC}
        if cfg["history"]:
            _save(session_id, message, guard.REFUSAL_OFF_TOPIC, {"route": "offtopic"})
        yield "done", {"ms": round((time.perf_counter() - t0) * 1000), "tier": "none"}
        return
    if terr is None and context.get("territory"):
        terr = store.territory(context["territory"])
    compact = not (route.tier == "cloud" and cloud)
    blocks: list[str] = []
    sources: list[dict] = []
    brief = ""
    if terr is not None and route.intent not in ("HELP",):
        brief, src = tools.brief(terr.id, compact=compact)
        blocks.append(brief)
        sources.extend(src)
        # Otázka, která jmenuje víc území, dostane podklad za každé — jinak
        # model na „porovnej A a B“ odpoví, že data pro B nemá.
        for dalsi in tools.find_territories(remaining):
            if dalsi.id == terr.id:
                continue
            b2, src2 = tools.brief(dalsi.id, compact=compact)
            blocks.append(b2)
            sources.extend(src2)
    sim_link = None
    if route.intent == "SCENARIO" and terr is not None:
        ivs = tools.scenario_from_text(remaining)
        if ivs:
            res = tools.run_scenario(terr.id, ivs)
            blocks.append(tools.sim_brief(res))
            sim_link = {"territory": terr.id, "interventions": res.get("request", {}).get("interventions", ivs)}
    data_q = route.intent == "DATA" or any(a["type"] == "search_data" for a in actions)
    region = (terr.kraj_code if terr is not None and terr.level == "kraj" else 0) or tools.kraj_in_text(remaining)
    if data_q or tools.asks_catalog(remaining):
        blocks.append(tools.catalog_brief(region))
    # Krajský podklad jen tam, kde se neptají na jednu obec: u té už má model
    # její vlastní dokumenty z `brief` a čísla za celý kraj by ho jen mátla.
    if tools.asks_plany(remaining) and (terr is None or terr.level != "obec"):
        blocks.append(tools.plany_brief(region))
    k = min(cfg["max_sources"], 4) if compact else cfg["max_sources"]
    if data_q:
        hits = tools.dataset_hits(remaining, region, max(k, 6))
    else:
        hits = rag.search(remaining, k=k, types=("method", "dataset", "indicator"))
    if compact:
        hits = [{**h, "snippet": h["snippet"][:170]} for h in hits]
    for h in hits:
        sources.append({"title": h["title"], "url": h["url"], "type": {"dataset": "datová sada", "method": "metodika KAM", "indicator": "ukazatel"}.get(h["type"], h["type"])})
    seen, numbered = set(), []
    for s in sources:
        if s["url"] in seen:
            continue
        seen.add(s["url"])
        numbered.append({**s, "n": len(numbered) + 1})
    hit_text = "\n".join(f"[{i + 1 + len([x for x in numbered if x['type'] == 'zdroj dat'])}] {h['title']}: {h['snippet']}" for i, h in enumerate(hits))
    context_block = "\n\n".join(blocks + ([f"NALEZENO VYHLEDÁVÁNÍM:\n{hit_text}"] if hit_text else []))
    src_list = "\n".join(f"[{s['n']}] {s['title']} — {s['url']}" for s in numbered)
    user_content = f"KONTEXT:\n<data>\n{guard.fence(context_block)}\n</data>\n\nZDROJE:\n{src_list or '(žádné)'}\n\nDOTAZ UŽIVATELE: {remaining}"
    if actions:
        user_content += "\n\n(Aplikace už provedla: " + ", ".join(json.dumps(a, ensure_ascii=False) for a in actions) + ". Nepiš pro ně AKCE znovu.)"

    history = _history(session_id) if cfg["history"] else [m for m in (client_history or [])[-6:] if m.get("role") in ("user", "assistant")]
    provider = cloud if (route.tier == "cloud" and cloud) else local
    messages = [{"role": "system", "content": system_prompt(cfg["answer_length"], route.reason)}, *history, {"role": "user", "content": user_content}]
    yield "meta", {"session_id": session_id, "route": {"intent": route.intent, "complexity": route.complexity, "tier": route.tier if provider else "none", "reason": route.reason},
                   "model": provider.name if provider else None, "territory": {"id": terr.id, "name": terr.name} if terr else None,
                   "sources": numbered, "simulation": sim_link}

    klic_odpovedi = None
    if not history and not actions and route.intent != "ACTION" and not sim_link:
        klic_odpovedi = _klic_odpovedi(remaining, [t.id for t in ([terr] if terr else [])], cfg["answer_length"], route.tier)
        zasah = _ODPOVEDI.get(klic_odpovedi)
        if zasah and time.time() - zasah[0] < _ODPOVEDI_TTL:
            _, text_z, meta_z = zasah
            for kus in range(0, len(text_z), 160):
                yield "token", {"text": text_z[kus:kus + 160]}
            if cfg["history"]:
                _save(session_id, message, text_z, {**meta_z, "cache": True})
            yield "done", {"ms": round((time.perf_counter() - t0) * 1000), "tier": meta_z["tier"], "fallback": False, "model": meta_z["model"], "cache": True}
            return

    answer = ""
    fallback = False
    used = None  # the provider that actually answered, which need not be the routed one
    # Try the routed model, then the other tier, then give up into the brief.
    # Either tier can be missing or unreachable — LM Studio closed, no cloud
    # key, network down — and a working model on the other side should answer
    # rather than let the assistant degrade for a reason the user cannot see.
    attempts: list = []
    for p in (provider, local, cloud):
        if p is not None and p not in attempts:
            attempts.append(p)
    for attempt, p in enumerate(attempts):
        try:
            line = ""
            for piece in p.stream(messages, timeout=90):
                line += piece
                # Hold back a line that may be an action command; flush anything else.
                while "\n" in line:
                    head, line = line.split("\n", 1)
                    if head.strip().startswith(AKCE):
                        act = _parse_action(head)
                        if act:
                            yield "action", act
                        continue
                    answer += head + "\n"
                    yield "token", {"text": head + "\n"}
                if line and not AKCE.startswith(line.strip()[:5]) and not line.strip().startswith(AKCE):
                    answer += line
                    yield "token", {"text": line}
                    line = ""
            if line.strip().startswith(AKCE):
                act = _parse_action(line)
                if act:
                    yield "action", act
            elif line:
                answer += line
                yield "token", {"text": line}
            used = p
            if attempt:
                yield "note", {"text": f"{attempts[0].name} neodpověděl, odpověď dokončil {p.name}."}
            break
        except Exception as e:
            _audit("ai_error", {"provider": p.name, "error": str(e)[:300]}, "chyba")
            if answer:
                break
            continue
    if not answer.strip():
        fallback = True
        answer = _fallback(brief, hits, numbered)
        yield "token", {"text": answer}
    safe = guard.check_output(answer)
    if safe != answer:
        yield "replace", {"text": safe}
        answer = safe
    tier = used.tier if used else ("none" if fallback else route.tier)
    meta = {"route": route.intent, "tier": tier, "model": used.name if used else None, "fallback": fallback, "sources": numbered}
    if klic_odpovedi and used and not fallback and answer.strip():
        if len(_ODPOVEDI) >= _ODPOVEDI_MAX:
            for stary in sorted(_ODPOVEDI, key=lambda k: _ODPOVEDI[k][0])[: _ODPOVEDI_MAX // 4]:
                _ODPOVEDI.pop(stary, None)
        _ODPOVEDI[klic_odpovedi] = (time.time(), answer, meta)
    if cfg["history"]:
        _save(session_id, message, answer, meta)
    # The `meta` event named the model we were about to try; this one names the
    # model that actually answered, so the UI never credits the wrong one.
    yield "done", {"ms": round((time.perf_counter() - t0) * 1000), "tier": tier, "fallback": fallback,
                   "model": used.name if used else None}


def _parse_action(line: str) -> dict | None:
    try:
        raw = line.split(AKCE, 1)[1].strip()
        return commands.validate(json.loads(raw[raw.find("{"): raw.rfind("}") + 1]))
    except (ValueError, IndexError):
        return None


def sessions(limit: int = 30) -> list[dict]:
    with session_scope() as s:
        rows = s.scalars(select(ChatSession).order_by(ChatSession.updated_at.desc()).limit(limit)).all()
        return [{"id": r.id, "title": r.title, "updated_at": r.updated_at.isoformat()} for r in rows]


def session_messages(session_id: str) -> list[dict]:
    with session_scope() as s:
        rows = s.scalars(select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.id)).all()
        return [{"role": r.role, "content": r.content, "meta": r.meta, "created_at": r.created_at.isoformat()} for r in rows]


def delete_session(session_id: str) -> None:
    with session_scope() as s:
        s.execute(delete(ChatMessage).where(ChatMessage.session_id == session_id))
        s.execute(delete(ChatSession).where(ChatSession.id == session_id))
