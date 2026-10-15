// Charts drawn as plain SVG: one visual language for every graph in the
// app, no library to theme, and a size that follows the container.
// Lines draw in on first paint; hover (or touch) shows a crosshair tooltip.

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { num } from "../lib/format";
import { Icon } from "./Icon";

export interface Point { year: number; value: number | null }
export interface Series {
  key: string;
  label: string;
  points: Point[];
  color: string;
  dashed?: boolean;
  band?: { year: number; lo: number; hi: number }[];
  width?: number;
  /** Thin, translucent, not in the tooltip: example paths behind the main line. */
  faint?: boolean;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(200, Math.round(e[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  // The nice step closest to the ideal one, so the axis keeps roughly
  // `count` ticks instead of rounding up to two or three.
  const nice = [1, 2, 5, 10].reduce((best, n) => (Math.abs(n - norm) < Math.abs(best - norm) ? n : best), 1);
  const step = nice * mag;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export function LineChart({ series, height = 260, unit = "", nowYear, refLine, format, yZero = false, ariaLabel }: {
  series: Series[]; height?: number; unit?: string; nowYear?: number; refLine?: { value: number; label: string }; format?: (v: number) => string; yZero?: boolean; ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const fmt = format ?? ((v: number) => num(v));
  const pad = { l: 52, r: 40, t: 14, b: 28 };
  const years = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.year)))].sort((a, b) => a - b), [series]);
  const vals = series.flatMap((s) => [...s.points.map((p) => p.value), ...(s.band ?? []).flatMap((b) => [b.lo, b.hi])]).filter((v): v is number => v !== null && Number.isFinite(v));
  if (refLine) vals.push(refLine.value);
  if (!years.length || !vals.length) return <div className="chart muted small">Bez dat</div>;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (yZero) lo = Math.min(0, lo);
  const padY = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  lo -= yZero && lo === 0 ? 0 : padY; hi += padY;
  const ticks = niceTicks(lo, hi, height < 200 ? 3 : 4);
  lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
  const x0 = years[0], x1 = years[years.length - 1];
  const X = (y: number) => pad.l + ((y - x0) / Math.max(1, x1 - x0)) * (width - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const every = Math.ceil(years.length / Math.max(2, Math.floor((width - 80) / 58)));
  // The last year is always labelled; a regular tick too close to it is dropped.
  const xTicks = years.filter((y, i) => y === x1 || (i % every === 0 && years.length - 1 - i >= Math.ceil(every * 0.6)));
  const path = (pts: Point[]) => {
    let d = "", pen = false;
    for (const p of pts) {
      if (p.value === null || !Number.isFinite(p.value)) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${X(p.year).toFixed(1)},${Y(p.value).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  /** Points with nothing to connect to.
   *
   *  A stroked path made of a single `M` draws nothing at all, so a series with
   *  one year — which is every Data KHK facility layer, they are snapshots —
   *  came out as an empty chart with axes around it. The same goes for a value
   *  stranded between two gaps in the middle of a series. */
  const isolated = (pts: Point[]) => {
    const solid = (p?: Point) => p !== undefined && p.value !== null && Number.isFinite(p.value);
    return pts.filter((p, i) => solid(p) && !solid(pts[i - 1]) && !solid(pts[i + 1]));
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const xPx = ((e.clientX - r.left) / r.width) * width;
    let best = years[0], dist = Infinity;
    for (const y of years) { const d = Math.abs(X(y) - xPx); if (d < dist) { dist = d; best = y; } }
    setHover(best);
  };
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={Y(t)} y2={Y(t)} />
            <text className="axis-label" x={pad.l - 8} y={Y(t) + 4} textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        {xTicks.map((y) => <text key={y} className="axis-label" x={X(y)} y={height - 8} textAnchor="middle">{y}</text>)}
        {nowYear && nowYear >= x0 && nowYear <= x1 && <line className="now-line" x1={X(nowYear)} x2={X(nowYear)} y1={pad.t} y2={height - pad.b} />}
        {refLine && (
          <g>
            <line className="ref-line" x1={pad.l} x2={width - pad.r} y1={Y(refLine.value)} y2={Y(refLine.value)} />
            <text className="axis-label" x={width - pad.r} y={Y(refLine.value) - 6} textAnchor="end">{refLine.label}</text>
          </g>
        )}
        {series.map((s) => s.band && s.band.length > 1 && (
          <path key={`${s.key}-band`} className="band chart-fade" fill={s.color}
            d={`M${s.band.map((b) => `${X(b.year).toFixed(1)},${Y(b.hi).toFixed(1)}`).join("L")}L${[...s.band].reverse().map((b) => `${X(b.year).toFixed(1)},${Y(b.lo).toFixed(1)}`).join("L")}Z`} />
        ))}
        {/* Plocha pod hlavní řadou: barevný přechod do ztracena dává grafu
            tělo, aniž by přidal informaci, kterou by bylo nutné číst. */}
        {(() => {
          const hlavni = series.find((s) => !s.faint && !s.dashed);
          if (!hlavni) return null;
          const pts = hlavni.points.filter((p) => p.value !== null && Number.isFinite(p.value));
          if (pts.length < 2) return null;
          const dno = Y(Math.max(lo, Math.min(hi, yZero ? 0 : lo)));
          const d = `M${X(pts[0].year).toFixed(1)},${dno.toFixed(1)}` + pts.map((p) => `L${X(p.year).toFixed(1)},${Y(p.value as number).toFixed(1)}`).join("")
            + `L${X(pts[pts.length - 1].year).toFixed(1)},${dno.toFixed(1)}Z`;
          return (
            <>
              <defs>
                <linearGradient id={`pl-${gid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={hlavni.color} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={hlavni.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <path className="plocha chart-fade is-slow" d={d} fill={`url(#pl-${gid})`} />
            </>
          );
        })()}
        {series.filter((s) => s.faint).map((s) => (
          <path key={s.key} className="line chart-fade" d={path(s.points)} stroke={s.color} strokeWidth={s.width ?? 1} strokeOpacity={0.38} />
        ))}
        {/* A dashed line cannot draw itself in — the dash pattern is the thing
            being animated — so it fades in over the time the solid one takes
            to arrive, and the two land together. */}
        {series.filter((s) => !s.faint).map((s) => (
          <path key={s.key} className={s.dashed ? "line chart-fade is-slow" : "line draw"} d={path(s.points)} stroke={s.color}
            strokeWidth={s.width ?? 2.2} strokeDasharray={s.dashed ? "5 5" : undefined}
            style={s.dashed ? undefined : { ["--len" as string]: 3000 }} pathLength={s.dashed ? undefined : 3000} />
        ))}
        {series.filter((s) => !s.faint).map((s, si) => {
          const pts = s.points.filter((p) => p.value !== null && Number.isFinite(p.value));
          const p = pts[pts.length - 1];
          if (!p || pts.length < 2 || hover !== null) return null;
          return (
            <g key={`${s.key}-konec`} className="konec spark-pop is-late">
              <circle className="konec-zare" cx={X(p.year)} cy={Y(p.value as number)} r={9} fill={s.color} />
              <circle className="dot" cx={X(p.year)} cy={Y(p.value as number)} r={4.5} fill={s.color} />
              {si < 2 && <text className="konec-text" x={X(p.year) + 9} y={Y(p.value as number) + 4 + (si === 1 ? 12 : 0)} fill={s.color}>{fmt(p.value as number)}</text>}
            </g>
          );
        })}
        {series.filter((s) => !s.faint).flatMap((s) => isolated(s.points).map((p) => (
          <circle key={`${s.key}-solo-${p.year}`} className="dot spark-pop is-late" cx={X(p.year)} cy={Y(p.value as number)} r={4} fill={s.color} />
        )))}
        {hover !== null && (
          <g>
            <line className="now-line" x1={X(hover)} x2={X(hover)} y1={pad.t} y2={height - pad.b} style={{ stroke: "var(--text-mute)" }} />
            {series.filter((s) => !s.faint).map((s) => {
              const p = s.points.find((q) => q.year === hover);
              return p && p.value !== null ? <circle key={s.key} className="dot" cx={X(hover)} cy={Y(p.value)} r={4.5} fill={s.color} /> : null;
            })}
          </g>
        )}
      </svg>
      {hover !== null && (() => {
        const rows = series.filter((s) => !s.faint).map((s) => ({ s, p: s.points.find((q) => q.year === hover) })).filter((r) => r.p && r.p.value !== null);
        if (!rows.length) return null;
        const minY = Math.min(...rows.map((r) => Y(r.p!.value!)));
        const { styl } = umistiTip(X(hover), minY, width);
        return (
          <div className="chart-tip glass" style={styl}>
            <div className="tip-year">{hover}</div>
            {rows.map(({ s, p }) => (
              <div className="tip-row" key={s.key}><span><i style={{ background: s.color }} /> {s.label}</span><strong className="num">{fmt(p!.value!)}{unit && unit !== "%" ? "" : unit}</strong></div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((i) => <span key={i.label}><i className={i.dashed ? "dash" : ""} style={{ background: i.color, color: i.color }} />{i.label}</span>)}
    </div>
  );
}

/** How a small series is drawn. One shape per kind of number, so a wall of
 *  tiles stops reading as one repeated graphic:
 *  - `line`  a plain trace (the default, and what a ratio wants),
 *  - `area`  the same trace over a filled body, for stocks like population,
 *  - `bars`  one column per year, for counts and flows that are not continuous,
 *  - `step`  held values, for a series that only changes when someone changes it.
 *  `outliers` marks the years the trend engine called a one-off spike, and
 *  `baseline` draws the comparison value (usually the kraj) as a faint rule. */
export type SparkVariant = "line" | "area" | "bars" | "step";

export function Sparkline({ points, color = "var(--accent)", ariaLabel, variant = "line", outliers, baseline, height = 34 }: {
  points: Point[]; color?: string; ariaLabel?: string; variant?: SparkVariant; outliers?: number[]; baseline?: number | null; height?: number;
}) {
  const rid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const pts = points.filter((p) => p.value !== null) as { year: number; value: number }[];
  if (pts.length === 1) {
    // One year is not a line, but it is not nothing either — an empty band
    // reads as a chart that failed to load.
    return (
      <svg className="spark spark-solo" viewBox="0 0 120 34" preserveAspectRatio="none" style={{ height }}
        role={ariaLabel ? "img" : undefined} aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : true}>
        <line className="spark-ref" x1="0" x2="120" y1="17" y2="17" vectorEffect="non-scaling-stroke" />
        <circle className="spark-pop" cx="60" cy="17" r="3" fill={color} />
      </svg>
    );
  }
  if (!pts.length) return <svg className="spark" style={{ height }} aria-hidden="true" />;
  const w = 120, h = height;
  const vals = pts.map((p) => p.value);
  if (baseline !== null && baseline !== undefined && Number.isFinite(baseline)) vals.push(baseline);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const X = (i: number) => (i / (pts.length - 1)) * w;
  const Y = (v: number) => (hi === lo ? h / 2 : 3 + (1 - (v - lo) / (hi - lo)) * (h - 6));
  // useId, not a hash of the data: two tiles with the same shape used to get
  // the same gradient id, and duplicate ids in one document are a coin flip.
  const uid = `sp${rid}`;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join("");
  const step = pts.map((p, i) => (i ? `H${X(i).toFixed(1)}V${Y(p.value).toFixed(1)}` : `M${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`)).join("");
  const d = variant === "step" ? step : line;
  const last = pts[pts.length - 1];
  const spikes = new Set(outliers ?? []);
  const bw = Math.max(1.5, (w / pts.length) * 0.62);
  return (
    <svg className={`spark spark-${variant}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height }}
      role={ariaLabel ? "img" : undefined} aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : true}>
      <defs>
        {variant === "area" && (
          <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.34" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        )}
        {/* The area is revealed by a wiping rectangle rather than faded in, so
            the fill arrives with the line that draws over it instead of
            appearing under a line that is still halfway across. */}
        <clipPath id={`${uid}c`}>
          <rect className="spark-wipe" x="0" y="0" width={w} height={h} />
        </clipPath>
      </defs>
      {variant === "area" && (
        <path d={`${line}L${w},${h}L0,${h}Z`} fill={`url(#${uid}g)`} stroke="none" clipPath={`url(#${uid}c)`} />
      )}
      {baseline !== null && baseline !== undefined && Number.isFinite(baseline) && (
        <line className="spark-ref" x1="0" x2={w} y1={Y(baseline)} y2={Y(baseline)} vectorEffect="non-scaling-stroke" />
      )}
      {variant === "bars" ? pts.map((p, i) => (
        <rect className="spark-bar" key={p.year} x={X(i) - bw / 2} y={Y(p.value)} width={bw} height={Math.max(1, h - 2 - Y(p.value))}
          fill={color} opacity={spikes.has(p.year) ? 1 : 0.55 + (0.45 * i) / (pts.length - 1)} rx="0.8"
          style={{ ["--i" as string]: i, ["--n" as string]: pts.length }} />
      )) : (
        // The line is revealed by the same wiping rectangle as the area, not
        // by a dash offset. A sparkline is stretched horizontally
        // (`preserveAspectRatio="none"`) and stroked in screen space
        // (`non-scaling-stroke`); with those two together the browser measures
        // the dash pattern in one space and the path in the other, so
        // `stroke-dasharray` covered only about half the line and the
        // animation ended with a gap between the line and its end dot.
        <path className="l" d={d} stroke={color} vectorEffect="non-scaling-stroke" clipPath={`url(#${uid}c)`} />
      )}
      {pts.filter((p) => spikes.has(p.year)).map((p) => (
        <circle key={`o${p.year}`} cx={X(pts.indexOf(p))} cy={Y(p.value)} r="2.2" className="spark-spike spark-pop is-late" vectorEffect="non-scaling-stroke" />
      ))}
      {variant !== "bars" && <circle className="spark-pop is-late" cx={X(pts.length - 1)} cy={Y(last.value)} r="2.6" fill={color} />}
    </svg>
  );
}

/** A share on a dial. Only for values that really run 0–100 %, with the
 *  comparison territory as a notch on the same arc — the number and how it
 *  stands relative to the kraj in one shape instead of a line plus a caption. */
export function Gauge({ value, reference, color = "var(--accent)", size = 74, label }: {
  value: number; reference?: number | null; color?: string; size?: number; label?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const r = 26, c = Math.PI * r; // half circle
  const arc = `M4,30 A${r},${r} 0 0 1 ${4 + r * 2},30`;
  const at = (p: number) => {
    const a = Math.PI * (1 - Math.max(0, Math.min(100, p)) / 100);
    return [4 + r + r * Math.cos(a), 30 - r * Math.sin(a)];
  };
  const [rx, ry] = reference !== null && reference !== undefined ? at(reference) : [0, 0];
  return (
    // The dial fills from empty on mount. A CSS transition cannot do that —
    // the first render already carries the final offset, so there is nothing
    // to transition from; the keyframes take the start and end from these two
    // custom properties instead.
    <svg className="gauge" viewBox="0 0 60 36" style={{ width: size, ["--len" as string]: c, ["--to" as string]: c * (1 - pct / 100) }}
      role="img" aria-label={label ?? `${pct} %`}>
      <path d={arc} className="gauge-track" />
      <path d={arc} stroke={color} className="gauge-fill" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      {reference !== null && reference !== undefined && Number.isFinite(reference) && (
        <circle cx={rx} cy={ry} r="2.4" className="gauge-ref spark-pop is-late" />
      )}
    </svg>
  );
}

/** A count drawn as the things it counts. Data KHK facility layers are a
 *  snapshot of one year, so there is no line to draw — but "four libraries"
 *  is worth seeing as four marks rather than as another lonely numeral.
 *  Above `cap` the dots would stop being countable, so the number speaks. */
export function Dots({ value, cap = 24, color = "var(--accent)", label }: { value: number; cap?: number; color?: string; label?: string }) {
  const n = Math.max(0, Math.round(value));
  if (n === 0) return <span className="dots is-none" role="img" aria-label={label ?? "žádné"}>žádné</span>;
  if (n > cap) return <span className="dots is-many" role="img" aria-label={label ?? `${n}`} style={{ color }}>{"●".repeat(6)}<em>+{n - 6}</em></span>;
  return (
    <span className="dots" role="img" aria-label={label ?? `${n}`}>
      {Array.from({ length: n }, (_, i) => <i key={i} style={{ background: color, ["--i" as string]: i }} />)}
    </span>
  );
}

/** Value against its reference on one track. For counts and rates that have a
 *  kraj value to beat but no meaningful 0–100 range. */
export function Bullet({ value, reference, verdict }: { value: number; reference: number; verdict?: string }) {
  const m = Math.max(value, reference) * 1.18 || 1;
  return (
    <div className={`bullet ${verdict ?? ""}`} role="img" aria-label={`${value} proti ${reference}`}>
      <span className="bullet-track"><span className="bullet-fill" style={{ width: `${Math.min(100, (value / m) * 100)}%` }} /></span>
      <span className="bullet-ref" style={{ left: `${Math.min(100, (reference / m) * 100)}%` }} />
    </div>
  );
}

/** `limit` ukáže jen prvních N položek a zbytek schová za tlačítko: seznam
 *  padesáti druhů zařízení byl vysoký skoro dvě obrazovky a rozhodil délku
 *  celého sloupce, přestože po dvanácté položce jde o jednotky kusů. */
export function BarList({ items, format, max, color, limit }: { items: { label: ReactNode; value: number; key: string; hint?: ReactNode }[]; format?: (v: number) => string; max?: number; color?: string; limit?: number }) {
  const [vse, setVse] = useState(false);
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  const f = format ?? ((v: number) => num(v));
  const zbyva = limit && !vse ? Math.max(0, items.length - limit) : 0;
  const vidim = zbyva ? items.slice(0, limit) : items;
  return (
    <div className="bar-list">
      {vidim.map((it, idx) => (
        <div className="bar-item" key={it.key}>
          <span className="bar-label">{it.label}</span>
          <span className="bar-value">{f(it.value)}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(it.value / m) * 100}%`, background: color, ["--i" as string]: idx }} /></span>
          {it.hint && <span className="xsmall mute" style={{ gridColumn: "1 / -1" }}>{it.hint}</span>}
        </div>
      ))}
      {zbyva > 0 && <button className="btn btn-quiet btn-sm bar-vic" onClick={() => setVse(true)}>Zobrazit všech {items.length} <span className="mute">(+{zbyva})</span></button>}
      {limit && vse && items.length > limit && <button className="btn btn-quiet btn-sm bar-vic" onClick={() => setVse(false)}>Zobrazit jen prvních {limit}</button>}
    </div>
  );
}

/** Kam posadit bublinu, aby zůstala v grafu.
 *
 *  Kreslila se natvrdo nad bodem a na střed. U vysoké hodnoty tím vyjela nad
 *  horní hranu grafu — překryla popisky osy i nadpis karty a čísla, kvůli
 *  kterým si člověk najel, zmizela pod ní. Rozhoduje se proto podle místa:
 *  nahoře málo místa → bublina jde pod bod; blízko kraje → přisadí se k němu
 *  místo centrování. Bez měření velikosti bubliny, aby to nestálo překreslení
 *  navíc; prahy vycházejí z její největší rozumné velikosti (tři řádky). */
const TIP_VYSKA = 92;
const TIP_POLOVINA = 90;

function umistiTip(x: number, y: number, sirka: number): { styl: React.CSSProperties; strana: string } {
  const pod = y < TIP_VYSKA;
  const strana = x < TIP_POLOVINA ? "vlevo" : x > sirka - TIP_POLOVINA ? "vpravo" : "stred";
  const posunX = strana === "vlevo" ? "0" : strana === "vpravo" ? "-100%" : "-50%";
  const posunY = pod ? "12px" : "calc(-100% - 12px)";
  return {
    styl: { left: `${(x / Math.max(1, sirka)) * 100}%`, top: y, transform: `translate(${posunX}, ${posunY})` },
    strana,
  };
}

/** Vertical bars by year (e.g. observations per year). */
export function Columns({ items, height = 140, format, ariaLabel }: { items: { label: string; value: number }[]; height?: number; format?: (v: number) => string; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const m = Math.max(1, ...items.map((i) => i.value));
  const gap = 3, bw = Math.max(2, (width - gap * (items.length - 1)) / Math.max(1, items.length));
  const f = format ?? ((v: number) => num(v));
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height + 18}`} role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`sl-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--m, var(--accent))" />
            <stop offset="100%" stopColor="var(--m, var(--accent))" stopOpacity={0.45} />
          </linearGradient>
        </defs>
        {items.map((it, i) => {
          const h = (it.value / m) * height;
          return (
            <g key={it.label} onPointerEnter={() => setHover(i)}>
              <rect x={i * (bw + gap)} y={height - h} width={bw} height={Math.max(1, h)} rx={Math.min(4, bw / 3)} fill={hover === i ? "var(--m, var(--accent-strong))" : `url(#sl-${gid})`} opacity={hover === null || hover === i ? 1 : 0.5}
                style={{ transformOrigin: `0 ${height}px`, animation: `col-grow 600ms var(--ease-out) ${i * 18}ms both` }} />
              {(i % Math.ceil(items.length / 8) === 0 || i === items.length - 1) && <text className="axis-label" x={i * (bw + gap) + bw / 2} y={height + 14} textAnchor="middle">{it.label}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip glass" style={umistiTip(hover * (bw + gap) + bw / 2, height - (items[hover].value / m) * height, width).styl}>
          <div className="tip-year">{items[hover].label}</div>
          <strong className="num">{f(items[hover].value)}</strong>
        </div>
      )}
      <style>{"@keyframes col-grow{from{transform:scaleY(0)}}"}</style>
    </div>
  );
}

/** Stacked horizontal bar for shares (e.g. age structure). */
export function ShareBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div style={{ display: "flex", height: 14, overflow: "hidden", gap: 2 }}>
        {parts.map((p, i) => (
          <span key={p.label} className="share-part" title={`${p.label}: ${num((100 * p.value) / total, 1)} %`}
            style={{ width: `${(100 * p.value) / total}%`, background: p.color, ["--i" as string]: i }} />
        ))}
      </div>
      <div className="legend">
        {parts.map((p) => <span key={p.label}><i style={{ background: p.color, height: 8, width: 8 }} />{p.label} <strong className="num">{num((100 * p.value) / total, 1)} %</strong></span>)}
      </div>
    </div>
  );
}

/* ===========================================================================
 * Composition, comparison, distribution, change.
 *
 * A line answers one question — where is this going over time. Everything
 * below answers a different one, which is the point of letting the reader
 * switch: what is this made of (donut), how does it compare across several
 * measures at once (radar), where is it concentrated (heatmap), and what added
 * up to the difference (waterfall).
 * ======================================================================== */

export interface Part { label: string; value: number; color?: string }

/** Series colours, separated by hue rather than by lightness so the slices
 *  stay apart for a reader with a colour-vision difference and in print. */
export const SERIES_COLORS = [
  "var(--accent)", "var(--info)", "var(--warn)", "#9b8cf0", "var(--ok)",
  "var(--bad)", "#4bb8a9", "#d98ab5", "#b0a26a", "var(--text-mute)",
];

/** Composition as a ring. A ring rather than a full pie: the hole is where the
 *  total goes — the number people look for first — and comparing arc lengths
 *  is easier than comparing wedge areas. */
export function Donut({ parts, size = 176, caption, ariaLabel }: {
  parts: Part[]; size?: number; caption?: string; ariaLabel: string;
}) {
  const items = parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  const total = items.reduce((a, p) => a + p.value, 0);
  if (!total) return <div className="chart muted small">Bez dat</div>;
  const r = 52, circ = 2 * Math.PI * r;
  let at = 0;
  const arcs = items.map((p, i) => {
    const frac = p.value / total;
    const seg = { p, i, dash: frac * circ, offset: -at * circ, frac };
    at += frac;
    return seg;
  });
  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 140 140" style={{ width: size }} role="img" aria-label={ariaLabel}>
        <g transform="translate(70,70) rotate(-90)">
          {arcs.map(({ p, i, dash, offset }) => (
            <circle key={p.label} r={r} fill="none" strokeWidth="19" className="donut-seg"
              stroke={p.color ?? SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeDasharray={`${dash.toFixed(2)} ${(circ - dash).toFixed(2)}`} strokeDashoffset={offset.toFixed(2)}
              style={{ ["--i" as string]: i }} />
          ))}
        </g>
        <text className="donut-total" x="70" y="69" textAnchor="middle">{num(total)}</text>
        <text className="donut-cap" x="70" y="85" textAnchor="middle">{caption ?? "celkem"}</text>
      </svg>
      <div className="donut-legend">
        {arcs.map(({ p, i, frac }) => (
          <span key={p.label}>
            <i style={{ background: p.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }} />
            <span className="dl-label">{p.label}</span>
            <strong className="num">{num(p.value)}</strong>
            <em>{num(frac * 100, 1)} %</em>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Several measures at once, each scaled to its own maximum so axes in
 *  different units can share one shape. The second polygon is the reference —
 *  the gap between them is the message, not either outline on its own. */
export function RadarChart({ axes, series, ariaLabel, size = 280 }: {
  axes: { key: string; label: string; max?: number }[];
  series: { key: string; label: string; color: string; values: Record<string, number | null> }[];
  ariaLabel: string; size?: number;
}) {
  if (axes.length < 3) return <div className="chart muted small">Radar potřebuje aspoň tři osy</div>;
  const R = 74, cx = 125, cy = 104;
  const maxOf = (a: { key: string; max?: number }) =>
    a.max ?? Math.max(...series.map((s) => Math.abs(s.values[a.key] ?? 0)), 1);
  const at = (i: number, frac: number) => {
    const ang = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return [cx + Math.cos(ang) * R * frac, cy + Math.sin(ang) * R * frac];
  };
  return (
    <svg className="radar" viewBox="0 0 250 208" style={{ width: size }} role="img" aria-label={ariaLabel}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} className="radar-web" points={axes.map((_, i) => at(i, f).map((n) => n.toFixed(1)).join(",")).join(" ")} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = at(i, 1);
        return <line key={i} className="radar-spoke" x1={cx} y1={cy} x2={x} y2={y} />;
      })}
      {series.map((s, si) => (
        <polygon key={s.key} className="radar-area" fill={s.color} stroke={s.color} style={{ ["--i" as string]: si }}
          points={axes.map((a, i) => at(i, Math.min(1, Math.abs(s.values[a.key] ?? 0) / maxOf(a))).map((n) => n.toFixed(1)).join(",")).join(" ")} />
      ))}
      {axes.map((a, i) => {
        const [x, y] = at(i, 1.2);
        return (
          <text key={a.key} className="radar-axis" x={x} y={y + 3}
            textAnchor={x > cx + 4 ? "start" : x < cx - 4 ? "end" : "middle"}>{a.label}</text>
        );
      })}
    </svg>
  );
}

/** Where the value sits across two dimensions. One colour ramp from the series
 *  colour, never a rainbow — a hue ramp invents categories the numbers do not
 *  have. Scrolls sideways rather than shrinking its cells to nothing. */
export function Heatmap({ rows, cols, value, format, ariaLabel, color = "var(--accent)" }: {
  rows: { key: string; label: string }[]; cols: { key: string; label: string }[];
  value: (row: string, col: string) => number | null;
  format?: (v: number) => string; ariaLabel: string; color?: string;
}) {
  const all = rows.flatMap((r) => cols.map((c) => value(r.key, c.key))).filter((v): v is number => v !== null);
  if (!all.length) return <div className="chart muted small">Bez dat</div>;
  const lo = Math.min(...all), hi = Math.max(...all);
  const f = format ?? ((v: number) => num(v));
  return (
    <div className="heat-scroll">
      <div className="heat" role="img" aria-label={ariaLabel} style={{ ["--cols" as string]: cols.length }}>
        <span className="heat-corner" />
        {cols.map((c) => <span key={c.key} className="heat-col">{c.label}</span>)}
        {rows.map((r) => (
          <Fragment key={r.key}>
            <span className="heat-row">{r.label}</span>
            {cols.map((c, ci) => {
              const v = value(r.key, c.key);
              const t = v === null ? 0 : hi === lo ? 1 : (v - lo) / (hi - lo);
              return (
                <span key={c.key} className={`heat-cell${v === null ? " is-empty" : ""}`}
                  title={`${r.label} · ${c.label}: ${v === null ? "—" : f(v)}`}
                  style={{ ["--i" as string]: ci, background: v === null ? undefined : `color-mix(in oklab, ${color} ${Math.round(10 + 78 * t)}%, transparent)` }}>
                  <b>{v === null ? "" : f(v)}</b>
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** What added up to the difference. Each step starts where the last finished,
 *  so the bars are the contributions and the flat ones are totals — the only
 *  chart that shows a net change and its parts in the same picture. */
export function Waterfall({ steps, height = 250, format, ariaLabel }: {
  steps: { label: string; value: number; total?: boolean }[]; height?: number; format?: (v: number) => string; ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const f = format ?? ((v: number) => num(v));
  const pad = { l: 6, r: 6, t: 22, b: 36 };
  let run = 0;
  const bars = steps.map((s) => {
    const from = s.total ? 0 : run;
    const to = s.total ? s.value : run + s.value;
    run = to;
    return { ...s, from, to };
  });
  const vals = bars.flatMap((b) => [b.from, b.to]);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (height - pad.t - pad.b);
  const slot = (width - pad.l - pad.r) / Math.max(1, bars.length);
  const bw = Math.max(12, Math.min(56, slot - 14));
  const X = (i: number) => pad.l + (i + 0.5) * slot;
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={Y(0)} y2={Y(0)} />
        {bars.map((b, i) => {
          const top = Math.min(Y(b.from), Y(b.to)), h = Math.max(2, Math.abs(Y(b.to) - Y(b.from)));
          const cls = b.total ? "is-total" : b.value >= 0 ? "is-up" : "is-down";
          return (
            <g key={b.label} className={`wf-step ${cls}`} style={{ ["--i" as string]: i }}>
              {i > 0 && !b.total && <line className="wf-link" x1={X(i - 1)} x2={X(i)} y1={Y(b.from)} y2={Y(b.from)} />}
              <rect className="wf-bar" x={X(i) - bw / 2} y={top} width={bw} height={h} rx="3" />
              <text className="wf-value" x={X(i)} y={top - 6} textAnchor="middle">{b.total ? f(b.to) : `${b.value > 0 ? "+" : "−"}${f(Math.abs(b.value))}`}</text>
              <text className="wf-label" x={X(i)} y={height - 12} textAnchor="middle">{b.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** One chart, several ways to read it.
 *
 *  The arrows step through the views; the label between them opens the whole
 *  list, because stepping blind through six shapes to find the one you want is
 *  worse than picking it. The choice is remembered per `id`, so a reader who
 *  prefers the table gets the table next time.
 *
 *  The body scrolls sideways rather than squeezing: a heatmap of twenty years
 *  is unreadable at 320 px, and shrinking it to fit is what makes charts on a
 *  phone useless.
 */
export function ChartSwitch({ id, views, actions, note }: {
  id: string;
  views: { key: string; label: string; icon?: string; render: () => ReactNode }[];
  actions?: ReactNode; note?: ReactNode;
}) {
  const store = `kam.chart.${id}`;
  const [key, setKey] = useState(() => {
    try {
      const saved = localStorage.getItem(store);
      if (saved && views.some((v) => v.key === saved)) return saved;
    } catch { /* private mode */ }
    return views[0]?.key ?? "";
  });
  const [open, setOpen] = useState(false);
  const i = Math.max(0, views.findIndex((v) => v.key === key));
  const view = views[i] ?? views[0];
  const go = (d: number) => {
    const next = views[(i + d + views.length) % views.length];
    if (!next) return;
    setKey(next.key);
    setOpen(false);
    try { localStorage.setItem(store, next.key); } catch { /* private mode */ }
  };
  if (!view) return null;
  return (
    <div className="cs">
      <div className="cs-bar">
        <div className="cs-pick">
          <button className="icon-btn sm" onClick={() => go(-1)} aria-label="Předchozí typ grafu" disabled={views.length < 2}>
            <Icon name="chevron-left" size={17} />
          </button>
          <button className="cs-name" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox"
            disabled={views.length < 2} title="Vybrat typ grafu">
            {view.icon && <Icon name={view.icon} size={15} />}
            <span>{view.label}</span>
            {views.length > 1 && <Icon name="chevron-down" size={14} />}
          </button>
          <button className="icon-btn sm" onClick={() => go(1)} aria-label="Další typ grafu" disabled={views.length < 2}>
            <Icon name="chevron-right" size={17} />
          </button>
          {open && (
            <div className="cs-menu glass" role="listbox">
              {views.map((v) => (
                <button key={v.key} role="option" aria-selected={v.key === view.key} className={v.key === view.key ? "is-on" : ""}
                  onClick={() => { setKey(v.key); setOpen(false); try { localStorage.setItem(store, v.key); } catch { /* private mode */ } }}>
                  {v.icon && <Icon name={v.icon} size={15} />}<span>{v.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {actions && <div className="cs-actions">{actions}</div>}
      </div>
      <div className="cs-body" key={view.key}>{view.render()}</div>
      {note && <p className="cs-note">{note}</p>}
    </div>
  );
}
