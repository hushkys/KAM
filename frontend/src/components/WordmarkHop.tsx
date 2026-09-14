// Maskot doskáče po písmenech KAM. a stane se z něj tečka.
//
// Tečka v logu není ozdoba — je to konec věty. Maskot proto nekončí „vedle
// loga", ale *v něm*: přiběhne zleva, skočí na K, na A, na M a posledním
// skokem spadne přesně tam, kde tečka patří. Písmeno pod ním se při dopadu
// stlačí a po odrazu se pružinou vrátí, takže to má váhu.
//
// Vodorovný a svislý pohyb jsou dvě vnořené skupiny se dvěma různými
// časovacími křivkami. Jedna animace to neumí: vodorovně se letí rovnoměrně,
// svisle zrychluje dolů a zpomaluje nahoru. Kdyby obojí sdílelo jednu křivku,
// vyšel by z toho klouzavý oblouk místo skoku.

import { useEffect, useState } from "react";

/** Písmena wordmarku, aby se každé dalo deformovat zvlášť. Stejná geometrie
 *  jako v Logo.tsx — kdyby se tam měnila, musí se změnit i tady. */
const K = "M0 0h24v41L58 0h30L46 47l44 53H59L32 66l-8 8.6V100H0z";
const A = "M97 100L133 0h27l36 100h-25l-7.2-21h-37L119.6 100zM133.6 58h23l-11.5-34.5z";
const M = "M205 100V0h29l23.5 57L281 0h29v100h-23V43l-19.8 47h-15.4L228 43v57z";

export function WordmarkHop({ onDone }: { onDone?: () => void }) {
  const [hraje, setHraje] = useState(false);

  useEffect(() => {
    const tichy = document.documentElement.dataset.motion === "reduce"
      || matchMedia("(prefers-reduced-motion: reduce)").matches;
    let videno = false;
    try { videno = sessionStorage.getItem("kam.skok.videno") === "1"; } catch { /* privátní režim */ }
    if (tichy || videno) { onDone?.(); return; }
    try { sessionStorage.setItem("kam.skok.videno", "1"); } catch { /* privátní režim */ }
    setHraje(true);
    const t = setTimeout(() => onDone?.(), 2600);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <svg viewBox="-70 -46 430 152" role="img" aria-label="KAM." className={`wordmark hop${hraje ? " is-hraje" : ""}`}>
      <path className="ltr ltr-k" d={K} fill="currentColor" fillRule="evenodd" />
      <path className="ltr ltr-a" d={A} fill="currentColor" fillRule="evenodd" />
      <path className="ltr ltr-m" d={M} fill="currentColor" fillRule="evenodd" />

      {/* Tečka, když se nic nehraje. Během skákání ji zastupuje maskot. */}
      <circle className="hop-tecka" cx="331" cy="86" r="14" fill="var(--lime)" />

      <g className="hop-x">
        <g className="hop-y">
          <g className="hop-mascot">
            <circle r="17" fill="var(--lime)" />
            <ellipse cx="-5.8" cy="-2.6" rx="2.8" ry="3.3" fill="#0a120c" />
            <ellipse cx="5.8" cy="-2.6" rx="2.8" ry="3.3" fill="#0a120c" />
            <path d="M-4.2 4c1.3 2.4 7.1 2.4 8.4 0" fill="none" stroke="#0a120c" strokeWidth="1.7" strokeLinecap="round" />
          </g>
        </g>
      </g>
    </svg>
  );
}
