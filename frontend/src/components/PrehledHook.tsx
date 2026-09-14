// Otevření přehledu: dvacet let kraje najednou.
//
// Každý hřeben je jeden sledovaný ukazatel — obyvatelé, senioři,
// nezaměstnanost, byty — natažený přes stejné roky. Hřebeny se překrývají,
// takže je vidět, že se kraj hýbe pořád, i když každé číslo jinak.
//
// Každý hřeben je normalizovaný na vlastní rozsah. Jinak by řada v desítkách
// tisíc přitiskla procenta k nule a obrázek by tvrdil, že se nic neděje.
// Srovnávají se proto tvary, ne výšky — a je to napsané i v textu vedle,
// protože jinak by to byl graf, který lže tím, co vynechá.
//
// Řada, která začíná později, začíná později i na obrázku. Neúplnost dat je
// součást odpovědi, ne něco, co by se mělo zarovnat.

import { useId, useMemo } from "react";
import { hookTema } from "./hook-tema";
import { Icon } from "./Icon";
import { num } from "../lib/format";

export interface KpiRada { key: string; label: string; unit: string; series: { year: number; value: number }[] }

const W = 640, H = 262;
const PAD = { l: 28, r: 28, t: 24, b: 30 };
const MAX_HREBENU = 5;

export function PrehledHook({ kpis, pozorovani, children }: {
  kpis: KpiRada[]; pozorovani?: number; children?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const art = useMemo(() => {
    const rady = kpis.filter((k) => k.series.length >= 4).slice(0, MAX_HREBENU);
    if (rady.length < 2) return null;
    const roky = rady.flatMap((r) => r.series.map((p) => p.year));
    const x0 = Math.min(...roky), x1 = Math.max(...roky);
    const X = (y: number) => PAD.l + ((y - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);

    const plocha = H - PAD.t - PAD.b;
    const n = rady.length;
    // Hřebeny se překrývají: každý je vyšší než rozestup mezi nimi. Bez toho
    // by z toho byly čtyři samostatné grafy pod sebou, ne jeden obrázek.
    const krok = n > 1 ? (plocha * 0.74) / (n - 1) : 0;
    const vyska = plocha - krok * (n - 1);

    const hrebeny = rady.map((r, i) => {
      const zaklad = PAD.t + vyska + i * krok;
      const vals = r.series.map((p) => p.value);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const Y = (v: number) => zaklad - ((v - lo) / (hi - lo || 1)) * vyska;
      const cara = r.series.map((p, j) => `${j ? "L" : "M"}${X(p.year).toFixed(1)},${Y(p.value).toFixed(1)}`).join("");
      const a = r.series[0], z = r.series[r.series.length - 1];
      return {
        key: r.key, label: r.label, od: a.year, do: z.year,
        cara,
        vypln: `M${X(a.year).toFixed(1)},${zaklad.toFixed(1)}${cara.slice(1)}L${X(z.year).toFixed(1)},${zaklad.toFixed(1)}Z`,
        konecX: X(z.year), konecY: Y(z.value),
        // Vepředu je nejsytější; dozadu hřebeny blednou, aby se daly rozeznat.
        sila: 0.45 + (i / Math.max(1, n - 1)) * 0.55,
      };
    });
    // Pole je shora dolů, což je zároveň pořadí kreslení: horní hřeben je
    // nejdál, spodní nejblíž — a bližší musí překrýt vzdálenější.
    return { hrebeny, x0, x1, rozsah: x1 - x0 + 1 };
  }, [kpis]);

  return (
    <section className="sc-hook ph-hook" style={hookTema("prehled")} aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /><i className="sc-blob b3" /></div>

      <div className="sc-hook-copy">
        <div className="eyebrow">Královéhradecký kraj</div>
        <h1 id={`${uid}-t`}>{art ? <>{art.rozsah} let kraje<br />na jednom obrázku</> : <>Co se v kraji děje</>}</h1>
        <p className="lead">
          Každý hřeben je jeden sledovaný ukazatel přes stejné roky. Každý je normalizovaný na vlastní
          rozsah, takže se srovnávají tvary, ne výšky — a řada, která začíná později, začíná později
          i tady.
        </p>
        {art && (
          <ul className="ph-radky">
            {/* Stejné pořadí jako na obrázku, shora dolů. */}
            {art.hrebeny.map((h) => (
              <li key={h.key}>
                <i style={{ opacity: h.sila }} />
                <span>{h.label}</span>
                <span className="mute">{h.od}–{h.do}</span>
              </li>
            ))}
          </ul>
        )}
        {children}
      </div>

      <div className="sc-stage" aria-hidden={art ? undefined : "true"}>
        <div className="sc-pane p3" />
        <div className="sc-pane p2" />
        <div className="sc-pane p1">
          <span className="sc-sheen" />
          <svg className="sc-art ph-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
            role="img" aria-label={art ? `Vývoj ${art.hrebeny.length} ukazatelů kraje v letech ${art.x0} až ${art.x1}` : "Zatím bez dat"}>
            <defs>
              <linearGradient id={`${uid}h`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--h1)" stopOpacity="0.32" />
                <stop offset="100%" stopColor="var(--h1)" stopOpacity="0.04" />
              </linearGradient>
            </defs>

            {art?.hrebeny.map((h, i) => (
              <g className="ph-hreben" key={h.key} style={{ ["--i" as string]: i, opacity: h.sila }}>
                {/* Neprůhledné podloží pod barvou: bez něj hřeben vzadu prosvítá
                    skrz ten vpředu a stoh se rozpadne na změť čar. */}
                <path className="ph-kryt" d={h.vypln} />
                <path className="ph-vypln" d={h.vypln} fill={`url(#${uid}h)`} />
                <path className="ph-cara" d={h.cara} />
                <circle className="ph-bod" cx={h.konecX} cy={h.konecY} r="3.4" />
              </g>
            ))}
            {art && <text className="sc-yr" x={PAD.l} y={H - 9}>{art.x0}</text>}
          </svg>
          {pozorovani ? (
            <div className="sc-delta glass">
              <Icon name="database" size={14} />
              <strong>{num(pozorovani)}</strong>
              <span>měřených hodnot v modelu</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
