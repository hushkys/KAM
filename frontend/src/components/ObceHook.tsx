// Otevření stránky obcí: jedna myšlenka, nakreslená.
//
// Kraj není jedno místo, je jich čtyři sta čtyřicet osm — a nejsou si ani
// trochu podobné. Jedna tečka je jedna obec, plocha odpovídá počtu obyvatel
// a vodorovná osa je logaritmická, protože jinak by se devadesát procent
// obcí slilo do jednoho chumlu u nuly a zbyl by jeden puntík vpravo.
//
// Tečky jsou skutečná data, ne ozdoba: pozice i velikost se počítají z počtu
// obyvatel, který přišel ze stejného zdroje jako seznam pod tím. Než data
// dorazí, panel zůstane prázdný — ne že by si vymyslel tvar.
//
// Rozvržení je „beeswarm": bod se posadí na svou hodnotu na ose a pak se
// posouvá kolmo, dokud nenajde místo, kde nikoho nepřekrývá. Proto se velké
// obce vpravo rozestoupí a hejno malých vlevo zhoustne — ten tvar sám je
// odpověď na otázku, jak vypadá kraj.

import { useId, useMemo } from "react";
import { NadpisHooku } from "./hook-nadpis";
import { hookVstup } from "./hook-tema";
import { Icon } from "./Icon";
import { num } from "../lib/format";

export interface ObecBod { id: string; name: string; population: number }

const W = 640, H = 262;
const PAD = { l: 26, r: 26, t: 26, b: 40 };
const MEZERA = 0.9;        // odstup teček, aby se nedotýkaly
const R_MIN = 2.1, R_MAX = 23;

interface Bod extends ObecBod { x: number; y: number; r: number }

function rozmisti(obce: ObecBod[]): { body: Bod[]; min: Bod; max: Bod; median: Bod } | null {
  const platne = obce.filter((o) => o.population > 0);
  if (platne.length < 8) return null;
  const serazene = [...platne].sort((a, b) => a.population - b.population);
  const lo = Math.log(serazene[0].population);
  const hi = Math.log(serazene[serazene.length - 1].population);
  const sirka = W - PAD.l - PAD.r;
  const cy = PAD.t + (H - PAD.t - PAD.b) / 2;
  const X = (p: number) => PAD.l + ((Math.log(p) - lo) / Math.max(hi - lo, 1e-6)) * sirka;
  // Plocha úměrná počtu obyvatel: poloměr tedy odmocnina. Kdyby rostl lineárně,
  // Hradec Králové by zabral celý panel a zbytek by nebyl vidět.
  const kMax = Math.sqrt(serazene[serazene.length - 1].population);
  const R = (p: number) => R_MIN + (R_MAX - R_MIN) * (Math.sqrt(p) / kMax) ** 1.35;

  const body: Bod[] = [];
  for (const o of serazene) {
    const x = X(o.population);
    const r = R(o.population);
    let y = cy;
    for (let k = 0; k < 260; k++) {
      // 0, +krok, −krok, +2·krok … — bod se zkouší posadit co nejblíž ose.
      const krok = Math.ceil(k / 2) * (r * 1.15 + 1.1);
      const cand = cy + (k % 2 ? krok : -krok);
      if (cand - r < PAD.t || cand + r > H - PAD.b) continue;
      let volno = true;
      // Sousedé jsou jen ti, kteří mohou na téhle ose vůbec dosáhnout; pole
      // je seřazené podle x, takže stačí couvat, dokud je to blízko.
      for (let j = body.length - 1; j >= 0; j--) {
        const b = body[j];
        const dx = x - b.x;
        if (dx > b.r + R_MAX + MEZERA) break;
        const dy = cand - b.y;
        const min = b.r + r + MEZERA;
        if (dx * dx + dy * dy < min * min) { volno = false; break; }
      }
      if (volno) { y = cand; break; }
    }
    body.push({ ...o, x, y, r });
  }
  return {
    body,
    min: body[0],
    max: body[body.length - 1],
    median: body[Math.floor(body.length / 2)],
  };
}

export function ObceHook({ obce, loading, onOpen, children }: {
  obce: ObecBod[]; loading?: boolean; onOpen?: (id: string) => void; children?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const art = useMemo(() => rozmisti(obce), [obce]);

  const odkaz = (b: Bod | undefined, popis: string) => b && (
    <a className="ob-kotva" href={`/obce/${b.id}`} onClick={(e) => { if (onOpen && e.button === 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onOpen(b.id); } }}>
      <span className="ob-kotva-popis">{popis}</span>
      <strong>{b.name}</strong>
      <span className="num">{num(b.population)} obyv.</span>
    </a>
  );

  return (
    <section className="sc-hook ob-hook" {...hookVstup("obce")} aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /><i className="sc-blob b3" /></div>

      <div className="sc-hook-copy">
        <NadpisHooku id={`${uid}-t`}>Kraj není jedno místo.{art && <><br />Je jich {num(art.body.length)}.</>}</NadpisHooku>
        <p className="lead">
          Jedna tečka je jedna obec a její plocha odpovídá počtu obyvatel. Od největšího města po vesnici
          o pár desítkách lidí — a každá z nich má profil ve všech sledovaných oblastech, rizika i výhled.
        </p>
        {art && (
          <div className="ob-kotvy">
            {odkaz(art.max, "Největší")}
            {odkaz(art.median, "Medián")}
            {odkaz(art.min, "Nejmenší")}
          </div>
        )}
        {children}
      </div>

      <div className="sc-stage" aria-hidden={art ? undefined : "true"}>
        <div className="sc-pane p3" />
        <div className="sc-pane p2" />
        <div className="sc-pane p1">
          <span className="sc-sheen" />
          <svg className="sc-art ob-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
            role="img" aria-label={art ? `Všech ${art.body.length} obcí kraje podle počtu obyvatel; největší ${art.max.name}, nejmenší ${art.min.name}` : "Zatím bez dat"}>
            <defs>
              <radialGradient id={`${uid}g`}>
                <stop offset="0%" stopColor="var(--h3)" stopOpacity="0.95" />
                <stop offset="100%" stopColor="var(--h1)" stopOpacity="0.6" />
              </radialGradient>
            </defs>

            {art && (
              <>
                {/* Osa zůstává jako čára, čísla ne: krajní hodnoty i medián
                    jsou vypsané v kotvách vedle, a popisek u pravého konce by
                    beztak padl pod plovoucí odznak s počtem obcí. */}
                <line className="ob-osa" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b + 14} y2={H - PAD.b + 14} />

                <line className="ob-median" x1={art.median.x} x2={art.median.x} y1={PAD.t - 6} y2={H - PAD.b + 8} />
                <text className="ob-popis stred" x={art.median.x} y={PAD.t - 12} textAnchor="middle">medián {num(art.median.population)}</text>

                <g className="ob-body">
                  {art.body.map((b, i) => (
                    <circle key={b.id} cx={b.x} cy={b.y} r={b.r}
                      fill={b.r > 6 ? `url(#${uid}g)` : "var(--h1)"}
                      opacity={0.42 + Math.min(b.r / R_MAX, 1) * 0.55}
                      style={{ ["--i" as string]: i % 60 }} />
                  ))}
                </g>
                {/* Tři body, které se v textu jmenují, dostanou prstenec —
                    jinak by se v hejnu nedaly najít. */}
                {[art.min, art.median, art.max].map((b) => (
                  <circle key={`k${b.id}`} className="ob-kruh" cx={b.x} cy={b.y} r={b.r + 4.5} />
                ))}
              </>
            )}
          </svg>
          {art && (
            <div className="sc-delta glass">
              <Icon name="home" size={14} />
              <strong>{num(art.body.length)}</strong>
              <span>obcí v kraji</span>
            </div>
          )}
          {!art && loading && <span className="skeleton" style={{ position: "absolute", inset: 18 }} />}
        </div>
      </div>
    </section>
  );
}
