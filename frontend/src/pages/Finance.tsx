// Hospodaření: vydělává obec na tom, jak nakládá se svými penězi?
//
// Otázka zní jednoduše, odpověď je součet tří čísel, která jsou všechna
// v rozpočtu — provozní přebytek, kapitálové výdaje a jejich poměr. Stránka
// je proto postavená tak, aby se dala přečíst odshora dolů: kolik zbyde,
// kolik z toho jde do majetku a jestli si to obec platí sama.

import { ChartSwitch, Columns, Donut, LineChart, Legend, Waterfall } from "../components/charts";
import { FinanceHook } from "../components/FinanceHook";
import { Icon } from "../components/Icon";
import { TerritoryPicker } from "../components/TerritoryPicker";
import { Vydaje } from "../components/Vydaje";
import { Card, ErrorBox, InfoHint, KindTag, Stat } from "../components/ui";
import { useApi } from "../lib/api";
import { num } from "../lib/format";
import { Link, setQuery, useLocation } from "../lib/router";

interface Rok {
  year: number; prijmy: number; vydaje: number; bezne: number; kapital: number;
  dane: number; dotace: number; saldo: number; kumul: number; provozni: number;
  kryti: number | null; obyvatel: number | null; kapital_obyv: number | null; provozni_obyv: number | null;
}
interface Souhrn {
  od: number; do: number; prijmy: number; provozni: number; kapital: number; dotace: number;
  provozni_podil: number; kryti: number | null; dotace_podil: number | null; kumul: number;
  kapital_obyv: number | null; provozni_obyv: number | null;
  kraj_kapital_obyv: number | null; kraj_provozni_obyv: number | null;
  stav: string; popis: string; pravidlo: string;
}
interface Data { territory: { id: string; name: string; level: string }; roky: Rok[]; souhrn: Souhrn | null; zdroj: string }

/** Miliony jsou čitelnější než devět číslic, ale jen když je jich aspoň pár. */
function kc(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${num(v / 1e9, 2)} mld. Kč`;
  if (a >= 1e6) return `${num(v / 1e6, 1)} mil. Kč`;
  if (a >= 1e4) return `${num(Math.round(v / 1e3))} tis. Kč`;
  return `${num(v)} Kč`;
}

const TONE: Record<string, string> = { dobre: "ok", neutral: "", pozor: "warn", riziko: "bad" };

export function Finance() {
  const { query } = useLocation();
  const tid = query.get("t") ?? "kraj:86";
  const { data, error, reload } = useApi<Data>(`/finance/${tid}`);
  const s = data?.souhrn ?? null;
  const roky = data?.roky ?? [];
  const okno = roky.slice(-12);

  return (
    <>
      <FinanceHook roky={roky.map((r) => ({ year: r.year, provozni: r.provozni, kapital: r.kapital }))}
        kryti={s?.kryti ?? null} territory={data?.territory.name}>
        <div className="row" style={{ marginTop: 18 }}>
          <Link className="btn" to={`/obce/${tid}`}><Icon name="home" size={16} /> Otevřít profil území</Link>
          <Link className="btn" to={`/dotace?t=${tid}`}><Icon name="coins" size={16} /> Zobrazit dotace</Link>
        </div>
      </FinanceHook>
      <div className="stack-y">
        <div className="toolbar-card reveal">
          <div className="toolbar-picker"><TerritoryPicker value={tid} onChange={(id) => setQuery({ t: id })} label="Území" /></div>
        </div>
        <ErrorBox error={error} retry={reload} />

        {s && (
          <>
            <div className="stats-row">
              <Stat i={0} label={`Provozní přebytek ${s.od}–${s.do}`} value={kc(s.provozni)}
                sub={`${num(s.provozni_podil, 1)} % příjmů`} tone={TONE[s.stav] || undefined} />
              <Stat i={1} label="Investice (kapitálové výdaje)" value={kc(s.kapital)}
                sub={s.kapital_obyv !== null ? `${num(s.kapital_obyv)} Kč na obyvatele ročně` : ""} />
              <Stat i={2} label="Investice zaplacené z vlastního" value={s.kryti !== null ? `${num(s.kryti, 1)} %` : "—"}
                sub={s.kryti !== null && s.kryti >= 100 ? "přebytek stačí na všechny investice" : "zbytek z dotací nebo úvěru"} />
              <Stat i={3} label="Součet ročních sald" value={kc(s.kumul)} sub={`od roku ${roky[0]?.year ?? ""}`} />
            </div>

            <Card i={1} title="Jak obec hospodaří" icon="target"
              actions={<InfoHint label="Podle jakého pravidla hodnotíme">{s.pravidlo}</InfoHint>}>
              <div className="row" style={{ marginBottom: 10 }}><KindTag kind="MODEL" /><span className="muted small">{data?.zdroj}</span></div>
              <p className="lead-p">{s.popis}</p>
              <div className="facts-list" style={{ marginTop: 12 }}>
                <div className="fact-row"><span>Provozní přebytek na obyvatele (ročně)</span>
                  <span className="num">{s.provozni_obyv !== null ? `${num(s.provozni_obyv)} Kč` : "—"}
                    {s.kraj_provozni_obyv !== null && <span className="mute"> · medián obcí v kraji {num(s.kraj_provozni_obyv)} Kč</span>}</span></div>
                <div className="fact-row"><span>Investice na obyvatele (ročně)</span>
                  <span className="num">{s.kapital_obyv !== null ? `${num(s.kapital_obyv)} Kč` : "—"}
                    {s.kraj_kapital_obyv !== null && <span className="mute"> · medián obcí v kraji {num(s.kraj_kapital_obyv)} Kč</span>}</span></div>
                <div className="fact-row"><span>Podíl dotací na příjmech</span><span className="num">{s.dotace_podil !== null ? `${num(s.dotace_podil, 1)} %` : "—"}</span></div>
              </div>
              <p className="xsmall mute" style={{ marginTop: 12 }}>
                Rozpočet ukazuje, kolik se utratilo a z čeho. Co za to obec pořídila a jestli se to vyplatilo, z něj nevyčtete.
              </p>
            </Card>

            <Card i={2} title="Rozpočet po letech" icon="chart">
              <ChartSwitch id="finance" views={[
                {
                  key: "provoz", label: "Provoz a investice", icon: "trend-up", render: () => (
                    <>
                      <LineChart ariaLabel="Provozní přebytek a investice" height={280}
                        format={(v) => kc(v)}
                        series={[
                          { key: "p", label: "Provozní přebytek", color: "var(--accent)", points: okno.map((r) => ({ year: r.year, value: r.provozni })) },
                          { key: "k", label: "Investice", color: "var(--info)", dashed: true, points: okno.map((r) => ({ year: r.year, value: r.kapital })) },
                        ]} />
                      <Legend items={[{ label: "Provozní přebytek", color: "var(--accent)" }, { label: "Investice (kapitálové výdaje)", color: "var(--info)", dashed: true }]} />
                      <p className="xsmall mute" style={{ marginTop: 8 }}>Kde je plná čára nad přerušovanou, platí si obec investice sama.</p>
                    </>
                  ),
                },
                {
                  key: "kryti", label: "Investice z vlastního", icon: "gauge", render: () => (
                    <>
                      <Columns ariaLabel="Kolik procent investic pokryl provozní přebytek" height={250}
                        items={okno.filter((r) => r.kryti !== null).map((r) => ({ label: String(r.year), value: r.kryti as number }))}
                        format={(v) => `${num(v, 0)} %`} />
                      <p className="xsmall mute" style={{ marginTop: 8 }}>100 % znamená, že přebytek toho roku pokryl všechny jeho investice.</p>
                    </>
                  ),
                },
                {
                  key: "kumul", label: "Součet sald", icon: "layers", render: () => (
                    <>
                      <LineChart ariaLabel="Součet ročních sald rozpočtu" height={280} format={(v) => kc(v)}
                        series={[{ key: "c", label: "Součet sald", color: "var(--accent)", points: roky.map((r) => ({ year: r.year, value: r.kumul })) }]} />
                      <p className="xsmall mute" style={{ marginTop: 8 }}>Sčítá se od roku {roky[0]?.year}. Když roste, obec si tvoří rezervu; když dlouhodobě klesá, žije z úspor.</p>
                    </>
                  ),
                },
                {
                  key: "slozeni", label: "Z čeho se rok skládá", icon: "split", render: () => {
                    const r = roky[roky.length - 1];
                    return (
                      <>
                        <Waterfall ariaLabel={`Rozpočet ${r.year}`} height={260} format={(v) => kc(v)}
                          steps={[
                            { label: `Příjmy ${r.year}`, value: r.prijmy, total: true },
                            { label: "Provoz (běžné výdaje)", value: -r.bezne },
                            { label: "Investice", value: -r.kapital },
                            { label: "Saldo", value: r.prijmy - r.bezne - r.kapital, total: true },
                          ]} />
                        <p className="xsmall mute" style={{ marginTop: 8 }}>Poslední uzavřený rok. Od vykázaného salda se může o pár procent lišit kvůli vnitřním převodům v rozpočtu (konsolidaci).</p>
                      </>
                    );
                  },
                },
                {
                  key: "zdroje", label: "Odkud jsou peníze", icon: "database", render: () => {
                    const r = roky[roky.length - 1];
                    const vlastni = Math.max(0, r.prijmy - r.dotace);
                    return (
                      <>
                        <Donut ariaLabel={`Příjmy ${r.year} podle původu`} size={220} caption={kc(r.prijmy)}
                          parts={[
                            { label: "Vlastní příjmy (daně a nedaňové)", value: vlastni },
                            { label: "Přijaté dotace", value: r.dotace },
                          ]} />
                        <p className="xsmall mute" style={{ marginTop: 8 }}>Rok {r.year}. Čím víc dotací, tím víc rozpočet závisí na rozhodnutí někoho jiného.</p>
                      </>
                    );
                  },
                },
              ]} />
            </Card>
          </>
        )}
        {data && !s && <Card><p className="muted">Pro toto území nejsou k dispozici údaje z rozpočtu.</p></Card>}
        <Vydaje tid={tid} />
      </div>
    </>
  );
}
