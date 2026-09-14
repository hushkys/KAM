// Coloured module icons for the dock: each place in the app has its own
// hue, drawn as two-tone gradient shapes in the manner of Fluent app icons.
// Gradient ids are namespaced per instance (useId) — a plain counter collides
// when the same icon renders twice on one page.

import { useId, type ReactElement } from "react";

type Stops = [string, string];
interface Spec {
  a: Stops;
  b: Stops;
  draw: (fa: string, fb: string) => ReactElement;
}

const W = "#ffffff";

const SPECS: Record<string, Spec> = {
  prehled: {
    a: ["#8ee06a", "#3f9440"], b: ["#caf3a6", "#8ed06a"],
    draw: (fa, fb) => (<>
      <rect className="mi-1" x="3" y="3" width="10.5" height="10.5" rx="3" fill={fa} />
      <rect className="mi-2" x="15.5" y="3" width="5.5" height="10.5" rx="2.5" fill={fb} />
      <rect className="mi-3" x="3" y="15.5" width="7" height="5.5" rx="2.5" fill={fb} />
      <rect className="mi-4" x="12" y="15.5" width="9" height="5.5" rx="2.5" fill={fa} opacity=".85" />
    </>),
  },
  mapa: {
    a: ["#3fd2a4", "#11806a"], b: ["#9bebd2", "#3fbf98"],
    draw: (fa, fb) => (<>
      <path d="M2.5 6.2L8.5 3.5v15.3l-6 2.7z" fill={fb} />
      <path d="M8.5 3.5l7 3v15l-7-2.7z" fill={fa} />
      <path d="M15.5 6.5l6-2.7v15l-6 2.7z" fill={fb} />
      <circle cx="12" cy="11" r="2.3" fill={W} />
    </>),
  },
  obce: {
    a: ["#6fbcf7", "#1f6bb5"], b: ["#bcdffd", "#6fb4ef"],
    draw: (fa, fb) => (<>
      <path d="M2.5 11.5L8.5 6l6 5.5V21h-12z" fill={fb} />
      <path d="M10 10l6.5-6 6 6V21H10z" fill={fa} />
      <rect x="14.5" y="14.5" width="3.5" height="6.5" rx="1" fill={W} opacity=".9" />
      <rect x="5" y="14" width="3" height="3" rx=".8" fill={W} opacity=".8" />
    </>),
  },
  vyhled: {
    a: ["#a98bff", "#5a35c9"], b: ["#5a35c9", "#361d80"],
    draw: (fa, fb) => (<>
      <path d="M3 20.5V15l5-4 4 2.5 8.5-8V20.5z" fill={fb} opacity=".55" />
      <path d="M3 15l5-4 4 2.5 8.5-8" fill="none" stroke={fa} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20.5" cy="5.5" r="2.4" fill="#d9f7a8" />
    </>),
  },
  scenare: {
    a: ["#ff9d3d", "#d1560d"], b: ["#ffd2a0", "#ff9436"],
    draw: (fa, fb) => (<>
      <path d="M6 18.5V14a4 4 0 0 1 4-4h4a4 4 0 0 0 4-4V5" fill="none" stroke={fb} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M6 14V5" fill="none" stroke={fa} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="6" cy="19" r="2.6" fill={fa} />
      <circle cx="6" cy="4.5" r="2.4" fill={fa} />
      <circle cx="18" cy="4.5" r="2.4" fill={fb} />
    </>),
  },
  // Hospodaření = peníze, které obci projdou rukama. Peněženka, ne graf:
  // sloupce už má Statistiky a stoupající křivku Výhled, takže by se v docku
  // pletly. Zlatá je jediný teplý odstín, který tu ještě nebyl.
  hospodareni: {
    a: ["#f5c95e", "#bd840d"], b: ["#ffeaa6", "#f0c052"],
    draw: (fa, fb) => (<>
      <rect x="2.5" y="5.2" width="19" height="14.6" rx="3.4" fill={fa} />
      <path d="M2.5 9.4h12.8a1.6 1.6 0 0 0 0-3.2H5.9" fill="none" stroke={W} strokeOpacity=".4" strokeWidth="1.2" />
      <path className="mi-1" d="M13.4 10.4h8.1v4.6h-8.1a2.3 2.3 0 0 1 0-4.6z" fill={fb} />
      <circle className="mi-1" cx="16.1" cy="12.7" r="1.5" fill={W} />
    </>),
  },
  // Dotace = peníze, které přijdou odjinud. Mince padající do dlaní: samotná
  // mince by byla jen „peníze", teprve ty dlaně říkají, že je někdo dává.
  dotace: {
    a: ["#ef8ac9", "#a3378a"], b: ["#ffc9e8", "#ef8ac9"],
    draw: (fa, fb) => (<>
      <circle className="mi-1" cx="12" cy="5.9" r="4.3" fill={fb} />
      <path className="mi-1" d="M10.4 4.9a2.2 2.2 0 0 1 3.2 0" fill="none" stroke={W} strokeOpacity=".75" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M3.6 13.9h16.8a1.1 1.1 0 0 1 1.1 1.2c-.5 3.8-3.6 6.7-7.4 6.7h-4.2c-3.8 0-6.9-2.9-7.4-6.7a1.1 1.1 0 0 1 1.1-1.2z" fill={fa} />
      <path d="M5.2 15.2h13.6" fill="none" stroke={W} strokeOpacity=".45" strokeWidth="1.2" strokeLinecap="round" />
    </>),
  },
  podnety: {
    a: ["#5cd4ec", "#128aa6"], b: ["#b4edf8", "#57c9e2"],
    draw: (fa) => (<>
      <path d="M4.5 3.5h15a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5H12l-5.5 4v-4h-2A2.5 2.5 0 0 1 2 15V6a2.5 2.5 0 0 1 2.5-2.5z" fill={fa} />
      <circle cx="8" cy="10.5" r="1.4" fill={W} /><circle cx="12" cy="10.5" r="1.4" fill={W} /><circle cx="16" cy="10.5" r="1.4" fill={W} />
    </>),
  },
  data: {
    a: ["#8f95ee", "#3f43b0"], b: ["#ccceff", "#8a90e8"],
    draw: (fa, fb) => (<>
      <path d="M4 6.5v11c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5v-11z" fill={fa} />
      <ellipse cx="12" cy="6.5" rx="8" ry="3.4" fill={fb} />
      <path d="M4 12c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5" fill="none" stroke={W} strokeOpacity=".55" strokeWidth="1.3" />
    </>),
  },
  statistiky: {
    a: ["#ff8f7f", "#c73b2c"], b: ["#ffc6bd", "#ff8878"],
    draw: (fa, fb) => (<>
      <rect className="mi-1" x="3" y="11" width="4.6" height="10" rx="1.6" fill={fb} />
      <rect className="mi-2" x="9.7" y="4" width="4.6" height="17" rx="1.6" fill={fa} />
      <rect className="mi-3" x="16.4" y="8" width="4.6" height="13" rx="1.6" fill={fb} />
    </>),
  },
  asistent: {
    a: ["#cf8bff", "#8028c8"], b: ["#eccfff", "#c884fa"],
    draw: (fa, fb) => (<>
      <path className="mi-1" d="M11 2.5c.9 5.2 3 7.3 8.3 8.2-5.3.9-7.4 3-8.3 8.3-.9-5.3-3-7.4-8.2-8.3 5.2-.9 7.3-3 8.2-8.2z" fill={fa} />
      <path className="mi-2" d="M18.8 14.5c.4 2.3 1.3 3.2 3.6 3.6-2.3.4-3.2 1.3-3.6 3.6-.4-2.3-1.3-3.2-3.6-3.6 2.3-.4 3.2-1.3 3.6-3.6z" fill={fb} />
    </>),
  },
  nastaveni: {
    a: ["#9fb3a8", "#4d6358"], b: ["#dbe6df", "#9aaea3"],
    draw: (fa, fb) => (<>
      <path className="mi-1" d="M12 2.5l2.1 2 2.9-.5 1 2.8 2.7 1.3-.9 2.9.9 2.9-2.7 1.3-1 2.8-2.9-.5-2.1 2-2.1-2-2.9.5-1-2.8L3.3 16l.9-2.9-.9-2.9 2.7-1.3 1-2.8 2.9.5z" fill={fa} />
      <circle className="mi-2" cx="12" cy="12" r="3.6" fill={fb} />
    </>),
  },
  onas: {
    a: ["#8fd66f", "#3a8f4a"], b: ["#6cc4f2", "#2a78c2"],
    draw: (fa, fb) => (<>
      <circle cx="8.5" cy="8" r="3.6" fill={fa} />
      <path d="M2.5 20c.6-4 3-6 6-6s5.4 2 6 6z" fill={fa} />
      <circle cx="16.5" cy="9" r="3" fill={fb} />
      <path d="M13 20c.5-3.3 2.2-5 4-5 2.6 0 4 1.8 4.5 5z" fill={fb} opacity=".9" />
    </>),
  },
};

export function ModuleIcon({ name, size = 26 }: { name: string; size?: number }) {
  const uid = useId().replace(/:/g, "");
  const spec = SPECS[name] ?? SPECS.prehled;
  const a = `${uid}a`;
  const b = `${uid}b`;
  return (
    // `data-module` nese jméno modulu do CSS: každá ikona má při klepnutí
    // svou vlastní animaci a rozlišit je jde jen podle něj.
    <svg className="module" data-module={name} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={a} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={spec.a[0]} />
          <stop offset="1" stopColor={spec.a[1]} />
        </linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={spec.b[0]} />
          <stop offset="1" stopColor={spec.b[1]} />
        </linearGradient>
      </defs>
      {spec.draw(`url(#${a})`, `url(#${b})`)}
    </svg>
  );
}

export const MODULE_NAMES = Object.keys(SPECS);
