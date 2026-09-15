// Otevření podnětů: z hlášení se stává podnět.
//
// Jedno hlášení je stížnost. Pět podobných hlášení ze stejné obce je doklad —
// a přesně na tom stojí celá stránka. Obrázek kreslí ten práh: kolik políček
// je zaplněných, kolik chybí a co z toho na konci vznikne.
//
// Kreslí se pravidlo, ne objem. Podnětů je na začátku málo (často jediný),
// takže obrázek, který by ukazoval „kolik jich je", by byl prázdný a stránku
// by pohřbil. Takhle funguje od nuly: říká, co se stane, když člověk přidá
// svoje hlášení, a kolik jich ještě chybí.
//
// Práh i počty jsou skutečné (`/reports/stats`, `/reports/clusters`), nic se
// tu nedopisuje. Dokud práh nikdo nepřekročil, je dokument jen obrys.

import { useId, useMemo } from "react";
import { hookTema } from "./hook-tema";
import { Icon } from "./Icon";
import { num, plural } from "../lib/format";

export interface Skupina { id: number; count: number; status: string }

const W = 640, H = 262;
const PAD = { l: 34, r: 26 };
const DOK_W = 132;          // místo pro dokument vpravo
const OSA_Y = 112;
const MAX_POLI = 9;         // nad devět políček přestanou být čitelná

export function PodnetyHook({ skupiny, prah, hlaseni, children }: {
  skupiny: Skupina[]; prah: number; hlaseni?: number; children?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const art = useMemo(() => {
    const p = Math.max(2, Math.min(MAX_POLI, prah || 5));
    const konecX = W - PAD.r - DOK_W;
    const sirka = konecX - PAD.l;
    const krok = sirka / p;
    const r = Math.min(17, krok * 0.34);

    const nejdal = skupiny.reduce((a, s) => Math.max(a, s.count), 0);
    const hotove = skupiny.filter((s) => s.status === "pripraveno" || s.status === "odeslano").length;

    return {
      p, r, konecX,
      // Políčko i (od 1) leží uprostřed svého dílku, aby řada nekončila
      // natěsno u dokumentu.
      pole: Array.from({ length: p }, (_, i) => ({
        i: i + 1,
        x: PAD.l + krok * (i + 0.5),
        plne: i < Math.min(nejdal, p),
      })),
      // Skutečné skupiny jako hejno pod osou: kde na cestě k prahu stojí.
      body: skupiny.length > 1
        ? skupiny.map((s) => ({ id: s.id, x: PAD.l + krok * (Math.min(s.count, p) - 0.5), hotovo: s.status !== "sber" }))
        : [],
      nejdal, hotove,
      dokX: konecX + 20, dokY: OSA_Y - 46, dokW: DOK_W - 34, dokH: 96,
    };
  }, [skupiny, prah]);

  const chybi = Math.max(0, art.p - art.nejdal);

  return (
    <section className="sc-hook pd-hook" style={hookTema("podnety")} aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /><i className="sc-blob b3" /></div>

      <div className="sc-hook-copy">
        <div className="eyebrow">Podněty občanů</div>
        <h1 id={`${uid}-t`}>{art.p} {plural(art.p, "hlášení", "hlášení", "hlášení")},<br />jeden podnět</h1>
        <p className="lead">
          Jedno hlášení je stížnost. {art.p} podobných ze stejné obce je doklad — KAM je spojí, přiloží
          k nim čísla z modelu a vznikne formální podnět pro krajský úřad.
        </p>
        <div className="sc-hook-legend">
          {art.nejdal > 0
            ? <span className="mute">nejdál je skupina s {num(art.nejdal)} {plural(art.nejdal, "hlášením", "hlášeními", "hlášeními")}{chybi > 0 ? ` — chybí ${chybi}` : ""}</span>
            : <span className="mute">zatím bez hlášení — první je vaše</span>}
          {art.hotove > 0 && <span className="mute">{num(art.hotove)} {plural(art.hotove, "skupina prošla prahem", "skupiny prošly prahem", "skupin prošlo prahem")}</span>}
        </div>
        {children}
      </div>

      <div className="sc-stage">
        <div className="sc-pane p3" />
        <div className="sc-pane p2" />
        <div className="sc-pane p1">
          <span className="sc-sheen" />
          <svg className="sc-art pd-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
            role="img" aria-label={`Z ${art.p} podobných hlášení vzniká jeden formální podnět; nejdál je skupina s ${art.nejdal} hlášeními`}>
            <defs>
              <linearGradient id={`${uid}p`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--h3)" stopOpacity="0.95" />
                <stop offset="100%" stopColor="var(--h1)" stopOpacity="0.8" />
              </linearGradient>
            </defs>

            <line className="pd-osa" x1={PAD.l} x2={art.konecX - 6} y1={OSA_Y} y2={OSA_Y} />

            {art.pole.map((p) => (
              <g key={p.i} className={p.plne ? "pd-pole je-plne" : "pd-pole"} style={{ ["--i" as string]: p.i }}>
                <circle cx={p.x} cy={OSA_Y} r={art.r} fill={p.plne ? `url(#${uid}p)` : "none"} />
                {p.plne && <path className="pd-fajfka" d={`M${p.x - art.r * 0.4},${OSA_Y} l${art.r * 0.3},${art.r * 0.32} l${art.r * 0.55},${-art.r * 0.62}`} />}
                <text className="pd-cislo" x={p.x} y={OSA_Y + art.r + 17} textAnchor="middle">{p.i}</text>
              </g>
            ))}

            {/* Hejno skutečných skupin pod osou — jen když je co ukazovat. */}
            {art.body.map((b, i) => (
              <circle key={b.id} className={b.hotovo ? "pd-skupina hotova" : "pd-skupina"}
                cx={b.x} cy={OSA_Y + art.r + 34 + (i % 3) * 9} r="3.2" style={{ ["--i" as string]: i % 24 }} />
            ))}

            {/* Práh a to, co za ním vzniká. */}
            <line className="pd-prah" x1={art.konecX} x2={art.konecX} y1={OSA_Y - 66} y2={OSA_Y + 66} />
            <text className="pd-popis" x={art.konecX - 8} y={OSA_Y - 74} textAnchor="end">práh</text>

            <g className={art.hotove > 0 ? "pd-dok je-hotovy" : "pd-dok"}>
              <rect x={art.dokX} y={art.dokY} width={art.dokW} height={art.dokH} rx="10" />
              <line className="pd-radek" x1={art.dokX + 14} x2={art.dokX + art.dokW - 34} y1={art.dokY + 24} y2={art.dokY + 24} />
              <line className="pd-radek" x1={art.dokX + 14} x2={art.dokX + art.dokW - 18} y1={art.dokY + 40} y2={art.dokY + 40} />
              <line className="pd-radek" x1={art.dokX + 14} x2={art.dokX + art.dokW - 26} y1={art.dokY + 52} y2={art.dokY + 52} />
              <line className="pd-radek" x1={art.dokX + 14} x2={art.dokX + art.dokW - 46} y1={art.dokY + 64} y2={art.dokY + 64} />
              <circle className="pd-razitko" cx={art.dokX + art.dokW - 22} cy={art.dokY + art.dokH - 20} r="12" />
              <path className="pd-fajfka velka" d={`M${art.dokX + art.dokW - 28},${art.dokY + art.dokH - 20} l4.4,4.6 l7.6,-8.6`} />
            </g>
            <text className="pd-popis pod" x={art.dokX + art.dokW / 2} y={art.dokY + art.dokH + 22} textAnchor="middle">podnět pro kraj</text>
          </svg>
          {hlaseni ? (
            <div className="sc-delta glass">
              <Icon name="message" size={14} />
              <strong>{num(hlaseni)}</strong>
              <span>{plural(hlaseni, "hlášení celkem", "hlášení celkem", "hlášení celkem")}</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
