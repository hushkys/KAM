// The app's places, in dock order. `extra` items fold into "Více" on phones.

export interface NavItem { path: string; label: string; module: string; icon: string; desc: string; extra?: boolean; group: "main" | "tools" }

export const NAV: NavItem[] = [
  { path: "/prehled", label: "Přehled", module: "prehled", icon: "grid", desc: "Kraj na jedné obrazovce: rizika, puls, výhled", group: "main" },
  { path: "/mapa", label: "Mapa", module: "mapa", icon: "map", desc: "Česko po krajích a Královéhradecko po obcích", group: "main" },
  { path: "/obce", label: "Obce", module: "obce", icon: "home", desc: "Živé profily 448 obcí a 15 ORP", group: "main" },
  { path: "/vyhled", label: "Výhled", module: "vyhled", icon: "trend-up", desc: "Obyvatelé 2026–2040 ve třech scénářích", group: "main", extra: true },
  { path: "/scenare", label: "Scénáře", module: "scenare", icon: "split", desc: "Co kdyby: simulace zásahů a jejich dopadů", group: "main" },
  { path: "/hospodareni", label: "Hospodaření", module: "hospodareni", icon: "coins", desc: "Rozpočet obce: co zbyde z provozu a co jde do majetku", group: "tools", extra: true },
  { path: "/dotace", label: "Dotace", module: "dotace", icon: "gift", desc: "Kolik do území doteklo a kam se obrátit pro další", group: "tools", extra: true },
  { path: "/podnety", label: "Podněty", module: "podnety", icon: "message", desc: "Hlášení občanů a formální podněty kraji", group: "tools", extra: true },
  { path: "/data", label: "Data", module: "data", icon: "database", desc: "Využité otevřené datové sady a datové potřeby", group: "tools", extra: true },
  { path: "/statistiky", label: "Statistiky", module: "statistiky", icon: "chart", desc: "Čísla o datech, modelu a provozu", group: "tools", extra: true },
  { path: "/asistent", label: "Asistent", module: "asistent", icon: "sparkle", desc: "AI asistent s přístupem k datům KAM", group: "tools", extra: true },
  { path: "/nastaveni", label: "Nastavení", module: "nastaveni", icon: "settings", desc: "Vzhled, přístupnost, modely, data a soukromí", group: "tools", extra: true },
];

export const TITLES: Record<string, string> = {
  hook: "", prehled: "Přehled", mapa: "Mapa", obce: "Obce", profil: "Profil území", vyhled: "Výhled", scenare: "Scénáře", podnety: "Podněty",
  hospodareni: "Hospodaření", dotace: "Dotace", data: "Data", statistiky: "Statistiky", asistent: "Asistent", nastaveni: "Nastavení", "o-nas": "O nás", pravni: "Právní informace", "404": "Nenalezeno",
};
