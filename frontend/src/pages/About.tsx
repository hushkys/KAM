// O nás: kdo tým je, co KAM řeší a proč se dá jeho číslům věřit.
//
// Čísla na téhle stránce se nepíšou do textu — tahají se z `/api/v1`, tedy
// z toho samého rozhraní, které si může kdokoli zavolat a přepočítat si je.
// Stránka o důvěryhodnosti, která by měla údaje natvrdo v kódu, by si
// protiřečila hned ve své vlastní první větě.

import { Icon } from "../components/Icon";
import { Card, PageHeader } from "../components/ui";
import { Team, WEB_TYMU } from "../components/Team";
import { useApi } from "../lib/api";
import { date, num } from "../lib/format";
import type { Sources } from "../lib/types";
import { Link } from "../lib/router";

interface ApiIndex {
  rozsah: { kraj: number; roky: number[]; hodnoty: number; ukazatele: number; uzemi: number; zarizeni: number; fakta: number; katalog: number };
}

/** Komu k čemu. Tři řádky, protože KAM opravdu obsluhuje tři různé lidi
 *  a každý od něj chce něco jiného. */
const PRO_KOHO: { kdo: string; icon: string; co: string }[] = [
  { kdo: "Obec", icon: "home", co: "Ukáže, co záměr udělá: kolik lidí přibude a jak na tom bude školka, škola a rozpočet." },
  { kdo: "Krajský analytik", icon: "chart", co: "Srovná území mezi sebou a u každého rizika ukáže dohledatelný důvod, ne jen barvu na mapě." },
  { kdo: "Veřejnost", icon: "users", co: "Vysvětlí, co čísla o obci znamenají a odkud jsou, a dá prostor napsat, co v území chybí." },
];

const KROKY: { n: string; t: string; d: string }[] = [
  { n: "1", t: "Profil", d: "Údaje o území s rokem a zdrojem." },
  { n: "2", t: "Riziko", d: "Signál v časové řadě, ne dojem." },
  { n: "3", t: "Výhled", d: "Kam to při současných trendech směřuje." },
  { n: "4", t: "Scénář", d: "Co se změní, když se zasáhne." },
  { n: "5", t: "Podnět", d: "Co data nevidí, přidají lidé z místa." },
];

const ZAVAZKY: { t: string; d: string }[] = [
  { t: "Každé číslo je z databáze", d: "Do textů stránek se nepíší žádné hodnoty. Co vidíte, se spočítalo při načtení — a totéž vám vrátí veřejné API." },
  { t: "U hodnoty je rok a původce", d: "ČSÚ část dat jen přebírá od jiných úřadů. U každé hodnoty proto stojí, kdo ji skutečně vyrobil." },
  { t: "Výhled se nikdy neukládá jako fakt", d: "Výhledy a scénáře se počítají při čtení a do databáze se nezapisují, aby se z modelu nestala „naměřená“ hodnota." },
  { t: "Model přiznává, co neví", d: "Malá obec dostane nižší důvěru, chybějící zdroj se napíše. Prázdno se nevyplňuje odhadem." },
  { t: "AI nepočítá, jen vysvětluje", d: "Jazykový model dostane hotový podklad s popiskem a vyloží ho. Čísla počítá kód." },
  { t: "Všechno je otevřené", d: "Veřejné API bez klíče a registrace, kód pod licencí MIT. Každé číslo si můžete přepočítat sami." },
];

export function About() {
  const idx = useApi<ApiIndex>("/v1");
  const src = useApi<Sources>("/sources");
  const r = idx.data?.rozsah;

  return (
    <>
      <PageHeader eyebrow="Tým Popojedem." title="Kdo stojí za KAM"
        lead="Loni jsme postavili KompaZ — průvodce krizovými situacemi v kraji — a vyhráli s ním stejnou soutěž. Letos jsme popojeli dál: od toho, co dělat, když problém nastane, k tomu, jak ho vidět dřív."
        actions={
          <a className="btn btn-primary" href={WEB_TYMU} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={16} /> Web týmu Popojedem.
          </a>
        } />
      <div className="stack-y">
        <Team />

        <div className="grid">
          <Card span={12} i={1} title="K čemu KAM je" icon="target">
            <div className="prose je-siroka">
              <p>
                Otevřená data o krajích popisují minulost a každá leží jinde. Odpověď na otázku, kterou obec
                doopravdy řeší — <em>co s námi udělá sto nových bytů</em> — v nich sama není. KAM je spojuje
                do jednoho modelu: od toho, co je, přes to, kam to směřuje, k tomu, co se změní, když se zasáhne.
              </p>
            </div>
            <ol className="ab-kroky">
              {KROKY.map((k) => (
                <li key={k.n}>
                  <span className="ab-krok-n">{k.n}</span>
                  <strong>{k.t}</strong>
                  <span className="mute">{k.d}</span>
                </li>
              ))}
            </ol>
            <div className="ab-pro-koho">
              {PRO_KOHO.map((p) => (
                <div className="ab-komu" key={p.kdo}>
                  <span className="ab-komu-ikona"><Icon name={p.icon} size={17} /></span>
                  <strong>{p.kdo}</strong>
                  <span className="mute">{p.co}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card span={6} i={2} title="Proč zrovna my" icon="target">
            <div className="ab-draha">
              <div className="ab-etapa">
                <span className="ab-rok">2025</span>
                <div>
                  <strong>KompaZ — vítěz hackathonu Královéhradeckého kraje</strong>
                  <p className="mute small">
                    Průvodce krizovými situacemi v kraji. Stejný tým, stejná soutěž, o ročník dřív.
                  </p>
                </div>
              </div>
              <div className="ab-etapa">
                <span className="ab-rok">PROXIS</span>
                <div>
                  <strong>Jsme vývojáři aplikace PROXIS</strong>
                  <p className="mute small">
                    Diagnostika učení a práce s evidencí. Stejná úloha jako tady: rozházeným záznamům dát řád
                    a udělat z nich podklad pro rozhodnutí.
                  </p>
                </div>
              </div>
              <div className="ab-etapa">
                <span className="ab-rok">2026</span>
                <div>
                  <strong>KAM — krajský analytický model</strong>
                  <p className="mute small">
                    Nejde o náš první projekt. Víme, co vydrží provoz, co se v datech rozbije a jak z prototypu
                    udělat nástroj, který si úřad může převzít.
                  </p>
                </div>
              </div>
            </div>
          </Card>

          <Card span={6} i={3} title="Čím se KAM liší od katalogu" icon="split">
            <div className="prose">
              <p>
                Katalog otevřených dat pomáhá data <strong>najít</strong> — i my ho tu máme. Tím ale obvykle
                končí. KAM nad vybranými daty navíc <strong>počítá</strong>: jedno území, stejné vstupy,
                porovnatelné varianty.
              </p>
              <p>
                Kdo chce jen data, stáhne si je veřejným API. Kdo chce závěr, nemusí si stavět vlastní model.
              </p>
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <Link className="btn btn-sm" to="/data?tab=api"><Icon name="share" size={15} /> Otevřít veřejné API</Link>
              <Link className="btn btn-sm btn-quiet" to="/statistiky"><Icon name="chart" size={15} /> Jak úplná jsou data</Link>
            </div>
          </Card>

          <Card span={12} i={4} title="Na čem model stojí" icon="database">
            <p className="small muted" style={{ marginTop: 0 }}>
              Počty přímo z veřejného API <code>/api/v1</code> — stejné, jaké dostane kdokoli jiný.
            </p>
            <div className="ab-cisla">
              {r ? [
                { v: num(r.hodnoty), p: "zveřejněných hodnot" },
                { v: num(r.katalog), p: "datových sad v katalogu" },
                { v: num(r.uzemi), p: "území od kraje po obec" },
                { v: num(r.ukazatele), p: "sledovaných ukazatelů" },
                { v: num(r.zarizeni), p: "zařízení a zastávek" },
                { v: `${r.roky[0]}–${r.roky[1]}`, p: "pokryté roky" },
              ].map((c) => (
                <div className="ab-cislo" key={c.p}><strong>{c.v}</strong><span>{c.p}</span></div>
              )) : <div className="skeleton" style={{ height: 78, width: "100%" }} />}
            </div>
          </Card>

          <Card span={12} i={5} title="Proč se dá číslům věřit" icon="shield">
            <div className="ab-zavazky">
              {ZAVAZKY.map((z) => (
                <div className="ab-zavazek" key={z.t}>
                  <Icon name="check" size={15} />
                  <div><strong>{z.t}</strong><span className="mute">{z.d}</span></div>
                </div>
              ))}
            </div>
          </Card>

          {/* Co přesně znamená „funkční“ u počtu datových sad. Číslo stojí na
              úvodní stránce i v Datech a bez téhle karty by tvrdilo víc, než
              kontrola ověřuje: že odkaz odpověděl, ne že je soubor v pořádku. */}
          <Card span={12} i={6} title="Co znamená „funkční datová sada“" icon="database">
            <div className="prose je-siroka">
              <p>
                Funkční je sada, jejíž odkaz <strong>odpověděl</strong>. Zkoušíme nejkonkrétnější odkaz, který sada má — přímé stažení
                souboru, jinak stránku vydavatele. Stránku v Národním katalogu přeskakujeme, protože odpoví „v pořádku“ na cokoli.
                Za funkční bereme odpověď 2xx nebo 3xx do 15 sekund, i ze serveru s rozbitým certifikátem, který soubor přesto vydá.
              </p>
              {src.data && (
                <p>
                  Poslední kontrola{src.data.checked_at ? ` proběhla ${date(src.data.checked_at)} a` : ""} z {num(src.data.total)} sad v katalogu
                  prošlo {num(src.data.verified)}. Chybou nebo vůbec neodpovědělo {num(src.data.broken)} (nejčastěji „nenalezeno“, chyba serveru
                  nebo vypršel čas) a {num(src.data.no_link)} nemá žádný odkaz, který by šlo vyzkoušet.
                </p>
              )}
              <p>
                <strong>Co kontrola neověřuje:</strong> obsah. Soubor může být prázdný, v jiném formátu nebo zastaralý — a server, který
                na chybějící soubor vrátí „nenalezeno“ s kódem 200, projde taky. Číslo říká „odkaz je dostupný“, ne „data jsou v pořádku“.
                Sady, ze kterých model počítá ({src.data ? num(src.data.loaded) : "…"}), sklizeň opravdu stahuje a čte hodnotu po hodnotě;
                v katalogu jsou označené jako načtené do modelu.
              </p>
            </div>
          </Card>

          <Card span={6} i={7} title="Co děláme" icon="users">
            <div className="prose">
              <p>Tým má dvě oblasti a každá svého vedoucího. <strong>Ondřej Hušek</strong> vede vývoj a technologie: navrhl architekturu a postavil aplikaci od sklizně dat přes výpočty a scénáře po asistenta. <strong>Josef Efler</strong> vede značku, produkt a veřejnou komunikaci včetně právní stránky projektu.</p>
              <p><strong>Matěj Jirásek</strong> odpovídá za vzhled a ovládání — aby byla složitá data srozumitelná na první pohled — a drží v týmu motivaci.</p>
              <p><strong>Damián Roháček</strong> hlídá serverovou část a datové služby, aby fungovaly, i když se na ně nikdo zrovna nedívá.</p>
            </div>
          </Card>

          <Card span={6} i={8} title="Odkud jsme" icon="school">
            <div className="prose">
              <p>Ondřej, Matěj a Damián studují bakalářský program <strong>Informační a síťová bezpečnost</strong> na Fakultě informatiky a managementu Univerzity Hradec Králové.</p>
              <p>Josef studuje <strong>Řízení rizik ve veřejné správě</strong> na Fakultě logistiky a krizového řízení Univerzity Tomáše Bati ve Zlíně.</p>
            </div>
          </Card>

          <Card span={12} i={9} title="Co je hotové a co teprve navazuje" icon="history">
            <p className="small muted" style={{ marginTop: 0 }}>
              Podle toho, co v aplikaci opravdu běží, ne podle položek v menu.
            </p>
            <div className="table-wrap" style={{ margin: 0 }}>
              <table className="table">
                <thead><tr><th>Hotové, dá se vyzkoušet</th><th>Na čem se dál pracuje</th></tr></thead>
                <tbody>
                  {[
                    ["Profily území, mapy a riziková pravidla", "Přesnější odhad nejistoty a model spádovosti"],
                    ["Výhled a scénáře s různými typy zásahů", "Ověřené kapacity služeb a lepší dopravní model"],
                    ["Asistent s nástroji nad daty a vyhledáváním", "Testy citací, oprávnění a soukromých podkladů"],
                    ["Katalog zdrojů a veřejné API nad vším", "Univerzální import CSV, XLSX a PDF"],
                    ["Hlášení občanů a návrhy podnětů", "Dotační párování a dohodnutý proces s krajem"],
                  ].map(([a, b]) => (
                    <tr key={a}><td>{a}</td><td className="mute">{b}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
