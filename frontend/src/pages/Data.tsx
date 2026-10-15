// Data: the exact list of datasets KAM uses (with links and how each one is
// used), the sources, the data-needs monitor and the methodology.

import { useEffect, useState, type CSSProperties } from "react";
import { BarList } from "../components/charts";
import { DataHook } from "../components/DataHook";
import { Icon } from "../components/Icon";
import { Card, Empty, ErrorBox, Pill, Severity, Stat, Tabs } from "../components/ui";
import { useApi } from "../lib/api";
import { ago, date, num } from "../lib/format";
import { Link, setQuery, useLocation, useNahled } from "../lib/router";
import { toast } from "../lib/toast";
import type { SourceRow, Sources } from "../lib/types";
import { Erb } from "../components/Erb";

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
  const nahled = useNahled();
  useEffect(() => { if (!nahled) setQuery({ q: dq || null, page: null }); }, [dq, nahled]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  const sel = (key: string, value: string, opts: [string, string][], label: string) => (
    <label className="field"><span className="field-label">{label}</span>
      <select className="select" value={value} onChange={(e) => setQuery({ [key]: e.target.value || null, page: null })}><option value="">Vše</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </label>
  );
  return (
    <Card i={1} title={data ? `${num(data.total)} ${status === "ok" ? "funkčních " : ""}datových sad` : "Datové sady"} icon="database" actions={<a className="btn btn-sm" href="/api/datasets/export.csv"><Icon name="download" size={15} /> Stáhnout seznam (CSV)</a>}>
      <div className="input-icon" style={{ marginBottom: 12 }}><Icon name="search" size={17} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hledat v názvech a popisech (i bez diakritiky)…" aria-label="Hledat datové sady" /></div>
      <div className="filters">
        {sel("source", src, (sources?.sources ?? []).filter((s) => s.datasets > 0).map((s) => [s.id, s.name]), "Zdroj")}
        {sel("pillar", pillar, PILLARS, "Oblast")}
        {sel("region", region, KRAJE, "Území")}
        {sel("loaded", loaded, [["true", "Načteno do modelu"], ["false", "Jen v katalogu"]], "Využití")}
        {sel("fresh", fresh, [["aktualni", "Aktuální"], ["zastarala", "Po termínu"], ["neznama", "Termín neuveden"]], "Aktuálnost")}
        <label className="field"><span className="field-label">Odkaz</span>
          <select className="select" value={status} onChange={(e) => setQuery({ status: e.target.value === "ok" ? null : e.target.value, page: null })}>
            <option value="ok">Se souborem s daty</option><option value="stranka">Jen webová stránka</option><option value="chyba">Prázdné nebo nedostupné</option><option value="bez_odkazu">Bez odkazu</option><option value="vse">Vše</option>
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
            <a className="icon-btn sm" href={d.url} target="_blank" rel="noopener noreferrer" aria-label="Otevřít stránku sady" title="Otevřít stránku sady"><Icon name="external" size={16} /></a>
          </div>
          {d.description && <p className="ds-desc">{d.description}</p>}
          <div className="ds-tags">
            {d.check_status === "ok" && <Pill tone="ok" icon="check">Odkaz funguje</Pill>}
            {d.check_status === "chyba" && <Pill tone="bad" icon="alert">Odkaz nefunguje{d.check_code ? ` (${d.check_code})` : ""}</Pill>}
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

/** Poskytovatelů je skoro čtyři sta a vykreslit je všechny najednou je na
 *  přepnutí záložky znát. Data přijdou jedním dotazem, jen se ukazují po
 *  dávkách — a dávka je dost velká na to, aby se v největší skupině dalo
 *  hledat, aniž by se tlačítko mačkalo pořád dokola. */
const ZDROJU_NAJEDNOU = 24;

function ZdrojeSkupina({ label, rows, i }: { label: string; rows: SourceRow[]; i: number }) {
  const [limit, setLimit] = useState(ZDROJU_NAJEDNOU);
  const videt = rows.slice(0, limit);
  const zbyva = rows.length - videt.length;
  return (
    <Card i={i} title={`${label} (${num(rows.length)})`} icon="layers" flush>
      <div className="table-wrap" style={{ margin: 0, padding: "0 var(--card-pad) var(--card-pad)" }}>
        <table className="table">
          <thead><tr><th>Zdroj</th><th>Typ</th><th className="r">Funkčních</th><th className="r">Celkem</th><th>Načteno</th><th /></tr></thead>
          <tbody>
            {videt.map((s) => (
              <tr key={s.id}>
                <td className="strong">{s.name.replace("NKOD — ", "")}</td>
                <td className="small mute">{{ nkod: "NKOD (SPARQL)", dcat: "DCAT-AP", csw: "CSW (INSPIRE)", api: "REST API", file: "Soubory", portal: "Portál" }[s.kind] ?? s.kind}</td>
                <td className="r">{s.datasets ? num(s.verified) : "—"}</td>
                <td className="r mute">{s.datasets ? num(s.datasets) : "—"}</td>
                <td className="small mute">{s.harvested_at ? ago(s.harvested_at) : "—"}</td>
                <td className="r" style={{ whiteSpace: "nowrap" }}>
                  {s.portal_url && <a className="icon-btn sm" href={s.portal_url} target="_blank" rel="noopener noreferrer" aria-label={`Otevřít ${s.name}`}><Icon name="external" size={15} /></a>}
                  {s.datasets > 0 && <Link className="icon-btn sm" to={`/data?source=${s.id}`} aria-label="Zobrazit sady tohoto zdroje"><Icon name="filter" size={15} /></Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {zbyva > 0 && (
        <div className="zdroje-dalsi">
          <button className="btn btn-sm" onClick={() => setLimit((l) => l + ZDROJU_NAJEDNOU)}>
            <Icon name="chevron-down" size={15} /> Zobrazit dalších {Math.min(zbyva, ZDROJU_NAJEDNOU)}
          </button>
          <span className="xsmall mute">zobrazeno {num(videt.length)} z {num(rows.length)}</span>
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
        <ZdrojeSkupina key={g} i={gi} label={label} rows={data.sources.filter((s) => s.group === g && (s.datasets > 0 || s.kind !== "nkod"))} />
      ))}
      <p className="small mute">Sada, která je v celostátním katalogu (NKOD) i na portálu kraje nebo města, se počítá jednou a má oba odkazy. Funkční znamená, že jsme z odkazu stáhli začátek souboru a je v něm skutečný obsah: ne prázdný soubor, ne chybová a ne webová stránka. IČ 17651921 patří Digitální a informační agentuře.</p>
    </div>
  );
}

/** Barva buňky: od červené (nic) po zelenou (úplné pokrytí). Škála je spojitá,
 *  protože stupně by dvě sousední hodnoty stavěly proti sobě víc, než odpovídá
 *  rozdílu mezi nimi. */
function cellColor(score: number): string {
  const t = score / 100;
  return `color-mix(in oklab, var(--accent) ${Math.round(12 + 70 * t)}%, var(--bad) ${Math.round(70 * (1 - t))}%)`;
}

/** O kolik bodů se buňka musí lišit od krajského čísla, aby stálo za to si jí
 *  všimnout. Pod tím je to šum měření, ne vlastnost území. */
const ODCHYLKA = 8;

/** Krátké nadpisy sloupců. Popisky z API jsou věty („Sociální oblast a trh
 *  práce") a v hlavičce matice by se zalomily přes tři řádky. */
const KRATCE: Record<string, string> = { ...Object.fromEntries(PILLARS), kultura: "Kultura", zdravotnictvi: "Zdraví" };

/** Rozsah mezi oblastmi proti rozsahu mezi ORP — spočítaný, ne napsaný. */
function coverageVeta(c: Gaps["coverage"]): string {
  const po = c.pillars.map((p) => p.score);
  const pu = c.matrix.map((r) => Math.round(r.cells.reduce((a, x) => a + x.score, 0) / Math.max(1, r.cells.length)));
  if (!po.length || !pu.length) return "";
  const pMin = Math.min(...po), pMax = Math.max(...po), uMin = Math.min(...pu), uMax = Math.max(...pu);
  const zaver = pMax - pMin > (uMax - uMin) * 2
    ? "Data tedy chybějí podle oboru, ne podle místa."
    : "Rozdíly jsou i mezi územími.";
  return `Pokrytí se mezi oblastmi pohybuje od ${pMin} do ${pMax} %, mezi správními obvody ORP od ${uMin} do ${uMax} %. ${zaver}`;
}

function Needs() {
  const { data, error } = useApi<Gaps>("/gaps");
  if (error) return <ErrorBox error={error} />;
  if (!data) return <span className="skeleton" style={{ height: 400, width: "100%" }} />;
  return (
    <div className="grid">
      <Card span={4} i={0} title="Pokrytí podle oblastí" icon="gauge" className="sim-sticky">
        <div className="row" style={{ alignItems: "baseline" }}><span className="kpi-value">{data.coverage.health} %</span><span className="muted small">průměr všech oblastí</span></div>
        <div className="section-gap" />
        <BarList items={data.coverage.pillars.map((p) => ({ key: p.key, label: p.label, value: p.score }))} max={100} format={(v) => `${v} %`} />
      </Card>
      <Card span={8} i={1} title="Kde data chybějí nebo stárnou" icon="bell" actions={<Link className="btn btn-sm" to="/podnety?kind=chybejici_data"><Icon name="plus" size={14} /> Nahlásit chybějící data</Link>}>
        {data.alerts.length === 0 && <Empty icon="check" title="Bez upozornění" />}
        {data.alerts.filter((a) => a.kind !== "pokryti").slice(0, 8).map((a) => (
          <div className="risk-card" key={a.title}><div className="rc-head"><span className="rc-title">{a.title}</span><Severity level={a.level} /></div><p>{a.text}</p></div>
        ))}
        {data.alerts.filter((a) => a.kind === "pokryti").length > 0 && <p className="small mute">+ {data.alerts.filter((a) => a.kind === "pokryti").length} upozornění na nízké pokrytí v ORP (viz tabulka níže).</p>}
      </Card>
      <Card span={12} i={2} title="Pokrytí dat ve správních obvodech ORP" icon="grid" actions={<span className="xsmall mute">% obcí s daty za poslední rok; starší data se počítají méně</span>}>
        <p className="small mute" style={{ margin: "0 0 14px" }}>{coverageVeta(data.coverage)}</p>
        <div className="table-wrap">
          <div className="matrix" role="table" aria-label="Pokrytí dat"
            style={{ ["--sloupce" as string]: data.coverage.pillars.length } as CSSProperties}>
            <div className="matrix-row" role="row">
              <span className="matrix-head vlevo" role="columnheader">ORP</span>
              {/* V hlavičce je rovnou krajské číslo. Sloupec je totiž ta
                  odpověď: rozdíly jsou mezi oblastmi, ne mezi územími. */}
              {data.coverage.pillars.map((p) => (
                <span key={p.key} className="matrix-head" role="columnheader" title={p.label}>
                  {KRATCE[p.key] ?? p.label}<i>{p.score}</i>
                </span>
              ))}
              <span className="matrix-head" role="columnheader">Celkem</span>
            </div>
            {data.coverage.matrix.map((r) => {
              const prumer = Math.round(r.cells.reduce((a, c) => a + c.score, 0) / Math.max(1, r.cells.length));
              return (
                <div className="matrix-row" role="row" key={r.territory.id}>
                  <Link className="matrix-name" to={`/obce/${r.territory.id}`} role="rowheader"><Erb id={r.territory.id} name={r.territory.name} size={18} /><span>{r.territory.name}</span></Link>
                  {r.cells.map((c) => {
                    const kraj = data.coverage.pillars.find((p) => p.key === c.pillar)?.score ?? c.score;
                    const jina = Math.abs(c.score - kraj) >= ODCHYLKA;
                    return (
                      <span key={c.pillar} role="cell" className={jina ? "matrix-cell je-jina" : "matrix-cell"}
                        title={`${r.territory.name} · ${KRATCE[c.pillar] ?? c.pillar}: ${c.score} % (kraj ${kraj} %)${c.missing.length ? `
Chybí u části obcí: ${c.missing.join(", ")}` : ""}`}
                        style={{ background: cellColor(c.score) }}>{c.score}</span>
                    );
                  })}
                  <span role="cell" className="matrix-cell je-soucet" title={`Průměr přes všechny oblasti: ${prumer} %`}>{prumer}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="matrix-legenda">
          <span>0 %</span>
          <span className="skala" style={{ background: `linear-gradient(90deg, ${cellColor(0)}, ${cellColor(50)}, ${cellColor(100)})` }} />
          <span>100 %</span>
          <span style={{ marginLeft: 6 }}><span className="obrys">42</span> liší se od kraje o {ODCHYLKA} a více bodů</span>
        </div>
      </Card>
      <Card span={6} i={3} title="Aktuálnost sad kraje" icon="refresh" flush>
        <div className="table-wrap" style={{ margin: 0, padding: "0 var(--card-pad) var(--card-pad)" }}>
          <table className="table"><thead><tr><th>Oblast</th><th className="r">Sad</th><th className="r">Aktuální</th><th className="r">Po termínu</th><th className="r">Termín neuveden</th></tr></thead>
            <tbody>{data.freshness.pillars.filter((p) => p.total).map((p) => <tr key={p.pillar}><td>{p.label}</td><td className="r">{num(p.total)}</td><td className="r">{num(p.fresh)}</td><td className="r">{num(p.stale)}</td><td className="r">{num(p.unknown)}</td></tr>)}</tbody></table>
        </div>
      </Card>
      <Card span={6} i={4} title="Kde model nemá data a počítá s předpokladem" icon="alert">
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

/** Otevřené API: jedno místo, odkud si kdokoli stáhne samotná data.
 *
 *  Stránka Data doteď nabízela export katalogu — tedy seznam, co kde je.
 *  Tohle je ten druhý krok: samotné naměřené hodnoty, území a zařízení,
 *  bez obcházení dvaceti katalogů. Ukázky jsou živé odkazy, ne obrázky
 *  v dokumentaci; kdo na ně klikne, vidí odpověď hned.
 */
interface ApiIndex {
  verze: string;
  rozsah: { kraj: number; roky: number[]; hodnoty: number; ukazatele: number; uzemi: number; zarizeni: number; fakta: number; katalog: number };
  cesty: Record<string, string>;
}

const CESTY: { cesta: string; nazev: string; popis: string; parametry: string }[] = [
  { cesta: "/api/v1", nazev: "Rozcestník", popis: "Co tu je, kolik toho je a jak se ptát.", parametry: "—" },
  { cesta: "/api/v1/hodnoty", nazev: "Naměřené hodnoty", popis: "Jeden řádek je jedno číslo: území, ukazatel, rok, hodnota.", parametry: "ukazatel, uzemi, uroven, od, do, limit, offset, format" },
  { cesta: "/api/v1/ukazatele", nazev: "Registr ukazatelů", popis: "Co zkratka znamená, v čem se měří, kdo je původce.", parametry: "oblast, hledat, format" },
  { cesta: "/api/v1/uzemi", nazev: "Území", popis: "Obce, ORP, okresy a kraj i s kódy RÚIAN.", parametry: "uroven, hledat, format" },
  { cesta: "/api/v1/fakta", nazev: "Nečíselné údaje", popis: "Text s datem platnosti a odkazem na zdroj.", parametry: "uzemi, klic, format" },
  { cesta: "/api/v1/zarizeni", nazev: "Zařízení a zastávky", popis: "Body v území včetně souřadnic.", parametry: "druh, obec, format" },
  { cesta: "/api/v1/katalog", nazev: "Katalog sad", popis: "Datové sady i s odkazy na originál.", parametry: "hledat, oblast, poskytovatel, limit, offset, format" },
  { cesta: "/api/v1/zdroje", nazev: "Zdroje", popis: "Odkud se sklízí a kdy naposledy.", parametry: "format" },
];

const UKAZKY: { popis: string; url: string }[] = [
  { popis: "Počet obyvatel všech obcí od roku 2020, jako CSV do tabulky", url: "/api/v1/hodnoty?ukazatel=110900&uroven=obec&od=2020&format=csv" },
  { popis: "Všechny hodnoty jedné obce", url: "/api/v1/hodnoty?uzemi=obec:569810" },
  { popis: "Které ukazatele se týkají zdravotnictví", url: "/api/v1/ukazatele?oblast=zdravotnictvi" },
  { popis: "Seznam ORP i s kódy RÚIAN", url: "/api/v1/uzemi?uroven=orp" },
  { popis: "Datové sady o dopravě", url: "/api/v1/katalog?hledat=doprava" },
];

function Api() {
  const idx = useApi<ApiIndex>("/v1");
  const r = idx.data?.rozsah;
  const [zkopirovano, setZkopirovano] = useState("");
  const zaklad = typeof window === "undefined" ? "" : window.location.origin;

  const kopiruj = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setZkopirovano(text);
      toast("ok", "Zkopírováno do schránky.");
      window.setTimeout(() => setZkopirovano(""), 2000);
    } catch {
      toast("warn", "Schránka není dostupná, zkopírujte odkaz ručně.");
    }
  };

  return (
    <div className="stack-y">
      <Card i={0} title="Všechna data ke stažení" icon="database"
        actions={<a className="btn btn-sm" href="/api/docs" target="_blank" rel="noopener noreferrer"><Icon name="external" size={15} /> Technická dokumentace</a>}>
        <p className="small muted" style={{ margin: "0 0 14px" }}>
          Čísla, území a zařízení, která KAM posbíral, si stáhnete do tabulky nebo vlastní aplikace —
          bez klíče, bez registrace a bez omezení počtu dotazů. <code>/api/v1</code> má zapnutý CORS,
          takže jde volat i z prohlížeče na jiném webu.
        </p>
        {r && (
          <div className="facts-list">
            <div className="fact-row"><span>Naměřených hodnot</span><span className="num">{num(r.hodnoty)}</span></div>
            <div className="fact-row"><span>Ukazatelů</span><span className="num">{num(r.ukazatele)}</span></div>
            <div className="fact-row"><span>Území</span><span className="num">{num(r.uzemi)}</span></div>
            <div className="fact-row"><span>Zařízení a zastávek</span><span className="num">{num(r.zarizeni)}</span></div>
            <div className="fact-row"><span>Datových sad v katalogu</span><span className="num">{num(r.katalog)}</span></div>
            <div className="fact-row"><span>Roky</span><span>{r.roky[0]}–{r.roky[1]}</span></div>
          </div>
        )}
        <p className="xsmall mute" style={{ marginTop: 12 }}>
          Licence dat je ta, kterou určil původní zdroj; najdete ji u každé sady v katalogu. Kód aplikace je pod licencí MIT.
        </p>
      </Card>

      <Card i={1} title="Vyzkoušejte si to" icon="play">
        <p className="small muted" style={{ marginTop: 0 }}>Každý odkaz otevře v nové záložce skutečnou odpověď.</p>
        {UKAZKY.map((u) => (
          <div className="api-ukazka" key={u.url}>
            <span className="api-popis">{u.popis}</span>
            <code className="api-url">{u.url}</code>
            <span className="api-akce">
              <button className="icon-btn sm" onClick={() => kopiruj(zaklad + u.url)} aria-label="Kopírovat odkaz" title="Kopírovat odkaz">
                <Icon name={zkopirovano === zaklad + u.url ? "check" : "copy"} size={15} />
              </button>
              <a className="icon-btn sm" href={u.url} target="_blank" rel="noopener noreferrer" aria-label="Otevřít v nové záložce" title="Otevřít v nové záložce"><Icon name="external" size={15} /></a>
            </span>
          </div>
        ))}
      </Card>

      <Card i={2} title="Všechny adresy API" icon="layers" flush>
        <div className="table-wrap" style={{ margin: 0, padding: "0 var(--card-pad) var(--card-pad)" }}>
          <table className="table">
            <thead><tr><th>Adresa</th><th>Co vrací</th><th>Parametry</th></tr></thead>
            <tbody>
              {CESTY.map((c) => (
                <tr key={c.cesta}>
                  <td><a className="ds-title" href={c.cesta} target="_blank" rel="noopener noreferrer">{c.cesta}</a></td>
                  <td className="small"><strong>{c.nazev}</strong><br /><span className="mute">{c.popis}</span></td>
                  <td className="xsmall mute">{c.parametry}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card i={3} title="Formáty" icon="download">
        <div className="facts-list">
          <div className="fact-row"><span><code>format=json</code></span><span className="mute small">výchozí, po stránkách a s celkovým počtem</span></div>
          <div className="fact-row"><span><code>format=csv</code></span><span className="mute small">do Excelu a jiných tabulek (s BOM, aby seděla diakritika)</span></div>
          <div className="fact-row"><span><code>format=ndjson</code></span><span className="mute small">jeden řádek = jeden záznam, pro velké objemy</span></div>
        </div>
        <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
          CSV a NDJSON se posílají průběžně a nemají strop — stáhne se jimi i celá databáze najednou.
          JSON vrací po <code>limit</code> položkách a v poli <code>dalsi</code> posílá adresu další stránky.
        </p>
      </Card>

      <Card i={4} title="Klient do příkazové řádky" icon="chart">
        <p className="small muted" style={{ marginTop: 0 }}>
          Ve zdrojovém kódu je <code>scripts/kam.py</code>. Stačí mu Python, nic dalšího se neinstaluje.
        </p>
        <pre className="api-kod"><code>{`python kam.py info
python kam.py ukazatele --hledat lékař
python kam.py data --ukazatel 110900 --uzemi obec:569810
python kam.py stahni hodnoty --format csv --do-souboru vse.csv`}</code></pre>
      </Card>
    </div>
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
          <a className="btn" href="/api/datasets/export.csv"><Icon name="download" size={16} /> Stáhnout katalog (CSV)</a>
          <Link className="btn btn-primary" to="/data?tab=api"><Icon name="share" size={16} /> Otevřené API</Link>
        </div>
      </DataHook>
      <div className="stats-row" style={{ marginBottom: "var(--gap)" }}>
        <Stat i={0} label="Funkčních datových sad" value={num(d?.verified ?? null)} sub={d ? `z ${num(d.total)} v katalogu` : ""} />
        <Stat i={1} label="Poskytovatelů" value={num(d?.publishers ?? null)} sub="stát, kraje, města a další" />
        <Stat i={2} label="Funkčních sad od krajů" value={num(d?.kraje ?? null)} sub="včetně krajských portálů" />
        <Stat i={3} label="Načteno do modelu" value={num(d?.loaded ?? null)} sub="statistiky ČSÚ a data kraje" />
        <Stat i={4} label="Bez souboru s daty" value={num(d ? d.broken + d.no_link + d.pages : null)} sub="webová stránka, mrtvý nebo chybějící odkaz" />
      </div>
      <Tabs label="Sekce" value={tab} onChange={(v) => setQuery({ tab: v === "katalog" ? null : v, page: null })}
        tabs={[{ value: "katalog", label: "Katalog", icon: "database", count: d?.verified }, { value: "zdroje", label: "Zdroje", icon: "layers", count: d?.publishers }, { value: "potreby", label: "Chybějící data", icon: "gauge" }, { value: "api", label: "API", icon: "share" }, { value: "metodika", label: "Metodika", icon: "book" }]} />
      <div style={{ "--i": 0 } as CSSProperties}>
        {tab === "katalog" && <Catalog sources={d} />}
        {tab === "zdroje" && <SourcesTab data={d} />}
        {tab === "api" && <Api />}
        {tab === "potreby" && <Needs />}
        {tab === "metodika" && <Methods />}
      </div>
    </>
  );
}
