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
import { Pruvodce } from "./Pruvodce";
import { Card, Empty, ErrorBox, InfoHint, KindTag, Modal, PageHeader, Segmented, Stat, Tabs } from "../components/ui";
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
interface Warning { key: string; level: string; year: number; title: string; text: string; suggest: string; suggest_params?: Record<string, number> | null; suggest_text?: string }
interface Navrh { available: boolean; reason?: string; territory: { id: string; name: string }; interventions: Iv[]; duvody: { type: string; label: string; duvod: string }[]; varovani_pred: number; varovani_po: number | null }
interface Result {
  available: boolean; reason?: string; territory: { id: string; name: string }; base_year: number; baseline: Row[]; scenario: Row[];
  warnings: { baseline: Warning[]; scenario: Warning[] }; metrics: { key: string; label: string; unit: string; values: { year: number; base: number | null; scenario: number | null; delta: number | null }[] }[];
  chain: { label: string; tag: string; detail?: string }[]; costs: { capex: number; opex_year: number; tax_delta_year: number };
  assumptions: { key: string; label: string; value: number; unit: string; why: string }[]; inputs: Record<string, number>; method: string; cache: { hit: boolean; ms: number; hits: number };
}
interface Saved { id: string; name: string; territory: string; territory_name: string; interventions: Iv[]; created_at: string; summary: { warnings: number } }
interface Misto { id: string; name: string; poradi: number; hodnota: number; mezera: number; prinos: number; vaha: number; pasmo: string; median_pasma?: number }
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
    const obec = tid.startsWith("obec:");
    api<Doporuceni>("/umisteni", { body: { zasah: type, obce: obec ? [tid] : [], kraj: 86, pocet: 5, uvnitr: obec ? null : tid } })
      .then((r) => { pamet.set(klic, r); if (!zruseno) setD(r); })
      .catch(() => { if (!zruseno) setD(null); });
    return () => { zruseno = true; };
  }, [klic]);
  return d;
}

/** Je to tady potřeba? U obce posudek proti obcím stejné velikosti, u ORP,
 *  okresu a kraje obce **uvnitř** území, kde to chybí nejvíc. Jiné obce
 *  mimo vybrané území se nenabízejí: kdo plánuje pro Jaroměř, nechce slyšet,
 *  že víc by to pomohlo v Trutnově. */
function Kde({ type, tid, onPick }: { type: string; tid: string; onPick: (id: string) => void }) {
  const d = useDoporuceni(type, tid);
  if (!d) return <div className="sc-kde"><span className="skeleton" style={{ height: 38, width: "100%" }} /></div>;
  if (!d.available) return null;
  const obec = tid.startsWith("obec:");
  const tady = d.vase?.obce[0];
  const jednotka = d.ukazatel.unit ? ` ${d.ukazatel.unit}` : "";
  const hint = <InfoHint label="Jak se to posuzuje">{d.pravidlo} Ukazatel: {d.ukazatel.name}. {d.pozn_dat}</InfoHint>;
  if (obec) {
    if (!tady) return null;
    const stav = tady.mezera >= 30 ? "chybi" : tady.mezera >= 10 ? "mirne" : "dost";
    const nadpis = { chybi: "Tady to chybí", mirne: "Tady je to mírně pod obvyklou úrovní", dost: "Tady je toho dost" }[stav];
    return (
      <div className={`sc-kde is-${stav}`}>
        <div className="sc-kde-hlava"><span className="sc-kde-nadpis">{nadpis}</span>{hint}</div>
        <p className="sc-kde-tady">
          Obec má <strong>{num(tady.hodnota, 2)}{jednotka}</strong>, obvyklá obec stejné velikosti ({tady.pasmo}) {num(tady.median_pasma ?? 0, 2)}{jednotka}.
          {stav === "dost" && " Opatření tu pomůže méně než jinde."}
        </p>
      </div>
    );
  }
  const nej = d.zebricek.filter((m) => m.mezera > 0).slice(0, 4);
  if (!nej.length) return <div className="sc-kde"><div className="sc-kde-hlava"><span className="sc-kde-nadpis">V tomto území nikde výrazně nechybí</span>{hint}</div></div>;
  return (
    <div className="sc-kde">
      <div className="sc-kde-hlava"><span className="sc-kde-nadpis">Kde v území chybí nejvíc</span>{hint}</div>
      <div className="sc-kde-chips">
        {nej.map((m) => (
          <button key={m.id} type="button" className="sc-chip" onClick={() => onPick(m.id)} title={`Spočítat pro obec ${m.name} · o ${num(m.mezera, 0)} % pod obvyklou úrovní obcí stejné velikosti`}>
            <Erb id={m.id} name={m.name} size={18} />
            <span>{m.name}</span>
            <b>−{num(m.mezera, 0)} %</b>
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
  const [name, setName] = useState("");
  const [rok, setRok] = useState<number>(2040);
  const [zalozka, setZalozka] = useState<Zalozka>("obyvatele");
  const [kamZasah, setKamZasah] = useState<string>("");
  const seq = useRef(0);
  // Průvodce vede k prvnímu výsledku; z odkazu s hotovým scénářem se rovnou čte výsledek.
  const [hotovo, setHotovo] = useState(Boolean(query.get("iv") || query.get("add") || query.get("navrh")));
  const [navrhInfo, setNavrhInfo] = useState<Navrh | null>(null);
  const [navrhBusy, setNavrhBusy] = useState(false);
  const [pridavam, setPridavam] = useState(false);

  useEffect(() => {
    const add = query.get("add");
    if (add && cat.data?.interventions[add] && !ivs.some((i) => i.type === add)) setIvs((v) => [...v, defaults(cat.data!, add)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat.data]);

  useEffect(() => {
    if (!nahled) setQuery({ t: tid, iv: ivs.length ? encode(ivs) : null, add: null, navrh: null });
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

  /** Opatření spočítaná z problémů území: co, kolik a proč (`simulate.navrh`). */
  const navrhni = async (id: string, jen?: string | null) => {
    setNavrhBusy(true);
    try {
      const n = await api<Navrh>(`/simulate/navrh/${encodeURIComponent(id)}${jen ? `?jen=${encodeURIComponent(jen)}` : ""}`);
      setTid(id);
      if (!n.available || !n.interventions.length) {
        setNavrhInfo(null); setHotovo(false);
        toast("warn", n.available ? "U tohoto území model nenašel problém, který by šlo vyřešit opatřením. Vyberte opatření sami." : (n.reason ?? "Návrh se nepodařilo spočítat."));
        return;
      }
      setNavrhInfo(n); setIvs(n.interventions); setHotovo(true); setPridavam(false);
    } catch (e) {
      setHotovo(false);
      toast("error", (e as Error).message);
    } finally { setNavrhBusy(false); }
  };
  useEffect(() => {
    const n = query.get("navrh");
    if (n) navrhni(query.get("t") ?? tid, n === "1" ? null : n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Doplní řešení z varování v potřebné velikosti. Když už scénář opatření
   *  má, přičte jen to, co chybí — varování se počítá ze scénáře, takže
   *  `suggest_params.pocet` je rozdíl, ne celek. */
  const doplnReseni = (w: Warning) => {
    if (!cat.data || !w.suggest_params) return;
    const spec = cat.data.interventions[w.suggest];
    if (!spec) return;
    const max = spec.params.pocet?.max ?? Infinity;
    setIvs((all) => {
      const i = all.findIndex((x) => x.type === w.suggest);
      if (i < 0) return [...all, { type: w.suggest, params: { ...defaults(cat.data!, w.suggest).params, ...w.suggest_params } }];
      return all.map((x, j) => j !== i ? x : { ...x, params: { ...x.params,
        pocet: Math.min(max, Number(x.params.pocet ?? 0) + Number(w.suggest_params!.pocet ?? 0)),
        rok: Math.min(Number(x.params.rok ?? 9999), Number(w.suggest_params!.rok ?? 9999)) } });
    });
  };

  const update = (i: number, key: string, v: number | string) => setIvs((all) => all.map((iv, j) => (j === i ? { ...iv, params: { ...iv.params, [key]: v } } : iv)));
  const remove = (i: number) => setIvs((all) => all.filter((_, j) => j !== i));

  const vRoce = useMemo(() => Object.fromEntries((res?.metrics ?? []).map((m) => [m.key, m.values.find((v) => v.year === rok) ?? m.values[m.values.length - 1]])), [res, rok]);
  const m2040 = useMemo(() => Object.fromEntries((res?.metrics ?? []).map((m) => [m.key, m.values[m.values.length - 1]])), [res]);
  const popDelta = m2040.population?.delta ?? null;
  const lastYear = res?.scenario[res.scenario.length - 1]?.year;
  /** Jedna věta o tom, co zásah dělá, dřív než jakýkoli graf. Všechno v ní je
   *  z výsledku: rok horizontu, rozdíl obyvatel a počet varování modelu. */
  const verdict = useMemo(() => {
    if (!res?.available) return "";
    if (!ivs.length) return `Bez opatření: výhled území do roku ${lastYear ?? ""}.`;
    const w = res.warnings.scenario.length;
    const move = popDelta === null || Math.round(popDelta) === 0
      ? `se opatření do roku ${lastYear ?? ""} na počtu obyvatel prakticky neprojeví`
      : `bude v roce ${lastYear ?? ""} o ${num(Math.abs(popDelta))} obyvatel ${popDelta > 0 ? "víc" : "méně"} než bez opatření`;
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
    ...(ivs.length ? [{ value: "naklady" as Zalozka, label: "Náklady" }, ...(tid.startsWith("obec:") ? [] : [{ value: "kam" as Zalozka, label: "Kde v území" }])] : []),
  ];
  const aktZalozka = zalozky.some((z) => z.value === zalozka) ? zalozka : "obyvatele";
  const kamTyp = ivs.some((i) => i.type === kamZasah) ? kamZasah : ivs[0]?.type ?? "";
  const prikazy = ivs.length > 0;

  return (
    <>
      <PageHeader
        title={<>Scénáře <InfoHint label="Co jsou scénáře">Zvolte území a opatření (nová výstavba, ordinace, spoje…). Model spočítá výhled dvakrát, bez opatření a s nimi, a ukáže rozdíl. Je to odhad z předpokladů, které můžete změnit, ne předpověď.</InfoHint></>}
        actions={
          hotovo ? (<>
            <button className="btn" onClick={share} disabled={!prikazy}><Icon name="link" size={16} /> Zkopírovat odkaz</button>
            <button className="btn btn-primary" disabled={!prikazy}
              onClick={() => { setName(`${res?.territory.name ?? ""}: ${ivs.map((i) => cat.data?.interventions[i.type]?.label).join(" + ")}`.slice(0, 110)); setSaveOpen(true); }}>
              <Icon name="save" size={16} /> Uložit scénář
            </button>
          </>) : undefined
        } />

      {!hotovo && cat.data && (
        <Pruvodce key={pridavam ? "pridat" : "novy"} interventions={cat.data.interventions} help={cat.data.help} sady={cat.data.sady ?? []}
          ulozene={saved.data ?? []} tid={tid} setTid={setTid} setIvs={setIvs} vytvor={(t) => defaults(cat.data!, t)} pridat={pridavam}
          onHotovo={() => { setHotovo(true); setPridavam(false); setNavrhInfo(null); }} onNavrh={(id) => navrhni(id)} navrhBusy={navrhBusy} onZrus={() => { setPridavam(false); setHotovo(ivs.length > 0); }} />
      )}
      {!hotovo && !cat.data && <span className="skeleton" style={{ height: 240, width: "100%" }} />}

      {hotovo && (
      <>
      <div className="toolbar-card reveal">
        <div className="toolbar-picker"><TerritoryPicker value={tid} onChange={(id) => setTid(id)} label="Obec, ORP, okres nebo kraj" /></div>
      </div>

      <div className="stack-y sc-sloupec">
          {navrhInfo && navrhInfo.territory.id === tid && (
            <Card i={0} className="sc-navrh" title={`Navrženo podle problémů území ${navrhInfo.territory.name}`} icon="sparkle"
              actions={<InfoHint label="Jak návrh vznikl">Model spočítal výhled bez opatření a vzal varování (školy, lékaři, péče o seniory), rizika území (úbytek, odliv, nezaměstnanost) a služby, kterých má obec výrazně méně než obvyklá obec stejné velikosti. Velikost každého opatření je spočítaná tak, aby problém zmizel nebo se srovnal s obvyklou úrovní. Všechno jde dál upravit.</InfoHint>}>
              <ul className="sc-navrh-seznam">
                {navrhInfo.duvody.map((d) => <li key={d.type}><strong>{d.label}</strong><span>{d.duvod}</span></li>)}
              </ul>
              {navrhInfo.varovani_po !== null && navrhInfo.varovani_pred > 0 && (
                <p className="xsmall mute" style={{ marginTop: 10 }}>Varování modelu: {navrhInfo.varovani_pred} bez opatření → {navrhInfo.varovani_po} s nimi.</p>
              )}
            </Card>
          )}
          <Card i={1} title="Váš scénář" icon="split"
            actions={<button className="btn btn-quiet btn-sm" onClick={() => { setIvs([]); setHotovo(false); setPridavam(false); }}>Začít znovu</button>}>
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
                        <Vyber value={String(iv.params[k])} options={Object.entries(p.options).map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => update(i, k, v)} label={p.label} />
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
              <button className="btn btn-sm" onClick={() => { setPridavam(true); setHotovo(false); }}><Icon name="plus" size={15} /> Přidat další opatření</button>
            </div>
          </Card>


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

              <div className="stats-row">
                {[["population", "Obyvatelé"], ["zs_util", "Vytížení ZŠ"], ["tax", "Daňové příjmy"], ...res.metrics.filter((m) => m.key.startsWith("x_")).map((m) => [m.key, m.label])].map(([k, l], n) => {
                  const v = vRoce[k];
                  const dopl = k.startsWith("x_");
                  const hodnota = dopl ? num(v?.scenario ?? null, 2) : k === "zs_util" ? (v?.scenario != null ? `${num(v.scenario, 1)} %` : "—") : k === "tax" ? kc(v?.scenario ?? null) : num(v?.scenario ?? null);
                  const d = v?.delta ?? 0;
                  return <Stat key={k} i={n} label={`${l} · ${rok}`} value={hodnota}
                    sub={ivs.length > 0 ? (d ? `${signed(d, dopl ? 2 : k === "zs_util" ? 1 : 0, k === "zs_util" ? " p. b." : "")} oproti stavu bez opatření` : "beze změny") : "výhled bez opatření"} />;
                })}
              </div>

              {res.warnings.scenario.length > 0 && (
                <div className="stack-y" style={{ gap: 8 }}>
                  {res.warnings.scenario.map((w) => (
                    <div className={`warn-card lvl-${w.level}`} key={w.key + w.year}>
                      <Icon name="alert" size={18} />
                      <span className="wc-title">{w.title}</span>
                      <span className="wc-text">{w.text}{w.suggest_text ? ` ${w.suggest_text}` : ""}</span>
                      {w.suggest && w.suggest_params && cat.data?.interventions[w.suggest] && (
                        <button className="btn btn-sm wc-akce" onClick={() => doplnReseni(w)}>
                          <Icon name="plus" size={14} /> Doplnit: {cat.data.interventions[w.suggest].label.toLowerCase()} +{num(Number(w.suggest_params.pocet))}
                        </button>
                      )}
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
                            <LineChart ariaLabel="Obyvatelé bez opatření a s nimi" height={260} series={[
                              { key: "b", label: "Bez opatření", color: "var(--text-mute)", dashed: true, points: res.baseline.map((r) => ({ year: r.year, value: r.population })) },
                              { key: "s", label: "S opatřeními", color: "var(--m)", width: 2.8, points: res.scenario.map((r) => ({ year: r.year, value: r.population })),
                                band: ivs.length ? res.scenario.map((r, i) => ({ year: r.year, lo: Math.min(r.population, res.baseline[i]?.population ?? r.population), hi: Math.max(r.population, res.baseline[i]?.population ?? r.population) })) : undefined },
                            ]} />
                            <Legend items={[{ label: "Bez opatření", color: "var(--text-mute)", dashed: true }, { label: "S opatřeními", color: "var(--m)" }]} />
                          </>
                        ),
                      },
                      {
                        key: "rozdil", label: "Jen rozdíl", icon: "split", render: () => (
                          <LineChart ariaLabel="Rozdíl mezi scénářem a stavem bez opatření" height={260} yZero
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
                              { key: "b", label: "Bez opatření", color: "var(--text-mute)", dashed: true, points: k.b },
                              { key: "s", label: "S opatřeními", color: "var(--warn)", points: k.s },
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

      </>
      )}

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Uložit scénář"
        footer={<><button className="btn btn-quiet" onClick={() => setSaveOpen(false)}>Zrušit</button><button className="btn btn-primary" disabled={!name.trim()} onClick={save}>Uložit scénář</button></>}>
        <label className="field"><span className="field-label">Název scénáře</span><input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
      </Modal>
    </>
  );
}

/** Vlastní seznam hodnot místo nativního <select>: stejný vzhled ve všech prohlížečích i v tmavém motivu. */
function Vyber({ value, options, onChange, label }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const zavri = (e: Event) => { if (!(e.target instanceof Node) || !box.current?.contains(e.target)) setOpen(false); };
    const klavesa = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", zavri); document.addEventListener("keydown", klavesa);
    return () => { document.removeEventListener("pointerdown", zavri); document.removeEventListener("keydown", klavesa); };
  }, [open]);
  const akt = options.find((o) => o.value === value);
  return (
    <div className="vyber" ref={box}>
      <button type="button" className="vyber-tlacitko" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        <span>{akt?.label ?? value}</span><Icon name="chevron-down" size={15} />
      </button>
      {open && (
        <ul className="vyber-seznam" role="listbox" aria-label={label}>
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value} className={o.value === value ? "is-on" : ""}
              onClick={() => { onChange(o.value); setOpen(false); }}>{o.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Záložka „Kam umístit“: celé pořadí obcí pro jeden zásah. */
function Kam({ type, tid, typy, onTyp, onPick }: { type: string; tid: string; typy: { value: string; label: string }[]; onTyp: (t: string) => void; onPick: (id: string) => void }) {
  const d = useDoporuceni(type, tid);
  const nejvic = Math.max(1, ...(d?.zebricek ?? []).map((m) => m.mezera));
  return (
    <div className="sc-kam">
      {typy.length > 1 && <Segmented size="sm" label="Opatření" value={type} onChange={onTyp} options={typy} />}
      {!d && <span className="skeleton" style={{ height: 220, width: "100%" }} />}
      {d && !d.available && <p className="muted small">{d.reason}</p>}
      {d?.available && (
        <>
          <p className="small mute sc-kam-uvod">
            Obce tohoto území podle toho, kolik lidí by opatření pomohlo: {d.co}.
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
