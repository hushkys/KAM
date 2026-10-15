"""Pětiminutová prezentace KAM do pozadí ukázky (5 snímků, přechod Morph).

    python scripts/prezentace_5min.py

Pořadí kopíruje ukázku: úvod → scénáře (hlavní část) → výhled a data →
podněty veřejnosti s okrajem hospodaření, plánů a dotací → otevřenost a tým.
Dole na každém snímku stojí, ke kterému kritériu poroty patří. Stavební kameny
(kruhy, texty, obrázky, Morph) jsou ze `scripts/prezentace.py`; čísla jdou
z `data/kam.db` a z běžícího API (výhled kraje), ne z ruky.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pptx import Presentation  # noqa: E402
from pptx.util import Inches  # noqa: E402

import prezentace as p  # noqa: E402
from prezentace import (BILA, FIALOVA, MODRA, ORANZOVA, PRYC, RUZOVA, SEDA, TEXT, TEXT_TUCNY,  # noqa: E402
                        TYRKYS, ZELENA, H, W, cz, kruh, morph, obrazek, pozadi, pruh, text)

API = "http://localhost:8000/api"


def vyhled_kraje() -> dict:
    """Výhled kraje z běžícího API; bez serveru prezentace vznikne bez těchto čísel."""
    try:
        with urllib.request.urlopen(f"{API}/forecast/kraj:86", timeout=60) as r:
            f = json.load(r)
        rok40 = next(x for x in f["scenarios"]["pravdepodobny"] if x["year"] == 2040)
        return {"dnes": int(f["base_population"]), "rok": f["base_year"], "p2040": rok40["population"],
                "chyba": f["backtest"]["mape"] if f.get("backtest", {}).get("available") else None}
    except Exception:
        return {}


def stavej() -> Path:
    c = p.cisla()
    v = vyhled_kraje()
    prs = Presentation()
    prs.slide_width, prs.slide_height = W, H
    prazdny = prs.slide_layouts[6]
    OBR = ["scenar", "pruvodce", "hospodareni", "plany"]  # záložní obrázky pro objekty mimo plochu

    def snimek(n: dict, prvni=False):
        s = prs.slides.add_slide(prazdny)
        pozadi(s)
        kruh(s, "!!kruh", *n["kruh"])
        kruh(s, "!!kruh2", *n["kruh2"])
        obr = n.get("obrazky", [])
        for i in range(4):
            ob = obr[i] if i < len(obr) else None
            if ob:
                obrazek(s, f"!!obr{i + 1}", *ob)
            else:
                obrazek(s, f"!!obr{i + 1}", OBR[i], PRYC, Inches(1), Inches(5))
        st = n.get("stitek")
        if st:
            text(s, "!!stitek", Inches(0.8), Inches(0.55), Inches(8), Inches(0.5), [(st[0], st[1])], 16, TEXT_TUCNY)
            pruh(s, Inches(0.8), Inches(1.05), Inches(0.9), st[1])
        vel = n["velky"]
        text(s, "!!velky", *vel["poloha"], vel["behy"], vel["velikost"])
        if n.get("sub"):
            sub = n["sub"]
            text(s, "!!sub", *sub["poloha"], [(sub["text"], SEDA)], sub.get("velikost", 22), TEXT, radkovani=1.05)
        for t in n.get("navic", []):
            text(s, *t)
        if n.get("krit"):
            text(s, "!!krit", Inches(0.8), Inches(6.95), Inches(11.5), Inches(0.35), [("Kritérium: ", SEDA), (n["krit"], n["krit_barva"])], 13, TEXT_TUCNY)
        morph(s, prvni)
        return s

    def cislo(jmeno, x, y, w, hodnota, popis, barva=BILA, vel=40):
        """Velké číslo a pod ním popisek menším písmem — dva prvky, ať má každý svou velikost."""
        vyska = Inches(vel * 1.25 / 72)
        return [(jmeno, x, y, w, vyska, [(hodnota, barva)], vel, p.NADPIS),
                (jmeno.replace("!!c", "!!l"), x, y + vyska, w, Inches(0.7), [(popis, SEDA)], 15, TEXT, p.PP_ALIGN.LEFT, p.MSO_ANCHOR.TOP, 1.05)]

    # 1 — úvod: kdo jsme a co KAM je, čtyři čísla
    snimek({
        "kruh": (Inches(7.4), Inches(-1.8), Inches(8.4), ZELENA, 70),
        "kruh2": (Inches(12.3), Inches(6.5), Inches(0.6), ORANZOVA),
        "velky": {"poloha": (Inches(0.8), Inches(1.0), Inches(12), Inches(2.4)), "behy": [("Popojedem", BILA), (".", ZELENA)], "velikost": 130},
        "sub": {"poloha": (Inches(0.85), Inches(3.25), Inches(11), Inches(1.2)),
                "text": "KAM — Krajský analytický model\notevřená data kraje, srozumitelně pro obce i veřejnost", "velikost": 26},
        "navic": [
            *cislo("!!c1", Inches(0.85), Inches(4.75), Inches(3.0), cz(c["funkcnich"]), "funkčních datových sad", ZELENA),
            *cislo("!!c2", Inches(3.95), Inches(4.75), Inches(3.0), cz(c["obci"]), "obcí s vlastním profilem"),
            *cislo("!!c3", Inches(7.05), Inches(4.75), Inches(3.0), cz(c["hodnot"]), "ověřených hodnot v modelu"),
            *cislo("!!c4", Inches(10.15), Inches(4.75), Inches(3.0), "20", "opatření ve scénářích"),
        ],
        "krit": "unikátnost — jeden nástroj od dat po rozhodnutí obce", "krit_barva": ZELENA,
    }, prvni=True)

    # 2 — scénáře (hlavní část ukázky)
    snimek({
        "kruh": (Inches(-3.2), Inches(-3.4), Inches(8.0), ORANZOVA, 45),
        "kruh2": (Inches(12.3), Inches(6.55), Inches(0.5), MODRA),
        "stitek": ("SCÉNÁŘE", ORANZOVA),
        "obrazky": [("scenar", Inches(7.05), Inches(1.15), Inches(5.9), 2.0), ("pruvodce", Inches(6.35), Inches(4.0), Inches(3.9), -3.0)],
        "velky": {"poloha": (Inches(0.8), Inches(1.3), Inches(6.2), Inches(1.9)), "behy": [("Co když…?", BILA)], "velikost": 82},
        "sub": {"poloha": (Inches(0.85), Inches(2.95), Inches(5.7), Inches(1.5)),
                "text": "Vyberete obec. Model najde její problémy, navrhne opatření i jejich velikost a spočítá dopad do roku 2040.", "velikost": 21},
        "navic": [
            ("!!b1", Inches(0.85), Inches(4.55), Inches(5.6), Inches(0.5), [("● ", ORANZOVA), ("Navrhne za vás: co a kolik přidat", BILA)], 19, TEXT_TUCNY),
            ("!!b2", Inches(0.85), Inches(5.1), Inches(5.6), Inches(0.5), [("● ", ORANZOVA), ("Dopad na školy, lékaře, péči i daně", BILA)], 19, TEXT_TUCNY),
            ("!!b3", Inches(0.85), Inches(5.65), Inches(5.6), Inches(0.5), [("● ", ORANZOVA), ("Kde v území opatření chybí nejvíc", BILA)], 19, TEXT_TUCNY),
        ],
        "krit": "unikátnost · využití pro kraj — podklad k rozhodnutí, ne jen graf", "krit_barva": ORANZOVA,
    })

    # 3 — výhled a data
    p2040 = cz(v["p2040"]) if v else "—"
    dnes = cz(v["dnes"]) if v else "—"
    chyba = f"{v['chyba']:.1f} %".replace(".", ",") if v.get("chyba") is not None else "—"
    snimek({
        "kruh": (Inches(8.6), Inches(-2.6), Inches(6.4), FIALOVA, 55),
        "kruh2": (Inches(6.3), Inches(6.5), Inches(0.5), FIALOVA),
        "stitek": ("VÝHLED A DATA", FIALOVA),
        "obrazky": [("vyhled", Inches(6.9), Inches(1.0), Inches(6.0), -1.5)],
        "velky": {"poloha": (Inches(0.8), Inches(1.3), Inches(6.0), Inches(1.9)), "behy": [("Výhled ", BILA), ("2040.", FIALOVA)], "velikost": 66},
        "sub": {"poloha": (Inches(0.85), Inches(2.85), Inches(5.7), Inches(1.4)),
                "text": "Kolik lidí bude v kraji i v každé obci, kolik dětí a seniorů — z dat ČSÚ, s pásmem nejistoty.", "velikost": 21},
        "navic": [
            *cislo("!!c1", Inches(0.85), Inches(4.1), Inches(2.9), p2040, f"obyvatel kraje v roce 2040\n(dnes {dnes})", FIALOVA, 34),
            *cislo("!!c2", Inches(3.85), Inches(4.1), Inches(2.9), chyba, "průměrná chyba\nzpětného testu", BILA, 34),
            *cislo("!!c3", Inches(0.85), Inches(5.55), Inches(2.9), str(c["nacteno"]), "sad čte model celé,\nhodnotu po hodnotě", BILA, 34),
            *cislo("!!c4", Inches(3.85), Inches(5.55), Inches(2.9), cz(c["funkcnich"]), "sad v katalogu,\nkaždá ověřená", BILA, 34),
        ],
        "krit": "otevřená data — ČSÚ, Data KHK, NKOD, MF ČR; u každého čísla odkaz na zdroj", "krit_barva": FIALOVA,
    })

    # 4 — podněty veřejnosti + okrajem hospodaření, plány, dotace
    snimek({
        "kruh": (Inches(7.4), Inches(2.6), Inches(7.0), MODRA, 55),
        "kruh2": (Inches(6.3), Inches(0.55), Inches(0.5), RUZOVA),
        "stitek": ("VEŘEJNOST", MODRA),
        "obrazky": [("podnety", Inches(7.0), Inches(1.0), Inches(5.9), 1.5),
                    ("hospodareni", Inches(0.85), Inches(4.75), Inches(1.85), 0),
                    ("plany", Inches(2.85), Inches(4.75), Inches(1.85), 0),
                    ("dotace", Inches(4.85), Inches(4.75), Inches(1.85), 0)],
        "velky": {"poloha": (Inches(0.8), Inches(1.3), Inches(6.0), Inches(1.9)), "behy": [("Hlas ", BILA), ("obyvatel.", MODRA)], "velikost": 60},
        "sub": {"poloha": (Inches(0.85), Inches(2.75), Inches(5.8), Inches(1.6)),
                "text": "Podnět se spojí s podobnými. Od 5 hlasů vznikne formální podnět kraji i s daty o území.", "velikost": 21},
        "navic": [
            ("!!cap1", Inches(0.85), Inches(6.1), Inches(1.9), Inches(0.6), [("Hospodaření\n", BILA), ("vydělává obec?", SEDA)], 12, TEXT_TUCNY),
            ("!!cap2", Inches(2.85), Inches(6.1), Inches(1.9), Inches(0.6), [("Plány\n", BILA), ("co platí a do kdy", SEDA)], 12, TEXT_TUCNY),
            ("!!cap3", Inches(4.85), Inches(6.1), Inches(1.9), Inches(0.6), [("Dotace\n", BILA), ("kolik a odkud", SEDA)], 12, TEXT_TUCNY),
        ],
        "krit": "využití pro veřejnost — podnět, hlas a cesta ke kraji bez úředního formuláře", "krit_barva": MODRA,
    })

    # 5 — otevřenost a tým
    tym = [("Ondřej Hušek", "vývoj, architektura, AI"), ("Matěj Jirásek", "UX/UI design"),
           ("Josef Efler", "brand, marketing, legal"), ("Damián Roháček", "backend, testování")]
    snimek({
        "kruh": (Inches(9.0), Inches(-2.8), Inches(6.8), ZELENA, 70),
        "kruh2": (Inches(12.3), Inches(6.5), Inches(0.5), TYRKYS),
        "stitek": ("OTEVŘENOST · TÝM", TYRKYS),
        "velky": {"poloha": (Inches(0.8), Inches(1.2), Inches(12), Inches(2.2)), "behy": [("Popojedem", BILA), (".", ZELENA)], "velikost": 120},
        "sub": {"poloha": (Inches(0.85), Inches(3.25), Inches(11.5), Inches(0.9)),
                "text": "Veřejné API /api/v1 · CSV · JSON · bez registrace — připravené pro Datový portál Data KHK", "velikost": 21},
        "navic": [
            *[(f"!!clen{i + 1}", Inches(0.85 + i * 3.1), Inches(4.4), Inches(3.0), Inches(1.0), [(f"{j}\n", BILA), (r, SEDA)], 18, TEXT_TUCNY,
               p.PP_ALIGN.LEFT, p.MSO_ANCHOR.TOP, 1.05) for i, (j, r) in enumerate(tym)],
            ("!!url", Inches(0.85), Inches(5.75), Inches(11), Inches(0.6), [("hack-a-ton-hushkys.web.app", ZELENA)], 26, TEXT_TUCNY),
        ],
        "krit": "využití pro kraj — vlastní API pro Data KHK, nasaditelné i pro další kraje", "krit_barva": TYRKYS,
    })

    cil = p.VYSTUP / "KAM_Popojedem_5min.pptx"
    p.VYSTUP.mkdir(exist_ok=True)
    prs.save(cil)
    return cil


if __name__ == "__main__":
    print(stavej())
