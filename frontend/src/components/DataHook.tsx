// Otevření dat: katalog má tvar.
//
// Dvacet tisíc řádků v tabulce je číslo, které si nikdo nepředstaví. Plocha
// ano: každý obdélník je jedna oblast a jeho velikost odpovídá počtu
// ověřených datových sad. Je z toho vidět na první pohled to, co ze seznamu
// nikdy — že bydlení a rozvoj (stavební úřady a územní plány) je většina
// českých otevřených dat a že zdravotnictví je proti tomu proužek.
//
// To není chyba katalogu, to je stav krajiny. A protože stránka jinde tvrdí,
// že prázdná místa jsou stejně vypovídající jako plná, musí být vidět i tady.
//
// Rozvržení je „squarified treemap": obdélníky se skládají do pruhů tak, aby
// byly co nejblíž čtverci. Bez toho vyjdou z velkých oblastí dlouhé nudle,
// do kterých se nevejde popisek a plochy se přestanou dát porovnat.

import { useId, useMemo } from "react";
import { hookTema } from "./hook-tema";
import { num } from "../lib/format";

export interface Oblast { key: string; label: string; count: number }

const W = 640, H = 262;
const PAD = 12;
const SPARA = 3;            // mezera mezi dlaždicemi

interface Dlazdice extends Oblast { x: number; y: number; w: number; h: number }

/** Nejhorší poměr stran v pruhu — kritérium, podle kterého se pruh uzavírá. */
function nejhorsi(plochy: number[], strana: number): number {
  const s = plochy.reduce((a, v) => a + v, 0);
  if (s <= 0) return Infinity;
  const mx = Math.max(...plochy), mn = Math.min(...plochy);
  const s2 = s * s, st2 = strana * strana;
  return Math.max((st2 * mx) / s2, s2 / (st2 * mn));
}

function treemap(polozky: Oblast[], x0: number, y0: number, w0: number, h0: number): Dlazdice[] {
  const kladne = polozky.filter((p) => p.count > 0).sort((a, b) => b.count - a.count);
  const celkem = kladne.reduce((a, p) => a + p.count, 0);
  if (!celkem || w0 <= 0 || h0 <= 0) return [];
  const meritko = (w0 * h0) / celkem;

  const out: Dlazdice[] = [];
  let zbytek = kladne.map((p) => ({ ...p, plocha: p.count * meritko }));
  let x = x0, y = y0, w = w0, h = h0;

  while (zbytek.length && w > 0.5 && h > 0.5) {
    const strana = Math.min(w, h);
    const pruh = [zbytek[0]];
    let i = 1;
    while (i < zbytek.length
      && nejhorsi([...pruh, zbytek[i]].map((r) => r.plocha), strana) <= nejhorsi(pruh.map((r) => r.plocha), strana)) {
      pruh.push(zbytek[i]); i++;
    }
    const soucet = pruh.reduce((a, r) => a + r.plocha, 0);
    const tloustka = Math.min(soucet / strana, w >= h ? w : h);
    let posun = 0;
    for (const r of pruh) {
      const dil = (r.plocha / soucet) * strana;
      if (w >= h) out.push({ ...r, x, y: y + posun, w: tloustka, h: dil });
      else out.push({ ...r, x: x + posun, y, w: dil, h: tloustka });
      posun += dil;
    }
    if (w >= h) { x += tloustka; w -= tloustka; } else { y += tloustka; h -= tloustka; }
    zbytek = zbytek.slice(pruh.length);
  }
  return out;
}

/** SVG neumí zkrátit text třemi tečkami, takže se ořízne podle šířky dlaždice. */
function zkrat(text: string, sirka: number, px: number): string {
  const max = Math.floor((sirka - 16) / px);
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function DataHook({ oblasti, overenych, celkem, poskytovatelu, children }: {
  oblasti: Oblast[]; overenych?: number; celkem?: number; poskytovatelu?: number; children?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const art = useMemo(() => {
    const dlazdice = treemap(oblasti, PAD, PAD, W - PAD * 2, H - PAD * 2);
    if (dlazdice.length < 3) return null;
    // Součet jde ze všech oblastí, ne z vykreslených dlaždic: procento v textu
    // se musí vztahovat k celému katalogu, ne k tomu, co se vešlo do panelu.
    const soucet = oblasti.reduce((a, o) => a + Math.max(0, o.count), 0);
    return { dlazdice, soucet, nej: dlazdice[0] };
  }, [oblasti]);

  return (
    <section className="sc-hook da-hook" style={hookTema("data")} aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /><i className="sc-blob b3" /></div>

      <div className="sc-hook-copy">
        <div className="eyebrow">Otevřená data</div>
        <h1 id={`${uid}-t`}>Katalog není seznam.<br />Je to krajina.</h1>
        <p className="lead">
          Každá dlaždice je jedna oblast a její plocha odpovídá počtu datových sad s ověřeným odkazem.
          {art && <> Největší je {art.nej.label.toLowerCase()} — {num(Math.round((100 * art.nej.count) / art.soucet))} % katalogu.</>}
          {" "}Co je malé, není zanedbané: prostě to nikdo nepublikuje.
        </p>
        <div className="sc-hook-legend">
          {celkem && overenych ? <span className="mute">{num(overenych)} z {num(celkem)} má ověřený odkaz</span> : null}
          {poskytovatelu ? <span className="mute">{num(poskytovatelu)} poskytovatelů</span> : null}
        </div>
        {children}
      </div>

      <div className="sc-stage" aria-hidden={art ? undefined : "true"}>
        <div className="sc-pane p3" />
        <div className="sc-pane p2" />
        <div className="sc-pane p1">
          <span className="sc-sheen" />
          <svg className="sc-art da-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
            role="img" aria-label={art ? `Datové sady podle oblastí; největší je ${art.nej.label} s ${art.nej.count} sadami` : "Zatím bez dat"}>
            {art?.dlazdice.map((d, i) => {
              // Dlaždice jsou neprůhledné a postupně se blíží barvě panelu.
              // Popisek dostanou jen ty sytější: na těch bledých už v tmavém
              // motivu tmavý inkoust přestane být vidět.
              const sila = Math.round(95 - (i / art.dlazdice.length) * 45);
              const svetla = sila >= 62;
              return (
                <g className="da-dlazdice" key={d.key} style={{ ["--i" as string]: i }}>
                  <rect x={d.x + SPARA / 2} y={d.y + SPARA / 2} width={Math.max(0, d.w - SPARA)} height={Math.max(0, d.h - SPARA)}
                    rx={Math.min(9, d.w / 4, d.h / 4)} style={{ ["--sila" as string]: `${sila}%` }} />
                  {svetla && d.w > 74 && d.h > 30 && <text className="da-nazev" x={d.x + 11} y={d.y + 22}>{zkrat(d.label, d.w, 6.4)}</text>}
                  {svetla && d.w > 74 && d.h > 50 && <text className="da-pocet" x={d.x + 11} y={d.y + 42}>{num(d.count)}</text>}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </section>
  );
}
