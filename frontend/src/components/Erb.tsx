// Znak území. Soubory připravuje `scripts/erby.py` (Wikidata + Wikimedia
// Commons, spárované podle kódu obce z RÚIAN) do `public/erby/<kód>.webp`
// a seznam toho, co existuje, do `src/erby.json` — díky němu se nežádá o
// obrázek, který na serveru není, a nevzniká stovka zbytečných 404.
//
// ORP a okres vlastní znak nemají; dostanou znak svého sídla, podle kterého
// je člověk pozná. Obec bez znaku dostane neutrální štít s počátečním
// písmenem — prázdné místo by rozhodilo mřížku a karty by se přestaly
// srovnávat do řady. Není to chyba sklizně: 36 obcí kraje znak udělený
// nemá (ověřeno v Registru komunálních symbolů), a štít to proto říká.

import { useState } from "react";
import erby from "../erby.json";

const OBCE = new Set<string>(erby.obce);
const SIDLA = erby.sidla as Record<string, string>;
const KRAJE = erby.kraj as Record<string, string>;

/** Adresa znaku pro území podle jeho id (`obec:579432`, `orp:1228`, `kraj:86`). */
export function erbAdresa(id: string): string | null {
  const [uroven, kod] = id.split(":");
  if (uroven === "obec") return OBCE.has(kod) ? `/erby/${kod}.webp` : null;
  if (uroven === "orp" || uroven === "okres") return SIDLA[id] ? `/erby/${SIDLA[id]}.webp` : null;
  if (uroven === "kraj") return KRAJE[kod] ? `/erby/${KRAJE[kod]}.webp` : null;
  return null;
}

export function Erb({ id, name, size = 40, className = "" }: { id: string; name: string; size?: number; className?: string }) {
  const [chyba, setChyba] = useState(false);
  const url = erbAdresa(id);
  if (!url || chyba) {
    return (
      <span className={`erb erb-zadny ${className}`} style={{ width: size, height: size }} aria-hidden="true"
        title={id.startsWith("obec:") && !chyba ? "Obec nemá udělený znak" : undefined}>
        <svg viewBox="0 0 40 40" width={size} height={size}>
          <path d="M8 6h24v14c0 8-5.5 12.5-12 15-6.5-2.5-12-7-12-15z" />
          <text x="20" y="24" textAnchor="middle">{name.trim().charAt(0).toUpperCase()}</text>
        </svg>
      </span>
    );
  }
  return (
    <img className={`erb ${className}`} src={url} width={size} height={size} alt="" aria-hidden="true"
      loading="lazy" decoding="async" draggable={false} onError={() => setChyba(true)} />
  );
}
