// Our own vector maps: Czechia by kraj, and the home kraj by ORP or obec.
// Nothing outside the country is drawn. Regions are focusable buttons for
// keyboard users, carry data-ctx for the right-click menu and show a
// tooltip on hover or focus.

import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { useApi } from "../lib/api";
import { num } from "../lib/format";
import { Icon } from "./Icon";
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

/* ------------------------------------------------------------ přiblížení
 * Obec je na telefonu široká pár pixelů a prst má čtyřicet. Bez přiblížení
 * se do půlky kraje nedá klepnout — a to není vlastnost kartogramu, to je
 * chyba, kterou stačí opravit.
 *
 * Hýbe se `viewBox`, ne `transform`: tahy zůstávají ostré a obrysy si díky
 * `vector-effect: non-scaling-stroke` drží svou tloušťku v pixelech, takže
 * se při přiblížení nerozlijí.
 *
 * Gesta jsou rozdělená tak, aby se nepraly se stránkou. V základním pohledu
 * jeden prst roluje stránku (`touch-action: pan-y`) a dva prsty přibližují.
 * Jakmile je mapa přiblížená, jeden prst ji posouvá — v tu chvíli už člověk
 * mapu ovládá vědomě a čekal by to.
 */
const ZOOM_MAX = 8;
/** Pod osm pixelů je to klepnutí, ne tah — jinak by se posunem rušil výběr. */
const PRAH_TAHU = 8;

interface Pohled { x: number; y: number; w: number; h: number }

function naCisla(viewBox: string): Pohled {
  const [x, y, w, h] = viewBox.split(/[\s,]+/).map(Number);
  return { x, y, w, h };
}

function useZoom(viewBox: string | undefined) {
  const zaklad = useMemo(() => (viewBox ? naCisla(viewBox) : null), [viewBox]);
  const [pohled, setPohled] = useState<Pohled | null>(null);
  const plocha = useRef<HTMLDivElement>(null);
  const prsty = useRef(new Map<number, { x: number; y: number }>());
  const tahl = useRef(false);

  const akt = pohled ?? zaklad;
  const zoom = akt && zaklad ? zaklad.w / akt.w : 1;

  const drz = useCallback((p: Pohled): Pohled => {
    if (!zaklad) return p;
    const w = Math.min(zaklad.w, Math.max(zaklad.w / ZOOM_MAX, p.w));
    const h = w * (zaklad.h / zaklad.w);
    return {
      w, h,
      x: Math.min(Math.max(p.x, zaklad.x), zaklad.x + zaklad.w - w),
      y: Math.min(Math.max(p.y, zaklad.y), zaklad.y + zaklad.h - h),
    };
  }, [zaklad]);

  /** Každá úprava vychází z předchozího stavu, ne z toho, co bylo při
   *  vykreslení. Dvě klepnutí na „přiblížit" v jednom snímku by jinak obě
   *  počítala ze stejného výchozího pohledu a druhé by nic neudělalo. */
  const uprav = useCallback((f: (p: Pohled) => Pohled) => {
    setPohled((prev) => (zaklad ? drz(f(prev ?? zaklad)) : prev));
  }, [zaklad, drz]);

  /** Přiblíží tak, aby bod pod prstem zůstal na místě. */
  const priblizit = useCallback((faktor: number, klientX?: number, klientY?: number) => {
    const r = plocha.current?.getBoundingClientRect();
    if (!r) return;
    const fx = klientX === undefined ? 0.5 : (klientX - r.left) / r.width;
    const fy = klientY === undefined ? 0.5 : (klientY - r.top) / r.height;
    uprav((p) => {
      const w = p.w / faktor, h = p.h / faktor;
      return { x: p.x + (p.w - w) * fx, y: p.y + (p.h - h) * fy, w, h };
    });
  }, [uprav]);

  const zpet = useCallback(() => setPohled(null), []);

  // Sevření dvěma prsty se počítá ze skutečné vzdálenosti prstů a z posunu
  // jejich středu mezi dvěma událostmi. Dřívější verze brala „předchozí
  // vzdálenost" jako současnou minus délku pohybu jednoho prstu — to je menší
  // číslo, ať se prsty rozjíždějí, nebo sjíždějí, takže mapa se přibližovala
  // i při oddalování, a posouvala se o celý pohyb jednoho prstu, proto skákala.
  const sevreni = useRef<{ d: number; mx: number; my: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const zmer = () => {
    const [a, b] = [...prsty.current.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  const dolu = (e: React.PointerEvent) => {
    prsty.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (prsty.current.size === 1) { tahl.current = false; start.current = { x: e.clientX, y: e.clientY }; }
    if (prsty.current.size === 2) { sevreni.current = zmer(); tahl.current = true; }
  };

  const pohyb = (e: React.PointerEvent) => {
    const p = prsty.current;
    if (!p.has(e.pointerId) || !zaklad) return;
    const r = plocha.current?.getBoundingClientRect();
    if (!r) return;
    const stary = p.get(e.pointerId)!;
    const dx = e.clientX - stary.x, dy = e.clientY - stary.y;
    p.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (p.size >= 2) {
      const ted = zmer(), pred = sevreni.current ?? ted;
      sevreni.current = ted;
      // Strop na faktor drží gesto v klidu, když jeden prst na okamžik vypadne.
      const faktor = pred.d > 0 ? Math.max(0.5, Math.min(2, ted.d / pred.d)) : 1;
      const fx = (ted.mx - r.left) / r.width, fy = (ted.my - r.top) / r.height;
      const posunX = (ted.mx - pred.mx) / r.width, posunY = (ted.my - pred.my) / r.height;
      uprav((v) => {
        const w = v.w / faktor, h = w * (v.h / v.w);
        return { x: v.x + (v.w - w) * fx - posunX * w, y: v.y + (v.h - h) * fy - posunY * h, w, h };
      });
      return;
    }
    // Tah se měří od místa dotyku, ne po jednotlivých událostech: s prahem
    // na jednu událost spolklo klepnutí i obyčejné chvění prstu.
    if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > PRAH_TAHU) tahl.current = true;
    // Jeden prst posouvá jen přiblíženou mapu; jinak patří rolování stránky.
    if (zoom > 1.01 && e.pointerType !== "mouse" && tahl.current) {
      uprav((v) => ({ ...v, x: v.x - (dx / r.width) * v.w, y: v.y - (dy / r.height) * v.h }));
    }
  };

  const nahoru = (e: React.PointerEvent) => {
    prsty.current.delete(e.pointerId);
    if (prsty.current.size < 2) sevreni.current = null;
    if (prsty.current.size === 0) start.current = null;
  };

  const gesta = {
    ref: plocha,
    onPointerDown: dolu,
    onPointerMove: pohyb,
    onPointerUp: nahoru,
    onPointerCancel: nahoru,
    // Tah nesmí skončit výběrem obce, nad kterou prst dojel.
    onClickCapture: (e: React.MouseEvent) => { if (tahl.current) { e.stopPropagation(); tahl.current = false; } },
  };
  return { akt, zoom, gesta, priblizit, zpet, pripraveno: !!zaklad };
}

function Zoom({ zoom, priblizit, zpet }: { zoom: number; priblizit: (f: number) => void; zpet: () => void }) {
  return (
    <div className="map-zoom" role="group" aria-label="Přiblížení mapy">
      <button type="button" className="icon-btn sm" onClick={() => priblizit(1.6)} disabled={zoom >= ZOOM_MAX - 0.01} aria-label="Přiblížit" title="Přiblížit"><Icon name="plus" size={16} /></button>
      <button type="button" className="icon-btn sm" onClick={() => priblizit(1 / 1.6)} disabled={zoom <= 1.01} aria-label="Oddálit" title="Oddálit"><Icon name="minus" size={16} /></button>
      <button type="button" className="icon-btn sm" onClick={zpet} disabled={zoom <= 1.01} aria-label="Zobrazit celý kraj" title="Zobrazit celý kraj"><Icon name="refresh" size={15} /></button>
      {zoom > 1.01 && <span className="map-zoom-hod" aria-live="polite">{zoom.toFixed(1)}×</span>}
    </div>
  );
}

export function CzMap({ values, breaks, polarity = 1, selected, onSelect, format, label, highlight = 86 }: {
  values: Record<number, number | null>; breaks: number[]; polarity?: number; selected?: number | null; onSelect: (code: number) => void; format: (v: number | null) => string; label: string; highlight?: number;
}) {
  const { data } = useApi<GeoCz>("/geo/cz");
  const prefs = usePrefs();
  const colors = ramp(polarity, resolvedTheme(prefs));
  const { tip, setTip, wrap, place, placeEl } = useTip();
  if (!data) return <div className="map-wrap"><div className="skeleton" style={{ width: "100%", aspectRatio: "1000 / 583" }} /></div>;
  // Nad mapou znamená tah do strany mapu, ne stránku: přiblížený kartogram se
  // jím posouvá, a přepnutí stránky by nad ním bylo překvapení i v základním
  // pohledu. Přejíždění mezi stránkami se mu proto vyhne (Gesta.tsx).
  return (
    <div className="map-wrap" ref={wrap} data-gesto="ne">
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
  const { akt, zoom, gesta, priblizit, zpet } = useZoom(data?.viewBox);
  if (!data || !akt) return <div className="map-wrap"><div className="skeleton" style={{ width: "100%", aspectRatio: "1000 / 760" }} /></div>;
  const shapes = level === "orp" ? data.orp : data.obce;
  // Nad mapou znamená tah do strany mapu, ne stránku: přiblížený kartogram se
  // jím posouvá, a přepnutí stránky by nad ním bylo překvapení i v základním
  // pohledu. Přejíždění mezi stránkami se mu proto vyhne (Gesta.tsx).
  return (
    <div className="map-wrap" ref={wrap} data-gesto="ne">
      <div className="map-plocha" {...gesta}>
      <svg className="map-svg map-appear" viewBox={`${akt.x} ${akt.y} ${akt.w} ${akt.h}`} role="group" aria-label={label}
        style={{ touchAction: zoom > 1.01 ? "none" : "pan-y" }}>
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
              onPointerMove={(e) => e.pointerType !== "touch" && place(e, s.name, lines)} onPointerLeave={() => setTip(null)}
              onFocus={(e) => placeEl(e.currentTarget, s.name, lines)} onBlur={() => setTip(null)} />
          );
        })}
        {level === "obec" && showOrpLines && data.orp.map((o) => <path key={`l${o.code}`} className="orp-line" d={o.d} />)}
        <path className="outline" d={data.outline} />
        {/* Popisky jsou v uživatelských jednotkách, takže by se přiblížením
            nafoukly. Velikost se proto dělí přiblížením zpátky. */}
        {level === "orp" && data.orp.map((o) => <text key={`t${o.code}`} className="map-label sub" x={o.cx} y={o.cy} style={{ fontSize: `${10 / zoom}px`, strokeWidth: 3 / zoom }}>{o.name}</text>)}
      </svg>
      </div>
      <Zoom zoom={zoom} priblizit={priblizit} zpet={zpet} />
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
      <span className="mute">· šedá: data chybí</span>
    </div>
  );
}
