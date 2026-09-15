// Otevření stránky výhledu: budoucnost není čára, je to kužel.
//
// Model neumí říct, kolik lidí bude v obci v roce 2040. Umí říct, jak široký
// je rozsah, ve kterém to skoro jistě bude — a přesně to je tady nakreslené:
// každé vlákno je jeden Monte Carlo běh, který si vylosoval porodnost,
// úmrtnost a migraci z vlastní historie území. Vlevo jsou všechna vlákna
// v jednom bodě, protože minulost je jen jedna; doprava se rozestupují.
//
// To rozestoupení je celá myšlenka stránky. Jedna tučná čára uprostřed by
// tvrdila jistotu, kterou model nemá, a graf by lhal tím, co vynechá.
//
// Vlákna jsou skutečné běhy modelu, ne vygenerovaný dekor. Dokud nedorazí,
// panel zůstane prázdný.

import { useId, useMemo } from "react";
import { NadpisHooku } from "./hook-nadpis";
import { hookVstup } from "./hook-tema";
import { Icon } from "./Icon";
import { num } from "../lib/format";

export interface VyhledBod { year: number; population: number }

const W = 640, H = 262;
const PAD = { l: 30, r: 34, t: 28, b: 34 };
/** Víc vláken už se slije do plochy a jen zdržuje vykreslení. */
const MAX_VLAKEN = 60;

export function VyhledHook({ historie, cesty, pravdepodobny, pasmo, baseYear, territory, children }: {
  historie: VyhledBod[];
  cesty: VyhledBod[][];
  pravdepodobny: VyhledBod[];
  pasmo: { year: number; lo: number; hi: number }[];
  baseYear?: number;
  territory?: string;
  children?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const art = useMemo(() => {
    if (pravdepodobny.length < 2) return null;
    // Historie se zkrátí na deset let: delší ocas stlačí budoucnost do pravé
    // třetiny panelu a rozevření kuželu přestane být vidět.
    const h = historie.slice(-10);
    const vse = [...h, ...pravdepodobny];
    const x0 = Math.min(...vse.map((p) => p.year));
    const x1 = Math.max(...vse.map((p) => p.year));
    const hodnoty = [
      ...vse.map((p) => p.population),
      ...pasmo.flatMap((p) => [p.lo, p.hi]),
      ...cesty.slice(0, MAX_VLAKEN).flatMap((c) => c.map((p) => p.population)),
    ].filter((v) => Number.isFinite(v));
    const lo = Math.min(...hodnoty), hi = Math.max(...hodnoty);
    const rozpeti = hi - lo || 1;
    const X = (y: number) => PAD.l + ((y - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);
    const Y = (v: number) => PAD.t + (1 - (v - lo) / rozpeti) * (H - PAD.t - PAD.b);
    const d = (arr: VyhledBod[]) => arr.map((p, i) => `${i ? "L" : "M"}${X(p.year).toFixed(1)},${Y(p.population).toFixed(1)}`).join("");

    const spoj = h.length ? [h[h.length - 1], ...pravdepodobny] : pravdepodobny;
    const band = pasmo.length > 1
      ? `M${pasmo.map((p) => `${X(p.year).toFixed(1)},${Y(p.hi).toFixed(1)}`).join("L")}`
        + `L${[...pasmo].reverse().map((p) => `${X(p.year).toFixed(1)},${Y(p.lo).toFixed(1)}`).join("L")}Z`
      : "";
    const konec = pravdepodobny[pravdepodobny.length - 1];
    const sirka = pasmo.length ? pasmo[pasmo.length - 1].hi - pasmo[pasmo.length - 1].lo : 0;

    return {
      historie: h.length > 1 ? d(h) : "",
      vlakna: cesty.slice(0, MAX_VLAKEN)
        .map((c) => (h.length ? d([h[h.length - 1], ...c]) : d(c)))
        .filter(Boolean),
      stred: d(spoj),
      band,
      x0, x1,
      delicX: h.length ? X(h[h.length - 1].year) : PAD.l,
      konecX: X(konec.year), konecY: Y(konec.population),
      sirka: Math.round(sirka),
      konecRok: konec.year,
    };
  }, [historie, cesty, pravdepodobny, pasmo]);

  return (
    <section className="sc-hook vy-hook" {...hookVstup("vyhled")} aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /><i className="sc-blob b3" /></div>

      <div className="sc-hook-copy">
        <div className="eyebrow">Výhled 2026–2040{territory ? ` · ${territory}` : ""}</div>
        <NadpisHooku id={`${uid}-t`}>Budoucnost není čára.<br />Je to kužel.</NadpisHooku>
        <p className="lead">
          Každé vlákno je jeden běh modelu, který si vylosoval porodnost, úmrtnost a migraci z vlastní
          historie území. Vlevo splývají, protože minulost je jedna. Doprava se rozestupují — a to
          rozestoupení je poctivá odpověď na otázku, co bude.
        </p>
        <div className="sc-hook-legend">
          <span><i className="sw base" /> Skutečnost</span>
          <span><i className="sw scen" /> Pravděpodobný průběh</span>
          {baseYear && <span className="mute">výchozí rok {baseYear}</span>}
        </div>
        {children}
      </div>

      <div className="sc-stage" aria-hidden={art ? undefined : "true"}>
        <div className="sc-pane p3" />
        <div className="sc-pane p2" />
        <div className="sc-pane p1">
          <span className="sc-sheen" />
          <svg className="sc-art vy-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
            role="img" aria-label={art ? `Kužel možných průběhů počtu obyvatel do roku ${art.konecRok}` : "Zatím bez výhledu"}>
            <defs>
              <linearGradient id={`${uid}b`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--h1)" stopOpacity="0.02" />
                <stop offset="100%" stopColor="var(--h1)" stopOpacity="0.3" />
              </linearGradient>
            </defs>

            {art && (
              <>
                {art.band && <path className="vy-band" d={art.band} fill={`url(#${uid}b)`} />}
                <g className="vy-vlakna">
                  {art.vlakna.map((d, i) => (
                    <path key={i} d={d} pathLength={100} style={{ ["--i" as string]: i % 20 }} />
                  ))}
                </g>
                {art.historie && <path className="vy-hist" d={art.historie} />}
                {/* Předěl mezi tím, co se stalo, a tím, co model dopočítal. */}
                <line className="vy-delic" x1={art.delicX} x2={art.delicX} y1={PAD.t - 4} y2={H - PAD.b + 6} />
                <path className="sc-scen" d={art.stred} pathLength={1000} />
                <g className="sc-end">
                  <circle cx={art.konecX} cy={art.konecY} r="6.5" />
                  <text x={art.konecX - 10} y={art.konecY - 14} textAnchor="end">{art.konecRok}</text>
                </g>
                <text className="sc-yr" x={PAD.l} y={H - 10}>{art.x0}</text>
              </>
            )}
          </svg>
          {art && art.sirka > 0 && (
            <div className="sc-delta glass">
              <Icon name="split" size={14} />
              <strong>{num(art.sirka)}</strong>
              <span>obyvatel je šířka pásma v roce {art.konecRok}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
