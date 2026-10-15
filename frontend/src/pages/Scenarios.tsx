// Scénáře: vlevo se scénář staví, vpravo se čte.
//
// Levý panel je krátký a pracovní: území, zásahy, předpoklady. U každého
// zásahu stojí doporučení, KDE ho dát — pořadí obcí podle toho, kolik lidí
// by z něj mělo prospěch (analytics/umisteni.py). Zásah bez odpovědi na
// otázku „kde“ je jen číslo; s ní se dá hned přepnout na místo, které dává
// smysl, a výsledek se přepočítá.
//
// Pravý panel se čte odshora: jedna věta, jedna tabulka ukazatelů k vybranému
// roku, varování a pak teprve podrobnosti v záložkách. Vysvětlení metody jsou
// pod ikonou „i“, ne v ploše.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChartSwitch, Heatmap, LineChart, Legend } from "../components/charts";
import { Erb } from "../components/Erb";
import { Icon, PILLAR_ICON } from "../components/Icon";
import { TerritoryPicker } from "../components/TerritoryPicker";
import { Card, Empty, ErrorBox, InfoHint, KindTag, Modal, PageHeader, Segmented, Tabs } from "../components/ui";
import { api, ApiError, invalidate, useApi } from "../lib/api";
import { date, kc, num, signed } from "../lib/format";
import { setQuery, useLocation, useNahled } from "../lib/router";
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
interface Misto { id: string; name: string; poradi: number; hodnota: number; mezera: number; prinos: number; vaha: number; pasmo: string }
interface Doporuceni {
  available: boolean; reason?: string; z: number;
  ukazatel: { name: string; unit: string };
  co: string; pravidlo: string; pozn_dat: string;
  vase: { obce: (Misto & { median_pasma: number })[] } | null;
  zebricek: Misto[];
}

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

/** Doporučení „kde“ pro jeden druh zásahu a jedno území. Odpověď se drží
 *  v paměti stránky: posuvníky zásahu se hýbou stokrát a pořadí obcí se
 *  přitom nemění, takže by se server ptal pořád na totéž. */
const pamet = new Map<string, Doporuceni>();
function useDoporuceni(type: string, tid: string): Doporuceni | null {
  const klic = `${type}|${tid}`;
  const [d, setD] = useState<Doporuceni | null>(pamet.get(klic) ?? null);
  useEffect(() => {
    const hotove = pamet.get(klic);
    if (hotove) { setD(hotove); return; }
    setD(null);
    let zruseno = false;
    api<Doporuceni>("/umisteni", { body: { zasah: type, obce: tid.startsWith("obec:") ? [tid] : [], kraj: 86, pocet: 5 } })
      .then((r) => { pamet.set(klic, r); if (!zruseno) setD(r); })
      .catch(() => { if (!zruseno) setD(null); });
    return () => { zruseno = true; };
  }, [klic]);
  return d;
}

/** Kde zásah dává smysl: kde stojí vybrané území a kam se dá přepnout. */
function Kde({ type, tid, onPick }: { type: string; tid: string; onPick: (id: string) => void }) {
  const d = useDoporuceni(type, tid);
  if (!d) return <div className="sc-kde"><span className="skeleton" style={{ height: 38, width: "100%" }} /></div>;
  if (!d.available) return null;
  const tady = d.vase?.obce[0];
  const nej = d.zebricek.filter((m) => m.id !== tid).slice(0, 4);
  return (
    <div className="sc-kde">
      <div className="sc-kde-hlava">
        <span className="sc-kde-nadpis">Kde to dává smysl</span>
        <InfoHint label="Jak se doporučení počítá">
          {d.pravidlo} Ukazatel: {d.ukazatel.name}. {d.pozn_dat}
        </InfoHint>
      </div>
      {tady ? (
        <p className="sc-kde-tady">
          <strong>Tady: {tady.poradi}. z {d.z}</strong>
          {tady.mezera > 0
            ? <> — o {num(tady.mezera, 0)} % pod obvyklou úrovní obcí stejné velikosti</>
            : <> — na obvyklé úrovni nebo lepší, zásah zde pomůže málo</>}
        </p>
      ) : (
        <p className="sc-kde-tady">Pořadí obcí v kraji, kde by zásah pomohl nejvíc:</p>
      )}
      <div className="sc-kde-chips">
        {nej.map((m) => (
          <button key={m.id} type="button" className="sc-chip" onClick={() => onPick(m.id)} title={`${m.poradi}. místo · o ${num(m.mezera, 0)} % pod obvyklou úrovní · ${m.pasmo}`}>
            <Erb id={m.id} name={m.name} size={18} />
            <span>{m.name}</span>
            <b>{m.poradi}.</b>
          </button>
        ))}
      </div>
    </div>
  );
}

type Zalozka = "obyvatele" | "skoly" | "postup" | "naklady" | "kam";

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
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState("");
  const [rok, setRok] = useState<number>(2040);
  const [zalozka, setZalozka] = useState<Zalozka>("obyvatele");
  const [kamZasah, setKamZasah] = useState<string>("");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tid, ivs, assume]);

  const update = (i: number, key: string, v: number | string) => setIvs((all) => all.map((iv, j) => (j === i ? { ...iv, params: { ...iv.params, [key]: v } } : iv)));
  const remove = (i: number) => setIvs((all) => all.filter((_, j) => j !== i));
  const add = (type: string) => { if (cat.data) { setIvs((all) => (all.some((i) => i.type === type) ? all : [...all, defaults(cat.data!, type)])); setMenu(false); } };

  /** Zásahy seskupené podle oblasti — nabídka „přidat zásah“. */
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
  const aktivniSada = useMemo(() => (cat.data?.sady ?? []).find((s) =>
    s.ivs.length === ivs.length && s.ivs.every((a, i) => a.type === ivs[i]?.type))?.key, [cat.data, ivs]);

  /** Jedna věta o tom, co zásah dělá, dřív než jakýkoli graf. Všechno v ní je
   *  z výsledku: rok horizontu, rozdíl obyvatel a počet varování modelu. */
  const verdict = useMemo(() => {
    if (!res?.available) return "";
    if (!ivs.length) return `Bez zásahu: výhled území do roku ${lastYear ?? ""}. Přidejte zásah vlevo.`;
    const w = res.warnings.scenario.length;
    const move = popDelta === null || Math.round(popDelta) === 0
      ? `se zásah do roku ${lastYear ?? ""} na počtu obyvatel prakticky neprojeví`
      : `bude v roce ${lastYear ?? ""} o ${num(Math.abs(popDelta))} obyvatel ${popDelta > 0 ? "víc" : "méně"} než bez zásahu`;
    return `Podle modelu ${move}. ${w ? `Model k tomu hlásí ${w} varování.` : "Žádné varování nehlásí."}`;
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

  // Záložky, které dávají smysl pro tenhle výsledek. Škola bez dat o školách
  // nebo „náklady“ bez zásahu by byly prázdná stránka.
  const zalozky: { value: Zalozka; label: string }[] = [
    { value: "obyvatele", label: "Obyvatelé" },
    ...(kapacity.length ? [{ value: "skoly" as Zalozka, label: "Školy" }] : []),
    ...(ivs.length && res?.chain.length ? [{ value: "postup" as Zalozka, label: "Jak to působí" }] : []),
    ...(ivs.length ? [{ value: "naklady" as Zalozka, label: "Náklady" }, { value: "kam" as Zalozka, label: "Kam umístit" }] : []),
  ];
  const aktZalozka = zalozky.some((z) => z.value === zalozka) ? zalozka : "obyvatele";
  const kamTyp = ivs.some((i) => i.type === kamZasah) ? kamZasah : ivs[0]?.type ?? "";
  const prikazy = ivs.length > 0;

  return (
    <>
      <PageHeader
        title={<>Scénáře <InfoHint label="Co jsou scénáře">Zvolte území a zásah (nová výstavba, ordinace, spoje…). Model spočítá výhled dvakrát, bez zásahu a se zásahem, a ukáže rozdíl. Je to odhad z předpokladů, které můžete změnit, ne předpověď.</InfoHint></>}
        actions={
          <>
            <button className="btn" onClick={share} disabled={!prikazy}><Icon name="link" size={16} /> Zkopírovat odkaz</button>
            <button className="btn btn-primary" disabled={!prikazy}
              onClick={() => { setName(`${res?.territory.name ?? ""}: ${ivs.map((i) => cat.data?.interventions[i.type]?.label).join(" + ")}`.slice(0, 110)); setSaveOpen(true); }}>
              <Icon name="save" size={16} /> Uložit scénář
            </button>
          </>
        } />

      <div className="sc">
        {/* ------------------------------------------------------ stavba */}
        <div className="sc-stavba stack-y">
          <Card i={0} title="Území" icon="pin">
            <TerritoryPicker value={tid} onChange={(id) => setTid(id)} label="Obec, ORP, okres nebo kraj" />
          </Card>

          <Card i={1} title="Zásahy" icon="split"
            actions={ivs.length ? <button className="btn btn-quiet btn-sm" onClick={() => setIvs([])}>Odebrat vše</button> : undefined}>
            {!ivs.length && (
              <>
                <div className="sc-start-nadpis">
                  <span>Začněte hotovým scénářem</span>
                  <InfoHint label="Co to je">Typické otázky, se kterými obce přicházejí. Kliknutím se nastaví zásahy, které pak můžete libovolně upravit.</InfoHint>
                </div>
                <div className="sc-sady">
                  {(cat.data?.sady ?? []).map((s) => (
                    <button key={s.key} className={`sc-sada${aktivniSada === s.key ? " is-on" : ""}`} title={s.otazka}
                      onClick={() => setIvs(s.ivs.map((i) => ({ type: i.type, params: { ...i.params } })))}>
                      <Icon name={PILLAR_ICON[s.pillar]} size={16} /><span>{s.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="sc-zasahy">
              {ivs.map((iv, i) => {
                const spec = cat.data?.interventions[iv.type];
                if (!spec) return null;
                return (
                  <div className="sc-zasah" key={`${iv.type}${i}`}>
                    <div className="sc-zasah-hlava">
                      <strong><Icon name={PILLAR_ICON[spec.pillar]} size={16} /> {spec.label}</strong>
                      {cat.data?.help[iv.type] && <InfoHint label={`Co dělá: ${spec.label}`}>{cat.data.help[iv.type]}</InfoHint>}
                      <span className="navbar-spacer" />
                      <button className="icon-btn sm" onClick={() => remove(i)} aria-label={`Odebrat ${spec.label}`}><Icon name="trash" size={15} /></button>
                    </div>
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
                    <Kde type={iv.type} tid={tid} onPick={setTid} />
                  </div>
                );
              })}
            </div>

            <div className="sc-pridat">
              <button className="btn btn-sm" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name="plus" size={15} /> Přidat zásah</button>
              {menu && (
                <div className="sc-menu" role="menu">
                  {skupiny.map((g) => (
                    <div key={g.pillar} className="sc-menu-skupina">
                      <span className="sc-menu-nadpis"><Icon name={PILLAR_ICON[g.pillar]} size={13} /> {g.label}</span>
                      {g.items.map(([k, v]) => (
                        <button key={k} role="menuitem" className="sc-menu-polozka" disabled={ivs.some((x) => x.type === k)} onClick={() => add(k)} title={cat.data?.help[k]}>
                          {v.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {res?.available && (
            <Card i={2} title="Předpoklady" icon="sliders"
              actions={<>
                <InfoHint label="Co jsou předpoklady">Čísla, se kterými model počítá, např. kolik lidí bydlí v novém bytě. Každé má vysvětlení a můžete ho přepsat.</InfoHint>
                {Object.keys(assume).length > 0 && <button className="btn btn-quiet btn-sm" onClick={() => setAssume({})}>Výchozí</button>}
              </>}>
              <details className="sc-rozbal">
                <summary>Zobrazit a upravit ({res.assumptions.length})</summary>
                <div className="stack-y" style={{ marginTop: 12 }}>
                  {res.assumptions.map((a) => (
                    <label className="field" key={a.key}>
                      <span className="field-label">{a.label} <InfoHint label={`Proč: ${a.label}`}>{a.why}</InfoHint></span>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <input className="input" type="number" step="any" value={assume[a.key] ?? a.value} onChange={(e) => setAssume((s) => ({ ...s, [a.key]: Number(e.target.value) }))} style={{ maxWidth: 140 }} />
                        <span className="small mute">{a.unit}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </details>
            </Card>
          )}

          {(saved.data?.length ?? 0) > 0 && (
            <Card i={3} title="Uložené scénáře" icon="save">
              <details className="sc-rozbal">
                <summary>Zobrazit ({saved.data!.length})</summary>
                <div className="list" style={{ marginTop: 8 }}>
                  {saved.data!.map((s) => (
                    <div className="list-row" key={s.id}>
                      <button className="list-main" style={{ background: "none", border: 0, textAlign: "left", cursor: "pointer", padding: 0 }} onClick={() => { setTid(s.territory); setIvs(s.interventions); }}>
                        <span className="list-title">{s.name}</span><span className="list-sub">{s.territory_name} · {date(s.created_at)}</span>
                      </button>
                      <button className="icon-btn sm" aria-label="Smazat scénář" onClick={async () => { await api(`/scenarios/${s.id}`, { method: "DELETE" }); invalidate("/scenarios"); saved.reload(); }}><Icon name="trash" size={15} /></button>
                    </div>
                  ))}
                </div>
              </details>
            </Card>
          )}
        </div>

        {/* ----------------------------------------------------- výsledek */}
        <div className="sc-vysledek stack-y">
          <ErrorBox error={err} />
          {res && !res.available && <Card><Empty icon="alert" title="Scénář pro toto území spočítat nejde">{res.reason}</Empty></Card>}
          {res?.available && (
            <>
              <div className="sc-verdikt-radek">
                <div style={{ minWidth: 0 }}>
                  <div className="sc-uzemi"><KindTag kind="SCÉNÁŘ" /><Erb id={res.territory.id} name={res.territory.name} size={26} /><h2>{res.territory.name}</h2></div>
                  <p className="sc-verdikt">{verdict}{busy && <span className="sc-pocita"> Počítám…</span>}</p>
                </div>
                <Segmented size="sm" label="Stav k roku" value={String(rok)} onChange={(v) => setRok(Number(v))}
                  options={HORIZONTY.map((y) => ({ value: String(y), label: String(y) }))} />
              </div>

              <div className="sc-dlazdice" role="group" aria-label={`Ukazatele v roce ${rok}`}>
                {[["population", "Obyvatelé"], ["zs_util", "Vytížení ZŠ"], ["tax", "Daňové příjmy"]].map(([k, l]) => {
                  const v = vRoce[k];
                  const hodnota = k === "zs_util" ? (v?.scenario != null ? `${num(v.scenario, 1)} %` : "—") : k === "tax" ? kc(v?.scenario ?? null) : num(v?.scenario ?? null);
                  const d = v?.delta ?? 0;
                  return (
                    <div className="sc-dlazdice-bunka" key={k}>
                      <span className="sc-dlazdice-popis">{l} · {rok}</span>
                      <strong className="num">{hodnota}</strong>
                      {ivs.length > 0 && <span className={`sc-pilulka ${d ? (d > 0 ? "je-plus" : "je-minus") : ""}`}>{d ? signed(d, k === "zs_util" ? 1 : 0, k === "zs_util" ? " p. b." : "") : "beze změny"}</span>}
                    </div>
                  );
                })}
              </div>

              {res.warnings.scenario.length > 0 && (
                <div className="stack-y" style={{ gap: 8 }}>
                  {res.warnings.scenario.map((w) => (
                    <div className={`warn-card lvl-${w.level}`} key={w.key + w.year}>
                      <Icon name="alert" size={18} />
                      <span className="wc-title">{w.title}</span>
                      <span className="wc-text">{w.text} {w.suggest && !ivs.some((i) => i.type === w.suggest) && cat.data?.interventions[w.suggest] && <button className="btn btn-sm btn-quiet" onClick={() => add(w.suggest)}>Přidat řešení <Icon name="arrow-right" size={14} /></button>}</span>
                    </div>
                  ))}
                </div>
              )}

              <Card flush>
                <div className="sc-zalozky"><Tabs label="Podrobnosti" value={aktZalozka} onChange={setZalozka} tabs={zalozky} /></div>
                <div className="sc-obsah">
                  {aktZalozka === "obyvatele" && (
                    <ChartSwitch id="scenare-obyvatele" views={[
                      {
                        key: "cesty", label: "Dvě cesty", icon: "trend-up", render: () => (
                          <>
                            <LineChart ariaLabel="Obyvatelé bez zásahu a se zásahem" height={260} series={[
                              { key: "b", label: "Bez zásahu", color: "var(--text-mute)", dashed: true, points: res.baseline.map((r) => ({ year: r.year, value: r.population })) },
                              { key: "s", label: "Se zásahem", color: "var(--accent)", width: 2.6, points: res.scenario.map((r) => ({ year: r.year, value: r.population })) },
                            ]} />
                            <Legend items={[{ label: "Bez zásahu", color: "var(--text-mute)", dashed: true }, { label: "Se zásahem", color: "var(--accent)" }]} />
                          </>
                        ),
                      },
                      {
                        key: "rozdil", label: "Jen rozdíl", icon: "split", render: () => (
                          <LineChart ariaLabel="Rozdíl mezi scénářem a stavem bez zásahu" height={260} yZero
                            format={(v) => signed(v, 0)} series={[{
                              key: "d", label: "Rozdíl", color: "var(--accent)", width: 2.6,
                              points: res.scenario.map((r, i) => ({ year: r.year, value: r.population - (res.baseline[i]?.population ?? r.population) })),
                            }]} />
                        ),
                      },
                      {
                        key: "mrizka", label: "Všechny ukazatele", icon: "grid", render: () => {
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
                  )}

                  {aktZalozka === "skoly" && (
                    <ChartSwitch id="scenare-kapacity" views={kapacity.map((k) => ({
                      key: k.key, label: k.label, icon: "school", render: () => (
                        <>
                          <LineChart ariaLabel={`Vytížení ${k.label}`} height={240} unit="%" format={(v) => `${num(v, 0)} %`}
                            refLine={{ value: 100, label: "Kapacita 100 %" }} series={[
                              { key: "b", label: "Bez zásahu", color: "var(--text-mute)", dashed: true, points: k.b },
                              { key: "s", label: "Se zásahem", color: "var(--warn)", points: k.s },
                            ]} />
                          <p className="xsmall mute" style={{ marginTop: 8 }}>{k.cap}. Nad 100 % je dětí víc než míst.</p>
                        </>
                      ),
                    }))} />
                  )}

                  {aktZalozka === "postup" && (
                    <div className="chain">
                      {res.chain.map((s, i) => (
                        <div className={`chain-step ${s.tag === "ZÁSAH" ? "is-zasah" : ""}`} key={i}>
                          <span className="chain-dot">{s.tag === "ZÁSAH" ? <Icon name="plus" size={14} /> : i}</span>
                          <span className="chain-body"><strong>{s.label}</strong><span className="row"><KindTag kind={s.tag} />{s.detail && <span className="xsmall mute">{s.detail}</span>}</span></span>
                        </div>
                      ))}
                    </div>
                  )}

                  {aktZalozka === "naklady" && (
                    <>
                      <table className="sc-kpi">
                        <tbody>
                          <tr><th scope="row">Investice jednorázově</th><td className="r num strong">{kc(res.costs.capex)}</td></tr>
                          <tr><th scope="row">Provoz za rok</th><td className="r num strong">{kc(res.costs.opex_year)}</td></tr>
                          <tr><th scope="row">Daně navíc za rok ({lastYear})</th><td className="r num strong">{kc(res.costs.tax_delta_year)}</td></tr>
                        </tbody>
                      </table>
                      <p className="xsmall mute" style={{ marginTop: 10 }}>Jsou to předpoklady modelu, ne rozpočet. <InfoHint label="Odkud čísla jsou">{res.method}</InfoHint></p>
                    </>
                  )}

                  {aktZalozka === "kam" && kamTyp && <Kam type={kamTyp} tid={tid} typy={ivs.map((i) => ({ value: i.type, label: cat.data?.interventions[i.type]?.label ?? i.type }))} onTyp={setKamZasah} onPick={setTid} />}
                </div>
              </Card>

              <details className="sc-rozbal sc-srovnani">
                <summary>Srovnání všech ukazatelů po letech</summary>
                <div className="table-wrap" style={{ marginTop: 8 }}>
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
              </details>
            </>
          )}
          {!res && !err && <span className="skeleton" style={{ height: 420, width: "100%" }} />}
        </div>
      </div>

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Uložit scénář"
        footer={<><button className="btn btn-quiet" onClick={() => setSaveOpen(false)}>Zrušit</button><button className="btn btn-primary" disabled={!name.trim()} onClick={save}>Uložit scénář</button></>}>
        <label className="field"><span className="field-label">Název scénáře</span><input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
      </Modal>
    </>
  );
}

/** Záložka „Kam umístit“: celé pořadí obcí pro jeden zásah. */
function Kam({ type, tid, typy, onTyp, onPick }: { type: string; tid: string; typy: { value: string; label: string }[]; onTyp: (t: string) => void; onPick: (id: string) => void }) {
  const d = useDoporuceni(type, tid);
  const nejvic = Math.max(1, ...(d?.zebricek ?? []).map((m) => m.mezera));
  return (
    <div className="sc-kam">
      {typy.length > 1 && <Segmented size="sm" label="Zásah" value={type} onChange={onTyp} options={typy} />}
      {!d && <span className="skeleton" style={{ height: 220, width: "100%" }} />}
      {d && !d.available && <p className="muted small">{d.reason}</p>}
      {d?.available && (
        <>
          <p className="small mute sc-kam-uvod">
            Obce kraje podle toho, kolik lidí by zásah dostihl: {d.co}.
            <InfoHint label="Jak se pořadí počítá">{d.pravidlo} {d.pozn_dat}</InfoHint>
          </p>
          <ol className="sc-kam-seznam">
            {d.zebricek.slice(0, 10).map((m) => (
              <li key={m.id} className={m.id === tid ? "is-tady" : ""}>
                <span className="sc-kam-poradi num">{m.poradi}.</span>
                <span className="sc-kam-obec"><Erb id={m.id} name={m.name} size={22} /><span><strong>{m.name}</strong><small>{m.pasmo}</small></span></span>
                <span className="sc-kam-drah" aria-hidden="true" title={`o ${num(m.mezera, 0)} % pod obvyklou úrovní`}><i style={{ width: `${(m.mezera / nejvic) * 100}%` }} /></span>
                <button className="btn btn-sm" onClick={() => onPick(m.id)} disabled={m.id === tid}>{m.id === tid ? "Vybráno" : "Zkusit zde"}</button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
