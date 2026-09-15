// Data: the exact list of datasets KAM uses (with links and how each one is
// used), the sources, the data-needs monitor and the methodology.

import { useEffect, useState, type CSSProperties } from "react";
import { BarList } from "../components/charts";
import { DataHook } from "../components/DataHook";
import { Icon } from "../components/Icon";
import { Card, Empty, ErrorBox, Pill, Severity, Stat, Tabs } from "../components/ui";
import { useApi } from "../lib/api";
import { ago, date, num } from "../lib/format";
import { Link, setQuery, useLocation } from "../lib/router";
import type { Sources } from "../lib/types";

interface Ds { id: number; title: string; description: string; publisher: string; source: string; url: string; alt_url: string; download_url: string; formats: string; pillar: string; pillar_label: string; region: string; modified: string; freshness: string; loaded: boolean; usage: string[]; check_status: string; check_code: number }
interface DsPage { total: number; page: number; size: number; items: Ds[] }
interface Gaps {
  coverage: { matrix: { territory: { id: string; name: string }; cells: { pillar: string; score: number; missing: string[] }[] }[]; pillars: { key: string; label: string; score: number }[]; health: number };
  freshness: { pillars: { pillar: string; label: string; total: number; fresh: number; stale: number; unknown: number; fresh_share: number | null }[]; stale_examples: Record<string, { title: string; url: string; modified: string }[]> };
  alerts: { level: string; pillar: string; kind: string; title: string; text: string }[];
  structural: { pillar: string; pillar_label: string; title: string; text: string }[];
}
interface Method { id: string; title: string; text: string; url: string }

const USAGE: Record<string, string> = { katalog: "Katalog", rag: "Asistent", pokryti: "Pokrytí", cerstvost: "Čerstvost", mapa: "Mapa", model: "Model" };
const PILLARS: [string, string][] = [["demografie", "Demografie"], ["doprava", "Doprava"], ["skolstvi", "Školství"], ["zdravotnictvi", "Zdravotnictví"], ["socialni", "Sociální"], ["bydleni", "Bydlení"], ["prostredi", "Prostředí"], ["finance", "Finance"], ["ostatni", "Ostatní"]];
const KRAJE: [string, string][] = [["86", "Královéhradecký"], ["0", "Celostátní"], ["19", "Praha"], ["27", "Středočeský"], ["35", "Jihočeský"], ["43", "Plzeňský"], ["51", "Karlovarský"], ["60", "Ústecký"], ["78", "Liberecký"], ["94", "Pardubický"], ["108", "Vysočina"], ["116", "Jihomoravský"], ["124", "Olomoucký"], ["141", "Zlínský"], ["132", "Moravskoslezský"]];

function Catalog({ sources }: { sources: Sources | undefined }) {
  const { query } = useLocation();
  const [q, setQ] = useState(query.get("q") ?? "");
  const [dq, setDq] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const src = query.get("source") ?? "", pillar = query.get("pillar") ?? "", region = query.get("region") ?? "", loaded = query.get("loaded") ?? "", fresh = query.get("fresh") ?? "";
  const status = query.get("status") ?? "ok";
  const page = Number(query.get("page") ?? 1);
  const params = new URLSearchParams({ size: "25", page: String(page), status });
  if (dq) params.set("q", dq); if (src) params.set("source", src); if (pillar) params.set("pillar", pillar); if (region) params.set("region", region); if (loaded) params.set("loaded", loaded); if (fresh) params.set("freshness", fresh);
  const { data, error, loading } = useApi<DsPage>(`/datasets?${params}`);
  useEffect(() => { setQuery({ q: dq || null, page: null }); }, [dq]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  const sel = (key: string, value: string, opts: [string, string][], label: string) => (
    <label className="field"><span className="field-label">{label}</span>
      <select className="select" value={value} onChange={(e) => setQuery({ [key]: e.target.value || null, page: null })}><option value="">Vše</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </label>
  );
  return (
    <Card i={1} title={data ? `${num(data.total)} ${status === "ok" ? "funkčních " : ""}datových sad` : "Datové sady"} icon="database" actions={<a className="btn btn-sm" href="/api/datasets/export.csv"><Icon name="download" size={15} /> Export CSV</a>}>
      <div className="input-icon" style={{ marginBottom: 12 }}><Icon name="search" size={17} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hledat v názvech a popisech (i bez diakritiky)…" aria-label="Hledat datové sady" /></div>
      <div className="filters">
        {sel("source", src, (sources?.sources ?? []).filter((s) => s.datasets > 0).map((s) => [s.id, s.name]), "Zdroj")}
        {sel("pillar", pillar, PILLARS, "Oblast")}
        {sel("region", region, KRAJE, "Územní rozsah")}
        {sel("loaded", loaded, [["true", "Načteno do modelu"], ["false", "Metadata"]], "Využití")}
        {sel("fresh", fresh, [["aktualni", "Aktuální"], ["zastarala", "Po termínu"], ["neznama", "Neuvedeno"]], "Čerstvost")}
        <label className="field"><span className="field-label">Dostupnost odkazu</span>
          <select className="select" value={status} onChange={(e) => setQuery({ status: e.target.value === "ok" ? null : e.target.value, page: null })}>
            <option value="ok">Funkční (ověřeno)</option><option value="chyba">Nedostupné</option><option value="bez_odkazu">Bez odkazu</option><option value="vse">Vše</option>
          </select>
        </label>
      </div>
      <ErrorBox error={error} />
      {loading && !data && <span className="skeleton" style={{ height: 300, width: "100%" }} />}
      {data?.items.length === 0 && <Empty icon="search" title="Nic nenalezeno">Upravte hledání nebo filtry.</Empty>}
      {data?.items.map((d) => (
        <div className="ds-row" key={d.id} data-ctx="dataset" data-ctx-label={d.title} data-ctx-url={d.url} data-ctx-download={d.download_url || undefined}>
          <div style={{ minWidth: 0 }}>
            <a className="ds-title" href={d.url} target="_blank" rel="noopener noreferrer">{d.title}</a>
            <div className="xsmall mute">{d.publisher} · {d.region}{d.formats ? ` · ${d.formats.replace(/,/g, ", ")}` : ""}{d.modified ? ` · aktualizováno ${date(d.modified)}` : ""}</div>
          </div>
          <div className="ds-links">
            {d.download_url && <a className="icon-btn sm" href={d.download_url} target="_blank" rel="noopener noreferrer" aria-label="Stáhnout data" title="Stáhnout data"><Icon name="download" size={16} /></a>}
            <a className="icon-btn sm" href={d.url} target="_blank" rel="noopener noreferrer" aria-label="Otevřít v katalogu" title="Otevřít v katalogu"><Icon name="external" size={16} /></a>
          </div>
          {d.description && <p className="ds-desc">{d.description}</p>}
          <div className="ds-tags">
            {d.check_status === "ok" && <Pill tone="ok" icon="check">Odkaz ověřen</Pill>}
            {d.check_status === "chyba" && <Pill tone="bad" icon="alert">Nedostupné{d.check_code ? ` (${d.check_code})` : ""}</Pill>}
            {d.check_status === "bez_odkazu" && <Pill tone="warn">Bez odkazu na data</Pill>}
            {d.loaded && <Pill tone="accent" icon="database">V modelu</Pill>}
            <Pill>{d.pillar_label}</Pill>
            {d.freshness === "aktualni" && <Pill tone="ok">Aktuální</Pill>}
            {d.freshness === "zastarala" && <Pill tone="warn">Po termínu</Pill>}
            <span className="xsmall mute">Využití: {d.usage.map((u) => USAGE[u] ?? u).join(" · ")}</span>
            {d.alt_url && <a className="source-link" href={d.alt_url} target="_blank" rel="noopener noreferrer"><Icon name="link" size={12} /><span>také na portálu kraje / města</span></a>}
          </div>
        </div>
      ))}
      {data && data.total > data.size && (
        <div className="pager">
          <span className="small mute">Strana {page} z {num(pages)}</span>
          <div className="row">
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setQuery({ page: String(page - 1) })}><Icon name="chevron-left" size={15} /> Předchozí</button>
            <button className="btn btn-sm" disabled={page >= pages} onClick={() => setQuery({ page: String(page + 1) })}>Další <Icon name="chevron-right" size={15} /></button>
          </div>
        </div>
      )}
    </Card>
  );
}

function SourcesTab({ data }: { data: Sources | undefined }) {
  if (!data) return <span className="skeleton" style={{ height: 300, width: "100%" }} />;
  const groups: [string, string][] = [["core", "Královéhradecký kraj a státní zdroje"], ["kraje", "Kraje a krajské portály"], ["ostatni", "Obce, města, úřady a další poskytovatelé v NKOD"]];
  return (
    <div className="stack-y">
      {groups.map(([g, label], gi) => (
        <Card key={g} i={gi} title={`${label} (${num(data.sources.filter((s) => s.group === g && s.datasets).length)})`} icon="layers" flush>
          <div className="table-wrap" style={{ margin: 0, padding: "0 var(--card-pad) var(--card-pad)" }}>
            <table className="table">
              <thead><tr><th>Zdroj</th><th>Typ</th><th className="r">Funkčních</th><th className="r">Celkem</th><th>Sklizeno</th><th /></tr></thead>
              <tbody>
                {data.sources.filter((s) => s.group === g && (s.datasets > 0 || s.kind !== "nkod")).map((s) => (
                  <tr key={s.id}>
                    <td className="strong">{s.name.replace("NKOD — ", "")}</td>
                    <td className="small mute">{{ nkod: "NKOD (SPARQL)", dcat: "DCAT-AP", csw: "CSW (INSPIRE)", api: "REST API", file: "Soubory", portal: "Portál" }[s.kind] ?? s.kind}</td>
                    <td className="r">{s.datasets ? num(s.verified) : "—"}</td>
                    <td className="r mute">{s.datasets ? num(s.datasets) : "—"}</td>
                    <td className="small mute">{s.harvested_at ? ago(s.harvested_at) : "—"}</td>
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      {s.portal_url && <a className="icon-btn sm" href={s.portal_url} target="_blank" rel="noopener noreferrer" aria-label={`Otevřít ${s.name}`}><Icon name="external" size={15} /></a>}
                      {s.datasets > 0 && <Link className="icon-btn sm" to={`/data?source=${s.id}`} aria-label="Zobrazit sady"><Icon name="filter" size={15} /></Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      <p className="small mute">Duplicity mezi NKOD a portály krajů a měst jsou sloučené — každá sada je započítána jednou a nese oba odkazy. Funkční = odkaz na data nebo stránku sady při poslední kontrole odpověděl. IČ 17651921 patří Digitální a informační agentuře.</p>
    </div>
  );
}

function cellColor(score: number): string {
  const t = score / 100;
  return `color-mix(in oklab, var(--accent) ${Math.round(12 + 70 * t)}%, var(--bad) ${Math.round(70 * (1 - t))}%)`;
}

function Needs() {
  const { data, error } = useApi<Gaps>("/gaps");
  if (error) return <ErrorBox error={error} />;
  if (!data) return <span className="skeleton" style={{ height: 400, width: "100%" }} />;
  return (
    <div className="grid">
      <Card span={4} i={0} title="Zdraví dat" icon="gauge">
        <div className="row" style={{ alignItems: "baseline" }}><span className="kpi-value">{data.coverage.health} %</span><span className="muted small">průměrné pokrytí</span></div>
        <div className="section-gap" />
        <BarList items={data.coverage.pillars.map((p) => ({ key: p.key, label: p.label, value: p.score }))} max={100} format={(v) => `${v} %`} />
      </Card>
      <Card span={8} i={1} title="Proaktivní upozornění" icon="bell" actions={<Link className="btn btn-sm" to="/podnety?kind=chybejici_data"><Icon name="plus" size={14} /> Nahlásit chybějící data</Link>}>
        {data.alerts.length === 0 && <Empty icon="check" title="Bez upozornění" />}
        {data.alerts.filter((a) => a.kind !== "pokryti").slice(0, 8).map((a) => (
          <div className="risk-card" key={a.title}><div className="rc-head"><span className="rc-title">{a.title}</span><Severity level={a.level} /></div><p>{a.text}</p></div>
        ))}
        {data.alerts.filter((a) => a.kind === "pokryti").length > 0 && <p className="small mute">+ {data.alerts.filter((a) => a.kind === "pokryti").length} upozornění na nízké pokrytí v ORP (matice níže).</p>}
      </Card>
      <Card span={12} i={2} title="Pokrytí dat: ORP × oblast" icon="grid" actions={<span className="xsmall mute">podíl obcí s daty v posledním roce, snížený za stáří dat</span>}>
        <div className="table-wrap">
          <div className="matrix" role="table" aria-label="Pokrytí dat">
            <div className="matrix-row" role="row"><span />{PILLARS.slice(0, 8).map(([k, l]) => <span key={k} className="matrix-head" role="columnheader">{l}</span>)}</div>
            {data.coverage.matrix.map((r) => (
              <div className="matrix-row" role="row" key={r.territory.id}>
                <Link className="matrix-name" to={`/obce/${r.territory.id}`} role="rowheader">{r.territory.name}</Link>
                {r.cells.map((c) => <span key={c.pillar} role="cell" className="matrix-cell" title={c.missing.length ? `Chybí u části obcí: ${c.missing.join(", ")}` : "Úplné pokrytí"} style={{ background: cellColor(c.score), color: c.score > 55 ? "var(--accent-fg)" : "#fff" }}>{c.score}</span>)}
              </div>
            ))}
          </div>
        </div>
      </Card>
      <Card span={6} i={3} title="Čerstvost sad Královéhradeckého kraje" icon="refresh" flush>
        <div className="table-wrap" style={{ margin: 0, padding: "0 var(--card-pad) var(--card-pad)" }}>
          <table className="table"><thead><tr><th>Oblast</th><th className="r">Sad</th><th className="r">Aktuální</th><th className="r">Po termínu</th><th className="r">Bez periodicity</th></tr></thead>
            <tbody>{data.freshness.pillars.filter((p) => p.total).map((p) => <tr key={p.pillar}><td>{p.label}</td><td className="r">{num(p.total)}</td><td className="r">{num(p.fresh)}</td><td className="r">{num(p.stale)}</td><td className="r">{num(p.unknown)}</td></tr>)}</tbody></table>
        </div>
      </Card>
      <Card span={6} i={4} title="Co model musí nahrazovat předpokladem" icon="alert">
        {data.structural.map((s) => <div className="risk-card" key={s.title}><div className="rc-head"><span className="rc-title">{s.title}</span><Pill>{s.pillar_label}</Pill></div><p>{s.text}</p></div>)}
      </Card>
    </div>
  );
}

function Methods() {
  const { data } = useApi<Method[]>("/methods");
  return (
    <Card i={0} title="Metodika" icon="book" id="metodika">
      {(data ?? []).map((m) => <div className="method" key={m.id}><h3>{m.title}</h3><p>{m.text}</p></div>)}
    </Card>
  );
}

export function DataPage() {
  const { query } = useLocation();
  const tab = query.get("tab") ?? "katalog";
  const src = useApi<Sources>("/sources");
  const d = src.data;
  return (
    <>
      <DataHook oblasti={d?.by_pillar ?? []} overenych={d?.verified} celkem={d?.total} poskytovatelu={d?.publishers}>
        <div className="row" style={{ marginTop: 20 }}>
          <a className="btn" href="/api/datasets/export.csv"><Icon name="download" size={16} /> Export katalogu (CSV)</a>
        </div>
      </DataHook>
      <div className="stats-row" style={{ marginBottom: "var(--gap)" }}>
        <Stat i={0} label="Funkčních datových sad" value={num(d?.verified ?? null)} sub={d ? `z ${num(d.total)} v katalogu` : ""} />
        <Stat i={1} label="Poskytovatelů" value={num(d?.publishers ?? null)} sub="NKOD, kraje, města, CENIA" />
        <Stat i={2} label="Kraje a krajské portály" value={num(d?.kraje ?? null)} sub="funkčních sad" />
        <Stat i={3} label="Načteno do modelu" value={num(d?.loaded ?? null)} sub="MOS ČSÚ, vrstvy Data KHK" />
        <Stat i={4} label="Vyřazeno" value={num(d ? d.broken + d.no_link : null)} sub="nedostupný nebo chybějící odkaz" />
      </div>
      <Tabs label="Sekce" value={tab} onChange={(v) => setQuery({ tab: v === "katalog" ? null : v, page: null })}
        tabs={[{ value: "katalog", label: "Katalog", icon: "database", count: d?.verified }, { value: "zdroje", label: "Zdroje", icon: "layers", count: d?.publishers }, { value: "potreby", label: "Datové potřeby", icon: "gauge" }, { value: "metodika", label: "Metodika", icon: "book" }]} />
      <div style={{ "--i": 0 } as CSSProperties}>
        {tab === "katalog" && <Catalog sources={d} />}
        {tab === "zdroje" && <SourcesTab data={d} />}
        {tab === "potreby" && <Needs />}
        {tab === "metodika" && <Methods />}
      </div>
    </>
  );
}
