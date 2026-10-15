// The live profile of one territory: what is happening, since when, compared
// with the kraj, what it risks and where it is heading — with the source of
// every number one click away.

import { useEffect, useState, type CSSProperties } from "react";
import { openAssistant, setAssistantTerritory } from "../components/assistantBus";
import { Bullet, ChartSwitch, Columns, Dots, Gauge, LineChart, Legend, Sparkline, Waterfall } from "../components/charts";
import { Erb } from "../components/Erb";
import { Icon, PILLAR_ICON } from "../components/Icon";
import { PlanyKarta } from "../components/PlanyKarta";
import { Card, Empty, ErrorBox, InfoHint, KindTag, Modal, Severity } from "../components/ui";
import { api, useApi } from "../lib/api";
import { num, signed, withUnit } from "../lib/format";
import { Link, navigate } from "../lib/router";
import type { IndicatorCard, Profile as ProfileT, Risk, Trend } from "../lib/types";

function TrendChip({ t }: { t: Trend }) {
  if (t.kind === "malo_dat") return <span className="ind-trend neutralni">{t.label}</span>;
  if (t.kind === "vykyv") return <span className="ind-trend vykyv"><Icon name="spike" size={13} /> Výkyv</span>;
  if (t.kind === "stabilni") return <span className="ind-trend neutralni"><Icon name="flat" size={13} /> Stabilní</span>;
  return <span className={`ind-trend ${t.judgement ?? "neutralni"}`}><Icon name={t.direction === "roste" ? "trend-up" : "trend-down"} size={13} /> {signed(t.pct_per_year ?? 0, 1, " %/rok")}</span>;
}

/** Which shape suits this number.
 *
 *  Driven by what the indicator *is*, not by position in the grid, so the
 *  choice stays stable and means something: a share gets a dial, a count that
 *  exists for exactly one year gets its own marks, a yearly flow gets columns,
 *  a stock gets a filled area. The old page drew all of them as the same
 *  34-pixel line, which is why every pillar looked like the one above it. */
type Shape = "state" | "gauge" | "dots" | "bullet" | "bars" | "area" | "line";

function shapeOf(c: IndicatorCard): Shape {
  const pts = c.series.filter((p) => p.value !== null);
  if (c.unit === "ano/ne" || c.unit === "kategorie") return "state";
  // A dial needs no history, only a range, so shares are decided before the
  // one-point test — most Data KHK layers are a single-year snapshot.
  if (c.unit === "%" && c.value >= 0 && c.value <= 100) return "gauge";
  if (pts.length < 2) {
    if (c.compare && c.compare.value !== null) return "bullet";
    return Number.isInteger(c.value) && c.value <= 40 ? "dots" : "state";
  }
  if ((c.trend.outliers ?? []).length > 0) return "line";
  // Columns for a series that jumps every year, an area for one that drifts.
  // Flows (births, completed flats, migration) move a large share of their
  // own range from one year to the next and are separate yearly events, so
  // separate marks are the honest encoding; a stock like population creeps,
  // and joining its years is what makes the direction visible.
  const vals = pts.map((p) => p.value as number);
  const range = Math.max(...vals) - Math.min(...vals);
  const steps = vals.slice(1).map((v, i) => Math.abs(v - vals[i]));
  const jitter = range > 0 ? steps.reduce((a, b) => a + b, 0) / steps.length / range : 0;
  return !c.derived && jitter > 0.24 ? "bars" : "area";
}

const TREND_COLOR = { zhorseni: "var(--bad)", zlepseni: "var(--ok)" } as Record<string, string>;

function IndicatorTile({ c, onOpen, i, lead }: { c: IndicatorCard; onOpen: () => void; i: number; lead?: boolean }) {
  const cmpLabel = c.compare ? { lepsi: "lepší než kraj", horsi: "horší než kraj", srovnatelne: "jako kraj" }[c.compare.verdict] : "";
  const shape = shapeOf(c);
  const color = TREND_COLOR[c.trend.judgement ?? ""] ?? "var(--accent)";
  const outliers = (c.trend.outliers ?? []).map((o) => o.year);
  const value = c.unit === "%" || c.unit === "ano/ne" ? withUnit(c.value, c.unit) : num(c.value);
  return (
    <div className={`ind reveal is-interactive shape-${shape}${lead ? " is-lead" : ""}`} role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      style={{ "--i": i, cursor: "pointer" } as CSSProperties} data-ctx={`indicator:${c.code}`} data-ctx-label={c.name} data-ctx-value={`${c.name}: ${withUnit(c.value, c.unit)} (${c.year})`}>
      <span className="ind-name">{c.name}</span>
      <InfoHint label={`Jak to víme: ${c.name}`}>
        <strong>{c.derived ? "Odvozený ukazatel" : c.source}</strong>
        {c.formula && <p>Výpočet: {c.formula}</p>}
        {c.origin && <p>Původce: {c.origin}</p>}
        {c.text && <p>{c.text}</p>}
        <p className="mute">Poslední údaj za rok {c.year}.</p>
      </InfoHint>
      <div className="ind-body">
        <span className="ind-value">{value}{c.unit && c.unit !== "%" && c.unit !== "ano/ne" && <small>{c.unit}</small>}</span>
        {shape === "gauge" && <Gauge value={c.value} reference={c.compare?.value ?? null} color={color} label={`${c.name}: ${value}`} size={lead ? 92 : 68} />}
        {shape === "dots" && <Dots value={c.value} color={color} label={`${c.name}: ${value}`} />}
      </div>
      {(shape === "bars" || shape === "area" || shape === "line") && (
        <Sparkline points={c.series} ariaLabel={`Vývoj ${c.name}`} color={color} variant={shape} outliers={outliers}
          baseline={c.compare?.value ?? null} height={lead ? 56 : 34} />
      )}
      {shape === "gauge" && lead && <Sparkline points={c.series} ariaLabel={`Vývoj ${c.name}`} color={color} variant="area" height={38} />}
      <span className="ind-meta"><TrendChip t={c.trend} /><span>{c.year}</span></span>
      {c.compare && c.compare.value !== null && (
        <span className={`ind-cmp ${c.compare.verdict}`}>
          {shape !== "gauge" && shape !== "state" && shape !== "dots"
            ? <Bullet value={c.value} reference={c.compare.value} verdict={c.compare.verdict} /> : null}
          <span>Kraj {withUnit(c.compare.value, c.unit)} · {cmpLabel}</span>
        </span>
      )}
    </div>
  );
}

function SeriesModal({ tid, card, onClose }: { tid: string; card: IndicatorCard | null; onClose: () => void }) {
  const [data, setData] = useState<{ series: { year: number; value: number }[]; reference: { name: string; series: { year: number; value: number }[] } | null; trend: Trend | null } | null>(null);
  useEffect(() => {
    setData(null);
    if (card) api<typeof data>(`/territories/${tid}/series/${card.code}`).then(setData).catch(() => setData(null));
  }, [tid, card]);
  if (!card) return null;
  const t = data?.trend ?? card.trend;
  return (
    <Modal open={Boolean(card)} onClose={onClose} title={card.name} wide>
      <div className="row" style={{ marginBottom: 12 }}>
        <KindTag kind="FAKT" />{t.kind === "trend" && <KindTag kind="TREND" />}
        <span className="muted small">{card.derived ? `Výpočet: ${card.formula}` : `${card.source}${card.origin ? ` · ${card.origin}` : ""}`}</span>
      </div>
      {data ? (
        <ChartSwitch id={`profil-${card.code}`} views={[
          {
            key: "vyvoj", label: "Vývoj v čase", icon: "trend-up", render: () => (
              <>
                <LineChart ariaLabel={card.name} height={260} unit={card.unit === "%" ? "%" : ""}
                  series={[
                    { key: "t", label: "Území", color: "var(--accent)", points: data.series },
                    ...(data.reference ? [{ key: "r", label: data.reference.name, color: "var(--text-mute)", dashed: true, points: data.reference.series }] : []),
                  ]} />
                <Legend items={[{ label: "Toto území", color: "var(--accent)" }, ...(data.reference ? [{ label: data.reference.name, color: "var(--text-mute)", dashed: true }] : [])]} />
              </>
            ),
          },
          ...(data.series.length > 1 ? [{
            key: "sloupce", label: "Sloupce po letech", icon: "chart", render: () => (
              <Columns ariaLabel={`${card.name} po letech`} height={230}
                items={data.series.map((p) => ({ label: String(p.year), value: p.value }))} />
            ),
          }] : []),
          // Odchylka od srovnávacího území rok po roce. Dvě čáry blízko sebe se
          // čtou špatně; rozdíl mezi nimi je přesně to, co je na území jiné.
          ...(data.reference && data.reference.series.length > 1 ? [{
            key: "odchylka", label: `Rozdíl proti ${data.reference.name}`, icon: "split", render: () => {
              const ref = new Map(data.reference!.series.map((p) => [p.year, p.value]));
              return (
                <Waterfall ariaLabel={`Rozdíl proti ${data.reference!.name}`} height={230}
                  format={(v) => num(v, 1)}
                  steps={data.series.filter((p) => ref.has(p.year)).slice(-8)
                    .map((p) => ({ label: String(p.year), value: p.value - (ref.get(p.year) as number), total: true }))} />
              );
            },
          }] : []),
        ]} />
      ) : <span className="skeleton" style={{ height: 260, width: "100%" }} />}
      <div className="section-gap" />
      <div className="facts-list">
        <div className="fact-row"><span>Poslední hodnota</span><span>{withUnit(card.value, card.unit)} ({card.year})</span></div>
        <div className="fact-row"><span>Vyhodnocení vývoje</span><span>{t.label}{t.since ? ` od roku ${t.since}` : ""}</span></div>
        {t.pct_per_year !== undefined && <div className="fact-row"><span>Průměrná změna</span><span>{signed(t.pct_per_year, 2, " % ročně")}</span></div>}
        {t.p_value !== undefined && <div className="fact-row"><span>Jak jistý je trend <InfoHint label="Co znamená p">Čím menší číslo, tím méně pravděpodobné je, že by takový vývoj vznikl náhodou. Počítá se testem Mann–Kendall, který si poradí i s malými čísly a výkyvy.</InfoHint></span><span>p = {num(t.p_value, 3)}</span></div>}
        {(t.outliers ?? []).length > 0 && <div className="fact-row"><span>Jednorázové výkyvy <InfoHint label="Jak se výkyv pozná">Rok, kdy hodnota vybočila z obvyklého kolísání řady. Číslo v závorce říká, o kolik běžných odchylek (σ) vybočila.</InfoHint></span><span>{t.outliers!.map((o) => `${o.year} (${num(o.z, 1)} σ)`).join(", ")}</span></div>}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        {card.source_url && <a className="btn btn-sm" href={card.source_url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={15} /> Otevřít zdroj dat</a>}
        <button className="btn btn-sm btn-quiet" onClick={() => { onClose(); openAssistant(`Proč se ukazatel „${card.name}“ vyvíjí takto a co to znamená?`, tid); }}><Icon name="sparkle" size={15} /> Vysvětlit s asistentem</button>
      </div>
    </Modal>
  );
}

function RiskItem({ r }: { r: Risk }) {
  return (
    <div className="risk-card">
      <div className="rc-head"><span className="rc-title">{r.title}</span><Severity level={r.level} label={r.level_label} /></div>
      <p>{r.text}</p>
      <div className="row xsmall mute">
        <span>{{ trend: "Dlouhodobý trend", vykyv: "Jednorázový výkyv", vznikajici: "Vznikající riziko", opakovany: "Opakující se problém", stav: "Současný stav" }[r.kind] ?? r.kind}</span>
        <span>· důvěra {Math.round(r.confidence * 100)} %</span>{r.period && <span>· {r.period}</span>}
      </div>
      <details className="evidence">
        <summary><Icon name="chevron-right" size={13} /> Jak to víme?</summary>
        {r.evidence.map((e) => (
          <div className="ev-row" key={e.code}>
            <span>{e.name}: <strong>{withUnit(e.value, e.unit)}</strong> ({e.year})</span>
            {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="source-link"><Icon name="external" size={12} /><span>{e.source || "zdroj"}</span></a> : <span className="mute">{e.formula || e.source}</span>}
          </div>
        ))}
        {r.why.length > 0 && <div className="mute">Proč na tom záleží: {r.why.join(" · ")}</div>}
      </details>
      {r.interventions.length > 0 && (
        <div className="chips">
          <button className="chip-btn" onClick={() => navigate(`/scenare?t=${r.id.split(":").slice(0, 2).join(":")}&navrh=${r.type}`)}><Icon name="split" size={14} /> Co s tím udělat</button>
        </div>
      )}
    </div>
  );
}

export function Profile({ id }: { id: string }) {
  const { data, error, reload } = useApi<ProfileT>(`/territories/${id}`);
  const [open, setOpen] = useState<IndicatorCard | null>(null);
  const [pillar, setPillar] = useState<string | null>(null);
  useEffect(() => { setAssistantTerritory(id); }, [id]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  const t = data?.territory;
  const pillars = data?.pillars.filter((p) => !pillar || p.key === pillar) ?? [];
  return (
    <>
      <div className="profile-head">
        <div style={{ minWidth: 0 }}>
          <div className="crumbs">
            <Link to="/obce">Obce</Link>
            {t?.parent && <><Icon name="chevron-right" size={12} /><Link to={`/obce/${t.parent.id}`}>{t.parent.name}</Link></>}
          </div>
          <div className="profile-titul">
            {t && <Erb id={id} name={t.name} size={60} />}
            <h1>{t?.name ?? "…"}</h1>
          </div>
          {t && (
            <div className="profile-facts">
              <span>{{ obec: "Obec", orp: "Správní obvod ORP", okres: "Okres", kraj: "Kraj", cz: "Stát" }[t.level]}</span>
              {t.population !== null && <span><strong>{num(t.population)}</strong> obyvatel ({t.population_year})</span>}
              {t.area_km2 !== null && <span><strong>{num(t.area_km2, 1)}</strong> km²</span>}
              {t.okres && t.level === "obec" && <span>{t.okres}</span>}
              <span className="mute">srovnávací území: {data?.reference.name}</span>
              <InfoHint label="Jak číst profil">Ukazatele jsou rozdělené do oblastí (demografie, doprava, školství…). Kliknutím na oblast zobrazíte jen ji. Stav oblasti shrnuje její ukazatele: kolik se jich zhoršuje nebo je horší než {data?.reference.name} a kolik naopak.</InfoHint>
            </div>
          )}
        </div>
        <div className="page-header-actions">
          <Link className="btn" to={`/vyhled?t=${id}`}><Icon name="trend-up" size={16} /> Výhled</Link>
          <button className="btn" onClick={() => openAssistant(`Shrň, co se děje v území ${t?.name ?? ""} a co mu hrozí.`, id)}><Icon name="sparkle" size={16} /> Zeptat se asistenta</button>
          <Link className="btn btn-primary" to={`/scenare?t=${id}&navrh=1`}><Icon name="split" size={16} /> Navrhnout opatření</Link>
        </div>
      </div>

      {!data && <div className="grid"><div className="span-8"><span className="skeleton" style={{ height: 420, width: "100%" }} /></div><div className="span-4"><span className="skeleton" style={{ height: 420, width: "100%" }} /></div></div>}

      {data && (
        <>
          <div className="pillar-strip" role="toolbar" aria-label="Oblasti" style={{ "--n": data.pillars.length, "--n2": Math.ceil(data.pillars.length / 2) } as CSSProperties}>
            {data.pillars.map((p, i) => (
              <button key={p.key} className={`pillar-tile reveal ${pillar === p.key ? "is-on" : ""}`} style={{ "--i": i } as CSSProperties} aria-pressed={pillar === p.key} onClick={() => setPillar(pillar === p.key ? null : p.key)}>
                <span className="pt-top"><Icon name={PILLAR_ICON[p.key]} size={16} /><span className={`status-dot status-${p.status}`} /></span>
                <span className="pt-name">{p.label}</span>
                <span className="pt-status">{p.status_label}</span>
              </button>
            ))}
          </div>
          <div className="grid">
            <div className="span-8 stack-y">
              {pillars.map((p, pi) => (
                <Card key={p.key} i={pi} title={p.label} icon={PILLAR_ICON[p.key]} actions={<span className="pill"><span className={`status-dot status-${p.status}`} /> {p.status_label}</span>}>
                  {p.cards.length ? (
                    <div className="ind-grid">{p.cards.map((c, i) => <IndicatorTile key={c.code} c={c} i={i} lead={i === 0 && p.cards.length > 2} onOpen={() => setOpen(c)} />)}</div>
                  ) : <Empty title="Pro tuto oblast nejsou data">Co chybí, eviduje Data → Chybějící data.</Empty>}
                </Card>
              ))}
            </div>
            <div className="span-4 stack-y">
              <Card title="Rizika" icon="alert" i={1} actions={<InfoHint label="Co je riziko">Riziko hlásí pevné pravidlo nad zveřejněnými daty: nepříznivý dlouhodobý trend, opakující se problém nebo stav, který překročil stanovený práh či je výrazně horší než v kraji. Není to odhad ani názor. U malých obcí a krátkých řad je důvěra nižší, protože pár lidí tam pohne jakýmkoli podílem.</InfoHint>}>
                {data.risks.length ? data.risks.slice(0, 6).map((r) => <RiskItem key={r.id} r={r} />) : <Empty icon="check" title="Bez výrazných rizik">Pravidla v datech nenašla významný problém.</Empty>}
              </Card>
              <Card title="Výhled počtu obyvatel" icon="trend-up" i={2} actions={<KindTag kind="MODEL" />}>
                {data.outlook.milestones ? (
                  <div className="facts-list">
                    {data.outlook.milestones.map((m) => (
                      <div className="fact-row" key={m.year}><span>{m.year}</span><span className="num">{num(m.population)} <span className="mute xsmall">({num(m.lower)}–{num(m.upper)})</span></span></div>
                    ))}
                    <Link to={`/vyhled?t=${id}`} className="btn btn-sm btn-quiet">Celý výhled a předpoklady <Icon name="arrow-right" size={14} /></Link>
                  </div>
                ) : <p className="muted small">{data.outlook.reason}</p>}
              </Card>
              {(Object.keys(data.facts).length > 0 || data.pois) && (
                <Card title="Služby a infrastruktura" icon="home" i={3}>
                  <div className="facts-list">
                    {data.facts.posta && <div className="fact-row"><span>Pošta</span><span>{data.facts.posta.value}</span></div>}
                    {data.facts.kanalizace && <div className="fact-row"><span>Domy napojené na kanalizaci</span><span>{data.facts.kanalizace.value}</span></div>}
                    {data.facts.uzemni_plan && <div className="fact-row"><span>Územní plán</span><span>{data.facts.uzemni_plan.value}</span></div>}
                    {data.facts.hsoo && <div className="fact-row"><span>Hospodářsky a sociálně ohrožená oblast</span><span>{data.facts.hsoo.value}</span></div>}
                    {data.facts.isv_kategorie && <div className="fact-row"><span>Index sociálního vyloučení</span><span>kategorie {data.facts.isv_kategorie.value}</span></div>}
                    {(data.pois ?? []).map((p) => <div className="fact-row" key={p.kind}><span>{p.label}</span><span className="num">{num(p.count)}</span></div>)}
                  </div>
                  <p className="xsmall mute" style={{ marginTop: 8 }}>Zdroj: Data KHK (mapové služby kraje)</p>
                </Card>
              )}
              {t?.level === "obec" && <PlanyKarta tid={id} i={4} />}
              <Card title="Zdroje profilu" icon="book" i={5}>
                <div className="list">
                  {data.sources.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="list-row" data-ctx="dataset" data-ctx-label={s.label} data-ctx-url={s.url}>
                      <span className="list-main"><span className="list-title small">{s.label}</span>{s.origin && <span className="list-sub">{s.origin}</span>}</span>
                      <Icon name="external" size={14} />
                    </a>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
      <SeriesModal tid={id} card={open} onClose={() => setOpen(null)} />
    </>
  );
}
