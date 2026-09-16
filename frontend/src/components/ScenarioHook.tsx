// Otevření simulátoru: dvě budoucnosti téhož území a to, co je mezi nimi.
//
// Dřív tu byla jedna čára a po ní jezdila kulička. Dokud si člověk zásah
// nesestavil, obě cesty se kryly a z celého obrázku zbyla ta čára — což o
// stránce neřeklo nic.
//
// Teď se kreslí rozdíl, protože rozdíl je celá myšlenka té stránky. Nahoře
// obě cesty a mezi nimi příčky, jedna na každý rok: čím dál od sebe, tím jsou
// delší. Dole pruh, ve kterém je ten samý rozdíl vynesený od nuly — a když je
// nula, je vidět nula. Prázdno se tu nepředstírá: dokud zásah nic nemění,
// obrázek to řekne slovem, místo aby ukazoval tvar, který nikdo nespočítal.
//
// Křivky jsou skutečná pole `baseline` a `scenario` z právě doběhlé simulace.
// Pohyb je jen CSS — žádná smyčka, žádné překreslování na skryté záložce —
// a pod `data-motion="reduce"` stojí celý.

import { useId, useMemo } from "react";
import { NadpisHooku } from "./hook-nadpis";
import { hookVstup } from "./hook-tema";
import { Icon } from "./Icon";
import { num } from "../lib/format";

export interface HookPoint { year: number; value: number | null }

const W = 640, H = 262;
const PAD = { l: 34, r: 34, t: 26 };
/** Vodorovná linka, na které končí cesty a začíná pruh s rozdílem. */
const DELIC = 168;
/** Pruh s rozdílem: od popisku dolů. Nula leží dole, dokud mají všechny roky
 *  stejné znaménko — sloupce pak mají celou výšku místo poloviny. */
const PRUH = { od: 188, do: 238 };

export function ScenarioHook({ baseline, scenario, territory, baseYear, delta, children }: {
  baseline: HookPoint[]; scenario: HookPoint[]; territory?: string; baseYear?: number; delta?: number | null; children?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const art = useMemo(() => {
    const b = baseline.filter((p) => p.value !== null) as { year: number; value: number }[];
    const s = scenario.filter((p) => p.value !== null) as { year: number; value: number }[];
    if (b.length < 2) return null;

    const x0 = b[0].year, x1 = b[b.length - 1].year;
    const X = (y: number) => PAD.l + ((y - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);

    const vals = [...b.map((p) => p.value), ...s.map((p) => p.value)];
    // Dvouprocentní rozestup nesmí zaplnit celý panel: v obraze zůstává vždy
    // aspoň ±6 % průměru, aby byl klín úměrný tomu, co se doopravdy změnilo.
    const prumer = vals.reduce((a, v) => a + v, 0) / vals.length;
    const lo = Math.min(prumer * 0.94, ...vals), hi = Math.max(prumer * 1.06, ...vals);
    const Y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (DELIC - PAD.t - 16);
    const cesta = (arr: typeof b) => arr.map((p, i) => `${i ? "L" : "M"}${X(p.year).toFixed(1)},${Y(p.value).toFixed(1)}`).join("");

    const scenPodleRoku = new Map(s.map((p) => [p.year, p.value]));
    const rozdily = b.map((p) => ({ year: p.year, base: p.value, scen: scenPodleRoku.get(p.year) ?? null }))
      .map((r) => ({ ...r, d: r.scen === null ? null : r.scen - r.base }));
    const maxRozdil = Math.max(1, ...rozdily.map((r) => Math.abs(r.d ?? 0)));
    const kryjiSe = rozdily.every((r) => r.d === null || Math.abs(r.d) < 0.5);

    // Nula dole, dokud jdou všechny roky jedním směrem; jakmile se znaménka
    // míchají, odsune se doprostřed, aby bylo kam kreslit obě strany.
    const obojiSmer = rozdily.some((r) => (r.d ?? 0) > 0.5) && rozdily.some((r) => (r.d ?? 0) < -0.5);
    const vyska = PRUH.do - PRUH.od;
    const nula = obojiSmer ? PRUH.od + vyska / 2 : PRUH.do;
    const strop = obojiSmer ? vyska / 2 - 2 : vyska - 2;
    const sirkaSloupce = Math.max(2.5, ((W - PAD.l - PAD.r) / Math.max(1, rozdily.length)) * 0.42);
    const sloupce = rozdily.map((r) => {
      const v = (Math.abs(r.d ?? 0) / maxRozdil) * strop;
      return { year: r.year, x: X(r.year) - sirkaSloupce / 2, y: (r.d ?? 0) >= 0 ? nula - v : nula, h: Math.max(0, v), kladny: (r.d ?? 0) >= 0, d: r.d ?? 0 };
    });

    const klin = !kryjiSe && s.length > 1
      ? `${cesta(s)}L${[...b].reverse().map((p) => `${X(p.year).toFixed(1)},${Y(p.value).toFixed(1)}`).join("L")}Z`
      : "";
    // Příčky: jedna na rok, ale nejvýš dvacet, ať se z nich nestane šrafura.
    const krok = Math.max(1, Math.ceil(rozdily.length / 20));
    const pricky = kryjiSe ? [] : rozdily
      .filter((r, i) => r.scen !== null && i % krok === 0 && Math.abs(r.d ?? 0) > 0.5)
      .map((r) => ({ year: r.year, x: X(r.year), y1: Y(r.base), y2: Y(r.scen as number), sila: Math.abs(r.d ?? 0) / maxRozdil }));

    const konec = rozdily[rozdily.length - 1];
    // Plocha pod spodní z cest: bez ní je horní půlka panelu prázdná zvlášť
    // ve chvíli, kdy se cesty kryjí a je vidět jediná čára.
    const spodni = b.map((p) => ({ year: p.year, value: Math.min(p.value, scenPodleRoku.get(p.year) ?? p.value) }));
    const plocha = `M${X(x0).toFixed(1)},${(DELIC - 8).toFixed(1)}L${cesta(spodni).slice(1)}L${X(x1).toFixed(1)},${(DELIC - 8).toFixed(1)}Z`;

    return {
      // Cesta se zásahem se kreslí i tehdy, když leží přesně na té bez zásahu —
      // je to výsledek, ne prázdno, a legenda vedle ukazuje na obě.
      base: cesta(b), scen: s.length > 1 ? cesta(s) : "", plocha, klin, pricky, sloupce, nula, kryjiSe, sirkaSloupce,
      x0, x1, levy: PAD.l, pravy: W - PAD.r,
      konecBaseY: Y(b[b.length - 1].value),
      konecScenY: konec.scen !== null ? Y(konec.scen) : null,
      konecRozdil: konec.d ?? 0,
      mrizka: [0.24, 0.52, 0.8].map((f) => PAD.t + f * (DELIC - PAD.t - 16)),
    };
  }, [baseline, scenario]);

  return (
    <section className="sc-hook" {...hookVstup("scenare")} aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /><i className="sc-blob b3" /></div>

      <div className="sc-hook-copy">
        <div className="eyebrow">Co kdyby?</div>
        <NadpisHooku id={`${uid}-t`}>Dvě budoucnosti<br />stejného území</NadpisHooku>
        <p className="lead">
          Vlevo sestavíte zásah. Vpravo běží stejný model dvakrát — bez něj a s ním — a rozdíl mezi
          oběma cestami je to jediné, co zásah ve skutečnosti způsobí. Proto je nakreslený zvlášť.
        </p>
        <div className="sc-hook-legend">
          <span><i className="sw base" /> Bez zásahu</span>
          <span><i className="sw scen" /> Se zásahem</span>
          {territory && <span className="mute">{territory}{baseYear ? ` · výchozí rok ${baseYear}` : ""}</span>}
        </div>
        {children}
      </div>

      <div className="sc-stage" aria-hidden={art ? undefined : "true"}>
        <div className="sc-pane p3" />
        <div className="sc-pane p2" />
        <div className="sc-pane p1">
          <span className="sc-sheen" />
          <svg className="sc-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
            role="img" aria-label={art ? `Vývoj bez zásahu a se zásahem${territory ? ` pro ${territory}` : ""}` : "Zatím bez výsledku"}>
            <defs>
              <linearGradient id={`${uid}a`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--h1)" stopOpacity="0.14" />
                <stop offset="100%" stopColor="var(--h1)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`${uid}w`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--h1)" stopOpacity="0.40" />
                <stop offset="100%" stopColor="var(--h1)" stopOpacity="0.04" />
              </linearGradient>
              {/* To „tekuté" ve skle: pomalý vír jen na klínu, aby samotné
                  datové čáry zůstaly přesné. */}
              <filter id={`${uid}f`} x="-12%" y="-12%" width="124%" height="124%">
                <feTurbulence type="fractalNoise" baseFrequency="0.008 0.016" numOctaves="2" seed="7" result="n">
                  <animate attributeName="baseFrequency" dur="18s" values="0.008 0.016;0.014 0.009;0.008 0.016" repeatCount="indefinite" />
                </feTurbulence>
                <feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G" />
              </filter>
            </defs>

            {art && (
              <>
                {art.mrizka.map((y, i) => <line key={i} className="sc-grid" x1={art.levy} x2={art.pravy} y1={y} y2={y} />)}

                <path className="sc-plocha" d={art.plocha} fill={`url(#${uid}a)`} />
                {art.klin && <path className="sc-wedge" d={art.klin} fill={`url(#${uid}w)`} filter={`url(#${uid}f)`} />}

                {/* Příčky kreslí rozdíl přímo mezi cestami — rok po roce. */}
                <g className="sc-pricky">
                  {art.pricky.map((p) => (
                    <line key={p.year} x1={p.x} x2={p.x} y1={p.y1} y2={p.y2} style={{ opacity: 0.25 + p.sila * 0.55 }} />
                  ))}
                </g>

                <path className="sc-base" d={art.base} />
                {art.scen && <path className="sc-scen" d={art.scen} pathLength={1000} />}

                <circle className="sc-konec je-base" cx={art.pravy} cy={art.konecBaseY} r="3.6" />
                {art.konecScenY !== null && art.scen && <circle className="sc-konec je-scen" cx={art.pravy} cy={art.konecScenY} r="4.6" />}

                {/* Pruh s rozdílem. Nula je nakreslená vždy: i nulový dopad je
                    výsledek a zaslouží si osu, na které je vidět. */}
                <line className="sc-delic" x1={art.levy} x2={art.pravy} y1={DELIC} y2={DELIC} />
                <text className="sc-pruh-popis" x={art.levy} y={DELIC + 14}>Rozdíl proti stavu bez zásahu</text>
                <g className="sc-sloupce">
                  {art.sloupce.map((s) => (
                    <rect key={s.year} className={s.kladny ? "je-plus" : "je-minus"} x={s.x} y={s.y}
                      width={art.sirkaSloupce} height={s.h} rx="1.5" />
                  ))}
                </g>
                <line className="sc-nula" x1={art.levy} x2={art.pravy} y1={art.nula} y2={art.nula} />
                {art.kryjiSe && (
                  <text className="sc-kryje" x={W / 2} y={(PRUH.od + PRUH.do) / 2 + 4} textAnchor="middle">
                    obě cesty zatím vedou stejně — zásah sestavíte vlevo
                  </text>
                )}

                <text className="sc-yr" x={art.levy} y={H - 8}>{art.x0}</text>
                <text className="sc-yr" x={art.pravy} y={H - 8} textAnchor="end">{art.x1}</text>
              </>
            )}
          </svg>
          {delta !== null && delta !== undefined && delta !== 0 && (
            <div className="sc-delta glass">
              <Icon name={delta > 0 ? "trend-up" : "trend-down"} size={14} />
              <strong>{delta > 0 ? "+" : "−"}{num(Math.abs(delta))}</strong>
              <span>obyvatel proti stavu bez zásahu</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
