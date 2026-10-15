"""Indicator registry.

Each entry names where the number comes from. MOS (Městská a obecní
statistika, ČSÚ) republishes data produced by other agencies, so `origin`
keeps the original producer — a GP count is ÚZIS data even when we read it
from ČSÚ's file, and the UI says so.

`polarity` is +1 when a higher value is generally better for residents, -1
when lower is better and 0 when it is context, not a judgement (a count of
births is neither good nor bad on its own). The risk engine only reads
direction from derived indicators whose polarity is defensible.

`agg` says how obce roll up into ORP / okres / kraj: `sum` for counts,
`wavg:<code>` for rates weighted by another indicator, `wavg_pop` for 0/1
flags (share of residents living in an obec that has the thing).
"""

from __future__ import annotations

from dataclasses import dataclass

PILLARS: dict[str, str] = {
    "demografie": "Demografie",
    "doprava": "Doprava",
    "skolstvi": "Školství",
    "zdravotnictvi": "Zdravotnictví",
    "socialni": "Sociální oblast a trh práce",
    "bydleni": "Bydlení a rozvoj",
    "prostredi": "Životní prostředí",
    "kultura": "Kultura a cestovní ruch",
    "finance": "Veřejné finance",
}

MOS_URL = "https://csu.gov.cz/produkty/databaze-mos-otevrena-data"
MOS_FILE = "https://opendata.csu.gov.cz/soubory/od/od_mos01/"
DATAKHK_ARCGIS = "https://services6.arcgis.com/ogJAiK65nXL1mXAW/arcgis/rest/services/"


@dataclass(frozen=True)
class Ind:
    code: str
    name: str
    unit: str
    pillar: str
    polarity: int = 0
    agg: str = "sum"
    origin: str = "ČSÚ"
    source: str = "mos"  # mos | khk | derived


MOS: tuple[Ind, ...] = (
    # Demografie
    Ind("110900", "Počet obyvatel k 31. 12.", "osob", "demografie", 1),
    Ind("110930", "Obyvatelé ve věku 0–14 let", "osob", "demografie"),
    Ind("110990", "Obyvatelé ve věku 65+ let", "osob", "demografie"),
    Ind("111000", "Střední stav obyvatel k 1. 7.", "osob", "demografie"),
    Ind("110200", "Živě narození", "osob", "demografie"),
    Ind("110300", "Zemřelí", "osob", "demografie"),
    Ind("110350", "Přirozený přírůstek", "osob", "demografie", 1),
    Ind("110400", "Přistěhovalí", "osob", "demografie"),
    Ind("110500", "Vystěhovalí", "osob", "demografie"),
    Ind("110600", "Saldo migrace", "osob", "demografie", 1),
    Ind("110700", "Celkový přírůstek / úbytek", "osob", "demografie", 1),
    Ind("113000", "Průměrný věk", "let", "demografie", -1, "wavg:110900"),
    # Bydlení
    Ind("121800", "Dokončené byty", "bytů", "bydleni", 1),
    Ind("121810", "Dokončené byty v rodinných domech", "bytů", "bydleni"),
    Ind("121820", "Dokončené byty v bytových domech", "bytů", "bydleni"),
    Ind("420702", "Obydlené byty (SLDB 2021)", "bytů", "bydleni", 0, "sum", "ČSÚ, SLDB 2021"),
    Ind("420713", "Neobydlené byty (SLDB 2021)", "bytů", "bydleni", 0, "sum", "ČSÚ, SLDB 2021"),
    Ind("420105", "Obyvatelé bydlící v bytech (SLDB 2021)", "osob", "bydleni", 0, "sum", "ČSÚ, SLDB 2021"),
    # Školství
    Ind("040300", "Mateřské školy", "škol", "skolstvi", 1, "sum", "MŠMT ČR"),
    Ind("040310", "Děti v mateřských školách", "dětí", "skolstvi", 0, "sum", "MŠMT ČR"),
    Ind("040320", "Třídy mateřských škol", "tříd", "skolstvi", 1, "sum", "MŠMT ČR"),
    Ind("040500", "Základní školy s 1. a 2. stupněm", "škol", "skolstvi", 1, "sum", "MŠMT ČR"),
    Ind("040510", "Žáci ZŠ s 1. a 2. stupněm", "žáků", "skolstvi", 0, "sum", "MŠMT ČR"),
    Ind("040520", "Třídy ZŠ s 1. a 2. stupněm", "tříd", "skolstvi", 1, "sum", "MŠMT ČR"),
    Ind("040400", "Základní školy pouze s 1. stupněm", "škol", "skolstvi", 1, "sum", "MŠMT ČR"),
    Ind("040410", "Žáci ZŠ pouze s 1. stupněm", "žáků", "skolstvi", 0, "sum", "MŠMT ČR"),
    Ind("040420", "Třídy ZŠ pouze s 1. stupněm", "tříd", "skolstvi", 1, "sum", "MŠMT ČR"),
    # Zdravotnictví
    Ind("070700", "Ordinace praktického lékaře pro dospělé", "ordinací", "zdravotnictvi", 1, "sum", "ÚZIS"),
    Ind("070710", "Ordinace praktického lékaře pro děti a dorost", "ordinací", "zdravotnictvi", 1, "sum", "ÚZIS"),
    Ind("070720", "Ordinace stomatologa", "ordinací", "zdravotnictvi", 1, "sum", "ÚZIS"),
    Ind("070740", "Ordinace lékaře specialisty", "ordinací", "zdravotnictvi", 1, "sum", "ÚZIS"),
    Ind("071000", "Lékárny", "zařízení", "zdravotnictvi", 1, "sum", "ÚZIS"),
    Ind("070300", "Nemocnice", "zařízení", "zdravotnictvi", 1, "sum", "ÚZIS"),
    Ind("070320", "Lůžka nemocnic", "lůžek", "zdravotnictvi", 1, "sum", "ÚZIS"),
    # Sociální oblast a trh práce
    Ind("150159", "Domovy pro seniory", "zařízení", "socialni", 1, "sum", "MPSV ČR"),
    Ind("150160", "Místa v domovech pro seniory", "míst", "socialni", 1, "sum", "MPSV ČR"),
    Ind("150162", "Místa v domovech se zvláštním režimem", "míst", "socialni", 1, "sum", "MPSV ČR"),
    Ind("150154", "Místa v denních stacionářích", "míst", "socialni", 1, "sum", "MPSV ČR"),
    Ind("150164", "Místa v chráněném bydlení", "míst", "socialni", 1, "sum", "MPSV ČR"),
    Ind("600702", "Byty v domech s pečovatelskou službou", "bytů", "socialni", 1, "sum"),
    Ind("500020", "Podíl nezaměstnaných osob", "%", "socialni", -1, "wavg:pop1564", "GŘ ÚP ČR"),
    Ind("501000", "Uchazeči o zaměstnání", "osob", "socialni", -1, "sum", "GŘ ÚP ČR"),
    Ind("504010", "Uchazeči v evidenci déle než 12 měsíců", "osob", "socialni", -1, "sum", "GŘ ÚP ČR"),
    Ind("505000", "Volná pracovní místa", "míst", "socialni", 1, "sum", "GŘ ÚP ČR"),
    Ind("160100", "Podnikatelské subjekty", "subjektů", "socialni", 1, "sum"),
    # Doprava
    Ind("600501", "Délka místních komunikací", "km", "doprava", 0, "sum"),
    Ind("420511", "Vyjíždějící do zaměstnání a škol (SLDB 2021)", "osob", "doprava", 0, "sum", "ČSÚ, SLDB 2021"),
    Ind("420521", "Dojíždějící do zaměstnání a škol (SLDB 2021)", "osob", "doprava", 0, "sum", "ČSÚ, SLDB 2021"),
    # Životní prostředí
    Ind("142000", "Koeficient ekologické stability", "index", "prostredi", 1, "wavg:140100", "ČÚZK, výpočet ČSÚ"),
    Ind("140100", "Celková výměra", "ha", "prostredi", 0, "sum", "ČÚZK"),
    Ind("141000", "Lesní půda", "ha", "prostredi", 0, "sum", "ČÚZK"),
    Ind("140900", "Zemědělská půda", "ha", "prostredi", 0, "sum", "ČÚZK"),
    Ind("141300", "Zastavěné plochy", "ha", "prostredi", 0, "sum", "ČÚZK"),
    Ind("600101", "Veřejný vodovod v obci", "ano/ne", "prostredi", 1, "wavg_pop"),
    Ind("600201", "Veřejná kanalizace v obci", "ano/ne", "prostredi", 1, "wavg_pop"),
    Ind("600301", "Kanalizace s ČOV v obci", "ano/ne", "prostredi", 1, "wavg_pop"),
    # Veřejné finance
    Ind("200002", "Daňové příjmy obce", "tis. Kč", "finance", 1, "sum", "MF ČR"),
    Ind("200402", "Příjmy celkem (po konsolidaci)", "tis. Kč", "finance", 1, "sum", "MF ČR"),
    Ind("200702", "Výdaje celkem", "tis. Kč", "finance", 0, "sum", "MF ČR"),
    Ind("200602", "Kapitálové (investiční) výdaje", "tis. Kč", "finance", 1, "sum", "MF ČR"),
    Ind("200802", "Saldo příjmů a výdajů", "tis. Kč", "finance", 1, "sum", "MF ČR"),
    Ind("200302", "Přijaté dotace", "tis. Kč", "finance", 0, "sum", "MF ČR"),
)

# Counts computed from Data KHK point layers (one row per facility / stop).
KHK_POINTS: dict[str, tuple[str, str, str]] = {
    # service name: (indicator code, label, pillar)
    "Autobusové_zastávky_IREDO": ("khk_zast_bus", "Autobusové zastávky IREDO", "doprava"),
    "Železniční_stanice_a_zastávky_VDKHK": ("khk_zast_vlak", "Železniční stanice a zastávky", "doprava"),
    "Praktičtí_lékaři_pro_dospělé": ("khk_pl_dosp", "Praktičtí lékaři pro dospělé (místa poskytování)", "zdravotnictvi"),
    "Praktičtí_lékaři_pro_děti_a_dorost": ("khk_pl_deti", "Praktičtí lékaři pro děti a dorost", "zdravotnictvi"),
    "Zubní_lékaři": ("khk_zubni", "Zubní lékaři", "zdravotnictvi"),
    "Nemocnice": ("khk_nemocnice", "Nemocnice", "zdravotnictvi"),
    "Lékařská_pohotovostní_služba": ("khk_lps", "Lékařská pohotovostní služba", "zdravotnictvi"),
    "Výjezdové_základny_zdravotnické_záchranné_služby": ("khk_zzs", "Výjezdové základny ZZS", "zdravotnictvi"),
    "Mateřské_a_základní_školy": ("khk_skoly", "Mateřské a základní školy (subjekty)", "skolstvi"),
    "Poskytovatelé_sociálních_služeb": ("khk_soc", "Poskytovatelé sociálních služeb", "socialni"),
    # Every layer below is a point layer carrying `kod_obce`, so it counts per
    # obec through the same path as the ones above. Layers that measure the
    # same thing twice are deliberately absent: `Stomatologie` repeats
    # `Zubní_lékaři`, `Dokončené_byty_*` repeats MOS 121800, `Průměrný_věk`
    # and `Míra_nezaměstnanosti_*` repeat MOS series we already read.
    "Ambulantní_gynekologové": ("khk_gyn", "Ambulantní gynekologové", "zdravotnictvi"),
    "Odborné_léčebné_ústavy": ("khk_olu", "Odborné léčebné ústavy", "zdravotnictvi"),
    "Následná_péče": ("khk_nasledna", "Zařízení následné péče", "zdravotnictvi"),
    "Základní_umělecké_školy": ("khk_zus", "Základní umělecké školy", "skolstvi"),
    "Domovy_dětí_a_mládeže_a_střediska_volného_času": ("khk_ddm", "Domovy dětí a mládeže a střediska volného času", "skolstvi"),
    "Seznam_škol_a_školských_zařízení": ("khk_skolska", "Školy a školská zařízení všech stupňů", "skolstvi"),
    "Služebny_Policie_ČR": ("khk_policie", "Služebny Policie ČR", "socialni"),
    "Stanice_a_pracoviště_hasičského_záchranného_systému": ("khk_hasici", "Stanice a pracoviště HZS", "socialni"),
    "Letiště": ("khk_letiste", "Letiště", "doprava"),
    "Průmyslové_zóny": ("khk_prum_zony", "Průmyslové zóny", "finance"),
    "Inovativní_firmy": ("khk_inov_firmy", "Inovativní firmy", "finance"),
    "Inovační_infrastruktury": ("khk_inov_infra", "Inovační infrastruktury", "finance"),
    "Knihovny": ("khk_knihovny", "Knihovny", "kultura"),
    "Muzea_a_galerie": ("khk_muzea", "Muzea a galerie", "kultura"),
    "Kina": ("khk_kina", "Kina", "kultura"),
    "Divadla_a_filharmonie": ("khk_divadla", "Divadla a filharmonie", "kultura"),
    "Kulturní_domy": ("khk_kd", "Kulturní domy", "kultura"),
    "Infocentra": ("khk_infocentra", "Informační centra", "kultura"),
    "Hrady": ("khk_hrady", "Hrady", "kultura"),
    "Zámky": ("khk_zamky", "Zámky", "kultura"),
    "Rozhledny_a_vyhlídky": ("khk_rozhledny", "Rozhledny a vyhlídky", "kultura"),
    "Technické_památky": ("khk_tech_pam", "Technické památky", "kultura"),
    "Církevní_památky": ("khk_cirk_pam", "Církevní památky", "kultura"),
    "Architektonické_památky": ("khk_arch_pam", "Architektonické památky", "kultura"),
    "Kempy": ("khk_kempy", "Kempy", "kultura"),
    "Lázně": ("khk_lazne", "Lázně", "kultura"),
    "Letní_koupání": ("khk_koupani", "Místa letního koupání", "kultura"),
    "Pivovary": ("khk_pivovary", "Pivovary", "kultura"),
    "Regionální_potraviny": ("khk_reg_potraviny", "Výrobci regionálních potravin", "kultura"),
    "Válečné_hroby": ("khk_valecne_hroby", "Válečné hroby a pietní místa", "kultura"),
    "Veřejné_sbírky": ("khk_verejne_sbirky", "Veřejné sbírky", "kultura"),
}

# Counting these is context, not a verdict: nobody is better off for having
# more war graves, and a public collection is a one-off event, not a service.
KHK_NEUTRAL = {"khk_valecne_hroby", "khk_verejne_sbirky"}

KHK_INDICATORS: tuple[Ind, ...] = tuple(
    Ind(code, label, "počet", pillar, 0 if code in KHK_NEUTRAL else 1, "sum", "Královéhradecký kraj", "khk")
    for code, label, pillar in KHK_POINTS.values()
) + (
    # Category without a published legend: shown, never judged.
    Ind("khk_isv", "Index sociálního vyloučení (kategorie)", "kategorie", "socialni", 0, "none", "Královéhradecký kraj", "khk"),
    Ind("khk_kanal_podil", "Obydlené domy napojené na kanalizační síť", "%", "prostredi", 1, "none", "Královéhradecký kraj", "khk"),
    Ind("khk_dan_prijmy", "Daňové příjmy obce (Data KHK)", "Kč", "finance", 1, "sum", "Královéhradecký kraj", "khk"),
    Ind("khk_silnice_spatne", "Silnice II. a III. tř. v nevyhovujícím stavu", "%", "doprava", -1, "none", "Královéhradecký kraj", "khk"),
    Ind("khk_exekuce", "Podíl obyvatel v exekuci", "%", "socialni", -1, "none", "Královéhradecký kraj", "khk"),
    Ind("khk_hsoo", "Hospodářsky a sociálně ohrožená oblast", "ano/ne", "socialni", -1, "none", "Královéhradecký kraj", "khk"),
    Ind("khk_vydaje_obce", "Výdaje rozpočtu obce", "Kč", "finance", 1, "sum", "Královéhradecký kraj", "khk"),
)


@dataclass(frozen=True)
class Derived:
    code: str
    name: str
    unit: str
    pillar: str
    polarity: int
    num: str
    den: str
    scale: float = 1.0
    explain: str = ""


# Ratios are what make territories comparable; the raw counts above feed them.
DERIVED: tuple[Derived, ...] = (
    Derived("d_podil_65", "Podíl obyvatel 65+", "%", "demografie", -1, "110990", "110900", 100, "obyvatelé 65+ / všichni obyvatelé"),
    Derived("d_podil_014", "Podíl dětí 0–14 let", "%", "demografie", 1, "110930", "110900", 100, "obyvatelé 0–14 / všichni obyvatelé"),
    Derived("d_index_stari", "Index stáří", "65+ na 100 dětí", "demografie", -1, "110990", "110930", 100, "obyvatelé 65+ na 100 dětí 0–14"),
    Derived("d_porodnost", "Hrubá míra porodnosti", "‰", "demografie", 1, "110200", "111000", 1000, "živě narození na 1 000 obyvatel (střední stav)"),
    Derived("d_umrtnost", "Hrubá míra úmrtnosti", "‰", "demografie", -1, "110300", "111000", 1000, "zemřelí na 1 000 obyvatel"),
    Derived("d_migrace", "Míra salda migrace", "‰", "demografie", 1, "110600", "111000", 1000, "saldo migrace na 1 000 obyvatel"),
    Derived("d_byty_1000", "Dokončené byty na 1 000 obyvatel", "‰", "bydleni", 1, "121800", "110900", 1000, "dokončené byty na 1 000 obyvatel"),
    Derived("d_zs_trida", "Průměrný počet žáků ve třídě ZŠ", "žáků/třída", "skolstvi", -1, "040510", "040520", 1, "žáci ZŠ 1.+2. st. / třídy"),
    Derived("d_ms_trida", "Průměrný počet dětí ve třídě MŠ", "dětí/třída", "skolstvi", -1, "040310", "040320", 1, "děti v MŠ / třídy MŠ"),
    Derived("d_pl_10k", "Ordinace PL pro dospělé na 10 000 obyvatel", "na 10 tis.", "zdravotnictvi", 1, "070700", "110900", 10000, "ordinace PL pro dospělé / obyvatelé"),
    Derived("d_zubni_10k", "Ordinace stomatologa na 10 000 obyvatel", "na 10 tis.", "zdravotnictvi", 1, "070720", "110900", 10000, "ordinace stomatologa / obyvatelé"),
    Derived("d_ds_100_65", "Místa v domovech pro seniory na 100 obyv. 65+", "na 100 osob 65+", "socialni", 1, "150160", "110990", 100, "místa v DS / obyvatelé 65+"),
    Derived("d_dlouhodobi", "Podíl dlouhodobě nezaměstnaných", "%", "socialni", -1, "504010", "501000", 100, "uchazeči v evidenci nad 12 měs. / všichni uchazeči"),
    Derived("d_podniky_1000", "Podnikatelské subjekty na 1 000 obyvatel", "‰", "socialni", 1, "160100", "110900", 1000, "subjekty / obyvatelé"),
    Derived("d_zast_1000", "Autobusové zastávky na 1 000 obyvatel", "‰", "doprava", 1, "khk_zast_bus", "110900", 1000, "zastávky IREDO / obyvatelé"),
    Derived("d_vyjizdka", "Podíl vyjíždějících (SLDB 2021)", "%", "doprava", -1, "420511", "420101", 100, "vyjíždějící / obyvatelé při SLDB 2021"),
    Derived("d_dan_obyv", "Daňové příjmy na obyvatele", "Kč", "finance", 1, "200002", "110900", 1000, "daňové příjmy (tis. Kč) × 1000 / obyvatelé"),
    Derived("d_invest_podil", "Podíl kapitálových výdajů", "%", "finance", 1, "200602", "200702", 100, "kapitálové výdaje / výdaje celkem"),
    Derived("d_osob_byt", "Průměrný počet osob v obydleném bytě", "osob/byt", "bydleni", 0, "420105", "420702", 1, "obyvatelé v bytech / obydlené byty (SLDB 2021)"),
    Derived("d_les_podil", "Podíl lesní půdy", "%", "prostredi", 1, "141000", "140100", 100, "lesní půda / celková výměra"),
    Derived("d_knihovny_10k", "Knihovny na 10 000 obyvatel", "na 10 tis.", "kultura", 1, "khk_knihovny", "110900", 10000, "knihovny / obyvatelé"),
    # Named for what it actually divides: the layer holds church monuments,
    # not every kind of listed monument.
    Derived("d_cirk_pam_1000", "Církevní památky na 1 000 obyvatel", "‰", "kultura", 0, "khk_cirk_pam", "110900", 1000, "církevní památky / obyvatelé"),
    Derived("d_vydaje_obyv", "Výdaje rozpočtu obce na obyvatele", "Kč", "finance", 0, "khk_vydaje_obce", "110900", 1, "výdaje rozpočtu / obyvatelé"),
)

# Zařízení, která jde ve scénáři přidat: v datech je jejich dnešní počet
# (MOS nebo Data KHK) a z něj se počítá dostupnost na obyvatele. Jedna tabulka
# pro simulátor (`simulate.py`) i pro doporučení „kde“ (`umisteni.py`), aby
# zásah, který jde přidat, šel i umístit. Náklady jsou orientační předpoklady
# v mil. Kč na jednotku a ve scénáři se dají přepsat.
#   codes     – ukazatele s dnešním počtem (použije se první, který území má)
#   den       – čím se dělí: pop = obyvatelé, kids = děti 0–14, old = 65+
#   capex     – investice na jednotku, provoz – roční provoz na jednotku
DEN = {"pop": ("110900", 10000, "na 10 tis. obyvatel"), "kids": ("110930", 1000, "na 1 000 dětí 0–14"), "old": ("110990", 100, "na 100 obyvatel 65+")}
ZARIZENI: dict[str, dict] = {
    "lekarna": {"label": "Nová lékárna", "pillar": "zdravotnictvi", "codes": ("071000",), "den": "pop", "jednotka": "lékáren", "metrika": "Lékárny",
                "max": 10, "step": 1, "default": 1, "capex": 2.5, "provoz": 0.0,
                "help": "Přidá lékárnu a přepočte lékárny na 10 000 obyvatel."},
    "pediatr": {"label": "Nová ordinace dětského lékaře", "pillar": "zdravotnictvi", "codes": ("070710",), "den": "kids", "jednotka": "ordinací", "metrika": "Dětští lékaři",
                "max": 10, "step": 1, "default": 1, "capex": 1.5, "provoz": 0.0,
                "help": "Přidá ordinaci praktického lékaře pro děti a dorost a přepočte ji na 1 000 dětí."},
    "specialista": {"label": "Nová ordinace specialisty", "pillar": "zdravotnictvi", "codes": ("070740",), "den": "pop", "jednotka": "ordinací", "metrika": "Ordinace specialistů",
                    "max": 10, "step": 1, "default": 1, "capex": 2.5, "provoz": 0.0,
                    "help": "Přidá ordinaci lékaře specialisty a přepočte ji na 10 000 obyvatel."},
    "gynekolog": {"label": "Nová gynekologická ordinace", "pillar": "zdravotnictvi", "codes": ("khk_gyn",), "den": "pop", "jednotka": "ordinací", "metrika": "Gynekologové",
                  "max": 10, "step": 1, "default": 1, "capex": 2.0, "provoz": 0.0,
                  "help": "Přidá ambulantního gynekologa a přepočte ho na 10 000 obyvatel (Data KHK)."},
    "stacionar": {"label": "Místa v denním stacionáři", "pillar": "socialni", "codes": ("150154",), "den": "old", "jednotka": "míst", "metrika": "Místa v denních stacionářích",
                  "max": 200, "step": 5, "default": 20, "capex": 1.2, "provoz": 0.0,
                  "help": "Přidá místa v denním stacionáři a přepočte je na 100 obyvatel 65+."},
    "dzr": {"label": "Místa v domově se zvláštním režimem", "pillar": "socialni", "codes": ("150162",), "den": "old", "jednotka": "míst", "metrika": "Místa v domovech se zvláštním režimem",
            "max": 200, "step": 5, "default": 24, "capex": 2.8, "provoz": 0.0,
            "help": "Přidá místa pro lidi s demencí a podobnými potřebami a přepočte je na 100 obyvatel 65+."},
    "pecovatelske": {"label": "Byty s pečovatelskou službou", "pillar": "socialni", "codes": ("600702",), "den": "old", "jednotka": "bytů", "metrika": "Byty s pečovatelskou službou",
                     "max": 200, "step": 5, "default": 20, "capex": 2.2, "provoz": 0.0,
                     "help": "Přidá byty pro seniory s pečovatelskou službou a přepočte je na 100 obyvatel 65+."},
    "soc_sluzba": {"label": "Nová sociální služba", "pillar": "socialni", "codes": ("khk_soc",), "den": "pop", "jednotka": "služeb", "metrika": "Poskytovatelé sociálních služeb",
                   "max": 20, "step": 1, "default": 1, "capex": 0.0, "provoz": 4.0,
                   "help": "Přidá poskytovatele sociální služby (např. terénní pečovatelskou). Počítá se hlavně roční provoz."},
    "knihovna": {"label": "Nová knihovna", "pillar": "kultura", "codes": ("khk_knihovny",), "den": "pop", "jednotka": "knihoven", "metrika": "Knihovny", "derived": "d_knihovny_10k",
                 "max": 10, "step": 1, "default": 1, "capex": 8.0, "provoz": 0.0,
                 "help": "Přidá knihovnu a přepočte knihovny na 10 000 obyvatel."},
    "kulturni_dum": {"label": "Nový kulturní dům", "pillar": "kultura", "codes": ("khk_kd",), "den": "pop", "jednotka": "domů", "metrika": "Kulturní domy",
                     "max": 5, "step": 1, "default": 1, "capex": 60.0, "provoz": 0.0,
                     "help": "Přidá kulturní dům a přepočte kulturní domy na 10 000 obyvatel."},
    "hasici": {"label": "Nová hasičská stanice", "pillar": "socialni", "codes": ("khk_hasici",), "den": "pop", "jednotka": "stanic", "metrika": "Hasičské stanice",
               "max": 5, "step": 1, "default": 1, "capex": 15.0, "provoz": 0.0,
               "help": "Přidá hasičskou stanici nebo pracoviště a přepočte je na 10 000 obyvatel."},
    "komunikace": {"label": "Nové místní komunikace", "pillar": "doprava", "codes": ("600501",), "den": "pop", "jednotka": "km", "metrika": "Místní komunikace",
                   "max": 100, "step": 1, "default": 5, "capex": 12.0, "provoz": 0.0,
                   "help": "Přidá kilometry místních komunikací; přepočet je na 1 000 obyvatel."},
}
TVARY_ZARIZENI = {'lekarna': ('lékárna', 'lékárny', 'lékáren'), 'pediatr': ('ordinace', 'ordinace', 'ordinací'), 'specialista': ('ordinace', 'ordinace', 'ordinací'), 'gynekolog': ('ordinace', 'ordinace', 'ordinací'), 'stacionar': ('místo', 'místa', 'míst'), 'dzr': ('místo', 'místa', 'míst'), 'pecovatelske': ('byt', 'byty', 'bytů'), 'soc_sluzba': ('služba', 'služby', 'služeb'), 'knihovna': ('knihovna', 'knihovny', 'knihoven'), 'kulturni_dum': ('kulturní dům', 'kulturní domy', 'kulturních domů'), 'hasici': ('stanice', 'stanice', 'stanic'), 'komunikace': ('km', 'km', 'km')}
for _k, _z in ZARIZENI.items():
    _z["tvary"] = TVARY_ZARIZENI[_k]
    _z.setdefault("derived", f"d_zar_{_k}")
    _den, _scale, _jedn = DEN[_z["den"]]
    # komunikace se počítají na tisíc, ne na deset tisíc obyvatel
    if _k == "komunikace":
        _scale = 1000
    _z["scale"], _z["ratio_unit"] = _scale, _jedn if _k != "komunikace" else "km na 1 000 obyvatel"
    if _z["derived"] == f"d_zar_{_k}":
        DERIVED = DERIVED + (Derived(_z["derived"], _z["metrika"] + " " + _z["ratio_unit"], _z["ratio_unit"], _z["pillar"], 1, _z["codes"][0], _den, _scale, _z["metrika"] + " / " + _den),)

# Extra MOS codes needed only as denominators.
AUX_MOS = ("420101",)

ALL_MOS_CODES: tuple[str, ...] = tuple(i.code for i in MOS) + AUX_MOS
IND_BY_CODE: dict[str, Ind] = {i.code: i for i in MOS + KHK_INDICATORS}
DERIVED_BY_CODE: dict[str, Derived] = {d.code: d for d in DERIVED}

# Indicators aggregated for every kraj (the national map). Only additive ones.
CZ_CODES: tuple[str, ...] = (
    "110900", "110930", "110990", "111000", "110200", "110300", "110600", "110700",
    "121800", "501000", "504010", "160100", "070700", "070720", "150160", "200002",
    "200602", "200702", "040510", "040520", "140100", "141000", "113000", "500020",
)

MOS_ORIGIN_URL = {
    "MŠMT ČR": "https://data.msmt.cz/",
    "ÚZIS": "https://www.uzis.cz/",
    "MPSV ČR": "https://data.mpsv.cz/web/data",
    "GŘ ÚP ČR": "https://data.mpsv.cz/web/data",
    "MF ČR": "https://data.mf.gov.cz/",
    "ČÚZK": "https://www.cuzk.gov.cz/",
}
