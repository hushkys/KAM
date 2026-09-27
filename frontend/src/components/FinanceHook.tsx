// Otevření hospodaření: co zbude, když se zaplatí provoz.
//
// Nad osou je provozní přebytek — kolik z příjmů zbylo po běžných výdajích.
// Pod osou kapitálové výdaje — kolik obec ten rok proměnila v majetek. Když
// je zlatý sloupec vyšší než ten pod ním, obec si investici zaplatila sama;
// když ne, dotáhla ji dotace nebo úvěr. Celá stránka je rozvedením téhle
// jedné dvojice sloupců.
//
// Obě čísla se měří od stejné osy a stojí vedle sebe, ne přes sebe: roky, kdy
// je přebytek záporný, jinak kreslí sloupec do stejného místa jako investice
// a obrázek by v tom roce lhal oběma směry.
//
// Sloupce jsou skutečné roky z rozpočtu (ČSÚ MOS). Bez dat panel zůstane
// prázdný.

import { useId, useMemo } from "react";
import { NadpisHooku } from "./hook-nadpis";
import { hookVstup } from "./hook-tema";
import { Icon } from "./Icon";
import { num } from "../lib/format";

export interface FinRok { year: number; provozni: number; kapital: number }

const W = 640, H = 262;
const PAD = { l: 26, r: 26, t: 26, b: 34 };
const MAX_LET = 14;

function kc(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${num(v / 1e9, 2)} mld. Kč`;
  if (a >= 1e6) return `${num(v / 1e6, 1)} mil. Kč`;
  if (a >= 1e4) return `${num(Math.round(v / 1e3))} tis. Kč`;
  return `${num(v)} Kč`;
}

export function FinanceHook({ roky, kryti, territory, children }: {
  roky: FinRok[]; kryti?: number | null; territory?: string; children?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const art = useMemo(() => {
    const r = roky.slice(-MAX_LET);
    if (r.length < 3) return null;
    const strop = Math.max(...r.map((x) => Math.abs(x.provozni)), ...r.map((x) => Math.max(0, x.kapital)));
    if (!strop) return null;
    const sirka = W - PAD.l - PAD.r;
    const krok = sirka / r.length;
    const w = Math.min(15, krok * 0.34);
    // Osa nesedí uprostřed: přebytek bývá menší než investice, a kdyby se
    // dělily napůl, půlka panelu by zůstala prázdná.
    const osa = PAD.t + (H - PAD.t - PAD.b) * 0.46;
    const nahoru = osa - PAD.t, dolu = H - PAD.b - osa;

    return {
      osa,
      sloupce: r.map((x, i) => {
        const stred = PAD.l + krok * (i + 0.5);
        const hp = (Math.abs(x.provozni) / strop) * (x.provozni >= 0 ? nahoru : dolu);
        const hk = (Math.max(0, x.kapital) / strop) * dolu;
        return {
          year: x.year,
          // Zlatý sloupec vlevo od středu, investice vpravo — v každém roce
          // stejně, aby se dvojice daly číst přes celou řadu.
          px: stred - w - 1.5, kx: stred + 1.5,
          py: x.provozni >= 0 ? osa - hp : osa, ph: Math.max(1.5, hp), zaporny: x.provozni < 0,
          ky: osa, kh: Math.max(hk, x.kapital > 0 ? 1.5 : 0),
        };
      }),
      w, x0: r[0].year, x1: r[r.length - 1].year,
      soucet: r.reduce((a, x) => a + x.provozni, 0),
    };
  }, [roky]);

  return (
    <section className="sc-hook fi-hook" {...hookVstup("hospodareni")} aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /><i className="sc-blob b3" /></div>

      <div className="sc-hook-copy">
        <NadpisHooku id={`${uid}-t`}>Zbude obci na investice?</NadpisHooku>
        <p className="lead">
          Provozní přebytek je to, co z příjmů zbude po zaplacení běžného chodu obce. Je-li sloupec
          nad osou vyšší než ten pod ní, zaplatila si obec investice toho roku sama.
        </p>
        <div className="sc-hook-legend">
          <span><i className="sw scen" /> Provozní přebytek</span>
          <span><i className="sw fi-kap" /> Investice (kapitálové výdaje)</span>
          {territory && <span className="mute">{territory}</span>}
        </div>
        {children}
      </div>

      <div className="sc-stage" aria-hidden={art ? undefined : "true"}>
        <div className="sc-pane p3" />
        <div className="sc-pane p2" />
        <div className="sc-pane p1">
          <span className="sc-sheen" />
          <svg className="sc-art fi-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
            role="img" aria-label={art ? `Provozní přebytek a investice v letech ${art.x0} až ${art.x1}` : "Zatím bez dat"}>
            {art && (
              <>
                {art.sloupce.map((s, i) => (
                  <g key={s.year} style={{ ["--i" as string]: i }} className="fi-rok">
                    <rect className={s.zaporny ? "fi-prov je-minus" : "fi-prov"} x={s.px} y={s.py} width={art.w} height={s.ph} rx={Math.min(3, art.w / 2)} />
                    {s.kh > 0 && <rect className="fi-kap" x={s.kx} y={s.ky} width={art.w} height={s.kh} rx={Math.min(3, art.w / 2)} />}
                  </g>
                ))}
                <line className="fi-osa" x1={PAD.l - 4} x2={W - PAD.r + 4} y1={art.osa} y2={art.osa} />
                <text className="sc-yr" x={PAD.l} y={H - 9}>{art.x0}</text>
              </>
            )}
          </svg>
          {art && (
            <div className="sc-delta glass">
              <Icon name="coins" size={14} />
              <strong>{kryti !== null && kryti !== undefined ? `${num(kryti, 1)} %` : kc(art.soucet)}</strong>
              <span>{kryti !== null && kryti !== undefined ? "investic zaplaceno z vlastního" : `provozní přebytek ${art.x0}–${art.x1}`}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
