// Dotace: kolik do území doteklo, jak si v tom stojí a kam se obrátit.
//
// Stránka nemíchá jistoty. Nahoře jsou tvrdá čísla z rozpočtů a z dat kraje,
// dole rozcestník vyhlašovatelů — a u něj je napsané, že to není seznam
// otevřených výzev a že nárok posuzuje vyhlašovatel. Strojově čitelný registr
// výzev pro obce v Česku neexistuje; předstírat opak by starostovi uškodilo víc,
// než když mu rovnou ukážeme, kde se dívat.

import { BarList, ChartSwitch, LineChart } from "../components/charts";
import { DotaceHook } from "../components/DotaceHook";
import { Icon } from "../components/Icon";
import { TerritoryPicker } from "../components/TerritoryPicker";
import { Card, ErrorBox, InfoHint, KindTag, Stat } from "../components/ui";
import { useApi } from "../lib/api";
import { num } from "../lib/format";
import { Link, setQuery, useLocation } from "../lib/router";

interface Rok { year: number; castka: number; na_obyvatele: number | null }
interface Kraj {
  uzemi: { id: string; name: string; level: string };
  programove: number | null; programove_pocet: number | null;
  individualni: number | null; individualni_pocet: number | null;
  celkem: number; obdobi: string; na_obyvatele: number | null; poradi: number | null; z_celkem: number;
  median_na_obyvatele: number | null;
  zebricek: { id: string; name: string; na_obyvatele: number }[];
  vyssi_celek?: string;
}
interface Zdroj { nazev: string; kdo: string; url: string; pozn: string; oblasti: string[]; kvuli: string[] }
interface Data {
  territory: { id: string; name: string; level: string };
  cerpani: Rok[]; cerpani_celkem: number; cerpani_roky: [number, number] | null;
  kraj: Kraj | null; rizikove_oblasti: string[];
  zdroje: Zdroj[]; dalsi_zdroje: Zdroj[]; zdroj_dat: string; poznamka: string;
}

function kc(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${num(v / 1e9, 2)} mld. Kč`;
  if (a >= 1e6) return `${num(v / 1e6, 1)} mil. Kč`;
  if (a >= 1e4) return `${num(Math.round(v / 1e3))} tis. Kč`;
  return `${num(v)} Kč`;
}

function ZdrojKarta({ z }: { z: Zdroj }) {
  return (
    <a className="zdroj-karta" href={z.url} target="_blank" rel="noopener noreferrer">
      <span className="zk-head">
        <strong>{z.nazev}</strong>
        <Icon name="external" size={15} />
      </span>
      <span className="zk-kdo">{z.kdo}</span>
      <span className="zk-pozn">{z.pozn}</span>
      <span className="zk-tagy">
        {z.kvuli.length > 0
          ? z.kvuli.map((o) => <span className="chip chip-accent" key={o}>{o}</span>)
          : z.oblasti.slice(0, 3).map((o) => <span className="chip" key={o}>{o}</span>)}
      </span>
    </a>
  );
}

export function Dotace() {
  const { query } = useLocation();
  const tid = query.get("t") ?? "kraj:86";
  const { data, error, reload } = useApi<Data>(`/dotace/${tid}`);
  const rada = data?.cerpani ?? [];
  const k = data?.kraj ?? null;
  const posledni = rada[rada.length - 1];

  return (
    <>
      <DotaceHook cerpani={rada} territory={data?.territory.name}>
        <div className="row" style={{ marginTop: 18 }}>
          <Link className="btn" to={`/hospodareni?t=${tid}`}><Icon name="coins" size={16} /> Zobrazit hospodaření</Link>
        </div>
      </DotaceHook>
      <div className="stack-y">
        <div className="toolbar-card reveal">
          <div className="toolbar-picker"><TerritoryPicker value={tid} onChange={(id) => setQuery({ t: id })} label="Území" /></div>
        </div>
        <ErrorBox error={error} retry={reload} />

        {data && (
          <>
            <div className="stats-row">
              <Stat i={0} label={data.cerpani_roky ? `Přijaté dotace ${data.cerpani_roky[0]}–${data.cerpani_roky[1]}` : "Přijaté dotace"}
                value={kc(data.cerpani_celkem)} sub="FAKT · z rozpočtu území" />
              <Stat i={1} label={`Dotace na obyvatele ${posledni?.year ?? ""}`} value={posledni?.na_obyvatele !== null && posledni ? `${num(posledni.na_obyvatele)} Kč` : "—"} />
              <Stat i={2} label={k ? `Dotace od kraje · ${k.uzemi.name}` : "Dotace od kraje"} value={k ? kc(k.celkem) : "—"} sub={k?.obdobi ?? ""} />
              <Stat i={3} label={k?.vyssi_celek ? "Nejvíc na obyvatele" : "Pořadí v kraji (na obyvatele)"}
                value={k?.vyssi_celek ? (k.zebricek?.[0]?.name ?? "—") : k?.poradi ? `${k.poradi}. z ${k.z_celkem}` : "—"}
                sub={k?.vyssi_celek ? (k.zebricek?.[0] ? `${num(k.zebricek[0].na_obyvatele)} Kč/obyv. · medián ORP ${num(k.median_na_obyvatele ?? 0)} Kč` : "") : k?.median_na_obyvatele ? `medián ${num(k.median_na_obyvatele)} Kč/obyv.` : ""}
                tone={k?.poradi && k.poradi > k.z_celkem / 2 ? "warn" : undefined} />
            </div>

            <Card i={1} title="Dotace po letech a srovnání v kraji" icon="chart">
              <div className="row" style={{ marginBottom: 10 }}><KindTag kind="FAKT" puvod={{ kody: ["200302", "dot_prog_castka", "dot_indiv_castka"] }} info={`Zdroj: ${data.zdroj_dat}.`} zdroj={[{ nazev: "ČSÚ – Městská a obecní statistika", url: "https://csu.gov.cz/produkty/databaze-mos-otevrena-data" }, { nazev: "Data KHK – portál Královéhradeckého kraje", url: "https://www.datakhk.cz/" }]} /></div>
              <ChartSwitch id="dotace" views={[
                {
                  key: "rok", label: "Přijaté dotace po letech", icon: "trend-up", render: () => (
                    <LineChart ariaLabel="Přijaté dotace po letech" height={270} format={(v) => kc(v)}
                      series={[{ key: "d", label: "Přijaté dotace", color: "var(--accent)", points: rada.map((r) => ({ year: r.year, value: r.castka })) }]} />
                  ),
                },
                ...(rada.some((r) => r.na_obyvatele !== null) ? [{
                  key: "obyv", label: "Na obyvatele", icon: "users", render: () => (
                    <LineChart ariaLabel="Přijaté dotace na obyvatele" height={270} format={(v) => `${num(v)} Kč`}
                      series={[{ key: "o", label: "Na obyvatele", color: "var(--info)", points: rada.filter((r) => r.na_obyvatele !== null).map((r) => ({ year: r.year, value: r.na_obyvatele as number })) }]} />
                  ),
                }] : []),
                ...(k && k.zebricek.length > 1 ? [{
                  key: "zebricek", label: `Dotace kraje podle ${k.uzemi.level === "orp" ? "ORP" : "okresů"}`, icon: "chart", render: () => (
                    <>
                      <BarList format={(v) => `${num(v)} Kč/obyv.`}
                        items={k.zebricek.map((r) => ({
                          key: r.id, value: r.na_obyvatele,
                          label: r.id === k.uzemi.id ? <strong>{r.name}</strong> : r.name,
                        }))} />
                      <p className="xsmall mute" style={{ marginTop: 10 }}>
                        Všechny dotace kraje na jednoho obyvatele. Vysoké číslo může být jedna velká akce,
                        ne trvale štědřejší kraj. Nárok na dotaci z toho neplyne.
                      </p>
                    </>
                  ),
                }] : []),
              ]} />
            </Card>

            {k?.vyssi_celek && k.zebricek && k.zebricek.length > 0 && (
              <Card i={2} title="Dotace od kraje podle ORP (na obyvatele)" icon="chart"
                actions={<InfoHint label="Jak číst pořadí">Součet dotací, které kraj poslal do jednotlivých ORP v letech {k.obdobi}, dělený počtem obyvatel ORP. Na obyvatele proto, že v absolutních číslech vyhraje vždy největší ORP.</InfoHint>}>
                <BarList items={k.zebricek.map((z) => ({ key: z.id, label: z.name, value: z.na_obyvatele }))} format={(v) => `${num(v)} Kč`} />
              </Card>
            )}

            {k && (
              <Card i={2} title={`Dotace od kraje podle druhu · ${k.uzemi.name}`} icon="coins">
                <div className="facts-list">
                  <div className="fact-row"><span>Programové dotace (z vyhlášeného programu)</span>
                    <span className="num">{kc(k.programove)}{k.programove_pocet ? <span className="mute"> · {num(k.programove_pocet)} dotací</span> : null}</span></div>
                  <div className="fact-row"><span>Individuální dotace (žádost mimo program)</span>
                    <span className="num">{kc(k.individualni)}{k.individualni_pocet ? <span className="mute"> · {num(k.individualni_pocet)} dotací</span> : null}</span></div>
                  <div className="fact-row"><span>Celkem na obyvatele</span>
                    <span className="num">{k.na_obyvatele !== null ? `${num(k.na_obyvatele)} Kč` : "—"}
                      {k.median_na_obyvatele !== null && <span className="mute"> · medián {num(k.median_na_obyvatele)} Kč</span>}</span></div>
                </div>
              </Card>
            )}

            <Card i={3} title="Kdo dotace vyhlašuje" icon="external">
              {data.rizikove_oblasti.length > 0 ? (
                <p className="muted small">Model vidí problém v oblastech{" "}
                  <strong>{data.rizikove_oblasti.join(", ")}</strong>. Tito vyhlašovatelé na ně dávají peníze.</p>
              ) : (
                <p className="muted small">Model tu nenašel výrazné riziko, proto ukazujeme všechny vyhlašovatele.</p>
              )}
              <div className="zdroje-grid" style={{ marginTop: 12 }}>
                {data.zdroje.map((z) => <ZdrojKarta key={z.url} z={z} />)}
              </div>
              {data.dalsi_zdroje.length > 0 && (
                <details className="dalsi-zdroje">
                  <summary>Další vyhlašovatelé ({data.dalsi_zdroje.length})</summary>
                  <div className="zdroje-grid" style={{ marginTop: 12 }}>
                    {data.dalsi_zdroje.map((z) => <ZdrojKarta key={z.url} z={z} />)}
                  </div>
                </details>
              )}
              <p className="xsmall mute" style={{ marginTop: 14 }}>{data.poznamka}</p>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
