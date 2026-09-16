// Tekuté sklo: čočka, odlesk a mapa posunu pro obojí.
//
// Sklo se nepozná podle toho, že je průhledné, ale že **ohýbá** to, co je za
// ním. Tenhle soubor drží dvě věci, které to umožňují — SVG filtry a jejich
// mapu posunu — a sledování kurzoru pro odlesk. Vzhled samotný je v CSS
// (`components.css`, sekce *tekuté sklo*).
//
// Filtry musí být v DOMu všude, kde se sklo používá, ne jen na úvodní
// stránce: dock je na všech vnitřních stránkách a odkaz na chybějící filtr
// znamená prvek bez pozadí. Proto je vykresluje `App`, ne stránka.

import { useEffect, type RefObject } from "react";

/** Mapa posunu pro čočku.
 *
 *  `feDisplacementMap` z ní čte, o kolik posunout který bod pozadí: 128 je
 *  klid, 0 plný posun doleva (nahoru), 255 doprava (dolů). Uvnitř je proto
 *  neutrální šedá a teprve u hrany přechází do krajů — skutečné sklo taky
 *  ohýbá nejvíc tam, kde je nejtlustší.
 *
 *  Vodorovnou osu nese červený kanál, svislou zelený, a druhý přechod se
 *  kreslí na **poloviční krytí**, takže se obě osy vejdou do jednoho obrázku
 *  a filtru stačí jeden průchod místo dvou.
 *
 *  Rozměry jsou jen referenční: `preserveAspectRatio="none"` mapu roztáhne na
 *  skutečnou velikost prvku, takže jedna obslouží různě velké karty. Okraj
 *  i rozmazání se počítají z kratší strany, aby prstenec zůstal přiměřený. */
function mapaPosunu(w: number, h: number, r: number, okrajPodil = 0.16, rozostreniPodil = 0.07): string {
  const okraj = Math.round(Math.min(w, h) * okrajPodil);
  const b = Math.max(2, Math.round(Math.min(w, h) * rozostreniPodil));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
    + `<defs>`
    + `<linearGradient id="gx" x1="0" x2="1"><stop offset="0" stop-color="rgb(0,128,128)"/><stop offset="1" stop-color="rgb(255,128,128)"/></linearGradient>`
    + `<linearGradient id="gy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(128,0,128)"/><stop offset="1" stop-color="rgb(128,255,128)"/></linearGradient>`
    + `<filter id="b"><feGaussianBlur stdDeviation="${b}"/></filter>`
    + `<mask id="p"><rect width="${w}" height="${h}" fill="#fff"/>`
    + `<rect x="${okraj}" y="${okraj}" width="${w - 2 * okraj}" height="${h - 2 * okraj}" rx="${Math.max(0, r - okraj)}" fill="#000" filter="url(#b)"/></mask>`
    + `</defs>`
    + `<rect width="${w}" height="${h}" fill="rgb(128,128,128)"/>`
    + `<g mask="url(#p)"><rect width="${w}" height="${h}" fill="url(#gx)"/>`
    + `<rect width="${w}" height="${h}" fill="url(#gy)" opacity="0.5"/></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const MAPA_KARTA = mapaPosunu(300, 170, 26);
const MAPA_PILULKA = mapaPosunu(260, 54, 27, 0.3, 0.16);

/** Čočky pro sklo. Dvě, protože pilulka má tak nízký poměr stran, že by se
 *  jí mapa karty po roztažení zdeformovala. */
export function SkloFiltry() {
  return (
    <svg className="goo-defs" aria-hidden="true" focusable="false">
      <filter id="sklo-cocka" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage href={MAPA_KARTA} preserveAspectRatio="none" result="mapa" />
        <feDisplacementMap in="SourceGraphic" in2="mapa" scale="64" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="sklo-cocka-pilulka" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage href={MAPA_PILULKA} preserveAspectRatio="none" result="mapa" />
        <feDisplacementMap in="SourceGraphic" in2="mapa" scale="30" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

/** Odlesk skla jde za kurzorem.
 *
 *  Jeden posluchač na celou aplikaci, ne na každý box: skleněných prvků je
 *  přes třicet a třicet posluchačů pointeru je daň, kterou nic nevrátí.
 *  Pozice se zapisuje do `--mx`/`--my` toho prvku, nad kterým kurzor je,
 *  a jednou za snímek — `pointermove` chodí i stokrát za vteřinu a zapisovat
 *  proměnnou při každé zprávě by překreslovalo víc, než se stihne zobrazit.
 *
 *  Na dotyku se nespouští vůbec: prst žádnou polohu „nad" prvkem nemá
 *  a odlesk zůstane tam, kam ho posadil výchozí stav stylu. */
export function useOdlesk(koren: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = koren.current;
    if (!el) return;
    if (document.documentElement.dataset.motion === "reduce") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let raf = 0;
    let posledni: HTMLElement | null = null;
    let cil: HTMLElement | null = null;
    let x = 0, y = 0;

    const zapis = () => {
      raf = 0;
      if (posledni && posledni !== cil) {
        posledni.style.removeProperty("--mx");
        posledni.style.removeProperty("--my");
      }
      posledni = cil;
      if (!cil) return;
      const r = cil.getBoundingClientRect();
      cil.style.setProperty("--mx", `${(((x - r.left) / Math.max(1, r.width)) * 100).toFixed(1)}%`);
      cil.style.setProperty("--my", `${(((y - r.top) / Math.max(1, r.height)) * 100).toFixed(1)}%`);
    };

    const pohyb = (e: PointerEvent) => {
      x = e.clientX; y = e.clientY;
      cil = (e.target as Element | null)?.closest?.<HTMLElement>(".sklo") ?? null;
      if (!raf) raf = requestAnimationFrame(zapis);
    };
    const pryc = () => { cil = null; if (!raf) raf = requestAnimationFrame(zapis); };

    el.addEventListener("pointermove", pohyb, { passive: true });
    el.addEventListener("pointerleave", pryc, { passive: true });
    return () => {
      el.removeEventListener("pointermove", pohyb);
      el.removeEventListener("pointerleave", pryc);
      cancelAnimationFrame(raf);
      posledni?.style.removeProperty("--mx");
      posledni?.style.removeProperty("--my");
    };
  }, [koren]);
}
