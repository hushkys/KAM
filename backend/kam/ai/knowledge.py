"""Hand-written knowledge the assistant can retrieve: methods, pages, limits.

These are the only documents in the index that we wrote ourselves; they
describe how KAM computes things and where things are in the app, so the
assistant can answer "jak to víte?" and "kde to najdu?" from the same text a
human reads on the Metodika page.
"""

from __future__ import annotations

DOCS: tuple[dict, ...] = (
    {"id": "metoda-trend", "title": "Jak KAM rozlišuje jednorázový výkyv od dlouhodobého trendu", "url": "/data#metodika",
     "text": "Každá časová řada se proloží robustní přímkou Theil–Sen (medián sklonů mezi všemi dvojicemi let), která ignoruje ojedinělé extrémy. "
             "Významnost směru ověřuje Mann–Kendallův test na hladině 5 %. Odchylky od přímky se škálují robustní směrodatnou odchylkou (1,4826 × MAD). "
             "Bod je jednorázový výkyv, pokud leží více než 3 robustní σ mimo přímku a jeho sousední roky ne. Řada je dlouhodobý trend, pokud je test významný a změna je alespoň 0,3 % ročně. "
             "Rok začátku trendu je první rok nepřerušené řady ve směru trendu; kroky proti směru menší než polovina σ se tolerují."},
    {"id": "metoda-vyhled", "title": "Jak KAM počítá výhled obyvatel 2026–2040", "url": "/vyhled",
     "text": "Komponentní model: počet obyvatel příštího roku = letošní + narození − zemřelí + saldo migrace. Míry se berou z posledních deseti let dat ČSÚ (MOS). "
             "Pravděpodobný scénář používá medián měr, optimistický příznivý kvartil (více narozených a přistěhovalých, méně zemřelých), rizikový nepříznivý kvartil. "
             "U malých obcí se míry kombinují s mírami ORP s váhou P/(P+2000). Věková struktura se posouvá podle trendu podílů 0–14 a 65+ na logitové škále. "
             "Pásmo je empirický 90% interval z rozptylu meziročního růstu, roste s odmocninou horizontu. Model se zpětně testuje: spustí se s daty do roku 2020 a porovná s realitou 2021–2025. "
             "Výhled není předpověď — ukazuje, kam vede pokračování současných trendů."},
    {"id": "metoda-simulace", "title": "Jak funguje simulátor zásahů (Co kdyby?)", "url": "/scenare",
     "text": "Scénář = výchozí stav + přírůstky zásahu. Základem je pravděpodobná varianta výhledu. Zásah (nové byty, místa ve škole, spoje, pracovní místa, lůžka, ordinace) přičítá od roku realizace obyvatele, kapacity nebo služby. "
             "Z toho se pro obě varianty (bez zásahu a se zásahem) přepočítá poptávka po ZŠ a MŠ, vytížení kapacit (třídy × zákonné maximum 30 žáků ZŠ, 24 dětí MŠ), dostupnost lékařů, místa v domovech pro seniory, daňové příjmy a cesty autem. "
             "Při překročení kapacity systém ukáže rok přetečení a navrhne navazující zásah. Každé číslo, které není z dat, je předpoklad s hodnotou a důvodem a lze ho změnit. "
             "Řetězec dopadů značí kroky jako ZÁSAH, MODEL, PŘEDPOKLAD. Opakované simulace se ukládají do mezipaměti a nejčastější vzorce se předpočítávají při startu."},
    {"id": "metoda-rizika", "title": "Jak KAM detekuje rizika", "url": "/prehled",
     "text": "Rizika počítají pravidla nad reálnými daty, ne jazykový model: stárnutí populace (podíl 65+ a jeho růst oproti kraji), dlouhodobý úbytek obyvatel (významný trend), odliv obyvatel (záporné saldo migrace), "
             "dostupnost praktických lékařů (ordinace na 10 000 obyvatel ve správním obvodu oproti kraji), tlak na kapacitu ZŠ (žáci na třídu), nadprůměrná nezaměstnanost, kapacita pobytové péče o seniory, chybějící kanalizace, opakovaný rozpočtový schodek a jednorázové výkyvy. "
             "Závažnost má pět stupňů: nízké, sledovat, střední, vysoké, kritické. Každé riziko má vysvětlení, období, důvěryhodnost (nižší u malých obcí a krátkých řad) a odkazy na zdrojová data."},
    {"id": "metoda-datove-potreby", "title": "Sledování datových potřeb", "url": "/data#potreby",
     "text": "KAM průběžně hodnotí pokrytí dat pro každé ORP a oblast (podíl obcí s hodnotou v posledním roce, penalizace za stáří dat), čerstvost datových sad kraje podle deklarované periodicity v NKOD a strukturální mezery, které model musí nahradit předpokladem. "
             "Upozornění vznikají dřív, než se problém projeví: ukazatel pozadu za ostatními, oblast s většinou sad po termínu aktualizace, nízké pokrytí obcí, podněty občanů na chybějící data."},
    {"id": "metoda-podnety", "title": "Jak fungují podněty občanů", "url": "/podnety",
     "text": "Občan vybere obec, oblast a popíše problém nebo chybějící data. Osobní údaje (e-mail, telefon, rodné číslo) se automaticky maskují. Podobná hlášení ze stejné obce a oblasti se seskupují podle překryvu klíčových slov. "
             "Když skupina dosáhne nastaveného prahu (výchozí 5 hlášení), vznikne formální podnět pro krajský úřad s přehledem, souvisejícími daty a anonymizovanými texty. Kam se podnět odešle, určuje Nastavení → Data a soukromí. "
             "Podnět občana se nikdy nezapočítává jako fakt do dat modelu."},
    {"id": "metoda-ai", "title": "Jak funguje AI asistent a router", "url": "/asistent",
     "text": "Příkazy pro aplikaci (motiv, průhlednost, navigace, velikost písma) se vykonají okamžitě bez modelu. Ostatní dotazy router rozdělí: jednoduché jdou na lokální model (Gemma v LM Studiu), složité analýzy na cloudový model (Gemini), pokud je nastaven a pokud to dovoluje politika dat. "
             "Asistent odpovídá z nástrojů (profil území, rizika, výhled, simulace) a z hybridního vyhledávání (BM25 + vektory, sloučeno metodou Reciprocal Rank Fusion). Čísla nepočítá jazykový model, ale analytické moduly. "
             "Asistent rozlišuje fakt, trend, model, scénář a AI interpretaci, cituje zdroje a může se mýlit."},
    {"id": "data-mos", "title": "ČSÚ Městská a obecní statistika (MOS)", "url": "/data",
     "text": "Hlavní číselný zdroj modelu: roční soubory ČSÚ se všemi obcemi Česka od roku 2000, přes 800 ukazatelů. KAM z nich čte demografii, školství (MŠMT), zdravotnictví (ÚZIS), sociální služby (MPSV), nezaměstnanost (Úřad práce), hospodaření obcí (MF ČR), druhy pozemků (ČÚZK) a technickou vybavenost. "
             "Hodnoty za ORP, okres a kraj se skládají z obcí podle pravidla ukazatele (součet nebo vážený průměr)."},
    {"id": "data-khk", "title": "Data Královéhradeckého kraje (Data KHK)", "url": "/data",
     "text": "Z ArcGIS služeb portálu Data KHK KAM načítá autobusové zastávky IREDO, železniční stanice, praktické a zubní lékaře, nemocnice, pohotovosti, základny ZZS, mateřské a základní školy, poskytovatele sociálních služeb, index sociálního vyloučení, daňové příjmy obcí, stav kanalizace, poštu v obcích, stav povrchu silnic a omezení dopravy. "
             "Záznamy nesou kód obce z RÚIAN, takže se k obci přiřadí bez geokódování."},
    {"id": "data-nkod", "title": "Národní katalog otevřených dat (NKOD)", "url": "/data",
     "text": "KAM sklízí metadata všech datových sad Královéhradeckého kraje, ČSÚ, Ministerstva financí, Digitální a informační agentury, MPSV, AOPK a ostatních krajů přes SPARQL endpoint data.gov.cz. "
             "Každou sadu zařadí do oblasti, ověří čerstvost podle periodicity, přiřadí ke kraji na mapě a zaindexuje pro asistenta. Počet sad v aplikaci je počet unikátních záznamů — duplicity mezi NKOD a portálem kraje se slučují."},
    {"id": "data-hranice", "title": "Hranice území (ČÚZK RÚIAN)", "url": "/mapa",
     "text": "Mapa je vlastní vektorová kresba z prohlížecí služby RÚIAN (ČÚZK): stát, 14 krajů, ORP a obce Královéhradeckého kraje. Nepotřebuje mapový klíč ani dlaždice a nic za hranicí Česka nezobrazuje. Geometrie je zjednodušená pro zobrazení."},
    {"id": "stranka-prehled", "title": "Stránka Přehled", "url": "/prehled", "text": "Přehled kraje: klíčová čísla, mapa rizik obcí, nejvýznamnější rizika, puls kraje (aktuální změny v datech a dopravě) a výhled."},
    {"id": "stranka-mapa", "title": "Stránka Mapa", "url": "/mapa", "text": "Interaktivní mapa Česka po krajích s počty otevřených dat a ukazateli; po kliknutí na Královéhradecký kraj detail ORP a obcí s volbou ukazatele (kartogram)."},
    {"id": "stranka-obce", "title": "Stránka Obce a živý profil", "url": "/obce", "text": "Vyhledání kterékoli ze 448 obcí, 15 ORP nebo kraje. Profil ukazuje všechny sledované oblasti, u každého ukazatele poslední hodnotu, rok, trend nebo výkyv, srovnání s krajem a zdroj."},
    {"id": "stranka-vyhled", "title": "Stránka Výhled", "url": "/vyhled", "text": "Výhled obyvatel a věkové struktury 2026–2040 ve třech scénářích s pásmem nejistoty, předpoklady a zpětným testem modelu."},
    {"id": "stranka-scenare", "title": "Stránka Scénáře", "url": "/scenare", "text": "Simulátor zásahů: vyberte území, přidejte zásah, porovnejte BEZ ZÁSAHU a SE ZÁSAHEM, sledujte varování kapacit a řetězec dopadů. Scénáře lze uložit."},
    {"id": "metoda-plany", "title": "Jak KAM zjišťuje, co má obec zveřejněné", "url": "/plany",
     "text": "Povinně zveřejňované dokumenty obcí se sklízejí ze tří státních registrů. Programy rozvoje obce z obcepro.cz "
             "(Ministerstvo pro místní rozvoj) — období platnosti je v názvu dokumentu, takže z něj jde spočítat, jestli ještě "
             "platí a kolik z něj uplynulo. Územní plány a všechny jejich změny z evidence ÚPD Královéhradeckého kraje "
             "(up.khk.cz) — každý s datem vydání a vlastní stránkou; sloupec Archivováno je jediná strojová informace o tom, "
             "že dokument nahradil jiný, takže platný je nejnovější nearchivovaný záznam. IČO úřadu z ARESu se páruje na kód "
             "obce z RÚIAN, ne na jméno, protože stejnojmenných obcí jsou v Česku desítky; z IČO se pak skládají přesné odkazy "
             "do MONITORu státní pokladny, registru smluv a ARESu. Datová schránka je z registru orgánů veřejné moci. "
             "KOLIK Z PLÁNU JE HOTOVÉ, KAM NETVRDÍ: registr, kde by u jednotlivého záměru stálo „realizováno\u201c, v Česku "
             "neexistuje a obce plnění vyhodnocují vlastními zprávami v PDF. „Stav plnění\u201c proto znamená jen platnost "
             "dokumentu a podíl období, který uplynul. Vedle toho stojí kapitálové výdaje obce za tytéž roky z rozpočtu — "
             "jsou to dvě věci ze dvou zdrojů, ne příčina a následek; rozpočtová skladba neříká, co za ty peníze obec pořídila. "
             "Územní plán navíc nemá platnost, která by vypršela: rok u něj je datum vydání, ne konec účinnosti."},
    {"id": "stranka-plany", "title": "Stránka Plány", "url": "/plany",
     "text": "Rejstřík všech 448 obcí kraje a jejich povinně zveřejňovaných dokumentů. U každé obce čtyři povinnosti — program "
             "rozvoje obce, územní plán i s každou změnou, rozpočet a jeho plnění, otevřená data obce — a u každé buď dokument "
             "s datem a odkazem na originál, nebo věta, že chybí. Řádek se rozbalí na místě a ukáže odkazy do MONITORu státní "
             "pokladny, registru smluv a ARESu složené z IČO té obce. Seznam jde filtrovat (mají program rozvoje, program "
             "doběhl, bez územního plánu, vydávají otevřená data) a řadit podle velikosti, abecedně, od nejstaršího územního "
             "plánu nebo podle počtu dokumentů. Data vydává i veřejné API na /api/v1/dokumenty."},
    {"id": "stranka-hospodareni", "title": "Stránka Hospodaření", "url": "/hospodareni",
     "text": "Rozpočet obce z výkazu FIN 2-12 M (ČSÚ MOS přebírá z MONITORu státní pokladny): provozní přebytek (příjmy po "
             "konsolidaci minus běžné výdaje), kapitálové výdaje, krytí investic z vlastního přebytku a kumulované saldo. "
             "Hodnocení je pravidlo s vypsanými prahy, ne odhad. Rozpočet neumí říct, co obec za peníze pořídila, takže se "
             "nikde nepočítá žádná návratnost investice."},
    {"id": "stranka-dotace", "title": "Stránka Dotace", "url": "/dotace",
     "text": "Tři vrstvy s různou jistotou: kolik dotací obec doopravdy přijala (roční řada z rozpočtu, ČSÚ MOS), kolik kraj "
             "poslal do jejího ORP (Data KHK, souhrn 2021–2025) a rozcestník vyhlašovatelů podle oblastí, ve kterých má území "
             "podle modelu problém. Strojově čitelný registr otevřených výzev pro obce v Česku neexistuje, takže KAM neříká "
             "„máte nárok\u201c — to posuzuje jen vyhlašovatel."},
    {"id": "stranka-statistiky", "title": "Stránka Statistiky", "url": "/statistiky",
     "text": "Čísla o samotné aplikaci: kolik datových sad je v katalogu a kolik z nich má ověřený odkaz, kolik hodnot drží "
             "model po letech a oblastech, počty zařízení, formáty dat, provoz asistenta a stav sklízecích úloh."},
    {"id": "stranka-data", "title": "Stránka Data", "url": "/data", "text": "Přesný seznam využívaných datových sad s odkazy, počty podle zdrojů a oblastí, způsob využití každé sady, sledování datových potřeb a metodika."},
    {"id": "stranka-nastaveni", "title": "Nastavení", "url": "/nastaveni", "text": "Vzhled (motiv, průhlednost, hustota, umístění navigace), přístupnost (kontrast, velikost písma, omezení animací, podtržené odkazy), modely AI (přidání, úprava, test lokálních i cloudových modelů), data a soukromí (kam se posílají dotazy a podněty, historie konverzací)."},
    {"id": "pravni-ai", "title": "Omezení AI a právní informace", "url": "/pravni",
     "text": "Odpovědi asistenta generuje umělá inteligence a mohou obsahovat chyby. Nejsou právní, finanční ani odbornou radou. Výhledy a scénáře jsou modelové odhady, ne předpovědi. "
             "Aplikace nezpracovává osobní údaje nad rámec nutnosti; podněty jsou anonymizované, historie konverzací je volitelná s nastavitelnou dobou uchování. Data jsou převzata z otevřených zdrojů podle jejich licencí."},
    {"id": "tym", "title": "Tým Popojedem.", "url": "/o-nas",
     "text": "KAM vytvořil tým Popojedem. pro Hackathon Královéhradeckého kraje: Ondřej Hušek (full-stack software a AI inženýr), Matěj Jirásek (UX/UI designer) a Damián Roháček (backend developer) studují Informační a síťovou bezpečnost na Fakultě informatiky a managementu Univerzity Hradec Králové; Josef Efler (marketing a brainstorming) studuje na Univerzitě Tomáše Bati ve Zlíně. Loni tým vytvořil projekt KompaZ."},
)
