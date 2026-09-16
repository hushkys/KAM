// Skupina tlačítek, mezi kterými putuje jedno podsvícení.
//
// Stejný princip jako zvýraznění v docku a ve vyhledávání: dvě tělesa ve
// vrstvě s goo filtrem, to zadní pomalejší, takže se mezi nimi cestou natáhne
// krk a na konci luskne zpátky. Jedno klouzající pole umí jenom jet.
//
// Tlačítka nad ním jsou skleněná, takže barva prosvítá skrz ně — proto to
// funguje jako podsvícení a ne jako druhé pozadí. Bez ukazatele (než se na
// něco najede) sedí na prvním tlačítku, aby bylo vidět, kam vede hlavní cesta.

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

  const umisti = useCallback((cil: HTMLElement | null, animovat: boolean) => {
    const b = box.current, lead = pill.current, tail = trail.current;
    if (!b || !lead || !tail) return;
    const el = cil ?? b.querySelector<HTMLElement>("[data-morf]");
    if (!el) return;
    const br = b.getBoundingClientRect(), er = el.getBoundingClientRect();
    if (!er.width || !br.width) return;
    const next: Ram = { x: er.left - br.left, y: er.top - br.top, w: er.width, h: er.height };
    const prev = last.current;

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

    const tichy = document.documentElement.dataset.motion === "reduce";
    if (!animovat || !prev || tichy || (Math.abs(next.x - prev.x) < 0.5 && Math.abs(next.y - prev.y) < 0.5)) {
      last.current = next;
      return;
    }
    const drah = Math.abs(next.x - prev.x) + Math.abs(next.y - prev.y);
    const tah = Math.min(1.3, 1 + drah / 420);
    const snimky = (roztah: number): Keyframe[] => [
      { transform: `translate(${prev.x}px, ${prev.y}px) scaleX(1)`, width: `${prev.w}px`, height: `${prev.h}px` },
      { transform: `translate(${(prev.x + next.x) / 2}px, ${(prev.y + next.y) / 2}px) scaleX(${roztah})`, width: `${(prev.w + next.w) / 2}px`, offset: 0.46 },
      { transform: `translate(${next.x}px, ${next.y}px) scaleX(1)`, width: `${next.w}px`, height: `${next.h}px` },
    ];
    const pust = (t: HTMLElement, kf: Keyframe[], ms: number) => {
      const a = t.animate(kf, { duration: ms, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" });
      a.finished.then(() => a.cancel()).catch(() => { /* přebito */ });
      bezi.current.push(a);
    };
    pust(lead, snimky(tah), 420);
    pust(tail, snimky(1), 600);
    last.current = next;
  }, []);

  useLayoutEffect(() => { umisti(null, false); }, [umisti]);
  useEffect(() => {
    const znovu = () => umisti(null, false);
    window.addEventListener("resize", znovu);
    // Písmo doskočí později a tlačítko s ním změní šířku.
    document.fonts?.ready.then(znovu).catch(() => { /* bez webfontu */ });
    return () => window.removeEventListener("resize", znovu);
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
