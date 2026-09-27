// Program rozvoje a registry — kostka na profilu území.
//
// Na profilu jde o jednu otázku: má tahle obec platný plán a kam se kliknout
// pro originál. Celý rozbor (peníze za období, srovnání v kraji) je na
// stránce Plány, takže sem patří stav, odkaz na dokument a odkazy do
// registrů — nic víc. Karta se nevykreslí, dokud odpověď nedojde: prázdný
// rámeček s „načítám" je na profilu, kde je karet deset, jen šum.

import { Icon } from "./Icon";
import { Card, Pill } from "./ui";
import { useApi } from "../lib/api";
import { Link } from "../lib/router";

interface Registr { klic: string; nazev: string; url: string }
interface Plan { nazev: string; od: number; do: number; url: string; zdroj_url: string; stav: string; uplynulo: number | null }
interface Data { ico: string; ds: string; plan: Plan | null; registry: Registr[]; obcepro_url: string }

const STAVY: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  plati: { label: "platí", tone: "ok" },
  konci: { label: "poslední rok", tone: "warn" },
  prosly: { label: "doběhlo", tone: "bad" },
  bez_obdobi: { label: "bez období", tone: "neutral" },
};

export function PlanyKarta({ tid, i }: { tid: string; i?: number }) {
  const { data } = useApi<Data>(`/plany/${tid}`);
  if (!data) return null;
  // Bez plánu i bez IČO by karta neměla co říct a jen by zabrala místo.
  if (!data.plan && data.registry.length === 0) return null;
  const p = data.plan;

  return (
    <Card title="Program rozvoje a registry" icon="landmark" i={i}>
      {p ? (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <Pill tone={STAVY[p.stav]?.tone ?? "neutral"}>{STAVY[p.stav]?.label ?? p.stav}</Pill>
            <span className="xsmall mute">období {p.od}–{p.do}</span>
          </div>
          <div className="list">
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="list-row">
              <span className="list-main">
                <span className="list-title small">{p.nazev}</span>
                <span className="list-sub">Program rozvoje obce · registr MMR</span>
              </span>
              <Icon name="external" size={14} />
            </a>
          </div>
        </>
      ) : (
        <p className="muted small" style={{ marginTop: 0 }}>
          Program rozvoje obce není v registru MMR. Program není povinný, takže to neznamená,
          že obec neplánuje.
        </p>
      )}

      {data.registry.length > 0 && (
        <div className="list" style={{ marginTop: p ? 8 : 10 }}>
          {data.registry.map((r) => (
            <a key={r.klic} href={r.url} target="_blank" rel="noopener noreferrer" className="list-row">
              <span className="list-main"><span className="list-title small">{r.nazev}</span></span>
              <Icon name="external" size={14} />
            </a>
          ))}
        </div>
      )}

      <p className="xsmall mute" style={{ marginTop: 10 }}>
        {data.ico && <>IČO {data.ico}{data.ds ? ` · datová schránka ${data.ds}` : ""}. </>}
        Kolik z plánu je hotové, žádný registr nezveřejňuje.{" "}
        <Link to={`/plany?t=${tid}`}>Otevřít plány obce</Link>
      </p>
    </Card>
  );
}
