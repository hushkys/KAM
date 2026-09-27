// A small router.
//
// History API for real URLs (the server answers every path with the app).
// Page motion is an entrance only: the new page mounts with a short fade
// (see `.page-enter` in base.css) and its cards rise in after it. There is
// deliberately no exit animation and no View Transitions API: snapshotting a
// whole page whose height changes made the old page shrink and fly away.
// An entrance-only transition cannot do that. A swipe between pages is the
// exception — it moves the real pages (components/Gesta.tsx) and the page it
// lands on skips its entrance, because it was already on screen.

import { createContext, useContext, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

export interface Loc {
  path: string;
  query: URLSearchParams;
  hash: string;
  key: number;
}

let key = 0;
function snapshot(): Loc {
  return { path: location.pathname.replace(/\/+$/, "") || "/", query: new URLSearchParams(location.search), hash: location.hash.slice(1), key: key++ };
}

let loc: Loc = typeof window === "undefined" ? { path: "/", query: new URLSearchParams(), hash: "", key: 0 } : snapshot();
const listeners = new Set<() => void>();
const scrolls = new Map<string, number>();

function commit(scrollTo: number | null) {
  loc = snapshot();
  listeners.forEach((l) => l());
  requestAnimationFrame(() => {
    if (loc.hash) document.getElementById(loc.hash)?.scrollIntoView({ block: "start" });
    else if (scrollTo !== null) window.scrollTo(0, scrollTo);
  });
}

/** Přechod gestem: nová stránka se neukazuje poprvé — člověk ji celou dobu
 *  tahu viděl v náhledu — takže nesmí znovu naskakovat. Značka na `<html>`
 *  vypne nájezdové animace (`base.css`) a sama zmizí, až by všechny stejně
 *  doběhly; kdyby zmizela dřív, rozběhly by se od půlky. Každá jiná
 *  navigace ji ruší hned, aby další stránka nájezd měla. */
let prechodCas: number | undefined;
function znackaPrechodu(gesto: boolean) {
  if (typeof document === "undefined") return;
  const r = document.documentElement;
  window.clearTimeout(prechodCas);
  if (gesto) {
    r.dataset.prechod = "gesto";
    prechodCas = window.setTimeout(() => { delete r.dataset.prechod; }, 2600);
  } else if (r.dataset.prechod) {
    delete r.dataset.prechod;
  }
}

export function navigate(to: string, opts: { replace?: boolean; gesto?: boolean } = {}): void {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) {
    window.open(to, "_blank", "noopener");
    return;
  }
  const samePage = url.pathname === location.pathname;
  if (!samePage) znackaPrechodu(Boolean(opts.gesto));
  scrolls.set(location.pathname + location.search, window.scrollY);
  if (opts.replace || (samePage && url.search === location.search)) history.replaceState(null, "", url.pathname + url.search + url.hash);
  else history.pushState(null, "", url.pathname + url.search + url.hash);
  commit(samePage ? null : 0);
}

export function setQuery(params: Record<string, string | null | undefined>): void {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  history.replaceState(null, "", location.pathname + (s ? `?${s}` : "") + location.hash);
  loc = snapshot();
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  history.scrollRestoration = "manual";
  window.addEventListener("popstate", () => { znackaPrechodu(false); commit(scrolls.get(location.pathname + location.search) ?? 0); });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Náhled sousední stránky (přejetí prstem) žije pod vlastní adresou.
 *  Stránka v náhledu tak čte přesně to, co bude číst po skutečném přechodu
 *  — cestu cíle a prázdný dotaz, protože navigace dotaz nepřenáší — a ne
 *  adresu stránky, nad kterou zrovna leží. */
const NahledCtx = createContext<Loc | null>(null);
export const NahledLokace = NahledCtx.Provider;

export function useLocation(): Loc {
  const nahled = useContext(NahledCtx);
  const skutecna = useSyncExternalStore(subscribe, () => loc, () => loc);
  return nahled ?? skutecna;
}

/** Je komponenta vykreslená v náhledu? Stránka, která při načtení zapisuje
 *  do adresy (`setQuery` v efektu), to v náhledu dělat nesmí — přepsala by
 *  adresu stránky, na které člověk ve skutečnosti je. */
export function useNahled(): boolean {
  return useContext(NahledCtx) !== null;
}

export interface Match {
  name: string;
  params: Record<string, string>;
}

const PATTERNS: [string, RegExp][] = [
  ["hook", /^\/$/],
  ["prehled", /^\/prehled$/],
  ["mapa", /^\/mapa$/],
  ["obce", /^\/obce$/],
  ["profil", /^\/obce\/(?<id>(?:obec|orp|okres|kraj):\d+|cz)$/],
  ["vyhled", /^\/vyhled$/],
  ["scenare", /^\/scenare$/],
  ["hospodareni", /^\/hospodareni$/],
  ["plany", /^\/plany$/],
  ["dotace", /^\/dotace$/],
  ["podnety", /^\/podnety$/],
  ["data", /^\/data$/],
  ["statistiky", /^\/statistiky$/],
  ["asistent", /^\/asistent$/],
  ["nastaveni", /^\/nastaveni(?:\/(?<tab>[a-z-]+))?$/],
  ["o-nas", /^\/o-nas$/],
  ["pravni", /^\/pravni$/],
];

export function match(path: string): Match {
  for (const [name, rx] of PATTERNS) {
    const m = rx.exec(path);
    if (m) return { name, params: (m.groups as Record<string, string>) ?? {} };
  }
  return { name: "404", params: {} };
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children: ReactNode };

export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (/^https?:/.test(to)) return;
    e.preventDefault();
    navigate(to);
  };
  const external = /^https?:/.test(to);
  return (
    <a href={to} onClick={handle} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...rest}>
      {children}
    </a>
  );
}
