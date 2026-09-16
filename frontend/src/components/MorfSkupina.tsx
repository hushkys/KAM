// Skupina tlačítek, mezi kterými putuje jedno podsvícení.
//
// Stejný princip jako zvýraznění v docku a ve vyhledávání: dvě tělesa ve
// vrstvě s goo filtrem, to zadní pomalejší, takže se mezi nimi cestou natáhne
// krk a na konci luskne zpátky. Jedno klouzající pole umí jenom jet.
//
// Tlačítka nad ním jsou skleněná, takže barva prosvítá skrz ně — proto to
// funguje jako podsvícení a ne jako druhé pozadí. Bez ukazatele (než se na
// něco najede) sedí na prvním tlačítku, aby bylo vidět, kam vede hlavní cesta.
//
// Goo filtr běží **jen po dobu cesty**. V klidu totiž rozmazává i osamocené
// těleso, takže se podsvícení rozlilo přes obě tlačítka jako elipsa — a to je
// právě ten stav, ve kterém se na ně člověk dívá nejdéle. Během přesunu je
// rozmazání to, co dvě tělesa spojí krkem, takže tam smysl má.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";

interface Ram { x: number; y: number; w: number; h: number }

export function MorfSkupina({ children, className = "" }: { children: ReactNode; className?: string }) {
  // Vlastní id filtru na každou skupinu: dvě stejná id v jednom dokumentu
  // fungují jen do chvíle, než se to první odpojí, a pak se druhé tiše rozbije.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const box = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const trail = useRef<HTMLSpanElement>(null);
  const last = useRef<Ram | null>(null);
  const bezi = useRef<Animation[]>([]);
  const dojezd = useRef<number | undefined>(undefined);

  const umisti = useCallback((cil: HTMLElement | null, animovat: boolean) => {
    const b = box.current, lead = pill.current, tail = trail.current;
    if (!b || !lead || !tail) return;
    const el = cil ?? b.querySelector<HTMLElement>("[data-morf]");
    if (!el) return;
    const br = b.getBoundingClientRect(), er = el.getBoundingClientRect();
    if (!er.width || !br.width) return;
    const next: Ram = { x: er.left - br.left, y: er.top - br.top, w: er.width, h: er.height };
    const prev = last.current;
    const stejne = !!prev && Math.abs(next.x - prev.x) < 0.5 && Math.abs(next.y - prev.y) < 0.5 && Math.abs(next.w - prev.w) < 0.5;
    // `pointerover` přiletí znovu z každého vnitřního prvku tlačítka. Když už
    // jedeme na tentýž cíl, není co řešit — jinak by druhá událost zrušila
    // rozjetou cestu a podsvícení by na místo skočilo.
    if (stejne && bezi.current.some((a) => a.playState === "running")) return;

    for (const a of bezi.current) { try { a.cancel(); } catch { /* už doběhla */ } }
    bezi.current = [];

    // Zaparkovat napřed: na tyhle hodnoty animace dosedne, takže zrušení
    // doběhlého `fill: forwards` nespadne na jiný stav.
    const park = (t: HTMLElement) => {
      t.style.width = `${next.w}px`; t.style.height = `${next.h}px`;
      t.style.transform = `translate(${next.x}px, ${next.y}px)`;
    };
    park(lead); park(tail);
    b.dataset.morf = "ano";

    const vrstva = lead.parentElement as HTMLElement;
    const tichy = document.documentElement.dataset.motion === "reduce";
    if (!animovat || !prev || tichy || stejne) {
      // Nikam se nejede, takže ani rozmazávat není co. Bez tohohle řádku by
      // `hybe` zůstalo viset na „ano" pokaždé, když `pointerover` přiletí
      // podruhé ze stejného tlačítka — a filtr by se nikdy nevypnul.
      window.clearTimeout(dojezd.current);
      vrstva.dataset.hybe = "ne";
      last.current = next;
      return;
    }
    const dx = Math.abs(next.x - prev.x), dy = Math.abs(next.y - prev.y);
    // Napnout se musí ve směru cesty. Na širokém okně jsou tlačítka vedle
    // sebe, na úzkém pod sebou — a vodorovné napnutí při svislé cestě je
    // přesně ta placatá elipsa, která tam nemá co dělat.
    // Svisle = tlačítka jsou pod sebou (úzké okno). Tam se goo nezapíná:
    // dvě pilulky přes celou šířku se slijí do jedné velké elipsy kolem obou,
    // což není krk, ale kaňka. Podsvícení prostě dojede.
    const svisle = dy > dx;
    const tah = Math.min(1.28, 1 + (dx + dy) / 460);
    const napni = (v: number) => (svisle ? `scaleY(${v})` : `scaleX(${v})`);
    const snimky = (roztah: number): Keyframe[] => [
      { transform: `translate(${prev.x}px, ${prev.y}px) ${napni(1)}`, width: `${prev.w}px`, height: `${prev.h}px` },
      { transform: `translate(${(prev.x + next.x) / 2}px, ${(prev.y + next.y) / 2}px) ${napni(roztah)}`, width: `${(prev.w + next.w) / 2}px`, offset: 0.46 },
      { transform: `translate(${next.x}px, ${next.y}px) ${napni(1)}`, width: `${next.w}px`, height: `${next.h}px` },
    ];
    vrstva.dataset.hybe = svisle ? "ne" : "ano";
    // Vypnutí filtru visí na hodinách, ne na `finished`: na skryté záložce se
    // animace nehýbou, slib nikdy nedoběhne a rozmazání by po návratu zůstalo
    // viset. Čas doběhu je známý, tak ať to rozhodne on.
    window.clearTimeout(dojezd.current);
    dojezd.current = window.setTimeout(() => { vrstva.dataset.hybe = "ne"; }, 560);
    const pust = (t: HTMLElement, kf: Keyframe[], ms: number) => {
      const a = t.animate(kf, { duration: ms, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" });
      a.finished.then(() => a.cancel()).catch(() => { /* přebito */ });
      bezi.current.push(a);
    };
    pust(lead, snimky(tah), 420);
    // Jen o kousek pomalejší: čím déle jsou tělesa od sebe, tím víc je z krku
    // kaňka. Stačí, aby stopa dojela chvilku po pilulce.
    pust(tail, snimky(1), 520);
    last.current = next;
  }, []);

  useLayoutEffect(() => { umisti(null, false); }, [umisti]);
  useEffect(() => {
    const znovu = () => umisti(null, false);
    window.addEventListener("resize", znovu);
    // Písmo doskočí později a tlačítko s ním změní šířku.
    document.fonts?.ready.then(znovu).catch(() => { /* bez webfontu */ });
    return () => { window.removeEventListener("resize", znovu); window.clearTimeout(dojezd.current); };
  }, [umisti]);

  const naCil = (e: React.SyntheticEvent) => {
    const t = (e.target as Element).closest<HTMLElement>("[data-morf]");
    if (t) umisti(t, true);
  };

  return (
    <div ref={box} className={`morf-skupina ${className}`} data-morf="ne" style={{ ["--goo" as string]: `url(#morf-goo-${uid})` }}
      onPointerOver={naCil} onFocusCapture={naCil} onPointerLeave={() => umisti(null, true)}>
      {/* Goo: dvě plná tělesa rozmazaná dohromady a prahem vrácená zpět na
          ostrou alfu, takže se slijí krkem místo aby se překrývala jako dvě
          skvrny. Posun je přesně půlka násobitele, což dá práh na 0,5 —
          rozmazaná hrana ji protne na původní siluetě, takže se tvar vrátí
          ve své velikosti a ne jako svatozář kolem. */}
      <svg className="goo-defs" aria-hidden="true" focusable="false">
        <filter id={`morf-goo-${uid}`} colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b" />
          <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" />
        </filter>
      </svg>
      <span className="ms-vrstva" aria-hidden="true">
        <span className="ms-telo ms-stopa" ref={trail} />
        <span className="ms-telo" ref={pill} />
      </span>
      {children}
    </div>
  );
}
