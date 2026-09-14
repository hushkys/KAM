// Our own vector maps: Czechia by kraj, and the home kraj by ORP or obec.
// Nothing outside the country is drawn. Regions are focusable buttons for
// keyboard users, carry data-ctx for the right-click menu and show a
// tooltip on hover or focus.

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useApi } from "../lib/api";
import { num } from "../lib/format";
import { resolvedTheme, usePrefs } from "../lib/prefs";

export interface GeoCz { viewBox: string; outline: string; kraje: { code: number; name: string; d: string; cx: number; cy: number }[] }
export interface GeoKhk { viewBox: string; outline: string; orp: { code: number; name: string; d: string; cx: number; cy: number }[]; obce: { code: number; name: string; orp: number; d: string; cx: number; cy: number }[] }

const GREEN_DARK = ["#1c2a22", "#24452f", "#2f6a3c", "#4a9150", "#79b963", "#b6e08f"];
const GREEN_LIGHT = ["#e4efe0", "#c6e0bb", "#9ccb8c", "#6fae5d", "#43873a", "#255e22"];
const WARM_DARK = ["#2a241c", "#4a3a22", "#7a5a2a", "#a8762f", "#d69a44", "#f2c77e"];
const WARM_LIGHT = ["#f5ecdf", "#ebd3b0", "#dfb67e", "#cc8f48", "#a86a25", "#7a4712"];

/** Palette index for a value given quantile breaks. Higher polarity -1 values get the warm ramp. */
export function binOf(v: number, breaks: number[]): number {
  let i = 0;
  while (i < breaks.length && v > breaks[i]) i++;
  return i;
}

export function ramp(polarity: number, theme: "light" | "dark"): string[] {
  const warm = polarity < 0;
  if (theme === "dark") return (warm ? WARM_DARK : GREEN_DARK).slice(1);
  return (warm ? WARM_LIGHT : GREEN_LIGHT).slice(1);
}

interface Tip { x: number; y: number; title: string; lines: string[] }

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const place = (e: { clientX: number; clientY: number }, title: string, lines: string[]) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: Math.min(Math.max(e.clientX - r.left, 90), r.width - 90), y: e.clientY - r.top, title, lines });
  };
  const placeEl = (el: Element, title: string, lines: string[]) => {
    const b = el.getBoundingClientRect();
    place({ clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }, title, lines);
  };
  return { tip, setTip, wrap, place, placeEl };
}

export function CzMap({ values, breaks, polarity = 1, selected, onSelect, format, label, highlight = 86 }: {
  values: Record<number, number | null>; breaks: number[]; polarity?: number; selected?: number | null; onSelect: (code: number) => void; format: (v: number | null) => string; label: string; highlight?: number;
}) {
  const { data } = useApi<GeoCz>("/geo/cz");
  const prefs = usePrefs();
  const colors = ramp(polarity, resolvedTheme(prefs));
  const { tip, setTip, wrap, place, placeEl } = useTip();
  if (!data) return <div className="map-wrap"><div className="skeleton" style={{ width: "100%", aspectRatio: "1000 / 583" }} /></div>;
  return (
    <div className="map-wrap" ref={wrap}>
      <svg className="map-svg map-appear" viewBox={data.viewBox} role="group" aria-label={label}>
        {data.kraje.map((k, i) => {
          const v = values[k.code];
          const fill = v === null || v === undefined ? "var(--surface-3)" : colors[binOf(v, breaks)];
          return (
            <path key={k.code} d={k.d} className={`region ${selected === k.code ? "is-selected" : ""}`} fill={fill} fillRule="evenodd"
              style={{ ["--d" as string]: i * 40 } as CSSProperties} tabIndex={0} role="button" aria-label={`${k.name}: ${format(v ?? null)}`}
              data-ctx={`kraj:${k.code}`} data-ctx-label={k.name}
              onClick={() => onSelect(k.code)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(k.code))}
              onPointerMove={(e) => place(e, k.name, [format(v ?? null)])} onPointerLeave={() => setTip(null)}
              onFocus={(e) => placeEl(e.currentTarget, k.name, [format(v ?? null)])} onBlur={() => setTip(null)} />
          );
        })}
        <path className="outline" d={data.outline} />
        {data.kraje.map((k) => k.code === highlight && <circle key="hl" cx={k.cx} cy={k.cy} r="5" fill="var(--lime)" stroke="var(--bg)" strokeWidth="2" pointerEvents="none" />)}
      </svg>
      {tip && <div className="map-tip glass" style={{ left: tip.x, top: tip.y }}><strong>{tip.title}</strong>{tip.lines.map((l) => <span key={l} className="muted">{l}</span>)}</div>}
    </div>
  );
}

export function KhkMap({ level, values, breaks, polarity = 1, selected, onSelect, format, label, showOrpLines = true }: {
  level: "obec" | "orp"; values: Record<string, number>; breaks: number[]; polarity?: number; selected?: string | null; onSelect: (id: string, name: string) => void; format: (v: number | null) => string; label: string; showOrpLines?: boolean;
}) {
  const { data } = useApi<GeoKhk>("/geo/khk");
  const prefs = usePrefs();
  const colors = ramp(polarity, resolvedTheme(prefs));
  const { tip, setTip, wrap, place, placeEl } = useTip();
  const orpName = useMemo(() => Object.fromEntries((data?.orp ?? []).map((o) => [o.code, o.name])), [data]);
  if (!data) return <div className="map-wrap"><div className="skeleton" style={{ width: "100%", aspectRatio: "1000 / 760" }} /></div>;
  const shapes = level === "orp" ? data.orp : data.obce;
  return (
    <div className="map-wrap" ref={wrap}>
      <svg className="map-svg map-appear" viewBox={data.viewBox} role="group" aria-label={label}>
        {shapes.map((s, i) => {
          const v = values[String(s.code)];
          const fill = v === undefined ? "var(--surface-3)" : colors[binOf(v, breaks)];
          const id = `${level}:${s.code}`;
          const sub = "orp" in s ? `ORP ${orpName[Number(s.orp)] ?? ""}` : "Správní obvod ORP";
          const lines = [format(v ?? null), sub];
          return (
            <path key={s.code} d={s.d} className={`region ${selected === id ? "is-selected" : ""}`} fill={fill} fillRule="evenodd"
              style={{ ["--d" as string]: level === "obec" ? (i % 60) * 8 : i * 30, strokeWidth: level === "obec" ? 0.6 : 1 } as CSSProperties}
              tabIndex={level === "orp" || i < 1000 ? 0 : -1} role="button" aria-label={`${s.name}: ${format(v ?? null)}`}
              data-ctx={id} data-ctx-label={s.name}
              onClick={() => onSelect(id, s.name)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(id, s.name))}
              onPointerMove={(e) => place(e, s.name, lines)} onPointerLeave={() => setTip(null)}
              onFocus={(e) => placeEl(e.currentTarget, s.name, lines)} onBlur={() => setTip(null)} />
          );
        })}
        {level === "obec" && showOrpLines && data.orp.map((o) => <path key={`l${o.code}`} className="orp-line" d={o.d} />)}
        <path className="outline" d={data.outline} />
        {level === "orp" && data.orp.map((o) => <text key={`t${o.code}`} className="map-label sub" x={o.cx} y={o.cy}>{o.name}</text>)}
      </svg>
      {tip && <div className="map-tip glass" style={{ left: tip.x, top: tip.y }}><strong>{tip.title}</strong>{tip.lines.map((l) => <span key={l} className="muted small" style={{ display: "block" }}>{l}</span>)}</div>}
    </div>
  );
}

export function MapLegend({ breaks, polarity = 1, format, unit }: { breaks: number[]; polarity?: number; format?: (v: number) => string; unit?: string }) {
  const prefs = usePrefs();
  const colors = ramp(polarity, resolvedTheme(prefs));
  const f = format ?? ((v: number) => num(v));
  if (!breaks.length) return null;
  return (
    <div className="map-legend">
      <span className="num">≤ {f(breaks[0])}{unit === "%" ? " %" : ""}</span>
      <span className="scale">{colors.map((c) => <span key={c} style={{ background: c }} />)}</span>
      <span className="num">&gt; {f(breaks[breaks.length - 1])}{unit === "%" ? " %" : ""}</span>
      <span className="mute">· šedá = bez dat</span>
    </div>
  );
}
