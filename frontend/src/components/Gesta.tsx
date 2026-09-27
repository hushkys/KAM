// Přejetí prstem mezi stránkami.
//
// Na telefonu je to druhá cesta k navigaci, ne nová: pořadí je shodné
// s panelem, takže švihnutí doleva jde o jedno místo dál.
//
// Pod prstem jede **skutečná sousední stránka**, ne zástupný list. Obě
// sousední stránky se vykreslí dopředu, jakmile je prohlížeč volný, a leží
// neviditelné mimo obraz; data si přitom natáhnou do sdílené mezipaměti, takže
// stránka po přechodu naskočí rovnou s nimi. Při tahu jedou obě stránky vedle
// sebe jako list papíru a po dojezdu se pod náhledem vymění za skutečnou —
// je to táž komponenta se stejnými daty, takže výměnu nejde vidět. Náhled
// i nově otevřená stránka mají vypnuté nájezdové animace: člověk ji už
// viděl hotovou a nemá ji vidět znovu naskakovat.
//
// Gesto se nikdy nepere s obsahem: tah, který začal nad prvkem ovládajícím
// vodorovný pohyb, patří jemu (viz `zabranoJinym`).

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { match, NahledLokace, navigate, useLocation, type Loc } from "../lib/router";
import { toast } from "../lib/toast";
import { Stranka } from "../pages/Stranka";
import { modulBarvy } from "./ModuleIcon";
import { NAV, type NavItem } from "./nav";

/** Než se pozná, že jde o vodorovný tah a ne o rolování. */
const PRAH = 14;
/** Vodorovný pohyb musí o kus převážit svislý; prst nikdy nejde rovně. */
const POMER = 1.25;
/** Podíl šířky okna, po kterém se stránka přepne i bez švihnutí. */
const DOJEZD = 0.32;
/** px/ms — rychlé švihnutí přepne stránku, i když dojezd nestačil. */
const SVIH = 0.45;

const TIP = "kam.gesto-tip";

function telefon(): boolean {
  return window.matchMedia("(max-width: 719px)").matches && window.matchMedia("(pointer: coarse)").matches;
}

/** Patří vodorovný tah někomu jinému?
 *
 *  Pravidlo je schválně obecné, ne seznam tříd: prvek, který má `touch-action`
 *  bez vodorovné složky, si o vodorovný pohyb řekl sám (mapa,
 *  posuvník), a prvek, který se dá posunout do strany, si ho zaslouží
 *  (tabulka, ukázka kódu, pruh záložek). Nové komponenty se tím řídí samy;
 *  `data-gesto="ne"` je pro případy, o kterých CSS neví.
 */
function zabranoJinym(cil: EventTarget | null): boolean {
  let el = cil instanceof Element ? cil : null;
  while (el && el !== document.body) {
    if (el.getAttribute("data-gesto") === "ne") return true;
    // Okna a šuplíky mají svoje gesta a leží mimo stránku.
    if (el.matches(".modal-layer, .palette-layer, .assistant-drawer, .ctx-menu, [role=dialog], input[type=range]")) return true;
    const s = getComputedStyle(el);
    const ta = s.touchAction;
    if (ta === "none" || ta.startsWith("pan-y")) return true;
    if (el.scrollWidth - el.clientWidth > 4 && /auto|scroll/.test(s.overflowX)) return true;
    el = el.parentElement;
  }
  return false;
}

interface Tah {
  stav: "ne" | "zvazuje" | "tahne";
  /** Pořadí tahu. Dojezd i návrat uklízejí až po doběhnutí animace; kdyby
   *  mezitím začal další tah, uklidili by po něm a stránka by zůstala
   *  posunutá v půli cesty. */
  verze: number;
  prst: number;
  x0: number; y0: number;
  dx: number; v: number; px: number; pt: number;
  smer: -1 | 0 | 1;
  cil?: NavItem;
  sirka: number;
  blizko: boolean;
}

/** Adresa, pod kterou náhled žije: cesta cíle a prázdný dotaz, přesně jako
 *  po skutečném přechodu (navigace z panelu dotaz nepřenáší). */
function lokace(path: string): Loc {
  return { path, query: new URLSearchParams(), hash: "", key: -1 };
}

function Nahled({ n, strana, el }: { n: NavItem; strana: "vlevo" | "vpravo"; el: (e: HTMLDivElement | null) => void }) {
  const b = modulBarvy(n.module);
  return (
    <div ref={el} className="gesto-soused" data-strana={strana} aria-hidden="true" inert
      style={{ "--m-a": b.a, "--m-b": b.b } as CSSProperties}>
      <NahledLokace value={lokace(n.path)}>
        <div className="page" data-page={match(n.path).name}>
          <Stranka m={match(n.path)} />
        </div>
      </NahledLokace>
    </div>
  );
}

export function Gesta() {
  const { path } = useLocation();
  const idx = NAV.findIndex((n) => n.path === path);
  const [sousede, setSousede] = useState<{ vlevo?: NavItem; vpravo?: NavItem }>({});
  const vlevoEl = useRef<HTMLDivElement | null>(null);
  const vpravoEl = useRef<HTMLDivElement | null>(null);
  const tah = useRef<Tah>({ stav: "ne", verze: 0, prst: -1, x0: 0, y0: 0, dx: 0, v: 0, px: 0, pt: 0, smer: 0, sirka: 0, blizko: false });

  // Sousedé se vykreslí dopředu, až bude prohlížeč volný — ne hned, aby
  // nebrzdili nájezd stránky, na kterou člověk právě přišel.
  useEffect(() => {
    setSousede({});
    if (idx < 0 || !telefon() || document.documentElement.dataset.motion === "reduce") return;
    const pust = () => setSousede({ vlevo: NAV[idx - 1], vpravo: NAV[idx + 1] });
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(pust, { timeout: 1600 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(pust, 700);
    return () => window.clearTimeout(id);
  }, [idx]);

  useEffect(() => {
    if (idx < 0) return;   // úvod, profil, právní — tam se nepřejíždí
    const t = tah.current;

    const hlavni = () => document.getElementById("main");
    const tichy = () => document.documentElement.dataset.motion === "reduce";
    const soused = () => (t.smer === 1 ? vpravoEl.current : t.smer === -1 ? vlevoEl.current : null);

    const kresli = () => {
      const m = hlavni();
      if (m) m.style.transform = `translate3d(${t.dx.toFixed(1)}px,0,0)`;
      const s = soused();
      if (s && t.cil) {
        s.classList.add("je-videt");
        s.style.transform = `translate3d(${(t.smer * t.sirka + t.dx).toFixed(1)}px,0,0)`;
      }
      const blizko = Math.abs(t.dx) >= t.sirka * DOJEZD;
      if (blizko !== t.blizko) {
        t.blizko = blizko;
        // Krátké cuknutí v okamžiku, kdy už tah stačí. Prst zakrývá kus
        // obrazovky, takže hmat to řekne dřív než oko.
        if (blizko && t.cil) { try { navigator.vibrate?.(8); } catch { /* nevadí */ } }
      }
    };

    /** Dojede tam, kde tah skončil — ne od nuly, aby nic neposkočilo. */
    const posun = (el: HTMLElement, na: number, ms: number) => {
      const a = el.animate(
        [{ transform: el.style.transform || "translate3d(0,0,0)" }, { transform: `translate3d(${na.toFixed(1)}px,0,0)` }],
        { duration: ms, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" },
      );
      // Cílová hodnota se zapíše rovnou, takže zrušení doběhlé animace
      // nedopadne na jiný stav, než ve kterém skončila.
      el.style.transform = `translate3d(${na.toFixed(1)}px,0,0)`;
      a.finished.then(() => a.cancel()).catch(() => { /* přebito dalším tahem */ });
      return a;
    };

    const schovej = (el: HTMLElement | null) => {
      if (!el) return;
      el.classList.remove("je-videt");
      el.style.transform = "";
    };

    const uklid = () => {
      const m = hlavni();
      if (m) m.style.transform = "";
      schovej(vlevoEl.current); schovej(vpravoEl.current);
      delete document.documentElement.dataset.gesto;
      t.stav = "ne"; t.prst = -1; t.dx = 0; t.v = 0; t.smer = 0; t.cil = undefined; t.blizko = false;
    };

    /** Zbytek cesty podle toho, kolik jí zbývá: krátký doběh nemá trvat
     *  stejně dlouho jako přejetí přes celou obrazovku. */
    const trvani = (zbyva: number) => Math.round(Math.min(320, Math.max(170, (Math.abs(zbyva) / t.sirka) * 360)));

    const vrat = () => {
      const m = hlavni(), s = soused();
      if (tichy() || !m) { uklid(); return; }
      const ms = trvani(t.dx);
      posun(m, 0, ms);
      if (s && t.cil) posun(s, t.smer * t.sirka, ms);
      t.stav = "ne";
      const moje = t.verze;
      window.setTimeout(() => { if (t.verze === moje) uklid(); }, ms + 20);
    };

    const dojed = (kam: string) => {
      const m = hlavni(), s = soused();
      if (tichy() || !m || !s) { navigate(kam, { gesto: true }); uklid(); return; }
      t.stav = "ne";
      const ms = trvani(t.sirka - Math.abs(t.dx));
      posun(m, -t.smer * t.sirka, ms);
      const a = posun(s, 0, ms);
      // Skutečná stránka se vykreslí pod náhledem, který ji zatím kryje;
      // náhled pak jen zmizí. Dva snímky, aby už byla namalovaná.
      // Časovač je pojistka: na skryté záložce (nebo když prohlížeč animaci
      // zahodí) `finished` nemusí doběhnout nikdy a stránka by zůstala stát
      // odsunutá napůl mimo obraz.
      let hotovo = false;
      const dokonci = () => {
        if (hotovo) return;
        hotovo = true;
        navigate(kam, { gesto: true });
        requestAnimationFrame(() => requestAnimationFrame(() => {
          delete document.documentElement.dataset.gesto;
          schovej(s);
        }));
      };
      a.finished.catch(() => null).then(dokonci);
      window.setTimeout(dokonci, ms + 120);
    };

    const start = (e: TouchEvent) => {
      if (t.stav !== "ne" || !window.matchMedia("(max-width: 719px)").matches || e.touches.length !== 1) return;
      if (document.documentElement.dataset.kb === "open") return;
      if (zabranoJinym(e.target)) return;
      const d = e.touches[0];
      t.stav = "zvazuje"; t.verze += 1; t.prst = d.identifier;
      t.x0 = d.clientX; t.y0 = d.clientY;
      t.dx = 0; t.v = 0; t.px = 0; t.pt = performance.now(); t.blizko = false;
    };

    const pohyb = (e: TouchEvent) => {
      if (t.stav === "ne") return;
      if (e.touches.length > 1) { vrat(); return; }   // z tahu se stalo štípnutí
      const d = e.touches[0];
      if (d.identifier !== t.prst) return;
      const dx = d.clientX - t.x0, dy = d.clientY - t.y0;

      if (t.stav === "zvazuje") {
        if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { t.stav = "ne"; return; }   // rolování
        if (Math.abs(dx) < PRAH || Math.abs(dx) < Math.abs(dy) * POMER) return;
        t.smer = dx < 0 ? 1 : -1;
        t.cil = NAV[idx + t.smer];
        t.sirka = window.innerWidth;
        t.stav = "tahne";
        // Posunutá stránka by jinak přetekla ven a dalo by se za ni odjet.
        document.documentElement.dataset.gesto = "tah";
        // Tah přišel dřív, než byl prohlížeč volný: soused se vykreslí teď.
        if (t.cil && !soused()) setSousede({ vlevo: NAV[idx - 1], vpravo: NAV[idx + 1] });
      }
      if (t.stav !== "tahne") return;
      if (e.cancelable) e.preventDefault();
      const nyni = performance.now();
      // Odpor na kraji řady: tah jde, ale je poznat, že dál už nic není.
      t.dx = t.cil ? dx : Math.sign(dx) * Math.min(64, Math.abs(dx) * 0.28);
      const usek = nyni - t.pt;
      if (usek > 0) t.v = t.v * 0.6 + ((t.dx - t.px) / usek) * 0.4;
      t.px = t.dx; t.pt = nyni;
      kresli();
    };

    const konec = () => {
      if (t.stav !== "tahne") { t.stav = "ne"; return; }
      const dost = Math.abs(t.dx) > t.sirka * DOJEZD || t.v * t.smer < -SVIH;
      if (t.cil && dost) dojed(t.cil.path);
      else vrat();
    };

    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", pohyb, { passive: false });
    document.addEventListener("touchend", konec);
    document.addEventListener("touchcancel", konec);
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", pohyb);
      document.removeEventListener("touchend", konec);
      document.removeEventListener("touchcancel", konec);
      uklid();
    };
  }, [idx]);

  // Gesto, o kterém nikdo neví, nikdo nepoužije. Jednou, a pak už nikdy —
  // proto to není nápověda ve stránce, ale jedna hláška.
  useEffect(() => {
    if (!telefon()) return;
    try {
      if (localStorage.getItem(TIP)) return;
    } catch { return; }
    const id = window.setTimeout(() => {
      try { localStorage.setItem(TIP, "1"); } catch { /* soukromé okno */ }
      toast("info", "Tip: přejetím prstem po stránce přejdete na sousední místo v navigaci.", undefined, 6500);
    }, 3200);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <>
      {sousede.vlevo && <Nahled key={sousede.vlevo.path} n={sousede.vlevo} strana="vlevo" el={(e) => { vlevoEl.current = e; }} />}
      {sousede.vpravo && <Nahled key={sousede.vpravo.path} n={sousede.vpravo} strana="vpravo" el={(e) => { vpravoEl.current = e; }} />}
    </>
  );
}
