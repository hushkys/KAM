"""Dotace pro dané území: kolik doteklo, jak si stojí a kam se obrátit.

Tři vrstvy, každá z jiného zdroje a každá s jinou jistotou:

1. **Kolik obec reálně přijala** — roční řada z ČSÚ MOS („Přijaté dotace",
   200302). Tvrdé číslo z rozpočtu, 2005–2025.
2. **Kolik kraj poslal do jejího ORP a okresu** — programové a individuální
   dotace Královéhradeckého kraje 2021–2025 z Data KHK, včetně pořadí mezi
   patnácti ORP a částky na obyvatele.
3. **Kam se obrátit** — seznam vyhlašovatelů podle oblastí, ve kterých má
   území podle rizikového modelu problém.

Třetí vrstva je **rozcestník, ne živý seznam výzev**. Strojově čitelný registr
otevřených výzev pro obce v Česku neexistuje: kraje i ministerstva je
zveřejňují jako HTML stránky, a vytáhnout z nich termíny a podmínky by
znamenalo hádat. Aplikace proto neříká „máte nárok" — to umí posoudit jen
vyhlašovatel — ale říká, který vyhlašovatel na danou oblast peníze dává
a kde má svoje výzvy. Odkazy byly ověřené, že odpovídají.
"""

from __future__ import annotations

from . import risks, store
from ..indicators import PILLARS

CERPANI = "200302"     # MOS: přijaté dotace, tis. Kč
OBYV = "110900"
KRAJ_KODY = ("dot_prog_castka", "dot_prog_pocet", "dot_indiv_castka", "dot_indiv_pocet")
TISIC = 1000.0


class Zdroj:
    """Vyhlašovatel dotací a oblasti, do kterých dává peníze."""

    def __init__(self, nazev: str, kdo: str, url: str, pilire: tuple[str, ...], pozn: str):
        self.nazev, self.kdo, self.url, self.pilire, self.pozn = nazev, kdo, url, pilire, pozn


# Pořadí je záměrné: nejblíž obci je kraj, pak evropské programy, pak resorty.
ZDROJE: tuple[Zdroj, ...] = (
    Zdroj("Dotační portál Královéhradeckého kraje", "Královéhradecký kraj", "https://dotace.khk.cz/",
          ("demografie", "doprava", "skolstvi", "zdravotnictvi", "socialni", "bydleni", "prostredi", "kultura", "finance"),
          "Programové i individuální dotace kraje. Nejbližší zdroj pro obec v KHK."),
    Zdroj("IROP — Integrovaný regionální operační program", "Ministerstvo pro místní rozvoj", "https://irop.gov.cz/cs/vyzvy",
          ("doprava", "skolstvi", "zdravotnictvi", "socialni", "bydleni", "kultura"),
          "Evropské peníze na infrastrukturu obcí: školy, sociální služby, doprava, památky."),
    Zdroj("Národní dotace MMR", "Ministerstvo pro místní rozvoj", "https://mmr.gov.cz/cs/narodni-dotace",
          ("bydleni", "demografie", "kultura", "finance"),
          "Podpora obnovy a rozvoje venkova, bydlení, cestovního ruchu."),
    Zdroj("Státní fond životního prostředí", "SFŽP ČR", "https://sfzp.gov.cz/dotace-a-pujcky/",
          ("prostredi",),
          "Voda, odpady, ovzduší, energetické úspory budov, zeleň."),
    Zdroj("Státní fond podpory investic", "SFPI", "https://sfpi.cz/",
          ("bydleni",),
          "Nájemní bydlení, opravy bytového fondu, technická infrastruktura."),
    Zdroj("Dotace v zemědělství a na venkově", "SZIF / Ministerstvo zemědělství", "https://szif.gov.cz/cs/",
          ("prostredi", "socialni"),
          "Program rozvoje venkova, krajina, hospodaření s vodou v krajině."),
    Zdroj("Dotační programy Ministerstva zemědělství", "Ministerstvo zemědělství", "https://mze.gov.cz/public/portal/mze/dotace",
          ("prostredi",),
          "Vodovody a kanalizace pro obce, lesy, rybníky."),
    Zdroj("Dotace ve školství", "Ministerstvo školství, mládeže a tělovýchovy", "https://msmt.gov.cz/vzdelavani/skolstvi-v-cr/ekonomika-skolstvi/dotacni-programy",
          ("skolstvi",),
          "Provoz a rozvoj škol, které obec zřizuje."),
    Zdroj("Národní sportovní agentura", "NSA", "https://nsa.gov.cz/",
          ("kultura", "socialni"),
          "Sportoviště a jejich provoz."),
    Zdroj("Dotace Ministerstva kultury", "Ministerstvo kultury", "https://www.mk.gov.cz/",
          ("kultura",),
          "Památková péče, knihovny, kulturní aktivity."),
    Zdroj("Dotace Ministerstva práce a sociálních věcí", "MPSV", "https://mpsv.gov.cz/",
          ("socialni", "demografie"),
          "Sociální služby, zaměstnanost, rodinná politika."),
    Zdroj("Dotace Ministerstva zdravotnictví", "Ministerstvo zdravotnictví", "https://mzd.gov.cz/",
          ("zdravotnictvi",),
          "Dostupnost zdravotní péče, prevence."),
    Zdroj("Dotace Ministerstva vnitra", "Ministerstvo vnitra", "https://mv.gov.cz/",
          ("socialni", "bydleni"),
          "Jednotky sborů dobrovolných hasičů, prevence kriminality."),
    Zdroj("Podnikání a inovace", "Ministerstvo průmyslu a obchodu", "https://mpo.gov.cz/cz/podnikani/dotace-a-podpora-podnikani/",
          ("socialni", "finance"),
          "Podpora podnikání a zaměstnanosti v území."),
    Zdroj("Evropské fondy v ČR", "Ministerstvo pro místní rozvoj", "https://www.dotaceeu.cz/cs/uvod",
          ("demografie", "doprava", "skolstvi", "zdravotnictvi", "socialni", "bydleni", "prostredi", "kultura", "finance"),
          "Rozcestník všech operačních programů a jejich výzev."),
)


def _rada(tid: str) -> list[dict]:
    cerp = store.series(tid, CERPANI)
    obyv = store.series(tid, OBYV)
    return [{"year": y, "castka": round(v * TISIC), "na_obyvatele": round(v * TISIC / obyv[y]) if obyv.get(y) else None}
            for y, v in sorted(cerp.items())]


def _kraj_dotace(tid: str) -> dict | None:
    """Krajské dotace pro ORP nebo okres, do kterého území patří."""
    t = store.territory(tid)
    if t is None:
        return None
    cil = tid if t.level in ("orp", "okres") else (t.orp_id or t.okres_id)
    if not cil:
        return None
    ct = store.territory(cil)
    if ct is None:
        return None
    hodnoty = {k: (store.latest(cil, k) or (None, None))[1] for k in KRAJ_KODY}
    if hodnoty["dot_prog_castka"] is None and hodnoty["dot_indiv_castka"] is None:
        return None
    obyv = (store.latest(cil, OBYV) or (None, None))[1]
    celkem = (hodnoty["dot_prog_castka"] or 0) + (hodnoty["dot_indiv_castka"] or 0)

    # Pořadí mezi sourozenci: na obyvatele, protože v absolutních číslech
    # vyhraje Hradec Králové vždycky a nic to neřekne.
    radek = []
    for s in store.members(ct.level, ct.kraj_code):
        p = (store.latest(s.id, "dot_prog_castka") or (None, 0))[1] or 0
        i = (store.latest(s.id, "dot_indiv_castka") or (None, 0))[1] or 0
        o = (store.latest(s.id, OBYV) or (None, None))[1]
        if o:
            radek.append((s.id, s.name, (p + i) / o))
    radek.sort(key=lambda r: -r[2])
    poradi = next((i + 1 for i, r in enumerate(radek) if r[0] == cil), None)

    return {
        "uzemi": {"id": cil, "name": ct.name, "level": ct.level},
        "programove": hodnoty["dot_prog_castka"], "programove_pocet": hodnoty["dot_prog_pocet"],
        "individualni": hodnoty["dot_indiv_castka"], "individualni_pocet": hodnoty["dot_indiv_pocet"],
        "celkem": celkem,
        "na_obyvatele": round(celkem / obyv) if obyv else None,
        "poradi": poradi, "z_celkem": len(radek),
        "median_na_obyvatele": round(sorted(r[2] for r in radek)[len(radek) // 2]) if radek else None,
        "zebricek": [{"id": r[0], "name": r[1], "na_obyvatele": round(r[2])} for r in radek],
    }


def prehled(tid: str) -> dict:
    t = store.territory(tid)
    if t is None:
        return {}
    rada = _rada(tid)
    kraj = _kraj_dotace(tid)

    # Oblasti, ve kterých má území problém — podle rizikového modelu, ne podle
    # dojmu. Bez rizik se nabídne rozcestník pro všechny oblasti.
    rizika = risks.assess(tid) if t.level in ("obec", "orp", "okres", "kraj") else []
    pilire = [p for p in dict.fromkeys(r.get("pillar") for r in rizika if r.get("pillar")) if p in PILLARS]
    doporucene = [z for z in ZDROJE if not pilire or any(p in z.pilire for p in pilire)]
    ostatni = [z for z in ZDROJE if z not in doporucene]

    def ven(z: Zdroj, proc: list[str]) -> dict:
        return {"nazev": z.nazev, "kdo": z.kdo, "url": z.url, "pozn": z.pozn,
                "oblasti": [PILLARS[p] for p in z.pilire if p in PILLARS],
                "kvuli": [PILLARS[p] for p in proc if p in PILLARS]}

    return {
        "territory": {"id": t.id, "name": t.name, "level": t.level},
        "cerpani": rada,
        "cerpani_celkem": sum(r["castka"] for r in rada[-5:]) if rada else 0,
        "cerpani_roky": [rada[-5]["year"], rada[-1]["year"]] if len(rada) >= 5 else ([rada[0]["year"], rada[-1]["year"]] if rada else None),
        "kraj": kraj,
        "rizikove_oblasti": [PILLARS[p] for p in pilire],
        "zdroje": [ven(z, [p for p in pilire if p in z.pilire]) for z in doporucene],
        "dalsi_zdroje": [ven(z, []) for z in ostatni],
        "zdroj_dat": "ČSÚ MOS (přijaté dotace) · Data KHK (dotace kraje 2021–2025)",
        "poznamka": ("Seznam vyhlašovatelů je rozcestník, ne živý seznam otevřených výzev. "
                     "Nárok posuzuje vždy vyhlašovatel podle podmínek konkrétní výzvy."),
    }
