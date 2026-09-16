"""Co si obec sama naplánovala a co o ní stát zveřejňuje.

Obec není firma, která by si cíle nechávala pro sebe. Většinu toho, co chce
postavit a kolik na to má, musí zveřejnit — jenže každá povinnost končí
v jiném registru a dohromady je to nikde. Tahle vrstva je dává na jedno
místo, obec po obci:

1. **Program rozvoje obce** (obcepro.cz, MMR) — dokument, ve kterém obec sama
   napsala, co chce do kdy udělat. Nese období platnosti, takže se z něj dá
   spočítat, kolik z něj uplynulo a jestli ještě platí. Zveřejnění je
   dobrovolné, takže ho má jen část obcí.
2. **Územní plán a jeho změny** (evidence ÚPD Královéhradeckého kraje) —
   závazné pravidlo, co se kde smí stavět, i s každou změnou, datem vydání
   a vlastní stránkou dokumentu. Je to nejobjemnější zdroj: skoro tři tisíce
   dokumentů proti třiceti programům rozvoje.
3. **Rozpočet a jeho plnění** (MONITOR státní pokladny, MF) — tentýž výkaz
   FIN 2-12 M, ze kterého přes ČSÚ MOS čerpá Hospodaření v KAM.
4. **Otevřená data obce** (NKOD) — povinně zveřejňované informace ve strojově
   čitelné podobě. Publikuje je málokterá obec a je to vidět.
5. **Identita úřadu** (ARES, registr OVM) — IČO a datová schránka. Bez IČO
   nevede do celostátních registrů žádná adresa.

**Co se tu netvrdí.** Kolik z plánu je hotové, nikdo strojově nezveřejňuje.
Neexistuje registr, kde by u jednotlivého záměru stálo „realizováno"; obce to
vyhodnocují vlastními zprávami v PDF, každá jinak. „Stav plnění" tady proto
znamená dvě věci, které doložit jdou — **jak je na tom dokument** (platí,
prošel, chybí) a **kolik z jeho období uplynulo** — a vedle nich stojí, co
obec za tu dobu proinvestovala. Že to jedno způsobilo druhé, se netvrdí:
rozpočtová skladba neví, co za peníze obec pořídila, a je to tady stejně jako
ve `finance.py`.

Ke každému údaji patří odkaz na originál. Údaj o cizím dokumentu bez cesty
k originálu je tvrzení z druhé ruky.
"""

from __future__ import annotations

import re
import urllib.parse
from datetime import UTC, datetime

from sqlalchemy import func, select

from ..db import session_scope
from ..models import Dataset, Dokument, Fact, Territory
from ..territory import HOME_KRAJ
from . import store
from .finance import KAPITAL, PRIJMY, TISIC

#: Kde jsou programy rozvoje pohromadě, když je obec nemá jen u sebe na webu.
OBCEPRO = "https://www.obcepro.cz/publikovane-dokumenty"
#: Poskytovatel v NKOD se adresuje přes tentýž registr OVM, ze kterého bereme
#: datové schránky — proto stačí IČO a nemusíme si pamatovat druhý klíč.
NKOD_OVM = "https://rpp-opendata.egon.gov.cz/odrpp/zdroj/orgán-veřejné-moci/{ico}"
NKOD_HLEDAT = "https://data.gov.cz/datové-sady?poskytovatel="
#: Evidence územně plánovací dokumentace kraje — celý seznam pro kontext.
UPD_SEZNAM = "https://up.khk.cz/upd/seznam"


class Povinnost:
    """Jeden druh dokumentu a to, čím je pro obec závazný.

    `zakon` je krátký štítek, ne citace — do popisky se delší text zalomí
    a druhý řádek vyjede z podbarvení. Celé vysvětlení patří do `popis`.
    """

    def __init__(self, klic: str, nazev: str, kdo: str, zakon: str, popis: str, zdroj: str):
        self.klic, self.nazev, self.kdo = klic, nazev, kdo
        self.zakon, self.popis, self.zdroj = zakon, popis, zdroj

    def jako_dict(self) -> dict:
        return {"klic": self.klic, "nazev": self.nazev, "kdo": self.kdo,
                "zakon": self.zakon, "popis": self.popis, "zdroj": self.zdroj}


POVINNOSTI: tuple[Povinnost, ...] = (
    Povinnost("pro", "Program rozvoje obce", "Ministerstvo pro místní rozvoj",
              "zveřejnění dobrovolné",
              "Co chce obec do kdy postavit a kam dát peníze. Ze zákona povinný není — obec ho "
              "potřebuje hlavně jako přílohu k žádostem o dotace. Má v názvu období platnosti.",
              "obcepro.cz (MMR)"),
    Povinnost("uzemni_plan", "Územní plán a jeho změny", "Královéhradecký kraj",
              "zákon č. 283/2021 Sb.",
              "Závazné pravidlo, co se kde smí stavět. Obec bez něj rozhoduje jen podle obecných "
              "pravidel stavebního zákona. Archivovaný dokument nahradil jiný — je to jediná "
              "informace o platnosti, kterou evidence strojově dává.",
              "Evidence ÚPD Královéhradeckého kraje"),
    Povinnost("rozpocet", "Rozpočet a jeho plnění", "Ministerstvo financí",
              "zákon č. 250/2000 Sb.",
              "Rozpočet, střednědobý výhled i závěrečný účet musí obec schválit a zveřejnit. "
              "Výkaz FIN 2-12 M je tentýž zdroj, ze kterého čerpá Hospodaření v KAM.",
              "MONITOR státní pokladny (MF)"),
    Povinnost("otevrena_data", "Otevřená data obce", "Digitální a informační agentura",
              "zákon č. 106/1999 Sb.",
              "Povinně zveřejňované informace mají být i ve strojově čitelné podobě v Národním "
              "katalogu otevřených dat. Publikuje je málokterá obec a je to na číslech vidět.",
              "NKOD"),
)
POVINNOST_PODLE = {p.klic: p for p in POVINNOSTI}


class Registr:
    """Celostátní registr, do kterého se dá vstoupit přes IČO úřadu.

    `sablona` je celá adresa, ne základ — odkaz, který skončí na vyhledávacím
    formuláři, po člověku chce práci, kterou za něj měla udělat aplikace.
    """

    def __init__(self, klic: str, nazev: str, kdo: str, co: str, sablona: str, povinnost: str):
        self.klic, self.nazev, self.kdo, self.co = klic, nazev, kdo, co
        self.sablona, self.povinnost = sablona, povinnost

    def url(self, ico: str) -> str:
        return self.sablona.format(ico=ico)

    def jako_dict(self, ico: str) -> dict:
        return {"klic": self.klic, "nazev": self.nazev, "kdo": self.kdo, "co": self.co,
                "povinnost": self.povinnost, "url": self.url(ico)}


REGISTRY: tuple[Registr, ...] = (
    Registr("monitor", "MONITOR státní pokladny", "Ministerstvo financí",
            "Rozpočet, jeho plnění a účetní výkazy obce rok po roce. Je to tentýž výkaz "
            "FIN 2-12 M, ze kterého přes ČSÚ MOS čerpá Hospodaření v KAM.",
            "https://monitor.statnipokladna.gov.cz/ucetni-jednotka/{ico}/rozpocet-obce",
            # Popiska je štítek, ne věta: delší text se v ní zalomí na dva řádky
            # a druhý vyjede z podbarvení. Celou povinnost říká `co` nad ní.
            "Zákon č. 250/2000 Sb. — rozpočtová pravidla"),
    Registr("smlouvy", "Registr smluv", "Ministerstvo vnitra",
            "Každá smlouva obce nad 50 000 Kč bez DPH. Nezveřejněná smlouva je ze zákona "
            "neúčinná, takže do registru se dostane prakticky všechno.",
            "https://smlouvy.gov.cz/vyhledavani?subject_idnum={ico}",
            "Zákon č. 340/2015 Sb. — registr smluv"),
    Registr("ares", "ARES — ekonomické subjekty", "Ministerstvo financí",
            "Identita úřadu: IČO, právní forma, sídlo, datum vzniku. Klíč do všech "
            "ostatních registrů.",
            "https://ares.gov.cz/ekonomicke-subjekty/res/{ico}",
            "Zákon č. 111/2009 Sb. — základní registry"),
)

_DATUM = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def _letos() -> int:
    return datetime.now(UTC).year


def _stav(od: int, do: int, letos: int) -> str:
    """`plati` | `konci` | `prosly` | `bez_obdobi`."""
    if not do:
        return "bez_obdobi"
    if do < letos:
        return "prosly"
    if do == letos:
        return "konci"
    return "plati"


def _uplynulo(od: int, do: int, letos: int) -> float | None:
    """Podíl období, který už uplynul. Roky se počítají včetně krajních."""
    if not od or not do or do < od:
        return None
    let = do - od + 1
    return max(0.0, min(1.0, (letos - od + 1) / let))


def _plan_dict(d: Dokument, letos: int) -> dict:
    return {
        "nazev": d.nazev, "od": d.od, "do": d.do,
        "publikovano": d.publikovano.date().isoformat() if d.publikovano else None,
        "url": d.url, "zdroj": d.zdroj, "zdroj_nazev": d.zdroj_nazev, "zdroj_url": d.zdroj_url,
        "stav": _stav(d.od, d.do, letos), "uplynulo": _uplynulo(d.od, d.do, letos),
        "zbyva_let": max(0, d.do - letos) if d.do else None,
    }


def _investice(tid: str, od: int, do: int) -> dict | None:
    """Kapitálové výdaje za roky, které spadají do období plánu.

    Vrací jen to, co je v datech; chybějící roky se nedopočítávají. `do_dat`
    proto může být dřív než konec plánu a stránka to má říct nahlas.
    """
    kap = store.series(tid, KAPITAL)
    prij = store.series(tid, PRIJMY)
    roky = sorted(y for y in kap if od <= y <= do)
    if not roky:
        return None
    soucet = sum(kap[y] for y in roky) * TISIC
    prijmy = sum(prij[y] for y in roky if y in prij) * TISIC
    return {
        "od_dat": roky[0], "do_dat": roky[-1], "roky": len(roky),
        "kapital": round(soucet), "prijmy": round(prijmy),
        "podil": round(soucet / prijmy, 4) if prijmy > 0 else None,
    }


def _programy(ids: list[str]) -> dict[str, Dokument]:
    """Nejnovější program rozvoje pro každé z území."""
    with session_scope() as s:
        rows = list(s.scalars(select(Dokument).where(Dokument.uzemi_id.in_(ids), Dokument.druh == "pro")))
        for d in rows:
            s.expunge(d)
    podle: dict[str, Dokument] = {}
    for d in rows:
        star = podle.get(d.uzemi_id)
        if star is None or (d.do or 0) > (star.do or 0):
            podle[d.uzemi_id] = d
    return podle


def _upd(ids: list[str]) -> dict[str, list[Dokument]]:
    """Územně plánovací dokumentace obcí, od nejnovější."""
    with session_scope() as s:
        rows = list(s.scalars(select(Dokument).where(
            Dokument.uzemi_id.in_(ids), Dokument.druh == "upd")))
        for d in rows:
            s.expunge(d)
    podle: dict[str, list[Dokument]] = {}
    for d in rows:
        podle.setdefault(d.uzemi_id, []).append(d)
    for v in podle.values():
        v.sort(key=lambda d: (d.publikovano is not None, d.publikovano or datetime.min.replace(tzinfo=UTC)),
               reverse=True)
    return podle


def _upd_dict(d: Dokument) -> dict:
    return {"nazev": d.nazev, "datum": d.publikovano.date().isoformat() if d.publikovano else None,
            "url": d.url, "zdroj_url": d.zdroj_url, "stav": d.stav}


def _uzemni_plany(ids: list[str]) -> dict[str, Fact]:
    with session_scope() as s:
        rows = list(s.scalars(select(Fact).where(Fact.territory_id.in_(ids), Fact.key == "uzemni_plan")))
        for f in rows:
            s.expunge(f)
    return {f.territory_id: f for f in rows}


def _identita(ids: list[str]) -> dict[str, tuple[str, str]]:
    with session_scope() as s:
        return {t.id: (t.ico or "", t.ds or "")
                for t in s.scalars(select(Territory).where(Territory.id.in_(ids)))}


def _sady_obci(ica: list[str]) -> dict[str, int]:
    """Kolik datových sad obec sama vydala do NKOD, podle IČO vydavatele."""
    if not ica:
        return {}
    with session_scope() as s:
        return dict(s.execute(
            select(Dataset.publisher_ico, func.count())
            .where(Dataset.publisher_ico.in_(ica))
            .group_by(Dataset.publisher_ico)).all())


def _nkod_url(ico: str) -> str:
    return NKOD_HLEDAT + urllib.parse.quote(NKOD_OVM.format(ico=ico), safe="")


def _radek(klic: str, stav: str, nazev: str, **extra) -> dict:
    p = POVINNOST_PODLE[klic]
    return {"druh": klic, "povinnost": p.nazev, "zakon": p.zakon, "zdroj": p.zdroj,
            "kdo": p.kdo, "popis": p.popis, "stav": stav, "nazev": nazev, **extra}


def _dokumenty(tid: str, ico: str, letos: int, prog: Dokument | None, up: Fact | None,
               sad: int, upd: list[Dokument] | None = None) -> list[dict]:
    """Čtyři povinnosti jedním seznamem, v pořadí od plánu k datům.

    Chybějící dokument je taky řádek: prázdné místo v seznamu by se dalo
    přehlédnout, kdežto „není v registru" je odpověď.
    """
    ven: list[dict] = []

    if prog is not None:
        ven.append(_radek("pro", _stav(prog.od, prog.do, letos), prog.nazev,
                          od=prog.od, do=prog.do, uplynulo=_uplynulo(prog.od, prog.do, letos),
                          datum=prog.publikovano.date().isoformat() if prog.publikovano else None,
                          url=prog.url, zdroj_url=OBCEPRO))
    else:
        ven.append(_radek("pro", "chybi", "Není v registru MMR", url="", zdroj_url=OBCEPRO))

    upd = upd or []
    platne = [d for d in upd if d.stav != "archiv"]
    if platne:
        # Nejnovější neachivovaný dokument je ten, podle kterého se dnes staví;
        # zbytek jsou starší vrstvy a změny a patří do výpisu pod ním.
        hlavni = platne[0]
        ven.append(_radek("uzemni_plan", "plati", hlavni.nazev,
                          datum=hlavni.publikovano.date().isoformat() if hlavni.publikovano else None,
                          od=hlavni.od, pocet=len(upd), platnych=len(platne),
                          url=hlavni.url, zdroj_url=hlavni.zdroj_url))
    elif upd:
        ven.append(_radek("uzemni_plan", "prosly",
                          f"{len(upd)} dokumentů, všechny archivované",
                          pocet=len(upd), platnych=0,
                          url=upd[0].url, zdroj_url=upd[0].zdroj_url))
    elif up is not None and up.value.startswith("ano"):
        # Kraj obec v evidenci ÚPD nemá, ale ve svých datech tvrdí, že plán má.
        # Rozpor se nezamlčuje: řádek to přizná a odkáže na zdroj toho tvrzení.
        m = _DATUM.search(up.value)
        ven.append(_radek("uzemni_plan", "plati", "Územní plán podle dat kraje",
                          datum=m.group(0) if m else None, pocet=0, platnych=0,
                          url=up.source_url, zdroj_url=up.source_url))
    else:
        ven.append(_radek("uzemni_plan", "chybi", "Obec územní plán nemá",
                          pocet=0, platnych=0,
                          url="", zdroj_url=up.source_url if up else UPD_SEZNAM))

    rok = store.latest(tid, PRIJMY)
    if rok is not None:
        # Rok je v názvu; kdyby šel i do pole `datum`, stránka ho zformátuje
        # jako datum a vyjde „1. 1. 2025" — údaj, který nikdo neřekl.
        ven.append(_radek("rozpocet", "plati", f"Plnění rozpočtu za rok {rok[0]}",
                          od=rok[0],
                          url=f"https://monitor.statnipokladna.gov.cz/ucetni-jednotka/{ico}/rozpocet-obce" if ico else "",
                          zdroj_url="https://monitor.statnipokladna.gov.cz/"))
    else:
        ven.append(_radek("rozpocet", "chybi", "Rozpočtová data nemáme", url="",
                          zdroj_url="https://monitor.statnipokladna.gov.cz/"))

    if sad > 0 and ico:
        ven.append(_radek("otevrena_data", "plati",
                          f"{sad} datových sad v NKOD", pocet=sad,
                          url=_nkod_url(ico), zdroj_url="https://data.gov.cz/"))
    else:
        ven.append(_radek("otevrena_data", "chybi", "Obec do NKOD nic nevydává",
                          pocet=0, url="", zdroj_url="https://data.gov.cz/"))

    return ven


POZNAMKA = (
    "Co z plánu je hotové, nezveřejňuje strojově čitelně žádný registr. KAM proto "
    "ukazuje jen to, co jde doložit: jestli dokument platí, kolik z jeho období "
    "uplynulo a kolik obec za tu dobu poslala do majetku. Že to jedno způsobilo "
    "druhé, rozpočtová skladba neví."
)


def uzemi(tid: str) -> dict | None:
    """Povinné zveřejnění pro jedno území: dokumenty, peníze, registry, odkazy."""
    t = store.territory(tid)
    if t is None:
        return None
    letos = _letos()
    prog = _programy([tid]).get(tid)
    up = _uzemni_plany([tid]).get(tid)
    upd = _upd([tid]).get(tid, [])
    ico, ds = _identita([tid]).get(tid, ("", ""))
    sad = _sady_obci([ico]).get(ico, 0) if ico else 0

    plan = _plan_dict(prog, letos) if prog else None
    if plan and prog is not None and prog.od and prog.do:
        plan["investice"] = _investice(tid, prog.od, prog.do)

    return {
        "territory": {"id": t.id, "name": t.name, "level": t.level, "population": t.population},
        "ico": ico, "ds": ds,
        "plan": plan,
        "dokumenty": _dokumenty(tid, ico, letos, prog, up, sad, upd),
        "upd": [_upd_dict(d) for d in upd],
        "registry": [r.jako_dict(ico) for r in REGISTRY] if ico else [],
        "obcepro_url": OBCEPRO,
        "poznamka": POZNAMKA,
    }


def prehled(kraj: int = HOME_KRAJ) -> dict:
    """Kraj: co která obec zveřejnila a kolik jich co má."""
    letos = _letos()
    obce = store.members("obec", kraj_code=kraj)
    ids = [t.id for t in obce]
    programy = _programy(ids)
    plany_uzemni = _uzemni_plany(ids)
    upd_vse = _upd(ids)
    identita = _identita(ids)
    sady = _sady_obci([v[0] for v in identita.values() if v[0]])

    seznam: list[dict] = []
    pocty = {"plati": 0, "konci": 0, "prosly": 0, "bez_obdobi": 0, "chybi": 0}
    ma_celkem = {p.klic: 0 for p in POVINNOSTI}
    konce: dict[int, int] = {}

    for t in obce:
        d = programy.get(t.id)
        up = plany_uzemni.get(t.id)
        ico, ds = identita.get(t.id, ("", ""))
        stav = _stav(d.od, d.do, letos) if d else "chybi"
        pocty[stav] += 1

        sad = sady.get(ico, 0) if ico else 0
        upd = upd_vse.get(t.id, [])
        platne = [d for d in upd if d.stav != "archiv"]
        ma_up = bool(platne) or (up is not None and up.value.startswith("ano"))
        ma_rozpocet = store.latest(t.id, PRIJMY) is not None
        ma = {"pro": d is not None, "uzemni_plan": ma_up,
              "rozpocet": ma_rozpocet, "otevrena_data": sad > 0}
        for k, v in ma.items():
            ma_celkem[k] += int(v)

        radek: dict = {
            "id": t.id, "name": t.name, "population": t.population,
            "orp_id": t.orp_id, "ico": ico, "ds": ds, "stav": stav,
            "ma": ma, "sad": sad,
            "upd_celkem": len(upd), "upd_platnych": len(platne),
            "upd_od": platne[0].od if platne and platne[0].od else None,
        }
        if d is not None:
            radek |= {
                "nazev": d.nazev, "od": d.od, "do": d.do, "url": d.url,
                "uplynulo": _uplynulo(d.od, d.do, letos),
                "publikovano": d.publikovano.date().isoformat() if d.publikovano else None,
            }
            if d.do:
                konce[d.do] = konce.get(d.do, 0) + 1
        seznam.append(radek)

    seznam.sort(key=lambda r: (r["stav"] == "chybi", -(r["population"] or 0)))
    s_planem = len(obce) - pocty["chybi"]
    return {
        "kraj": {"code": kraj, "obci": len(obce)},
        "letos": letos,
        "s_planem": s_planem,
        "pokryti": round(s_planem / len(obce), 4) if obce else 0.0,
        "pocty": pocty,
        "ma_celkem": ma_celkem,
        # Skutečný počet sklizených dokumentů, ne součet zaškrtnutých políček:
        # rozpočet ani otevřená data nejsou dokument, který bychom drželi.
        "dokumentu": len(programy) + sum(len(v) for v in upd_vse.values()),
        "upd_celkem": sum(len(v) for v in upd_vse.values()),
        "s_ico": sum(1 for v in identita.values() if v[0]),
        "s_ds": sum(1 for v in identita.values() if v[1]),
        "obyvatel_s_planem": sum(r["population"] or 0 for r in seznam if r["stav"] != "chybi"),
        "obyvatel_celkem": sum(r["population"] or 0 for r in seznam),
        "konce": [{"rok": r, "pocet": konce[r]} for r in sorted(konce)],
        "seznam": seznam,
        "povinnosti": [p.jako_dict() for p in POVINNOSTI],
        "registry": [{"klic": r.klic, "nazev": r.nazev, "kdo": r.kdo, "co": r.co,
                      "povinnost": r.povinnost} for r in REGISTRY],
        "obcepro_url": OBCEPRO,
        "poznamka": (
            "Program rozvoje obce není ze zákona povinný — obec ho potřebuje hlavně "
            "kvůli dotacím. Na obcepro.cz ho navíc zveřejňuje jen část obcí, takže "
            "„chybí“ tady znamená „není v registru MMR“, ne „obec nic neplánuje“."
        ),
    }
