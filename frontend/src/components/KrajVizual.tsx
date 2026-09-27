// Kraj a jeho budoucnost v jednom obrázku.
//
// Tři vrstvy nad sebou: vystřižený kraj po ORP, nad ním hřeben vývoje obyvatel
// 2005–2040 a nad tím popisky. Pod kurzorem se každá posouvá jinou rychlostí,
// takže mezi nimi je vidět hloubka.
//
// Posun **v rovině**, ne otáčení. Skutečné 3D (perspective + preserve-3d)
// udělá z celé scény jednu texturu, kterou prohlížeč rasterizuje v jednom
// měřítku a pak škáluje — na displeji s vyšší hustotou pixelů z toho byla
// rozmazaná mapa. Různá rychlost vrstev udělá hloubku skoro stejně dobře
// a kresba zůstane ostrá.
//
// Proč tři samostatná SVG a ne jedno: vrstvy se musí hýbat samostatně, a to
// jde jen u HTML prvků. Sdílejí stejný `viewBox`, takže souřadnice sedí.
//
// Posun je ozdoba, a proto celý odpadá pod `data-motion="reduce"` i na
// dotykovém displeji, kde není kurzor, který by ho řídil.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useApi } from "../lib/api";
import { num } from "../lib/format";
import type { GeoKhk } from "./maps";
import type { Forecast } from "../lib/types";

const ROK_OD = 2005;
const ROK_DO = 2040;

export function KrajVizual({ className = "" }: { className?: string }) {
  const geo = useApi<GeoKhk>("/geo/khk");
  const fc = useApi<Forecast>("/forecast/kraj:86");
  const box = useRef<HTMLDivElement>(null);
  const [naklon, setNaklon] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (document.documentElement.dataset.motion === "reduce") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let raf = 0;
    const pohyb = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        // −1…1 od středu; malé úhly schválně, ať se z toho nestane kolotoč.
        setNaklon({ x: ((e.clientX - r.left) / r.width - 0.5) * 2, y: ((e.clientY - r.top) / r.height - 0.5) * 2 });
      });
    };
    const pryc = () => setNaklon({ x: 0, y: 0 });
    el.addEventListener("pointermove", pohyb);
    el.addEventListener("pointerleave", pryc);
    return () => { el.removeEventListener("pointermove", pohyb); el.removeEventListener("pointerleave", pryc); cancelAnimationFrame(raf); };
  }, []);

  const art = useMemo(() => {
    if (!geo.data) return null;
    const [vx, vy, w, h] = geo.data.viewBox.split(/[\s,]+/).map(Number);
    if (!fc.data?.available) return { vx, vy, w, h, krivka: null };

    const body = [
      ...fc.data.history.filter((r) => r.year >= ROK_OD).map((r) => ({ year: r.year, v: r.population, budouci: false })),
      ...fc.data.scenarios.pravdepodobny.map((r) => ({ year: r.year, v: r.population, budouci: true })),
    ];
    if (body.length < 4) return { vx, vy, w, h, krivka: null };

    // Svislé měřítko zůstává poctivé: tříprocentní změna nesmí zaplnit celý
    // panel, takže v obraze je vždycky aspoň ±8 % kolem průměru.
    const prumer = body.reduce((a, p) => a + p.v, 0) / body.length;
    const lo = Math.min(prumer * 0.92, ...body.map((p) => p.v));
    const hi = Math.max(prumer * 1.08, ...body.map((p) => p.v));
    const X = (r: number) => vx + w * 0.07 + ((r - ROK_OD) / (ROK_DO - ROK_OD)) * (w * 0.86);
    const Y = (v: number) => vy + h * 0.9 - ((v - lo) / (hi - lo || 1)) * (h * 0.44);
    const cesta = (arr: typeof body) => arr.map((p, i) => `${i ? "L" : "M"}${X(p.year).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");

    const minule = body.filter((p) => !p.budouci);
    const pristi = [minule[minule.length - 1], ...body.filter((p) => p.budouci)];
    const dno = vy + h * 0.96;
    const znacky = [ROK_OD, 2015, fc.data.base_year, 2030, ROK_DO]
      .map((r) => body.find((p) => p.year === r))
      .filter(Boolean)
      .map((p) => ({ ...(p as { year: number; v: number; budouci: boolean }), x: X((p as { year: number }).year), y: Y((p as { v: number }).v) }));

    return {
      vx, vy, w, h,
      krivka: {
        minule: cesta(minule), pristi: cesta(pristi),
        plocha: `M${X(ROK_OD).toFixed(1)},${dno.toFixed(1)}L${cesta(body).slice(1)}L${X(ROK_DO).toFixed(1)},${dno.toFixed(1)}Z`,
        znacky, dno, dnes: X(fc.data.base_year),
        konec: body[body.length - 1], zacatek: minule[0],
      },
    };
  }, [geo.data, fc.data]);

  const styl = {
    "--px": `${(naklon.x * 14).toFixed(1)}px`,
    "--py": `${(naklon.y * 11).toFixed(1)}px`,
  } as CSSProperties;

  if (!geo.data || !art) {
    return <div className={`kv ${className}`}><div className="kv-scena"><div className="skeleton kv-kostra" /></div></div>;
  }
  const vb = `${art.vx} ${art.vy} ${art.w} ${art.h}`;
  const k = art.krivka;

  return (
    <div className={`kv ${className}`} ref={box} style={styl}>
      <div className="kv-scena">
        {/* 1 — kraj po ORP. Pod každým tvarem leží jeho tmavší dvojník o dva
            body níž, takže mapa vypadá vystřižená z papíru, ne natištěná. */}
        <svg className="kv-vrstva je-mapa" viewBox={vb} role="img"
          aria-label={`Královéhradecký kraj po ORP a vývoj počtu obyvatel ${ROK_OD}–${ROK_DO}`}>
          <defs>
            <linearGradient id="kv-orp" x1="0" y1="0" x2="0.4" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.30" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.07" />
            </linearGradient>
            <linearGradient id="kv-obrys" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--lime)" />
              <stop offset="100%" stopColor="var(--accent)" />
            </linearGradient>
          </defs>
          <g className="kv-stin" aria-hidden="true">
            {geo.data.orp.map((o) => <path key={`s${o.code}`} d={o.d} />)}
          </g>
          <g className="kv-tvary">
            {geo.data.orp.map((o, i) => (
              <path key={o.code} d={o.d} className="kv-orp" style={{ ["--i" as string]: i }}>
                <title>{o.name}</title>
              </path>
            ))}
          </g>
          <path d={geo.data.outline} className="kv-obrys" />
        </svg>

        {/* 2 — hřeben vývoje. Leží nad mapou, ne v ní: mapa říká kde, hřeben kam. */}
        {k && (
          <svg className="kv-vrstva je-graf" viewBox={vb} aria-hidden="true">
            <defs>
              <linearGradient id="kv-plocha" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--lime)" stopOpacity="0.42" />
                <stop offset="100%" stopColor="var(--lime)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="kv-cara" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--accent)" />
                <stop offset="70%" stopColor="var(--lime)" />
                <stop offset="100%" stopColor="var(--lime)" />
              </linearGradient>
            </defs>
            <path className="kv-plocha" d={k.plocha} />
            {k.znacky.map((z) => <line key={`d${z.year}`} className="kv-svisla" x1={z.x} x2={z.x} y1={z.y} y2={k.dno} />)}
            <line className="kv-dnes" x1={k.dnes} x2={k.dnes} y1={art.vy + art.h * 0.2} y2={k.dno} />
            <path className="kv-krivka" d={k.minule} pathLength={1000} />
            <path className="kv-krivka je-budouci" d={k.pristi} pathLength={1000} />
            {k.znacky.map((z, i) => (
              <circle key={z.year} className={`kv-bod ${z.year === ROK_DO ? "je-konec" : ""}`} cx={z.x} cy={z.y}
                r={z.year === ROK_DO ? 9 : 5} style={{ ["--i" as string]: i }} />
            ))}
          </svg>
        )}

        {/* 3 — popisky. Vlastní rovina, aby se při naklonění hýbaly jinak než kresba. */}
        {k && (
          <div className="kv-stitky" aria-hidden="true">
            {k.znacky.map((z) => (
              <span key={z.year} className={`kv-stitek ${z.year === ROK_DO ? "je-konec" : ""}`}
                style={{ left: `${((z.x - art.vx) / art.w) * 100}%`, top: `${((z.y - art.vy) / art.h) * 100}%` }}>
                {z.year}
              </span>
            ))}
          </div>
        )}

      </div>

      <div className="kv-noha">
        <span className="kv-popis">Královéhradecký kraj · obyvatelé {ROK_OD}–{ROK_DO}</span>
        {k && (
          <span className="kv-hodnota">
            <b>{num(Math.round(k.konec.v))}</b>
            <span>v roce {ROK_DO} · pravděpodobný scénář</span>
          </span>
        )}
      </div>
    </div>
  );
}
