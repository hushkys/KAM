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
import { NAV, SEKCE } from "../components/nav";
import { Team, WEB_TYMU } from "../components/Team";
import { KindTag } from "../components/ui";
import { WordmarkHop } from "../components/WordmarkHop";
import { useApi } from "../lib/api";
import { compact, num } from "../lib/format";
import { Link } from "../lib/router";
import type { Overview, Sources } from "../lib/types";

/** Cesta od údaje k rozhodnutí. Je to pořadí, ve kterém aplikace pracuje,
 *  a zároveň jediná věc, kterou je na úvodní stránce potřeba pochopit. */
const CESTA = [
  { n: "1", t: "Profil", d: "Co o území víme. Každý údaj má rok a zdroj — a když zdroj mlčí, řekne se to.", to: "/obce" },
  { n: "2", t: "Riziko", d: "Kde se řada láme. Robustní statistika, protože počty v malé obci nejsou normální rozdělení.", to: "/prehled" },
  { n: "3", t: "Výhled", d: "Kam to při současných trendech vede, s pásmem nejistoty a přiznanou mírou důvěry.", to: "/vyhled" },
  { n: "4", t: "Scénář", d: "Co se změní, když zasáhneme. Tentýž model dvakrát a rozdíl mezi oběma cestami.", to: "/scenare" },
  { n: "5", t: "Podnět", d: "Co data nevidí, přidají lidé z místa. Opakovaná hlášení se spojí do podnětu kraji.", to: "/podnety" },
];

/** Čtyři druhy čísel, které aplikace ukazuje, a štítek, podle kterého se
 *  poznají. Je to slib: fakt se nikdy nevydává za model a model za fakt. */
const VRSTVY = [
  { kind: "FAKT", t: "Zveřejněná hodnota", d: "Číslo tak, jak ho vydal ČSÚ, kraj nebo jiný správce dat — s rokem a odkazem na zdroj." },
  { kind: "TREND", t: "Směr řady", d: "Robustní odhad sklonu (Theil–Sen, Mann–Kendall) a odlišení jednorázového výkyvu od dlouhodobé změny." },
  { kind: "MODEL", t: "Výhled", d: "Projekce obyvatel do roku 2040 ze tří složek — narození, úmrtí, migrace — s pásmem nejistoty." },
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

  const cisla: { v: number | null; f: (n: number) => string; l: string; s: string }[] = [
    { v: d?.datasets.verified ?? null, f: num, l: "funkčních datových sad", s: d ? `z ${num(d.datasets.total)} v katalogu` : "odkaz ověřen" },
    { v: d?.model.observations ?? null, f: compact, l: "měřených hodnot", s: d ? `roky ${d.model.years[0]}–${d.model.years[1]}` : "" },
    { v: d?.datasets.publishers ?? null, f: num, l: "poskytovatelů dat", s: "kraje, města, úřady, NKOD" },
    { v: d?.datasets.loaded ?? null, f: num, l: "sad přímo v modelu", s: "hodnoty v časových řadách" },
    { v: d?.model.territories ?? null, f: num, l: "území", s: "kraj, okresy, ORP, obce" },
    { v: d?.model.pois ?? null, f: num, l: "zařízení a zastávek", s: "lékaři, školy, zastávky IREDO" },
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
              Analytický model pro obce, kraj a stát. Co se v území děje, proč, kam to vede a co se změní,
              když zasáhneme — nebo nezasáhneme.
              {d ? ` Nad ${num(d.datasets.verified)} ověřenými otevřenými sadami a ${compact(d.model.observations)} měřenými hodnotami.` : ""}
            </p>
            <div className="hp-cta" data-vjezd>
              <Link to="/prehled" className="btn btn-primary btn-lg">Otevřít aplikaci <Icon name="arrow-right" size={17} /></Link>
              <button className="btn btn-lg" onClick={() => openAssistant()}><Icon name="sparkle" size={17} /> Zeptat se asistenta</button>
            </div>
            <ul className="hp-sliby" data-vjezd>
              <li><Icon name="check" size={15} /> U každého čísla rok a zdroj</li>
              <li><Icon name="check" size={15} /> Veřejné API pro vlastní analýzy</li>
              <li><Icon name="check" size={15} /> Bez přihlášení</li>
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
            <div className="eyebrow">Moduly</div>
            <h2 className="hp-nadpis">Pracovní místa nad jedním modelem kraje</h2>
            <p className="hp-podnadpis">Každý modul má svou barvu — v navigaci, v hlavičce stránky i v grafech — takže je
              vždycky vidět, kde člověk je. Všechny pracují nad stejnými čísly.</p>
          </div>
          <div className="hp-moduly">
            {moduly.map((n, i) => {
              const b = modulBarvy(n.module);
              return (
                <Link key={n.path} to={n.path} className="hp-modul" data-vjezd
                  style={{ "--i": i, "--mc-a": b.a, "--mc-b": b.b } as CSSProperties}>
                  <span className="hp-modul-hlava">
                    <ModuleIcon name={n.module} size={26} />
                    <span className="hp-modul-sekce">{SEKCE[n.sekce]}</span>
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
            <div className="eyebrow">Metodika</div>
            <h2 className="hp-nadpis">Od údaje k rozhodnutí</h2>
            <p className="hp-podnadpis">Pořadí, ve kterém aplikace pracuje. Každý krok stojí na tom předchozím a nikde se nepřeskakuje.</p>
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
            <div className="eyebrow">Zdroje</div>
            <h2 className="hp-nadpis">Celý katalog, ne vybrané sady</h2>
            <p className="hp-podnadpis">
              Národní katalog otevřených dat, krajské a městské portály, geoportál INSPIRE a data ČSÚ. Čísla jsou
              ověřené datové sady — odkaz při poslední kontrole odpověděl. Celý seznam i s nefunkčními odkazy je na
              stránce <Link to="/data">Data</Link>, strojově přes <Link to="/data?tab=api">veřejné API</Link>.
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
            <div className="eyebrow">Tým Popojedem.</div>
            <h2 className="hp-nadpis">Loni jsme ukázali, co dělat, když problém nastane. Letos ho chceme vidět dřív.</h2>
            <p className="hp-podnadpis">
              Navazujeme na KompaZ, se kterým jsme vyhráli loňský ročník téže soutěže. Víc na stránce <Link to="/o-nas">O nás</Link>.
            </p>
          </div>
          <div data-vjezd><Team /></div>
        </div>
      </section>

      {/* ---------------------------------------------------------- závěr */}
      <section className="hp-zaver">
        <div className="hp-obsah hp-zaver-vnitrek" data-vjezd>
          <div>
            <h2 className="hp-nadpis">Kraj na jedné obrazovce</h2>
            <p className="hp-podnadpis">Otevřete přehled, nebo se rovnou zeptejte asistenta vlastními slovy.</p>
          </div>
          <div className="hp-cta">
            <Link to="/prehled" className="btn btn-primary btn-lg">Otevřít aplikaci <Icon name="arrow-right" size={17} /></Link>
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
