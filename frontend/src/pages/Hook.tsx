// Úvodní stránka: co KAM je, pro koho, z čeho a kdo ho staví.
//
// Je to vstup pro úřad, ne plakát. Nahoře jedna věta a cesta do aplikace,
// pod ní živá čísla, moduly, metodika, zdroje a tým — v tomhle pořadí, protože
// přesně v tomhle pořadí se ptá člověk, který aplikaci vidí poprvé: co to je,
// umí to to, co potřebuju, dá se tomu věřit a kdo za tím stojí.
//
// Pohyb je jen nájezd: bloky se při prvním objevení prolnou o pár pixelů
// zdola a čísla se dotočí. Nic se nepřipichuje, nic nejede do strany a nic se
// nehýbe s rolováním — stránku jde číst stejně rychle, jako se roluje. Pod
// `data-motion="reduce"` je všechno rovnou na místě.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { openAssistant } from "../components/assistantBus";
import { Icon } from "../components/Icon";
import { KrajVizual } from "../components/KrajVizual";
import { Wordmark } from "../components/Logo";
import { modulBarvy, ModuleIcon } from "../components/ModuleIcon";
import { NAV } from "../components/nav";
import { Team, WEB_TYMU } from "../components/Team";
import { KindTag } from "../components/ui";
import { WordmarkHop } from "../components/WordmarkHop";
import { useApi } from "../lib/api";
import { num } from "../lib/format";
import { Link } from "../lib/router";
import type { Overview, Sources } from "../lib/types";

/** Cesta od údaje k rozhodnutí. Je to pořadí, ve kterém aplikace pracuje,
 *  a zároveň jediná věc, kterou je na úvodní stránce potřeba pochopit. */
const CESTA = [
  { n: "1", t: "Profil", d: "Co o obci víme, u každého údaje s rokem a zdrojem. Kde zdroj mlčí, je to tam napsané.", to: "/obce" },
  { n: "2", t: "Riziko", d: "Kde se vývoj láme — stárnutí, odliv lidí, nezaměstnanost — a co byl jen jednorázový výkyv.", to: "/prehled" },
  { n: "3", t: "Výhled", d: "Kam to při dnešních trendech vede: tři scénáře, pásmo nejistoty a zpětný test na minulých letech.", to: "/vyhled" },
  { n: "4", t: "Scénář", d: "Co nová čtvrť, třída, spoj nebo ordinace udělá s kapacitami, daněmi a náklady.", to: "/scenare" },
  { n: "5", t: "Podnět", d: "Co data nevidí, doplní lidé z místa. Opakovaná hlášení se spojí do podnětu kraji.", to: "/podnety" },
];

/** Čtyři druhy čísel, které aplikace ukazuje, a štítek, podle kterého se
 *  poznají. Je to slib: fakt se nikdy nevydává za model a model za fakt. */
const VRSTVY = [
  { kind: "FAKT", t: "Zveřejněná hodnota", d: "Číslo tak, jak ho vydal ČSÚ, kraj nebo jiný správce dat, s rokem a původcem." },
  { kind: "TREND", t: "Směr vývoje", d: "Jestli jde o dlouhodobou změnu, nebo jen o výkyv — metodami, které obstojí i u malé obce." },
  { kind: "MODEL", t: "Výhled", d: "Projekce obyvatel z narození, úmrtí a stěhování, s pásmem nejistoty a ověřená zpětným testem." },
  { kind: "SCÉNÁŘ", t: "Co kdyby", d: "Tentýž model se zásahem a bez něj. Předpoklady jsou vypsané a dají se změnit." },
];

const tichy = () => typeof document !== "undefined" && document.documentElement.dataset.motion === "reduce";

/** Nájezd na první pohled. Pozorovatel, ne rolovací smyčka: tohle se má stát
 *  jednou a pak dát pokoj.
 *
 *  `useLayoutEffect`, ne `useEffect`: při vypnutém pohybu se `je-videt`
 *  přidává hned, ale `useEffect` běží až *po* prvním vykreslení, takže by
 *  prohlížeč stihl na zlomek snímku vykreslit prvky v jejich výchozím stavu
 *  (`opacity: 0`) — ve snímku pořízeném přesně v tu chvíli (viz
 *  `scripts/screenshots.py`) to bylo vidět jako napůl průsvitný nadpis. */
function useVjezdy(koren: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = koren.current;
    if (!el) return;
    const prvky = Array.from(el.querySelectorAll<HTMLElement>("[data-vjezd]"));
    if (tichy()) { prvky.forEach((p) => p.classList.add("je-videt")); return; }
    // Prah je na nule schválně. „18 % prvku" se počítalo z výšky prvku, takže
    // vysoký blok naskočil až hluboko za svou horní hranou a do té doby na
    // jeho místě zelo prázdno.
    const io = new IntersectionObserver((zaznamy) => {
      for (const z of zaznamy) {
        if (z.isIntersecting) { z.target.classList.add("je-videt"); io.unobserve(z.target); }
      }
    }, { threshold: 0, rootMargin: "0px 0px -4% 0px" });
    prvky.forEach((p) => io.observe(p));

    // Pojistka na první vykreslení. Pozorovatel hlásí *změnu* protnutí, a
    // rozvržení se tu ustaluje ještě po něm: dotečou data z API, doběhne
    // písmo, mapa si dopočítá výšku. Prvek, který je přitom celou dobu na
    // obrazovce, se nemusí dočkat ani jedné zprávy a zůstal by průhledný.
    const dorovnej = () => {
      const mez = window.innerHeight * 0.96;
      for (const p of prvky) {
        if (p.classList.contains("je-videt") || p.getBoundingClientRect().top >= mez) continue;
        p.classList.add("je-videt");
        io.unobserve(p);
      }
    };
    dorovnej();
    const id = window.setTimeout(dorovnej, 400);
    window.addEventListener("load", dorovnej);
    return () => {
      io.disconnect();
      window.clearTimeout(id);
      window.removeEventListener("load", dorovnej);
    };
  }, [koren]);
}

/** Která sekce se právě čte (pro zvýraznění v liště) a jestli je stránka
 *  odrolovaná (lišta pak dostane linku a pozadí). Dva pozorovatelé místo
 *  posluchače rolování: nic se nepočítá v každém snímku. */
function useLista(koren: RefObject<HTMLElement | null>) {
  const [akt, setAkt] = useState("");
  const [dole, setDole] = useState(false);
  useEffect(() => {
    const el = koren.current;
    if (!el) return;
    const zarazka = el.querySelector<HTMLElement>("[data-zarazka]");
    const sekce = Array.from(el.querySelectorAll<HTMLElement>("section[id]"));
    // Čára ve 42 % výšky okna, ne uprostřed: nadpis sekce je nahoře a člověk
    // ji vnímá jako aktivní dřív, než se doroluje doprostřed.
    const io = new IntersectionObserver((zaznamy) => {
      for (const z of zaznamy) if (z.isIntersecting) setAkt(z.target.id);
    }, { rootMargin: "-42% 0px -57% 0px", threshold: 0 });
    sekce.forEach((s) => io.observe(s));
    const horni = new IntersectionObserver(([z]) => setDole(!z.isIntersecting));
    if (zarazka) horni.observe(zarazka);
    return () => { io.disconnect(); horni.disconnect(); };
  }, [koren]);
  return { akt, dole };
}

/** Číslo jako odometr: každá číslice je svislý pás 0–9, který se při vjezdu
 *  přetočí na svou hodnotu.
 *
 *  Pás má dvacet políček (0–9 dvakrát) a cíl je v druhé desítce, takže každá
 *  číslice udělá napřed celou otočku. Nehýbe tím JavaScript — cílová poloha
 *  je jedna CSS proměnná a zbytek je přechod. Formátovaný text se rozpadá po
 *  znacích: číslice dostanou pás, mezery a písmena („tis.") zůstanou stát. */
const PAS = Array.from({ length: 20 }, (_, n) => n % 10);

function Odometr({ hodnota, format }: { hodnota: number | null; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  // Při vypnutém pohybu je číslo rovnou na místě, ne až po prvním překreslení:
  // jinak by snímek pořízený v tu chvíli zachytil samé nuly.
  const [videt, setVidet] = useState(tichy);

  useEffect(() => {
    const el = ref.current;
    if (!el || hodnota === null || videt) return;
    const io = new IntersectionObserver(([z]) => {
      if (z.isIntersecting) { setVidet(true); io.disconnect(); }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [hodnota, videt]);

  if (hodnota === null) return <span ref={ref} className="od-ceka">—</span>;
  const text = format(hodnota);
  let poradi = 0;
  return (
    <span ref={ref} className={`od${videt ? " je-videt" : ""}`}>
      {/* Čtečka dostane hotové číslo; rozsypané číslice by přečetla po jedné. */}
      <span className="visually-hidden">{text}</span>
      {[...text].map((z, i) => {
        if (!/[0-9]/.test(z)) {
          return <span className="od-znak" key={i} aria-hidden="true">{z === " " ? " " : z}</span>;
        }
        const styl = { "--c": Number(z), "--i": poradi++ } as CSSProperties;
        return (
          <span className="od-cislice" key={i} aria-hidden="true">
            <span className="od-pas" style={styl}>
              {PAS.map((n, j) => <span key={j}>{n}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function Hook() {
  const koren = useRef<HTMLDivElement>(null);
  const ov = useApi<Overview>("/overview");
  const src = useApi<Sources>("/sources");
  useVjezdy(koren);
  const lista = useLista(koren);

  const d = ov.data;
  // Žebříček podle toho, kolik z kterého zdroje opravdu drží ověřených sad.
  const zdroje = useMemo(
    () => (src.data?.sources ?? []).filter((s) => s.verified > 0).sort((a, b) => b.verified - a.verified).slice(0, 12),
    [src.data],
  );
  const nejvic = zdroje[0]?.verified ?? 1;

  // Čtyři čísla, která úředníka opravdu zajímají: je tu moje obec, jak daleko
  // do minulosti data sahají, nemusím obcházet portály, uvidím služby. Počet
  // měřených hodnot a území vypadl — vypovídá o databázi, ne o jeho práci.
  const roky = d ? `${d.model.years[0]}–${d.model.years[1]}` : "";
  const cisla: { v: number | null; f: (n: number) => string; l: string; s: string }[] = [
    { v: d?.model.obce ?? null, f: num, l: "obcí kraje, každá s vlastním profilem", s: "obyvatelé, školy, lékaři, rozpočet" },
    { v: d ? d.model.years[1] : null, f: () => roky, l: "roky v časových řadách", s: "dost dlouhé, aby šlo odlišit trend od výkyvu" },
    { v: d?.datasets.verified ?? null, f: num, l: "ověřených otevřených sad na jednom místě", s: d ? `od ${num(d.datasets.publishers)} poskytovatelů, odkaz při kontrole odpověděl` : "" },
    { v: d?.model.pois ?? null, f: num, l: "zařízení a míst na mapě kraje", s: "školy, ordinace, zastávky, knihovny i památky" },
  ];

  const moduly = NAV.filter((n) => n.module !== "nastaveni");
  const odkazy = [["moduly", "Moduly"], ["metodika", "Metodika"], ["data", "Data"], ["tym", "Tým"]] as const;

  return (
    <div className="hp" ref={koren}>
      <span className="hp-zarazka" data-zarazka aria-hidden="true" />
      <header className={`hp-nav${lista.dole ? " je-dole" : ""}`}>
        <div className="hp-nav-vnitrek">
          <Link to="/" className="hp-nav-znak" aria-label="KAM — úvodní stránka">
            <Wordmark />
            <span className="hp-nav-popis">Krajský analytický model</span>
          </Link>
          <nav className="hp-nav-odkazy" aria-label="Úvod">
            {odkazy.map(([id, t]) => (
              <a key={id} className={`hp-nav-odkaz${lista.akt === id ? " je-aktivni" : ""}`} href={`#${id}`}>{t}</a>
            ))}
          </nav>
          <Link to="/prehled" className="btn btn-primary btn-sm">Otevřít aplikaci <Icon name="arrow-right" size={15} /></Link>
        </div>
      </header>

      {/* ------------------------------------------------------------ úvod */}
      <section className="hp-hero">
        <div className="hp-obsah hp-hero-mrizka">
          <div className="hp-hero-text">
            <div className="hp-znak" data-vjezd><WordmarkHop /></div>
            <h1 className="hp-claim" data-vjezd>Vidět, kam to směřuje.</h1>
            <p className="hp-lead" data-vjezd>
              Podklady pro radu, zastupitelstvo i ministerstvo na jednom místě: co se v obcích kraje děje, kam to vede
              a co změní zásah. U každého čísla je rok a původce, takže obstojí i na jednání.
            </p>
            <div className="hp-cta" data-vjezd>
              <Link to="/prehled" className="btn btn-primary btn-lg">Otevřít přehled kraje <Icon name="arrow-right" size={17} /></Link>
              <button className="btn btn-lg" onClick={() => openAssistant()}><Icon name="sparkle" size={17} /> Zeptat se asistenta</button>
            </div>
            <ul className="hp-sliby" data-vjezd>
              <li><Icon name="check" size={15} /> Rok a původce u každého čísla</li>
              <li><Icon name="check" size={15} /> Bez přihlášení a bez instalace</li>
              <li><Icon name="check" size={15} /> Otevřené API i zdrojový kód</li>
            </ul>
          </div>
          <div className="hp-hero-vizual" data-vjezd>
            <KrajVizual />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- živá čísla */}
      <section className="hp-pas" aria-label="Živá čísla">
        <div className="hp-obsah hp-pas-mrizka">
          {cisla.map((c, i) => (
            <div className="hp-cislo" key={c.l} data-vjezd style={{ "--i": i } as CSSProperties}>
              <span className="hp-cislo-hodnota"><Odometr hodnota={c.v} format={c.f} /></span>
              <span className="hp-cislo-popis">{c.l}</span>
              <span className="hp-cislo-sub">{c.s}</span>
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- moduly */}
      <section className="hp-sekce" id="moduly">
        <div className="hp-obsah">
          <div className="hp-hlavicka" data-vjezd>
            <h2 className="hp-nadpis">Každá otázka má své místo</h2>
            <p className="hp-podnadpis">Každý modul odpovídá na jednu otázku, kterou úřad řeší. Všechny stojí na stejných
              číslech, takže si podklady z různých míst neodporují.</p>
          </div>
          <div className="hp-moduly">
            {moduly.map((n, i) => {
              const b = modulBarvy(n.module);
              return (
                <Link key={n.path} to={n.path} className="hp-modul" data-vjezd
                  style={{ "--i": i, "--mc-a": b.a, "--mc-b": b.b } as CSSProperties}>
                  <span className="hp-modul-hlava">
                    <ModuleIcon name={n.module} size={26} />
                  </span>
                  <strong>{n.label}</strong>
                  <span className="hp-modul-popis">{n.desc}</span>
                  <span className="hp-modul-odkaz">Otevřít <Icon name="arrow-right" size={14} /></span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- metodika */}
      <section className="hp-sekce hp-sekce-alt" id="metodika">
        <div className="hp-obsah">
          <div className="hp-hlavicka" data-vjezd>
            <h2 className="hp-nadpis">Od údaje k usnesení</h2>
            <p className="hp-podnadpis">Stejné pořadí, jakým vzniká každý poctivý podklad. Jen už nemusíte data shánět sami.</p>
          </div>
          <ol className="hp-kroky">
            {CESTA.map((c, i) => (
              <li key={c.n} data-vjezd style={{ "--i": i } as CSSProperties}>
                <Link to={c.to} className="hp-krok">
                  <span className="hp-krok-cislo" aria-hidden="true">{c.n}</span>
                  <strong>{c.t}</strong>
                  <span>{c.d}</span>
                </Link>
              </li>
            ))}
          </ol>
          <div className="hp-vrstvy-hlava" data-vjezd>
            <h3>Fakt se nikdy nevydává za odhad</h3>
            <p>Každé číslo nese štítek, podle kterého poznáte, co je zač. Asistent žádné číslo nepočítá, jen vysvětluje hotové podklady.</p>
          </div>
          <div className="hp-vrstvy">
            {VRSTVY.map((v, i) => (
              <div className="hp-vrstva" key={v.kind} data-vjezd style={{ "--i": i } as CSSProperties}>
                <KindTag kind={v.kind} />
                <strong>{v.t}</strong>
                <span>{v.d}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- data */}
      <section className="hp-sekce" id="data">
        <div className="hp-obsah hp-data">
          <div className="hp-hlavicka" data-vjezd>
            <h2 className="hp-nadpis">Kde data hledat, už řešit nemusíte</h2>
            <p className="hp-podnadpis">
              Národní katalog otevřených dat, portály krajů a měst, ČSÚ, Eurostat a geoportál na jednom místě. Každá sada
              vede na originál, celý seznam i s nefunkčními odkazy je na stránce <Link to="/data">Data</Link> a všechno
              je i ve <Link to="/data?tab=api">veřejném API</Link> bez registrace.
            </p>
          </div>
          <ol className="hp-zdroje" data-vjezd>
            {zdroje.map((s) => (
              <li key={s.id}>
                <a href={s.portal_url || s.url} target="_blank" rel="noopener noreferrer" className="hp-zdroj">
                  <span className="hp-zdroj-jmeno">{s.name.replace("NKOD — ", "")}</span>
                  <span className="hp-zdroj-drah" aria-hidden="true"><i style={{ width: `${(s.verified / nejvic) * 100}%` }} /></span>
                  <span className="hp-zdroj-pocet">{num(s.verified)}</span>
                  <Icon name="arrow-up-right" size={14} />
                </a>
              </li>
            ))}
            {!zdroje.length && Array.from({ length: 6 }, (_, i) => <li key={i}><span className="skeleton" style={{ height: 38, width: "100%" }} /></li>)}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------ tým */}
      <section className="hp-sekce hp-sekce-alt" id="tym">
        <div className="hp-obsah">
          <div className="hp-hlavicka" data-vjezd>
            <h2 className="hp-nadpis">Loni jsme řešili problémy. Letos je chceme vidět dřív.</h2>
            <p className="hp-podnadpis">
              S projektem KompaZ jsme vyhráli loňský ročník téže soutěže a KAM se dívá o krok dopředu.
              Víc na stránce <Link to="/o-nas">O nás</Link>.
            </p>
          </div>
          <div data-vjezd><Team /></div>
        </div>
      </section>

      {/* ---------------------------------------------------------- závěr */}
      <section className="hp-zaver">
        <div className="hp-obsah hp-zaver-vnitrek" data-vjezd>
          <div>
            <h2 className="hp-nadpis">Kam to směřuje u vás?</h2>
            <p className="hp-podnadpis">Najděte svou obec, nebo asistentovi napište vlastními slovy, co potřebujete doložit.</p>
          </div>
          <div className="hp-cta">
            <Link to="/obce" className="btn btn-primary btn-lg">Najít svou obec <Icon name="arrow-right" size={17} /></Link>
            <button className="btn btn-lg" onClick={() => openAssistant()}><Icon name="sparkle" size={17} /> Zeptat se asistenta</button>
          </div>
        </div>
      </section>

      <footer className="hp-noha">
        <div className="hp-obsah hp-noha-vnitrek">
          <span>© 2026 tým Popojedem. · KAM je prototyp pro Hackathon Královéhradeckého kraje.</span>
          <nav aria-label="Odkazy v patičce">
            <Link to="/o-nas">O nás</Link>
            <a href={WEB_TYMU} target="_blank" rel="noopener noreferrer">Web týmu</a>
            <Link to="/pravni">Právní informace</Link>
            <Link to="/data">Data a metodika</Link>
            <Link to="/data?tab=api">API</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
