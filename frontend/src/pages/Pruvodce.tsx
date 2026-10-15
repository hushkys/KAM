// Průvodce novým scénářem: jedna otázka na obrazovce, jeden blok.
//
// Cesty: hotový scénář (typická otázka obce) → území; nový scénář → oblast →
// zásah → území; uložený scénář → rovnou výsledek. Kdo přidává další zásah
// k hotovému scénáři, dostane jen oblast a zásah. Nic se tu nepočítá: průvodce
// jen nastaví území a zásahy a předá řízení stránce s výsledkem.

import { useMemo, useState } from "react";
import { Icon, PILLAR_ICON } from "../components/Icon";
import { TerritoryPicker } from "../components/TerritoryPicker";
import { Card, InfoHint } from "../components/ui";
import { date } from "../lib/format";

export interface PSpec { label: string; pillar: string; pillar_label: string }
export interface PSada { key: string; label: string; otazka: string; pillar: string; ivs: { type: string; params: Record<string, number | string> }[] }
export interface PUlozeny { id: string; name: string; territory: string; territory_name: string; created_at: string; interventions: { type: string; params: Record<string, number | string> }[] }
interface PIv { type: string; params: Record<string, number | string> }

type Krok = "start" | "sada" | "ulozene" | "kategorie" | "zasah" | "uzemi";
type Rezim = "" | "sada" | "novy" | "ulozene";

const TOK: Record<string, Krok[]> = {
  sada: ["start", "sada", "uzemi"],
  novy: ["start", "kategorie", "zasah", "uzemi"],
  pridat: ["kategorie", "zasah"],
};

export function Pruvodce({ interventions, help, sady, ulozene, tid, setTid, setIvs, vytvor, pridat, onHotovo, onZrus }: {
  interventions: Record<string, PSpec>; help: Record<string, string>; sady: PSada[]; ulozene: PUlozeny[];
  tid: string; setTid: (id: string) => void; setIvs: (fn: (all: PIv[]) => PIv[]) => void;
  vytvor: (type: string) => PIv; pridat: boolean; onHotovo: () => void; onZrus: () => void;
}) {
  const [krok, setKrok] = useState<Krok>(pridat ? "kategorie" : "start");
  const [hist, setHist] = useState<Krok[]>([]);
  const [rezim, setRezim] = useState<Rezim>(pridat ? "novy" : "");
  const [pillar, setPillar] = useState("");

  const kategorie = useMemo(() => {
    const out: { pillar: string; label: string; items: [string, PSpec][] }[] = [];
    for (const [k, v] of Object.entries(interventions)) {
      const g = out.find((x) => x.pillar === v.pillar);
      if (g) g.items.push([k, v]);
      else out.push({ pillar: v.pillar, label: v.pillar_label, items: [[k, v]] });
    }
    return out;
  }, [interventions]);

  const jdi = (k: Krok) => { setHist((h) => [...h, krok]); setKrok(k); };
  const zpet = () => {
    if (!hist.length) { onZrus(); return; }
    setKrok(hist[hist.length - 1]); setHist((h) => h.slice(0, -1));
  };

  const tok = pridat ? TOK.pridat : TOK[rezim === "sada" ? "sada" : "novy"];
  const poradi = Math.max(0, tok.indexOf(krok));
  const ukazPostup = krok !== "start" && krok !== "ulozene";

  const vyberZasah = (type: string) => {
    setIvs((all) => (all.some((i) => i.type === type) ? all : [...all, vytvor(type)]));
    if (pridat) onHotovo(); else jdi("uzemi");
  };

  const kat = kategorie.find((k) => k.pillar === pillar);

  return (
    <Card i={1} className="pruvodce">
      <div className="pr-hlava">
        {(hist.length > 0 || pridat) && krok !== "start" && (
          <button className="btn btn-quiet btn-sm" onClick={zpet}><Icon name="chevron-left" size={15} /> Zpět</button>
        )}
        {ukazPostup && (
          <span className="pr-postup" aria-label={`Krok ${poradi + 1} z ${tok.length}`}>
            {tok.map((_, i) => <i key={i} className={i <= poradi ? "is-on" : ""} />)}
            <span className="pr-postup-text">Krok {poradi + 1} z {tok.length}</span>
          </span>
        )}
      </div>

      {krok === "start" && (
        <>
          <h2 className="pr-otazka">Jak chcete začít? <InfoHint label="Co jsou scénáře">Model spočítá výhled území dvakrát, bez zásahu a se zásahem, a ukáže rozdíl. Je to odhad z předpokladů, které můžete změnit, ne předpověď.</InfoHint></h2>
          <div className="pr-volby is-start">
            <button className="pr-volba" onClick={() => { setRezim("sada"); jdi("sada"); }}>
              <i className="pr-ikona"><Icon name="target" size={24} /></i><strong>Hotový scénář</strong><span>Typická otázka obce, zásahy se nastaví samy.</span>
            </button>
            <button className="pr-volba" onClick={() => { setRezim("novy"); jdi("kategorie"); }}>
              <i className="pr-ikona"><Icon name="plus" size={24} /></i><strong>Nový scénář</strong><span>Sami zvolíte oblast a zásah z {Object.keys(interventions).length} možností.</span>
            </button>
            {ulozene.length > 0 && (
              <button className="pr-volba" onClick={() => { setRezim("ulozene"); jdi("ulozene"); }}>
                <i className="pr-ikona"><Icon name="save" size={24} /></i><strong>Uložený scénář</strong><span>{ulozene.length === 1 ? "Máte jeden uložený." : `Uloženo: ${ulozene.length}.`}</span>
              </button>
            )}
          </div>
          {sady.length > 0 && (
            <div className="pr-rychle">
              <h3 className="pr-podnadpis">Nebo rovnou vyzkoušejte</h3>
              <div className="pr-seznam">
                {sady.map((s) => (
                  <button key={s.key} className="pr-polozka" onClick={() => { setRezim("sada"); setIvs(() => s.ivs.map((i) => ({ type: i.type, params: { ...i.params } }))); jdi("uzemi"); }}>
                    <i className="pr-ikona is-mala"><Icon name={PILLAR_ICON[s.pillar] ?? "target"} size={18} /></i>
                    <span><strong>{s.label}</strong><small>{s.otazka}</small></span>
                    <Icon name="chevron-right" size={16} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {krok === "sada" && (
        <>
          <h2 className="pr-otazka">Na jakou otázku hledáte odpověď? <InfoHint label="Hotové scénáře">Typické otázky, se kterými obce přicházejí. Zásahy a jejich velikost půjde na dalším místě upravit.</InfoHint></h2>
          <div className="pr-seznam">
            {sady.map((s) => (
              <button key={s.key} className="pr-polozka" onClick={() => { setIvs(() => s.ivs.map((i) => ({ type: i.type, params: { ...i.params } }))); jdi("uzemi"); }}>
                <Icon name={PILLAR_ICON[s.pillar] ?? "target"} size={20} />
                <span><strong>{s.label}</strong><small>{s.otazka}</small></span>
                <Icon name="chevron-right" size={16} />
              </button>
            ))}
          </div>
        </>
      )}

      {krok === "ulozene" && (
        <>
          <h2 className="pr-otazka">Který scénář otevřít?</h2>
          <div className="pr-seznam">
            {ulozene.map((s) => (
              <button key={s.id} className="pr-polozka" onClick={() => { setTid(s.territory); setIvs(() => s.interventions); onHotovo(); }}>
                <Icon name="save" size={20} />
                <span><strong>{s.name}</strong><small>{s.territory_name} · {date(s.created_at)}</small></span>
                <Icon name="chevron-right" size={16} />
              </button>
            ))}
          </div>
        </>
      )}

      {krok === "kategorie" && (
        <>
          <h2 className="pr-otazka">V jaké oblasti chcete scénář vytvořit?</h2>
          <div className="pr-volby">
            {kategorie.map((k) => (
              <button key={k.pillar} className="pr-volba" onClick={() => { setPillar(k.pillar); jdi("zasah"); }}>
                <i className="pr-ikona"><Icon name={PILLAR_ICON[k.pillar] ?? "target"} size={24} /></i><strong>{k.label}</strong>
                <span>{k.items.length === 1 ? "1 zásah" : k.items.length < 5 ? `${k.items.length} zásahy` : `${k.items.length} zásahů`}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {krok === "zasah" && kat && (
        <>
          <h2 className="pr-otazka">Jaký zásah chcete vyzkoušet? <span className="pr-kat">{kat.label}</span></h2>
          <div className="pr-seznam">
            {kat.items.map(([k, v]) => (
              <div key={k} className="pr-polozka-radek">
                <button className="pr-polozka" onClick={() => vyberZasah(k)}>
                  <Icon name={PILLAR_ICON[v.pillar] ?? "target"} size={20} />
                  <span><strong>{v.label}</strong></span>
                  <Icon name="chevron-right" size={16} />
                </button>
                {help[k] && <InfoHint label={`Co dělá: ${v.label}`}>{help[k]}</InfoHint>}
              </div>
            ))}
          </div>
        </>
      )}

      {krok === "uzemi" && (
        <>
          <h2 className="pr-otazka">Pro které území to chcete spočítat?</h2>
          <div className="pr-uzemi"><TerritoryPicker value={tid} onChange={setTid} label="Obec, ORP, okres nebo kraj" /></div>
          <div className="pr-akce"><button className="btn btn-primary" onClick={onHotovo}>Spočítat scénář <Icon name="arrow-right" size={16} /></button></div>
        </>
      )}
    </Card>
  );
}
