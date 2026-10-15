// Za co území utrácí: výdaje po oddílech rozpočtové skladby (Výdaje.com, data MF ČR).
// Částka sama nic neříká, proto je u každé položky na obyvatele a vedle ní
// srovnání s mediánem obcí stejné velikosti. Žádné hodnocení lepší/horší:
// rozpočet neví, co se za peníze pořídilo.

import { useState } from "react";
import { BarList, Donut } from "./charts";
import { Card, InfoHint, KindTag, Segmented, Stat } from "./ui";
import { useApi } from "../lib/api";
import { num, signed } from "../lib/format";

interface Polozka {
  code: string; label: string; castka: number; podil: number | null; na_obyvatele: number | null;
  median_pasma: number | null; pomer: number | null; srovnani: "vice" | "mene" | "stejne" | "nelze"; zmena: number | null;
}
interface Ucet {
  available: boolean; reason?: string; territory: { id: string; name: string; level: string };
  rok: number; roky: number[]; obyvatele: number | null; celkem: number; na_obyvatele: number | null; zmena_celkem: number | null;
  pasmo: string | null; polozky: Polozka[]; druh: { code: string; label: string; castka: number; podil: number | null }[];
  dotace: { code: string; label: string; castka: number }[]; dotace_celkem: number | null; pozn: string;
}

function kc(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${num(v / 1e9, 2)} mld. Kč`;
  if (a >= 1e6) return `${num(v / 1e6, 1)} mil. Kč`;
  if (a >= 1e4) return `${num(Math.round(v / 1e3))} tis. Kč`;
  return `${num(Math.round(v))} Kč`;
}

const POPIS: Record<string, string> = { vice: "víc než srovnatelné obce", mene: "méně než srovnatelné obce", stejne: "jako srovnatelné obce" };

export function Vydaje({ tid }: { tid: string }) {
  const [rok, setRok] = useState<number | null>(null);
  const { data } = useApi<Ucet>(`/vydaje/${tid}${rok ? `?rok=${rok}` : ""}`);
  if (!data || !data.available) return null;
  const max = Math.max(1, ...data.polozky.map((p) => p.castka));
  const posledni = data.roky.slice(-5);

  return (
    <>
      <Card i={4} title="Za co utrácí" icon="coins" actions={<KindTag kind="FAKT" info={data.pozn} />}>
        <div className="vyd-hlava">
          <Segmented label="Rok" value={String(data.rok)} onChange={(v) => setRok(Number(v))} options={posledni.map((y) => ({ value: String(y), label: String(y) }))} />
        </div>
        <div className="stats-row" style={{ marginBottom: 16 }}>
          <Stat i={0} label={`Výdaje ${data.rok}`} value={kc(data.celkem)} sub={data.zmena_celkem !== null ? `${signed(data.zmena_celkem * 100, 1, " %")} oproti předchozímu roku` : ""} />
          <Stat i={1} label="Na obyvatele" value={data.na_obyvatele !== null ? `${num(Math.round(data.na_obyvatele))} Kč` : "—"} sub={data.obyvatele ? `${num(data.obyvatele)} obyvatel` : ""} />
          {data.dotace_celkem !== null && <Stat i={2} label="Přijaté dotace" value={kc(data.dotace_celkem)} sub="stát, kraj, fondy, EU" />}
        </div>
        <div className="vyd-tabulka" role="table" aria-label="Výdaje podle oblastí">
          <div className="vyd-radek vyd-hlavicka" role="row">
            <span role="columnheader">Oblast</span><span role="columnheader" className="r">Částka</span>
            <span role="columnheader" className="r vyd-skryt">Na obyvatele</span>
            <span role="columnheader" className="vyd-skryt">{data.pasmo ? `Proti obcím ${data.pasmo}` : ""}</span>
          </div>
          {data.polozky.map((p) => (
            <div className="vyd-radek" role="row" key={p.code}>
              <span className="vyd-nazev" role="cell">
                <strong>{p.label}</strong>
                <span className="vyd-pruh" aria-hidden="true"><i style={{ width: `${(p.castka / max) * 100}%` }} /></span>
              </span>
              <span className="r num" role="cell">{kc(p.castka)}{p.podil !== null && <small className="mute"> · {num(p.podil * 100, 0)} %</small>}</span>
              <span className="r num vyd-skryt" role="cell">{p.na_obyvatele !== null ? `${num(Math.round(p.na_obyvatele))} Kč` : "—"}</span>
              <span className="vyd-skryt" role="cell">
                {p.srovnani !== "nelze" && p.pomer !== null
                  ? <span className={`vyd-srovnani is-${p.srovnani}`} title={p.median_pasma ? `Medián srovnatelných obcí: ${num(Math.round(p.median_pasma))} Kč na obyvatele` : undefined}>
                      {p.srovnani === "stejne" ? POPIS.stejne : `${num(p.pomer, 1)}× ${POPIS[p.srovnani]}`}
                    </span>
                  : <span className="mute small">—</span>}
              </span>
            </div>
          ))}
        </div>
        <p className="xsmall mute" style={{ marginTop: 12 }}>Zdroj: <a href="https://vydaje.com" target="_blank" rel="noreferrer">Výdaje.com</a> (zpracování dat MF ČR, MONITOR státní pokladny, výkaz FIN 2-12 M).</p>
      </Card>

      <div className="grid">
        <Card span={6} i={5} title="Na co se peníze vydávají" icon="chart" actions={<InfoHint label="Druh výdaje">Totéž, co v tabulce výše, jen jinak rozdělené: ne podle oblasti, ale podle toho, na co se peníze platí (platy, nákupy, investice).</InfoHint>}>
          <Donut ariaLabel={`Výdaje ${data.rok} podle druhu`} size={220} caption={kc(data.celkem)}
            parts={data.druh.map((d) => ({ label: d.label, value: d.castka }))} />
        </Card>
        {data.dotace.length > 0 && (
          <Card span={6} i={6} title="Odkud přišly dotace" icon="coins" actions={<InfoHint label="Zdroje dotací">Dotace, které obec v daném roce přijala, podle toho, kdo je poslal. Neříká to, na co byly určené.</InfoHint>}>
            <BarList items={data.dotace.map((d) => ({ key: d.code, label: d.label, value: d.castka }))} format={kc} />
          </Card>
        )}
      </div>
    </>
  );
}
