// Statistiky: co má KAM pod sebou, na jedné obrazovce a bez přepínačů.
//
// Dřív tu bylo šest dlaždic, sedm karet a u každé přepínač „žebříček /
// koláč“ — tisíc čísel, ze kterých si člověk nic neodnesl. Teď stránka
// odpovídá na pět otázek v tomto pořadí: kolik toho je (souhrn), odkud to
// je (mozaika zdrojů), za jaké roky (plocha v čase), o čem (oblasti) a co
// se s tím děje (provoz). Každá otázka má jeden obrázek, ne dva.

import type { CSSProperties } from "react";
import { LineChart, SERIES_COLORS, ShareBar } from "../components/charts";
import { Icon, PILLAR_ICON } from "../components/Icon";
import { StatistikyHook } from "../components/StatistikyHook";
import { Card, InfoHint, KindTag } from "../components/ui";
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
interface Katalog { interventions: Record<string, { label: string }> }

const JOB: Record<string, string> = {
  geo: "Hranice území (ČÚZK)", catalog: "Katalog datových sad", mos: "Statistiky obcí (ČSÚ)", khk: "Data kraje", rag: "Texty pro asistenta",
  check: "Kontrola odkazů", obsah: "Kontrola obsahu sad", dotace: "Dotace kraje", dokumenty: "Dokumenty obcí", vydaje: "Rozpočty obcí (Výdaje.com)",
  eurostat: "Eurostat", refresh: "Celková obnova", relief: "Výškový model",
};

/** Kraťší jméno zdroje do dlaždice: „NKOD — Český statistický úřad“ → „Český statistický úřad“. */
const jmeno = (s: string) => s.replace(/^NKOD — /, "").replace(/ — .*$/, "");

export function Stats() {
  const { data } = useApi<StatsT>("/stats");
  const kat = useApi<Katalog>("/simulate/catalog");
  const uzemi = useApi<{ id: string; name: string }[]>("/territories?limit=500");
  const jmenoUzemi = (id: string) => uzemi.data?.find((t) => t.id === id)?.name ?? id;
  const obs = data?.observations_per_year.reduce((a, r) => a + r.count, 0) ?? 0;
  const f = data?.datasets.by_freshness ?? {};
  const dok = data?.dokumenty.reduce((a, d) => a + d.count, 0) ?? null;
  const zarizeni = data?.pois.reduce((a, p) => a + p.count, 0) ?? null;
  const roky = data?.observations_per_year ?? [];

  // Mozaika: dvanáct největších zdrojů a zbytek jako jedna dlaždice.
  const zdroje = data ? [...data.datasets.sources].filter((s) => s.verified > 0).sort((a, b) => b.verified - a.verified) : [];
  const spicka = zdroje.slice(0, 11);
  const zbytek = zdroje.slice(11).reduce((a, s) => a + s.verified, 0);
  const celkemZdroje = zdroje.reduce((a, s) => a + s.verified, 0) || 1;

  // Oblasti: sady a ukazatele vedle sebe, jedna tabulka místo dvou žebříčků.
  const ukazatele = new Map((data?.indicators_per_pillar ?? []).map((p) => [p.key, p.count]));
  const oblasti = (data?.datasets.by_pillar ?? []).filter((p) => p.key !== "ostatni");
  const maxSad = Math.max(1, ...oblasti.map((p) => p.count));

  const formaty = (data?.formats ?? []).filter((x) => x.format && x.format !== "neuvedeno").slice(0, 8);
  const maxFormat = Math.max(1, ...formaty.map((x) => x.count));

  return (
    <>
      <StatistikyHook roky={roky} />

      <section className="st-souhrn reveal" aria-label="Souhrn">
        {[
          { l: "Funkčních datových sad", v: num(data?.datasets.verified ?? null), s: data ? `z ${num(data.datasets.total)} v katalogu` : "" },
          { l: "Měřených hodnot", v: compact(obs), s: roky.length ? `za roky ${roky[0].year}–${roky[roky.length - 1].year}` : "" },
          { l: "Zařízení a zastávek", v: num(zarizeni), s: "z mapových služeb kraje" },
          { l: "Dokumentů obcí", v: num(dok), s: "programy rozvoje a územní plány" },
        ].map((x, i) => (
          <div className="st-souhrn-bunka" key={x.l} style={{ "--i": i } as CSSProperties}>
            <span className="st-souhrn-popis">{x.l}</span>
            <strong className="num">{x.v}</strong>
            <span className="st-souhrn-sub">{x.s}</span>
          </div>
        ))}
      </section>

      <div className="grid">
        <Card span={8} i={1} title="Odkud data jsou" icon="layers"
          actions={<KindTag kind="FAKT" info="Počet funkčních sad podle zdroje: sady, ze kterých jsme stáhli začátek souboru a je v něm skutečný obsah. Plocha dlaždice odpovídá podílu na katalogu." zdroj={{ nazev: "Národní katalog otevřených dat (data.gov.cz)", url: "https://data.gov.cz/" }} />}>
          <div className="st-mozaika">
            {spicka.map((s, i) => (
              <div key={s.id} className="st-dlazdice" title={`${s.name}: ${num(s.verified)} sad`}
                style={{ flexGrow: s.verified, "--c": SERIES_COLORS[i % SERIES_COLORS.length], "--i": i } as CSSProperties}>
                <strong className="num">{num(s.verified)}</strong>
                <span>{jmeno(s.name)}</span>
                <em>{num((100 * s.verified) / celkemZdroje, 1)} %</em>
              </div>
            ))}
            {zbytek > 0 && (
              <div className="st-dlazdice is-zbytek" style={{ flexGrow: zbytek, "--c": "var(--text-mute)", "--i": spicka.length } as CSSProperties}>
                <strong className="num">{num(zbytek)}</strong>
                <span>Dalších {zdroje.length - spicka.length} zdrojů</span>
                <em>{num((100 * zbytek) / celkemZdroje, 1)} %</em>
              </div>
            )}
          </div>
        </Card>

        <div className="span-4 stack-y">
          <Card i={2} title="Co je v katalogu" icon="check"
            actions={<InfoHint label="Jak se to kontroluje">U každé sady jsme stáhli začátek souboru. Funkční je ta, ve které je skutečný obsah; webová stránka je odkaz na vizualizaci nebo rozcestník místo souboru.</InfoHint>}>
            {data && <ShareBar parts={[
              { label: "S daty", value: data.datasets.verified, color: "var(--ok)" },
              { label: "Webová stránka", value: data.datasets.pages, color: "var(--info)" },
              { label: "Nefunkční", value: data.datasets.broken, color: "var(--bad)" },
              { label: "Bez odkazu", value: data.datasets.no_link, color: "var(--text-mute)" },
            ]} />}
            {(f.aktualni ?? 0) + (f.zastarala ?? 0) > 0 && (
              <p className="xsmall mute" style={{ marginTop: 10 }}>Termín aktualizace uvádí {num((f.aktualni ?? 0) + (f.zastarala ?? 0))} sad; po termínu je {num(f.zastarala ?? 0)}.</p>
            )}
          </Card>
          <Card i={3} title="Formáty ke stažení" icon="download">
            <div className="st-formaty">
              {formaty.map((x) => (
                <span key={x.format} className="st-format" style={{ "--w": `${20 + (80 * x.count) / maxFormat}%` } as CSSProperties}>
                  <b>{x.format}</b><span className="num">{num(x.count)}</span>
                </span>
              ))}
            </div>
          </Card>
        </div>

        <Card span={7} i={4} title="Hodnoty v čase" icon="chart"
          actions={<KindTag kind="FAKT" info="Kolik zveřejněných hodnot (obec × ukazatel × rok) model drží za každý rok. Poslední rok se teprve plní, protože úřední statistika vychází se zpožděním." zdroj={{ nazev: "ČSÚ – Městská a obecní statistika", url: "https://csu.gov.cz/produkty/databaze-mos-otevrena-data" }} />}>
          {roky.length > 1
            ? <LineChart ariaLabel="Počet měřených hodnot podle roku" height={420} format={(v) => compact(v)}
                series={[{ key: "h", label: "Hodnot", color: "var(--m)", width: 2.6, points: roky.map((r) => ({ year: r.year, value: r.count })) }]} />
            : <span className="skeleton" style={{ height: 240 }} />}
        </Card>

        <Card span={5} i={5} title="O čem data jsou" icon="grid"
          actions={<InfoHint label="Sady a ukazatele">Sady: funkční datové sady v katalogu podle oblasti. Ukazatele: kolik různých ukazatelů z oblasti model opravdu počítá.</InfoHint>}>
          <div className="st-oblasti" role="table" aria-label="Oblasti">
            <div className="st-oblast st-oblast-hlava" role="row"><span role="columnheader">Oblast</span><span role="columnheader" className="r">Sad</span><span role="columnheader" className="r">Ukazatelů</span></div>
            {oblasti.map((p) => (
              <div className="st-oblast" role="row" key={p.key}>
                <span className="st-oblast-jmeno" role="cell">
                  <Icon name={PILLAR_ICON[p.key] ?? "grid"} size={16} />
                  <span>{p.label}<i className="st-oblast-pruh" style={{ width: `${(100 * p.count) / maxSad}%` }} /></span>
                </span>
                <span className="r num" role="cell">{num(p.count)}</span>
                <span className="r num mute" role="cell">{num(ukazatele.get(p.key) ?? 0)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card span={12} i={6} title="Zařízení v datech kraje" icon="pin"
          actions={<KindTag kind="FAKT" info="Počet míst v mapových službách Královéhradeckého kraje (Data KHK): zastávky, školy, lékaři, knihovny a další. Počítají se místa, ne kapacity." zdroj={{ nazev: "Data KHK – portál Královéhradeckého kraje", url: "https://www.datakhk.cz/" }} />}>
          <div className="st-zarizeni">
            {(data?.pois ?? []).slice(0, 18).map((p, i) => (
              <div key={p.kind} style={{ "--i": i } as CSSProperties}>
                <strong className="num">{num(p.count)}</strong>
                <span>{p.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card span={12} i={7} title="Provoz aplikace" icon="refresh">
          <div className="st-provoz">
            <div>
              <h3 className="st-provoz-nadpis">Načítání dat</h3>
              <ul className="st-joby">
                {(data?.jobs ?? []).filter((j) => JOB[j.name]).map((j) => (
                  <li key={j.name} className={`is-${j.status}`}>
                    <i aria-hidden="true" />
                    <span>{JOB[j.name]}</span>
                    <time>{j.status === "running" ? `${Math.round(100 * j.progress)} %` : ago(j.updated_at)}</time>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="st-provoz-nadpis">Nejčastější scénáře</h3>
              <ul className="st-scenare">
                {(data?.simulation.popular ?? []).slice(0, 5).map((p) => (
                  <li key={p.key}>
                    <span>{p.interventions.map((i) => kat.data?.interventions[i.type]?.label ?? i.type).join(" + ") || "Bez opatření"}</span>
                    <small>{jmenoUzemi(p.territory)}</small>
                    <b className="num">{p.hits}×</b>
                  </li>
                ))}
              </ul>
            </div>
            <div className="st-provoz-cisla">
              <h3 className="st-provoz-nadpis">Asistent a podněty</h3>
              <div><strong className="num">{num(data?.ai.questions ?? null)}</strong><span>dotazů na asistenta</span></div>
              <div><strong className="num">{num(data?.ai.rag.docs ?? null)}</strong><span>textů, ze kterých odpovídá</span></div>
              <div><strong className="num">{num(data?.crowd.reports ?? null)}</strong><span>podnětů od lidí</span></div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
