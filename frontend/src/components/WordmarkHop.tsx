// Maskot doskáče po písmenech KAM. a stane se z něj tečka — a pak tam žije.
//
// Tečka v logu není ozdoba, je to konec věty. Maskot proto nekončí „vedle
// loga", ale *v něm*: přiběhne zleva, skočí na K, na A, na M a posledním
// skokem dosedne přesně tam, kde tečka patří. Písmeno pod ním se při dopadu
// stlačí k patce a pružinou se vrátí; maskot se stlačí taky a při odrazu se
// protáhne, jinak to vypadá jako posouvaný kotouč.
//
// Skok je čistě CSS — je pokaždé stejný, takže nemá cenu ho řídit z JavaScriptu.
// To, co přijde po něm, stejné není: maskot se rozhlíží, mrká a jednou za čas
// mu vyjedou nohy, popojde, udělá salto s koleny u brady a vrátí se na místo.
// Tohle je malý stavový automat v Reactu, protože fáze mají různé délky a
// navazují na sebe — jedny klíčové snímky přes celé čtyři vteřiny by se
// nedaly přečíst ani změnit.
//
// Vodorovný a svislý pohyb jsou dvě vnořené skupiny se dvěma křivkami. Jedna
// společná by ze skoku udělala klouzavý oblouk: vodorovně se letí rovnoměrně,
// svisle se zrychluje dolů a zpomaluje nahoru.

import { useEffect, useRef, useState, type CSSProperties } from "react";

/** Písmena wordmarku zvlášť, aby se každé dalo deformovat samo. Stejná
 *  geometrie jako v Logo.tsx — když se změní tam, musí se změnit i tady. */
const K = "M0 0h24v41L58 0h30L46 47l44 53H59L32 66l-8 8.6V100H0z";
const A = "M97 100L133 0h27l36 100h-25l-7.2-21h-37L119.6 100zM133.6 58h23l-11.5-34.5z";
const M = "M205 100V0h29l23.5 57L281 0h29v100h-23V43l-19.8 47h-15.4L228 43v57z";

/** Jak dlouho trvá skok. Musí sedět s `hop-x`/`hop-y` v components.css —
 *  místo tečky (331, 83), na které se maskot zaparkuje, je tam taky. */
const SKOK_MS = 2400;

/** Fáze kousku. Prázdno znamená „stojí doma a rozhlíží se". */
type Faze = "" | "vysun" | "chuze" | "salto" | "navrat" | "zasun";
const KOUSEK: [Faze, number][] = [["vysun", 340], ["chuze", 900], ["salto", 1050], ["navrat", 900], ["zasun", 340]];
/** Jak daleko od tečky si maskot odskočí, než se odrazí do salta. */
const ODSTUP = 30;

function tiseji(): boolean {
  return document.documentElement.dataset.motion === "reduce"
    || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function WordmarkHop({ onDone }: { onDone?: () => void }) {
  // "skace" → "doma": doma už maskot drží statickou pozici a hraje si.
  const [stav, setStav] = useState<"skace" | "doma" | "tise">("skace");
  const [faze, setFaze] = useState<Faze>("");
  const [mrka, setMrka] = useState(false);
  const [pohled, setPohled] = useState(0);
  // Běžící časovače, aby se daly při odchodu ze stránky zrušit. Set, ne pole:
  // maskot si plánuje další mrknutí pořád dokola a pole by jen rostlo.
  const casovace = useRef<Set<number>>(new Set());

  const po = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => { casovace.current.delete(id); fn(); }, ms);
    casovace.current.add(id);
  };

  // Skok. Pokaždé znovu — po každém načtení i po každém návratu na úvodní
  // stránku; maskot je to první, co na stránce je, a nemá smysl ho schovávat.
  useEffect(() => {
    if (tiseji()) {
      setStav("tise");
      onDone?.();
      return;
    }
    const t = window.setTimeout(() => { setStav("doma"); onDone?.(); }, SKOK_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  // Mrkání a rozhlížení. Nepravidelné schválně: pravidelné mrkání vypadá jako
  // blikající kontrolka, ne jako oči.
  useEffect(() => {
    if (stav !== "doma") return;
    let zivy = true;
    const mrkni = () => {
      if (!zivy) return;
      setMrka(true);
      po(130, () => setMrka(false));
      // Občas dvojité mrknutí — to je ten rozdíl mezi „animací" a „tvorem".
      if (Math.random() < 0.3) {
        po(300, () => setMrka(true));
        po(420, () => setMrka(false));
      }
      po(1800 + Math.random() * 4200, mrkni);
    };
    const rozhlizej = () => {
      if (!zivy) return;
      setPohled(Math.random() < 0.34 ? 0 : Math.random() < 0.5 ? -1 : 1);
      po(1400 + Math.random() * 2600, rozhlizej);
    };
    po(900 + Math.random() * 1200, mrkni);
    po(1600 + Math.random() * 1500, rozhlizej);
    return () => { zivy = false; };
  }, [stav]);

  // Kousek: vyjedou nohy, popojde, salto, zpátky. Fáze jdou po sobě, protože
  // každá má svou délku a svou křivku.
  useEffect(() => {
    if (stav !== "doma") return;
    let zivy = true;
    const kousek = () => {
      if (!zivy) return;
      let t = 0;
      for (const [f, ms] of KOUSEK) {
        po(t, () => zivy && setFaze(f));
        t += ms;
      }
      // Pauza mezi kousky, ne rovnou další: maskot má většinu času jen stát a
      // mrkat, jinak z toho je neposedná ikona, která tahá oči od textu.
      po(t, () => { if (zivy) { setFaze(""); po(9000 + Math.random() * 11000, kousek); } });
    };
    po(4500 + Math.random() * 5000, kousek);
    return () => { zivy = false; setFaze(""); };
  }, [stav]);

  useEffect(() => {
    const bezi = casovace.current;
    return () => { bezi.forEach(clearTimeout); bezi.clear(); };
  }, []);

  const doma = stav !== "skace";
  const posun = faze === "chuze" || faze === "salto" ? ODSTUP : 0;
  const tridy = ["wordmark", "hop",
    stav === "skace" ? "is-skace" : "is-doma",
    faze ? `trik-${faze}` : "",
    mrka ? "is-mrka" : "",
  ].filter(Boolean).join(" ");

  return (
    <svg viewBox="-70 -46 430 152" role="img" aria-label="KAM." className={tridy}
      style={{ ["--pohled" as string]: pohled, ["--posun" as string]: posun } as CSSProperties}>
      <path className="ltr ltr-k" d={K} fill="currentColor" fillRule="evenodd" />
      <path className="ltr ltr-a" d={A} fill="currentColor" fillRule="evenodd" />
      <path className="ltr ltr-m" d={M} fill="currentColor" fillRule="evenodd" />

      {/* Když se nic nehraje (vypnuté animace), je tečka prostě tečka. */}
      {stav === "tise" && <circle cx="331" cy="86" r="14" fill="var(--lime)" />}

      {stav !== "tise" && (
        // Parkovací vrstva: během skoku nic nedělá a všechny souřadnice nese
        // hop-x/hop-y, po doskoku naopak drží místo tečky a hop-x/hop-y jsou
        // vynulované, takže kousek se počítá relativně k domovu.
        <g className={doma ? "hop-park is-doma" : "hop-park"}>
          <g className="hop-x">
            <g className="hop-y">
              <g className="hop-spin">
                <g className="hop-squish">
                  <g className="ms">
                    {/* Nohy jsou schované v těle a vyjedou jen na kousek. */}
                    <path className="ms-noha ms-noha-l" d="M-5.4 12v11" />
                    <path className="ms-noha ms-noha-p" d="M5.4 12v11" />
                    {/* Ruce drží kolena při saltu. Jindy nejsou vidět. */}
                    <path className="ms-ruka ms-ruka-l" d="M-13 3c-3 6 1 11 6 12" />
                    <path className="ms-ruka ms-ruka-p" d="M13 3c3 6-1 11-6 12" />

                    <circle className="ms-telo" r="17" fill="var(--lime)" />
                    <g className="ms-oci">
                      <ellipse className="ms-oko" cx="-5.8" cy="-2.6" rx="2.8" ry="3.3" fill="#0a120c" />
                      <ellipse className="ms-oko" cx="5.8" cy="-2.6" rx="2.8" ry="3.3" fill="#0a120c" />
                      <g className="ms-lesk">
                        <circle cx="-4.9" cy="-3.6" r="1.1" fill="var(--lime)" />
                        <circle cx="6.7" cy="-3.6" r="1.1" fill="var(--lime)" />
                      </g>
                    </g>
                    <path className="ms-pusa" d="M-4.2 4c1.3 2.4 7.1 2.4 8.4 0" fill="none"
                      stroke="#0a120c" strokeWidth="1.7" strokeLinecap="round" />
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      )}
    </svg>
  );
}
