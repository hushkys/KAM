"""Input and output guardrails for the assistant.

Three layers, cheapest first:

1. Input screen — length, control characters, and known jailbreak / prompt
   extraction phrasings in Czech and English (matched on unaccented text, so
   "ignoruj predchozi instrukce" is caught as well as the accented form).
2. Context fencing — everything retrieved from data or documents is wrapped
   as untrusted evidence and scrubbed of instruction-like phrases before the
   model sees it (spec §134: documents are data, not instructions).
3. Output check — a canary token lives in the system prompt; if it ever shows
   up in an answer, the answer is replaced. Personal data patterns are
   masked before anything is stored.
"""

from __future__ import annotations

import re
import unicodedata

CANARY = "KAM-7f3a9c"
MAX_INPUT = 2000


def _plain(text: str) -> str:
    t = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in t if not unicodedata.combining(ch)).lower()


JAILBREAK = [re.compile(p) for p in (
    r"ignor\w*\s+(\w+\s+){0,3}(predchozi|predesle|vsechny|sve|tve|puvodni|dosavadni)\s+(\w+\s+)?(instrukc|pokyn|pravidl|nastaven)",
    r"ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|your)\s+(instructions|rules|prompts?|guidelines)",
    r"disregard\s+(all\s+|your\s+)?(previous|prior|above)?\s*(instructions|rules)",
    r"zapomen\w*\s+(na\s+)?(\w+\s+){0,2}(instrukc|pravidl|pokyn|omezeni)",
    r"forget\s+(all\s+|your\s+)?(instructions|rules|guidelines)",
    r"(system(ov\w*)?\s*(prompt|instrukc|zprav))|(system\s+message)",
    r"(vypis|zobraz|prozrad|odhal|zopakuj|reveal|print|show|repeat)\w*\s+(\w+\s+){0,3}(instrukc|prompt|pokyn|instructions|rules)",
    r"\bdan\b\s*(mode|rezim)|do\s+anything\s+now|developer\s+mode|vyvojarsk\w+\s+rezim",
    r"jailbreak|prompt\s*injection|\bbypass\b|obejd\w*\s+(\w+\s+)?(omezeni|pravidl|filtr)",
    r"(bez|without)\s+(omezeni|cenzury|filtru|restrictions|censorship|limits)",
    r"(od\s+ted|nyni|ted)\s+(jsi|budes|se\s+chovas)\s+(jako\s+)?(\w+\s+){0,2}(bez|neomezen|zly|evil|jin)",
    r"(pretend|act\s+as\s+if|roleplay|hraj\s+roli|predstav\s+si,?\s+ze\s+jsi|chovej\s+se\s+jako)\s.*(no\s+rules|bez\s+pravidel|unrestricted|neomezen|jiny\s+model|jina\s+ai)",
    r"<\s*/?\s*(system|im_start|im_end)\s*>|\[\s*/?inst\s*\]|###\s*(system|instruction)",
)]

INJECTION_IN_CONTEXT = re.compile(
    r"(ignor\w*|ignore|disregard|zapomen\w*|forget)\s+(\w+\s+){0,4}(instrukc\w*|pokyn\w*|instructions|rules|pravidl\w*)"
    r"|(you\s+are\s+now|nyni\s+jsi|od\s+ted\s+jsi)"
    r"|(system\s*prompt|systemov\w+\s+prompt)", re.I)

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
PHONE = re.compile(r"(?<!\d)(\+?420[\s-]?)?\d{3}[\s-]?\d{3}[\s-]?\d{3}(?!\d)")
BIRTH_NO = re.compile(r"(?<!\d)\d{6}/?\d{3,4}(?!\d)")

REFUSAL_JAILBREAK = ("V rámci aplikace KAM nemohu na tuto žádost odpovědět. Pomohu s daty, výhledy a scénáři krajů a obcí, "
                     "s otevřenými datovými sadami nebo s ovládáním aplikace.")
REFUSAL_OFF_TOPIC = ("V rámci aplikace KAM nemohu na tuto otázku odpovědět. Pomohu s daty, výhledy a scénáři krajů a obcí, "
                     "s otevřenými datovými sadami nebo s ovládáním aplikace.")

OFF_TOPIC = re.compile(
    r"\b(recept\w*|vareni|uvar\w*|upec\w*|peceni|dort\w*|kolac\w*|bucht\w*|film\w*|serial\w*|pisen|pisnick\w*|text pisne|basen\w*|basnick\w*|vtip\w*|"
    r"fotbal\w*|hokej\w*|horoskop\w*|programov\w*|python|javascript|typescript|html|napis mi (esej|basen|pisen|kod|program|uvahu|slohovk\w*)|"
    r"domaci ukol\w*|matematick\w* priklad\w*|bitcoin\w*|kryptomen\w*|burz\w*|sazk\w*|randen\w*|seznamk\w*|hubnut\w*|dieta)\b")
DOMAIN = ("kraj", "obec", "obc", "mest", "orp", "okres", "data", "datov", "sad", "obyvatel", "demograf", "skol", "doprav", "autobus", "vlak",
          "zdrav", "lekar", "nemocn", "social", "senior", "byt", "bydl", "rozpo", "dotac", "dan", "financ", "rizik", "vyhled", "predikc",
          "prognoz", "scenar", "simul", "zasah", "mapa", "mape", "mapu", "kam", "aplikac", "nastav", "rezim", "motiv", "statist", "trend",
          "nezamest", "prace", "uzemi", "region", "prostred", "ovzdusi", "vod", "zaplav", "kanaliz", "katalog", "nkod", "csu", "zdroj",
          "metod", "podnet", "hradec", "kralovehrad", "umis", "pomoc", "napoved", "funguj", "ukazatel", "index", "vyvoj", "pocet", "kolik",
          "migrac", "porod", "stari", "ekonom", "prumysl", "investic", "infrastrukt", "sluzb", "asistent", "model", "odkaz", "export")
SMALL_TALK = re.compile(r"^(ahoj|dobry den|dobre rano|dobry vecer|cau|zdravim|nazdar|dekuji|diky|dik|hello|hi|hey|ok|super|jasne)\b")


def off_topic(text: str) -> bool:
    """True for questions KAM should not answer (recipes, films, homework…).

    Explicit off-topic subjects are refused unless the question is clearly
    about regional data; anything with no regional or app vocabulary at all
    is refused too. Greetings pass (the model answers them in one line).
    """
    p = _plain(text).strip()
    if SMALL_TALK.match(p):
        return False
    if OFF_TOPIC.search(p):
        return not any(w in p for w in ("kraj", "obec", "datov", "statist"))
    return not any(w in p for w in DOMAIN)
REFUSAL_LENGTH = f"Zpráva je příliš dlouhá (limit {MAX_INPUT} znaků). Zkraťte ji prosím."


def check_input(text: str) -> tuple[bool, str, str]:
    """Returns (allowed, category, message_for_user)."""
    if not text or not text.strip():
        return False, "prazdne", "Napište prosím dotaz."
    if len(text) > MAX_INPUT:
        return False, "delka", REFUSAL_LENGTH
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", text):
        return False, "znaky", "Zpráva obsahuje neplatné znaky."
    plain = _plain(text)
    for rx in JAILBREAK:
        if rx.search(plain):
            return False, "jailbreak", REFUSAL_JAILBREAK
    if CANARY.lower() in plain:
        return False, "jailbreak", REFUSAL_JAILBREAK
    return True, "ok", ""


def fence(text: str) -> str:
    """Neutralise instruction-like phrases inside retrieved content."""
    cleaned = INJECTION_IN_CONTEXT.sub("[odstraněno]", _strip_tags(text))
    return cleaned.replace("<", "‹").replace(">", "›")


def _strip_tags(text: str) -> str:
    return re.sub(r"<[^>]{0,200}>", " ", text or "")


def check_output(text: str) -> str:
    if CANARY in text:
        return "Omlouvám se, tuto odpověď nemohu zobrazit."
    return text


def mask_pii(text: str) -> str:
    text = EMAIL.sub("[e-mail]", text)
    text = BIRTH_NO.sub("[rodné číslo]", text)
    return PHONE.sub("[telefon]", text)
