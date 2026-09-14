"""Hospodaření obce: vydělává na tom, jak se svými penězi nakládá?

Obec nespekuluje na burze — „zhodnocuje" tím, že z běžného provozu něco
zbyde a to něco promění v majetek, který slouží lidem. Celá otázka se proto
dá rozložit na tři čísla, která jsou všechna v rozpočtu:

1. **Provozní přebytek** = příjmy po konsolidaci − běžné výdaje. Kolik zbyde,
   když se zaplatí chod obce. Záporný přebytek znamená, že se provoz platí
   z úspor nebo z dluhu, a to je první varovné znamení.
2. **Kapitálové výdaje.** Kolik z toho jde do majetku. Obec, která roky nic
   neinvestuje, sice „šetří", ale její majetek stárne.
3. **Krytí investic** = provozní přebytek / kapitálové výdaje. Nad 100 % si
   obec investice platí sama, pod 100 % je dotáhne dotace nebo úvěr.

Ke „zhodnocení" pak vede kumulované saldo: součet ročních sald od začátku
řady. Roste-li, obec si drží rezervu; klesá-li dlouhodobě, žije z podstaty.

Nikde tu netvrdíme, že investice něco *způsobila*. Rozpočet říká, kolik se
utratilo a z čeho; co za to obec pořídila, rozpočtová skladba neví.

Všechna čísla pocházejí z ČSÚ MOS, který přebírá výkaz FIN 2-12 M
Ministerstva financí (MONITOR státní pokladny). Tisíce korun převádíme na
koruny hned tady, aby se jednotka nemíchala napříč aplikací.
"""

from __future__ import annotations

from . import store

# Kódy MOS. Hodnoty jsou v tisících Kč.
PRIJMY = "200402"    # příjmy celkem po konsolidaci
VYDAJE = "200702"    # výdaje celkem
KAPITAL = "200602"   # kapitálové (investiční) výdaje
SALDO = "200802"     # saldo příjmů a výdajů
DANE = "200002"      # daňové příjmy
DOTACE = "200302"    # přijaté dotace
OBYV = "110900"

TISIC = 1000.0
# Kolik let zpátky se počítá souhrn. Kratší okno by u malé obce chytlo jednu
# velkou investici a vydávalo ji za trend.
OKNO = 5


def _rok_min(tid: str) -> dict[str, dict[int, float]]:
    return {c: store.series(tid, c) for c in (PRIJMY, VYDAJE, KAPITAL, SALDO, DANE, DOTACE, OBYV)}


def rocni(tid: str) -> list[dict]:
    """Rozpočet po letech, všechno v korunách."""
    s = _rok_min(tid)
    roky = sorted(set(s[PRIJMY]) & set(s[VYDAJE]))
    out: list[dict] = []
    kumul = 0.0
    for y in roky:
        prijmy = s[PRIJMY][y] * TISIC
        vydaje = s[VYDAJE][y] * TISIC
        kapital = s[KAPITAL].get(y, 0.0) * TISIC
        bezne = vydaje - kapital
        saldo = s[SALDO].get(y, (prijmy - vydaje) / TISIC) * TISIC
        kumul += saldo
        obyv = s[OBYV].get(y)
        out.append({
            "year": y,
            "prijmy": round(prijmy),
            "vydaje": round(vydaje),
            "bezne": round(bezne),
            "kapital": round(kapital),
            "dane": round(s[DANE].get(y, 0.0) * TISIC),
            "dotace": round(s[DOTACE].get(y, 0.0) * TISIC),
            "saldo": round(saldo),
            "kumul": round(kumul),
            "provozni": round(prijmy - bezne),
            "kryti": round((prijmy - bezne) / kapital * 100, 1) if kapital > 0 else None,
            "obyvatel": int(obyv) if obyv else None,
            "kapital_obyv": round(kapital / obyv) if obyv else None,
            "provozni_obyv": round((prijmy - bezne) / obyv) if obyv else None,
        })
    return out


def _median(xs: list[float]) -> float | None:
    v = sorted(x for x in xs if x is not None)
    if not v:
        return None
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def srovnani(level: str, kraj_code: int, roky: list[int]) -> dict[str, float | None]:
    """Medián kapitálových výdajů a provozního přebytku na obyvatele v kraji.

    Bez měřítka je „2 400 Kč na obyvatele" jen číslo. Medián, ne průměr:
    jedna velká investice v jednom městě by průměr utrhla.
    """
    kap: list[float] = []
    prov: list[float] = []
    for t in store.members(level, kraj_code):
        s = _rok_min(t.id)
        for y in roky:
            obyv = s[OBYV].get(y)
            if not obyv:
                continue
            prijmy = s[PRIJMY].get(y)
            vydaje = s[VYDAJE].get(y)
            kapital = s[KAPITAL].get(y)
            if kapital is not None:
                kap.append(kapital * TISIC / obyv)
            if prijmy is not None and vydaje is not None and kapital is not None:
                prov.append((prijmy - (vydaje - kapital)) * TISIC / obyv)
    return {"kapital_obyv": _median(kap), "provozni_obyv": _median(prov)}


# Hodnocení je pravidlo nad daty, ne dojem — proto je tady vypsané i s prahy,
# které se ukazují v aplikaci.
PRAHY = {
    "provozni_podil": (5.0, 15.0),   # provozní přebytek jako % příjmů: pod / nad
    "kryti": (60.0, 100.0),          # kolik % investic utáhne vlastní přebytek
}


def souhrn(tid: str) -> dict:
    """Shrnutí posledních let a slovní hodnocení s uvedeným pravidlem."""
    rady = rocni(tid)
    if not rady:
        return {"roky": [], "souhrn": None}
    posledni = rady[-OKNO:]
    roky = [r["year"] for r in posledni]
    prijmy = sum(r["prijmy"] for r in posledni)
    provozni = sum(r["provozni"] for r in posledni)
    kapital = sum(r["kapital"] for r in posledni)
    dotace = sum(r["dotace"] for r in posledni)
    obyv = next((r["obyvatel"] for r in reversed(posledni) if r["obyvatel"]), None)

    podil = provozni / prijmy * 100 if prijmy else 0.0
    kryti = provozni / kapital * 100 if kapital > 0 else None
    t = store.territory(tid)
    level = t.level if t else "obec"
    ref = srovnani(level, t.kraj_code if t else 86, roky) if level in ("obec", "orp") else {}

    if podil < PRAHY["provozni_podil"][0]:
        stav, popis = "riziko", "Provoz spotřebuje skoro všechny příjmy — na investice ani na rezervu nezbývá."
    elif kryti is None:
        stav, popis = "neutral", "V posledních letech obec do majetku prakticky neinvestovala."
    elif kryti >= PRAHY["kryti"][1]:
        stav, popis = "dobre", "Investice si obec platí z vlastního provozního přebytku."
    elif kryti >= PRAHY["kryti"][0]:
        stav, popis = "neutral", "Většinu investic obec utáhne sama, zbytek dotáhnou dotace nebo úvěr."
    else:
        stav, popis = "pozor", "Investice stojí hlavně na cizích penězích — bez dotace nebo úvěru by se nekonaly."

    return {
        "roky": rady,
        "souhrn": {
            "od": roky[0], "do": roky[-1],
            "prijmy": prijmy, "provozni": provozni, "kapital": kapital, "dotace": dotace,
            "provozni_podil": round(podil, 1),
            "kryti": round(kryti, 1) if kryti is not None else None,
            "dotace_podil": round(dotace / prijmy * 100, 1) if prijmy else None,
            "kumul": rady[-1]["kumul"],
            "kapital_obyv": round(kapital / len(posledni) / obyv) if obyv else None,
            "provozni_obyv": round(provozni / len(posledni) / obyv) if obyv else None,
            "kraj_kapital_obyv": round(ref["kapital_obyv"]) if ref.get("kapital_obyv") is not None else None,
            "kraj_provozni_obyv": round(ref["provozni_obyv"]) if ref.get("provozni_obyv") is not None else None,
            "stav": stav, "popis": popis,
            "pravidlo": (f"Dobře: vlastní přebytek pokryje aspoň {PRAHY['kryti'][1]:.0f} % investic. "
                         f"Pozor: pod {PRAHY['kryti'][0]:.0f} %. "
                         f"Riziko: provozní přebytek pod {PRAHY['provozni_podil'][0]:.0f} % příjmů."),
        },
        "zdroj": "ČSÚ MOS (výkaz FIN 2-12 M, MONITOR státní pokladny)",
    }
