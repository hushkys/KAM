// Map: Czechia by kraj (open data per kraj, or an indicator), then the home
// kraj by ORP or obec. Selection opens a side panel with the essentials.

import { useMemo, type CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { CzMap, KhkMap, MapLegend } from "../components/maps";
import { MapaHook } from "../components/MapaHook";
import { useTerritories } from "../components/TerritoryPicker";
import { Card, KindTag, Segmented, Severity } from "../components/ui";
import { useApi } from "../lib/api";
import { num, withUnit } from "../lib/format";
import { Link, navigate, setQuery, useLocation } from "../lib/router";
import type { IndicatorMeta, Profile, Sources } from "../lib/types";
import { Erb } from "../components/Erb";


interface CzData { indicator: IndicatorMeta; year: number; national: number | null; national_datasets: number; breaks: number[]; kraje: { code: number; id: string; name: string; datasets: number; value: number | null; population: number | null }[] }
interface KhkData { indicator: IndicatorMeta; year: number; level: string; reference: number | null; values: Record<string, number>; breaks: number[] }

function quantiles(vals: number[], n = 5): number[] {
  const v = [...vals].sort((a, b) => a - b);
  return v.length ? Array.from({ length: n - 1 }, (_, i) => v[Math.min(v.length - 1, Math.floor((v.length * (i + 1)) / n))]) : [];
}

export function MapPage() {
  const { query } = useLocation();
  const view = query.get("view") === "khk" ? "khk" : "cz";
  const metric = query.get("m") ?? "datasets";
  const ind = query.get("ind") ?? "d_podil_65";
  const level = query.get("level") === "orp" ? "orp" : "obec";
  const sel = query.get("sel");
  const inds = useApi<IndicatorMeta[]>("/map/indicators");
  const cz = useApi<CzData>(`/map/cz?indicator=${metric === "datasets" ? "d_podil_65" : metric}`);
  const khk = useApi<KhkData>(view === "khk" ? `/map/khk?indicator=${ind}&level=${level}` : null);
  const sources = useApi<Sources>("/sources");
  const prof = useApi<Profile>(view === "khk" && sel ? `/territories/${sel}` : null);
  // Kolik pater mapa má, se nepíše ručně — spočítá se ze seznamu území,
  // který stránka stejně stahuje kvůli vyhledávání.
  const uzemi = useTerritories().data;
  const pocty = useMemo(() => ({
    orp: (uzemi ?? []).filter((t) => t.level === "orp").length,
    obce: (uzemi ?? []).filter((t) => t.level === "obec").length,
  }), [uzemi]);

  const czValues = useMemo(() => {
    const out: Record<number, number | null> = {};
    for (const k of cz.data?.kraje ?? []) out[k.code] = metric === "datasets" ? k.datasets : k.value;
    return out;
  }, [cz.data, metric]);
  const czBreaks = metric === "datasets" ? quantiles(Object.values(czValues).filter((v): v is number => v !== null)) : cz.data?.breaks ?? [];
  const selKraj = cz.data?.kraje.find((k) => String(k.code) === sel);
  const krajSource = sources.data?.sources.find((s) => s.id === (sel === "86" ? "nkod-khk" : `nkod-kraj-${sel}`));
  const indOpts = inds.data ?? [];
  const fmtCz = (v: number | null) => (v === null ? "bez dat" : metric === "datasets" ? `${num(v)} datových sad` : withUnit(v, cz.data?.indicator.unit ?? ""));

  return (
    <>
      <MapaHook kraje={cz.data?.kraje ?? []} orp={pocty.orp} obce={pocty.obce}>
        <div className="row" style={{ marginTop: 14 }}>
          <Segmented label="Pohled" value={view} onChange={(v) => setQuery({ view: v === "cz" ? null : v, sel: null })} options={[{ value: "cz", label: "Česko", icon: "globe" }, { value: "khk", label: "Královéhradecký kraj", icon: "map" }]} />
        </div>
      </MapaHook>
      <div className="grid">
        <Card span={8} i={1} title={view === "cz" ? (metric === "datasets" ? "Otevřené datové sady v krajích" : cz.data?.indicator.name ?? "") : khk.data?.indicator.name ?? "Ukazatel"} icon="map"
          actions={view === "cz" ? (
            <select className="select" style={{ height: 34, width: "auto" }} value={metric} onChange={(e) => setQuery({ m: e.target.value === "datasets" ? null : e.target.value })} aria-label="Co mapa ukazuje">
              <option value="datasets">Počet otevřených datových sad</option>
              {indOpts.filter((i) => !i.code.startsWith("khk") && i.code !== "d_zast_1000" && i.code !== "d_zs_trida").map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}
            </select>
          ) : (
            <div className="row">
              <Segmented size="sm" label="Úroveň" value={level} onChange={(v) => setQuery({ level: v === "obec" ? null : v, sel: null })} options={[{ value: "obec", label: "Obce" }, { value: "orp", label: "ORP" }]} />
              <select className="select" style={{ height: 34, width: "auto", maxWidth: 240 }} value={ind} onChange={(e) => setQuery({ ind: e.target.value })} aria-label="Ukazatel">
                {indOpts.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}
              </select>
            </div>
          )}>
          {view === "cz" ? (
            <>
              <CzMap values={czValues} breaks={czBreaks} polarity={metric === "datasets" ? 1 : cz.data?.indicator.polarity ?? 1} selected={sel ? Number(sel) : null}
                onSelect={(c) => setQuery({ sel: String(c) })} format={fmtCz} label="Mapa krajů Česka" />
              <div className="row-between"><MapLegend breaks={czBreaks} polarity={metric === "datasets" ? 1 : cz.data?.indicator.polarity ?? 1} unit={metric === "datasets" ? "" : cz.data?.indicator.unit} /><span className="xsmall mute">Hranice: ČÚZK RÚIAN · Data: {metric === "datasets" ? "NKOD a další katalogy" : `ČSÚ MOS ${cz.data?.year ?? ""}`}</span></div>
            </>
          ) : khk.data ? (
            <>
              <KhkMap level={level} values={khk.data.values} breaks={khk.data.breaks} polarity={khk.data.indicator.polarity} selected={sel} label={khk.data.indicator.name}
                format={(v) => (v === null ? "bez dat" : withUnit(v, khk.data!.indicator.unit))} onSelect={(id) => setQuery({ sel: id })} />
              <div className="row-between"><MapLegend breaks={khk.data.breaks} polarity={khk.data.indicator.polarity} unit={khk.data.indicator.unit} /><span className="xsmall mute">Rok {khk.data.year} · celý kraj: {withUnit(khk.data.reference, khk.data.indicator.unit)}</span></div>
            </>
          ) : <span className="skeleton" style={{ width: "100%", aspectRatio: "1000/760" }} />}
        </Card>

        <div className="span-4 stack-y">
          {/* Detail kraje se ukáže až po výběru. Prázdná karta s větou „vyberte
              kraj" zabírala místo nad seznamem a posílala ho pod okraj okna;
              nápověda je teď v hlavičce seznamu. */}
          {view === "cz" && selKraj && (
            <Card i={2} title={selKraj.name} icon="pin">
              <div className="mapa-uzemi">
                <Erb id={selKraj.id} name={selKraj.name} size={48} />
                <span className="mute small">{selKraj.code === 86 ? "Kraj s podrobným modelem obcí" : "Kraj"}</span>
              </div>
              {selKraj && (
                <div className="facts-list">
                  <div className="fact-row"><span>Otevřené datové sady o kraji</span><span className="num">{num(selKraj.datasets)}</span></div>
                  <div className="fact-row"><span>Obyvatelé (ČSÚ)</span><span className="num">{num(selKraj.population)}</span></div>
                  {metric !== "datasets" && <div className="fact-row"><span>{cz.data?.indicator.name}</span><span className="num">{withUnit(selKraj.value, cz.data?.indicator.unit ?? "")}</span></div>}
                  {metric !== "datasets" && <div className="fact-row"><span>Česko celkem</span><span className="num">{withUnit(cz.data?.national ?? null, cz.data?.indicator.unit ?? "")}</span></div>}
                  <div className="row" style={{ marginTop: 6 }}>
                    <Link className="btn btn-sm" to={`/data?region=${selKraj.code}`}><Icon name="database" size={15} /> Zobrazit datové sady</Link>
                    {krajSource && <a className="btn btn-sm btn-quiet" href={krajSource.portal_url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={15} /> Otevřít v NKOD</a>}
                    {selKraj.code === 86 && <button className="btn btn-sm btn-primary" onClick={() => setQuery({ view: "khk", sel: null })}>Zobrazit obce kraje <Icon name="arrow-right" size={15} /></button>}
                  </div>
                </div>
              )}
            </Card>
          )}
          {view === "cz" && (
            <Card i={3} title="Pořadí krajů podle počtu sad" icon="chart">
              <div className="kraje-seznam">
                {(() => {
                  const kraje = [...(cz.data?.kraje ?? [])].sort((a, b) => b.datasets - a.datasets);
                  const nejvic = Math.max(1, ...kraje.map((k) => k.datasets));
                  return kraje.map((k, i) => (
                    <button key={k.code} className={`kraj-radek${String(k.code) === sel ? " is-on" : ""}${k.code === 86 ? " is-domov" : ""}`} onClick={() => setQuery({ sel: String(k.code) })}
                      data-ctx={k.id} data-ctx-label={k.name} style={{ "--i": i } as CSSProperties}>
                      <span className="kraj-poradi num">{i + 1}.</span>
                      <Erb id={k.id} name={k.name} size={26} />
                      <span className="kraj-telo">
                        <span className="kraj-jmeno">{k.name}</span>
                        <span className="kraj-drah" aria-hidden="true"><i style={{ width: `${(k.datasets / nejvic) * 100}%` }} /></span>
                      </span>
                      <span className="kraj-pocet num">{num(k.datasets)}</span>
                    </button>
                  ));
                })()}
              </div>
              <p className="xsmall mute" style={{ marginTop: 10 }}>{!selKraj && "Klepnutím na kraj zobrazíte podrobnosti. "}Celostátní a evropské sady bez kraje: {num(cz.data?.national_datasets ?? 0)}. Sada patří kraji, který popisuje, ne tomu, kdo ji vydal.</p>
            </Card>
          )}
          {view === "khk" && (
            <Card i={2} title={prof.data?.territory.name ?? "Vyberte území"} icon="pin" actions={sel ? <Link className="btn btn-sm btn-primary" to={`/obce/${sel}`}>Otevřít profil <Icon name="arrow-right" size={14} /></Link> : undefined}>
              {!sel && <p className="muted small">Klepnutím na obec nebo ORP v mapě zobrazíte podrobnosti.</p>}
              {sel && !prof.data && <span className="skeleton" style={{ height: 120, width: "100%" }} />}
              {prof.data && (
                <>
                  <div className="mapa-uzemi">
                    <Erb id={prof.data.territory.id} name={prof.data.territory.name} size={48} />
                    <span className="mute small">{prof.data.territory.okres ?? prof.data.territory.name}{prof.data.territory.area_km2 ? ` · ${num(prof.data.territory.area_km2)} km²` : ""}</span>
                  </div>
                  <div className="facts-list">
                    <div className="fact-row"><span>Obyvatelé</span><span className="num">{num(prof.data.territory.population)} ({prof.data.territory.population_year})</span></div>
                    {prof.data.territory.parent && <div className="fact-row"><span>Nadřazené území</span><span>{prof.data.territory.parent.name}</span></div>}
                    {prof.data.outlook.milestones?.[1] && <div className="fact-row"><span>Výhled {prof.data.outlook.milestones[1].year} <KindTag kind="MODEL" puvod={{ kody: ["110900", "110200", "110300", "110400", "110500"] }} info="Odhad modelu z vývoje porodnosti, úmrtnosti a stěhování (kohortně-komponentní metoda). Není to zveřejněný údaj, ale výpočet z něj." zdroj={{ nazev: "ČSÚ – Městská a obecní statistika", url: "https://csu.gov.cz/produkty/databaze-mos-otevrena-data" }} /></span><span className="num">{num(prof.data.outlook.milestones[1].population)}</span></div>}
                  </div>
                  <div className="section-gap" />
                  {prof.data.risks.slice(0, 3).map((r) => (
                    <div className="risk-card" key={r.id}><div className="rc-head"><span className="rc-title small">{r.title}</span><Severity level={r.level} label={r.level_label} /></div></div>
                  ))}
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn btn-sm" onClick={() => navigate(`/scenare?t=${sel}`)}><Icon name="split" size={15} /> Sestavit scénář</button>
                    <button className="btn btn-sm btn-quiet" onClick={() => navigate(`/vyhled?t=${sel}`)}><Icon name="trend-up" size={15} /> Otevřít výhled</button>
                  </div>
                </>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
