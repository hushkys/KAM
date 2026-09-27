// Co kdyby? — simulátor. Vlevo se scénář staví, vpravo se čte.
//
// Stavba má tři kroky a čísla u nich, protože bez nich lidé klikali rovnou do
// zásahů a divili se, že počítá cizí obec. Nad zásahy jsou hotové sady: každá
// odpovídá na jednu otázku, se kterou obec přichází, a ušetří skládání pěti
// posuvníků od nuly jen proto, aby bylo vůbec co číst.
//
// Výsledek se čte odshora: jedna věta, tři čísla k vybranému roku, varování,
// pak teprve grafy. Horizont je přepínač, ne pevný rok — „co to udělá do roku
// 2030" a „do roku 2040" jsou dvě různé otázky a obě jsou legitimní.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChartSwitch, Heatmap, LineChart, Legend } from "../components/charts";
import { Icon, PILLAR_ICON } from "../components/Icon";
import { TerritoryPicker } from "../components/TerritoryPicker";
import { ScenarioHook } from "../components/ScenarioHook";
import { Umisteni } from "../components/Umisteni";
import { Card, Empty, ErrorBox, InfoHint, KindTag, Modal, Segmented } from "../components/ui";
import { api, ApiError, invalidate, useApi } from "../lib/api";
import { date, kc, num, signed } from "../lib/format";
import { navigate, setQuery, useLocation, useNahled } from "../lib/router";
import { toast } from "../lib/toast";

interface Param { label: string; min?: number; max?: number; step?: number; default: number | string; options?: Record<string, string> }
interface Spec { label: string; pillar: string; pillar_label: string; params: Record<string, Param> }
interface Sada { key: string; label: string; pillar: string; otazka: string; ivs: Iv[] }
interface Catalog {
  interventions: Record<string, Spec>;
  assumptions: Record<string, { label: string; value: number; unit: string; why: string }>;
  help: Record<string, string>;
  sady: Sada[];
}
interface Iv { type: string; params: Record<string, number | string> }
interface Row { year: number; population: number; zs_util: number | null; ms_util: number | null; zs_demand: number; zs_capacity: number; ms_demand: number; ms_capacity: number }
interface Warning { key: string; level: string; year: number; title: string; text: string; suggest: string }
interface Result {
  available: boolean; reason?: string; territory: { id: string; name: string }; base_year: number; baseline: Row[]; scenario: Row[];
  warnings: { baseline: Warning[]; scenario: Warning[] }; metrics: { key: string; label: string; unit: string; values: { year: number; base: number | null; scenario: number | null; delta: number | null }[] }[];
  chain: { label: string; tag: string; detail?: string }[]; costs: { capex: number; opex_year: number; tax_delta_year: number };
  assumptions: { key: string; label: string; value: number; unit: string; why: string }[]; inputs: Record<string, number>; method: string; cache: { hit: boolean; ms: number; hits: number };
}
interface Saved { id: string; name: string; territory: string; territory_name: string; interventions: Iv[]; created_at: string; summary: { warnings: number } }

function encode(ivs: Iv[]): string { return btoa(unescape(encodeURIComponent(JSON.stringify(ivs)))); }
function decode(s: string | null): Iv[] {
  if (!s) return [];
  try { const v = JSON.parse(decodeURIComponent(escape(atob(s)))); return Array.isArray(v) ? v : []; } catch { return []; }
}

function defaults(cat: Catalog, type: string): Iv {
  const spec = cat.interventions[type];
  return { type, params: Object.fromEntries(Object.entries(spec.params).map(([k, p]) => [k, p.default])) };
}

/** Roky, ke kterým model počítá srovnání. Musí sedět se `simulate.HORIZON`. */
const HORIZONTY = [2030, 2035, 2040] as const;

export function Scenarios() {
  const { query } = useLocation();
  const nahled = useNahled();
  const cat = useApi<Catalog>("/simulate/catalog");
  const saved = useApi<Saved[]>("/scenarios");
  const [tid, setTid] = useState(query.get("t") ?? "obec:574121");
  const [ivs, setIvs] = useState<Iv[]>(() => decode(query.get("iv")));
  const [assume, setAssume] = useState<Record<string, number>>({});
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [rok, setRok] = useState<number>(2040);
  const seq = useRef(0);

  useEffect(() => {
    const add = query.get("add");
    if (add && cat.data?.interventions[add] && !ivs.some((i) => i.type === add)) setIvs((v) => [...v, defaults(cat.data!, add)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat.data]);

  useEffect(() => {
    if (!nahled) setQuery({ t: tid, iv: ivs.length ? encode(ivs) : null, add: null });
    const my = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      api<Result>("/simulate", { body: { territory: tid, interventions: ivs, assumptions: assume } })
        .then((r) => { if (my === seq.current) { setRes(r); setErr(null); } })
        .catch((e) => my === seq.current && setErr(e))
        .finally(() => my === seq.current && setBusy(false));
    }, 220);
    return () => clearTimeout(timer);
  }, [tid, ivs, assume]);

  const update = (i: number, key: string, v: number | string) => setIvs((all) => all.map((iv, j) => (j === i ? { ...iv, params: { ...iv.params, [key]: v } } : iv)));
  const remove = (i: number) => setIvs((all) => all.filter((_, j) => j !== i));
  const add = (type: string) => cat.data && setIvs((all) => [...all, defaults(cat.data!, type)]);

  /** Zásahy seskupené podle oblasti. Osm položek v jedné mřížce je seznam,
   *  ve kterém se hledá; rozdělené podle oblasti je nabídka, ve které se volí. */
  const skupiny = useMemo(() => {
    const out: { pillar: string; label: string; items: [string, Spec][] }[] = [];
    for (const [k, v] of Object.entries(cat.data?.interventions ?? {})) {
      const g = out.find((x) => x.pillar === v.pillar);
      if (g) g.items.push([k, v]);
      else out.push({ pillar: v.pillar, label: v.pillar_label, items: [[k, v]] });
    }
    return out;
  }, [cat.data]);

  const vRoce = useMemo(() => Object.fromEntries((res?.metrics ?? []).map((m) => [m.key, m.values.find((v) => v.year === rok) ?? m.values[m.values.length - 1]])), [res, rok]);
  const m2040 = useMemo(() => Object.fromEntries((res?.metrics ?? []).map((m) => [m.key, m.values[m.values.length - 1]])), [res]);
  const popDelta = m2040.population?.delta ?? null;
  const lastYear = res?.scenario[res.scenario.length - 1]?.year;
  /** Sada je „nasazená", když scénář obsahuje přesně její zásahy. */
  const aktivniSada = useMemo(() => (cat.data?.sady ?? []).find((s) =>
    s.ivs.length === ivs.length && s.ivs.every((a, i) => a.type === ivs[i]?.type))?.key, [cat.data, ivs]);

  /** One sentence saying what the scenario does, before any chart. Every part
   *  of it comes from the result: the horizon year, the population difference
   *  and the number of capacity warnings the engine raised. */
  const verdict = useMemo(() => {
    if (!res?.available) return "";
    if (!ivs.length) return `Zatím bez zásahu. Čísla níže jsou samotný výhled území do roku ${lastYear ?? ""}.`;
    const w = res.warnings.scenario.length;
    const move = popDelta === null || Math.round(popDelta) === 0
      ? `se zásah do roku ${lastYear ?? ""} na počtu obyvatel prakticky neprojeví`
      : `bude v roce ${lastYear ?? ""} o ${num(Math.abs(popDelta))} obyvatel ${popDelta > 0 ? "víc" : "méně"} než bez zásahu`;
    // "varování" is the same in every Czech plural form, so no plural() here.
    return `Podle modelu ${move}. ${w ? `Hlásí k tomu ${w} varování, najdete je níže.` : "Žádné varování nehlásí."}`;
  }, [res, ivs.length, popDelta, lastYear]);
  const share = () => { navigator.clipboard?.writeText(location.href).then(() => toast("ok", "Odkaz na scénář je ve schránce."), () => toast("warn", "Odkaz se nepodařilo zkopírovat.")); };
  const save = async () => {
    try {
      await api("/scenarios", { body: { name, territory: tid, interventions: ivs, assumptions: assume } });
      invalidate("/scenarios");
      saved.reload();
      setSaveOpen(false);
      toast("ok", "Scénář uložen.");
    } catch (e) { toast("error", (e as Error).message); }
  };

  const predpoklad = (klic: string) => num(assume[klic] ?? res?.assumptions.find((a) => a.key === klic)?.value ?? null);
  const kapacity = [
    { key: "zs", label: "Základní školy", cap: `Kapacita = počet tříd × ${predpoklad("max_zs_trida")} žáků`, b: res?.baseline.map((r) => ({ year: r.year, value: r.zs_util !== null ? 100 * r.zs_util : null })) ?? [], s: res?.scenario.map((r) => ({ year: r.year, value: r.zs_util !== null ? 100 * r.zs_util : null })) ?? [] },
    { key: "ms", label: "Mateřské školy", cap: `Kapacita = počet tříd × ${predpoklad("max_ms_trida")} dětí`, b: res?.baseline.map((r) => ({ year: r.year, value: r.ms_util !== null ? 100 * r.ms_util : null })) ?? [], s: res?.scenario.map((r) => ({ year: r.year, value: r.ms_util !== null ? 100 * r.ms_util : null })) ?? [] },
  ].filter((k) => k.b.some((p) => p.value !== null));

  return (
    <>
      <ScenarioHook territory={res?.territory.name} baseYear={res?.base_year} delta={ivs.length ? popDelta : null}
        baseline={res?.baseline.map((r) => ({ year: r.year, value: r.population })) ?? []}
        scenario={res?.scenario.map((r) => ({ year: r.year, value: r.population })) ?? []}>
        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn" onClick={share} disabled={!ivs.length}><Icon name="link" size={16} /> Zkopírovat odkaz</button>
          <button className="btn btn-primary" onClick={() => { setName(`${res?.territory.name ?? ""}: ${ivs.map((i) => cat.data?.interventions[i.type]?.label).join(" + ")}`.slice(0, 110)); setSaveOpen(true); }} disabled={!ivs.length}><Icon name="save" size={16} /> Uložit scénář</button>
        </div>
      </ScenarioHook>

      <div className="grid">
        <div className="span-5 stack-y">
          <Card i={0} title={<span className="step-head"><span className="step-n">1</span> Vyberte území</span>} icon="pin">
            <TerritoryPicker value={tid} onChange={(id) => setTid(id)} label="Obec, ORP, okres nebo kraj" />
          </Card>

          <Card i={1} title={<span className="step-head"><span className="step-n">2</span> Zvolte hotový scénář…</span>} icon="sparkle"
            actions={<InfoHint label="Co to je">Typické otázky, se kterými obce přicházejí. Nejsou to doporučení: kliknutím se nastaví zásahy a ty pak můžete libovolně upravit.</InfoHint>}>
            <div className="sada-grid">
              {(cat.data?.sady ?? []).map((s) => (
                <button key={s.key} className={`sada${aktivniSada === s.key ? " is-on" : ""}`} onClick={() => setIvs(s.ivs.map((i) => ({ type: i.type, params: { ...i.params } })))}>
                  <span className="sada-head"><Icon name={PILLAR_ICON[s.pillar]} size={16} /><strong>{s.label}</strong></span>
                  <span className="sada-otazka">{s.otazka}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card i={2} title={<span className="step-head"><span className="step-n">3</span> …nebo sestavte vlastní zásahy</span>} icon="split"
            actions={ivs.length ? <button className="btn btn-quiet btn-sm" onClick={() => setIvs([])}>Odebrat všechny</button> : undefined}>
            <div className="stack-y">
              {ivs.map((iv, i) => {
                const spec = cat.data?.interventions[iv.type];
                if (!spec) return null;
                return (
                  <div className="iv-card" key={`${iv.type}${i}`}>
                    <div className="iv-head">
                      <strong><Icon name={PILLAR_ICON[spec.pillar]} size={16} /> {spec.label}</strong>
                      <button className="icon-btn sm" onClick={() => remove(i)} aria-label={`Odebrat ${spec.label}`}><Icon name="trash" size={15} /></button>
                    </div>
                    {cat.data?.help[iv.type] && <p className="iv-help">{cat.data.help[iv.type]}</p>}
                    {Object.entries(spec.params).map(([k, p]) => p.options ? (
                      <label className="param" key={k}><span className="param-top"><span>{p.label}</span></span>
                        <select className="select" value={String(iv.params[k])} onChange={(e) => update(i, k, e.target.value)}>{Object.entries(p.options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                      </label>
                    ) : (
                      <label className="param" key={k}>
                        <span className="param-top"><span>{p.label}</span><b>{k === "rok" ? iv.params[k] : num(Number(iv.params[k]))}</b></span>
                        <input type="range" min={p.min} max={p.max} step={p.step} value={Number(iv.params[k])} onChange={(e) => update(i, k, Number(e.target.value))}
                          style={{ "--p": `${((Number(iv.params[k]) - (p.min ?? 0)) / ((p.max ?? 1) - (p.min ?? 0))) * 100}%` } as CSSProperties} aria-label={p.label} />
                      </label>
                    ))}
                  </div>
                );
              })}
              {!ivs.length && <p className="muted small">Zatím žádný zásah, výsledek ukazuje samotný výhled. Přidejte zásah:</p>}
              {skupiny.map((g) => (
                <div className="iv-skupina" key={g.pillar}>
                  <span className="iv-skupina-nadpis"><Icon name={PILLAR_ICON[g.pillar]} size={14} /> {g.label}</span>
                  <div className="iv-add-grid">
                    {g.items.map(([k, v]) => (
                      <button key={k} className="iv-add" onClick={() => add(k)} title={cat.data?.help[k]}>
                        <span className="iv-add-label">{v.label}</span>
                        <Icon name="plus" size={15} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {res?.available && (
            <Card i={3} title={<span className="step-head"><span className="step-n">4</span> Zkontrolujte předpoklady</span>} icon="sliders" actions={Object.keys(assume).length ? <button className="btn btn-quiet btn-sm" onClick={() => setAssume({})}>Vrátit výchozí</button> : undefined}>
              <details>
                <summary className="small strong" style={{ cursor: "pointer" }}>Odhady, se kterými model počítá, např. kolik lidí bydlí v novém bytě ({res.assumptions.length})</summary>
                <div className="stack-y" style={{ marginTop: 12 }}>
                  {res.assumptions.map((a) => (
                    <label className="field" key={a.key}>
                      <span className="field-label">{a.label} <KindTag kind="PŘEDPOKLAD" /></span>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <input className="input" type="number" step="any" value={assume[a.key] ?? a.value} onChange={(e) => setAssume((s) => ({ ...s, [a.key]: Number(e.target.value) }))} style={{ maxWidth: 140 }} />
                        <span className="small mute">{a.unit}</span>
                      </div>
                      <span className="help">{a.why}</span>
                    </label>
                  ))}
                  <div className="facts-list small">
                    <strong>Údaje o území, ze kterých model vychází</strong>
                    <div className="fact-row"><span>Osob na byt (sčítání 2021)</span><span>{num(res.inputs.persons_per_flat, 2)}</span></div>
                    <div className="fact-row"><span>Žáků / tříd v ZŠ</span><span>{num(res.inputs.zs_pupils)} / {num(res.inputs.zs_classes)}</span></div>
                    <div className="fact-row"><span>Dětí / tříd v MŠ</span><span>{num(res.inputs.ms_children)} / {num(res.inputs.ms_classes)}</span></div>
                    <div className="fact-row"><span>Daňové příjmy na obyvatele</span><span>{kc(res.inputs.tax_per_capita)}</span></div>
                  </div>
                </div>
              </details>
            </Card>
          )}

          {(saved.data?.length ?? 0) > 0 && (
            <Card i={4} title="Uložené scénáře" icon="save">
              <div className="list">
                {saved.data!.map((s) => (
                  <div className="list-row" key={s.id}>
                    <button className="list-main" style={{ background: "none", border: 0, textAlign: "left", cursor: "pointer", padding: 0 }} onClick={() => { setTid(s.territory); setIvs(s.interventions); }}>
                      <span className="list-title">{s.name}</span><span className="list-sub">{s.territory_name} · {date(s.created_at)}{s.summary.warnings ? ` · ${s.summary.warnings} varování` : ""}</span>
                    </button>
                    <button className="icon-btn sm" aria-label="Smazat scénář" onClick={async () => { await api(`/scenarios/${s.id}`, { method: "DELETE" }); invalidate("/scenarios"); saved.reload(); }}><Icon name="trash" size={15} /></button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="span-7 stack-y sim-sticky">
          <ErrorBox error={err} />
          {res && !res.available && <Card><Empty icon="alert" title="Scénář pro toto území spočítat nejde">{res.reason}</Empty></Card>}
          {res?.available && (
            <>
              <div className="sim-result-head">
                <div style={{ minWidth: 0 }}>
                  <div className="row"><KindTag kind="SCÉNÁŘ" /><h2>{res.territory.name}</h2></div>
                  <p className="sim-verdict">{verdict}</p>
                </div>
                <span className="cache-badge" aria-live="polite">{busy ? "Počítám…" : ""}</span>
              </div>

              <div className="sim-horizont">
                <span className="field-label">Stav k roku</span>
                <Segmented size="sm" label="Stav k roku" value={String(rok)} onChange={(v) => setRok(Number(v))}
                  options={HORIZONTY.map((y) => ({ value: String(y), label: String(y) }))} />
              </div>
              <div className="stats-row">
                {[["population", "Obyvatelé"], ["zs_util", "Vytížení ZŠ"], ["tax", "Daňové příjmy obce"]].map(([k, l], i) => {
                  const v = vRoce[k];
                  return (
                    <div className="stat reveal" key={k} style={{ "--i": i } as CSSProperties}>
                      <div className="stat-label">{l} {rok}</div>
                      <div className="stat-value num">{k === "zs_util" ? (v?.scenario !== null && v?.scenario !== undefined ? `${num(v.scenario, 1)} %` : "—") : k === "tax" ? kc(v?.scenario ?? null) : num(v?.scenario ?? null)}</div>
                      <div className={`stat-sub ${v?.delta ? (v.delta > 0 ? "delta-pos" : "delta-neg") : ""}`}>{ivs.length ? `${signed(v?.delta ?? 0, k === "zs_util" ? 1 : 0, k === "zs_util" ? " p. b." : "")} proti stavu bez zásahu` : "bez zásahu"}</div>
                    </div>
                  );
                })}
              </div>

              {res.warnings.scenario.length > 0 && (
                <div className="stack-y">
                  {res.warnings.scenario.map((w) => (
                    <div className={`warn-card lvl-${w.level}`} key={w.key + w.year}>
                      <Icon name="alert" size={18} />
                      <span className="wc-title">{w.title}</span>
                      <span className="wc-text">{w.text} {w.suggest && !ivs.some((i) => i.type === w.suggest) && <button className="btn btn-sm btn-quiet" onClick={() => add(w.suggest)}>Přidat řešení do scénáře <Icon name="arrow-right" size={14} /></button>}</span>
                    </div>
                  ))}
                </div>
              )}

              <Card i={1} title="Obyvatelé bez zásahu a se zásahem" icon="users">
                <ChartSwitch id="scenare-obyvatele" views={[
                  {
                    key: "cesty", label: "Obě křivky", icon: "trend-up", render: () => (
                      <>
                        <LineChart ariaLabel="Obyvatelé bez zásahu a se zásahem" height={240} series={[
                          { key: "b", label: "Bez zásahu", color: "var(--text-mute)", dashed: true, points: res.baseline.map((r) => ({ year: r.year, value: r.population })) },
                          { key: "s", label: "Se zásahem", color: "var(--accent)", width: 2.6, points: res.scenario.map((r) => ({ year: r.year, value: r.population })) },
                        ]} />
                        <Legend items={[{ label: "Bez zásahu", color: "var(--text-mute)", dashed: true }, { label: "Se zásahem", color: "var(--accent)" }]} />
                      </>
                    ),
                  },
                  {
                    // Samotný rozdíl, rok po roce. Dvě skoro totožné křivky se
                    // čtou špatně — odečtená jedna od druhé je přesně to, co
                    // zásah způsobil, a nic jiného.
                    key: "rozdil", label: "Jen rozdíl", icon: "split", render: () => (
                      <LineChart ariaLabel="Rozdíl mezi scénářem a stavem bez zásahu" height={240} yZero
                        format={(v) => signed(v, 0)} series={[{
                          key: "d", label: "Rozdíl", color: "var(--accent)", width: 2.6,
                          points: res.scenario.map((r, i) => ({ year: r.year, value: r.population - (res.baseline[i]?.population ?? r.population) })),
                        }]} />
                    ),
                  },
                  {
                    key: "mrizka", label: "Ukazatele po letech", icon: "grid", render: () => {
                      const ms = res.metrics.filter((m) => m.values.some((v) => v.scenario !== null));
                      const years = res.metrics[0]?.values.map((v) => String(v.year)) ?? [];
                      return (
                        <Heatmap ariaLabel="Ukazatele podle roku" format={(v) => num(v, 0)}
                          rows={ms.map((m) => ({ key: m.key, label: m.label }))}
                          cols={years.map((y) => ({ key: y, label: y }))}
                          value={(row, col) => ms.find((m) => m.key === row)?.values.find((v) => String(v.year) === col)?.scenario ?? null} />
                      );
                    },
                  },
                ]} />
              </Card>

              {kapacity.length > 0 && (
                <Card i={2} title="Vytížení škol" icon="school">
                  <ChartSwitch id="scenare-kapacity" views={kapacity.map((k) => ({
                    key: k.key, label: k.label, icon: "school", render: () => (
                      <>
                        <LineChart ariaLabel={`Vytížení ${k.label}`} height={210} unit="%" format={(v) => `${num(v, 0)} %`}
                          refLine={{ value: 100, label: "Kapacita 100 %" }} series={[
                            { key: "b", label: "Bez zásahu", color: "var(--text-mute)", dashed: true, points: k.b },
                            { key: "s", label: "Se zásahem", color: "var(--warn)", points: k.s },
                          ]} />
                        <p className="xsmall mute" style={{ marginTop: 8 }}>{k.cap}. Nad 100 % je dětí víc než míst.</p>
                      </>
                    ),
                  }))} />
                </Card>
              )}

              {res.chain.length > 0 && (
                <Card i={3} title="Jak zásah působí, krok za krokem" icon="split">
                  <div className="chain">
                    {res.chain.map((s, i) => (
                      <div className={`chain-step ${s.tag === "ZÁSAH" ? "is-zasah" : ""}`} key={i} style={{ "--i": i } as CSSProperties}>
                        <span className="chain-dot">{s.tag === "ZÁSAH" ? <Icon name="plus" size={14} /> : i}</span>
                        <span className="chain-body"><strong>{s.label}</strong><span className="row"><KindTag kind={s.tag} />{s.detail && <span className="xsmall mute">{s.detail}</span>}</span></span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <Card i={4} title="Srovnání se stavem bez zásahu" icon="chart" flush>
                <div className="table-wrap" style={{ margin: 0, padding: "0 var(--card-pad) var(--card-pad)" }}>
                  <table className="table">
                    <thead><tr><th>Ukazatel</th>{HORIZONTY.map((y) => <th key={y} className={`r${y === rok ? " is-on" : ""}`}>{y}</th>)}</tr></thead>
                    <tbody>
                      {res.metrics.filter((m) => m.values.some((v) => v.base !== null)).map((m) => (
                        <tr key={m.key}>
                          <td><span className="strong">{m.label}</span><div className="xsmall mute">{m.unit}</div></td>
                          {m.values.map((v) => (
                            <td className={`r${v.year === rok ? " is-on" : ""}`} key={v.year}>
                              <div>{m.key === "tax" ? kc(v.scenario) : num(v.scenario)}</div>
                              {ivs.length > 0 && v.delta !== null && v.delta !== 0 && <div className={`xsmall ${v.delta > 0 ? "delta-pos" : "delta-neg"}`}>{signed(v.delta)}</div>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {ivs.length > 0 && (
                <Card i={5} title="Náklady a daně navíc" icon="coins" actions={<KindTag kind="PŘEDPOKLAD" />}>
                  <div className="stats-row">
                    <div><div className="stat-label">Investice jednorázově</div><div className="stat-value">{kc(res.costs.capex)}</div></div>
                    <div><div className="stat-label">Provoz za rok</div><div className="stat-value">{kc(res.costs.opex_year)}</div></div>
                    <div><div className="stat-label">Daně navíc za rok ({lastYear})</div><div className="stat-value">{kc(res.costs.tax_delta_year)}</div></div>
                  </div>
                </Card>
              )}

              {/* Kde zásah postavit patří až za výsledek: nejdřív se rozhodne
                  co a kolik, teprve pak kam. */}
              <Umisteni />
              <p className="disclaimer"><Icon name="info" size={13} /><span>{res.method}</span></p>
            </>
          )}
          {!res && !err && <span className="skeleton" style={{ height: 420, width: "100%" }} />}
        </div>
      </div>

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Uložit scénář"
        footer={<><button className="btn btn-quiet" onClick={() => setSaveOpen(false)}>Zrušit</button><button className="btn btn-primary" disabled={!name.trim()} onClick={save}>Uložit scénář</button></>}>
        <label className="field"><span className="field-label">Název scénáře</span><input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
        <p className="help" style={{ marginTop: 8 }}>Uloží se území, zásahy, předpoklady a výsledek. Data území zůstanou beze změny.</p>
      </Modal>
      <span hidden>{navigate.name}</span>
    </>
  );
}
