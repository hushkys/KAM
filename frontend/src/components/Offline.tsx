// Pruh, který přizná, že čísla nejsou čerstvá.
//
// Nainstalovaná aplikace se otevře i bez signálu — service worker vrátí
// poslední staženou odpověď. To je užitečné, ale jen dokud je jasné, že jde
// o včerejšek. Celá aplikace stojí na tom, že každé číslo je z databáze
// a k němu patří rok; tiše servírovat uloženou kopii jako aktuální stav by
// bylo přesně to, co KAM jinde vytýká ostatním.

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

export function Offline() {
  const [venku, setVenku] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);

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

  if (!venku) return null;
  return (
    <div className="offline-pruh" role="status">
      <Icon name="alert" size={15} />
      <span><strong>Bez spojení</strong> — čísla z poslední návštěvy.</span>
    </div>
  );
}
