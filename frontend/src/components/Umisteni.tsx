// Kde zásah postavit: porovnání vybraných míst s nejlepší možnou sadou.
//
// Simulátor vedle odpovídá na „co se stane, když postavíme tři zastávky".
// Tahle karta odpovídá na to druhé, co starostu zajímá: **kde**. Vybraná
// místa se porovnají s nejlepší sadou stejné velikosti, kterou pravidlo najde,
// a je vidět, o kolik se liší.

import { useEffect, useRef, useState } from "react";
import { api, useApi } from "../lib/api";
import { num } from "../lib/format";
import { BarList } from "./charts";
import { Icon } from "./Icon";
import { TerritoryPicker } from "./TerritoryPicker";
import { Card, InfoHint, KindTag } from "./ui";

interface Obec { id: string; name: string; hodnota: number; rok: number; vaha: number; mezera: number; prinos: number; pasmo: string; median_pasma: number }
interface Varianta { obce: Obec[]; prinos: number; lidi: number; chybi: string[] }
interface Vysledek {
  available: boolean; reason?: string;
  zasah: string; pocet: number;
  ukazatel: { code: string; name: string; unit: string; pillar: string };
  median: number | null; mediany_pasem: { pasmo: string; median: number }[];
  co: string; pozn_dat: string;
  vase: Varianta | null; nejlepsi: Varianta;
  rozdil: number | null; rozdil_podil: number | null;
  zebricek: { id: string; name: string; hodnota: number; mezera: number; prinos: number; vaha: number; pasmo: string }[];
  pravidlo: string;
}
interface Pravidla { zasahy: Record<string, { ukazatel: string; co: string; label: string }> }

function Seznam({ v, title, tone }: { v: Varianta; title: string; tone?: string }) {
  return (
    <div className={`um-varianta${tone ? ` tone-${tone}` : ""}`}>
      <div className="um-head">
        <span className="um-title">{title}</span>
        <span className="um-score num">{num(v.prinos)}</span>
      </div>
      <ul className="um-list">
        {v.obce.map((o) => (
          <li key={o.id}>
            <span className="um-obec">{o.name}</span>
            <span className="um-detail mute">{num(o.hodnota, 2)} · medián pásma {num(o.median_pasma, 2)} · {o.pasmo}</span>
            <span className="um-prinos num">{num(o.prinos)}</span>
          </li>
        ))}
        {v.obce.length === 0 && <li className="mute">Zatím nic nevybráno.</li>}
      </ul>
    </div>
  );
}

export function Umisteni({ kraj = 86 }: { kraj?: number }) {
  const { data: pravidla } = useApi<Pravidla>("/umisteni/pravidla");
  const [zasah, setZasah] = useState("spoj");
  const [obce, setObce] = useState<{ id: string; name: string }[]>([]);
  const [res, setRes] = useState<Vysledek | null>(null);
  const [bezi, setBezi] = useState(false);
  const [chyba, setChyba] = useState("");
  const PRAZDNA: Varianta = { obce: [], prinos: 0, lidi: 0, chybi: [] };

  const spustit = async (kod = zasah, vyber = obce) => {
    setBezi(true); setChyba("");
    try {
      setRes(await api<Vysledek>("/umisteni", { body: { zasah: kod, obce: vyber.map((o) => o.id), kraj } }));
    } catch (e) {
      setChyba(e instanceof Error ? e.message : "Nepovedlo se spočítat.");
    } finally {
      setBezi(false);
    }
  };

  const pridej = (id: string, name: string) => {
    if (obce.some((o) => o.id === id) || obce.length >= 12) return;
    const novy = [...obce, { id, name }];
    setObce(novy);
    void spustit(zasah, novy);
  };
  const uber = (id: string) => {
    const novy = obce.filter((o) => o.id !== id);
    setObce(novy);
    void spustit(zasah, novy);
  };

  // Žebříček nejpotřebnějších obcí dává smysl i bez výběru — je to odpověď na
  // „kde bych měl začít", takže se spočítá hned, ne až po prvním kliknutí.
  const prvni = useRef(false);
  useEffect(() => {
    if (prvni.current) return;
    prvni.current = true;
    void spustit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card i={4} title="Kde to postavit" icon="pin"
      actions={res?.available ? <InfoHint label="Podle jakého pravidla">{res.pravidlo}</InfoHint> : undefined}>
      <p className="muted small">
        Tři zastávky v obci, která jich má nadprůměr, nikomu nepomůžou. Vyberte místa a porovnejte je
        s nejlepší sadou stejné velikosti.
      </p>

      <div className="um-ovladani">
        <label className="field">
          <span className="field-label">Zásah</span>
          <select className="select" value={zasah} onChange={(e) => { setZasah(e.target.value); void spustit(e.target.value); }}>
            {Object.entries(pravidla?.zasahy ?? {}).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <div className="um-picker">
          <TerritoryPicker value={null} onChange={pridej} label="Přidat obec" levels={["obec"]} />
        </div>
      </div>

      {obce.length > 0 && (
        <div className="um-chipy">
          {obce.map((o) => (
            <button key={o.id} className="chip-btn is-on" onClick={() => uber(o.id)} aria-label={`Odebrat ${o.name}`}>
              {o.name} <Icon name="close" size={13} />
            </button>
          ))}
        </div>
      )}

      {chyba && <p className="muted small" style={{ color: "var(--bad)" }}>{chyba}</p>}
      {bezi && <span className="skeleton" style={{ height: 120, width: "100%", display: "block", marginTop: 12 }} />}

      {res && res.available && !bezi && (
        <>
          <div className="row" style={{ margin: "14px 0 10px" }}>
            <KindTag kind="MODEL" />
            <span className="muted small">{res.ukazatel.name} · {res.co}</span>
          </div>

          <div className="um-grid">
            <Seznam v={res.vase ?? PRAZDNA} title="Vaše volba" />
            <Seznam v={res.nejlepsi} title={`Nejpotřebnějších ${res.pocet}`} tone="ok" />
          </div>

          {res.vase && res.vase.obce.length > 0 && (
            <p className="um-zaver">
              {res.rozdil === 0
                ? "Vybrali jste přesně ta místa, která pravidlo označuje za nejpotřebnější."
                : <>Nejpotřebnější místa by posloužila o <strong>{num(res.rozdil)}</strong>{" "}
                  ({num(res.rozdil_podil, 1)} %) víc — {res.co}.</>}
            </p>
          )}

          <div className="section-gap" />
          <h4 className="um-pod">Nejpotřebnější obce podle tohoto pravidla</h4>
          <BarList format={(v) => num(v)}
            items={res.zebricek.slice(0, 10).map((z) => ({
              key: z.id, value: z.prinos,
              label: obce.some((o) => o.id === z.id) ? <strong>{z.name}</strong> : z.name,
              hint: <span className="mute">{num(z.hodnota, 2)} · {z.pasmo}</span>,
            }))} />

          <p className="xsmall mute" style={{ marginTop: 12 }}>
            Mediány pásem: {res.mediany_pasem.map((m) => `${m.pasmo} ${num(m.median, 2)}`).join(" · ")}.
            {res.pozn_dat ? ` ${res.pozn_dat}` : ""}
          </p>
        </>
      )}
      {res && !res.available && <p className="muted small" style={{ marginTop: 12 }}>{res.reason}</p>}
    </Card>
  );
}
