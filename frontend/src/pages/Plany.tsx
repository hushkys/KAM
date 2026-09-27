// Plány: co si obec sama naplánovala a co o ní stát zveřejňuje.
//
// Stránka stojí na jednom rozlišení, které se nesmí rozmazat: **období
// dokumentu** je doložitelné, **splnění plánu** doložitelné není. Nikde
// v Česku neexistuje registr, kde by u jednotlivého záměru stálo
// „realizováno" — obce to vyhodnocují vlastními zprávami v PDF. Proto se tu
// plnému pruhu nikdy neříká „hotovo", jen „období uplynulo", a k částce za
// investice patří věta, že rozpočet neví, co za ni obec pořídila.
//
// **Rozvržení je schválně jiné než na ostatních stránkách.** Tohle není
// nástěnka s dlaždicemi, ale rejstřík: vlevo stojí čtyři povinnosti a kolik
// obcí je má, vpravo běží 448 řádků a každý se rozbalí na místě. Kdyby to
// byly karty jako všude jinde, vypadalo by to jako každá druhá stránka —
// a hlavně by se do okna vešlo pět obcí místo dvaceti. Rejstřík se čte shora
// dolů a řádek je pořád stejně vysoký, takže se v něm dá hledat očima.
//
// Druhá zásada: u každého cizího údaje je odkaz na originál, a odkaz míří
// rovnou na ten dokument, ne na vyhledávací formulář. Adresy do celostátních
// registrů se skládají z IČO (`Territory.ico` z ARESu) — proto u obce, kterou
// se spárovat nepodařilo, odkazy zmizí, místo aby vedly naslepo.

import { useEffect, useMemo, useRef, useState } from "react";
import { Erb } from "../components/Erb";
import { Icon } from "../components/Icon";
import { PlanyHook } from "../components/PlanyHook";
import { Empty, ErrorBox, Pill } from "../components/ui";
import { useApi } from "../lib/api";
import { compact, date, fold, num, pct, plural } from "../lib/format";
import { Link, setQuery, useLocation } from "../lib/router";

interface Ma { pro: boolean; uzemni_plan: boolean; rozpocet: boolean; otevrena_data: boolean }
interface Radek {
  id: string; name: string; population: number; orp_id: string; ico: string; ds: string;
  stav: string; ma: Ma; sad: number;
  upd_celkem: number; upd_platnych: number; upd_od: number | null;
  nazev?: string; od?: number; do?: number; url?: string;
  uplynulo?: number | null; publikovano?: string | null;
}
interface PovinnostMeta { klic: string; nazev: string; kdo: string; zakon: string; popis: string; zdroj: string }
interface RegistrMeta { klic: string; nazev: string; kdo: string; co: string; povinnost: string }
interface Prehled {
  kraj: { code: number; obci: number };
  letos: number; s_planem: number; pokryti: number;
  pocty: Record<string, number>;
  ma_celkem: Record<string, number>;
  dokumentu: number; upd_celkem: number;
  s_ico: number; s_ds: number;
  konce: { rok: number; pocet: number }[];
  seznam: Radek[]; povinnosti: PovinnostMeta[]; registry: RegistrMeta[];
  obcepro_url: string; poznamka: string;
}
interface Dokument {
  druh: string; povinnost: string; zakon: string; zdroj: string; kdo: string; popis: string;
  stav: string; nazev: string; url: string; zdroj_url: string;
  od?: number; do?: number; datum?: string | null; uplynulo?: number | null;
  pocet?: number; platnych?: number;
}
interface Upd { nazev: string; datum: string | null; url: string; zdroj_url: string; stav: string }
interface Investice { od_dat: number; do_dat: number; roky: number; kapital: number; prijmy: number; podil: number | null }
interface Plan { od: number; do: number; stav: string; uplynulo: number | null; zbyva_let: number | null; investice?: Investice | null }
interface Detail {
  territory: { id: string; name: string; level: string; population: number };
  ico: string; ds: string; plan: Plan | null;
  dokumenty: Dokument[]; upd: Upd[];
  registry: (RegistrMeta & { url: string })[];
  obcepro_url: string; poznamka: string;
}

const STAVY: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  plati: { label: "platí", tone: "ok" },
  konci: { label: "poslední rok", tone: "warn" },
  prosly: { label: "doběhlo", tone: "bad" },
  bez_obdobi: { label: "bez období", tone: "neutral" },
  chybi: { label: "chybí", tone: "neutral" },
};

const DRUHY: { klic: keyof Ma; popis: string }[] = [
  { klic: "pro", popis: "Program rozvoje obce" },
  { klic: "uzemni_plan", popis: "Územní plán" },
  { klic: "rozpocet", popis: "Rozpočet a jeho plnění" },
  { klic: "otevrena_data", popis: "Otevřená data obce" },
];

/** Řazení je fakt, ne soud: „od nejstaršího územního plánu" neříká, že je
 *  starý plán špatný — územní plán nemá platnost, která by vypršela. Říká
 *  jen, kde se dokument nejdéle nepřepisoval, což je to, na co se úřad ptá. */
const RAZENI: { key: string; label: string }[] = [
  { key: "lidi", label: "Podle velikosti" },
  { key: "abeceda", label: "Abecedně" },
  { key: "up", label: "Od nejstaršího územního plánu" },
  { key: "dokumentu", label: "Nejvíc dokumentů" },
];

const FILTRY: { key: string; label: string }[] = [
  { key: "", label: "Všechny obce" },
  { key: "pro", label: "Mají program rozvoje" },
  { key: "prosly", label: "Program doběhl" },
  { key: "bez_up", label: "Bez územního plánu" },
  { key: "otevrena_data", label: "Vydávají otevřená data" },
];

function kc(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${compact(v)} Kč`;
}

/** Čtyři tečky = čtyři povinnosti. Prázdná tečka je odpověď, ne mezera. */
function Tecky({ ma }: { ma: Ma }) {
  return (
    <span className="pl-tecky" aria-hidden="true">
      {DRUHY.map((d) => (
        <i key={d.klic} className={ma[d.klic] ? "je" : "neni"} title={`${d.popis}: ${ma[d.klic] ? "má" : "nemá"}`} />
      ))}
    </span>
  );
}

function DokumentRadek({ d }: { d: Dokument }) {
  const st = STAVY[d.stav] ?? STAVY.chybi;
  const vnitrek = (
    <>
      <span className="pl-d-hlava">
        <span className="pl-d-povinnost">{d.povinnost}</span>
        <Pill tone={st.tone}>{st.label}</Pill>
      </span>
      <span className="pl-d-nazev">{d.nazev}</span>
      <span className="pl-d-meta">
        {d.od && d.do ? <span>{d.od}–{d.do}</span> : d.datum ? <span>{date(d.datum)}</span> : null}
        {d.pocet ? <span>{d.pocet} {plural(d.pocet, "dokument", "dokumenty", "dokumentů")} v evidenci</span> : null}
        <span className="pl-d-zdroj">{d.zdroj}</span>
        <span className="pl-d-zakon">{d.zakon}</span>
      </span>
    </>
  );
  return d.url
    ? <a className="pl-d" href={d.url} target="_blank" rel="noopener noreferrer" data-druh={d.druh}>{vnitrek}<Icon name="external" size={15} /></a>
    : <div className="pl-d je-bez" data-druh={d.druh}>{vnitrek}</div>;
}

function Rozbaleno({ tid }: { tid: string }) {
  const { data, error, reload } = useApi<Detail>(`/plany/${tid}`);
  const [vseUpd, setVseUpd] = useState(false);
  if (error) return <div className="pl-rozbal"><ErrorBox error={error} retry={reload} /></div>;
  if (!data) return <div className="pl-rozbal"><div className="pl-cekam" aria-label="Načítám" /></div>;
  const plan = data.plan;
  const inv = plan?.investice ?? null;
  const upd = vseUpd ? data.upd : data.upd.slice(0, 6);

  return (
    <div className="pl-rozbal">
      <div className="pl-dokumenty">
        {data.dokumenty.map((d) => <DokumentRadek key={d.druh} d={d} />)}
      </div>

      {plan && (
        <div className="pl-obdobi-blok">
          <div className="pl-obdobi-hlava">
            <span>Z období programu rozvoje {plan.od}–{plan.do} uplynulo</span>
            <strong>{pct((plan.uplynulo ?? 0) * 100, 0)}</strong>
          </div>
          <div className="pl-obdobi-drah" data-stav={plan.stav}>
            <i style={{ width: `${Math.round((plan.uplynulo ?? 0) * 100)}%` }} />
          </div>
          {inv && (
            <p className="pl-obdobi-pozn">
              Za roky {inv.od_dat}–{inv.do_dat} poslala obec do majetku <strong>{kc(inv.kapital)}</strong>
              {inv.podil !== null && <> ({pct(inv.podil * 100, 1)} příjmů)</>}. Je to z rozpočtu, ne z plánu —
              rozpočtová skladba neříká, co za ty peníze obec pořídila, takže vedle sebe stojí dvě věci ze
              dvou zdrojů, ne příčina a následek. <Link to={`/hospodareni?t=${tid}`}>Hospodaření obce</Link>
            </p>
          )}
        </div>
      )}

      {data.upd.length > 0 && (
        <div className="pl-upd">
          <div className="pl-upd-hlava">
            Územně plánovací dokumentace ({data.upd.length})
            <span className="mute"> · archivovaný dokument nahradil jiný</span>
          </div>
          <ul className="pl-upd-seznam">
            {upd.map((u) => (
              <li key={u.url} data-stav={u.stav}>
                <a href={u.url} target="_blank" rel="noopener noreferrer">{u.nazev}</a>
                <span className="pl-upd-datum">{u.datum ? date(u.datum) : "bez data vydání"}</span>
                <span className="pl-upd-znacka">{u.stav === "archiv" ? "archiv" : ""}</span>
                <a className="pl-upd-evidence" href={u.zdroj_url} target="_blank" rel="noopener noreferrer"
                  title="Záznam v celostátní evidenci"><Icon name="external" size={13} /></a>
              </li>
            ))}
          </ul>
          {data.upd.length > 6 && (
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => setVseUpd(!vseUpd)}>
              {vseUpd ? "Skrýt" : `Zobrazit všech ${data.upd.length}`}
            </button>
          )}
        </div>
      )}

      {data.registry.length > 0 ? (
        <div className="pl-registry">
          <div className="pl-registry-hlava">
            Kde je obec dohledatelná — odkazy se skládají z IČO {data.ico}
            {data.ds ? <>, datová schránka {data.ds}</> : null}
          </div>
          {data.registry.map((r) => (
            <a key={r.klic} className="pl-registr" href={r.url} target="_blank" rel="noopener noreferrer">
              <strong>{r.nazev}</strong><span className="mute">{r.kdo}</span><Icon name="external" size={14} />
            </a>
          ))}
        </div>
      ) : (
        <p className="pl-bez-ica">
          IČO úřadu se pro tuhle obec nepodařilo spárovat s ARESem, takže sem nevede přesný odkaz do
          registrů. Raději žádný než odkaz naslepo do jiné obce.
        </p>
      )}
    </div>
  );
}

export function Plany() {
  const { query } = useLocation();
  const zQuery = query.get("t") ?? "";
  const { data, error, reload } = useApi<Prehled>("/plany");
  const [hledat, setHledat] = useState("");
  const [filtr, setFiltr] = useState("");
  const [razeni, setRazeni] = useState("lidi");
  const [otevreno, setOtevreno] = useState(zQuery);
  const [limit, setLimit] = useState(60);
  const box = useRef<HTMLDivElement>(null);

  // Odkaz z profilu obce míří sem s `?t=`; řádek se má otevřít a najet na něj,
  // jinak by člověk skončil na začátku čtyřsetřádkového seznamu.
  useEffect(() => {
    if (!zQuery || !data) return;
    setOtevreno(zQuery);
    const el = box.current?.querySelector(`[data-obec="${zQuery}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [zQuery, data]);

  const seznam = data?.seznam ?? [];
  const videt = useMemo(() => {
    const q = fold(hledat.trim());
    const vybrane = seznam.filter((r) => {
      if (filtr === "pro" && !r.ma.pro) return false;
      if (filtr === "prosly" && r.stav !== "prosly") return false;
      if (filtr === "bez_up" && r.ma.uzemni_plan) return false;
      if (filtr === "otevrena_data" && !r.ma.otevrena_data) return false;
      return !q || fold(r.name).includes(q) || r.ico.includes(q);
    });
    // Kopie, ne `sort` na místě: `seznam` drží cache API a přeházet ho
    // znamená přeházet ho i všem ostatním, kdo si ho vezmou po nás.
    const set = [...vybrane];
    // I výchozí řazení se dělá tady, ne se nechává na pořadí ze serveru:
    // to staví obce s programem rozvoje dopředu, takže popisek „podle
    // velikosti" by neseděl a seznam by vypadal jako náhodný.
    if (razeni === "lidi") set.sort((a, b) => b.population - a.population);
    else if (razeni === "abeceda") set.sort((a, b) => a.name.localeCompare(b.name, "cs"));
    // Obec bez územního plánu nemá rok — patří na konec, ne na začátek jako
    // „nejstarší". Nula by ji tam poslala a vypadalo by to jako údaj.
    else if (razeni === "up") set.sort((a, b) => (a.upd_od ?? 9999) - (b.upd_od ?? 9999) || b.population - a.population);
    else if (razeni === "dokumentu") set.sort((a, b) => b.upd_celkem - a.upd_celkem || b.population - a.population);
    return set;
  }, [seznam, hledat, filtr, razeni]);

  // Stáří územních plánů po desetiletích. Je to popis, ne hodnocení: územní
  // plán nemá platnost, která by vypršela, takže rok říká jen to, kdy se
  // dokument naposledy přepisoval. Pruh ale ukáže, co v řazení není vidět —
  // že polovina kraje staví podle dokumentu z minulého desetiletí.
  const dekady = useMemo(() => {
    const k = new Map<number, number>();
    for (const r of seznam) if (r.upd_od) k.set(Math.floor(r.upd_od / 10) * 10, (k.get(Math.floor(r.upd_od / 10) * 10) ?? 0) + 1);
    const vse = [...k.entries()].sort((a, b) => a[0] - b[0]);
    const nej = Math.max(1, ...vse.map(([, n]) => n));
    return vse.map(([d, n]) => ({ d, n, podil: n / nej }));
  }, [seznam]);

  const prepni = (id: string) => {
    setOtevreno((s) => (s === id ? "" : id));
    setQuery({ t: null });
  };

  return (
    <>
      <PlanyHook plany={seznam} letos={data?.letos ?? new Date().getFullYear()}>
        <div className="row" style={{ marginTop: 18 }}>
          <a className="btn" href="https://up.khk.cz/upd/seznam" target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={16} /> Evidence ÚPD kraje
          </a>
          <a className="btn" href={data?.obcepro_url ?? "https://www.obcepro.cz/publikovane-dokumenty"}
            target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={16} /> Registr MMR
          </a>
        </div>
      </PlanyHook>

      <ErrorBox error={error} retry={reload} />

      {data && (
        <div className="pl-stranka">
          <div className="pl-pas reveal">
            <div className="pl-pas-cisla">
              <span><strong>{num(data.dokumentu)}</strong> dokumentů</span>
              <span><strong>{num(data.kraj.obci)}</strong> obcí</span>
              <span><strong>{DRUHY.length}</strong> povinnosti</span>
              <span><strong>{num(data.s_ds)}</strong> úřadů s datovou schránkou</span>
            </div>
            <div className="input-icon pl-hledat">
              <Icon name="search" size={17} />
              <input className="input" type="search" value={hledat} placeholder="Hledat obec nebo IČO…"
                onChange={(e) => { setHledat(e.target.value); setLimit(60); }} aria-label="Hledat obec" />
            </div>
          </div>

          <div className="pl-telo">
            <aside className="pl-rail reveal">
              <h2 className="pl-rail-nadpis">Čtyři povinnosti</h2>
              {data.povinnosti.map((p) => {
                const kolik = data.ma_celkem[p.klic] ?? 0;
                const podil = data.kraj.obci ? kolik / data.kraj.obci : 0;
                return (
                  <div className="pl-pov" key={p.klic}>
                    <div className="pl-pov-hlava">
                      <span className="pl-pov-nazev">{p.nazev}</span>
                      <span className="pl-pov-pocet">{num(kolik)}<span className="mute">/{num(data.kraj.obci)}</span></span>
                    </div>
                    <div className="pl-pov-drah"><i style={{ width: `${Math.round(podil * 100)}%` }} /></div>
                    <p className="pl-pov-popis">{p.popis}</p>
                    <p className="pl-pov-zdroj"><span>{p.zdroj}</span> · {p.zakon}</p>
                  </div>
                );
              })}
              {dekady.length > 1 && (
                <div className="pl-dekady">
                  <h3 className="pl-rail-nadpis">Z kterého desetiletí je územní plán</h3>
                  <ul>
                    {dekady.map((x) => (
                      <li key={x.d}>
                        <span className="pl-dekada-rok">{x.d}.</span>
                        <span className="pl-dekada-drah"><i style={{ width: `${Math.round(x.podil * 100)}%` }} /></span>
                        <span className="pl-dekada-pocet">{num(x.n)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="pl-pov-zdroj">
                    Ze {num(dekady.reduce((a, x) => a + x.n, 0))} obcí, u kterých evidence uvádí datum
                    vydání. Rok je datum vydání nejnovějšího nearchivovaného dokumentu, ne konec
                    platnosti — ten územní plán nemá.
                  </p>
                </div>
              )}
              <p className="pl-rail-pozn">{data.poznamka}</p>
              <p className="pl-rail-pozn">
                Co z plánu je hotové, se tu netvrdí. Registr, kde by u jednotlivého záměru stálo
                „realizováno", v Česku neexistuje — obce plnění vyhodnocují vlastními zprávami v PDF,
                každá po svém.
              </p>
            </aside>

            <div className="pl-vypis reveal" ref={box}>
              <div className="pl-filtry" role="group" aria-label="Filtr">
                {FILTRY.map((f) => (
                  <button key={f.key} type="button" className={`pl-filtr${filtr === f.key ? " is-on" : ""}`}
                    aria-pressed={filtr === f.key} onClick={() => { setFiltr(f.key); setLimit(60); }}>
                    {f.label}
                  </button>
                ))}
                <span className="pl-pocet">{num(videt.length)} {plural(videt.length, "obec", "obce", "obcí")}</span>
              </div>

              <div className="pl-razeni">
                <span className="pl-razeni-popis">Řadit</span>
                {RAZENI.map((r) => (
                  <button key={r.key} type="button" className={`pl-filtr${razeni === r.key ? " is-on" : ""}`}
                    aria-pressed={razeni === r.key} onClick={() => { setRazeni(r.key); setLimit(60); }}>
                    {r.label}
                  </button>
                ))}
              </div>

              {videt.length === 0 ? (
                <Empty icon="search" title="Nic neodpovídá">Zkuste jiné hledání nebo jiný filtr.</Empty>
              ) : (
                <ul className="pl-radky">
                  {videt.slice(0, limit).map((r) => {
                    const otev = otevreno === r.id;
                    return (
                      <li key={r.id} className={`pl-r${otev ? " je-otevreno" : ""}`} data-obec={r.id}>
                        <button type="button" className="pl-r-hlava" aria-expanded={otev} onClick={() => prepni(r.id)}>
                          <Icon name={otev ? "chevron-down" : "chevron-right"} size={16} />
                          <span className="pl-r-jmeno"><Erb id={r.id} name={r.name} size={24} /><span>{r.name}</span></span>
                          <span className="pl-r-lidi">{num(r.population)}</span>
                          <span className="pl-r-upd">
                            {r.upd_celkem > 0
                              ? <>{r.upd_celkem} <span className="mute">ÚPD{r.upd_od ? ` · ${r.upd_od}` : ""}</span></>
                              : <span className="mute">bez ÚPD</span>}
                          </span>
                          <span className="pl-r-plan">
                            {r.od && r.do
                              ? <><span className="pl-r-roky">{r.od}–{r.do}</span>
                                <Pill tone={STAVY[r.stav].tone}>{STAVY[r.stav].label}</Pill></>
                              : <span className="mute">bez programu rozvoje</span>}
                          </span>
                          <Tecky ma={r.ma} />
                        </button>
                        {otev && <Rozbaleno tid={r.id} />}
                      </li>
                    );
                  })}
                </ul>
              )}

              {videt.length > limit && (
                <button type="button" className="pl-vic" onClick={() => setLimit(limit + 120)}>
                  Zobrazit dalších {Math.min(120, videt.length - limit)} z {num(videt.length)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
