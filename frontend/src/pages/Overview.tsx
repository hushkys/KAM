import { useState, type CSSProperties } from "react";
import { ChartSwitch, Donut, LineChart, Legend, Sparkline, Waterfall } from "../components/charts";
import { Icon } from "../components/Icon";
import { KhkMap, MapLegend } from "../components/maps";
import { PrehledHook } from "../components/PrehledHook";
import { Card, ErrorBox, InfoHint, KindTag, LoadingCard, Segmented, Severity } from "../components/ui";
import { useApi } from "../lib/api";
import { date, num, signed, withUnit } from "../lib/format";
import { Link, navigate } from "../lib/router";
import type { Forecast, Overview as OverviewT } from "../lib/types";
import { Erb } from "../components/Erb";

interface MapData { indicator: { code: string; name: string; unit: string; polarity: number }; year: number; values: Record<string, number>; breaks: number[]; reference: number | null }
interface Puls { datasets: { title: string; url: string; date: string; publisher: string; pillar: string }[]; events: { kind: string; title: string; starts: string; ends: string; url: string; published: string }[] }
interface Gaps { coverage: { health: number }; alerts: { level: string; title: string; text: string }[] }

const MAP_OPTS = [
  { value: "d_podil_65", label: "Senioři 65+" },
  { value: "d_migrace", label: "Migrace" },
  { value: "d_pl_10k", label: "Lékaři" },
  { value: "500020", label: "Nezaměstnanost" },
];

const ZDROJ_KPI: Record<string, string> = {
  pop: "Český statistický úřad, Městská a obecní statistika",
  s65: "Český statistický úřad, Městská a obecní statistika",
  un: "Úřad práce ČR (MPSV), přes Městskou a obecní statistiku ČSÚ",
  byty: "Český statistický úřad, Městská a obecní statistika",
};

export function Overview() {
  const ov = useApi<OverviewT>("/overview");
  const fc = useApi<Forecast>("/forecast/kraj:86");
  const puls = useApi<Puls>("/puls");
  const gaps = useApi<Gaps>("/gaps");
  const [ind, setInd] = useState("d_podil_65");
  const map = useApi<MapData>(`/map/khk?indicator=${ind}&level=obec`);
  const d = ov.data;
  return (
    <>
      <PrehledHook kpis={d?.kpis ?? []} pozorovani={d?.model.observations}>
        <div className="row" style={{ marginTop: 20 }}>
          <Link className="btn" to="/mapa"><Icon name="map" size={16} /> Otevřít mapu</Link>
          <Link className="btn btn-primary" to="/scenare"><Icon name="split" size={16} /> Sestavit scénář</Link>
        </div>
      </PrehledHook>
      <ErrorBox error={ov.error} retry={ov.reload} />

      <div className="stats-row" style={{ marginBottom: "var(--gap)" }}>
        {(d?.kpis ?? Array.from({ length: 4 }, () => null)).map((k, i) => k ? (
          <div className="kpi reveal" key={k.key} style={{ "--i": i } as CSSProperties}>
            <div className="kpi-top"><span className="kpi-label">{k.label}</span>
              <KindTag kind="FAKT" info={<>Skutečná zveřejněná hodnota za rok {k.year}, ne odhad modelu. Zdroj: {ZDROJ_KPI[k.key] ?? "Český statistický úřad"}. Čára ukazuje vývoj{k.since ? ` od roku ${k.since}` : ""}.</>} /></div>
            <span className="kpi-value">{withUnit(k.value, k.unit)}</span>
            <span className="kpi-sub">{k.change !== null ? `${signed(k.change, 2, k.unit === "%" ? " p. b." : " %")} od ${k.since}` : "za rok"} · {k.year}</span>
            <Sparkline points={k.series} ariaLabel={`Vývoj: ${k.label}`} />
          </div>
        ) : <div className="kpi" key={i}><span className="skeleton" style={{ height: 80 }} /></div>)}
      </div>

      <div className="grid">
        {/* Dva nezávislé sloupce, ne řady karet. V řadě se karta s jedním
            rizikem natahovala na výšku pulsu s patnácti řádky a pod textem
            měla prázdný rámeček; ve sloupci roste každá podle obsahu. */}
        <div className="span-7 stack-y">
          <Card i={1} title="Mapa obcí" icon="map" actions={<Segmented size="sm" label="Ukazatel mapy" value={ind} onChange={setInd} options={MAP_OPTS} />}>
            {map.data ? (
              <>
                <KhkMap level="obec" values={map.data.values} breaks={map.data.breaks} polarity={map.data.indicator.polarity} label={map.data.indicator.name}
                  format={(v) => (v === null ? "bez dat" : withUnit(v, map.data!.indicator.unit))} onSelect={(id) => navigate(`/obce/${id}`)} />
                <div className="row-between">
                  <MapLegend breaks={map.data.breaks} polarity={map.data.indicator.polarity} unit={map.data.indicator.unit} />
                  <span className="xsmall mute">{map.data.indicator.name} · {map.data.year} · celý kraj {withUnit(map.data.reference, map.data.indicator.unit)}</span>
                </div>
              </>
            ) : <span className="skeleton" style={{ width: "100%", aspectRatio: "1000/760" }} />}
          </Card>
          <Card i={3} title="Výhled počtu obyvatel" icon="trend-up" actions={<><KindTag kind="MODEL" info="Odhad modelu z vývoje porodnosti, úmrtnosti a stěhování (kohortně-komponentní metoda). Není to zveřejněný údaj, ale výpočet z něj." /><Link to="/vyhled" className="btn btn-quiet btn-sm">Celý výhled</Link></>}>
            {fc.data?.available ? (
              <ChartSwitch id="prehled-vyhled" views={[
                {
                  key: "vyvoj", label: "Vývoj a varianty", icon: "trend-up", render: () => (
                    <>
                      <LineChart ariaLabel="Počet obyvatel kraje: skutečnost a výhled" height={230} nowYear={fc.data!.base_year}
                        series={[
                          { key: "h", label: "Skutečnost", color: "var(--text)", points: fc.data!.history.map((r) => ({ year: r.year, value: r.population })) },
                          { key: "p", label: "Pravděpodobný", color: "var(--accent)", points: [{ year: fc.data!.base_year, value: fc.data!.base_population }, ...fc.data!.scenarios.pravdepodobny.map((r) => ({ year: r.year, value: r.population }))], band: fc.data!.scenarios.pravdepodobny.map((r) => ({ year: r.year, lo: r.lower, hi: r.upper })) },
                          { key: "o", label: "Optimistický", color: "var(--info)", dashed: true, points: fc.data!.scenarios.optimisticky.map((r) => ({ year: r.year, value: r.population })) },
                          { key: "r", label: "Rizikový", color: "var(--warn)", dashed: true, points: fc.data!.scenarios.rizikovy.map((r) => ({ year: r.year, value: r.population })) },
                        ]} />
                      <Legend items={[{ label: "Skutečnost (ČSÚ)", color: "var(--text)" }, { label: "Pravděpodobný (90% pásmo)", color: "var(--accent)" }, { label: "Optimistický", color: "var(--info)", dashed: true }, { label: "Rizikový", color: "var(--warn)", dashed: true }]} />
                    </>
                  ),
                },
                {
                  // Proč kraj ubývá: tři složky, které se sčítají do rozdílu.
                  key: "slozeni", label: "Z čeho se změna skládá", icon: "split", render: () => {
                    const s = fc.data!.scenarios.pravdepodobny;
                    const sum = (k: "births" | "deaths" | "migration") => Math.round(s.reduce((a, r) => a + (r[k] ?? 0), 0));
                    return (
                      <Waterfall ariaLabel="Z čeho se skládá změna počtu obyvatel kraje" height={230} steps={[
                        { label: String(fc.data!.base_year), value: Math.round(fc.data!.base_population), total: true },
                        { label: "narození", value: sum("births") },
                        { label: "zemřelí", value: -sum("deaths") },
                        { label: "migrace", value: sum("migration") },
                        { label: String(s[s.length - 1].year), value: Math.round(s[s.length - 1].population), total: true },
                      ]} />
                    );
                  },
                },
                ...(() => {
                  const last = fc.data!.scenarios.pravdepodobny[fc.data!.scenarios.pravdepodobny.length - 1];
                  return last?.age_0_14 && last?.age_65 ? [{
                    key: "struktura", label: `Věková struktura ${last.year}`, icon: "users", render: () => (
                      <Donut ariaLabel={`Věková struktura kraje v roce ${last.year}`} caption={`obyvatel ${last.year}`} size={168} parts={[
                        { label: "Děti 0–14", value: Math.round(last.age_0_14!), color: "var(--info)" },
                        { label: "15–64 let", value: Math.round(last.population - last.age_0_14! - last.age_65!), color: "var(--accent)" },
                        { label: "Senioři 65+", value: Math.round(last.age_65!), color: "var(--warn)" },
                      ]} />
                    ),
                  }] : [];
                })(),
              ]} />
            ) : <span className="skeleton" style={{ height: 230, width: "100%" }} />}
            {d?.outlook.milestones && (
              <div className="milestones">
                {d.outlook.milestones.map((m) => (
                  <div className="milestone" key={m.year}>
                    <div className="y">{m.year}</div>
                    <div className="v">{num(m.population)}</div>
                    <div className="r">{num(m.lower)}–{num(m.upper)} · {signed(m.change_pct, 1, " %")}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card i={4} title="Nová data a omezení dopravy" icon="refresh" >
            {!puls.data && <LoadingCard lines={4} />}
            {puls.data?.datasets.slice(0, 6).map((p) => (
              <div className="puls-item" key={p.url + p.title} data-ctx="dataset" data-ctx-label={p.title} data-ctx-url={p.url}>
                <span className="puls-icon"><Icon name="database" size={15} /></span>
                <a className="puls-title" href={p.url} target="_blank" rel="noopener noreferrer">{p.title}</a>
                <span className="puls-sub">Nová data · {p.publisher} · {p.pillar} · {date(p.date)}</span>
              </div>
            ))}
            {puls.data?.events.slice(0, 3).map((e) => (
              <div className="puls-item" key={e.title}>
                <span className="puls-icon"><Icon name="bus" size={15} /></span>
                <a className="puls-title" href={e.url} target="_blank" rel="noopener noreferrer">{e.title}</a>
                <span className="puls-sub">Omezení dopravy {e.starts} – {e.ends} · zveřejněno {date(e.published)}</span>
              </div>
            ))}
          </Card>
        </div>
        <div className="span-5 stack-y">
          <Card i={2} title="Obce, které potřebují pozornost" icon="alert" actions={<><InfoHint label="Co je riziko">Riziko hlásí pevné pravidlo nad zveřejněnými daty: nepříznivý dlouhodobý trend, opakující se problém nebo stav, který překročil stanovený práh či je výrazně horší než v kraji. Není to odhad ani názor. U malých obcí a krátkých řad je důvěra nižší, protože pár lidí tam pohne jakýmkoli podílem.</InfoHint><Link to="/obce" className="btn btn-quiet btn-sm">Všechny obce</Link></>}>
            {!d && <LoadingCard lines={5} />}
            {d?.risks.map((r) => (
              <Link key={r.territory.id} to={`/obce/${r.territory.id}`} className="risk-row" data-ctx={r.territory.id} data-ctx-label={r.territory.name}>
                <Erb id={r.territory.id} name={r.territory.name} size={30} />
                <span className="risk-title">{r.territory.name} · {r.top.title}</span>
                <Severity level={r.top.level} label={r.top.level_label} />
                <span className="risk-text">{r.top.text}</span>
              </Link>
            ))}
          </Card>
          <Card i={5} title="Rizika kraje jako celku" icon="shield">
            {d?.kraj_risks.length === 0 && <p className="muted small">Za kraj jako celek pravidla nenašla významné riziko.</p>}
            {d?.kraj_risks.map((r) => (
              <div className="risk-card" key={r.id}>
                <div className="rc-head"><span className="rc-title">{r.title}</span><Severity level={r.level} label={r.level_label} /></div>
                <p>{r.text}</p>
              </div>
            ))}
          </Card>
          <Card i={6} title="Data v modelu" icon="database" actions={<Link to="/data" className="btn btn-quiet btn-sm">Katalog dat</Link>}>
            {d && (
              <div className="facts-list">
                <div className="fact-row"><span>Sady se souborem s daty</span><span className="num">{num(d.datasets.verified)}</span></div>
                <div className="fact-row"><span>Poskytovatelé dat</span><span className="num">{num(d.datasets.publishers)}</span></div>
                <div className="fact-row"><span>Webové stránky, mrtvé a chybějící odkazy (nezapočteno)</span><span className="num">{num(d.datasets.broken + d.datasets.no_link + d.datasets.pages)}</span></div>
                <div className="fact-row"><span>Sady, jejichž hodnoty model načetl</span><span className="num">{num(d.datasets.loaded)}</span></div>
                <div className="fact-row"><span>Ukazatele</span><span className="num">{num(d.model.indicators)}</span></div>
              </div>
            )}
          </Card>
          <Card i={7} title="Chybějící data" icon="gauge" actions={<Link to="/data?tab=potreby" className="btn btn-quiet btn-sm">Zobrazit vše</Link>}>
            {gaps.data && (
              <>
                <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
                  <span className="kpi-value">{gaps.data.coverage.health} %</span><span className="muted small">pokrytí dat v ORP</span>
                </div>
                <div className="section-gap" />
                {gaps.data.alerts.slice(0, 3).map((a) => (
                  <div className="risk-card" key={a.title}>
                    <div className="rc-head"><span className="rc-title small">{a.title}</span><Severity level={a.level} /></div>
                  </div>
                ))}
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
