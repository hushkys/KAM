// Přejetí prstem mezi stránkami.
//
// Na telefonu je dole dock a nad ním celá stránka. Přejetí je druhá cesta
// k témuž místu, ne nová navigace: pořadí je shodné s dockem, takže „vedle"
// znamená to, co je v docku vedle, a švihnutí doleva jde o jedno místo dál.
//
// Kreslí se pořád jen jedna stránka. Přicházející místo zastupuje list, který
// se pod prstem vysouvá od kraje — nese ikonu a název cíle, takže je celou
// dobu vidět, kam se jede, a v okamžiku přepnutí zakrývá obrazovku, takže se
// samotná výměna obsahu vůbec neukáže. Mít obě stránky živé naráz by
// znamenalo natáhnout data dvakrát a u mapy a 3D terénu i dvakrát vykreslovat.
//
// Gesto se nikdy nepere s obsahem: tah, který začal nad prvkem ovládajícím
// vodorovný pohyb, patří jemu (viz `zabranoJinym`).

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { navigate, useLocation } from "../lib/router";
import { toast } from "../lib/toast";
import { ModuleIcon, modulBarvy } from "./ModuleIcon";
import { NAV, type NavItem } from "./nav";

/** Než se pozná, že jde o vodorovný tah a ne o rolování. Míň by gesto
 *  spouštělo při každém šmrdlnutí, víc by ho dělalo těžkopádným. */
const PRAH = 14;
/** Vodorovný pohyb musí o kus převážit svislý; prst nikdy nejde rovně. */
const POMER = 1.25;
/** Podíl šířky okna, po kterém se stránka přepne i bez švihnutí. */
const DOJEZD = 0.3;
/** px/ms — rychlé švihnutí přepne stránku, i když dojezd nestačil. */
const SVIH = 0.45;
/** Odcházející stránka se hýbe pomaleji než prst. Bez toho je scéna plochá;
 *  s tím to vypadá, že list přijíždí nad ní. */
const VLEKA = 0.34;

const TIP = "kam.gesto-tip";

function soused(path: string, smer: number): NavItem | undefined {
  const i = NAV.findIndex((n) => n.path === path);
  return i < 0 ? undefined : NAV[i + smer];
}

/** Patří vodorovný tah někomu jinému?
 *
 *  Pravidlo je schválně obecné, ne seznam tříd: prvek, který má `touch-action`
 *  bez vodorovné složky, si o vodorovný pohyb řekl sám (mapa, 3D terén,
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

export function Gesta() {
  const { path } = useLocation();
  const [list, setList] = useState<{ n: NavItem; smer: -1 | 1 } | null>(null);
  const listEl = useRef<HTMLDivElement>(null);
  const tah = useRef<Tah>({ stav: "ne", verze: 0, prst: -1, x0: 0, y0: 0, dx: 0, v: 0, px: 0, pt: 0, smer: 0, sirka: 0, blizko: false });

  useEffect(() => {
    if (NAV.findIndex((n) => n.path === path) < 0) return;   // hook, profil, právní — tam se nepřejíždí
    const uzke = window.matchMedia("(max-width: 720px)");
    const t = tah.current;

    const hlavni = () => document.getElementById("main");
    const tichy = () => document.documentElement.dataset.motion === "reduce";

    const kresli = () => {
      const m = hlavni();
      if (m) m.style.transform = `translate3d(${(t.dx * VLEKA).toFixed(1)}px,0,0)`;
      const l = listEl.current;
      if (!l || tichy()) return;
      l.style.transform = `translate3d(${(t.smer * t.sirka + t.dx).toFixed(1)}px,0,0)`;
      const p = Math.min(1, Math.abs(t.dx) / (t.sirka * DOJEZD));
      l.style.setProperty("--p", p.toFixed(3));
      const blizko = p >= 1;
      if (blizko !== t.blizko) {
        t.blizko = blizko;
        l.dataset.blizko = blizko ? "ano" : "ne";
        // Krátké cuknutí v okamžiku, kdy už tah stačí. Prst zakrývá kus
        // obrazovky, takže hmat to řekne dřív než oko. Prohlížeč to smí
        // odmítnout (a některé to udělají hlučně), na gestu to nic nemění.
        if (blizko) { try { navigator.vibrate?.(8); } catch { /* nevadí */ } }
      }
    };

    /** Dojede tam, kde tah skončil — ne od nuly, aby nic neposkočilo. */
    const posun = (el: HTMLElement, na: number, ms: number, easing: string) => {
      const a = el.animate(
        [{ transform: el.style.transform || "translate3d(0,0,0)" }, { transform: `translate3d(${na.toFixed(1)}px,0,0)` }],
        { duration: ms, easing, fill: "forwards" },
      );
      // Cílová hodnota se zapíše rovnou, takže zrušení doběhlé animace
      // nedopadne na jiný stav, než ve kterém skončila.
      el.style.transform = `translate3d(${na.toFixed(1)}px,0,0)`;
      a.finished.then(() => a.cancel()).catch(() => { /* přebito dalším tahem */ });
      return a;
    };

    const uklid = () => {
      const m = hlavni();
      if (m) m.style.transform = "";
      const l = listEl.current;
      if (l) { l.style.transform = ""; l.style.opacity = ""; l.dataset.blizko = "ne"; }
      delete document.documentElement.dataset.gesto;
      t.stav = "ne"; t.prst = -1; t.dx = 0; t.v = 0; t.smer = 0; t.cil = undefined; t.blizko = false;
      setList(null);
    };

    const vrat = () => {
      const m = hlavni(), l = listEl.current;
      if (tichy() || !m) { uklid(); return; }
      posun(m, 0, 280, "cubic-bezier(.22,1,.36,1)");
      if (l) posun(l, t.smer * t.sirka, 280, "cubic-bezier(.22,1,.36,1)");
      t.stav = "ne";
      const moje = t.verze;
      window.setTimeout(() => { if (t.verze === moje) uklid(); }, 290);
    };

    const dojed = (kam: string) => {
      const m = hlavni(), l = listEl.current;
      if (tichy() || !m || !l) { navigate(kam); uklid(); return; }
      // List dojede přes celou obrazovku, stránka pod ním odplouvá dál. Ve
      // chvíli přepnutí je vidět jen list, takže výměna obsahu zmizí v něm.
      t.stav = "ne";
      const moje = t.verze;
      posun(m, -t.smer * t.sirka * VLEKA * 2, 230, "cubic-bezier(.32,.72,0,1)");
      const a = posun(l, 0, 230, "cubic-bezier(.32,.72,0,1)");
      a.finished.catch(() => null).then(() => {
        navigate(kam);
        const odkryj = l.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "ease-out", fill: "forwards" });
        odkryj.finished.catch(() => null).then(() => {
          odkryj.cancel();
          if (t.verze === moje) uklid();
          else l.style.opacity = "";   // mezitím začal další tah, uklidí si sám
        });
      });
    };

    const start = (e: TouchEvent) => {
      if (t.stav !== "ne" || !uzke.matches || e.touches.length !== 1) return;
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
        t.cil = soused(path, t.smer);
        t.sirka = window.innerWidth;
        t.stav = "tahne";
        // Posunutá stránka by jinak přetekla ven a dalo by se za ni odjet.
        document.documentElement.dataset.gesto = "tah";
        if (t.cil && !tichy()) setList({ n: t.cil, smer: t.smer });
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
  }, [path]);

  // Gesto, o kterém nikdo neví, nikdo nepoužije. Jednou, a pak už nikdy —
  // proto to není nápověda ve stránce, ale jedna hláška.
  useEffect(() => {
    if (!window.matchMedia("(max-width: 720px)").matches || !window.matchMedia("(pointer: coarse)").matches) return;
    try {
      if (localStorage.getItem(TIP)) return;
    } catch { return; }
    const id = window.setTimeout(() => {
      try { localStorage.setItem(TIP, "1"); } catch { /* soukromé okno */ }
      toast("info", "Tip: přejetím prstem po stránce přejdete na sousední místo v navigaci.", undefined, 6500);
    }, 3200);
    return () => window.clearTimeout(id);
  }, []);

  if (!list) return null;
  const b = modulBarvy(list.n.module);
  return (
    <div ref={listEl} className="gesto-list" data-blizko="ne" aria-hidden="true"
      style={{ "--h1": b.a, "--h2": b.b, "--h3": b.c, transform: `translate3d(${list.smer * window.innerWidth}px,0,0)` } as CSSProperties}>
      <span className="gl-zare" aria-hidden="true" />
      <span className="gl-ikona"><ModuleIcon name={list.n.module} size={68} /></span>
      <span className="gl-nazev">{list.n.label}</span>
      <span className="gl-popis">{list.n.desc}</span>
    </div>
  );
}
