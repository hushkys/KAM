// Otevření dotací: letokruhy.
//
// Každý prstenec je jeden rok a jeho tloušťka je částka, která toho roku
// doopravdy dotekla do rozpočtu území. Uprostřed je obec, kolem ní roky —
// hubený rok je tenká linka, silný rok široký pás. Stejně jako u stromu se
// dá historie přečíst z toho, jak jsou kruhy nahusto.
//
// Proč ne sloupce: dotace nejsou vývoj, který někam směřuje. Jsou to nánosy
// — každý rok přibude vrstva a nikdy neubude. Kruhy to řeknou dřív než
// popisek.
//
// Tloušťky jsou úměrné částkám a pak dohromady zmenšené tak, aby se stoh vešel
// do panelu; poměry mezi roky se tím nemění. Prstence jsou skutečné roky
// z rozpočtu (ČSÚ MOS), bez dat panel zůstane prázdný.

import { useId, useMemo } from "react";
import { NadpisHooku } from "./hook-nadpis";
import { hookVstup } from "./hook-tema";
import { Icon } from "./Icon";
import { num } from "../lib/format";

export interface DotRok { year: number; castka: number }

const W = 640, H = 262;
const JADRO = 12;          // poloměr středu = samotné území
const MEZERA = 2.6;        // odstup mezi letokruhy
const R_MAX = 112;         // aby se stoh vešel do panelu i s popiskem
const MAX_LET = 16;
const SPLOSTENI = 0.86;    // kruhy nejsou kružnice, jinak to je terč

function kc(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${num(v / 1e9, 2)} mld. Kč`;
  if (a >= 1e6) return `${num(v / 1e6, 1)} mil. Kč`;
  if (a >= 1e4) return `${num(Math.round(v / 1e3))} tis. Kč`;
  return `${num(v)} Kč`;
}

export function DotaceHook({ cerpani, territory, children }: {
  cerpani: DotRok[]; territory?: string; children?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const art = useMemo(() => {
    const r = cerpani.filter((x) => x.castka > 0).slice(-MAX_LET);
    if (r.length < 3) return null;
    const strop = Math.max(...r.map((x) => x.castka));
    const cx = W * 0.5, cy = H * 0.52;

    // Mocnina, ne přímá úměra: rozdíly mezi roky jsou v částkách menší, než
    // jak je oko v kruzích pozná, a bez ní z letokruhů vyjde terč.
    const tloustky = r.map((x) => 0.8 + 11.5 * (x.castka / strop) ** 1.5);
    const potreba = JADRO + tloustky.reduce((a, t) => a + t + MEZERA, 0);
    const k = potreba > R_MAX ? R_MAX / potreba : 1;

    let r0 = JADRO * k;
    const kruhy = r.map((x, i) => {
      const t = tloustky[i] * k;
      const stred = r0 + t / 2;
      r0 += t + MEZERA * k;
      return {
        year: x.year, castka: x.castka, t,
        rx: stred, ry: stred * SPLOSTENI,
        // Nejnovější rok je nejsytější — oko jde nejdřív na kraj.
        sila: 0.34 + 0.56 * (i / Math.max(1, r.length - 1)),
      };
    });
    const posledni = kruhy[kruhy.length - 1];
    return {
      cx, cy, kruhy, jadro: JADRO * k,
      od: r[0].year, do: r[r.length - 1].year, let: r.length,
      soucet: r.reduce((a, x) => a + x.castka, 0),
      popisX: cx + posledni.rx + 10, popisY: cy - posledni.ry * 0.36,
    };
  }, [cerpani]);

  return (
    <section className="sc-hook dt-hook" {...hookVstup("dotace")} aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /><i className="sc-blob b3" /></div>

      <div className="sc-hook-copy">
        <NadpisHooku id={`${uid}-t`}>Kolik dotací<br />doteklo do území</NadpisHooku>
        <p className="lead">
          Co území dostalo, co mu poslal kraj a kam se obrátit pro další. Každý prstenec je jeden
          rok a jeho tloušťka částka, která toho roku dotekla do rozpočtu.
        </p>
        <div className="sc-hook-legend">
          {art && <span className="mute">{art.od}–{art.do}{territory ? ` · ${territory}` : ""}</span>}
        </div>
        {children}
      </div>

      <div className="sc-stage" aria-hidden={art ? undefined : "true"}>
        <div className="sc-pane p3" />
        <div className="sc-pane p2" />
        <div className="sc-pane p1">
          <span className="sc-sheen" />
          <svg className="sc-art dt-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
            role="img" aria-label={art ? `Přijaté dotace za ${art.let} let jako letokruhy, ${art.od} až ${art.do}` : "Zatím bez dat"}>
            <defs>
              <radialGradient id={`${uid}j`}>
                <stop offset="0%" stopColor="var(--h3)" stopOpacity="0.95" />
                <stop offset="100%" stopColor="var(--h1)" stopOpacity="0.55" />
              </radialGradient>
            </defs>
            {art && (
              <>
                {art.kruhy.map((k, i) => (
                  <ellipse key={k.year} className="dt-kruh" cx={art.cx} cy={art.cy} rx={k.rx} ry={k.ry}
                    strokeWidth={k.t} opacity={k.sila} style={{ ["--i" as string]: i }}>
                    <title>{k.year}: {kc(k.castka)}</title>
                  </ellipse>
                ))}
                <circle className="dt-jadro" cx={art.cx} cy={art.cy} r={art.jadro} fill={`url(#${uid}j)`} />
                <text className="dt-rok" x={art.popisX} y={art.popisY}>{art.do}</text>
                <text className="dt-rok stary" x={art.cx - art.kruhy[art.kruhy.length - 1].rx - 10} y={art.popisY} textAnchor="end">{art.od}</text>
              </>
            )}
          </svg>
          {art && (
            <div className="sc-delta glass">
              <Icon name="coins" size={14} />
              <strong>{kc(art.soucet)}</strong>
              <span>přijatých dotací za {art.let} let</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
