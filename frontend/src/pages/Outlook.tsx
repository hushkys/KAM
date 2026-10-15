// Výhled: one column of content, full width. The territory and the metric
// sit in a toolbar above the chart instead of a side column that left an
// empty strip next to everything below it.

import { useState, type CSSProperties } from "react";
import { ChartSwitch, Donut, Heatmap, LineChart, Legend, ShareBar, Waterfall } from "../components/charts";
import { Icon } from "../components/Icon";
import { TerritoryPicker, useTerritories } from "../components/TerritoryPicker";
import { VyhledHook } from "../components/VyhledHook";
import { Card, ErrorBox, InfoHint, KindTag, Segmented, Stat } from "../components/ui";
import { useApi } from "../lib/api";
import { num, pct, signed } from "../lib/format";
import { Link, setQuery, useLocation } from "../lib/router";
import type { Forecast } from "../lib/types";

type Metric = "population" | "age_65" | "age_0_14";

export function Outlook() {
  const { query } = useLocation();
  const tid = query.get("t") ?? "kraj:86";
  const { data, error, reload } = useApi<Forecast>(`/forecast/${tid}`);
  const [metric, setMetric] = useState<Metric>("population");
  const nazev = useTerritories().data?.find((t) => t.id === tid)?.name;
  const label = { population: "Obyvatelé", age_65: "Senioři 65+", age_0_14: "Děti 0–14" }[metric];
  const ok = data?.available ? data : null;

  const series = ok ? [
    { key: "h", label: "Skutečnost", color: "var(--text)", points: ok.history.map((r) => ({ year: r.year, value: metric === "population" ? r.population : r[metric] })) },
    ...(metric === "population" ? (ok.paths ?? []).map((p, i) => ({ key: `mc${i}`, label: `Možný průběh ${i + 1}`, color: "var(--accent)", width: 1, dashed: false, faint: true,
      points: [{ year: ok.base_year, value: ok.base_population }, ...p.map((r) => ({ year: r.year, value: r.population }))] })) : []),
    { key: "p", label: "Pravděpodobný", color: "var(--accent)", width: 2.6,
      points: [{ year: ok.base_year, value: metric === "population" ? ok.base_population : ok.history[ok.history.length - 1][metric] }, ...ok.scenarios.pravdepodobny.map((r) => ({ year: r.year, value: r[metric] }))],
      band: metric === "population" ? ok.scenarios.pravdepodobny.map((r) => ({ year: r.year, lo: r.lower, hi: r.upper })) : undefined },
    { key: "o", label: "Optimistický", color: "var(--info)", dashed: true, points: ok.scenarios.optimisticky.map((r) => ({ year: r.year, value: r[metric] })) },
    { key: "r", label: "Rizikový", color: "var(--warn)", dashed: true, points: ok.scenarios.rizikovy.map((r) => ({ year: r.year, value: r[metric] })) },
  ] : [];
  const last = ok ? ok.history[ok.history.length - 1] : null;
  const y40 = ok ? ok.scenarios.pravdepodobny[ok.scenarios.pravdepodobny.length - 1] : null;

  return (
    <>
      <VyhledHook territory={nazev} baseYear={ok?.base_year}
        historie={ok?.history.map((r) => ({ year: r.year, population: r.population })) ?? []}
        cesty={ok?.paths?.map((p) => p.map((r) => ({ year: r.year, population: r.population }))) ?? []}
        pravdepodobny={ok?.scenarios.pravdepodobny.map((r) => ({ year: r.year, population: r.population })) ?? []}
        pasmo={ok?.scenarios.pravdepodobny.map((r) => ({ year: r.year, lo: r.lower, hi: r.upper })) ?? []}>
        <div className="row" style={{ marginTop: 20 }}>
          <Link className="btn btn-primary" to={`/scenare?t=${tid}`}><Icon name="split" size={16} /> Spočítat scénář se zásahem</Link>
        </div>
      </VyhledHook>
      <div className="stack-y">
        <div className="toolbar-card reveal">
          <div className="toolbar-picker"><TerritoryPicker value={tid} onChange={(id) => setQuery({ t: id })} label="Území" /></div>
          <div className="field"><span className="field-label">Ukazatel</span>
            <Segmented label="Ukazatel" value={metric} onChange={setMetric} options={[{ value: "population", label: "Obyvatelé" }, { value: "age_65", label: "Senioři 65+" }, { value: "age_0_14", label: "Děti 0–14" }]} />
          </div>
        </div>
        <ErrorBox error={error} retry={reload} />
        {data && !data.available && <Card><p className="muted">{data.reason}</p></Card>}
        {ok && (
          <>
            <div className="stats-row">
              <Stat i={0} label={`Obyvatelé ${ok.base_year}`} value={num(ok.base_population)} sub="FAKT · ČSÚ" />
              <Stat i={1} label={`Obyvatelé ${y40?.year ?? ""} · pravděpodobný`} value={num(y40?.population ?? null)} sub={`pásmo ${num(y40?.lower ?? null)}–${num(y40?.upper ?? null)} · ${signed(y40 ? 100 * (y40.population / ok.base_population - 1) : null, 1, " %")}`} />
              <Stat i={2} label={`Podíl seniorů 65+ v roce ${y40?.year ?? ""}`} value={pct(y40?.share_65 ?? null)} sub={last?.age_65 ? `dnes ${pct((100 * last.age_65) / last.population)}` : ""} />
              <Stat i={3} label="Zpětný test" value={ok.backtest.available ? `${num(ok.backtest.mape!, 2)} %` : "—"} sub="o kolik se model v minulosti spletl" />
            </div>
            <Card i={2} title={label} icon="trend-up" actions={<KindTag kind="MODEL" info="Odhad modelu z vývoje porodnosti, úmrtnosti a stěhování (kohortně-komponentní metoda). Není to zveřejněný údaj, ale výpočet z něj." zdroj={{ nazev: "ČSÚ – Městská a obecní statistika", url: "https://csu.gov.cz/produkty/databaze-mos-otevrena-data" }} />}>
              <ChartSwitch id={`vyhled-${metric}`} views={[
                {
                  key: "vyvoj", label: "Vývoj v čase", icon: "trend-up", render: () => (
                    <>
                      <LineChart ariaLabel={`${label} — historie a scénáře`} series={series} height={320} nowYear={ok.base_year} />
                      <Legend items={[
                        { label: "Skutečnost (ČSÚ)", color: "var(--text)" },
                        { label: `Pravděpodobný${metric === "population" ? " + pásmo nejistoty (90 %)" : ""}`, color: "var(--accent)" },
                        ...(metric === "population" && ok.paths?.length ? [{ label: "Možné průběhy s náhodnými výkyvy mezi roky", color: "color-mix(in oklab, var(--accent) 45%, transparent)" }] : []),
                        { label: "Optimistický", color: "var(--info)", dashed: true }, { label: "Rizikový", color: "var(--warn)", dashed: true },
                      ]} />
                    </>
                  ),
                },
                // Proč ten výhled vychází tak, jak vychází: tři složky, které se
                // sčítají do rozdílu. Čára ukazuje výsledek, tohle příčinu.
                ...(metric === "population" ? [{
                  key: "slozeni", label: "Z čeho se změna skládá", icon: "split", render: () => {
                    const s = ok.scenarios.pravdepodobny;
                    const sum = (k: "births" | "deaths" | "migration") => s.reduce((a, r) => a + (r[k] ?? 0), 0);
                    return (
                      <Waterfall ariaLabel={`Z čeho se skládá změna počtu obyvatel do roku ${y40?.year ?? ""}`} height={290} steps={[
                        { label: String(ok.base_year), value: ok.base_population, total: true },
                        { label: "narození", value: Math.round(sum("births")) },
                        { label: "zemřelí", value: -Math.round(sum("deaths")) },
                        { label: "stěhování", value: Math.round(sum("migration")) },
                        { label: String(s[s.length - 1].year), value: Math.round(s[s.length - 1].population), total: true },
                      ]} />
                    );
                  },
                }] : []),
                {
                  key: "mrizka", label: "Scénáře po letech", icon: "grid", render: () => {
                    const years = [2026, 2028, 2030, 2032, 2034, 2036, 2038, 2040];
                    const kinds = [["pravdepodobny", "Pravděpodobný"], ["optimisticky", "Optimistický"], ["rizikovy", "Rizikový"]] as const;
                    return (
                      <Heatmap ariaLabel={`${label} podle scénáře a roku`} format={(v) => num(v)}
                        rows={kinds.map(([k, l]) => ({ key: k, label: l }))}
                        cols={years.map((y) => ({ key: String(y), label: String(y) }))}
                        value={(row, col) => ok.scenarios[row as "pravdepodobny"].find((r) => r.year === Number(col))?.[metric] ?? null} />
                    );
                  },
                },
                ...(y40?.age_0_14 && y40.age_65 ? [{
                  key: "struktura", label: `Věková struktura ${y40?.year ?? ""}`, icon: "users", render: () => (
                    <Donut ariaLabel={`Věková struktura v roce ${y40?.year ?? ""}`} caption={`obyvatel ${y40?.year ?? ""}`} parts={[
                      { label: "Děti 0–14", value: Math.round(y40.age_0_14!), color: "var(--info)" },
                      { label: "15–64 let", value: Math.round(y40.population - y40.age_0_14! - y40.age_65!), color: "var(--accent)" },
                      { label: "Senioři 65+", value: Math.round(y40.age_65!), color: "var(--warn)" },
                    ]} />
                  ),
                }] : []),
              ]} />
            </Card>
            <div className="grid">
              <Card span={4} i={3} title="Scénáře v klíčových letech" icon="target" flush>
                <div className="table-wrap" style={{ margin: 0, padding: "0 var(--card-pad) var(--card-pad)" }}>
                  <table className="table">
                    <thead><tr><th>Rok</th><th className="r">Pravděp.</th><th className="r">Optim.</th><th className="r">Rizik.</th></tr></thead>
                    <tbody>
                      {[2030, 2035, 2040].map((y) => {
                        const g = (k: "pravdepodobny" | "optimisticky" | "rizikovy") => ok.scenarios[k].find((r) => r.year === y);
                        return <tr key={y}><td className="strong">{y}</td><td className="r">{num(g("pravdepodobny")?.[metric] ?? null)}</td><td className="r">{num(g("optimisticky")?.[metric] ?? null)}</td><td className="r">{num(g("rizikovy")?.[metric] ?? null)}</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card span={4} i={4} title="Věková struktura" icon="users">
                {last && last.age_0_14 && last.age_65 && y40?.age_0_14 && y40.age_65 ? (
                  <div className="stack-y">
                    <div><div className="small strong" style={{ marginBottom: 6 }}>{ok.base_year} <KindTag kind="FAKT" info="Skutečné věkové složení území za poslední zveřejněný rok." zdroj={{ nazev: "ČSÚ – Městská a obecní statistika", url: "https://csu.gov.cz/produkty/databaze-mos-otevrena-data" }} /></div>
                      <ShareBar parts={[{ label: "0–14", value: last.age_0_14, color: "var(--info)" }, { label: "15–64", value: last.population - last.age_0_14 - last.age_65, color: "var(--accent)" }, { label: "65+", value: last.age_65, color: "var(--warn)" }]} /></div>
                    <div><div className="small strong" style={{ marginBottom: 6 }}>{y40?.year} <KindTag kind="MODEL" info="Odhad modelu z vývoje porodnosti, úmrtnosti a stěhování (kohortně-komponentní metoda). Není to zveřejněný údaj, ale výpočet z něj." zdroj={{ nazev: "ČSÚ – Městská a obecní statistika", url: "https://csu.gov.cz/produkty/databaze-mos-otevrena-data" }} /></div>
                      <ShareBar parts={[{ label: "0–14", value: y40.age_0_14, color: "var(--info)" }, { label: "15–64", value: y40.population - y40.age_0_14 - y40.age_65, color: "var(--accent)" }, { label: "65+", value: y40.age_65, color: "var(--warn)" }]} /></div>
                  </div>
                ) : <p className="muted small">Pro toto území chybí údaje o věku.</p>}
              </Card>
              <Card span={4} i={5} title="Zpětný test modelu" icon="check" actions={<InfoHint>Model dostal data jen do roku {ok.backtest.cutoff} a jeho odhad dalších let se porovnal s tím, co ČSÚ skutečně zveřejnil. Čím menší odchylka a čím víc skutečnosti v pásmu, tím víc se výhledu dá věřit.</InfoHint>}>
                {ok.backtest.available ? (
                  <>
                    <div className="row" style={{ gap: 18, marginBottom: 6 }}>
                      <div><div className="stat-label">Průměrná odchylka</div><div className="stat-value">{num(ok.backtest.mape!, 2)} %</div></div>
                      <div><div className="stat-label">Skutečnost uvnitř pásma</div><div className="stat-value">{Math.round(100 * ok.backtest.coverage!)} %</div></div>
                    </div>
                    <LineChart ariaLabel="Zpětný test" height={150} series={[
                      { key: "a", label: "Skutečnost", color: "var(--text)", points: ok.backtest.points!.map((p) => ({ year: p.year, value: p.actual })) },
                      { key: "p", label: `Model z roku ${ok.backtest.cutoff}`, color: "var(--accent)", dashed: true, points: ok.backtest.points!.map((p) => ({ year: p.year, value: p.predicted })), band: ok.backtest.points!.map((p) => ({ year: p.year, lo: p.lower, hi: p.upper })) },
                    ]} />
                  </>
                ) : <p className="muted small">Na zpětný test tu není dost let s daty.</p>}
              </Card>
            </div>
            <Card i={6} title="Z čeho výhled vychází" icon="book">
              <p className="small muted" style={{ marginBottom: 10 }}>{ok.method}.</p>
              <ul style={{ paddingLeft: 18, display: "grid", gap: 6 } as CSSProperties} className="small">{ok.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
