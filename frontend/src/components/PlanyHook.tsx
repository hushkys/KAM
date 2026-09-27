// Otevření Plánů: období na společné ose.
//
// Program rozvoje má dvě letopočty a mezi nimi je všechno, co si obec
// předsevzala. Jediný obrázek, který o tom něco řekne, je proto úsečka na
// ose let — a svislá čára „dnes" přes ni. Z toho je hned vidět, co ještě
// platí, co doběhlo a komu zbývá poslední rok.
//
// Vyplněná část pruhu je ta, která už uplynula, zbytek zůstává obrysem.
// Záměrně to není „hotovo z plánu": kolik je hotové, nikdo strojově
// nezveřejňuje. Plný pruh proto znamená jen „čas vypršel", nikdy „splněno",
// a legenda i text stránky to říkají slovem.
//
// Pruhy jdou podle roku začátku, takže z nich vyjde schodiště — nejstarší
// plány nahoře, nejnovější dole. Řazení podle konce vypadalo jako žebříček
// úspěšnosti, což by byl přesně ten nepodložený soud, kterému se tu vyhýbáme.

import { useId, useMemo } from "react";
import { NadpisHooku } from "./hook-nadpis";
import { hookVstup } from "./hook-tema";
import { Icon } from "./Icon";

export interface PlanRadek { id: string; name: string; od?: number; do?: number; stav: string }

const W = 640, H = 262;
const L = 20, R = 20;         // boční okraje kresby
const NAD = 30, POD = 26;     // místo na popisek „dnes" a na roky
const MAX_RADKU = 15;
const KROK_OSY = 2;           // popisek každý druhý rok, jinak se slijí

export function PlanyHook({ plany, letos, children }: {
  plany: PlanRadek[]; letos: number; children?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const art = useMemo(() => {
    const r = plany.filter((p) => p.od && p.do && p.do >= p.od);
    if (r.length < 3) return null;
    // Nejdřív ty, které ještě běží — když se jich všech patnáct nevejde,
    // ať zmizí ty doběhlé, ne ty, o kterých se ještě rozhoduje.
    const vybrane = [...r]
      .sort((a, b) => Number((b.do as number) >= letos) - Number((a.do as number) >= letos) || (a.od as number) - (b.od as number))
      .slice(0, MAX_RADKU)
      .sort((a, b) => (a.od as number) - (b.od as number) || (a.do as number) - (b.do as number));

    const od = Math.min(...vybrane.map((p) => p.od as number), letos);
    const doR = Math.max(...vybrane.map((p) => p.do as number), letos) + 1;
    const x = (rok: number) => L + ((rok - od) / (doR - od)) * (W - L - R);

    const vyska = H - NAD - POD;
    const krok = vyska / vybrane.length;
    const tl = Math.min(12, krok - 4);

    const pruhy = vybrane.map((p, i) => {
      const a = x(p.od as number);
      const b = x((p.do as number) + 1);
      // Uplynulá část končí buď dneškem, nebo koncem období — podle toho,
      // co přijde dřív. Bez toho by prošlý plán přetekl za svůj konec.
      const ted = Math.max(a, Math.min(b, x(Math.min(letos + 1, (p.do as number) + 1))));
      return {
        ...p, i, a, b, ted,
        y: NAD + i * krok + (krok - tl) / 2, tl,
        prosly: (p.do as number) < letos,
        konci: (p.do as number) === letos,
      };
    });

    const roky: number[] = [];
    for (let y = Math.ceil(od / KROK_OSY) * KROK_OSY; y <= doR; y += KROK_OSY) roky.push(y);

    return {
      pruhy, roky, x, od, doR, xDnes: x(letos),
      plati: r.filter((p) => (p.do as number) >= letos).length, celkem: r.length,
    };
  }, [plany, letos]);

  return (
    <section className="sc-hook pl-hook" {...hookVstup("plany")} aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /><i className="sc-blob b3" /></div>

      <div className="sc-hook-copy">
        <NadpisHooku id={`${uid}-t`}>Do kdy<br />si to obec dala</NadpisHooku>
        <p className="lead">
          Program rozvoje má napsané období — co se má postavit a do kterého roku. Každý pruh je
          jedna obec a svislá čára je dnešek. Vyplněná část je čas, který už uplynul; že je hotovo,
          z toho neplyne a nikdo to strojově nezveřejňuje.
        </p>
        <div className="sc-hook-legend">
          <span><i className="sw pl-plati" /> období ještě běží</span>
          <span><i className="sw pl-prosly" /> období doběhlo</span>
          <span><i className="sw pl-dnes" /> dnešek</span>
        </div>
        {children}
      </div>

      <div className="sc-stage" aria-hidden={art ? undefined : "true"}>
        <div className="sc-pane p3" />
        <div className="sc-pane p2" />
        <div className="sc-pane p1">
          <span className="sc-sheen" />
          <svg className="sc-art pl-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
            role="img" aria-label={art
              ? `Období programů rozvoje ${art.od} až ${art.doR - 1}; z ${art.celkem} plánů jich ${art.plati} ještě běží`
              : "Zatím bez dat"}>
            {art && (
              <>
                {art.roky.map((y) => (
                  <g key={y}>
                    <line className="pl-mrizka" x1={art.x(y)} y1={NAD - 8} x2={art.x(y)} y2={H - POD + 4} />
                    <text className="pl-rok" x={art.x(y)} y={H - POD + 18} textAnchor="middle">{y}</text>
                  </g>
                ))}

                {art.pruhy.map((p) => (
                  <g key={p.id} className="pl-pruh" style={{ ["--i" as string]: p.i }}>
                    <rect className="pl-cele" x={p.a} y={p.y} width={Math.max(3, p.b - p.a)} height={p.tl} rx={p.tl / 2} />
                    <rect className={`pl-uply${p.prosly ? " je-prosly" : ""}${p.konci ? " je-konec" : ""}`}
                      x={p.a} y={p.y} width={Math.max(2, p.ted - p.a)} height={p.tl} rx={p.tl / 2}>
                      <title>{p.name}: {p.od}–{p.do}{p.prosly ? " (doběhlo)" : ""}</title>
                    </rect>
                  </g>
                ))}

                <line className="pl-dnes-cara" x1={art.xDnes} y1={NAD - 14} x2={art.xDnes} y2={H - POD + 2} />
                <text className="pl-dnes-popis" x={art.xDnes} y={NAD - 19} textAnchor="middle">dnes · {letos}</text>
              </>
            )}
          </svg>
          {art && (
            <div className="sc-delta glass">
              <Icon name="calendar" size={14} />
              <strong>{art.plati} z {art.celkem}</strong>
              <span>plánů má období, které ještě běží</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
