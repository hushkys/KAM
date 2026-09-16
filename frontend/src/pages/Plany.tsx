// Plány: co si obec sama naplánovala a kde to má zveřejněné.
//
// Stránka stojí na jednom rozlišení, které se nesmí rozmazat: **období
// dokumentu** je doložitelné, **splnění plánu** doložitelné není. Nikde
// v Česku neexistuje registr, kde by u jednotlivého záměru stálo
// „realizováno" — obce to vyhodnocují vlastními zprávami v PDF, každá jinak.
// Proto se tu pruhu, který je plný, nikdy neříká „hotovo", jen „období
// uplynulo", a k částce za investice patří věta, že rozpočet neví, co za ni
// obec pořídila.
//
// Druhá zásada: u každého cizího údaje je odkaz na originál, a odkaz míří
// rovnou na tu obec, ne na vyhledávací formulář. Adresa se skládá z IČO,
// které je v `Territory.ico` z ARESu — proto ta tabulka registrů zmizí
// u obce, kterou se spárovat nepodařilo, místo aby nabídla odkaz naslepo.

import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { PlanyHook } from "../components/PlanyHook";
import { TerritoryPicker } from "../components/TerritoryPicker";
import { Card, Empty, ErrorBox, KindTag, Pill, Progress, Stat } from "../components/ui";
import { useApi } from "../lib/api";
import { compact, date, fold, num, pct, plural } from "../lib/format";
import { Link, setQuery, useLocation } from "../lib/router";

interface Radek {
  id: string; name: string; population: number; orp_id: string; ico: string; ds: string;
  stav: string; nazev?: string; od?: number; do?: number; url?: string;
  uplynulo?: number | null; publikovano?: string | null;
}
interface RegistrMeta { klic: string; nazev: string; kdo: string; co: string; povinnost: string }
interface Prehled {
  kraj: { code: number; obci: number };
  letos: number; s_planem: number; pokryti: number;
  pocty: Record<string, number>;
  s_ico: number; s_ds: number;
  obyvatel_s_planem: number; obyvatel_celkem: number;
  konce: { rok: number; pocet: number }[];
  seznam: Radek[]; registry: RegistrMeta[]; obcepro_url: string; poznamka: string;
}
interface Investice { od_dat: number; do_dat: number; roky: number; kapital: number; prijmy: number; podil: number | null }
interface Plan {
  nazev: string; od: number; do: number; publikovano: string | null; url: string;
  zdroj_nazev: string; zdroj_url: string; stav: string; uplynulo: number | null;
  zbyva_let: number | null; investice?: Investice | null;
}
interface Detail {
  territory: { id: string; name: string; level: string; population: number };
  ico: string; ds: string; plan: Plan | null;
  registry: (RegistrMeta & { url: string })[];
  obcepro_url: string; poznamka: string;
}

const STAVY: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  plati: { label: "období běží", tone: "ok" },
  konci: { label: "poslední rok", tone: "warn" },
  prosly: { label: "období doběhlo", tone: "bad" },
  bez_obdobi: { label: "bez období", tone: "neutral" },
  chybi: { label: "není v registru", tone: "neutral" },
};

/** Barva pruhu podle stavu dokumentu, ne podle toho, jak je plný. */
const TONY: Record<string, string> = { plati: "accent", konci: "warn", prosly: "mute" };

const FILTRY: { key: string; label: string }[] = [
  { key: "ma", label: "S programem rozvoje" },
  { key: "plati", label: "Období běží" },
  { key: "prosly", label: "Doběhlo" },
  { key: "chybi", label: "Není v registru" },
];

function kc(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${compact(v)} Kč`;
}

/** Pruh období: vyplněná část je uplynulý čas, ne splněné záměry. */
function Obdobi({ r }: { r: Radek }) {
  if (!r.od || !r.do) return <span className="mute">—</span>;
  const u = r.uplynulo ?? 0;
  return (
    <span className="pl-obdobi">
      <span className="pl-obdobi-roky">{r.od}–{r.do}</span>
      <span className="pl-obdobi-drah" data-stav={r.stav}>
        <i style={{ width: `${Math.round(u * 100)}%` }} />
      </span>
      <span className="pl-obdobi-pct">{pct(u * 100, 0)}</span>
    </span>
  );
}

function RegistrKarta({ r }: { r: RegistrMeta & { url?: string } }) {
  const obsah = (
    <>
      <span className="zk-head">
        <strong>{r.nazev}</strong>
        {r.url && <Icon name="external" size={15} />}
      </span>
      <span className="zk-kdo">{r.kdo}</span>
      <span className="zk-pozn">{r.co}</span>
      <span className="zk-tagy"><span className="chip">{r.povinnost}</span></span>
    </>
  );
  return r.url
    ? <a className="zdroj-karta" href={r.url} target="_blank" rel="noopener noreferrer">{obsah}</a>
    : <div className="zdroj-karta je-bez-odkazu">{obsah}</div>;
}

function Detailni({ d }: { d: Detail }) {
  const p = d.plan;
  const inv = p?.investice ?? null;
  return (
    <Card i={1} title={`${d.territory.name}: co má zveřejněné`} icon="landmark">
      {p ? (
        <>
          <div className="pl-plan-hlava">
            <div>
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <KindTag kind="FAKT" />
                <Pill tone={STAVY[p.stav].tone}>{STAVY[p.stav].label}</Pill>
              </div>
              <strong className="pl-plan-nazev">{p.nazev}</strong>
              <p className="small mute" style={{ margin: "6px 0 0" }}>
                {p.zdroj_nazev}
                {p.publikovano ? ` · zveřejněno ${date(p.publikovano)}` : ""}
              </p>
            </div>
            <div className="row">
              {p.url && (
                <a className="btn btn-primary" href={p.url} target="_blank" rel="noopener noreferrer">
                  <Icon name="download" size={16} /> Otevřít dokument
                </a>
              )}
              <a className="btn" href={p.zdroj_url} target="_blank" rel="noopener noreferrer">
                <Icon name="external" size={16} /> Registr MMR
              </a>
            </div>
          </div>

          <div className="pl-postup">
            <div className="pl-postup-hlava">
              <span>Z období {p.od}–{p.do} uplynulo</span>
              <strong>{pct((p.uplynulo ?? 0) * 100, 0)}</strong>
            </div>
            <Progress value={p.uplynulo ?? 0} tone={TONY[p.stav] ?? "accent"}
              label={`Z období ${p.od}–${p.do} uplynulo ${pct((p.uplynulo ?? 0) * 100, 0)}`} />
            <p className="xsmall mute" style={{ marginTop: 8 }}>
              {p.zbyva_let && p.zbyva_let > 0
                ? `Do konce období zbývá ${p.zbyva_let} ${plural(p.zbyva_let, "rok", "roky", "let")}.`
                : "Období dokumentu už doběhlo."}{" "}
              Uplynulý čas není splněný plán — kolik z něj je hotové, nezveřejňuje strojově čitelně žádný registr.
            </p>
          </div>

          {inv && (
            <div className="facts-list" style={{ marginTop: 14 }}>
              <div className="fact-row">
                <span>Kapitálové výdaje za období {inv.od_dat}–{inv.do_dat}</span>
                <span className="num">{kc(inv.kapital)}</span>
              </div>
              <div className="fact-row">
                <span>Podíl na příjmech za tytéž roky</span>
                <span className="num">{inv.podil !== null ? pct(inv.podil * 100, 1) : "—"}</span>
              </div>
              <div className="fact-row">
                <span>Roků rozpočtu, které máme</span>
                <span className="num">{inv.roky} z {p.do - p.od + 1}</span>
              </div>
            </div>
          )}
          <p className="xsmall mute" style={{ marginTop: 10 }}>
            Částka je z rozpočtu obce (ČSÚ MOS podle výkazu FIN 2-12 M), ne z plánu. Rozpočtová
            skladba neříká, co za peníze obec pořídila, takže vedle sebe stojí dvě věci ze dvou
            zdrojů — ne příčina a následek. <Link to={`/hospodareni?t=${d.territory.id}`}>Hospodaření obce</Link>
          </p>
        </>
      ) : (
        <Empty icon="info" title="Program rozvoje v registru MMR není">
          Neznamená to, že obec neplánuje — zveřejnění na obcepro.cz je dobrovolné a řada obcí
          má dokument jen na vlastním webu nebo na úřední desce.{" "}
          <a href={d.obcepro_url} target="_blank" rel="noopener noreferrer">Ověřit v registru MMR</a>
        </Empty>
      )}

      {d.registry.length > 0 ? (
        <>
          <h3 className="pl-podnadpis">Registry, kde je obec dohledatelná</h3>
          <p className="small mute" style={{ margin: "0 0 12px" }}>
            Odkazy míří rovnou na tuhle obec — skládají se z jejího IČO {d.ico}
            {d.ds ? `, datová schránka ${d.ds}` : ""}.
          </p>
          <div className="zdroje-grid">
            {d.registry.map((r) => <RegistrKarta key={r.klic} r={r} />)}
          </div>
        </>
      ) : (
        <p className="small mute" style={{ marginTop: 14 }}>
          IČO úřadu se pro tuhle obec nepodařilo spárovat s ARESem, takže sem nevede přesný odkaz
          do registrů. Raději žádný než odkaz naslepo do jiné obce.
        </p>
      )}
    </Card>
  );
}

export function Plany() {
  const { query } = useLocation();
  const tid = query.get("t") ?? "";
  const { data, error, reload } = useApi<Prehled>("/plany");
  const det = useApi<Detail>(tid ? `/plany/${tid}` : null);
  const [hledat, setHledat] = useState("");
  const [filtr, setFiltr] = useState("ma");

  const seznam = data?.seznam ?? [];
  const videt = useMemo(() => {
    const q = fold(hledat.trim());
    return seznam.filter((r) => {
      if (filtr === "ma" && r.stav === "chybi") return false;
      if (filtr === "plati" && !(r.stav === "plati" || r.stav === "konci")) return false;
      if (filtr === "prosly" && r.stav !== "prosly") return false;
      if (filtr === "chybi" && r.stav !== "chybi") return false;
      return !q || fold(r.name).includes(q) || r.ico.includes(q);
    });
  }, [seznam, hledat, filtr]);

  const p = data?.pocty;

  return (
    <>
      <PlanyHook plany={seznam} letos={data?.letos ?? new Date().getFullYear()}>
        <div className="row" style={{ marginTop: 18 }}>
          <a className="btn" href={data?.obcepro_url ?? "https://www.obcepro.cz/publikovane-dokumenty"}
            target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={16} /> Registr MMR
          </a>
          <Link className="btn" to="/hospodareni"><Icon name="coins" size={16} /> Hospodaření</Link>
        </div>
      </PlanyHook>

      <div className="stack-y">
        <div className="toolbar-card reveal">
          <div className="toolbar-picker">
            <TerritoryPicker value={tid || null} levels={["obec"]} label="Obec"
              onChange={(id) => setQuery({ t: id })} />
          </div>
          {tid && (
            <button type="button" className="btn btn-quiet" onClick={() => setQuery({ t: null })}>
              <Icon name="close" size={16} /> Zpět na kraj
            </button>
          )}
        </div>

        <ErrorBox error={error} retry={reload} />
        <ErrorBox error={det.error} retry={det.reload} />

        {data && (
          <>
            <div className="stats-row">
              <Stat i={0} label="Obcí s programem rozvoje" value={num(data.s_planem)}
                sub={`z ${num(data.kraj.obci)} · ${pct(data.pokryti * 100, 1)} obcí kraje`} />
              <Stat i={1} label="Období ještě běží" value={num((p?.plati ?? 0) + (p?.konci ?? 0))}
                sub={p?.konci ? `z toho ${p.konci} v posledním roce` : ""} tone="ok" />
              <Stat i={2} label="Období doběhlo" value={num(p?.prosly ?? 0)}
                sub="dokument po konci platnosti" tone={p?.prosly ? "warn" : undefined} />
              <Stat i={3} label="Obcí s IČO a datovou schránkou" value={num(data.s_ds)}
                sub={`IČO ${num(data.s_ico)} · odkaz do registrů`} />
            </div>

            {det.data && <Detailni d={det.data} />}

            <Card i={2} title="Programy rozvoje obcí v kraji" icon="landmark"
              actions={<span className="muted small">{num(videt.length)} {plural(videt.length, "obec", "obce", "obcí")}</span>}>
              <div className="row pl-nastroje">
                <div className="input-icon pl-hledat">
                  <Icon name="search" size={17} />
                  <input className="input" type="search" value={hledat} placeholder="Hledat obec nebo IČO…"
                    onChange={(e) => setHledat(e.target.value)} aria-label="Hledat obec" />
                </div>
                <div className="chips" role="group" aria-label="Filtr">
                  {FILTRY.map((f) => (
                    <button key={f.key} type="button" className={`chip chip-btn${filtr === f.key ? " is-on" : ""}`}
                      aria-pressed={filtr === f.key} onClick={() => setFiltr(f.key)}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {videt.length === 0 ? (
                <Empty icon="search" title="Nic neodpovídá">Zkuste jiné hledání nebo jiný filtr.</Empty>
              ) : (
                <ul className="pl-seznam">
                  {videt.slice(0, 200).map((r) => (
                    <li key={r.id} className="pl-radek" data-stav={r.stav}>
                      <Link className="pl-obec" to={`/plany?t=${r.id}`}>{r.name}</Link>
                      <span className="pl-lidi">{num(r.population)} obyv.</span>
                      <Obdobi r={r} />
                      <span className="pl-znacka"><Pill tone={STAVY[r.stav].tone}>{STAVY[r.stav].label}</Pill></span>
                      <span className="pl-odkazy">
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noopener noreferrer" title="Dokument (PDF, obcepro.cz)">
                            <Icon name="download" size={15} /><span className="visually-hidden">Dokument</span>
                          </a>
                        )}
                        {r.ico && (
                          <a href={`https://monitor.statnipokladna.gov.cz/ucetni-jednotka/${r.ico}/rozpocet-obce`}
                            target="_blank" rel="noopener noreferrer" title="Rozpočet v MONITORu státní pokladny">
                            <Icon name="coins" size={15} /><span className="visually-hidden">Rozpočet</span>
                          </a>
                        )}
                        {r.ico && (
                          <a href={`https://smlouvy.gov.cz/vyhledavani?subject_idnum=${r.ico}`}
                            target="_blank" rel="noopener noreferrer" title="Smlouvy obce v registru smluv">
                            <Icon name="link" size={15} /><span className="visually-hidden">Smlouvy</span>
                          </a>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {videt.length > 200 && (
                <p className="xsmall mute" style={{ marginTop: 10 }}>
                  Zobrazeno prvních 200 z {num(videt.length)}. Zúžit jde hledáním.
                </p>
              )}
              <p className="xsmall mute" style={{ marginTop: 12 }}>{data.poznamka}</p>
            </Card>

            <Card i={3} title="Odkud se to bere a kam vede odkaz" icon="shield">
              <p className="small mute" style={{ margin: "0 0 14px" }}>
                Program rozvoje je z registru Ministerstva pro místní rozvoj. Zbytek jsou
                celostátní registry, do kterých se vstupuje přes IČO úřadu — u každé obce
                v seznamu proto vedou odkazy rovnou na ni, ne na vyhledávací formulář.
              </p>
              <div className="zdroje-grid">
                <RegistrKarta r={{
                  klic: "obcepro", nazev: "Programy rozvoje obcí (obcepro.cz)",
                  kdo: "Ministerstvo pro místní rozvoj",
                  co: "Jediné místo, kde jsou programy rozvoje obcí pohromadě. Zveřejnění je dobrovolné, takže registr nepokrývá všechny obce.",
                  povinnost: "Metodická podpora MMR — zveřejnění dobrovolné",
                  url: data.obcepro_url,
                }} />
                {data.registry.map((r) => <RegistrKarta key={r.klic} r={r} />)}
              </div>
              <p className="xsmall mute" style={{ marginTop: 14 }}>
                Co z plánu je hotové, se tu netvrdí. Registr, kde by u jednotlivého záměru stálo
                „realizováno", v Česku neexistuje; obce plnění vyhodnocují vlastními zprávami
                v PDF, každá po svém. KAM proto ukazuje jen doložitelné: platnost dokumentu, kolik
                z jeho období uplynulo a kolik obec za tu dobu poslala do majetku.
              </p>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
