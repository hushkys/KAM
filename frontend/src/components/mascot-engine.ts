// Maskot: tvar, pružiny a choreografie. Bez Reactu a bez DOM.
//
// Proč vlastní smyčka místo klíčových snímků: CSS umí `scale()`, a `scale()`
// z kruhu udělá elipsu. Skutečná kreslená deformace je něco jiného — při
// dopadu se spodek o zem **zploští**, boky se vyboulí a vršek přepadne
// dopředu; při odrazu se tělo protáhne do kapky, která je nahoře užší než
// dole. To se elipsou napodobit nedá, protože každý ze čtyř okrajů musí jít
// vlastním směrem. Tělo je proto cesta ze čtyř Bézierů, jejíž čtyři poloměry,
// zkosení a zploštění se počítají každý snímek.
//
// Druhý důvod je čas. Choreografie má rozmýšlení, pohledy, mrknutí, chůzi po
// M a slezení po jeho hraně — patnáct úseků, které na sebe navazují a mají
// různé křivky. Jedny klíčové snímky přes pět vteřin by se nedaly přečíst
// ani opravit.

export interface Poloha {
  x: number; y: number; rot: number;
  rTop: number; rBot: number; rL: number; rR: number;
  shear: number; flat: number;
}

/** Tělo jako uzavřená cesta ze čtyř kubik. Každý okraj má vlastní poloměr,
 *  takže tvar může být kapka, placka i vejce — ne jen elipsa. */
export function telo(p: Poloha): string {
  const k = 0.5523;
  const { rTop: t, rBot: b, rL: l, rR: r, shear: s, flat: f } = p;
  // Zploštění u země: spodní úchopy se roztáhnou do stran a bod dotyku se
  // srovná do úsečky. Tohle je ten rozdíl mezi „placatá elipsa" a „dosedlo to".
  const bx = 1 + 1.35 * f;
  const by = 1 - 0.75 * f;
  // Zkosení se dělí mezi vršek a spodek: vršek jde po směru pohybu, spodek
  // kousek proti němu. Kdyby se posouval jen vršek, vyroste tělu na opačné
  // straně špičatý cíp — což není náklon, ale kaňka.
  const hx = s;
  const dx = -s * 0.4;
  const f2 = (v: number) => v.toFixed(2);
  return [
    `M${f2(hx)},${f2(-t)}`,
    `C${f2(hx + r * k)},${f2(-t)} ${f2(r)},${f2(-t * k)} ${f2(r)},0`,
    `C${f2(r)},${f2(b * k * by)} ${f2(dx + r * k * bx)},${f2(b)} ${f2(dx)},${f2(b)}`,
    `C${f2(dx - l * k * bx)},${f2(b)} ${f2(-l)},${f2(b * k * by)} ${f2(-l)},0`,
    `C${f2(-l)},${f2(-t * k)} ${f2(hx - l * k)},${f2(-t)} ${f2(hx)},${f2(-t)}`,
    "Z",
  ].join("");
}

/** Pružina s tlumením. `k` je tuhost, `d` tlumení; obojí v jednotkách za sekundu. */
export class Pruzina {
  v = 0;
  constructor(public hodnota: number, public cil: number, public k = 300, public d = 15) {}
  kopni(na: number, rychlost = 0) { this.hodnota = na; this.v = rychlost; }
  krok(dt: number) {
    // Půlkrok při dlouhém snímku: jinak se pružina při 20 fps rozkmitá.
    const n = dt > 0.026 ? 2 : 1;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (this.cil - this.hodnota) * this.k * h - this.v * this.d * h;
      this.hodnota += this.v * h;
    }
    return this.hodnota;
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Hladké náběhy. `easeOut` pro dojezdy, `easeIn` pro rozjezdy, `spring` pro dosedy. */
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeIn = (t: number) => t * t * t;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const spring = (t: number) => 1 - Math.cos(t * Math.PI * 2.4) * Math.exp(-t * 5.2);

/** Geometrie wordmarku. Y = 0 je horní hrana písmen, 100 účaří.
 *
 *  Všechny výšky ve scénáři jsou **plochy, na kterých maskot stojí**, ne
 *  polohy jeho středu. Střed z toho plyne až při kreslení jako
 *  `plocha − spodní poloměr`, takže ať se tělo zdeformuje jakkoli, dotýká se
 *  písmene přesně a nikdy do něj nezaleze. Kdyby scénář držel střed, musela by
 *  se deformace odečítat na každém řádku zvlášť — a jednou by se zapomnělo. */
export const R = 17;                 // klidový poloměr těla
export const POVRCH = 0;             // horní hrana písmen
export const DOMA = { x: 331, y: 86 + R };   // plocha, na které tečka stojí
/** Kam se dopadá.
 *
 *  K má rovnou plošku vlevo, A jen špičku (na té se balancuje) a M se doskakuje
 *  rovnou na **pravé rameno** (x 281–310). Levé rameno by bylo blíž, jenže mezi
 *  rameny se M propadá k y = 57 — kdo by tudy šel po y = 0, kráčel by vzduchem. */
export const PISMENA = [
  { key: "k", x: 12, y: POVRCH },
  { key: "a", x: 146.5, y: POVRCH },
  { key: "m", x: 292, y: POVRCH },
] as const;
/** Kraj pravého ramene M, odkud se leze dolů; osa lezení je kus za hranou,
 *  aby se maskot držel z venku a nelezl skrz písmeno. */
/** Rámeček kresby a posun, po kterém je „KAM." i s tečkou uprostřed.
 *
 *  Písmena končí na x = 310, ale tečka je maskot se středem na 331 a poloměrem
 *  R, takže nápis sahá až k 348. Dokud tečka nedoskákala, je vidět jen „KAM"
 *  a vypadá vycentrovaně; jakmile dosedne, je vlevo od K mezera 70 a vpravo od
 *  tečky jen 12. Proto se celá kresba na úzké obrazovce posune doleva — po
 *  posunu je z obou stran 41. */
export const RAMEC = { x: -70, sirka: 430 };
export const POSUN_STRED = (RAMEC.x + RAMEC.sirka / 2) - (DOMA.x + R) / 2;

export const HRANA_X = 306;
export const LEZENI_X = 322;
export const HRANA_KONEC = 74;

export type Usek =
  | { druh: "beh"; t: number; z: number; na: number }
  | { druh: "stoji"; t: number; kam: number; mrk?: number }
  | { druh: "napreh"; t: number }
  | { druh: "skok"; t: number; zx: number; zy: number; nax: number; nay: number; v: number }
  | { druh: "chuze"; t: number; z: number; na: number }
  | { druh: "chyt"; t: number }
  | { druh: "lezeni"; t: number; zy: number; nay: number; x: number }
  | { druh: "seskok"; t: number; zx: number; zy: number }
  | { druh: "doma"; t: number };

/** Choreografie příchodu. Součet je 4,3 s — dost na rozmyšlenou, ne na nudu. */
export function prichod(): Usek[] {
  const [k, a, m] = PISMENA;
  return [
    { druh: "beh", t: 0.52, z: -66, na: k.x },
    { druh: "stoji", t: 0.34, kam: 1, mrk: 0.16 },
    { druh: "napreh", t: 0.13 },
    { druh: "skok", t: 0.38, zx: k.x, zy: k.y, nax: a.x, nay: a.y, v: 58 },
    { druh: "stoji", t: 0.32, kam: 1, mrk: 0.14 },
    { druh: "napreh", t: 0.12 },
    { druh: "skok", t: 0.46, zx: a.x, zy: a.y, nax: m.x, nay: m.y, v: 66 },
    { druh: "stoji", t: 0.26, kam: 1 },
    { druh: "chuze", t: 0.3, z: m.x, na: HRANA_X },
    { druh: "chyt", t: 0.16 },
    { druh: "lezeni", t: 0.62, zy: POVRCH, nay: HRANA_KONEC, x: LEZENI_X },
    { druh: "seskok", t: 0.3, zx: LEZENI_X, zy: HRANA_KONEC },
    { druh: "doma", t: 0 },
  ];
}
