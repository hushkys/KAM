// The hook page: what KAM is, in one screen, with the live numbers behind it.

import { useMemo, type CSSProperties } from "react";
import { openAssistant } from "../components/assistantBus";
import { Team } from "../components/Team";
import { Icon } from "../components/Icon";
import { Wordmark } from "../components/Logo";
import { WordmarkHop } from "../components/WordmarkHop";
import type { GeoKhk } from "../components/maps";
import { Pill } from "../components/ui";
import { useApi } from "../lib/api";
import { compact, num } from "../lib/format";
import { Link } from "../lib/router";
import type { Forecast, Overview, Sources } from "../lib/types";

const LAYERS = [
  { n: "01", title: "Analytická vrstva", text: "Živé profily obcí, ORP, okresů a kraje napříč všemi sledovanými oblastmi. Rozlišuje jednorázový výkyv od dlouhodobého trendu, u každého čísla je zdroj.", to: "/obce" },
  { n: "02", title: "Simulace a výhled", text: "Výhled 2026–2040 ve třech scénářích. Zadejte zásah a porovnejte stav bez zásahu a se zásahem, včetně varování před přetížením kapacit.", to: "/scenare" },
  { n: "03", title: "Podněty občanů", text: "Opakovaná hlášení stejného problému se seskupí a předají kraji jako formální podnět s daty.", to: "/podnety" },
  { n: "04", title: "Datové potřeby", text: "Průběžně hlídá, která data chybí nebo stárnou, a upozorní dřív, než se problém projeví.", to: "/data?tab=potreby" },
];

function Visual() {
  const geo = useApi<GeoKhk>("/geo/khk");
  const fc = useApi<Forecast>("/forecast/kraj:86");
  const curve = useMemo(() => {
    if (!geo.data || !fc.data?.available) return null;
    const [, , w, h] = geo.data.viewBox.split(" ").map(Number);
    const pts = [
      ...fc.data.history.filter((r) => r.year >= 2005).map((r) => ({ year: r.year, v: r.population, future: false })),
      ...fc.data.scenarios.pravdepodobny.map((r) => ({ year: r.year, v: r.population, future: true })),
    ];
    // Keep the vertical scale honest: a 3 % change must not fill the whole
    // map, so the range is at least ±8 % around the mean.
    const mean = pts.reduce((a, p) => a + p.v, 0) / pts.length;
    const lo = Math.min(mean * 0.92, ...pts.map((p) => p.v)), hi = Math.max(mean * 1.08, ...pts.map((p) => p.v));
    const x = (y: number) => 40 + ((y - 2005) / (2040 - 2005)) * (w - 80);
    const yv = (v: number) => h * 0.86 - ((v - lo) / (hi - lo || 1)) * h * 0.55;
    const path = (arr: typeof pts) => arr.map((p, i) => `${i ? "L" : "M"}${x(p.year).toFixed(1)},${yv(p.v).toFixed(1)}`).join("");
    const past = pts.filter((p) => !p.future);
    const future = [past[past.length - 1], ...pts.filter((p) => p.future)];
    const marks = [2005, 2015, fc.data.base_year, 2030, 2040].map((y) => pts.find((p) => p.year === y)).filter(Boolean) as typeof pts;
    return { w, h, past: path(past), future: path(future), marks: marks.map((m) => ({ ...m, x: x(m.year), y: yv(m.v) })) };
  }, [geo.data, fc.data]);
  if (!geo.data) return <div className="hook-visual" style={{ aspectRatio: "1000 / 760" }} />;
  return (
    <div className="hook-visual reveal" style={{ "--i": 3 } as CSSProperties}>
      <svg viewBox={geo.data.viewBox} role="img" aria-label="Královéhradecký kraj a vývoj počtu obyvatel 2005–2040">
        {geo.data.orp.map((o, i) => <path key={o.code} d={o.d} className="kraj-orp" style={{ animation: `region-in 900ms var(--ease-out) ${i * 40}ms both` }} />)}
        <path d={geo.data.outline} className="kraj-out" />
        {curve && (
          <g>
            {curve.marks.map((m) => <line key={`d${m.year}`} className="curve-drop" x1={m.x} x2={m.x} y1={m.y} y2={curve.h - 10} />)}
            <path d={curve.past} className="curve" pathLength={1000} style={{ strokeDasharray: 1000, strokeDashoffset: 1000, animation: "draw 1400ms var(--ease-out) 300ms forwards" }} />
            <path d={curve.future} className="curve curve-future" style={{ opacity: 0, animation: "fade-in 600ms 1500ms forwards" }} />
            {curve.marks.map((m, i) => (
              <g key={m.year} style={{ opacity: 0, animation: `fade-in 400ms ${500 + i * 260}ms forwards` }}>
                <circle cx={m.x} cy={m.y} r={m.year === 2040 ? 11 : 6.5} className={m.year === 2040 ? "curve-end" : "curve-dot"} />
                <text className="curve-label" x={m.x} y={m.y - 18} textAnchor="middle">{m.year}</text>
              </g>
            ))}
          </g>
        )}
      </svg>
      <div className="hook-caption">Královéhradecký kraj · obyvatelé 2005–2040</div>
    </div>
  );
}

export function Hook() {
  const ov = useApi<Overview>("/overview");
  const src = useApi<Sources>("/sources");
  const d = ov.data;
  const core = (src.data?.sources ?? []).filter((s) => s.group === "core" && s.verified > 0).slice(0, 12);
  const regional = (src.data?.sources ?? []).filter((s) => s.group === "kraje" && s.verified > 0);
  return (
    <div className="hook">
      <div className="hook-blobs" aria-hidden="true"><i className="hook-blob b1" /><i className="hook-blob b2" /><i className="hook-blob b3" /></div>
      <svg className="hook-contours" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => (
          <path key={i} fill="none" stroke="var(--grid-line)" strokeWidth="1.2"
            d={`M-50 ${120 + i * 48} C 250 ${60 + i * 52}, 520 ${200 + i * 40}, 800 ${110 + i * 50} S 1150 ${180 + i * 44}, 1300 ${140 + i * 48}`} />
        ))}
      </svg>
      <div className="hook-top">
        <Wordmark />
        <nav aria-label="Úvod">
          <Link to="/o-nas" className="btn btn-quiet btn-sm hide-sm">O nás</Link>
          <Link to="/data" className="btn btn-quiet btn-sm hide-sm">Data</Link>
          <Link to="/prehled" className="btn btn-primary btn-sm">Otevřít KAM <Icon name="arrow-right" size={15} /></Link>
        </nav>
      </div>

      <section className="hook-hero">
        <div>
          <div className="hook-kicker reveal">Hackathon Data KHK · tým Popojedem.</div>
          <div className="hook-word reveal" style={{ "--i": 1 } as CSSProperties}><WordmarkHop /></div>
          <div className="hook-sub reveal" style={{ "--i": 2 } as CSSProperties}>Krajský analytický model</div>
          <p className="hook-claim reveal" style={{ "--i": 3 } as CSSProperties}>Vidět, <em>kam to směřuje.</em></p>
          <p className="hook-lead reveal" style={{ "--i": 4 } as CSSProperties}>
            Co se v kraji děje, proč, kam to vede a co se změní, když zasáhneme — nebo nezasáhneme.
            {d ? ` Nad ${num(d.datasets.verified)} ověřenými otevřenými datovými sadami a ${compact(d.model.observations)} měřenými hodnotami.` : ""}
          </p>
          <div className="hook-cta reveal" style={{ "--i": 5 } as CSSProperties}>
            <Link to="/prehled" className="btn btn-primary btn-lg">Vstoupit do aplikace <Icon name="arrow-right" size={17} /></Link>
            <button className="btn btn-lg" onClick={() => openAssistant()}><Icon name="sparkle" size={17} /> Zeptat se asistenta</button>
          </div>
        </div>
        <Visual />
      </section>

      <section className="hook-section" id="cisla">
        <div className="eyebrow">Živá čísla</div>
        <h2>Postaveno na skutečných datech</h2>
        <p className="lead">Každé číslo níže se počítá z databáze aplikace, ne z textu stránky.</p>
        <div className="counter-grid">
          {[
            { v: d ? num(d.datasets.verified) : "…", l: "Funkčních datových sad", s: d ? `odkaz ověřen · ${num(d.datasets.total)} v katalogu` : "odkaz ověřen" },
            { v: d ? num(d.datasets.publishers) : "…", l: "Poskytovatelů dat", s: "kraje, města, úřady, NKOD" },
            { v: d ? num(d.datasets.loaded) : "…", l: "Načteno přímo do modelu", s: "hodnoty v časových řadách" },
            { v: d ? compact(d.model.observations) : "…", l: "Měřených hodnot", s: d ? `roky ${d.model.years[0]}–${d.model.years[1]}` : "" },
            { v: d ? num(d.model.territories) : "…", l: "Území", s: "kraje, ORP, obce" },
            { v: d ? num(d.model.pois) : "…", l: "Zařízení a zastávek", s: "lékaři, školy, zastávky IREDO…" },
          ].map((c, i) => (
            <div className="counter reveal" key={c.l} style={{ "--i": i } as CSSProperties}>
              <div className="counter-value">{c.v}</div>
              <div className="counter-label">{c.l}</div>
              <div className="counter-sub">{c.s}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="hook-section">
        <div className="eyebrow">Čtyři vrstvy</div>
        <h2>Jeden model kraje, ne čtyři aplikace</h2>
        <p className="lead">Data, výhled, podněty lidí a hlídání samotných dat pracují nad stejnými čísly.</p>
        <div className="layer-grid">
          {LAYERS.map((l, i) => (
            <Link key={l.n} to={l.to} className="layer reveal" style={{ "--i": i } as CSSProperties}>
              <span className="layer-num">{l.n}</span>
              <h3>{l.title}</h3>
              <p>{l.text}</p>
              <span className="go">Otevřít <Icon name="arrow-right" size={14} /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="hook-section" id="vyuzili">
        <div className="eyebrow">Co jsme využili</div>
        <h2>Zdroje a technologie</h2>
        <p className="lead">Celý Národní katalog otevřených dat, krajské a městské portály, geoportál INSPIRE a data ČSÚ. Každý odkaz je ověřený; přesný seznam je na stránce <Link to="/data">Data</Link>.</p>
        <div className="source-grid">
          {[...core, ...regional.slice(0, 9)].map((s) => (
            <a key={s.id} href={s.portal_url || s.url} target="_blank" rel="noopener noreferrer" className="source-tile" data-ctx="dataset" data-ctx-label={s.name} data-ctx-url={s.portal_url || s.url}>
              <span className="st-name">{s.name.replace("NKOD — ", "")}</span>
              <span className="st-count">{num(s.verified)}</span>
            </a>
          ))}
        </div>
        <div className="tech-row">
          {["React + TypeScript", "FastAPI (Python)", "SQLite / PostgreSQL", "Gemma 4 v LM Studiu", "Gemini (cloud)", "nomic-embed + BM25, RRF", "ČÚZK RÚIAN", "vlastní vektorová mapa"].map((t) => <Pill key={t}>{t}</Pill>)}
        </div>
      </section>

      <section className="hook-section" id="tym">
        <div className="eyebrow">Tým Popojedem.</div>
        <h2>Loni jsme ukázali, co dělat, když problém nastane. Letos ho chceme vidět dřív.</h2>
        <p className="lead">Navazujeme na projekt KompaZ z minulého ročníku.</p>
        <Team />
      </section>

      <footer className="hook-foot">
        <span>© 2026 tým Popojedem. · KAM je prototyp pro Hackathon Královéhradeckého kraje.</span>
        <nav><Link to="/o-nas">O nás</Link><Link to="/pravni">Právní informace</Link><Link to="/data">Data a metodika</Link></nav>
      </footer>
    </div>
  );
}
