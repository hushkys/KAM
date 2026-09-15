// Otevření statistik: kolik toho model drží, spočítané po tečkách.
//
// „Čtyři sta tisíc hodnot" je číslo, které projde okem a nic nezanechá.
// Čtyři sta teček je množství, které se dá odhadnout pohledem — a přesně
// o to na téhle stránce jde: co má KAM pod sebou.
//
// Nejde o plochu, jde o počet. Proto stejně velké tečky a ne obdélníky:
// plocha srovnává, tečky počítají, a tady je otázka „kolik", ne „čeho víc".
//
// Tečky jdou po letech, takže se z odstínu čte i stáří. Vidět je z toho
// i to, co tabulka schová: první roky jsou tenké, protože ČSÚ tehdy
// zveřejňoval míň, a poslední rok se teprve plní.
//
// Jednotka se dopočítá tak, aby teček bylo kolem čtyř set — pod sto by se
// obrázek nedal odhadnout, nad tisíc by splynuly v plochu.

import { useId, useMemo } from "react";
import { NadpisHooku } from "./hook-nadpis";
import { hookVstup } from "./hook-tema";
import { Icon } from "./Icon";
import { num } from "../lib/format";

export interface RokHodnot { year: number; count: number }

const W = 640, H = 262;
const PAD = { l: 26, r: 26, t: 24, b: 24 };
const CILOVE_TECKY = 500;
/** Jednotka musí být kulatá, jinak popisek „jedna tečka je 1 071 hodnot" nikdo nepřečte. */
const KULATE = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

export function StatistikyHook({ roky, children }: { roky: RokHodnot[]; children?: React.ReactNode }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const art = useMemo(() => {
    const r = roky.filter((x) => x.count > 0).sort((a, b) => a.year - b.year);
    const celkem = r.reduce((a, x) => a + x.count, 0);
    if (r.length < 2 || celkem < 100) return null;
    const jednotka = KULATE.find((k) => celkem / k <= CILOVE_TECKY) ?? KULATE[KULATE.length - 1];
    const pocet = Math.max(1, Math.round(celkem / jednotka));

    const sirka = W - PAD.l - PAD.r, vyska = H - PAD.t - PAD.b;
    const sloupcu = Math.max(1, Math.ceil(Math.sqrt((pocet * sirka) / vyska)));
    const radku = Math.ceil(pocet / sloupcu);
    const krok = Math.min(sirka / sloupcu, vyska / radku);
    const rr = krok * 0.34;
    // Mřížka se vystředí, aby zbytek posledního řádku nestrhl obrázek doleva.
    const x0 = PAD.l + (sirka - sloupcu * krok) / 2 + krok / 2;
    const y0 = PAD.t + (vyska - radku * krok) / 2 + krok / 2;

    // Tečka i patří tomu roku, do kterého spadne její pořadí v součtu.
    const meze: { do: number; t: number }[] = [];
    let beh = 0;
    r.forEach((x, i) => { beh += x.count; meze.push({ do: beh / jednotka, t: r.length > 1 ? i / (r.length - 1) : 1 }); });

    let kurzor = 0;
    const tecky = Array.from({ length: pocet }, (_, i) => {
      while (kurzor < meze.length - 1 && i >= meze[kurzor].do) kurzor++;
      return {
        x: x0 + (i % sloupcu) * krok,
        y: y0 + Math.floor(i / sloupcu) * krok,
        t: meze[kurzor].t,
      };
    });

    return { tecky, rr, pocet, jednotka, celkem, od: r[0].year, do: r[r.length - 1].year };
  }, [roky]);

  return (
    <section className="sc-hook st-hook" {...hookVstup("statistiky")} aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /><i className="sc-blob b3" /></div>

      <div className="sc-hook-copy">
        <div className="eyebrow">Statistiky</div>
        <NadpisHooku id={`${uid}-t`}>{art ? <>Každá tečka<br />je {num(art.jednotka)} čísel</> : <>Čísla o datech a o KAM</>}</NadpisHooku>
        <p className="lead">
          {art
            ? <>Model drží {num(art.celkem)} měřených hodnot z let {art.od}–{art.do}. Tady jsou všechny najednou —
              jedna tečka za každých {num(art.jednotka)}. Čím světlejší, tím novější.</>
            : <>Kolik dat model drží, odkud jsou, jak čerstvá a jak se aplikace používá.</>}
        </p>
        {art && (
          <div className="st-ramp">
            <span>{art.od}</span>
            <i aria-hidden="true" />
            <span>{art.do}</span>
          </div>
        )}
        {children}
      </div>

      <div className="sc-stage" aria-hidden={art ? undefined : "true"}>
        <div className="sc-pane p3" />
        <div className="sc-pane p2" />
        <div className="sc-pane p1">
          <span className="sc-sheen" />
          <svg className="sc-art st-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
            role="img" aria-label={art ? `${num(art.pocet)} teček, každá za ${num(art.jednotka)} měřených hodnot z let ${art.od} až ${art.do}` : "Zatím bez dat"}>
            {art?.tecky.map((d, i) => (
              <circle key={i} cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r={art.rr.toFixed(2)}
                fill={`color-mix(in oklab, var(--h3) ${Math.round(6 + 94 * d.t)}%, var(--h2))`}
                style={{ ["--i" as string]: i % 60 }} />
            ))}
          </svg>
          {art && (
            <div className="sc-delta glass">
              <Icon name="database" size={14} />
              <strong>{num(art.celkem)}</strong>
              <span>měřených hodnot</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
