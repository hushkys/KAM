// Otevření mapy: tři měřítka, jedna mapa — a pokaždé skutečné hranice.
//
// Dřív tu stály tři řady čárek. Byl to správný údaj (kolik krajů, ORP a obcí)
// nakreslený tak, že z něj nešlo poznat, že jde o mapu. Teď se kreslí totéž,
// čím je stránka plná: obrysy z ČÚZK, ve třech přiblíženích za sebou, a mezi
// nimi kužel, který ukazuje, do čeho se to zvětšuje. Nic navíc se nestahuje —
// `/geo/cz` a `/geo/khk` si stránka tahá stejně a odpověď je ve sdílené cache.
//
// Hook je úmyslně nízký (`is-slim`). Na téhle stránce je hlavní mapa; cokoli
// vysokého by ji odsunulo pod okraj obrazovky.

import { useId, useMemo } from "react";
import { useApi } from "../lib/api";
import { num } from "../lib/format";
import { NadpisHooku } from "./hook-nadpis";
import { hookVstup } from "./hook-tema";
import type { GeoCz, GeoKhk } from "./maps";

const W = 640, H = 136;
const KHK = 86;
/** Panely a mezery mezi nimi. Mezera je místo pro kužel přiblížení. */
const PANEL = { w: 176, h: 104, y: 5 };
const X = [6, 230, 454];

interface Ram { x0: number; y0: number; x1: number; y1: number }

/** Obálka cesty. Cesty z `geo.py` mají jen `M x,y L x,y … Z` v absolutních
 *  souřadnicích, takže stačí posbírat dvojice čísel — žádný `getBBox()`,
 *  který by musel čekat na DOM. */
function obalka(d: string): Ram | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const re = /(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const x = +m[1], y = +m[2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

function spoj(a: Ram, b: Ram): Ram {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/** Měřítko a posun, které obálku vepíšou doprostřed panelu. */
function vepsat(bb: Ram, px: number) {
  const w = Math.max(1, bb.x1 - bb.x0), h = Math.max(1, bb.y1 - bb.y0);
  const s = Math.min((PANEL.w - 10) / w, (PANEL.h - 10) / h);
  return {
    s,
    tx: px + (PANEL.w - w * s) / 2 - bb.x0 * s,
    ty: PANEL.y + (PANEL.h - h * s) / 2 - bb.y0 * s,
    /** Kam se obálka na plátně promítne — z toho vychází kužel. */
    na: (r: Ram): Ram => ({
      x0: px + (PANEL.w - w * s) / 2 + (r.x0 - bb.x0) * s,
      y0: PANEL.y + (PANEL.h - h * s) / 2 + (r.y0 - bb.y0) * s,
      x1: px + (PANEL.w - w * s) / 2 + (r.x1 - bb.x0) * s,
      y1: PANEL.y + (PANEL.h - h * s) / 2 + (r.y1 - bb.y0) * s,
    }),
  };
}

export function MapaHook({ orp, obce, krajCode = KHK, children }: {
  kraje?: { code: number }[]; orp: number; obce: number; krajCode?: number; children?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const cz = useApi<GeoCz>("/geo/cz");
  const khk = useApi<GeoKhk>("/geo/khk");

  const art = useMemo(() => {
    const c = cz.data, k = khk.data;
    if (!c?.kraje?.length || !k?.orp?.length || !k?.obce?.length) return null;

    // Panel 1: Česko, domovský kraj zvýrazněný.
    const cely = c.kraje.map((r) => obalka(r.d)).filter(Boolean).reduce((a, b) => spoj(a!, b!)) as Ram;
    const domaci = c.kraje.find((r) => r.code === krajCode);
    const domaciRam = domaci ? obalka(domaci.d) : null;
    const p1 = vepsat(cely, X[0]);

    // Panel 2: kraj po ORP. Vybírá se to ORP, které má nejvíc obcí — v posledním
    // panelu je z něj pak co kreslit, a název je v popisku, takže se nic netají.
    const podleOrp = new Map<number, typeof k.obce>();
    for (const o of k.obce) (podleOrp.get(o.orp) ?? podleOrp.set(o.orp, []).get(o.orp)!).push(o);
    const vybraneOrp = k.orp.reduce((a, b) => ((podleOrp.get(b.code)?.length ?? 0) > (podleOrp.get(a.code)?.length ?? 0) ? b : a));
    const krajRam = k.orp.map((o) => obalka(o.d)).filter(Boolean).reduce((a, b) => spoj(a!, b!)) as Ram;
    const p2 = vepsat(krajRam, X[1]);
    const orpRam = obalka(vybraneOrp.d);

    // Panel 3: jedno ORP po obcích.
    const deti = podleOrp.get(vybraneOrp.code) ?? [];
    const p3 = vepsat(orpRam ?? krajRam, X[2]);

    return {
      kraje: c.kraje, domaci: domaci?.code ?? null, p1, p2, p3,
      orpTvary: k.orp, vybraneOrp, deti,
      kuzel1: domaciRam ? { z: p1.na(domaciRam), do: p2.na(krajRam) } : null,
      kuzel2: orpRam ? { z: p2.na(orpRam), do: p3.na(orpRam) } : null,
      pocty: [
        { popis: `${c.kraje.length} krajů`, x: X[0] },
        { popis: `${orp} ORP`, x: X[1] },
        { popis: `${deti.length} obcí v ORP ${vybraneOrp.name}`, x: X[2] },
      ],
    };
  }, [cz.data, khk.data, krajCode, orp]);

  return (
    <section className="sc-hook mp-hook is-slim" {...hookVstup("mapa")} aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /></div>

      <div className="sc-hook-copy">
        <NadpisHooku id={`${uid}-t`}>Tři měřítka,<br />jedna mapa</NadpisHooku>
        <p className="lead">
          Česko po krajích, kraj po ORP, ORP po obcích — {num(obce)} hranic z registru ČÚZK.
          Klepnutí na území vás pustí o patro níž a v pohledu na kraj mapu přepnete do skutečného terénu.
        </p>
        {children}
      </div>

      <div className="sc-stage" aria-hidden={art ? undefined : "true"}>
        <div className="sc-pane p1">
          <span className="sc-sheen" />
          <svg className="sc-art mp-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
            role="img" aria-label={art ? `Česko po krajích, Královéhradecký kraj po ORP a ORP ${art.vybraneOrp.name} po obcích` : "Načítám hranice"}>
            {art && (
              <>
                {/* Kužel přiblížení: z jednoho tvaru vlevo je celý panel vpravo. */}
                {[art.kuzel1, art.kuzel2].map((z, i) => z && (
                  <g className="mp-kuzel" key={i} style={{ ["--i" as string]: i }}>
                    <path d={`M${z.z.x1},${z.z.y0}L${z.do.x0},${z.do.y0}L${z.do.x0},${z.do.y1}L${z.z.x1},${z.z.y1}Z`} className="mp-kuzel-plocha" />
                    <path d={`M${z.z.x1},${z.z.y0}L${z.do.x0},${z.do.y0}`} className="mp-kuzel-cara" />
                    <path d={`M${z.z.x1},${z.z.y1}L${z.do.x0},${z.do.y1}`} className="mp-kuzel-cara" />
                    <rect className="mp-ramecek" x={z.z.x0} y={z.z.y0} width={Math.max(3, z.z.x1 - z.z.x0)} height={Math.max(3, z.z.y1 - z.z.y0)} rx="2" />
                  </g>
                ))}

                {/* Vnější skupina nese animaci, vnitřní atribut `transform`.
                    CSS transform by atribut přebil a panely by se slily na sebe. */}
                <g className="mp-panel" style={{ ["--i" as string]: 0 }}>
                  <g transform={`translate(${art.p1.tx} ${art.p1.ty}) scale(${art.p1.s})`}>
                    {art.kraje.map((r) => (
                      <path key={r.code} d={r.d} className={r.code === art.domaci ? "mp-tvar je-zde" : "mp-tvar"} />
                    ))}
                  </g>
                </g>
                <g className="mp-panel" style={{ ["--i" as string]: 1 }}>
                  <g transform={`translate(${art.p2.tx} ${art.p2.ty}) scale(${art.p2.s})`}>
                    {art.orpTvary.map((o) => (
                      <path key={o.code} d={o.d} className={o.code === art.vybraneOrp.code ? "mp-tvar je-zde" : "mp-tvar"} />
                    ))}
                  </g>
                </g>
                <g className="mp-panel" style={{ ["--i" as string]: 2 }}>
                  <g transform={`translate(${art.p3.tx} ${art.p3.ty}) scale(${art.p3.s})`}>
                    {art.deti.map((o) => <path key={o.code} d={o.d} className="mp-tvar je-obec" />)}
                    <path d={art.vybraneOrp.d} className="mp-obrys" />
                  </g>
                </g>

                {art.pocty.map((p) => (
                  <text key={p.popis} className="mp-pocet" x={p.x + PANEL.w / 2} y={H - 4} textAnchor="middle">{p.popis}</text>
                ))}
              </>
            )}
          </svg>
        </div>
      </div>
    </section>
  );
}
