// Otevření přehledu: kde se kraj rozešel.
//
// Předchozí verze kreslila hřebeny — každou řadu na vlastní výšku. Vypadalo to
// dobře a neříkalo to nic: dva tvary vedle sebe, které nemají společné měřítko,
// se porovnat nedají, a čáry tak nedávaly smysl.
//
// Tohle je totéž z jednoho úhlu. Každá řada se přepočte na index: první rok,
// ve kterém má údaj, je 100. Dál už nezáleží na velikosti čísla, ale na tom,
// jak daleko se od svého startu dostala — a tím se dá počet obyvatel porovnat
// s nezaměstnaností, aniž by kterýkoli z nich přitiskl ten druhý k nule.
//
// Vodorovná linka na stu je společná osa, pásmo mezi krajními řadami je to,
// jak moc se kraj rozešel, a řada, která začíná později, se od linky odpojí
// později. Neúplnost dat je součást odpovědi.

import { useId, useMemo } from "react";
import { NadpisHooku } from "./hook-nadpis";
import { hookVstup } from "./hook-tema";
import { Icon } from "./Icon";
import { num } from "../lib/format";

export interface KpiRada { key: string; label: string; unit: string; series: { year: number; value: number }[] }

const W = 640, H = 262;
const PAD = { l: 30, r: 72, t: 26, b: 30 };
const MAX_RAD = 5;
/** Nejmenší půlrozsah osy v bodech indexu. Kraj, který se za dvacet let
 *  pohnul o dvě procenta, nesmí vypadat jako kraj v rozkladu. */
const MIN_ROZSAH = 9;

export function PrehledHook({ kpis, pozorovani, children }: {
  kpis: KpiRada[]; pozorovani?: number; children?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const art = useMemo(() => {
    const rady = kpis.filter((k) => k.series.length >= 4 && k.series[0].value).slice(0, MAX_RAD);
    if (rady.length < 2) return null;

    const roky = rady.flatMap((r) => r.series.map((p) => p.year));
    const x0 = Math.min(...roky), x1 = Math.max(...roky);
    const X = (y: number) => PAD.l + ((y - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);

    // Index k vlastnímu prvnímu údaji. Dělí se hodnotou, ne rozdílem: řada
    // v procentech i řada v desítkách tisíc tak mluví stejnou řečí.
    const krivky = rady.map((r) => {
      const zaklad = r.series[0].value;
      const body = r.series.map((p) => ({ year: p.year, idx: (p.value / zaklad) * 100 }));
      const konec = body[body.length - 1];
      return { key: r.key, label: r.label, unit: r.unit, od: r.series[0].year, do: konec.year, body, zmena: konec.idx - 100 };
    });

    const vsechny = krivky.flatMap((k) => k.body.map((b) => b.idx));
    const pul = Math.max(MIN_ROZSAH, ...vsechny.map((v) => Math.abs(v - 100))) * 1.14;
    const Y = (idx: number) => PAD.t + (1 - (idx - (100 - pul)) / (2 * pul)) * (H - PAD.t - PAD.b);

    const cesta = (body: { year: number; idx: number }[]) =>
      body.map((b, i) => `${i ? "L" : "M"}${X(b.year).toFixed(1)},${Y(b.idx).toFixed(1)}`).join("");

    // Pásmo rozestupu: mezi nejvýš a nejníž ležící řadou v každém roce. Roky,
    // kde měří jen jedna řada, do pásma nepatří — nebylo by co rozestupovat.
    const horni: string[] = [], dolni: string[] = [];
    for (let y = x0; y <= x1; y++) {
      const v = krivky.map((k) => k.body.find((b) => b.year === y)?.idx).filter((n): n is number => n !== undefined);
      if (v.length < 2) continue;
      horni.push(`${X(y).toFixed(1)},${Y(Math.max(...v)).toFixed(1)}`);
      dolni.push(`${X(y).toFixed(1)},${Y(Math.min(...v)).toFixed(1)}`);
    }
    const pasmo = horni.length > 1 ? `M${horni.join("L")}L${dolni.reverse().join("L")}Z` : "";

    const nejvic = krivky.reduce((a, b) => (Math.abs(b.zmena) > Math.abs(a.zmena) ? b : a));
    const rozpeti = Math.max(...krivky.map((k) => k.zmena)) - Math.min(...krivky.map((k) => k.zmena));

    return {
      krivky: krivky.map((k) => ({
        ...k,
        cara: cesta(k.body),
        zacX: X(k.od), zacY: Y(100),
        konX: X(k.do), konY: Y(k.body[k.body.length - 1].idx),
        // Kdo se pohnul víc, je sytější. Je to jediné pořadí, které z obrázku
        // jde přečíst, aniž by se tvrdilo, jestli je pohyb dobrý, nebo špatný.
        sila: 0.4 + (Math.abs(k.zmena) / Math.max(1, Math.abs(nejvic.zmena))) * 0.6,
        hlavni: k.key === nejvic.key,
      })),
      pasmo, x0, x1, rozsah: x1 - x0 + 1, sto: Y(100), nejvic, rozpeti,
      levy: PAD.l, pravy: W - PAD.r,
    };
  }, [kpis]);

  const zmena = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(v >= 10 || v <= -10 ? 0 : 1)} %`;

  return (
    <section className="sc-hook ph-hook" {...hookVstup("prehled")} aria-labelledby={`${uid}-t`}>
      <div className="sc-blobs" aria-hidden="true"><i className="sc-blob b1" /><i className="sc-blob b2" /><i className="sc-blob b3" /></div>

      <div className="sc-hook-copy">
        <NadpisHooku id={`${uid}-t`}>{art ? <>Kde se kraj<br />rozešel</> : <>Co se v kraji děje</>}</NadpisHooku>
        <p className="lead">
          Každá řada začíná na stu v roce, kdy má první údaj. Dál nezáleží na velikosti čísla, ale na
          tom, jak daleko se od svého startu dostala — proto jde počet obyvatel porovnat
          s nezaměstnaností a je vidět, co se rozchází nejrychleji.
        </p>
        {art && (
          <ul className="ph-radky">
            {art.krivky.map((k) => (
              <li key={k.key} className={k.hlavni ? "je-hlavni" : ""}>
                <i style={{ opacity: k.sila }} />
                <span className="ph-jmeno">{k.label}</span>
                <span className="mute">{k.od}</span>
                <span className={`ph-zmena ${k.zmena > 0 ? "je-nahoru" : k.zmena < 0 ? "je-dolu" : ""}`}>{zmena(k.zmena)}</span>
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
            role="img" aria-label={art ? `Vývoj ${art.krivky.length} ukazatelů kraje jako index od roku prvního údaje, ${art.x0} až ${art.x1}` : "Zatím bez dat"}>
            <defs>
              <linearGradient id={`${uid}p`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--h1)" stopOpacity="0.20" />
                <stop offset="50%" stopColor="var(--h1)" stopOpacity="0.07" />
                <stop offset="100%" stopColor="var(--h3)" stopOpacity="0.20" />
              </linearGradient>
            </defs>

            {art && (
              <>
                {art.pasmo && <path className="ph-pasmo" d={art.pasmo} fill={`url(#${uid}p)`} />}

                {/* Společná osa. Bez ní je index jen další čára bez ukotvení. */}
                <line className="ph-sto" x1={art.levy} x2={art.pravy} y1={art.sto} y2={art.sto} />
                <text className="ph-stovka" x={art.pravy + 6} y={art.sto + 3.5}>100</text>

                {art.krivky.map((k, i) => (
                  <g className={`ph-krivka ${k.hlavni ? "je-hlavni" : ""}`} key={k.key} style={{ ["--i" as string]: i, opacity: k.sila }}>
                    <path className="ph-cara" d={k.cara} pathLength={1000} />
                    <circle className="ph-start" cx={k.zacX} cy={k.zacY} r="2.6" />
                    <circle className="ph-bod" cx={k.konX} cy={k.konY} r="3.6" />
                  </g>
                ))}

                {/* Popisek jen u té nejrychlejší: pět štítků vedle sebe je změť. */}
                {art.krivky.filter((k) => k.hlavni).map((k) => (
                  <text key={k.key} className="ph-popisek" x={k.konX - 8} y={k.konY - 10} textAnchor="end">{zmena(k.zmena)}</text>
                ))}

                <text className="sc-yr" x={art.levy} y={H - 9}>{art.x0}</text>
              </>
            )}
          </svg>
          {art ? (
            <div className="sc-delta glass">
              <Icon name="split" size={14} />
              <strong>{art.rozpeti.toFixed(0)} b.</strong>
              <span>mezi nejrychlejším a nejpomalejším{pozorovani ? ` · ${num(pozorovani)} hodnot` : ""}</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
