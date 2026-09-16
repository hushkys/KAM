// Pruh, který přizná, že čísla nejsou čerstvá.
//
// Nainstalovaná aplikace se otevře i bez signálu — service worker vrátí
// poslední staženou odpověď. To je užitečné, ale jen dokud je jasné, že jde
// o včerejšek. Celá aplikace stojí na tom, že každé číslo je z databáze
// a k němu patří rok; tiše servírovat uloženou kopii jako aktuální stav by
// bylo přesně to, co KAM jinde vytýká ostatním.

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

/** Po téhle době se hlášení scvrkne na odznak. Celou větu je potřeba přečíst
 *  jednou; dál už stačí, že je ten stav pořád vidět. */
const DO_ODZNAKU = 6000;

export function Offline() {
  const [venku, setVenku] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  const [maly, setMaly] = useState(false);

  useEffect(() => {
    const pryc = () => setVenku(true);
    const zpet = () => setVenku(false);
    window.addEventListener("offline", pryc);
    window.addEventListener("online", zpet);
    // Rozhoduje service worker, ne `navigator.onLine`: ten je pořád `true`,
    // i když je mobil na síti a nedostupný je server. Pruh se pak řídí tím,
    // odkud odpověď doopravdy přišla.
    const zprava = (e: MessageEvent) => {
      const stav = (e.data as { kam?: string } | null)?.kam;
      if (stav === "offline") setVenku(true);
      else if (stav === "online") setVenku(false);
    };
    navigator.serviceWorker?.addEventListener("message", zprava);
    return () => {
      window.removeEventListener("offline", pryc);
      window.removeEventListener("online", zpet);
      navigator.serviceWorker?.removeEventListener("message", zprava);
    };
  }, []);

  // Smrsknutí se počítá od chvíle, kdy spojení vypadlo, ne od načtení
  // stránky: kdo přijde o signál po deseti minutách čtení, má nárok na celou
  // větu stejně jako ten, komu vypadlo hned.
  useEffect(() => {
    if (!venku) { setMaly(false); return; }
    const id = window.setTimeout(() => setMaly(true), DO_ODZNAKU);
    return () => window.clearTimeout(id);
  }, [venku]);

  // Stav se hlásí i do dokumentu: hlášení (`.toasts`) se vozí ve stejné
  // výšce a na telefonu by přes pruh přeteklo, tak o něj vystoupají.
  // Vrstvy o sobě jinak nemají jak vědět.
  useEffect(() => {
    const r = document.documentElement;
    if (venku) r.dataset.spojeni = "pryc";
    else delete r.dataset.spojeni;
    return () => { delete r.dataset.spojeni; };
  }, [venku]);

  if (!venku) return null;
  return (
    <div className={`offline-pruh glass ${maly ? "je-maly" : ""}`} role="status"
      title="Aplikace čte poslední staženou odpověď. Čísla nemusí být aktuální."
      onPointerEnter={() => setMaly(false)} onClick={() => setMaly((m) => !m)}>
      <span className="off-sheen" aria-hidden="true" />
      <Icon name="alert" size={13} />
      <strong>Bez spojení</strong>
      <span className="off-detail">čísla z poslední návštěvy</span>
    </div>
  );
}
