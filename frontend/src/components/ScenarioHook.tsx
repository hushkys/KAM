// The opening of the simulator: the one idea the page is about, drawn.
//
// Two futures of the same territory — the one that happens if nobody acts and
// the one with the intervention — separated by the wedge between them. The
// curves are the real baseline and scenario arrays the simulator just
// computed, so this is a view of the result, not an illustration of it; before
// the first result arrives the panes stand empty rather than showing a shape
// nobody measured.
//
// Built from layers on purpose: a receding stack of glass panes (context,
// baseline, scenario) with the light moving across them, which is the same
// structure the model has. Motion is CSS and SMIL only — no animation loop, no
// repaint when the tab is hidden — and all of it stops under
// `data-motion="reduce"`.

import { useId, useMemo } from "react";
import { Icon } from "./Icon";
import { num } from "../lib/format";

export interface HookPoint { year: number; value: number | null }

const W = 640, H = 262;
const PAD = { l: 34, r: 30, t: 30, b: 34 };

export function ScenarioHook({ baseline, scenario, territory, baseYear, delta, children }: {
  baseline: HookPoint[]; scenario: HookPoint[]; territory?: string; baseYear?: number; delta?: number | null; children?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const art = useMemo(() => {
    const b = baseline.filter((p) => p.value !== null) as { year: number; value: number }[];
    const s = scenario.filter((p) => p.value !== null) as { year: number; value: number }[];
    if (b.length < 2) return null;
    const years = b.map((p) => p.year);
    const x0 = Math.min(...years), x1 = Math.max(...years);
    const vals = [...b.map((p) => p.value), ...s.map((p) => p.value)];
    // A 2 % divergence must not fill the panel: keep at least ±6 % of the mean
    // in view, so the wedge stays proportional to what actually changed.
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
    const lo = Math.min(mean * 0.94, ...vals), hi = Math.max(mean * 1.06, ...vals);
    const X = (y: number) => PAD.l + ((y - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);
    const Y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
    const d = (arr: typeof b) => arr.map((p, i) => `${i ? "L" : "M"}${X(p.year).toFixed(1)},${Y(p.value).toFixed(1)}`).join("");
    const same = s.length === b.length && s.every((p, i) => Math.abs(p.value - b[i].value) < 0.5);
    const wedge = s.length > 1 && !same
      ? `${d(s)}L${[...b].reverse().map((p) => `${X(p.year).toFixed(1)},${Y(p.value).toFixed(1)}`).join("L")}Z`
      : "";
    const end = s.length > 1 ? s[s.length - 1] : b[b.length - 1];
    return { base: d(b), scen: s.length > 1 ? d(s) : "", wedge, x0, x1, endX: X(end.year), endY: Y(end.value), grid: [0.22, 0.46, 0.7].map((f) => PAD.t + f * (H - PAD.t - PAD.b)) };
  }, [baseline, scenario]);

  return (
    <section className="sc-hook" aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /><i className="sc-blob b3" /></div>

      <div className="sc-hook-copy">
        <div className="eyebrow">Co kdyby?</div>
        <h1 id={`${uid}-t`}>Dvě budoucnosti<br />stejného území</h1>
        <p className="lead">
          Vlevo sestavíte zásah. Vpravo běží stejný model dvakrát — bez něj a s ním — a rozdíl mezi oběma cestami
          je to jediné, co zásah ve skutečnosti způsobí.
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
              <linearGradient id={`${uid}w`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.42" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.05" />
              </linearGradient>
              {/* The liquid in "liquid glass": a slow turbulent warp on the edge
                  of the wedge only, so the data lines themselves stay exact. */}
              <filter id={`${uid}f`} x="-12%" y="-12%" width="124%" height="124%">
                <feTurbulence type="fractalNoise" baseFrequency="0.008 0.016" numOctaves="2" seed="7" result="n">
                  <animate attributeName="baseFrequency" dur="18s" values="0.008 0.016;0.014 0.009;0.008 0.016" repeatCount="indefinite" />
                </feTurbulence>
                <feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G" />
              </filter>
            </defs>

            {art?.grid.map((y, i) => <line key={i} className="sc-grid" x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} />)}

            {art?.wedge && <path className="sc-wedge" d={art.wedge} fill={`url(#${uid}w)`} filter={`url(#${uid}f)`} />}
            {art && <path className="sc-base" d={art.base} />}
            {art?.scen && <path className="sc-scen" id={`${uid}p`} d={art.scen} pathLength={1000} />}

            {art?.scen && (
              <circle className="sc-pulse" r="5">
                <animateMotion dur="7s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                  <mpath href={`#${uid}p`} />
                </animateMotion>
              </circle>
            )}
            {art && (
              <g className="sc-end">
                <circle cx={art.endX} cy={art.endY} r="6.5" />
                <text x={art.endX - 10} y={art.endY - 14} textAnchor="end">{art.x1}</text>
              </g>
            )}
            {art && <text className="sc-yr" x={PAD.l} y={H - 12}>{art.x0}</text>}
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
