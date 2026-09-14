"""App commands in plain Czech, executed without a model round-trip.

"Zapni tmavý režim" should switch the theme the instant it is said, not after
a model has thought about it for two seconds. Commands are recognised on
unaccented text with a closed vocabulary; the result is a list of actions from
a fixed allowlist the browser knows how to apply. Anything not matched here
goes to the model, which may still propose an action — but only one from the
same allowlist (`ALLOWED`), validated on the server.
"""

from __future__ import annotations

import re
import unicodedata

ROUTES = {
    "prehled": ("/prehled", "Přehled"), "mapa": ("/mapa", "Mapa"), "obce": ("/obce", "Obce"), "vyhled": ("/vyhled", "Výhled"),
    "scenare": ("/scenare", "Scénáře"), "podnety": ("/podnety", "Podněty"), "data": ("/data", "Data"), "statistiky": ("/statistiky", "Statistiky"),
    "asistent": ("/asistent", "Asistent"), "nastaveni": ("/nastaveni", "Nastavení"), "o-nas": ("/o-nas", "O nás"), "pravni": ("/pravni", "Právní informace"),
    "uvod": ("/", "Úvod"),
}

ROUTE_WORDS = (
    (r"\bmap\w*", "mapa"), (r"prehled\w*|dashboard|nastenk\w*", "prehled"), (r"\bobc[ei]\b|\bobci\b|seznam obci|profil\w* obc", "obce"),
    (r"vyhled\w*|predikc\w*|prognoz\w*", "vyhled"), (r"scenar\w*|simulac\w*|simulator\w*|co kdyby", "scenare"), (r"podnet\w*|hlasen\w*", "podnety"),
    (r"\bdat\w*\b|katalog\w*|datov\w* sad\w*", "data"), (r"statistik\w*", "statistiky"), (r"nastaveni", "nastaveni"),
    (r"o nas|\btym\w*", "o-nas"), (r"pravni|podminky|gdpr|ochran\w* (osobnich )?udaj", "pravni"), (r"uvod\w*|domovsk\w*|hook", "uvod"),
    (r"asistent\w*|chat\w*", "asistent"),
)

NAV_VERB = r"(otevri|otevrit|prejdi|prejit|jdi|ukaz|zobraz|prepni se|presun|vezmi me|chci videt|nav\w*)"

ALLOWED = {
    "set_pref": {"theme": {"dark", "light", "system"}, "transparency": {True, False}, "reduceMotion": {True, False},
                 "contrast": {"normal", "high"}, "fontScale": {"up", "down", "reset"}, "dock": {"bottom", "side"},
                 "density": {"comfortable", "compact"}},
    "navigate": set(r for r, _ in ROUTES.values()),
}


def _plain(text: str) -> str:
    t = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in t if not unicodedata.combining(ch)).lower().strip()


def validate(action: dict) -> dict | None:
    kind = action.get("type")
    if kind == "set_pref":
        allowed = ALLOWED["set_pref"].get(action.get("key", ""))
        if allowed is not None and action.get("value") in allowed:
            return {"type": "set_pref", "key": action["key"], "value": action["value"]}
    if kind == "navigate":
        path = str(action.get("path", ""))
        base = path.split("?")[0]
        if base in ALLOWED["navigate"] or re.fullmatch(r"/obce/(obec|orp|kraj|okres):\d+", base):
            return {"type": "navigate", "path": path[:200]}
    if kind == "search_data":
        return {"type": "search_data", "query": str(action.get("query", ""))[:120]}
    return None


def _pref_actions(q: str) -> list[tuple[dict, str]]:
    out: list[tuple[dict, str]] = []
    on = re.search(r"\b(zapni|zapnout|aktivuj|povol|nastav|dej|chci|prepni|pouzij)\w*", q)
    off = re.search(r"\b(vypni|vypnout|deaktivuj|zakaz|zrus|odstran|bez|nechci|omez)\w*", q)
    if re.search(r"tmav\w*|dark|nocn\w* rezim|cern\w* (rezim|motiv|tema)", q) and (on or "rezim" in q or "tema" in q or "motiv" in q):
        out.append(({"type": "set_pref", "key": "theme", "value": "light" if off and not on else "dark"}, "Tmavý režim je zapnutý." if not (off and not on) else "Světlý režim je zapnutý."))
    elif re.search(r"svetl\w*|light|denni rezim|bil\w* (rezim|motiv|tema)", q) and (on or "rezim" in q or "tema" in q or "motiv" in q):
        out.append(({"type": "set_pref", "key": "theme", "value": "light"}, "Světlý režim je zapnutý."))
    elif re.search(r"(podle|dle) systemu|automatick\w* (rezim|motiv|tema)|systemov\w* (rezim|motiv|tema)", q):
        out.append(({"type": "set_pref", "key": "theme", "value": "system"}, "Motiv se řídí nastavením systému."))
    if re.search(r"pruhledn\w*|sklo|skleneny|blur|rozmaz\w*|transparen\w*|efekt\w* (skla|pruhlednosti)", q):
        val = not bool(off)
        out.append(({"type": "set_pref", "key": "transparency", "value": val}, "Efekty průhlednosti jsou zapnuté." if val else "Efekty průhlednosti jsou vypnuté."))
    if re.search(r"animac\w*|pohyb\w*|prechod\w*", q) and (on or off):
        reduce = bool(off)
        out.append(({"type": "set_pref", "key": "reduceMotion", "value": reduce}, "Animace jsou omezené." if reduce else "Animace jsou zapnuté."))
    if re.search(r"kontrast\w*", q):
        high = not (off or re.search(r"normaln\w*|bezn\w*", q))
        out.append(({"type": "set_pref", "key": "contrast", "value": "high" if high else "normal"}, "Vysoký kontrast je zapnutý." if high else "Kontrast je normální."))
    if re.search(r"(pism\w*|text\w*|font\w*)", q) and re.search(r"zvets\w*|vetsi|zvys\w*|zmens\w*|mensi|puvodn\w*|resetuj|vychozi", q):
        if re.search(r"zvets\w*|vetsi|zvys\w*", q):
            out.append(({"type": "set_pref", "key": "fontScale", "value": "up"}, "Písmo je větší."))
        elif re.search(r"zmens\w*|mensi", q):
            out.append(({"type": "set_pref", "key": "fontScale", "value": "down"}, "Písmo je menší."))
        else:
            out.append(({"type": "set_pref", "key": "fontScale", "value": "reset"}, "Velikost písma je výchozí."))
    if re.search(r"\b(dock|lista|listu|panel\w*|navigac\w*)\b", q) and re.search(r"vlev\w*|bok\w*|stran\w*|dol\w*|spod\w*", q):
        side = bool(re.search(r"vlev\w*|bok\w*|stran\w*", q))
        out.append(({"type": "set_pref", "key": "dock", "value": "side" if side else "bottom"}, "Navigace je po straně." if side else "Navigace je dole."))
    if re.search(r"kompaktn\w*|husts\w*|mensi mezery", q):
        out.append(({"type": "set_pref", "key": "density", "value": "compact"}, "Rozložení je kompaktní."))
    elif re.search(r"(vzdusn\w*|pohodln\w*|vetsi mezery)", q):
        out.append(({"type": "set_pref", "key": "density", "value": "comfortable"}, "Rozložení je vzdušné."))
    return out


def parse(text: str) -> tuple[list[dict], str, str]:
    """Returns (actions, confirmation text, remaining question).

    `remaining` is empty when the message was only a command; otherwise it
    holds what still needs an answer (e.g. "vyhledej data o dopravě").
    """
    q = _plain(text)
    actions: list[dict] = []
    replies: list[str] = []
    for action, reply in _pref_actions(q):
        actions.append(action)
        replies.append(reply)

    m = re.search(r"(vyhledej|najdi|hledej|dohledej|vyhledat|najit)\w*\s+(mi\s+)?(jaka\s+|ktera\s+)?(data|datove sady|datasety|zdroje|sady)\s*(se\s+pouzivaji\s+)?(o|k|pro|na|ohledne|tykajici se|pouzivan\w*\s+(k|pro|na))?\s*(.*)", q)
    if m:
        topic = m.group(8).strip(" ?.!") or ""
        actions.append({"type": "search_data", "query": topic})
        actions.append({"type": "navigate", "path": "/data" + (f"?q={topic}" if topic else "")})
        return actions, "", text  # the model still answers with the found datasets

    if re.search(NAV_VERB, q) or re.fullmatch(r"(na\s+)?\w+", q):
        for rx, key in ROUTE_WORDS:
            if re.search(rx, q):
                path, label = ROUTES[key]
                actions.append({"type": "navigate", "path": path})
                replies.append(f"Otevírám stránku {label}.")
                break

    if actions and not any(a["type"] == "search_data" for a in actions):
        leftover = re.sub(r"\b(a|a pak|potom|prosim|dik|diky)\b", " ", q)
        is_pure = len(leftover.split()) <= 12 and not re.search(r"\?|proc|kolik|jak[yaáé]?\s|vysvetli|co je", leftover)
        return actions, " ".join(replies), "" if is_pure else text
    return actions, " ".join(replies), text
