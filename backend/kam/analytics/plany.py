"""Co si obec sama naplánovala a co o tom musí zveřejnit.

Obec není firma, která by si cíle nechávala pro sebe. Většinu toho, co chce
postavit a kolik na to má, musí zveřejnit — a několik z těch povinností má
svůj celostátní registr. Tahle vrstva je dává dohromady na jedno místo:

1. **Program rozvoje obce** (obcepro.cz, MMR) — dokument, ve kterém obec sama
   napsala, co chce do kdy udělat. Nese období platnosti, takže se z něj dá
   spočítat, kolik z něj uplynulo a jestli ještě platí.
2. **Rozpočet a jeho plnění** (MONITOR státní pokladny, MF) — kolik obec za tu
   dobu opravdu poslala do majetku. Ta čísla už v aplikaci jsou, protože je
   ČSÚ MOS přebírá z téhož výkazu FIN 2-12 M.
3. **Smlouvy nad 50 000 Kč** (registr smluv, MV) — bez zveřejnění jsou
   neúčinné, takže tam skutečně jsou. Nepočítáme je, jen na ně vedeme přesný
   odkaz: strop výsledků ve vyhledávání je 10 000 a číslo, které se o strop
   opře, není číslo.
4. **Identita úřadu** (ARES, registr OVM) — IČO a datová schránka. Bez IČO
   nevede do prvních tří registrů žádná adresa.

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

from datetime import UTC, datetime

from sqlalchemy import select

from ..db import session_scope
from ..models import Dokument, Territory
from ..territory import HOME_KRAJ
from . import store
from .finance import KAPITAL, PRIJMY, TISIC

#: Druhy dokumentů, které umíme sklidit. Klíč je `Dokument.druh`.
DRUHY = {"pro": "Program rozvoje obce"}


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

#: Kde jsou programy rozvoje pohromadě, když je obec nemá jen u sebe na webu.
OBCEPRO = "https://www.obcepro.cz/publikovane-dokumenty"


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


def _dokumenty(ids: list[str]) -> dict[str, Dokument]:
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


def _ico_ds(ids: list[str]) -> dict[str, tuple[str, str]]:
    with session_scope() as s:
        return {t.id: (t.ico or "", t.ds or "")
                for t in s.scalars(select(Territory).where(Territory.id.in_(ids)))}


def uzemi(tid: str) -> dict | None:
    """Povinné zveřejnění pro jedno území: plán, peníze, registry, odkazy."""
    t = store.territory(tid)
    if t is None:
        return None
    letos = _letos()
    d = _dokumenty([tid]).get(tid)
    ico, ds = _ico_ds([tid]).get(tid, ("", ""))

    plan = _plan_dict(d, letos) if d else None
    if plan and d is not None and d.od and d.do:
        plan["investice"] = _investice(tid, d.od, d.do)

    return {
        "territory": {"id": t.id, "name": t.name, "level": t.level, "population": t.population},
        "ico": ico, "ds": ds,
        "plan": plan,
        "registry": [r.jako_dict(ico) for r in REGISTRY] if ico else [],
        "obcepro_url": OBCEPRO,
        "poznamka": (
            "Co z plánu je hotové, nezveřejňuje strojově čitelně žádný registr. "
            "KAM proto ukazuje jen to, co jde doložit: jestli dokument platí, kolik "
            "z jeho období uplynulo a kolik obec za tu dobu poslala do majetku. "
            "Že to jedno způsobilo druhé, rozpočtová skladba neví."
        ),
    }


def prehled(kraj: int = HOME_KRAJ) -> dict:
    """Kraj: kolik obcí má platný plán, kolik prošlý a kolik žádný."""
    letos = _letos()
    obce = store.members("obec", kraj_code=kraj)
    ids = [t.id for t in obce]
    doklady = _dokumenty(ids)
    identita = _ico_ds(ids)

    seznam: list[dict] = []
    pocty = {"plati": 0, "konci": 0, "prosly": 0, "bez_obdobi": 0, "chybi": 0}
    konce: dict[int, int] = {}
    for t in obce:
        d = doklady.get(t.id)
        ico, ds = identita.get(t.id, ("", ""))
        stav = _stav(d.od, d.do, letos) if d else "chybi"
        pocty[stav] += 1
        radek: dict = {
            "id": t.id, "name": t.name, "population": t.population,
            "orp_id": t.orp_id, "ico": ico, "ds": ds, "stav": stav,
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
        "s_ico": sum(1 for v in identita.values() if v[0]),
        "s_ds": sum(1 for v in identita.values() if v[1]),
        "obyvatel_s_planem": sum(r["population"] or 0 for r in seznam if r["stav"] != "chybi"),
        "obyvatel_celkem": sum(r["population"] or 0 for r in seznam),
        "konce": [{"rok": r, "pocet": konce[r]} for r in sorted(konce)],
        "seznam": seznam,
        "registry": [{"klic": r.klic, "nazev": r.nazev, "kdo": r.kdo, "co": r.co,
                      "povinnost": r.povinnost} for r in REGISTRY],
        "obcepro_url": OBCEPRO,
        "poznamka": (
            "Program rozvoje obce není ze zákona povinný — obec ho potřebuje hlavně "
            "kvůli dotacím. Na obcepro.cz ho navíc zveřejňuje jen část obcí, takže "
            "„chybí“ tady znamená „není v registru MMR“, ne „obec nic neplánuje“."
        ),
    }
