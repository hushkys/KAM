import { BarList, ChartSwitch, Columns, Donut, ShareBar } from "../components/charts";
import { StatistikyHook } from "../components/StatistikyHook";
import { Card, Pill, Stat } from "../components/ui";
import { useApi } from "../lib/api";
import { ago, compact, num } from "../lib/format";
import type { Sources } from "../lib/types";

interface StatsT {
  datasets: Sources; observations_per_year: { year: number; count: number }[]; indicators_per_pillar: { key: string; label: string; count: number }[];
  pois: { kind: string; label: string; count: number }[]; formats: { format: string; count: number }[];
  dokumenty: { druh: string; label: string; count: number }[];
  ai: { questions: number; blocked: number; rag: { docs: number; vector_coverage: number; terms: number; vectors: number } };
  simulation: { cache: { size: number; capacity: number }; popular: { key: string; territory: string; hits: number; interventions: { type: string }[]; cached: boolean }[] };
  crowd: { reports: number; clusters: number; by_status: Record<string, number> };
  jobs: { name: string; status: string; detail: string; progress: number; updated_at: string }[];
}

const JOB: Record<string, string> = { geo: "Hranice ČÚZK", catalog: "Katalog NKOD a portálů", mos: "ČSÚ MOS", khk: "Vrstvy Data KHK", rag: "Index asistenta" };

export function Stats() {
  const { data } = useApi<StatsT>("/stats");
  const obs = data?.observations_per_year.reduce((a, r) => a + r.count, 0) ?? 0;
  const f = data?.datasets.by_freshness ?? {};
  const dok = data?.dokumenty.reduce((a, d) => a + d.count, 0) ?? null;
  return (
    <>
      <StatistikyHook roky={data?.observations_per_year ?? []} />
      <div className="stats-row" style={{ marginBottom: "var(--gap)" }}>
        <Stat i={0} label="Funkčních datových sad" value={num(data?.datasets.verified ?? null)} sub={data ? `${num(data.datasets.total)} v katalogu` : ""} />
        <Stat i={1} label="Měřených hodnot" value={compact(obs)} />
        <Stat i={2} label="Zařízení a zastávek" value={num(data?.pois.reduce((a, p) => a + p.count, 0) ?? null)} />
        <Stat i={3} label="Dokumentů obcí" value={num(dok)} sub="programy rozvoje a územní plány" />
        <Stat i={4} label="Dokumentů v indexu" value={num(data?.ai.rag.docs ?? null)} sub={data ? `${Math.round(100 * data.ai.rag.vector_coverage)} % s vektory` : ""} />
        <Stat i={5} label="Dotazů na asistenta" value={num(data?.ai.questions ?? null)} sub={data ? `${num(data.ai.blocked)} zablokováno ochranou` : ""} />
      </div>
      <div className="grid">
        <Card span={6} i={1} title="Datové sady podle zdroje" icon="layers">
          {data && (() => {
            const top = [...data.datasets.sources].sort((a, b) => b.verified - a.verified).filter((s) => s.verified > 0);
            return (
              <ChartSwitch id="stats-zdroje" views={[
                { key: "zebricek", label: "Žebříček", icon: "chart", render: () => <BarList items={top.slice(0, 14).map((s) => ({ key: s.id, label: s.name.replace("NKOD — ", ""), value: s.verified }))} /> },
                // Deset největších plus zbytek jako jeden díl: koláč s pětaosmdesáti
                // výsečemi nesděluje nic, ale podíl špičky na celku ano.
                { key: "podil", label: "Podíl na katalogu", icon: "grid", render: () => <Donut ariaLabel="Podíl zdrojů na katalogu" caption="ověřených sad" parts={[
                  ...top.slice(0, 9).map((s) => ({ label: s.name.replace("NKOD — ", ""), value: s.verified })),
                  { label: `Dalších ${top.length - 9} zdrojů`, value: top.slice(9).reduce((a, s) => a + s.verified, 0), color: "var(--text-mute)" },
                ]} /> },
              ]} />
            );
          })()}
        </Card>
        <Card span={6} i={2} title="Datové sady podle oblasti" icon="grid">
          {data && <ChartSwitch id="stats-oblasti" views={[
            { key: "zebricek", label: "Žebříček", icon: "chart", render: () => <BarList items={data.datasets.by_pillar.map((p) => ({ key: p.key, label: p.label, value: p.count }))} /> },
            { key: "kolac", label: "Koláč", icon: "grid", render: () => <Donut ariaLabel="Datové sady podle oblasti" caption="sad" parts={data.datasets.by_pillar.map((p) => ({ label: p.label, value: p.count }))} /> },
          ]} />}
          <div className="section-gap" />
          <div className="small strong" style={{ marginBottom: 8 }}>Čerstvost podle deklarované periodicity</div>
          <ShareBar parts={[{ label: "Aktuální", value: f.aktualni ?? 0, color: "var(--ok)" }, { label: "Po termínu", value: f.zastarala ?? 0, color: "var(--warn)" }, { label: "Periodicita neuvedena", value: f.neznama ?? 0, color: "var(--text-mute)" }]} />
        </Card>
        <Card span={8} i={3} title="Měřené hodnoty podle roku" icon="chart">
          {data && <Columns ariaLabel="Počet pozorování podle roku" items={data.observations_per_year.map((r) => ({ label: String(r.year), value: r.count }))} />}
        </Card>
        <Card span={4} i={4} title="Formáty distribucí" icon="download">
          {data && <ChartSwitch id="stats-formaty" views={[
            { key: "zebricek", label: "Žebříček", icon: "chart", render: () => <BarList items={data.formats.slice(0, 10).map((x) => ({ key: x.format, label: x.format, value: x.count }))} /> },
            { key: "kolac", label: "Koláč", icon: "grid", render: () => <Donut ariaLabel="Formáty distribucí" caption="distribucí" size={150} parts={data.formats.slice(0, 8).map((x) => ({ label: x.format, value: x.count }))} /> },
          ]} />}
        </Card>
        <Card span={4} i={5} title="Zařízení z dat kraje" icon="pin">
          {data && <ChartSwitch id="stats-zarizeni" views={[
            { key: "zebricek", label: "Žebříček", icon: "chart", render: () => <BarList items={data.pois.map((p) => ({ key: p.kind, label: p.label, value: p.count }))} /> },
            { key: "kolac", label: "Koláč", icon: "grid", render: () => <Donut ariaLabel="Zařízení z dat kraje" caption="zařízení" size={150} parts={data.pois.slice(0, 9).map((p) => ({ label: p.label, value: p.count }))} /> },
          ]} />}
        </Card>
        <Card span={4} i={6} title="Ukazatele podle oblasti" icon="chart">
          {data && <BarList items={data.indicators_per_pillar.map((p) => ({ key: p.key, label: p.label, value: p.count }))} />}
        </Card>
        <Card span={4} i={7} title="Simulace a mezipaměť" icon="split">
          {data && (
            <>
              <p className="small muted" style={{ marginBottom: 10 }}>V mezipaměti {num(data.simulation.cache.size)} z {num(data.simulation.cache.capacity)} scénářů. Nejčastější vzorce se předpočítají při startu.</p>
              <div className="list">
                {data.simulation.popular.slice(0, 6).map((p) => (
                  <div className="list-row" key={p.key}><span className="list-main"><span className="list-title small">{p.interventions.map((i) => i.type).join(" + ") || "bez zásahu"}</span><span className="list-sub">{p.territory}</span></span><span className="list-side small">{p.hits}× {p.cached && <Pill tone="accent">cache</Pill>}</span></div>
                ))}
              </div>
            </>
          )}
        </Card>
        <Card span={6} i={8} title="Podněty" icon="message">
          {data && (
            <div className="facts-list">
              <div className="fact-row"><span>Hlášení</span><span>{num(data.crowd.reports)}</span></div>
              <div className="fact-row"><span>Skupiny</span><span>{num(data.crowd.clusters)}</span></div>
              <div className="fact-row"><span>Připraveno / předáno</span><span>{num(data.crowd.by_status.pripraveno ?? 0)} / {num(data.crowd.by_status.odeslano ?? 0)}</span></div>
            </div>
          )}
        </Card>
        <Card span={6} i={9} title="Úlohy sklizně dat" icon="refresh">
          <div className="list">
            {data?.jobs.map((j) => (
              <div className="list-row" key={j.name}>
                <span className="list-main"><span className="list-title small">{JOB[j.name] ?? j.name}</span><span className="list-sub">{j.status === "done" ? "dokončeno" : j.status === "running" ? `běží · ${Math.round(100 * j.progress)} %` : j.status} · {ago(j.updated_at)}</span></span>
                <Pill tone={j.status === "done" ? "ok" : j.status === "error" ? "bad" : "info"}>{j.status}</Pill>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
