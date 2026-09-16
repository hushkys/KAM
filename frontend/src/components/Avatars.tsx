// Portréty týmu.
//
// Kreslené, ne fotky — a schválně: fotka na hackathonovém prototypu stárne
// rychleji než kód a čtyři různě nasvícené selfie vedle sebe rozbijí každou
// stránku. Tohle je jeden systém: stejná hlava, stejné světlo zleva, stejné
// proporce, a rozdíl dělá jen silueta vlasů, doplněk a barva.
//
// Každý tvar je plocha, žádné obrysy. Stín na pravé straně obličeje a krku je
// jedna poloprůhledná plocha navíc, takže portrét drží tvar i v malé velikosti,
// kde by se z linek stala kaše.

import type { ReactElement } from "react";

interface Vzhled {
  /** Dvojice pro kruhové pozadí, odshora dolů. */
  pozadi: [string, string];
  plet: string;
  vlasy: string;
  tricko: string;
  /** Silueta vlasů přes hlavu. Je to jediné, co portréty od sebe kromě barev
   *  odlišuje — proto musí být každá vlastní, ne varianta téhož oblouku. */
  ucesy: ReactElement;
}

const VZHLED: Record<string, Vzhled> = {
  ondrej: {
    pozadi: ["#1f5636", "#0e2a1c"], plet: "#7b4f36", vlasy: "#17130f", tricko: "#8fcb6b",
    // Krátký sestřih s ostrou linkou vlasů; vzadu o kousek delší.
    ucesy: (
      <>
        <path d="M60 24c-14 0-23 9-23 23 0 3 .3 6 .8 9 .7-8 2.4-13 5.2-16 3-3 8-5 17-5 6 0 11 1 14 4 3 2.5 4.6 7 5.2 13 .6-3 .8-6 .8-9 0-14-9-23-20-23z" />
        <path d="M37 47c-2.4.4-4 2.4-4 5.2 0 2.6 1.4 4.6 3.6 5.2-.4-3.6-.4-7-.4-10.4zM83 47c2.4.4 4 2.4 4 5.2 0 2.6-1.4 4.6-3.6 5.2.4-3.6.4-7 .4-10.4z" opacity=".55" />
      </>
    ),
  },
  josef: {
    pozadi: ["#27456b", "#111f33"], plet: "#f0c9a4", vlasy: "#6d4326", tricko: "#e9b44c",
    // Pěšinka vlevo a vlna dozadu: mezi čtyřmi portréty je účes jediné, co je
    // od sebe odliší, takže musí být poznat i v malé velikosti.
    ucesy: (
      <path d="M60 22.5c-13.4 0-22.4 9.2-22.4 22.5 0 2.2.2 4.4.6 6.4.8-6.2 2.4-10.4 4.8-13.2 2-2.4 4.6-4 7.8-5-.6 2.4-.8 4.8-.6 7.4 2.6-3.4 6-5.4 10-6.4 4-1 8.4-.8 12.6.6 4 1.4 7 3.8 8.8 7.2 1.2 2.4 2 5.6 2.4 9.4.4-2 .6-4.2.6-6.4 0-13.3-9-22.5-22.6-22.5z" />
    ),
  },
  matej: {
    pozadi: ["#3a2f5e", "#1b1430"], plet: "#f4d2b4", vlasy: "#dcb95f", tricko: "#22232a",
    // Vlnitý blond přes čelo.
    // Vlnitý blond: spodní hrana se zvlní, jinak je z účesu přilba.
    ucesy: (
      <path d="M38.5 51c-1.2-15.4 8-27 21.5-27 13.2 0 21.8 10.2 21.8 24.4 0 3-.4 6-1.1 8.8-.8-4.6-2.2-8-4.2-10.2-2.2 2.8-5.2 4.2-9 4.2-4.6 0-7.8-1.8-9.8-4.6-2.4 3.4-5.6 5.8-9.6 7.2-2.6.9-5.3 1.5-8 1.3-.6 2-1.1 4.3-1.4 6.9-.3-3.6-.4-7-.2-11.2z" />
    ),
  },
  damian: {
    pozadi: ["#14484a", "#0a2526"], plet: "#e7b98f", vlasy: "#2a1d15", tricko: "#8fa3a0",
    ucesy: (
      <path d="M60 23c-13 0-22 9-22 23 0 3 .3 6 .8 8 .8-7 2.6-11.6 5.6-14.4 3.6-3.4 9-5 15.6-5 6 0 11 1.4 14.6 4.4 3 2.6 5 7.4 6 15 .5-2.6.8-5.4.8-8 0-14-9-23-21.4-23z" />
    ),
  },
};

/** Portrét. Jedna geometrie pro všechny — mění se jen barvy a silueta. */
export function Avatar({ who, size = 96, title }: { who: keyof typeof VZHLED | string; size?: number; title?: string }) {
  const v = VZHLED[who] ?? VZHLED.ondrej;
  const id = `av-${who}`;
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={title ?? "Portrét"}>
      <defs>
        <clipPath id={`${id}-k`}><circle cx="60" cy="60" r="60" /></clipPath>
        <linearGradient id={`${id}-p`} x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0" stopColor={v.pozadi[0]} />
          <stop offset="1" stopColor={v.pozadi[1]} />
        </linearGradient>
        {/* Měkké světlo shora zleva. Jedna plocha, žádný filtr: filtr by se
            v seznamu čtyř portrétů počítal čtyřikrát a je to vidět. */}
        <radialGradient id={`${id}-s`} cx=".28" cy=".16" r=".9">
          <stop offset="0" stopColor="#fff" stopOpacity=".16" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g clipPath={`url(#${id}-k)`}>
        <rect width="120" height="120" fill={`url(#${id}-p)`} />
        <rect width="120" height="120" fill={`url(#${id}-s)`} />

        {/* ramena a tričko */}
        <path d="M16 120c3-19 19-29 44-29s41 10 44 29z" fill={v.tricko} />
        <path d="M60 91c25 0 41 10 44 29h-44z" fill="#000" opacity=".12" />

        {/* krk se stínem pod čelistí */}
        <path d="M51 74h18v13c0 5-4 8-9 8s-9-3-9-8z" fill={v.plet} />
        <path d="M51 74h18v6c-3 3-6 4.4-9 4.4S54 83 51 80z" fill="#000" opacity=".22" />

        {/* uši */}
        <ellipse cx="37.5" cy="57" rx="4.2" ry="6" fill={v.plet} />
        <ellipse cx="82.5" cy="57" rx="4.2" ry="6" fill={v.plet} />

        {/* hlava: temeno kulaté, čelist zúžená — bez toho je z portrétu vajíčko */}
        <path d="M60 26c13 0 21 9 21 22 0 7-1 13-4 18-3.4 6-9.6 10.6-17 10.6S46.4 72 43 66c-3-5-4-11-4-18 0-13 8-22 21-22z" fill={v.plet} />
        <path d="M60 26c13 0 21 9 21 22 0 7-1 13-4 18-3.4 6-9.6 10.6-17 10.6V26z" fill="#000" opacity=".1" />

        {/* oči: víčko je tmavší oblouk nad duhovkou, ne jen tečka */}
        <g fill="#1b1b20">
          <ellipse cx="50.5" cy="56" rx="2.7" ry="3.1" />
          <ellipse cx="69.5" cy="56" rx="2.7" ry="3.1" />
        </g>
        <g fill="#fff" opacity=".8">
          <circle cx="51.4" cy="55" r=".9" />
          <circle cx="70.4" cy="55" r=".9" />
        </g>
        <g fill="none" stroke={v.vlasy} strokeWidth="2" strokeLinecap="round" opacity=".9">
          <path d="M45.5 48.5c2.4-1.8 6-2 9 -.6" />
          <path d="M74.5 48.5c-2.4-1.8-6-2-9-.6" />
        </g>

        {/* nos a ústa */}
        <path d="M60 58v5.5c0 1.4.9 2.2 2.3 2.4" fill="none" stroke="#000" strokeOpacity=".28" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M54 70.5c3.6 2.8 8.4 2.8 12 0" fill="none" stroke="#000" strokeOpacity=".45" strokeWidth="2.1" strokeLinecap="round" />

        <g fill={v.vlasy}>{v.ucesy}</g>
      </g>
    </svg>
  );
}

/** Chrániče kolen. Týmový vtip, který si Damián vysloužil — a protože si na
 *  něm zakládá, má je na kartě. Dvě plochy, žádný rastr, jako všechno ostatní. */
export function Chranice({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Chrániče na kolena">
      <title>Chrániče na kolena</title>
      <path d="M9 15h30M9 33h30" stroke="var(--text-mute)" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M14 10h20a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6V16a6 6 0 0 1 6-6z"
        fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2.4" />
      <path d="M17 19c4-2 10-2 14 0M17 29c4 2 10 2 14 0" stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".8" />
    </svg>
  );
}

export interface Clovek { who: string; name: string; role: string; school: string; chranice?: boolean; oblast: string; vede?: boolean }

/** Tým není seznam lidí, ale dvě oblasti — a každá má někoho, kdo ji vede.
 *  Seznam se z toho staví sám, takže přibrat člověka znamená přidat řádek. */
export const OBLASTI: { key: string; name: string; lead: Clovek; lide: Clovek[] }[] = [
  {
    key: "vyvoj",
    name: "Vývoj a technologie",
    lead: { who: "ondrej", name: "Ondřej Hušek", role: "Vývoj, architektura a AI", school: "UHK · FIM · Informační a síťová bezpečnost", oblast: "Vývoj a technologie", vede: true },
    lide: [{ who: "matej", name: "Matěj Jirásek", role: "UX/UI designer a klíčový motivátor", school: "UHK · FIM · Informační a síťová bezpečnost", oblast: "Vývoj a technologie" }],
  },
  {
    key: "brand",
    name: "Brand, produkt a veřejná komunikace",
    lead: { who: "josef", name: "Josef Efler", role: "Branding, brandstorming, marketing a legal", school: "UTB · FLKŘ · Řízení rizik ve veřejné správě", oblast: "Brand a produkt", vede: true },
    lide: [{ who: "damian", name: "Damián Roháček", role: "Backend developer", school: "UHK · FIM · Informační a síťová bezpečnost", chranice: true, oblast: "Dozor nad aplikací" }],
  },
];

export const TEAM: Clovek[] = OBLASTI.flatMap((o) => [o.lead, ...o.lide]);
