// Úvodní stránka: celá je to jeden hook.
//
// Není to rozcestník, je to prezentace, kterou člověk projede palcem. Každé
// dějství drží jednu myšlenku a scéna se hýbe podle toho, kde zrovna je:
// rolování píše do CSS proměnnou `--p` (0–1) a zbytek — paralaxa, vjezdy,
// vodorovná dráha vrstev — je pak čisté CSS. Je to schválně: jedna smyčka,
// která čte pozice a zapisuje čísla, se dá udržet v hlavě a hlavně stojí
// zlomek toho, co by stálo dvanáct nezávislých pozorovatelů.
//
// Vodorovné dějství (čtyři vrstvy) je na myši připíchnuté — svislé rolování
// posouvá dráhu do strany — a na dotyku je z něj obyčejný vodorovný posuv se
// zarážkami. Prst chce hýbat obsahem přímo, ne přes zprostředkovatele.
//
// Pod `data-motion="reduce"` se smyčka vůbec nespustí, všechno stojí na
// koncových hodnotách a stránka je obyčejný dlouhý dokument.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { openAssistant } from "../components/assistantBus";
import { Icon } from "../components/Icon";
import { KrajVizual } from "../components/KrajVizual";
import { Wordmark } from "../components/Logo";
import { Team, WEB_TYMU } from "../components/Team";
import { WordmarkHop } from "../components/WordmarkHop";
import { useApi } from "../lib/api";
import { compact, num } from "../lib/format";
import { Link } from "../lib/router";
import type { Overview, Sources } from "../lib/types";

const VRSTVY = [
  { n: "01", title: "Analytická vrstva", text: "Živé profily obcí, ORP, okresů a kraje napříč všemi sledovanými oblastmi. Rozlišuje jednorázový výkyv od dlouhodobého trendu a u každého čísla je zdroj i rok.", to: "/obce", ikona: "home", cta: "Otevřít profily" },
  { n: "02", title: "Simulace a výhled", text: "Výhled 2026–2040 ve třech scénářích. Zadáte zásah a model spočítá obě cesty — bez něj a s ním — včetně varování, kde se přetíží kapacity.", to: "/scenare", ikona: "split", cta: "Zkusit scénář" },
  { n: "03", title: "Podněty občanů", text: "Opakovaná hlášení téhož problému se seskupí a předají kraji jako formální podnět i s daty, která ho dokládají.", to: "/podnety", ikona: "message", cta: "Zobrazit podněty" },
  { n: "04", title: "Datové potřeby", text: "Průběžně hlídá, která data chybí nebo stárnou, a řekne to dřív, než se z díry v datech stane díra v rozhodnutí.", to: "/data?tab=potreby", ikona: "database", cta: "Co chybí" },
];

/** Cesta od údaje k rozhodnutí. Je to pořadí, ve kterém aplikace pracuje,
 *  a zároveň jediná věc, kterou je na úvodní stránce potřeba pochopit. */
const CESTA = [
  { n: "01", t: "Profil", d: "Co o území víme. Každý údaj má rok a zdroj — a když zdroj mlčí, řekne se to.", to: "/obce" },
  { n: "02", t: "Riziko", d: "Kde se řada láme. Robustní statistika, protože počty v malé obci nejsou normální rozdělení.", to: "/prehled" },
  { n: "03", t: "Výhled", d: "Kam to při současných trendech vede, s pásmem nejistoty a přiznanou mírou důvěry.", to: "/vyhled" },
  { n: "04", t: "Scénář", d: "Co se změní, když zasáhneme. Tentýž model dvakrát a rozdíl mezi oběma cestami.", to: "/scenare" },
  { n: "05", t: "Podnět", d: "Co data nevidí, přidají lidé z místa. Opakovaná hlášení se spojí do podnětu kraji.", to: "/podnety" },
];

const tichy = () => typeof document !== "undefined" && document.documentElement.dataset.motion === "reduce";
const sevri = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** Jedna smyčka pro celou stránku: čte pozice, zapisuje `--p`.
 *
 *  `[data-p]` dostane postup svého průletu obrazovkou (0 = pod okrajem,
 *  1 = nad ním), `[data-pin]` postup uvnitř připíchnutého dějství. */
function useScena(koren: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = koren.current;
    if (!el) return;
    const prvky = Array.from(el.querySelectorAll<HTMLElement>("[data-p]"));
    const piny = Array.from(el.querySelectorAll<HTMLElement>("[data-pin]"));
    const sekce = Array.from(el.querySelectorAll<HTMLElement>("section[id]"));
    if (tichy()) {
      prvky.forEach((p) => p.style.setProperty("--p", "1"));
      piny.forEach((p) => p.style.setProperty("--p", "0"));
      return;
    }
    let raf = 0;
    const kresli = () => {
      raf = 0;
      const vh = window.innerHeight;
      // Postup celou stránkou: veze pozadí (paralaxa) a plní ukazatel v liště.
      const celkem = Math.max(1, document.documentElement.scrollHeight - vh);
      el.style.setProperty("--s", (window.scrollY / vh).toFixed(4));
      el.style.setProperty("--hp-cesta", sevri(window.scrollY / celkem).toFixed(4));
      for (const p of prvky) {
        const r = p.getBoundingClientRect();
        p.style.setProperty("--p", sevri((vh - r.top) / (vh + r.height)).toFixed(4));
      }
      // Které dějství právě čteme. Rozhoduje čára ve 42 % výšky okna, ne
      // střed: nadpis sekce je nahoře a člověk ji vnímá jako aktivní dřív,
      // než se doroluje doprostřed.
      const cara = vh * 0.42;
      let akt = "";
      for (const s of sekce) {
        const r = s.getBoundingClientRect();
        if (r.top <= cara && r.bottom > cara) akt = s.id;
      }
      if (el.dataset.akt !== akt) el.dataset.akt = akt;
      for (const p of piny) {
        const r = p.getBoundingClientRect();
        p.style.setProperty("--p", sevri(-r.top / Math.max(1, p.offsetHeight - vh)).toFixed(4));
        // Délka dráhy se měří, nehádá: rozdíl pravého okraje poslední karty a
        // levého okraje první je vůči posunu neměnný, takže se dá číst i za
        // jízdy. Z téhle délky pak vychází i výška sekce — dějství je přesně
        // tak dlouhé, kolik je co ukazovat.
        const draha = p.querySelector<HTMLElement>("[data-draha]");
        const prvni = draha?.firstElementChild?.getBoundingClientRect();
        const posledni = draha?.lastElementChild?.getBoundingClientRect();
        if (draha && prvni && posledni) {
          const okraj = parseFloat(getComputedStyle(draha).paddingLeft) || 0;
          // Proti šířce sekce, ne dráhy: dráha sedí v mřížce se sloupcem podle
          // obsahu, takže je sama tak široká jako karty a rozdíl by vyšel nula.
          const delka = Math.max(0, (posledni.right - prvni.left) - (p.clientWidth - 2 * okraj));
          p.style.setProperty("--drah", `${Math.round(delka)}px`);
        }
      }
    };
    const tik = () => { if (!raf) raf = requestAnimationFrame(kresli); };
    // Na skryté záložce `requestAnimationFrame` neběží, takže scéna zamrzne
    // tam, kde byla. Po návratu se dopočítá rovnou, ne až při prvním posunu.
    const zpet = () => { if (!document.hidden) kresli(); };
    kresli();
    window.addEventListener("scroll", tik, { passive: true });
    window.addEventListener("resize", tik);
    document.addEventListener("visibilitychange", zpet);
    return () => {
      window.removeEventListener("scroll", tik);
      window.removeEventListener("resize", tik);
      document.removeEventListener("visibilitychange", zpet);
      cancelAnimationFrame(raf);
    };
  }, [koren]);
}

/** Vjezd na první pohled. Pozorovatel, ne rolovací smyčka: tohle se má stát
 *  jednou a pak dát pokoj.
 *
 *  `useLayoutEffect`, ne `useEffect`: při vypnutém pohybu se `je-videt`
 *  přidává hned, ale `useEffect` běží až *po* prvním vykreslení, takže by
 *  prohlížeč stihl na zlomek snímku vykreslit prvky v jejich výchozím stavu
 *  (`opacity: 0`) — na pomalém stroji nebo ve snímku pořízeném přesně v tu
 *  chvíli (viz `scripts/screenshots.py`) to bylo vidět jako napůl průsvitný
 *  nadpis. `useLayoutEffect` doběhne ještě před tím, než prohlížeč cokoli
 *  nakreslí. */
function useVjezdy(koren: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = koren.current;
    if (!el) return;
    const prvky = Array.from(el.querySelectorAll<HTMLElement>("[data-vjezd]"));
    if (tichy()) { prvky.forEach((p) => p.classList.add("je-videt")); return; }
    const io = new IntersectionObserver((zaznamy) => {
      for (const z of zaznamy) {
        if (z.isIntersecting) { z.target.classList.add("je-videt"); io.unobserve(z.target); }
      }
      // Prah je na nule a spodní okraj jen lehce stažený schválně. Původní
      // „18 % prvku" počítalo z výšky **prvku**, takže vysoký blok naskočil
      // až hluboko za svou horní hranou: mapa v hero měří 366 px a na
      // telefonu se musela vysunout o 131 px, než se vůbec objevila. Do té
      // doby na jejím místě zelo prázdno a vypadalo to jako obrovská mezera
      // pod tlačítky. Takhle se prvek ukáže, jakmile jeho horní hrana projde
      // spodkem obrazovky — stejné pravidlo pro nadpis i pro celý panel.
    }, { threshold: 0, rootMargin: "0px 0px -4% 0px" });
    prvky.forEach((p) => io.observe(p));

    // Pojistka na první vykreslení. Pozorovatel hlásí *změnu* protnutí, a
    // rozvržení se tu ustaluje ještě po něm: dotečou data z API, doběhne
    // písmo, mapa si dopočítá výšku. Prvek, který je přitom celou dobu na
    // obrazovce, se tak nemusí dočkat ani jedné zprávy a zůstane průhledný —
    // na telefonu z toho byla obrovská mezera pod tlačítky, kde měla být
    // mapa. Dorovnání proto po každém ustálení projde, co je vidět, a dodá
    // třídu samo.
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

/** Odlesk skla jde za kurzorem.
 *
 *  Jeden posluchač na celé stránce, ne na každém boxu: skleněných prvků je
 *  tu přes třicet a třicet posluchačů pointeru je daň, kterou nic nevrátí.
 *  Pozice se zapisuje do `--mx`/`--my` toho prvku, nad kterým kurzor je,
 *  a jednou za snímek — `pointermove` chodí i stokrát za vteřinu a zapisovat
 *  proměnnou při každé zprávě by překreslovalo víc, než kolik se stihne
 *  zobrazit.
 *
 *  Na dotyku se nespouští vůbec: prst žádnou polohu „nad" prvkem nemá
 *  a odlesk zůstane tam, kam ho posadil výchozí stav stylu. */
function useOdlesk(koren: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = koren.current;
    if (!el || tichy() || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let raf = 0;
    let posledni: HTMLElement | null = null;
    let cil: HTMLElement | null = null;
    let x = 0, y = 0;

    const zapis = () => {
      raf = 0;
      if (posledni && posledni !== cil) {
        posledni.style.removeProperty("--mx");
        posledni.style.removeProperty("--my");
      }
      posledni = cil;
      if (!cil) return;
      const r = cil.getBoundingClientRect();
      cil.style.setProperty("--mx", `${(((x - r.left) / Math.max(1, r.width)) * 100).toFixed(1)}%`);
      cil.style.setProperty("--my", `${(((y - r.top) / Math.max(1, r.height)) * 100).toFixed(1)}%`);
    };

    const pohyb = (e: PointerEvent) => {
      x = e.clientX; y = e.clientY;
      cil = (e.target as Element | null)?.closest?.<HTMLElement>(".sklo") ?? null;
      if (!raf) raf = requestAnimationFrame(zapis);
    };
    const pryc = () => { cil = null; if (!raf) raf = requestAnimationFrame(zapis); };

    el.addEventListener("pointermove", pohyb, { passive: true });
    el.addEventListener("pointerleave", pryc, { passive: true });
    return () => {
      el.removeEventListener("pointermove", pohyb);
      el.removeEventListener("pointerleave", pryc);
      cancelAnimationFrame(raf);
      posledni?.style.removeProperty("--mx");
      posledni?.style.removeProperty("--my");
    };
  }, [koren]);
}

/** Číslo jako odometr: každá číslice je svislý pás 0–9, který se při vjezdu
 *  přetočí na svou hodnotu.
 *
 *  Proč ne obyčejné počítání nahoru: to tu bylo a bylo z toho jen rychle
 *  blikající číslo, ze kterého se nedalo nic přečíst. Pás má fyzický pohyb —
 *  oko ho sleduje, pozná, že se něco měří, a poslední číslice dojede jako
 *  poslední, takže je vidět, kde se to zastavilo.
 *
 *  Pás má dvacet políček (0–9 dvakrát) a cíl je v druhé desítce, takže každá
 *  číslice udělá napřed celou otočku. Nehýbe tím JavaScript — cílová poloha
 *  je jedna CSS proměnná a zbytek je přechod, takže to nestojí ani snímek
 *  navíc. Formátovaný text se rozpadá po znacích: číslice dostanou pás,
 *  mezery a písmena („tis.") zůstanou stát.
 */
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

  if (hodnota === null) return <span ref={ref}>…</span>;
  const text = format(hodnota);
  let poradi = 0;
  return (
    <span ref={ref} className={`od${videt ? " je-videt" : ""}`}>
      {/* Čtečka dostane hotové číslo; rozsypané číslice by přečetla po jedné. */}
      <span className="visually-hidden">{text}</span>
      {[...text].map((z, i) => {
        if (!/[0-9]/.test(z)) {
          return <span className="od-znak" key={i} aria-hidden="true">{z === " " ? "\u00a0" : z}</span>;
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
  useScena(koren);
  useVjezdy(koren);
  useOdlesk(koren);

  const d = ov.data;
  // Žebříček podle toho, kolik z kterého zdroje opravdu drží ověřených sad.
  // Dřív tu jely dva nekonečné pásy; pohyb nic neříkal a číst se z něj nedalo.
  const zdroje = useMemo(
    () => (src.data?.sources ?? []).filter((s) => s.verified > 0).sort((a, b) => b.verified - a.verified).slice(0, 12),
    [src.data],
  );

  const cisla: { v: number | null; f: (n: number) => string; l: string; s: string; velky?: boolean }[] = [
    { v: d?.datasets.verified ?? null, f: num, l: "funkčních datových sad", s: d ? `odkaz ověřen · ${num(d.datasets.total)} v katalogu` : "odkaz ověřen", velky: true },
    { v: d?.model.observations ?? null, f: compact, l: "měřených hodnot", s: d ? `roky ${d.model.years[0]}–${d.model.years[1]}` : "", velky: true },
    { v: d?.datasets.publishers ?? null, f: num, l: "poskytovatelů dat", s: "kraje, města, úřady, NKOD" },
    { v: d?.datasets.loaded ?? null, f: num, l: "sad přímo v modelu", s: "hodnoty v časových řadách" },
    { v: d?.model.territories ?? null, f: num, l: "území", s: "kraj, okresy, ORP, obce" },
    { v: d?.model.pois ?? null, f: num, l: "zařízení a zastávek", s: "lékaři, školy, zastávky IREDO" },
  ];

  return (
    <div className="hp" ref={koren}>
      {/* Lom světla u hrany skla. `fractalNoise` je hladší než `turbulence` —
          ten vypadá jako voda, tohle jako nerovnost ve skle. Rozmazání šumu
          je tu proto, aby posun neskákal po pixelech; `scale` je malý
          schválně, silnější lom už není sklo, ale rybí oko. */}
      <svg className="goo-defs" aria-hidden="true" focusable="false">
        <filter id="hp-lom" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.011" numOctaves={2} seed={11} result="sum" />
          <feGaussianBlur in="sum" stdDeviation="1.8" result="hladky" />
          <feDisplacementMap in="SourceGraphic" in2="hladky" scale="16" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      {/* Pozadí: tři vrstvy, každá se veze jinou rychlostí. */}
      <div className="hp-pozadi" aria-hidden="true">
        <div className="hp-aurora" data-p><i className="hp-skvrna s1" /><i className="hp-skvrna s2" /><i className="hp-skvrna s3" /></div>
        <svg className="hp-vrstevnice" data-p viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
          {Array.from({ length: 16 }, (_, i) => (
            <path key={i} fill="none" stroke="var(--grid-line)" strokeWidth="1.1" pathLength={1}
              d={`M-60 ${100 + i * 46} C 240 ${40 + i * 50}, 520 ${190 + i * 38}, 800 ${96 + i * 48} S 1160 ${170 + i * 42}, 1320 ${126 + i * 46}`} />
          ))}
        </svg>
        <div className="hp-zrno" />
      </div>

      <header className="hp-nav glass">
        <Link to="/" className="hp-nav-znak" aria-label="KAM"><Wordmark /></Link>
        <span className="hp-nav-cesta" aria-hidden="true"><i /></span>
        <nav aria-label="Úvod">
          <a className="hp-nav-odkaz" href="#cisla">Čísla</a>
          <a className="hp-nav-odkaz" href="#cesta">Jak to čteme</a>
          <a className="hp-nav-odkaz" href="#vrstvy">Vrstvy</a>
          <a className="hp-nav-odkaz" href="#tym">Tým</a>
          <Link to="/prehled" className="btn btn-primary btn-sm">Otevřít KAM <Icon name="arrow-right" size={15} /></Link>
        </nav>
      </header>

      {/* ------------------------------------------------------------ 1 */}
      <section className="hp-akt hp-hero" data-p>
        <div className="hp-hero-text">
          <div className="hp-kicker" data-vjezd>Hackathon Data KHK · tým Popojedem.</div>
          <div className="hp-znak" data-vjezd><WordmarkHop /></div>
          <div className="hp-podtitul" data-vjezd>Krajský analytický model</div>
          <h1 className="hp-claim" data-vjezd>
            <span>Vidět,</span> <span><em>kam</em></span> <span>to</span> <span>směřuje.</span>
          </h1>
          <p className="hp-lead" data-vjezd>
            Co se v kraji děje, proč, kam to vede a co se změní, když zasáhneme — nebo nezasáhneme.
            {d ? ` Nad ${num(d.datasets.verified)} ověřenými otevřenými sadami a ${compact(d.model.observations)} měřenými hodnotami.` : ""}
          </p>
          <div className="hp-cta" data-vjezd>
            <Link to="/prehled" className="hp-tlacitko je-hlavni sklo">
              <span>Vstoupit do aplikace</span><Icon name="arrow-right" size={18} />
            </Link>
            <button className="hp-tlacitko sklo" onClick={() => openAssistant()}>
              <Icon name="sparkle" size={18} /><span>Zeptat se asistenta</span>
            </button>
          </div>
        </div>

        <div className="hp-hero-vizual" data-vjezd>
          <KrajVizual />
        </div>

        <a className="hp-dolu" href="#cisla" aria-label="Pokračovat na čísla">
          <span className="hp-dolu-kolecko"><i /></span>
          <span className="hp-dolu-text">Rolujte</span>
        </a>
      </section>

      {/* ------------------------------------------------------------ 2 */}
      <section className="hp-akt hp-cisla" id="cisla" data-p>
        <div className="hp-hlavicka" data-p data-drift>
          <div className="eyebrow" data-vjezd>Živá čísla</div>
          <h2 className="hp-nadpis" data-vjezd>Postaveno na skutečných datech</h2>
          <p className="hp-podnadpis" data-vjezd>
            Každé číslo na téhle stránce se počítá z databáze aplikace. Žádné se nepíše do textu — a stejná
            čísla vrátí i veřejné API, takže si je může kdokoli přepočítat.
          </p>
        </div>
        <div className="hp-bento" data-p data-drift="P">
          {cisla.map((c, i) => (
            <div className={`hp-dlazdice sklo ${c.velky ? "je-velka" : ""}`} key={c.l} data-vjezd style={{ "--i": i } as CSSProperties}>
              <span className="hp-dlazdice-cislo"><Odometr hodnota={c.v} format={c.f} /></span>
              <span className="hp-dlazdice-popis">{c.l}</span>
              <span className="hp-dlazdice-sub">{c.s}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ 3
          První připíchnuté dějství: cesta modelu jako vodorovná linka.
          Svislé rolování ji veze do strany a zároveň plní čáru pod ní. */}
      <section className="hp-pin hp-pin-cesta" id="cesta" data-pin>
        <div className="hp-pin-scena">
          <div className="hp-pin-hlava">
            <div className="eyebrow">Jak to čteme</div>
            <h2 className="hp-nadpis">Od údaje k rozhodnutí<br />v pěti krocích</h2>
            <p className="hp-podnadpis">Pořadí, ve kterém aplikace pracuje. Každý krok stojí na tom předchozím — a nikde se nepřeskakuje.</p>
            <span className="hp-pin-ukazatel" aria-hidden="true"><i /></span>
          </div>
          <div className="hp-cesta" data-draha>
            <span className="hp-cesta-linka" aria-hidden="true"><i /></span>
            {CESTA.map((c, i) => (
              <Link key={c.n} to={c.to} className="hp-krok" style={{ "--i": i } as CSSProperties}>
                <span className="hp-krok-bod" aria-hidden="true" />
                <span className="hp-krok-cislo">{c.n}</span>
                <h3>{c.t}</h3>
                <p>{c.d}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ 4
          Druhé připíchnuté dějství: čtyři vrstvy modelu. */}
      <section className="hp-pin" id="vrstvy" data-pin>
        <div className="hp-pin-scena">
          <div className="hp-pin-hlava">
            <div className="eyebrow">Čtyři vrstvy</div>
            <h2 className="hp-nadpis">Jeden model kraje,<br />ne čtyři aplikace</h2>
            <p className="hp-podnadpis">Data, výhled, podněty lidí i hlídání samotných dat pracují nad stejnými čísly.</p>
            <span className="hp-pin-ukazatel" aria-hidden="true"><i /></span>
          </div>
          <div className="hp-draha" data-draha>
            {VRSTVY.map((l, i) => (
              <Link key={l.n} to={l.to} className="hp-vrstva sklo" style={{ "--i": i } as CSSProperties}>
                <span className="hp-vrstva-cislo">{l.n}</span>
                <span className="hp-vrstva-ikona"><Icon name={l.ikona} size={22} /></span>
                <h3>{l.title}</h3>
                <p>{l.text}</p>
                <span className="hp-vrstva-cta">{l.cta} <Icon name="arrow-right" size={15} /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ 4 */}
      <section className="hp-akt hp-zdroje" data-p>
        <div className="hp-hlavicka" data-p data-drift="P">
          <div className="eyebrow" data-vjezd>Co jsme využili</div>
          <h2 className="hp-nadpis" data-vjezd>Celý katalog, ne vybrané sady</h2>
          <p className="hp-podnadpis" data-vjezd>
            Národní katalog otevřených dat, krajské a městské portály, geoportál INSPIRE a data ČSÚ.
            Každý odkaz je ověřený a přesný seznam je na stránce <Link to="/data">Data</Link>.
          </p>
        </div>
        <div className="hp-zdroje-mrizka" data-vjezd>
          {zdroje.map((s) => (
            <a key={s.id} href={s.portal_url || s.url} target="_blank" rel="noopener noreferrer" className="hp-zdroj sklo">
              <span className="hp-zdroj-pocet">{num(s.verified)}</span>
              <span className="hp-zdroj-jmeno">{s.name.replace("NKOD — ", "")}</span>
              <Icon name="arrow-up-right" size={15} />
            </a>
          ))}
        </div>
        <p className="hp-zdroje-pozn" data-vjezd>
          Čísla jsou ověřené datové sady — odkaz při poslední kontrole odpověděl. Celý seznam
          i s nefunkčními odkazy je na stránce <Link to="/data">Data</Link>.
        </p>
      </section>

      {/* ------------------------------------------------------------ 5 */}
      <section className="hp-akt hp-tym" id="tym" data-p>
        <div className="hp-hlavicka" data-p data-drift="P">
          <div className="eyebrow" data-vjezd>Tým Popojedem.</div>
          <h2 className="hp-nadpis" data-vjezd>Loni jsme ukázali, co dělat,<br />když problém nastane.<br /><em>Letos ho chceme vidět dřív.</em></h2>
          <p className="hp-podnadpis" data-vjezd>
            Navazujeme na KompaZ, se kterým jsme vyhráli loňský ročník téže soutěže. Víc na stránce <Link to="/o-nas">O nás</Link>.
          </p>
        </div>
        <div data-vjezd><Team /></div>
      </section>

      {/* ------------------------------------------------------------ 6 */}
      <section className="hp-akt hp-konec" data-p>
        <div className="hp-konec-karta sklo" data-vjezd>
          <span className="hp-konec-tecka" aria-hidden="true" />
          <h2 className="hp-nadpis">Tak kam to teda<br />směřuje?</h2>
          <p className="hp-podnadpis">Otevřete kraj na jedné obrazovce, nebo se rovnou zeptejte asistenta vlastními slovy.</p>
          <div className="hp-cta">
            <Link to="/prehled" className="hp-tlacitko je-hlavni sklo"><span>Vstoupit do aplikace</span><Icon name="arrow-right" size={18} /></Link>
            <button className="hp-tlacitko sklo" onClick={() => openAssistant()}><Icon name="sparkle" size={18} /><span>Zeptat se asistenta</span></button>
          </div>
        </div>
      </section>

      <footer className="hp-noha">
        <span>© 2026 tým Popojedem. · KAM je prototyp pro Hackathon Královéhradeckého kraje.</span>
        <nav>
          <Link to="/o-nas">O nás</Link>
          <a href={WEB_TYMU} target="_blank" rel="noopener noreferrer">Web týmu</a>
          <Link to="/pravni">Právní informace</Link>
          <Link to="/data">Data a metodika</Link>
          <Link to="/data?tab=api">API</Link>
        </nav>
      </footer>
    </div>
  );
}
