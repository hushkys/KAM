// Místa aplikace v pořadí navigace. Stejné pořadí má přejíždění prstem mezi
// stránkami, takže „vedle" znamená to, co je v panelu pod sebou.
// `extra` se na telefonu schová do „Více"; `sekce` skládá postranní panel
// do skupin, aby dvanáct položek nebylo jedno nerozlišené pole.

export type Sekce = "analyza" | "obec" | "verejnost" | "system";

export interface NavItem { path: string; label: string; module: string; icon: string; desc: string; extra?: boolean; group: "main" | "tools"; sekce: Sekce }

export const NAV: NavItem[] = [
  { path: "/prehled", label: "Přehled", module: "prehled", icon: "grid", desc: "Kraj na jedné obrazovce: rizika, puls, výhled", group: "main", sekce: "analyza" },
  { path: "/mapa", label: "Mapa", module: "mapa", icon: "map", desc: "Česko po krajích a Královéhradecko po obcích", group: "main", sekce: "analyza" },
  { path: "/obce", label: "Obce", module: "obce", icon: "home", desc: "Živé profily 448 obcí a 15 ORP", group: "main", sekce: "analyza" },
  { path: "/vyhled", label: "Výhled", module: "vyhled", icon: "trend-up", desc: "Obyvatelé 2026–2040 ve třech scénářích", group: "main", extra: true, sekce: "analyza" },
  { path: "/scenare", label: "Scénáře", module: "scenare", icon: "split", desc: "Co kdyby: simulace zásahů a jejich dopadů", group: "main", sekce: "analyza" },
  { path: "/hospodareni", label: "Hospodaření", module: "hospodareni", icon: "coins", desc: "Rozpočet obce: co zbyde z provozu a co jde do majetku", group: "tools", extra: true, sekce: "obec" },
  { path: "/plany", label: "Plány", module: "plany", icon: "landmark", desc: "Programy rozvoje obcí, kolik z období uplynulo a odkazy do registrů", group: "tools", extra: true, sekce: "obec" },
  { path: "/dotace", label: "Dotace", module: "dotace", icon: "gift", desc: "Kolik do území doteklo a kam se obrátit pro další", group: "tools", extra: true, sekce: "obec" },
  { path: "/podnety", label: "Podněty", module: "podnety", icon: "message", desc: "Hlášení občanů a formální podněty kraji", group: "tools", extra: true, sekce: "verejnost" },
  { path: "/data", label: "Data", module: "data", icon: "database", desc: "Využité otevřené datové sady a datové potřeby", group: "tools", extra: true, sekce: "system" },
  { path: "/statistiky", label: "Statistiky", module: "statistiky", icon: "chart", desc: "Čísla o datech, modelu a provozu", group: "tools", extra: true, sekce: "system" },
  { path: "/asistent", label: "Asistent", module: "asistent", icon: "sparkle", desc: "AI asistent s přístupem k datům KAM", group: "tools", extra: true, sekce: "system" },
  { path: "/nastaveni", label: "Nastavení", module: "nastaveni", icon: "settings", desc: "Vzhled, přístupnost, modely, data a soukromí", group: "tools", extra: true, sekce: "system" },
];

export const SEKCE: Record<Sekce, string> = {
  analyza: "Analýza kraje",
  obec: "Obec a rozpočet",
  verejnost: "Veřejnost",
  system: "Data a nástroje",
};

export const TITLES: Record<string, string> = {
  hook: "", prehled: "Přehled", mapa: "Mapa", obce: "Obce", profil: "Profil území", vyhled: "Výhled", scenare: "Scénáře", podnety: "Podněty",
  hospodareni: "Hospodaření", plany: "Plány", dotace: "Dotace", data: "Data", statistiky: "Statistiky", asistent: "Asistent", nastaveni: "Nastavení", "o-nas": "O nás", pravni: "Právní informace", "404": "Nenalezeno",
};

/** Modul, do kterého stránka patří — podle něj má svůj odstín. Profil obce
 *  je pod Obcemi, právní informace pod Nastavením. */
const MODUL_STRANKY: Record<string, string> = {
  hook: "prehled", profil: "obce", "o-nas": "onas", pravni: "nastaveni", "404": "prehled",
};
export function modulStranky(jmeno: string): string {
  return MODUL_STRANKY[jmeno] ?? (NAV.some((n) => n.module === jmeno) ? jmeno : "prehled");
}

/** Kam stránka patří, pro drobečkovou navigaci v horní liště. */
export function sekceStranky(jmeno: string): string | undefined {
  const n = NAV.find((x) => x.module === modulStranky(jmeno));
  return n ? SEKCE[n.sekce] : undefined;
}
