// Otevření mapy: tři měřítka, jedna mapa.
//
// Mapa má patra — Česko po krajích, kraj po ORP, ORP po obcích — a jediné,
// co člověk na začátku potřebuje vědět, je že se mezi nimi prokliká. Trychtýř
// to říká jedním pohledem: z jednoho dílku nahoře je celý řádek dole.
//
// Hook je proto úmyslně nízký (`is-slim`). Na téhle stránce je hlavní mapa;
// cokoli vysokého by ji odsunulo pod okraj obrazovky a překáželo by při každé
// další návštěvě.
//
// Počty se nepíšou, počítají se z rozsahu území, který stránka stejně stahuje.

import { useId, useMemo } from "react";
import { hookTema } from "./hook-tema";

const W = 640, H = 132;
const PAD = { l: 18, r: 18, t: 16, b: 14 };
const KHK = 86;

interface Patro { popis: string; pocet: number; y: number; vyska: number; zvyraznen: number | null }

export function MapaHook({ kraje, orp, obce, krajCode = KHK, children }: {
  kraje: { code: number }[]; orp: number; obce: number; krajCode?: number; children?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const art = useMemo(() => {
    if (!kraje.length || !orp || !obce) return null;
    const poradi = [...kraje].sort((a, b) => a.code - b.code);
    const idx = poradi.findIndex((k) => k.code === krajCode);
    const sirka = W - PAD.l - PAD.r;
    const rozestup = (H - PAD.t - PAD.b - 10) / 2;

    const patra: Patro[] = [
      { popis: "krajů", pocet: poradi.length, y: PAD.t, vyska: 10, zvyraznen: idx >= 0 ? idx : null },
      { popis: "ORP", pocet: orp, y: PAD.t + rozestup, vyska: 8, zvyraznen: null },
      { popis: "obcí", pocet: obce, y: PAD.t + rozestup * 2, vyska: 6, zvyraznen: null },
    ];

    const dilky = patra.map((p) => {
      const krok = sirka / p.pocet;
      // Pod dva pixely se z dílků stane šedá kaše; radši užší mezera.
      const w = Math.max(0.9, krok * (p.pocet > 100 ? 0.52 : 0.68));
      return { ...p, krok, w, x: (i: number) => PAD.l + krok * i + (krok - w) / 2 };
    });

    const horni = dilky[0];
    const zdroj = horni.zvyraznen === null ? null : {
      x0: horni.x(horni.zvyraznen),
      x1: horni.x(horni.zvyraznen) + horni.w,
    };
    return { dilky, zdroj, y1: dilky[0].y + dilky[0].vyska, y2: dilky[1].y, y3: dilky[1].y + dilky[1].vyska, y4: dilky[2].y };
  }, [kraje, orp, obce, krajCode]);

  return (
    <section className="sc-hook mp-hook is-slim" style={hookTema("mapa")} aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /></div>

      <div className="sc-hook-copy">
        <div className="eyebrow">Mapa</div>
        <h1 id={`${uid}-t`}>Tři měřítka, jedna mapa</h1>
        <p className="lead">
          Česko po krajích, kraj po ORP, ORP po obcích. Klepnutí na území vás pustí o patro níž.
          V pohledu na kraj navíc mapu přepnete do skutečného terénu.
        </p>
        {children}
      </div>

      <div className="sc-stage" aria-hidden={art ? undefined : "true"}>
        <div className="sc-pane p1">
          <span className="sc-sheen" />
          <svg className="sc-art mp-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
            role="img" aria-label={art ? `${art.dilky[0].pocet} krajů, ${art.dilky[1].pocet} ORP a ${art.dilky[2].pocet} obcí` : "Zatím bez dat"}>
            {art && (
              <>
                {/* Trychtýř: z jednoho kraje je celý řádek ORP a z něj celý řádek obcí. */}
                {art.zdroj && (
                  <path className="mp-trycht" d={`M${art.zdroj.x0},${art.y1}L${art.zdroj.x1},${art.y1}L${W - PAD.r},${art.y2}L${PAD.l},${art.y2}Z`} />
                )}
                <path className="mp-trycht slaby" d={`M${PAD.l},${art.y3}L${W - PAD.r},${art.y3}L${W - PAD.r},${art.y4}L${PAD.l},${art.y4}Z`} />

                {art.dilky.map((p, ri) => (
                  <g className="mp-patro" key={p.popis} style={{ ["--i" as string]: ri }}>
                    {Array.from({ length: p.pocet }, (_, i) => (
                      <rect key={i} x={p.x(i)} y={p.y} width={p.w} height={p.vyska} rx={Math.min(2, p.w / 2)}
                        className={p.zvyraznen === i ? "mp-dilek je-zde" : "mp-dilek"} />
                    ))}
                    <text className="mp-pocet" x={W - PAD.r} y={p.y - 4} textAnchor="end">{p.pocet} {p.popis}</text>
                  </g>
                ))}
              </>
            )}
          </svg>
        </div>
      </div>
    </section>
  );
}
