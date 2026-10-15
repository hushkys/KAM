"""Kam zásah umístit: porovnání variant podle toho, koho obslouží.

Simulátor odpovídá na otázku „co se stane, když postavíme tři zastávky".
Starostu ale zajímá něco jiného: **kde** je postavit. Tři zastávky v obci,
která už jich má nadprůměr, nikomu nepomůžou; tytéž tři v obci bez spojení
změní život dvěma stům lidí.

Přínos se tu počítá jedním pravidlem, které platí pro všechny zásahy:

    mezera  = o kolik je obec horší než medián **obcí své velikosti**,
              vyjádřeno podílem toho mediánu (0 = je na mediánu nebo lepší)
    přínos  = mezera × počet lidí, kterých se ukazatel týká

Srovnává se uvnitř velikostního pásma, ne proti celému kraji, a to je na tom
to podstatné. Ukazatele „na 1 000 obyvatel" totiž systematicky trestají města:
vesnice s dvěma sty obyvateli a třemi zastávkami má patnáct zastávek na tisíc,
Hradec Králové jednu — ne proto, že by v Hradci nebylo kam nastoupit, ale
protože jmenovatel je o tři řády jinde. Krajský medián by tak pokaždé
vyhodnotil jako nejpotřebnější prostě to největší město.

Přínos je tedy „kolika lidem by zásah srovnal dostupnost na úroveň obvyklou
u obcí téže velikosti". Není to počet lidí, kterým se opravdu uleví — to by
vyžadovalo znát docházkové vzdálenosti a kapacity, které v otevřených datech
nejsou. Je to pořadí potřebnosti, ne předpověď, a aplikace to tak i pojmenovává.

Porovnávají se vždy dvě varianty stejné velikosti: ta, kterou vybral uživatel,
a nejlepší, kterou to pravidlo umí najít. Bez té druhé by první číslo nešlo
s ničím poměřit.
"""

from __future__ import annotations

from . import store
from ..indicators import PILLARS

# zásah -> (ukazatel dostupnosti, směr, koho se týká, jak se to říká lidsky)
# směr +1: vyšší je lepší, obec pod mediánem má mezeru
# směr -1: nižší je lepší, obec nad mediánem má mezeru
PRAVIDLA: dict[str, dict] = {
    "spoj": {"code": "d_zast_1000", "smer": 1, "vaha": "110900",
             "co": "lidí v obcích s méně zastávkami, než je obvyklé",
             "pozn": "Počítají se jen zastávky krajské dopravy IREDO, bez městské hromadné dopravy. "
                     "Města s vlastní MHD proto vycházejí hůř, než jak se v nich skutečně jezdí."},
    "ordinace": {"code": "d_pl_10k", "smer": 1, "vaha": "110900",
                 "co": "lidí v obcích s horší dostupností praktického lékaře, než je obvyklé"},
    "stomatolog": {"code": "d_zubni_10k", "smer": 1, "vaha": "110900",
                   "co": "lidí v obcích s horší dostupností zubního lékaře, než je obvyklé"},
    "domov_seniori": {"code": "d_ds_100_65", "smer": 1, "vaha": "110990",
                      "co": "seniorů v obcích s menší kapacitou domovů pro seniory, než je obvyklé"},
    "zs_mista": {"code": "d_zs_trida", "smer": -1, "vaha": "040510",
                 "co": "žáků v obcích s plnějšími třídami ZŠ, než je obvyklé"},
    "ms_mista": {"code": "d_ms_trida", "smer": -1, "vaha": "040310",
                 "co": "dětí v obcích s plnějšími třídami MŠ, než je obvyklé"},
    "byty": {"code": "d_osob_byt", "smer": -1, "vaha": "110900",
             "co": "lidí v obcích s víc lidmi na byt, než je obvyklé"},
    "pracovni_mista": {"code": "d_dlouhodobi", "smer": -1, "vaha": "501000",
                       "co": "uchazečů o práci v obcích s víc dlouhodobě nezaměstnanými, než je obvyklé"},
}

# Mezera se ořezává: obec s desetinásobkem mediánu není desetkrát potřebnější,
# jen extrémně malá. Bez stropu by žebříček ovládly obce s pár obyvateli.
STROP_MEZERY = 1.5

# Velikostní pásma obcí. Hranice jsou ty, které používá i ČSÚ ve svých
# velikostních skupinách; uvnitř pásma jsou obce srovnatelné, mezi pásmy ne.
PASMA: tuple[tuple[int, int, str], ...] = (
    (0, 500, "do 500 obyvatel"),
    (500, 2000, "500–2 000 obyvatel"),
    (2000, 10000, "2 000–10 000 obyvatel"),
    (10000, 10**9, "nad 10 000 obyvatel"),
)
# Pod tímhle počtem obcí nemá medián pásma co říkat a použije se krajský.
MIN_V_PASMU = 5


def pasmo(pocet_obyvatel: float) -> tuple[int, str]:
    for i, (lo, hi, label) in enumerate(PASMA):
        if lo <= pocet_obyvatel < hi:
            return i, label
    return len(PASMA) - 1, PASMA[-1][2]


def _doplň_zarizeni() -> None:
    from ..indicators import DEN, ZARIZENI
    for k, z in ZARIZENI.items():
        PRAVIDLA.setdefault(k, {"code": z["derived"], "smer": 1, "vaha": DEN[z["den"]][0],
                                "co": f"lidí v obcích s horší dostupností zařízení „{z['metrika'].lower()}“, než je obvyklé"})


_doplň_zarizeni()


def _median(xs: list[float]) -> float | None:
    v = sorted(xs)
    if not v:
        return None
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def _kandidati(kraj_code: int, pravidlo: dict) -> tuple[list[dict], dict[int, float], float | None]:
    code, smer, vaha = pravidlo["code"], pravidlo["smer"], pravidlo["vaha"]
    radky: list[dict] = []
    for t in store.members("obec", kraj_code):
        lv = store.latest(t.id, code)
        w = store.latest(t.id, vaha)
        obyv = store.latest(t.id, "110900")
        if lv is None or w is None or not w[1] or obyv is None:
            continue
        idx, label = pasmo(obyv[1])
        radky.append({"id": t.id, "name": t.name, "hodnota": lv[1], "rok": lv[0], "vaha": w[1],
                      "obyvatel": obyv[1], "pasmo": idx, "pasmo_label": label, "lon": t.lon, "lat": t.lat})
    kraj_med = _median([r["hodnota"] for r in radky])
    if kraj_med is None:
        return [], {}, kraj_med
    if kraj_med == 0:
        # Zařízení je v kraji vzácné: většina obcí ho nemá, takže medián je nula
        # a „horší než obvyklé" nejde změřit. Mezera je pak prostě „nemá žádné"
        # a pořadí rozhoduje počet lidí, kterých se to týká.
        for r in radky:
            r["median_pasma"] = 0.0
            r["mezera"] = 1.0 if r["hodnota"] == 0 else 0.0
            r["prinos"] = round(r["mezera"] * r["vaha"])
        radky.sort(key=lambda r: -r["prinos"])
        for i, r in enumerate(radky):
            r["poradi"] = i + 1
        return radky, {i: 0.0 for i in range(len(PASMA))}, 0.0

    mediany: dict[int, float] = {}
    for i in range(len(PASMA)):
        v = [r["hodnota"] for r in radky if r["pasmo"] == i]
        m = _median(v) if len(v) >= MIN_V_PASMU else None
        mediany[i] = m if m else kraj_med

    for r in radky:
        med = mediany[r["pasmo"]]
        rel = (med - r["hodnota"]) / med if smer > 0 else (r["hodnota"] - med) / med
        r["median_pasma"] = med
        r["mezera"] = round(min(max(rel, 0.0), STROP_MEZERY), 4)
        r["prinos"] = round(r["mezera"] * r["vaha"])
    radky.sort(key=lambda r: -r["prinos"])
    for i, r in enumerate(radky):
        r["poradi"] = i + 1
    return radky, mediany, kraj_med


def _varianta(radky: dict[str, dict], ids: list[str]) -> dict:
    vybrane = [radky[i] for i in ids if i in radky]
    return {
        "obce": [{"id": r["id"], "name": r["name"], "hodnota": round(r["hodnota"], 2), "rok": r["rok"],
                  "vaha": round(r["vaha"]), "mezera": round(r["mezera"] * 100, 1), "prinos": r["prinos"],
                  "pasmo": r["pasmo_label"], "median_pasma": round(r["median_pasma"], 2), "poradi": r["poradi"]}
                 for r in vybrane],
        "prinos": sum(r["prinos"] for r in vybrane),
        "lidi": round(sum(r["vaha"] for r in vybrane)),
        "chybi": [i for i in ids if i not in radky],
    }


def porovnej(kraj_code: int, zasah: str, vybrane: list[str], pocet: int | None = None) -> dict:
    """Porovná vybraná místa s nejlepší možnou sadou stejné velikosti."""
    pravidlo = PRAVIDLA.get(zasah)
    if pravidlo is None:
        return {"available": False, "reason": "U tohoto zásahu umístění posoudit nejde: chybí ukazatel dostupnosti."}
    radky, mediany, kraj_med = _kandidati(kraj_code, pravidlo)
    if not radky:
        return {"available": False, "reason": "Pro tento ukazatel nejsou v kraji dostatečná data."}

    podle_id = {r["id"]: r for r in radky}
    n = pocet or len(vybrane) or 3
    vase = _varianta(podle_id, vybrane) if vybrane else None
    # Nejlepší sada je prostý výběr n nejlepších: přínos se mezi obcemi
    # nepřekrývá (každá obec má svoje lidi), takže hladový výběr je tu
    # zároveň optimální a nemusí se nic dovysvětlovat.
    nejlepsi = _varianta(podle_id, [r["id"] for r in radky[:n]])

    meta = store.meta(pravidlo["code"])
    rozdil = (nejlepsi["prinos"] - vase["prinos"]) if vase else None
    return {
        "available": True,
        "zasah": zasah,
        "pocet": n,
        "ukazatel": {"code": pravidlo["code"], "name": meta.get("name", pravidlo["code"]),
                     "unit": meta.get("unit", ""), "pillar": PILLARS.get(meta.get("pillar", ""), "")},
        "median": round(kraj_med, 2) if kraj_med is not None else None,
        "mediany_pasem": [{"pasmo": PASMA[i][2], "median": round(m, 2)} for i, m in sorted(mediany.items())],
        "co": pravidlo["co"],
        "pozn_dat": ((pravidlo.get("pozn", "") + " ") if pravidlo.get("pozn") else "") + (
            "Zařízení je v kraji vzácné (většina obcí ho nemá), proto se hledají nejlidnatější obce, které ho nemají vůbec." if kraj_med == 0 else ""),
        "vase": vase,
        "nejlepsi": nejlepsi,
        "rozdil": rozdil,
        "rozdil_podil": round(rozdil / nejlepsi["prinos"] * 100, 1) if rozdil is not None and nejlepsi["prinos"] else None,
        "z": len(radky),
        "zebricek": [{"id": r["id"], "name": r["name"], "poradi": r["poradi"], "hodnota": round(r["hodnota"], 2),
                      "mezera": round(r["mezera"] * 100, 1), "prinos": r["prinos"], "vaha": round(r["vaha"]),
                      "pasmo": r["pasmo_label"]}
                     for r in radky[:20]],
        "pravidlo": ("Přínos = o kolik procent je obec horší než obvyklá hodnota (medián obcí své velikosti), "
                     "vynásobeno počtem lidí, kterých se ukazatel týká. Obec se srovnává jen s obcemi podobné "
                     "velikosti, jinak by ukazatele na tisíc obyvatel vždy vybraly největší město. "
                     "Je to pořadí potřebnosti, ne předpověď dopadu: docházkové vzdálenosti ani kapacity "
                     "v otevřených datech nejsou."),
    }
