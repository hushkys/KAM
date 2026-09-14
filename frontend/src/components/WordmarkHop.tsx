// Maskot doskáče po písmenech KAM., sleze po hraně M a stane se z něj tečka.
//
// Tečka v logu není ozdoba, je to konec věty. Maskot proto nekončí „vedle
// loga", ale *v něm*. Než skočí, podívá se, kam míří, mrkne a přikrčí se —
// bez toho rozmyšlení je z toho odbíhající kolečko, ne postava. Na posledním
// písmenu nedoskočí dolů, ale chytí se hrany a sleze po ní ručkama a nohama.
//
// Kreslí se vlastní smyčkou (`mascot-engine.ts`), ne klíčovými snímky. Důvod
// je v komentáři tam: `scale()` umí z kruhu udělat jen elipsu, kdežto dopad
// potřebuje zploštit spodek, vyboulit boky a nechat vršek přepadnout dopředu.
// Každý ze čtyř okrajů těla proto jede zvlášť.
//
// Maskot nikdy nepřeleze písmeno: svislá poloha se počítá od **bodu dotyku**
// (`y = povrch − spodní poloměr`), takže ať se zdeformuje jakkoli, stojí na
// hraně, ne v ní.

import { useEffect, useRef, useState } from "react";
import {
  clamp, DOMA, easeIn, easeInOut, easeOut, HRANA_X, LEZENI_X, lerp, PISMENA, POVRCH, prichod, Pruzina, R, telo,
  type Poloha, type Usek,
} from "./mascot-engine";

const K = "M0 0h24v41L58 0h30L46 47l44 53H59L32 66l-8 8.6V100H0z";
const A = "M97 100L133 0h27l36 100h-25l-7.2-21h-37L119.6 100zM133.6 58h23l-11.5-34.5z";
const M = "M205 100V0h29l23.5 57L281 0h29v100h-23V43l-19.8 47h-15.4L228 43v57z";

type Klid = "nic" | "vrti" | "drbe" | "sedi" | "salto";

function tiseji(): boolean {
  return document.documentElement.dataset.motion === "reduce"
    || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function WordmarkHop({ onDone }: { onDone?: () => void }) {
  const [tise] = useState(tiseji);
  const svg = useRef<SVGSVGElement>(null);
  const telo_ = useRef<SVGPathElement>(null);
  const nohaL = useRef<SVGPathElement>(null);
  const nohaP = useRef<SVGPathElement>(null);
  const rukaL = useRef<SVGPathElement>(null);
  const rukaP = useRef<SVGPathElement>(null);
  const oblicej = useRef<SVGGElement>(null);
  const okoL = useRef<SVGEllipseElement>(null);
  const okoP = useRef<SVGEllipseElement>(null);
  const leskL = useRef<SVGCircleElement>(null);
  const leskP = useRef<SVGCircleElement>(null);
  const pusa = useRef<SVGPathElement>(null);
  const stin = useRef<SVGEllipseElement>(null);
  const skupina = useRef<SVGGElement>(null);
  const pismena = useRef<(SVGPathElement | null)[]>([]);
  const hotovo = useRef(false);

  useEffect(() => {
    if (tise) { onDone?.(); return; }
    const g = skupina.current, body = telo_.current;
    if (!g || !body) return;

    // ---- stav -------------------------------------------------------------
    const scenar: Usek[] = prichod();
    let usek = 0;
    let tUsek = 0;
    let doma = false;

    // Pružiny: tvar těla po dopadu, náklon a naklonění hlavy. Vysoká tuhost
    // a nízké tlumení = krátký, viditelný dokmit. Tohle dělá tu „váhu".
    const sq = new Pruzina(1, 1, 420, 13);     // svislé stlačení (1 = klid)
    const nakl = new Pruzina(0, 0, 260, 16);   // zkosení
    const hlava = new Pruzina(0, 0, 200, 14);  // vrtění hlavou
    // Druhá, pomalejší pružina rozhoupe šířku mimo fázi se stlačením —
    // bez ní dopad doklepe jedním směrem a vypadá to mechanicky.
    const wob = new Pruzina(0, 0, 150, 9);
    // Každé písmeno má svou pružinu — dopad je lokální událost.
    const ltr = [new Pruzina(1, 1, 480, 17), new Pruzina(1, 1, 480, 17), new Pruzina(1, 1, 480, 17)];

    let x = -66, y = POVRCH - R;
    let xPred = x;
    let vx = 0, vy = 0;
    let naklExtra = 0;   // náklon navíc k tomu, co plyne z rychlosti
    let povrch: number | null = POVRCH;   // plocha pod nohama (null = ve vzduchu)
    let plochaStinu = POVRCH;             // kam se promítá stín, i když je ve vzduchu
    let rot = 0;
    let nohy = 0;        // 0 schované, 1 venku
    let krok = 0;        // fáze chůze
    let ruce = 0;        // 0 schované, 1 venku
    let rezimRukou: "nic" | "lez" | "obejmi" | "drbe" = "nic";
    let sed = 0;         // turecký sed
    let mrk = 0;         // 0 otevřené, 1 zavřené
    let pohled = 0, pohledY = 0;
    let usmev = 0.5;     // 0 soustředěný, 1 široký

    let mrkDo = 0.9 + Math.random() * 1.4;
    let pohledDo = 2.2;
    let klid: Klid = "nic";
    let klidT = 0, klidDelka = 0, klidDo = 4 + Math.random() * 4;

    const dopad = (sila: number, i?: number) => {
      sq.kopni(clamp(1 - sila, 0.42, 0.95), -2.6 * sila);
      wob.kopni(sila * 0.9, -1.4 * sila);
      if (i !== undefined) ltr[i].kopni(clamp(1 - sila * 0.42, 0.78, 0.99), -1.9 * sila);
    };

    // ---- choreografie -----------------------------------------------------
    function scena(dt: number) {
      const u = scenar[usek];
      if (!u) return;
      tUsek += dt;
      const p = u.t > 0 ? clamp(tUsek / u.t, 0, 1) : 1;

      switch (u.druh) {
        case "beh": {
          // Přiběhne zleva, nohy pod ním kmitají a tělo se lehce houpe.
          nohy = clamp(p * 3, 0, 1); ruce = 0;
          krok += dt * 15;
          x = lerp(u.z, u.na, easeOut(p));
          povrch = POVRCH;
          pohled = 1; usmev = 0.7;
          if (p >= 1) { dopad(0.34, 0); dalsi(); }
          break;
        }
        case "stoji": {
          // Rozmýšlí se: dívá se na další písmeno, mrkne, usměje se.
          nohy = Math.max(0, nohy - dt * 4); ruce = 0;
          pohled = u.kam; pohledY = -0.25;
          if (u.mrk !== undefined && tUsek > u.t * 0.45 && tUsek < u.t * 0.45 + 0.13) mrk = 1;
          usmev = 0.85;
          if (p >= 1) dalsi();
          break;
        }
        case "napreh": {
          // Krátký podřep. Bez něj skok nemá odkud vyjít.
          nohy = clamp(p * 2, 0, 1);
          sq.cil = 1; sq.hodnota = lerp(1, 0.72, easeInOut(p)); sq.v = 0;
          usmev = 0.25; pohledY = -0.5;
          if (p >= 1) { sq.kopni(1.26, 5.5); dalsi(); }
          break;
        }
        case "skok": {
          // Parabola: vodorovně rovnoměrně, svisle vlastní křivkou. Nohy se
          // v letu schovají, tělo se protáhne podle svislé rychlosti.
          povrch = null;
          const px = lerp(u.zx, u.nax, p);
          const oblouk = 4 * p * (1 - p);
          // Scénář drží plochy, let potřebuje střed: proto ten − R.
          const py = lerp(u.zy, u.nay, easeInOut(p)) - R - u.v * oblouk;
          vx = (px - x) / Math.max(dt, 1e-4);
          vy = (py - y) / Math.max(dt, 1e-4);
          x = px; y = py;
          nohy = Math.max(0, nohy - dt * 5);
          usmev = 0.15; pohled = 1; pohledY = p < 0.5 ? -0.6 : 0.5;
          if (p >= 1) {
            const i = PISMENA.findIndex((l) => Math.abs(l.x - u.nax) < 1);
            povrch = u.nay; vy = 0;
            dopad(0.5, i >= 0 ? i : undefined);
            usmev = 0.9;
            dalsi();
          }
          break;
        }
        case "chuze": {
          // Popojde po horní hraně M k jeho pravému okraji.
          nohy = clamp(nohy + dt * 5, 0, 1); ruce = 0;
          krok += dt * 12;
          x = lerp(u.z, u.na, easeInOut(p));
          povrch = POVRCH;
          pohled = 1; usmev = 0.7;
          if (p >= 1) dalsi();
          break;
        }
        case "chyt": {
          // Překročí hranu a pověsí se za ni: tělo se přesune ven za písmeno,
          // ruce se natáhnou zpátky k hraně. Bez tohohle mezikroku by maskot
          // z chůze rovnou skočil o dvacet jednotek doprava.
          rezimRukou = "lez"; ruce = clamp(p * 2.2, 0, 1);
          povrch = null;
          x = lerp(HRANA_X, LEZENI_X, easeIn(p));
          y = POVRCH - R + p * 5;
          nohy = 1; pohledY = 0.7; pohled = -0.5; usmev = 0.3;
          rot = lerp(0, 6, easeOut(p));
          if (p >= 1) dalsi();
          break;
        }
        case "lezeni": {
          // Ručkuje dolů po hraně. Krok je schodovitý, ne plynulý — proto ta
          // pila přes sinus: ruka, noha, ruka, noha.
          povrch = null;
          x = u.x;
          const stupne = 3.5;
          const s = p * stupne;
          y = lerp(u.zy, u.nay, easeInOut(p)) - R;
          krok = s * Math.PI;
          ruce = 1; nohy = 1; rezimRukou = "lez";
          rot = 6 + Math.sin(s * Math.PI * 2) * 3;
          naklExtra = -2;
          pohledY = 0.7; pohled = -0.3; usmev = 0.2;
          if (p >= 1) dalsi();
          break;
        }
        case "seskok": {
          // Pustí se a spadne na místo tečky.
          povrch = null;
          ruce = Math.max(0, ruce - dt * 6);
          nohy = Math.max(0, nohy - dt * 4);
          x = lerp(u.zx, DOMA.x, easeOut(p));
          y = lerp(u.zy, DOMA.y, easeIn(p)) - R;
          rot = lerp(6, 0, easeOut(p));
          naklExtra = 1.4;
          usmev = 0.5; pohledY = 0.3;
          if (p >= 1) {
            povrch = DOMA.y; dopad(0.52); naklExtra = 0;
            usmev = 1; dalsi();
          }
          break;
        }
        case "doma": {
          doma = true;
          if (!hotovo.current) { hotovo.current = true; onDone?.(); }
          break;
        }
      }
    }

    function dalsi() { usek++; tUsek = 0; }

    // ---- klidové chování --------------------------------------------------
    function klidne(dt: number) {
      x = DOMA.x; povrch = DOMA.y;

      mrkDo -= dt;
      if (mrkDo <= 0) {
        mrk = 1;
        // Občas dvojité mrknutí. Pravidelné mrkání vypadá jako kontrolka.
        mrkDo = Math.random() < 0.28 ? 0.26 : 1.6 + Math.random() * 3.6;
      }
      pohledDo -= dt;
      if (pohledDo <= 0 && klid === "nic") {
        pohled = Math.random() < 0.34 ? 0 : Math.random() < 0.5 ? -1 : 1;
        pohledY = Math.random() < 0.3 ? -0.4 : 0;
        pohledDo = 1.5 + Math.random() * 2.8;
      }

      if (klid === "nic") {
        klidDo -= dt;
        if (klidDo <= 0) {
          const los = Math.random();
          klid = los < 0.3 ? "vrti" : los < 0.55 ? "drbe" : los < 0.82 ? "sedi" : "salto";
          klidDelka = { vrti: 1.3, drbe: 1.8, sedi: 4.2, salto: 1.15 }[klid];
          klidT = 0;
        }
      } else {
        klidT += dt;
        const p = clamp(klidT / klidDelka, 0, 1);
        if (klid === "vrti") {
          // Vrtí hlavou: čtyři kmity, které doznívají.
          hlava.cil = Math.sin(p * Math.PI * 4) * (1 - p) * 2.6;
          pohled = -Math.sin(p * Math.PI * 4) * 0.7;
          usmev = 0.3;
        } else if (klid === "drbe") {
          // Podrbe se: pravá ruka dozadu, tělo se nakloní a zavrtí.
          rezimRukou = "drbe";
          ruce = clamp(Math.min(p, 1 - p) * 6, 0, 1);
          naklExtra = -1.8 + Math.sin(p * Math.PI * 9) * 0.9;
          pohledY = -0.4; pohled = -0.6; usmev = 0.9;
          if (p > 0.35 && p < 0.45) mrk = 1;
        } else if (klid === "sedi") {
          // Turecký sed: nohy se složí křížem, tělo klesne a rozšíří se.
          const vjezd = clamp(p * 5, 0, 1);
          const vyjezd = clamp((1 - p) * 5, 0, 1);
          sed = Math.min(vjezd, vyjezd);
          nohy = sed;
          usmev = 1;
          if (p > 0.3 && p < 0.34) mrk = 1;
        } else if (klid === "salto") {
          // Salto vzad s koleny u brady.
          const sk = clamp((p - 0.1) / 0.8, 0, 1);
          nohy = clamp(p * 6, 0, 1);
          rezimRukou = "obejmi";
          ruce = sk > 0.1 && sk < 0.9 ? 1 : 0;
          rot = -360 * easeInOut(sk);
          y = DOMA.y - R - 46 * 4 * sk * (1 - sk);
          povrch = sk >= 1 || sk <= 0 ? DOMA.y : null;
          sq.cil = 1;
          if (p < 0.1) { sq.hodnota = lerp(1, 0.78, p / 0.1); sq.v = 0; }
          usmev = 0.2;
          if (p >= 1) { rot = 0; dopad(0.46); usmev = 1; }
        }
        if (p >= 1) {
          klid = "nic"; rezimRukou = "nic"; ruce = 0; sed = 0; nohy = 0;
          hlava.cil = 0; naklExtra = 0; pohled = 0; pohledY = 0;
          klidDo = 6 + Math.random() * 9;
        }
      }
    }

    // ---- vykreslení -------------------------------------------------------
    function kresli(dt: number) {
      const s = sq.krok(dt);
      const sk = nakl.krok(dt);
      const hl = hlava.krok(dt);

      // Vodorovná rychlost se bere ze skutečného posunu, ne z jednoho úseku —
      // naklánět a vybočovat má běh, chůze i let stejně.
      const vxTed = dt > 0 ? (x - xPred) / dt : 0;
      xPred = x;
      vx = vx + (vxTed - vx) * Math.min(1, dt * 18);   // vyhlazení
      nakl.cil = clamp(vx * 0.009, -3.4, 3.4) + naklExtra;

      const naZemi = povrch !== null;
      const stlac = clamp(1 - s, -0.5, 0.62);        // + stlačené, − protažené
      // Zploštění jen při skutečném dosednutí a jen tolik, kolik je stlačení.
      const flat = naZemi ? clamp(stlac * 2.2, 0, 0.92) : 0;
      // Objem zůstává: co ubyde na výšce, přibude na šířce. Ne přesně —
      // trocha „ztráty" vypadá živěji než matematicky správná guma.
      const sirka = 1 + stlac * 0.85 + wob.krok(dt) * 0.06;
      // Ve vzduchu je tvar kapka: když stoupá, táhne se nahoru víc než dolů.
      const tah = clamp(-vy * 0.0016, -0.28, 0.28);
      // Na zemi se hmota sesype DOLŮ: spodek se vyboulí, vršek zploští. Tohle
      // je ten rozdíl proti `scale()`, které umí jen souměrnou elipsu.
      const rTop = R * s * (naZemi ? 1 - flat * 0.17 : 1 + tah) ;
      const rBot = R * s * (naZemi ? 1 + flat * 0.21 : 1 - tah * 0.55) * (1 + sed * 0.12);
      // Boky: přední strana se v pohybu vyboulí, zadní se opozdí.
      const smer = clamp(vx * 0.0032, -0.16, 0.16);
      const rL = R * sirka * (1 - smer) * (1 + sed * 0.2);
      const rR = R * sirka * (1 + smer) * (1 + sed * 0.2);

      // Bod dotyku, ne střed: maskot díky tomu nikdy nezaleze do písmene.
      if (naZemi) y = (povrch as number) - rBot + (sed ? rBot * 0.16 : 0);

      // Stín: nejvíc ze všeho prodá, že maskot na písmenu opravdu stojí.
      // Čím výš je, tím menší a slabší — a při dopadu se rozjede do stran
      // spolu s tělem.
      if (naZemi) plochaStinu = povrch as number;
      const vyska = clamp(y + rBot - plochaStinu, 0, 90);
      const st = stin.current;
      if (st) {
        st.setAttribute("cx", x.toFixed(2));
        st.setAttribute("cy", (plochaStinu + 1.2).toFixed(2));
        st.setAttribute("rx", (rL * 0.92 * (1 - vyska / 150)).toFixed(2));
        st.setAttribute("ry", (2.6 * (1 - vyska / 220)).toFixed(2));
        st.style.opacity = String((0.3 * (1 - vyska / 90) ** 1.6).toFixed(3));
      }

      const p: Poloha = { x, y, rot, rTop, rBot, rL, rR, shear: sk * 2.2, flat };
      body!.setAttribute("d", telo(p));
      g!.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(rot + hl * 0.8).toFixed(2)})`);

      // Nohy: v tureckém sedu se zkříží, jinak visí a při chůzi kmitají.
      const hipY = rBot * 0.62;
      if (sed > 0.02) {
        const w = 13 * sed;
        nohaL.current!.setAttribute("d", `M${-5},${hipY} Q${-w},${hipY + 11 * sed} ${w * 0.75},${hipY + 7 * sed}`);
        nohaP.current!.setAttribute("d", `M${5},${hipY} Q${w},${hipY + 12 * sed} ${-w * 0.75},${hipY + 8 * sed}`);
      } else if (rezimRukou === "lez") {
        // Při lezení se nohy zapírají o hranu, ne pod tělo.
        const f = Math.sin(krok + Math.PI) * 3;
        nohaL.current!.setAttribute("d", `M${-4},${hipY - 2} Q${-11},${hipY + 1 + f} ${-14},${hipY + 4 + f}`);
        nohaP.current!.setAttribute("d", `M${-1},${hipY} Q${-9},${hipY + 5 - f} ${-13},${hipY + 8 - f}`);
      } else {
        const d = 11 * nohy;
        const a = Math.sin(krok) * 15 * nohy;
        const b = Math.sin(krok + Math.PI) * 15 * nohy;
        nohaL.current!.setAttribute("d", `M${-5.4},${hipY} Q${-5.4 + a * 0.2},${hipY + d * 0.6} ${-5.4 + a * 0.32},${hipY + d}`);
        nohaP.current!.setAttribute("d", `M${5.4},${hipY} Q${5.4 + b * 0.2},${hipY + d * 0.6} ${5.4 + b * 0.32},${hipY + d}`);
      }
      nohaL.current!.style.opacity = String(clamp(nohy, 0, 1));
      nohaP.current!.style.opacity = String(clamp(nohy, 0, 1));

      // Ruce: lezení nahoru k hraně, objetí kolen při saltu, drbání dozadu.
      const rk = clamp(ruce, 0, 1);
      if (rezimRukou === "lez") {
        // Hrana je vlevo od těla — ruce se tedy natahují doleva nahoru a
        // střídají se, aby to bylo ručkování, ne tažení lanem.
        const f = Math.sin(krok) * 3.5;
        rukaL.current!.setAttribute("d", `M${-3},${-4} Q${-10},${-11 + f} ${-15},${-14 + f}`);
        rukaP.current!.setAttribute("d", `M${-2},${3} Q${-11},${-3 - f} ${-15},${-6 - f}`);
      } else if (rezimRukou === "obejmi") {
        rukaL.current!.setAttribute("d", `M${-12},${1} Q${-9},${9} ${-2},${11}`);
        rukaP.current!.setAttribute("d", `M${12},${1} Q${9},${9} ${2},${11}`);
      } else if (rezimRukou === "drbe") {
        rukaL.current!.setAttribute("d", `M${-12},${2} Q${-14},${7} ${-11},${10}`);
        rukaP.current!.setAttribute("d", `M${10},${0} Q${16},${6} ${9},${11}`);
      }
      rukaL.current!.style.opacity = String(rezimRukou === "nic" ? 0 : rk);
      rukaP.current!.style.opacity = String(rezimRukou === "nic" ? 0 : rk);

      // Obličej: pohled se veze po těle, ale míň než tělo samo — hlava je
      // těžší než kůže.
      const ox = pohled * 1.6 + sk * 0.9 + hl * 1.1;
      const oy = pohledY * 1.1 + (1 - s) * 1.6;
      oblicej.current!.setAttribute("transform", `translate(${ox.toFixed(2)} ${oy.toFixed(2)})`);
      const otevr = 1 - mrk * 0.94;
      okoL.current!.setAttribute("ry", (3.3 * otevr).toFixed(2));
      okoP.current!.setAttribute("ry", (3.3 * otevr).toFixed(2));
      leskL.current!.style.opacity = String(otevr > 0.6 ? 1 : 0);
      leskP.current!.style.opacity = String(otevr > 0.6 ? 1 : 0);
      const u = 1.6 + usmev * 2.6;
      pusa.current!.setAttribute("d", `M${-4.2},${3.4} q${4.2},${u} ${8.4},0`);

      // Písmena se stlačují k patce a pružinou se vracejí.
      for (let i = 0; i < 3; i++) {
        const v = ltr[i].krok(dt);
        const el = pismena.current[i];
        if (el) el.style.transform = `scaleX(${(1 + (1 - v) * 0.55).toFixed(4)}) scaleY(${v.toFixed(4)})`;
      }

      // Mrknutí a vrtění doznívají samy.
      mrk = Math.max(0, mrk - dt * 7.5);
    }

    // ---- smyčka -----------------------------------------------------------
    let zivy = true;
    let posledni = performance.now();
    const tik = (now: number) => {
      if (!zivy) return;
      // Strop kroku: po přepnutí záložky přijde jeden obří snímek a pružiny
      // by vystřelily. Radši scénu o ten čas zpomalit než ji rozhodit.
      const dt = Math.min((now - posledni) / 1000, 0.05);
      posledni = now;
      // Na skryté záložce prohlížeč rAF sám uspí, takže se nic nepočítá a
      // vlastní kontrola na `document.hidden` by scénu jen zastavila i tam,
      // kde je stránka vidět, ale prohlížeč ji za viditelnou nepovažuje.
      if (doma) klidne(dt); else scena(dt);
      kresli(dt);
      requestAnimationFrame(tik);
    };
    requestAnimationFrame(tik);
    return () => { zivy = false; };
  }, [tise, onDone]);

  if (tise) {
    return (
      <svg viewBox="-70 -46 430 152" role="img" aria-label="KAM." className="wordmark hop">
        <path d={K} fill="currentColor" fillRule="evenodd" />
        <path d={A} fill="currentColor" fillRule="evenodd" />
        <path d={M} fill="currentColor" fillRule="evenodd" />
        <circle cx={DOMA.x} cy="86" r="14" fill="var(--lime)" />
      </svg>
    );
  }

  return (
    <svg ref={svg} viewBox="-70 -46 430 152" role="img" aria-label="KAM." className="wordmark hop is-zivy">
      <path ref={(e) => { pismena.current[0] = e; }} className="ltr" d={K} fill="currentColor" fillRule="evenodd" />
      <path ref={(e) => { pismena.current[1] = e; }} className="ltr" d={A} fill="currentColor" fillRule="evenodd" />
      <path ref={(e) => { pismena.current[2] = e; }} className="ltr" d={M} fill="currentColor" fillRule="evenodd" />

      <ellipse ref={stin} className="ms-stin" cx="0" cy="0" rx="0" ry="0" />
      <g ref={skupina} className="ms">
        <path ref={rukaP} className="ms-koncetina" />
        <path ref={nohaL} className="ms-koncetina" />
        <path ref={nohaP} className="ms-koncetina" />
        <path ref={telo_} className="ms-telo" />
        <path ref={rukaL} className="ms-koncetina ms-pred" />
        <g ref={oblicej} className="ms-oblicej">
          <ellipse ref={okoL} cx="-5.8" cy="-2.6" rx="2.8" ry="3.3" fill="#0a120c" />
          <ellipse ref={okoP} cx="5.8" cy="-2.6" rx="2.8" ry="3.3" fill="#0a120c" />
          <circle ref={leskL} cx="-4.9" cy="-3.7" r="1.1" fill="var(--lime)" />
          <circle ref={leskP} cx="6.7" cy="-3.7" r="1.1" fill="var(--lime)" />
          <path ref={pusa} className="ms-pusa" />
        </g>
      </g>
    </svg>
  );
}
